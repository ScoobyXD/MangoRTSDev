package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func cloneNodeTimelineEvent(item domain.NodeTimelineEvent) domain.NodeTimelineEvent {
	item.VerificationRecipients = append([]domain.NodeTimelineVerificationRecipient{}, item.VerificationRecipients...)
	for index := range item.VerificationRecipients {
		if completed := item.VerificationRecipients[index].CompletedTimestamp; completed != nil {
			value := *completed
			item.VerificationRecipients[index].CompletedTimestamp = &value
		}
	}
	return item
}

func sortNodeTimelineEvents(items []domain.NodeTimelineEvent) {
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.After(items[j].CreatedTimestamp)
		}
		return items[i].EventID > items[j].EventID
	})
}

func nodeTimelineVerificationIdempotencyKey(companyID, nodeID, idempotencyKey string) string {
	return strings.Join([]string{strings.TrimSpace(companyID), strings.TrimSpace(nodeID), strings.TrimSpace(idempotencyKey)}, ":")
}

func (r *MemoryRepo) ListNodeTimelineEvents(companyID, nodeID string) ([]domain.NodeTimelineEvent, error) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return nil, ErrNotFound
	}
	items := make([]domain.NodeTimelineEvent, 0)
	for _, item := range r.nodeTimelineEvents {
		if item.CompanyID == companyID && item.NodeID == nodeID {
			items = append(items, cloneNodeTimelineEvent(item))
		}
	}
	sortNodeTimelineEvents(items)
	return items, nil
}

