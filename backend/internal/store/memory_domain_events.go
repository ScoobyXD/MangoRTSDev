package store

import (
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
	"time"
)

func domainEventStringPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func domainEventMemoryKey(companyID, eventID string) string {
	return companyID + ":" + eventID
}

func (r *MemoryRepo) AppendDomainEvent(input DomainEventInput) (domain.DomainEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.appendDomainEventLocked(input)
}

func (r *MemoryRepo) AppendDomainEvents(inputs []DomainEventInput) ([]domain.DomainEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.appendDomainEventsLocked(inputs)
}

func (r *MemoryRepo) appendDomainEventLocked(input DomainEventInput) (domain.DomainEvent, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.StreamType = strings.TrimSpace(input.StreamType)
	input.StreamID = strings.TrimSpace(input.StreamID)
	input.Type = strings.TrimSpace(input.Type)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.StreamType == "" || input.StreamID == "" || input.Type == "" {
		return domain.DomainEvent{}, ErrInvalid
	}
	if r.domainEventAppendErr != nil {
		return domain.DomainEvent{}, r.domainEventAppendErr
	}

	if input.IdempotencyKey != "" {
		for _, existing := range r.domainEvents {
			if existing.CompanyID == input.CompanyID && existing.IdempotencyKey == input.IdempotencyKey {
				return cloneDomainEvent(existing), nil
			}
		}
	}

	sequence := int64(1)
	for _, existing := range r.domainEvents {
		if existing.CompanyID == input.CompanyID && existing.StreamType == input.StreamType && existing.StreamID == input.StreamID && existing.Sequence >= sequence {
			sequence = existing.Sequence + 1
		}
	}

	now := time.Now().UTC()
	item := domain.DomainEvent{
		EventID:          newUUIDv7String(),
		CompanyID:        input.CompanyID,
		StreamType:       input.StreamType,
		StreamID:         input.StreamID,
		Sequence:         sequence,
		Type:             input.Type,
		ActorUserID:      domainEventStringPtr(input.ActorUserID),
		IdempotencyKey:   input.IdempotencyKey,
		Payload:          cloneDomainEventPayload(input.Payload),
		CreatedTimestamp: now,
	}
	r.domainEvents[domainEventMemoryKey(item.CompanyID, item.EventID)] = item
	r.updateWorkspaceReadVersionsLocked(item)
	return cloneDomainEvent(item), nil
}

