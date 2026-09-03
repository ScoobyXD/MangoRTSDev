package store

import (
	"maps"
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

	beforeDomainEvents := maps.Clone(r.domainEvents)
	beforeNodeCompletionTransitions := maps.Clone(r.nodeCompletionTransitions)
	beforeWorkspaceReadVersions := maps.Clone(r.workspaceReadVersions)
	beforeOutbox := maps.Clone(r.realtimeOutbox)
	beforeOutboxSequence := r.realtimeOutboxSequence
	restore := func() {
		r.domainEvents = beforeDomainEvents
		r.nodeCompletionTransitions = beforeNodeCompletionTransitions
		r.workspaceReadVersions = beforeWorkspaceReadVersions
		r.realtimeOutbox = beforeOutbox
		r.realtimeOutboxSequence = beforeOutboxSequence
	}

	if input.IdempotencyKey != "" {
		for _, existing := range r.domainEvents {
			if existing.CompanyID == input.CompanyID && existing.IdempotencyKey == input.IdempotencyKey {
				if err := r.enqueueProcessWorkRealtimeForDomainEventLocked(existing); err != nil {
					restore()
					return domain.DomainEvent{}, err
				}
				if err := r.enqueueProcessMapRealtimeForDomainEventsLocked([]domain.DomainEvent{existing}); err != nil {
					restore()
					return domain.DomainEvent{}, err
				}
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
	r.applyNodeCompletionTransitionUpdatesLocked([]domain.DomainEvent{item})
	r.updateWorkspaceReadVersionsLocked(item)
	r.updateLogicGateWorkReadVersionsLocked(item)
	if err := r.enqueueProcessWorkRealtimeForDomainEventLocked(item); err != nil {
		restore()
		return domain.DomainEvent{}, err
	}
	if err := r.enqueueProcessMapRealtimeForDomainEventsLocked([]domain.DomainEvent{item}); err != nil {
		restore()
		return domain.DomainEvent{}, err
	}
	return cloneDomainEvent(item), nil
}

func (r *MemoryRepo) appendDomainEventsLocked(inputs []DomainEventInput) ([]domain.DomainEvent, error) {
	beforeDomainEvents := maps.Clone(r.domainEvents)
	beforeNodeCompletionTransitions := maps.Clone(r.nodeCompletionTransitions)
	beforeWorkspaceReadVersions := maps.Clone(r.workspaceReadVersions)
	beforeOutbox := maps.Clone(r.realtimeOutbox)
	beforeOutboxSequence := r.realtimeOutboxSequence
	restore := func() {
		r.domainEvents = beforeDomainEvents
		r.nodeCompletionTransitions = beforeNodeCompletionTransitions
		r.workspaceReadVersions = beforeWorkspaceReadVersions
		r.realtimeOutbox = beforeOutbox
		r.realtimeOutboxSequence = beforeOutboxSequence
	}
	events := make([]domain.DomainEvent, 0, len(inputs))
	for _, input := range inputs {
		event, err := r.appendDomainEventLocked(input)
		if err != nil {
			restore()
			return nil, err
		}
		events = append(events, event)
	}
	// Individual appends must be atomic when called alone, but a multi-event
	// product mutation is one delivery unit. Replace its provisional rows with
	// one coalesced event per exact Process scope before the logical commit.
	r.realtimeOutbox = maps.Clone(beforeOutbox)
	r.realtimeOutboxSequence = beforeOutboxSequence
	if err := r.enqueueProcessWorkRealtimeForDomainEventsLocked(events); err != nil {
		restore()
		return nil, err
	}
	if err := r.enqueueProcessMapRealtimeForDomainEventsLocked(events); err != nil {
		restore()
		return nil, err
	}
	return events, nil
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

}

func (r *MemoryRepo) bumpLogicGateWorkReadVersionLocked(companyID, logicGateID string) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return
	}
	if r.workspaceReadVersions == nil {
		r.workspaceReadVersions = map[string]int64{}
	}
	versionKey := logicGateWorkReadVersionMemoryKey(companyID, logicGateID)
	r.workspaceReadVersions[versionKey]++
}

func (r *MemoryRepo) updateLogicGateWorkReadVersionsLocked(event domain.DomainEvent) {
	if !isWorkspaceStreamDomainEvent(event) {
		return
	}
	logicGateIDs := map[string]bool{}
	addLogicGateID := func(logicGateID string) {
		logicGateID = strings.TrimSpace(logicGateID)
		if logicGateID != "" {
			logicGateIDs[logicGateID] = true
		}
	}
	addLogicGateID(workspaceEventPayloadString(event.Payload, "logic_gate_id"))
	addLogicGateID(workspaceEventPayloadString(event.Payload, "source_logic_gate_id"))

	nodeID := workspaceEventPayloadString(event.Payload, "node_id")
	if nodeID != "" {
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID == event.CompanyID && assignment.NodeID == nodeID {
				addLogicGateID(assignment.LogicGateID)
			}
		}
	}

	eventType := strings.TrimSpace(event.Type)
	changedFolderID := ""
	if stringInList(eventType, CompanyExplorerFolderWorkspaceEventTypes) {
		changedFolderID = workspaceEventPayloadString(event.Payload, "folder_id")
		if changedFolderID == "" && workspaceEventPayloadString(event.Payload, "resource_type") == EntityTypeCompanyExplorerFolder {
			changedFolderID = workspaceEventPayloadString(event.Payload, "resource_id")
		}
		folderKind := workspaceEventPayloadString(event.Payload, "folder_kind")
		if folder, ok := r.folders[key(event.CompanyID, changedFolderID)]; ok {
			folderKind = folder.FolderKind
		}
		if folderKind == "communications" {
			changedFolderID = ""
		}
	}
	bumpAll := false
	if stringInList(eventType, CompanyExplorerFolderItemWorkspaceEventTypes) {
		targetType := workspaceEventPayloadString(event.Payload, "target_type")
		if targetType == "" || targetType == EntityTypeLogicGate {
			bumpAll = true
		}
	}
	if (stringInList(eventType, LogicGateListWorkspaceEventTypes) || stringInList(eventType, NodeListWorkspaceEventTypes)) && len(logicGateIDs) == 0 {
		bumpAll = true
	}
	if bumpAll || changedFolderID != "" {
		for _, logicGate := range r.logicGates {
			if logicGate.CompanyID != event.CompanyID {
				continue
			}
			if bumpAll {
				addLogicGateID(logicGate.LogicGateID)
				continue
			}
			for _, ancestor := range r.resourcePermissionAncestorsLocked(event.CompanyID, EntityTypeLogicGate, logicGate.LogicGateID) {
				if ancestor.ResourceType == EntityTypeCompanyExplorerFolder && ancestor.ResourceID == changedFolderID {
					addLogicGateID(logicGate.LogicGateID)
					break
				}
			}
		}
	}
	for logicGateID := range logicGateIDs {
		r.bumpLogicGateWorkReadVersionLocked(event.CompanyID, logicGateID)
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
