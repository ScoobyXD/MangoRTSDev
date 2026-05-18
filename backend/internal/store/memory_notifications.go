package store

import (
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
	"time"
)

func cloneNotificationPayload(payload map[string]any) map[string]any {
	if len(payload) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(payload))
	for key, value := range payload {
		out[key] = value
	}
	return out
}

func notificationStringPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func cloneNotificationEvent(item domain.NotificationEvent) domain.NotificationEvent {
	item.Payload = cloneNotificationPayload(item.Payload)
	if item.ActorUserID != nil {
		actor := *item.ActorUserID
		item.ActorUserID = &actor
	}
	if item.ProcessedTimestamp != nil {
		processed := *item.ProcessedTimestamp
		item.ProcessedTimestamp = &processed
	}
	return item
}

func cloneNotification(item domain.Notification) domain.Notification {
	if item.ActorUserID != nil {
		actor := *item.ActorUserID
		item.ActorUserID = &actor
	}
	if item.ReadTimestamp != nil {
		read := *item.ReadTimestamp
		item.ReadTimestamp = &read
	}
	return item
}

func (r *MemoryRepo) CreateNotificationEvent(input NotificationEventInput) (domain.NotificationEvent, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.Type = strings.TrimSpace(input.Type)
	input.EntityType = strings.TrimSpace(input.EntityType)
	input.EntityID = strings.TrimSpace(input.EntityID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.Type == "" || input.EntityType == "" || input.EntityID == "" {
		return domain.NotificationEvent{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if input.IdempotencyKey != "" {
		for _, existing := range r.notificationEvents {
			if existing.IdempotencyKey == input.IdempotencyKey {
				return cloneNotificationEvent(existing), nil
			}
		}
	}

	now := time.Now().UTC()
	item := domain.NotificationEvent{
		EventID:          newUUIDv7String(),
		CompanyID:        input.CompanyID,
		ActorUserID:      notificationStringPtr(input.ActorUserID),
		Type:             input.Type,
		EntityType:       input.EntityType,
		EntityID:         input.EntityID,
		IdempotencyKey:   input.IdempotencyKey,
		Payload:          cloneNotificationPayload(input.Payload),
		CreatedTimestamp: now,
	}
	r.notificationEvents[item.EventID] = item
	return cloneNotificationEvent(item), nil
}

func (r *MemoryRepo) ListPendingNotificationEvents(limit int) ([]domain.NotificationEvent, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.NotificationEvent, 0)
	for _, item := range r.notificationEvents {
		if item.ProcessedTimestamp != nil {
			continue
		}
		items = append(items, cloneNotificationEvent(item))
	}
	slices.SortFunc(items, func(a, b domain.NotificationEvent) int {
		if a.CreatedTimestamp.Before(b.CreatedTimestamp) {
			return -1
		}
		if a.CreatedTimestamp.After(b.CreatedTimestamp) {
			return 1
		}
		return strings.Compare(a.EventID, b.EventID)
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *MemoryRepo) MarkNotificationEventProcessed(eventID string) error {
	eventID = strings.TrimSpace(eventID)
	if eventID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.notificationEvents[eventID]
	if !ok {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.ProcessedTimestamp = &now
	r.notificationEvents[eventID] = item
	return nil
}

func (r *MemoryRepo) CreateNotifications(input CreateNotificationsInput) ([]domain.Notification, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	created := make([]domain.Notification, 0, len(input.Notifications))
	for _, candidate := range input.Notifications {
		candidate.CompanyID = strings.TrimSpace(candidate.CompanyID)
		candidate.RecipientUserID = strings.TrimSpace(candidate.RecipientUserID)
		candidate.ActorUserID = strings.TrimSpace(candidate.ActorUserID)
		candidate.Type = strings.TrimSpace(candidate.Type)
		candidate.SourceEventID = strings.TrimSpace(candidate.SourceEventID)
		candidate.EntityType = strings.TrimSpace(candidate.EntityType)
		candidate.EntityID = strings.TrimSpace(candidate.EntityID)
		candidate.Title = strings.TrimSpace(candidate.Title)
		candidate.BodyPreview = strings.TrimSpace(candidate.BodyPreview)
		candidate.Surface = strings.TrimSpace(candidate.Surface)
		candidate.Role = strings.TrimSpace(candidate.Role)
		candidate.LogicGateID = strings.TrimSpace(candidate.LogicGateID)
		candidate.NodeID = strings.TrimSpace(candidate.NodeID)
		if candidate.RecipientUserID == "" || candidate.Type == "" || candidate.SourceEventID == "" || candidate.EntityType == "" || candidate.EntityID == "" || candidate.Title == "" {
			return nil, ErrInvalid
		}
		duplicate := false
		for _, existing := range r.notifications {
			if existing.RecipientUserID == candidate.RecipientUserID && existing.SourceEventID == candidate.SourceEventID && existing.Type == candidate.Type && existing.EntityType == candidate.EntityType && existing.EntityID == candidate.EntityID {
				created = append(created, cloneNotification(existing))
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		now := time.Now().UTC()
		item := domain.Notification{
			NotificationID:   newUUIDv7String(),
			CompanyID:        candidate.CompanyID,
			RecipientUserID:  candidate.RecipientUserID,
			ActorUserID:      notificationStringPtr(candidate.ActorUserID),
			Type:             candidate.Type,
			SourceEventID:    candidate.SourceEventID,
			EntityType:       candidate.EntityType,
			EntityID:         candidate.EntityID,
			Title:            candidate.Title,
			BodyPreview:      candidate.BodyPreview,
			Surface:          candidate.Surface,
			Role:             candidate.Role,
			LogicGateID:      candidate.LogicGateID,
			NodeID:           candidate.NodeID,
			CreatedTimestamp: now,
		}
		r.notifications[item.NotificationID] = item
		created = append(created, cloneNotification(item))
	}
	return created, nil
}

func (r *MemoryRepo) ListNotifications(input NotificationListInput) ([]domain.Notification, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NotificationType = strings.TrimSpace(input.NotificationType)
	if input.UserID == "" {
		return nil, ErrInvalid
	}
	limit := NormalizeNotificationListLimit(input.Limit)

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Notification, 0)
	for _, item := range r.notifications {
		if item.RecipientUserID != input.UserID {
			continue
		}
		if input.CompanyID != "" && item.CompanyID != input.CompanyID {
			continue
		}
		if input.NotificationType != "" && item.Type != input.NotificationType {
			continue
		}
		if input.UnreadOnly && item.ReadTimestamp != nil {
			continue
		}
		items = append(items, cloneNotification(item))
	}
	slices.SortFunc(items, func(a, b domain.Notification) int {
		if a.CreatedTimestamp.After(b.CreatedTimestamp) {
			return -1
		}
		if a.CreatedTimestamp.Before(b.CreatedTimestamp) {
			return 1
		}
		return strings.Compare(a.NotificationID, b.NotificationID)
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *MemoryRepo) GetNotificationSummary(input NotificationSummaryInput) (domain.NotificationSummary, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	if input.UserID == "" {
		return domain.NotificationSummary{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	summary := domain.NotificationSummary{
		CompanyID:        input.CompanyID,
		RoleCounts:       []domain.NotificationRoleCount{},
		TypeCounts:       []domain.NotificationTypeCount{},
		LogicGateCounts:  []domain.NotificationLogicGateCount{},
		UpdatedTimestamp: time.Now().UTC(),
	}
	roleCounts := map[string]domain.NotificationRoleCount{}
	typeCounts := map[string]domain.NotificationTypeCount{}
	logicGateCounts := map[string]domain.NotificationLogicGateCount{}
	for _, item := range r.notifications {
		if item.RecipientUserID != input.UserID || item.ReadTimestamp != nil {
			continue
		}
		if input.CompanyID != "" && item.CompanyID != input.CompanyID {
			continue
		}
		summary.TotalUnread++
		if item.Type != "" {
			count := typeCounts[item.Type]
			if count.Count == 0 {
				count.Type = item.Type
			}
			count.Count++
			typeCounts[item.Type] = count
		}
		if item.Surface != "" || item.Role != "" {
			key := item.Surface + "\x00" + item.Role
			count := roleCounts[key]
			if count.Count == 0 {
				count.Surface = item.Surface
				count.Role = item.Role
			}
			count.Count++
			roleCounts[key] = count
		}
		if item.LogicGateID != "" && item.Role != "" {
			key := item.LogicGateID + "\x00" + item.NodeID + "\x00" + item.Role
			count := logicGateCounts[key]
			if count.Count == 0 {
				count.LogicGateID = item.LogicGateID
				count.NodeID = item.NodeID
				count.Role = item.Role
			}
			count.Count++
			logicGateCounts[key] = count
		}
	}
	for _, count := range roleCounts {
		summary.RoleCounts = append(summary.RoleCounts, count)
	}
	for _, count := range typeCounts {
		summary.TypeCounts = append(summary.TypeCounts, count)
	}
	for _, count := range logicGateCounts {
		summary.LogicGateCounts = append(summary.LogicGateCounts, count)
	}
	slices.SortFunc(summary.RoleCounts, func(a, b domain.NotificationRoleCount) int {
		if cmp := strings.Compare(a.Surface, b.Surface); cmp != 0 {
			return cmp
		}
		return strings.Compare(a.Role, b.Role)
	})
	slices.SortFunc(summary.TypeCounts, func(a, b domain.NotificationTypeCount) int {
		return strings.Compare(a.Type, b.Type)
	})
	slices.SortFunc(summary.LogicGateCounts, func(a, b domain.NotificationLogicGateCount) int {
		if cmp := strings.Compare(a.LogicGateID, b.LogicGateID); cmp != 0 {
			return cmp
		}
		if cmp := strings.Compare(a.NodeID, b.NodeID); cmp != 0 {
			return cmp
		}
		return strings.Compare(a.Role, b.Role)
	})
	return summary, nil
}
func (r *MemoryRepo) CountUnreadNotifications(userID, companyID string) (int, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" {
		return 0, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	count := 0
	for _, item := range r.notifications {
		if item.RecipientUserID != userID || item.ReadTimestamp != nil {
			continue
		}
		if companyID != "" && item.CompanyID != companyID {
			continue
		}
		count++
	}
	return count, nil
}

func (r *MemoryRepo) MarkNotificationRead(userID, notificationID string, read bool) (domain.Notification, error) {
	userID = strings.TrimSpace(userID)
	notificationID = strings.TrimSpace(notificationID)
	if userID == "" || notificationID == "" {
		return domain.Notification{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.notifications[notificationID]
	if !ok || item.RecipientUserID != userID {
		return domain.Notification{}, ErrNotFound
	}
	if read {
		now := time.Now().UTC()
		item.ReadTimestamp = &now
	} else {
		item.ReadTimestamp = nil
	}
	r.notifications[notificationID] = item
	return cloneNotification(item), nil
}

func (r *MemoryRepo) MarkAllNotificationsRead(userID, companyID string) (int, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" {
		return 0, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	count := 0
	for id, item := range r.notifications {
		if item.RecipientUserID != userID || item.ReadTimestamp != nil {
			continue
		}
		if companyID != "" && item.CompanyID != companyID {
			continue
		}
		item.ReadTimestamp = &now
		r.notifications[id] = item
		count++
	}
	return count, nil
}