func (r *MemoryRepo) appendDomainEventsLocked(inputs []DomainEventInput) ([]domain.DomainEvent, error) {
	events := make([]domain.DomainEvent, 0, len(inputs))
	for _, input := range inputs {
		event, err := r.appendDomainEventLocked(input)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, nil
}
func (r *MemoryRepo) ListPendingDomainEvents(limit int) ([]domain.DomainEvent, error) {
	limit = NormalizeDomainEventListLimit(limit)

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.DomainEvent, 0)
	for _, item := range r.domainEvents {
		if item.PublishedTimestamp != nil {
			continue
		}
		items = append(items, cloneDomainEvent(item))
	}
	slices.SortFunc(items, func(a, b domain.DomainEvent) int {
		if a.CreatedTimestamp.Before(b.CreatedTimestamp) {
			return -1
		}
		if a.CreatedTimestamp.After(b.CreatedTimestamp) {
			return 1
		}
		if a.CompanyID != b.CompanyID {
			return strings.Compare(a.CompanyID, b.CompanyID)
		}
		return strings.Compare(a.EventID, b.EventID)
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *MemoryRepo) ListDomainEventsAfter(query DomainEventReplayQuery) ([]domain.DomainEvent, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.StreamType = strings.TrimSpace(query.StreamType)
	query.StreamID = strings.TrimSpace(query.StreamID)
	query.Limit = NormalizeDomainEventListLimit(query.Limit)
	if query.CompanyID == "" || query.StreamType == "" || query.StreamID == "" || query.AfterSequence < 0 {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.DomainEvent, 0)
	for _, item := range r.domainEvents {
		if item.CompanyID != query.CompanyID || item.StreamType != query.StreamType || item.StreamID != query.StreamID || item.Sequence <= query.AfterSequence {
			continue
		}
		items = append(items, cloneDomainEvent(item))
	}
	slices.SortFunc(items, func(a, b domain.DomainEvent) int {
		if a.Sequence < b.Sequence {
			return -1
		}
		if a.Sequence > b.Sequence {
			return 1
		}
		return strings.Compare(a.EventID, b.EventID)
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) ListDomainEventsForNotificationProjection(query DomainEventNotificationProjectionQuery) ([]domain.DomainEvent, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.AfterEventID = strings.TrimSpace(query.AfterEventID)
	query.Limit = NormalizeDomainEventListLimit(query.Limit)
	if query.CompanyID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.DomainEvent, 0)
	for _, item := range r.domainEvents {
		if item.CompanyID != query.CompanyID {
			continue
		}
		if !query.AfterCreatedTimestamp.IsZero() {
			if item.CreatedTimestamp.Before(query.AfterCreatedTimestamp) {
				continue
			}
			if item.CreatedTimestamp.Equal(query.AfterCreatedTimestamp) && strings.Compare(item.EventID, query.AfterEventID) <= 0 {
				continue
			}
		}
		items = append(items, cloneDomainEvent(item))
	}
	slices.SortFunc(items, func(a, b domain.DomainEvent) int {
		if a.CreatedTimestamp.Before(b.CreatedTimestamp) {
			return -1
		}
		if a.CreatedTimestamp.After(b.CreatedTimestamp) {
			return 1
		}
		return strings.Compare(a.EventID, b.EventID)
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) LatestDomainEventForNotificationProjection(companyID string) (NotificationDomainEventCheckpoint, bool, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return NotificationDomainEventCheckpoint{}, false, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	var checkpoint NotificationDomainEventCheckpoint
	found := false
	for _, item := range r.domainEvents {
		if item.CompanyID != companyID {
			continue
		}
		if !found || item.CreatedTimestamp.After(checkpoint.CreatedTimestamp) || (item.CreatedTimestamp.Equal(checkpoint.CreatedTimestamp) && strings.Compare(item.EventID, checkpoint.EventID) > 0) {
			checkpoint = NotificationDomainEventCheckpoint{
				CompanyID:        item.CompanyID,
				CreatedTimestamp: item.CreatedTimestamp,
				EventID:          item.EventID,
			}
			found = true
		}
	}
	return checkpoint, found, nil
}
func (r *MemoryRepo) CurrentDomainEventSequence(query DomainEventStreamQuery) (int64, error) {
	query, err := normalizeDomainEventStreamQuery(query)
	if err != nil {
		return 0, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	var sequence int64
	for _, item := range r.domainEvents {
		if domainEventMatchesStreamQuery(item, query) && item.Sequence > sequence {
			sequence = item.Sequence
		}
	}
	return sequence, nil
}

func (r *MemoryRepo) DomainEventExistsByIdempotencyKey(companyID, idempotencyKey string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if companyID == "" || idempotencyKey == "" {
		return false, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, item := range r.domainEvents {
		if item.CompanyID == companyID && item.IdempotencyKey == idempotencyKey {
			return true, nil
		}
	}
	return false, nil
}

func (r *MemoryRepo) updateWorkspaceReadVersionsLocked(event domain.DomainEvent) {
	if !isWorkspaceStreamDomainEvent(event) {
		return
	}
	if r.workspaceReadVersions == nil {
		r.workspaceReadVersions = map[string]int64{}
	}
	for _, row := range WorkspaceReadVersionStaticRows(event.CompanyID) {
		key := workspaceReadVersionMemoryKey(row.CompanyID, row.Scope, row.ResourceKey)
		if _, ok := r.workspaceReadVersions[key]; !ok {
			r.workspaceReadVersions[key] = 0
		}
	}
	for _, row := range workspaceReadVersionRowsForDomainEvent(event) {
		key := workspaceReadVersionMemoryKey(row.CompanyID, row.Scope, row.ResourceKey)
		if event.Sequence > r.workspaceReadVersions[key] {
			r.workspaceReadVersions[key] = event.Sequence
		}
	}
	userIDs := r.effectiveUsersForWorkspaceEventLocked(event)
	for _, userID := range userIDs {
		for _, row := range WorkspaceReadVersionStaticRows(event.CompanyID) {
			key := workspaceReadVersionMemoryKey(row.CompanyID, row.Scope, WorkspaceReadVersionUserResourceKey(userID, row.ResourceKey))
			if _, ok := r.workspaceReadVersions[key]; !ok {
				r.workspaceReadVersions[key] = 0
			}
		}
		for _, row := range workspaceReadVersionRowsForDomainEvent(event) {
			key := workspaceReadVersionMemoryKey(row.CompanyID, row.Scope, WorkspaceReadVersionUserResourceKey(userID, row.ResourceKey))
			if event.Sequence > r.workspaceReadVersions[key] {
				r.workspaceReadVersions[key] = event.Sequence
			}
		}
	}
}

func (r *MemoryRepo) CurrentWorkspaceReadVersion(query WorkspaceReadVersionQuery) (int64, bool, error) {
	query, err := NormalizeWorkspaceReadVersionQuery(query)
	if err != nil {
		return 0, false, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	version, ok := r.workspaceReadVersions[workspaceReadVersionMemoryKey(query.CompanyID, query.Scope, WorkspaceReadVersionUserResourceKey(query.UserID, query.ResourceKey))]
	return version, ok, nil
}

func (r *MemoryRepo) MarkDomainEventPublished(companyID, eventID string) error {
	companyID = strings.TrimSpace(companyID)
	eventID = strings.TrimSpace(eventID)
	if companyID == "" || eventID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	key := domainEventMemoryKey(companyID, eventID)
	item, ok := r.domainEvents[key]
	if !ok {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.PublishedTimestamp = &now
	r.domainEvents[key] = item
	return nil
}