func (r *MemoryRepo) CreateNodeVerificationRequest(input NodeVerificationRequestInput) (NodeTimelineMutationResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.NodeID == "" || input.ActorUserID == "" || input.IdempotencyKey == "" {
		return NodeTimelineMutationResult{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	node, ok := r.nodes[key(input.CompanyID, input.NodeID)]
	if !ok {
		return NodeTimelineMutationResult{}, ErrNotFound
	}
	seenKey := nodeTimelineVerificationIdempotencyKey(input.CompanyID, input.NodeID, input.IdempotencyKey)
	if eventID := r.nodeTimelineVerificationSeen[seenKey]; eventID != "" {
		return NodeTimelineMutationResult{TimelineEvent: cloneNodeTimelineEvent(r.nodeTimelineEvents[key(input.CompanyID, eventID)])}, nil
	}

	recipientsByUser := map[string]domain.NodeTimelineVerificationRecipient{}
	now := time.Now().UTC()
	for _, assignment := range r.gvicEffectiveAssignmentsForResourceLocked(input.CompanyID, EntityTypeNode, input.NodeID) {
		userID := strings.TrimSpace(assignment.UserID)
		if assignment.Role != domain.RACIRoleAccountable || userID == "" {
			continue
		}
		displayName := strings.TrimSpace(assignment.UserDisplayName)
		if displayName == "" {
			displayName = strings.TrimSpace(assignment.UserEmail)
		}
		if displayName == "" {
			displayName = "Unknown user"
		}
		recipientsByUser[userID] = domain.NodeTimelineVerificationRecipient{
			CompanyID: input.CompanyID, NodeID: input.NodeID, UserID: userID,
			UserDisplayName: displayName, CreatedTimestamp: now,
		}
	}
	if len(recipientsByUser) == 0 {
		return NodeTimelineMutationResult{}, ErrNoVerificationRecipients
	}

	actorDisplayName := "Unknown user"
	if actor, ok := r.companyUserByIDLocked(input.CompanyID, input.ActorUserID); ok {
		actorDisplayName = strings.TrimSpace(actor.DisplayName)
		if actorDisplayName == "" {
			actorDisplayName = strings.TrimSpace(actor.Email)
		}
	}
	eventID := newUUIDv7String()
	recipients := make([]domain.NodeTimelineVerificationRecipient, 0, len(recipientsByUser))
	recipientUserIDs := make([]string, 0, len(recipientsByUser))
	for userID, recipient := range recipientsByUser {
		recipient.EventID = eventID
		recipients = append(recipients, recipient)
		recipientUserIDs = append(recipientUserIDs, userID)
	}
	sort.Slice(recipients, func(i, j int) bool { return recipients[i].UserDisplayName < recipients[j].UserDisplayName })
	sort.Strings(recipientUserIDs)
	timelineEvent := domain.NodeTimelineEvent{
		EventID: eventID, CompanyID: input.CompanyID, NodeID: input.NodeID,
		Type:        domain.NodeTimelineEventVerificationRequest,
		ActorUserID: input.ActorUserID, ActorDisplayName: actorDisplayName,
		IdempotencyKey: input.IdempotencyKey, VerificationRecipients: recipients,
		CreatedTimestamp: now,
	}
	events, err := r.appendDomainEventsLocked([]DomainEventInput{{
		CompanyID: input.CompanyID, StreamType: EntityTypeNode, StreamID: input.NodeID,
		Type: NodeVerificationRequestedWorkspaceEventType, ActorUserID: input.ActorUserID,
		IdempotencyKey: "node-verification-request:" + input.IdempotencyKey,
		Payload: map[string]any{
			"timeline_event_id": eventID, "node_id": input.NodeID, "node_title": strings.TrimSpace(node.Title),
			"actor_display_name": actorDisplayName, "recipient_user_ids": recipientUserIDs,
		},
	}})
	if err != nil {
		return NodeTimelineMutationResult{}, err
	}
	r.nodeTimelineEvents[key(input.CompanyID, eventID)] = timelineEvent
	r.nodeTimelineVerificationSeen[seenKey] = eventID
	return NodeTimelineMutationResult{TimelineEvent: cloneNodeTimelineEvent(timelineEvent), Events: events}, nil
}

func (r *MemoryRepo) CompleteNodeVerificationRequest(input NodeVerificationCompletionInput) (domain.NodeTimelineEvent, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.EventID = strings.TrimSpace(input.EventID)
	input.UserID = strings.TrimSpace(input.UserID)
	if input.CompanyID == "" || input.NodeID == "" || input.EventID == "" || input.UserID == "" {
		return domain.NodeTimelineEvent{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	mapKey := key(input.CompanyID, input.EventID)
	item, ok := r.nodeTimelineEvents[mapKey]
	if !ok || item.NodeID != input.NodeID || item.Type != domain.NodeTimelineEventVerificationRequest {
		return domain.NodeTimelineEvent{}, ErrNotFound
	}
	for index := range item.VerificationRecipients {
		if item.VerificationRecipients[index].UserID != input.UserID {
			continue
		}
		if item.VerificationRecipients[index].CompletedTimestamp == nil {
			now := time.Now().UTC()
			item.VerificationRecipients[index].CompletedTimestamp = &now
			r.nodeTimelineEvents[mapKey] = item
		}
		return cloneNodeTimelineEvent(item), nil
	}
	return domain.NodeTimelineEvent{}, ErrNotFound
}

func (r *MemoryRepo) appendLogicGateTransferTimelineEventLocked(companyID, nodeID, actorUserID, fromLogicGateID, toLogicGateID string, createdTimestamp time.Time) domain.NodeTimelineEvent {
	actorDisplayName := "Unknown user"
	if actor, ok := r.companyUserByIDLocked(companyID, actorUserID); ok {
		actorDisplayName = strings.TrimSpace(actor.DisplayName)
		if actorDisplayName == "" {
			actorDisplayName = strings.TrimSpace(actor.Email)
		}
	}
	fromName, toName := "Deleted logic gate", "Deleted logic gate"
	if gate, ok := r.logicGates[key(companyID, fromLogicGateID)]; ok {
		fromName = strings.TrimSpace(gate.Header)
	}
	if gate, ok := r.logicGates[key(companyID, toLogicGateID)]; ok {
		toName = strings.TrimSpace(gate.Header)
	}
	item := domain.NodeTimelineEvent{
		EventID: newUUIDv7String(), CompanyID: companyID, NodeID: nodeID,
		Type:        domain.NodeTimelineEventLogicGateTransfer,
		ActorUserID: actorUserID, ActorDisplayName: actorDisplayName,
		FromLogicGateID: fromLogicGateID, FromLogicGateName: fromName,
		ToLogicGateID: toLogicGateID, ToLogicGateName: toName,
		VerificationRecipients: []domain.NodeTimelineVerificationRecipient{}, CreatedTimestamp: createdTimestamp,
	}
	r.nodeTimelineEvents[key(companyID, item.EventID)] = item
	return item
}
