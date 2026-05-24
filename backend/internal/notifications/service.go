package notifications

import (
	"context"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"regexp"
	"sort"
	"strings"
)

type Service struct {
	Repo store.Repository
}

const DefaultDomainEventReplayLimit = 100

var mentionUserIDAttributePattern = regexp.MustCompile(`(?i)data-mango-mention-user-id\s*=\s*(?:\\?["']([^"'\\]+)\\?["']|([^\s>]+))`)

type DomainEventReplayResult struct {
	ProcessedEvents      int
	CreatedNotifications int
	LastCheckpoint       store.NotificationDomainEventCheckpoint
}

type notificationRecipientMeta struct {
	Surface       string
	Role          string
	LogicGateID   string
	NodeID        string
	InformationID string
}

type notificationProjectionEvent struct {
	EventID     string
	CompanyID   string
	ActorUserID *string
	Type        string
	EntityType  string
	EntityID    string
	Payload     map[string]any
}

func NewService(repo store.Repository) *Service {
	return &Service{Repo: repo}
}

func (s *Service) ProcessDomainEvents(ctx context.Context, events []domain.DomainEvent) ([]domain.Notification, error) {
	all := make([]domain.Notification, 0)
	for _, event := range events {
		if ctx != nil {
			if err := ctx.Err(); err != nil {
				return all, err
			}
		}
		items, err := s.ProcessDomainEvent(ctx, event)
		if err != nil {
			return all, err
		}
		all = append(all, items...)
	}
	return all, nil
}

func (s *Service) ProcessDomainEvent(ctx context.Context, event domain.DomainEvent) ([]domain.Notification, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
	}
	notificationEvent, ok := notificationEventFromDomainEvent(event)
	if !ok {
		return []domain.Notification{}, nil
	}
	candidates, err := s.notificationCandidates(notificationEvent)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return []domain.Notification{}, nil
	}
	return s.Repo.CreateNotifications(store.CreateNotificationsInput{Notifications: candidates})
}

func (s *Service) InitializeDomainEventCheckpoint(ctx context.Context, companyID string) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return store.ErrInvalid
	}
	if _, ok, err := s.Repo.GetNotificationDomainEventCheckpoint(companyID); err != nil || ok {
		return err
	}
	checkpoint, ok, err := s.Repo.LatestDomainEventForNotificationProjection(companyID)
	if err != nil || !ok {
		return err
	}
	return s.Repo.SaveNotificationDomainEventCheckpoint(checkpoint)
}

func (s *Service) ReplayDomainEvents(ctx context.Context, companyID string, limit int) (DomainEventReplayResult, []domain.Notification, error) {
	result := DomainEventReplayResult{}
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return result, nil, store.ErrInvalid
	}
	if limit <= 0 || limit > store.DomainEventListMaxLimit {
		limit = DefaultDomainEventReplayLimit
	}
	checkpoint, ok, err := s.Repo.GetNotificationDomainEventCheckpoint(companyID)
	if err != nil {
		return result, nil, err
	}
	if !ok {
		checkpoint = store.NotificationDomainEventCheckpoint{CompanyID: companyID}
	}

	events, err := s.Repo.ListDomainEventsForNotificationProjection(store.DomainEventNotificationProjectionQuery{
		CompanyID:             companyID,
		AfterCreatedTimestamp: checkpoint.CreatedTimestamp,
		AfterEventID:          checkpoint.EventID,
		Limit:                 limit,
	})
	if err != nil {
		return result, nil, err
	}
	all := make([]domain.Notification, 0)
	for _, event := range events {
		if ctx != nil {
			if err := ctx.Err(); err != nil {
				return result, all, err
			}
		}
		items, err := s.ProcessDomainEvent(ctx, event)
		if err != nil {
			return result, all, err
		}
		checkpoint = store.NotificationDomainEventCheckpoint{
			CompanyID:        event.CompanyID,
			CreatedTimestamp: event.CreatedTimestamp,
			EventID:          event.EventID,
		}
		if err := s.Repo.SaveNotificationDomainEventCheckpoint(checkpoint); err != nil {
			return result, all, err
		}
		result.ProcessedEvents++
		result.CreatedNotifications += len(items)
		result.LastCheckpoint = checkpoint
		all = append(all, items...)
	}
	if result.LastCheckpoint.CompanyID == "" {
		result.LastCheckpoint = checkpoint
	}
	return result, all, nil
}

func (s *Service) notificationCandidates(event notificationProjectionEvent) ([]store.NotificationCreateInput, error) {
	actorID := ""
	if event.ActorUserID != nil {
		actorID = strings.TrimSpace(*event.ActorUserID)
	}
	payload := event.Payload
	if payload == nil {
		payload = map[string]any{}
	}

	recipients := map[string]notificationRecipientMeta{}
	addRecipient := func(userID string, meta notificationRecipientMeta) {
		userID = strings.TrimSpace(userID)
		if userID == "" || userID == actorID {
			return
		}
		recipients[userID] = mergeNotificationRecipientMeta(recipients[userID], meta)
	}
	addEffectiveRecipients := func(resourceType, resourceID string, metaForUser func(string) notificationRecipientMeta) error {
		userIDs, err := s.notificationEffectiveUsers(event.CompanyID, resourceType, resourceID)
		if err != nil {
			return err
		}
		for _, userID := range userIDs {
			addRecipient(userID, metaForUser(userID))
		}
		return nil
	}
	addEffectiveRecipientSubset := func(resourceType, resourceID string, userIDs []string, metaForUser func(string) notificationRecipientMeta) error {
		eligible, err := s.notificationEffectiveUserSet(event.CompanyID, resourceType, resourceID)
		if err != nil {
			return err
		}
		for _, userID := range cleanStrings(userIDs) {
			if eligible[userID] {
				addRecipient(userID, metaForUser(userID))
			}
		}
		return nil
	}
	addLogicGateRecipients := func(logicGateID, nodeID string) error {
		roles, err := s.logicGateRaciRecipientRoles(event.CompanyID, logicGateID)
		if err != nil {
			return err
		}
		return addEffectiveRecipients(store.EntityTypeLogicGate, logicGateID, func(userID string) notificationRecipientMeta {
			return notificationMetaForEffectiveLogicGateUser(roles[strings.TrimSpace(userID)], logicGateID, nodeID)
		})
	}
	addLogicGateWorkRecipients := func(logicGateID, nodeID string) error {
		roles, err := s.logicGateRaciRecipientRoles(event.CompanyID, logicGateID)
		if err != nil {
			return err
		}
		return addEffectiveRecipients(store.EntityTypeLogicGate, logicGateID, func(userID string) notificationRecipientMeta {
			return notificationMetaForEffectiveLogicGateUser(roles[strings.TrimSpace(userID)], logicGateID, nodeID)
		})
	}
	addSharedTriageFolderRecipients := func(folderID string) error {
		roles, err := s.sharedInboxRaciRecipientRoles(event.CompanyID, folderID)
		if err != nil {
			return err
		}
		return addEffectiveRecipients(store.EntityTypeSharedTriageFolder, folderID, func(userID string) notificationRecipientMeta {
			return notificationMetaForSharedInboxRole(roles[strings.TrimSpace(userID)])
		})
	}

	title := "Mango notification"
	body := payloadString(payload, "body_preview")
	notificationType := event.Type

	switch event.Type {
	case store.WorkItemLogicGateAssignmentSavedEventType,
		store.WorkItemLogicGateAssignmentMovedEventType,
		store.WorkItemLogicGateAssignmentRemovedEventType,
		store.WorkItemLogicGateIssueToggledEventType:
		logicGateID := payloadString(payload, "logic_gate_id")
		if logicGateID == "" {
			logicGateID = event.EntityID
		}
		nodeID := payloadString(payload, "node_id")
		if err := addLogicGateWorkRecipients(logicGateID, nodeID); err != nil {
			return nil, err
		}
		nodeTitle := payloadString(payload, "node_title")
		if nodeTitle == "" {
			nodeTitle = s.notificationNodeTitle(event.CompanyID, nodeID)
		}
		if nodeTitle == "" {
			nodeTitle = "This node"
		}
		status := payloadString(payload, "status")
		if status == "" {
			if statusKey := payloadString(payload, "status_key"); statusKey != "" {
				status = store.LogicGateWorkStatusTitle(statusKey)
			}
		}
		switch event.Type {
		case store.WorkItemLogicGateAssignmentSavedEventType:
			title = "Node added to Logic Gate work"
			if status != "" {
				body = fmt.Sprintf("%s was added in %s.", nodeTitle, status)
			} else {
				body = nodeTitle + " was added to Logic Gate work."
			}
		case store.WorkItemLogicGateAssignmentMovedEventType:
			if status == "" {
				status = "a new state"
			}
			title = "Node status changed to " + status
			body = fmt.Sprintf("%s moved to %s.", nodeTitle, status)
		case store.WorkItemLogicGateAssignmentRemovedEventType:
			title = "Node removed from Logic Gate work"
			body = nodeTitle + " was removed from Logic Gate work."
		case store.WorkItemLogicGateIssueToggledEventType:
			isIssue, ok := payloadBool(payload, "is_issue")
			if ok && isIssue {
				title = "Node marked as an issue"
				body = nodeTitle + " was marked as an issue."
			} else if ok {
				title = "Node issue cleared"
				body = nodeTitle + " is no longer marked as an issue."
			} else {
				title = "Node issue state changed"
				body = nodeTitle + " issue state changed."
			}
		}
	case domain.NotificationEventLogicGateRaciUpdated:
		logicGateID := payloadString(payload, "logic_gate_id")
		if logicGateID == "" {
			logicGateID = event.EntityID
		}
		assignmentUserIDs := payloadStringSlice(payload, "assignment_user_ids")
		roles, err := s.logicGateRaciRecipientRoles(event.CompanyID, logicGateID)
		if err == nil && len(roles) > 0 {
			if err := addEffectiveRecipientSubset(store.EntityTypeLogicGate, logicGateID, assignmentUserIDs, func(userID string) notificationRecipientMeta {
				return notificationMetaForLogicGateRole(roles[strings.TrimSpace(userID)], logicGateID, "")
			}); err != nil {
				return nil, err
			}
		} else {
			if err := addEffectiveRecipientSubset(store.EntityTypeLogicGate, logicGateID, assignmentUserIDs, func(string) notificationRecipientMeta {
				return notificationRecipientMeta{LogicGateID: logicGateID}
			}); err != nil {
				return nil, err
			}
		}
		gateTitle := payloadString(payload, "logic_gate_title")
		if gateTitle == "" {
			gateTitle = "a Logic Gate"
		}
		title = "Logic Gate assigned to you"
		body = "You were assigned to " + gateTitle + "."
	case domain.NotificationEventNodeAssigned:
		node, err := s.Repo.GetNode(event.CompanyID, event.EntityID)
		if err != nil {
			return nil, err
		}
		recipientUserIDs := payloadStringSlice(payload, "recipient_user_ids")
		if len(recipientUserIDs) == 0 && node.AssigneeUserID != nil {
			recipientUserIDs = []string{*node.AssigneeUserID}
		}
		if err := addEffectiveRecipientSubset(store.EntityTypeNode, node.NodeID, recipientUserIDs, func(string) notificationRecipientMeta {
			return notificationMetaForNode(node)
		}); err != nil {
			return nil, err
		}
		nodeTitle := strings.TrimSpace(node.Title)
		if nodeTitle == "" {
			nodeTitle = "a node"
		}
		title = "Node assigned to you"
		body = nodeTitle + " is now in your triage."
	case domain.NotificationEventNodeFieldsChanged:
		node, err := s.Repo.GetNode(event.CompanyID, event.EntityID)
		if err != nil {
			return nil, err
		}
		recipientUserIDs := payloadStringSlice(payload, "recipient_user_ids")
		if len(recipientUserIDs) == 0 && node.AssigneeUserID != nil {
			recipientUserIDs = []string{*node.AssigneeUserID}
		}
		if err := addEffectiveRecipientSubset(store.EntityTypeNode, node.NodeID, recipientUserIDs, func(string) notificationRecipientMeta {
			return notificationMetaForNode(node)
		}); err != nil {
			return nil, err
		}
		nodeTitle := strings.TrimSpace(node.Title)
		if nodeTitle == "" {
			nodeTitle = "A node"
		}
		changedFields := payloadStringSlice(payload, "changed_fields")
		if len(changedFields) == 0 {
			changedFields = []string{"details"}
		}
		actorLabel := payloadString(payload, "actor_display_name")
		if actorLabel == "" {
			actorLabel = "Someone"
		}
		if stringSliceContains(changedFields, "status") {
			status := payloadString(payload, "status")
			if status == "" {
				status = "a new status"
			}
			title = "Node status changed to " + status
			body = fmt.Sprintf("%s changed %s to %s.", actorLabel, nodeTitle, status)
		} else {
			title = "Assigned node updated"
			body = nodeTitle + " changed: " + strings.Join(changedFields, ", ") + "."
		}
	case domain.NotificationEventNodeCommentCreated:
		node, err := s.Repo.GetNode(event.CompanyID, event.EntityID)
		if err != nil {
			return nil, err
		}
		firstLogicGateID := firstCleanString(node.LogicGateIDs)
		if node.AssigneeUserID != nil {
			if err := addEffectiveRecipientSubset(store.EntityTypeNode, node.NodeID, []string{*node.AssigneeUserID}, func(string) notificationRecipientMeta {
				return notificationRecipientMeta{Surface: domain.NotificationSurfaceACIInbox, Role: domain.NotificationRoleOther, LogicGateID: firstLogicGateID, NodeID: node.NodeID}
			}); err != nil {
				return nil, err
			}
		}
		for _, logicGateID := range cleanStrings(node.LogicGateIDs) {
			if err := addLogicGateRecipients(logicGateID, node.NodeID); err != nil {
				return nil, err
			}
		}
		for _, mentionedUserID := range payloadStringSlice(payload, "mentioned_user_ids") {
			delete(recipients, mentionedUserID)
		}
		nodeTitle := strings.TrimSpace(node.Title)
		if nodeTitle == "" {
			nodeTitle = "a node"
		}
		title = "New comment on " + nodeTitle
		body = compactPreview(payloadString(payload, "comment"), 180)
	case domain.NotificationEventMentionCreated:
		mentionedUserIDs := payloadStringSlice(payload, "mentioned_user_ids")
		informationID := payloadString(payload, "information_id")
		entityTitle := ""
		switch event.EntityType {
		case "logic_gate":
			if gate, err := s.Repo.GetLogicGate(event.CompanyID, event.EntityID); err == nil {
				entityTitle = strings.TrimSpace(gate.Header)
			}
			if entityTitle == "" {
				entityTitle = "a logic gate"
			}
			if err := addEffectiveRecipientSubset(store.EntityTypeLogicGate, event.EntityID, mentionedUserIDs, func(userID string) notificationRecipientMeta {
				return notificationRecipientMeta{LogicGateID: event.EntityID}
			}); err != nil {
				return nil, err
			}
		case "node":
			node, err := s.Repo.GetNode(event.CompanyID, event.EntityID)
			if err != nil {
				target, ok := store.NotificationPrimaryAccessTarget(event.EntityType, event.EntityID, "", "")
				if ok {
					if err := addEffectiveRecipientSubset(target.EntityType, target.EntityID, mentionedUserIDs, func(string) notificationRecipientMeta {
						return notificationRecipientMeta{}
					}); err != nil {
						return nil, err
					}
				}
				break
			}
			entityTitle = strings.TrimSpace(node.Title)
			if entityTitle == "" {
				entityTitle = "a node"
			}
			if err := addEffectiveRecipientSubset(store.EntityTypeNode, node.NodeID, mentionedUserIDs, func(userID string) notificationRecipientMeta {
				return notificationRecipientMeta{NodeID: node.NodeID}
			}); err != nil {
				return nil, err
			}
		default:
			return []store.NotificationCreateInput{}, nil
		}
		actorLabel := payloadString(payload, "actor_display_name")
		if actorLabel == "" {
			actorLabel = "Someone"
		}
		if entityTitle != "" {
			title = actorLabel + " " + entityTitle
		} else {
			title = actorLabel + " mentioned you"
		}
		body = compactPreview(payloadString(payload, "comment"), 180)
		for userID, meta := range recipients {
			meta.InformationID = informationID
			recipients[userID] = meta
		}
	case domain.NotificationEventACIInboxChanged:
		folderID := payloadString(payload, "folder_id")
		if folderID == "" {
			folderID = event.EntityID
		}
		if err := addSharedTriageFolderRecipients(folderID); err != nil {
			return nil, err
		}
		title = "Shared inbox access updated"
		body = "Shared inbox access changed."
	case domain.NotificationEventACIInboxRaciUpdated:
		folderID := payloadString(payload, "folder_id")
		if folderID == "" {
			folderID = event.EntityID
		}
		if err := addSharedTriageFolderRecipients(folderID); err != nil {
			return nil, err
		}
		title = "Shared inbox RACI updated"
		body = "Shared inbox routing roles changed."
	default:
		return nil, nil
	}

	items := make([]store.NotificationCreateInput, 0, len(recipients))
	for userID, meta := range recipients {
		items = append(items, store.NotificationCreateInput{
			CompanyID:       event.CompanyID,
			RecipientUserID: userID,
			ActorUserID:     actorID,
			Type:            notificationType,
			SourceEventID:   event.EventID,
			EntityType:      event.EntityType,
			EntityID:        event.EntityID,
			Title:           title,
			BodyPreview:     compactPreview(body, 240),
			Surface:         meta.Surface,
			Role:            meta.Role,
			LogicGateID:     meta.LogicGateID,
			NodeID:          meta.NodeID,
			InformationID:   meta.InformationID,
		})
	}
	return items, nil
}

func notificationEventFromDomainEvent(event domain.DomainEvent) (notificationProjectionEvent, bool) {
	payload := event.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	notificationType := ""
	entityType := ""
	entityID := ""
	switch event.Type {
	case store.WorkItemLogicGateAssignmentSavedEventType,
		store.WorkItemLogicGateAssignmentMovedEventType,
		store.WorkItemLogicGateAssignmentRemovedEventType,
		store.WorkItemLogicGateIssueToggledEventType:
		notificationType = strings.TrimSpace(event.Type)
		entityType = store.EntityTypeLogicGate
		entityID = payloadString(payload, "logic_gate_id")
	case store.NodeMentionCreatedEventType:
		notificationType = domain.NotificationEventMentionCreated
		entityType = store.EntityTypeNode
		entityID = payloadString(payload, "node_id")
		if entityID == "" {
			entityID = payloadString(payload, "entity_id")
		}
	case store.LogicGateMentionCreatedEventType:
		notificationType = domain.NotificationEventMentionCreated
		entityType = store.EntityTypeLogicGate
		entityID = payloadString(payload, "logic_gate_id")
		if entityID == "" {
			entityID = payloadString(payload, "entity_id")
		}
	case store.LogicGateRaciUpdatedEventType:
		notificationType = domain.NotificationEventLogicGateRaciUpdated
		entityType = store.EntityTypeLogicGate
		entityID = payloadString(payload, "logic_gate_id")
	case "node_updated":
		switch mapped := payloadString(payload, "notification_event_type"); mapped {
		case domain.NotificationEventNodeAssigned, domain.NotificationEventNodeFieldsChanged:
			notificationType = mapped
			entityType = store.EntityTypeNode
			entityID = payloadString(payload, "node_id")
		default:
			return notificationProjectionEvent{}, false
		}
	case "communications_shared_inbox_raci_updated":
		notificationType = domain.NotificationEventACIInboxRaciUpdated
		entityType = store.EntityTypeSharedTriageFolder
		entityID = payloadString(payload, "folder_id")
	case "shared_triage_access_updated":
		notificationType = domain.NotificationEventACIInboxChanged
		entityType = store.EntityTypeSharedTriageFolder
		entityID = payloadString(payload, "folder_id")
	default:
		return notificationProjectionEvent{}, false
	}
	if strings.TrimSpace(notificationType) == "" || strings.TrimSpace(entityType) == "" || strings.TrimSpace(entityID) == "" {
		return notificationProjectionEvent{}, false
	}
	actorUserID := ""
	if event.ActorUserID != nil {
		actorUserID = strings.TrimSpace(*event.ActorUserID)
	}
	if actorUserID == "" {
		actorUserID = payloadString(payload, "actor_user_id")
	}
	out := notificationProjectionEvent{
		EventID:    strings.TrimSpace(event.EventID),
		CompanyID:  strings.TrimSpace(event.CompanyID),
		Type:       notificationType,
		EntityType: entityType,
		EntityID:   entityID,
		Payload:    payload,
	}
	if actorUserID != "" {
		out.ActorUserID = &actorUserID
	}
	return out, true
}

func logicGateWorkNotificationTargets(logicGateID, nodeID string) []store.NotificationAccessTarget {
	targets := make([]store.NotificationAccessTarget, 0, 2)
	seen := map[string]bool{}
	add := func(entityType, entityID string) {
		entityType, ok := store.NormalizeEntityType(entityType)
		entityID = strings.TrimSpace(entityID)
		if !ok || entityID == "" {
			return
		}
		key := entityType + "\x00" + entityID
		if seen[key] {
			return
		}
		seen[key] = true
		targets = append(targets, store.NotificationAccessTarget{EntityType: entityType, EntityID: entityID})
	}
	add(store.EntityTypeLogicGate, logicGateID)
	add(store.EntityTypeNode, nodeID)
	return targets
}

func (s *Service) notificationNodeTitle(companyID, nodeID string) string {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return ""
	}
	node, err := s.Repo.GetNode(companyID, nodeID)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(node.Title)
}

func (s *Service) notificationEffectiveUsers(companyID, resourceType, resourceID string) ([]string, error) {
	companyID = strings.TrimSpace(companyID)
	resourceID = strings.TrimSpace(resourceID)
	resourceType, ok := store.NormalizeEntityType(resourceType)
	if companyID == "" || resourceID == "" || !ok {
		return []string{}, nil
	}
	userIDs, err := s.Repo.ListEffectiveUsersForResource(companyID, resourceType, resourceID, store.EntityPermissionView)
	if errors.Is(err, store.ErrInvalid) || errors.Is(err, store.ErrNotFound) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	return cleanStrings(userIDs), nil
}

func (s *Service) notificationEffectiveUserSet(companyID, resourceType, resourceID string) (map[string]bool, error) {
	userIDs, err := s.notificationEffectiveUsers(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(userIDs))
	for _, userID := range userIDs {
		out[userID] = true
	}
	return out, nil
}

func (s *Service) ResolveMentionedUserIDs(companyID, text string) ([]string, error) {
	occurrences, err := s.ResolveMentionedUserIDOccurrences(companyID, text)
	if err != nil {
		return nil, err
	}
	mentioned := make([]string, 0, len(occurrences))
	seen := map[string]struct{}{}
	for _, userID := range occurrences {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		seen[userID] = struct{}{}
		mentioned = append(mentioned, userID)
	}
	return mentioned, nil
}

func (s *Service) ResolveMentionedUserIDOccurrences(companyID, text string) ([]string, error) {
	companyID = strings.TrimSpace(companyID)
	text = strings.TrimSpace(text)
	if companyID == "" || text == "" || !strings.Contains(text, "@") {
		return []string{}, nil
	}
	mentioned := make([]string, 0)
	attributeCountsByUserID := map[string]int{}
	addMentionedUserID := func(userID string) {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			return
		}
		mentioned = append(mentioned, userID)
	}
	for _, match := range mentionUserIDAttributePattern.FindAllStringSubmatch(text, -1) {
		userID := ""
		if len(match) > 1 && strings.TrimSpace(match[1]) != "" {
			userID = strings.TrimSpace(match[1])
		} else if len(match) > 2 {
			userID = strings.TrimSpace(match[2])
		}
		if userID != "" {
			addMentionedUserID(userID)
			attributeCountsByUserID[userID]++
		}
	}

	users, err := s.Repo.ListMentionableCompanyUsers(companyID)
	if err != nil {
		return nil, err
	}
	for _, user := range users {
		userID := strings.TrimSpace(user.UserID)
		if userID == "" || attributeCountsByUserID[userID] > 0 {
			continue
		}
		for range mentionAliasOccurrenceStarts(text, mentionAliases(user)) {
			addMentionedUserID(userID)
		}
	}
	return mentioned, nil
}

func mentionAliases(user domain.CompanyUser) []string {
	aliases := []string{
		strings.TrimSpace(user.DisplayName),
		strings.ReplaceAll(strings.TrimSpace(user.DisplayName), " ", ""),
		strings.TrimSpace(user.Email),
	}
	if at := strings.Index(user.Email, "@"); at > 0 {
		aliases = append(aliases, strings.TrimSpace(user.Email[:at]))
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(aliases))
	for _, alias := range aliases {
		alias = strings.TrimSpace(alias)
		key := strings.ToLower(alias)
		if alias == "" || key == "@" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, alias)
	}
	return out
}

func containsMentionAlias(text, alias string) bool {
	pattern := `(?i)(^|[^A-Za-z0-9_@])@` + regexp.QuoteMeta(alias) + `($|[^A-Za-z0-9_@])`
	return regexp.MustCompile(pattern).FindStringIndex(text) != nil
}

func mentionAliasOccurrenceStarts(text string, aliases []string) []int {
	starts := map[int]struct{}{}
	for _, alias := range aliases {
		alias = strings.TrimSpace(alias)
		if alias == "" {
			continue
		}
		pattern := `(?i)(^|[^A-Za-z0-9_@])@` + regexp.QuoteMeta(alias) + `($|[^A-Za-z0-9_@])`
		for _, match := range regexp.MustCompile(pattern).FindAllStringSubmatchIndex(text, -1) {
			if len(match) < 4 || match[2] < 0 {
				continue
			}
			starts[match[2]] = struct{}{}
		}
	}
	out := make([]int, 0, len(starts))
	for start := range starts {
		out = append(out, start)
	}
	sort.Ints(out)
	return out
}

func (s *Service) logicGateRaciRecipientIDs(companyID, logicGateID string) ([]string, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return []string{}, nil
	}
	gate, err := s.Repo.GetLogicGate(companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(gate.RaciAssignments))
	for _, assignment := range gate.RaciAssignments {
		out = append(out, assignment.UserID)
	}
	return out, nil
}

func (s *Service) sharedInboxRaciRecipientIDs(companyID, folderID string) ([]string, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return []string{}, nil
	}
	folders, err := s.Repo.ListCompanyExplorerFolders(companyID, "communications")
	if err != nil {
		return nil, err
	}
	for _, folder := range folders {
		if folder.FolderID != folderID {
			continue
		}
		out := make([]string, 0, len(folder.RaciAssignments))
		for _, assignment := range folder.RaciAssignments {
			out = append(out, assignment.UserID)
		}
		return out, nil
	}
	return []string{}, nil
}

func (s *Service) logicGateRaciRecipientRoles(companyID, logicGateID string) (map[string]string, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return map[string]string{}, nil
	}
	gate, err := s.Repo.GetLogicGate(companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(gate.RaciAssignments))
	for _, assignment := range gate.RaciAssignments {
		userID := strings.TrimSpace(assignment.UserID)
		if userID == "" {
			continue
		}
		out[userID] = mergeRaciRole(out[userID], assignment.Role)
	}
	return out, nil
}

func (s *Service) sharedInboxRaciRecipientRoles(companyID, folderID string) (map[string]string, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return map[string]string{}, nil
	}
	folders, err := s.Repo.ListCompanyExplorerFolders(companyID, "communications")
	if err != nil {
		return nil, err
	}
	for _, folder := range folders {
		if folder.FolderID != folderID {
			continue
		}
		out := make(map[string]string, len(folder.RaciAssignments))
		var groupMemberIDs map[string][]string
		for _, assignment := range folder.RaciAssignments {
			subjectType := strings.TrimSpace(assignment.SubjectType)
			subjectID := strings.TrimSpace(assignment.SubjectID)
			if subjectType == "" {
				subjectType = store.EntityPermissionSubjectUser
				subjectID = strings.TrimSpace(assignment.UserID)
			}
			if subjectType == store.EntityPermissionSubjectUser && subjectID == "" {
				subjectID = strings.TrimSpace(assignment.UserID)
			}
			if subjectID == "" {
				continue
			}
			switch subjectType {
			case store.EntityPermissionSubjectUser:
				out[subjectID] = mergeRaciRole(out[subjectID], assignment.Role)
			case store.EntityPermissionSubjectGroup:
				if groupMemberIDs == nil {
					var err error
					groupMemberIDs, err = s.companyGroupMemberUserIDs(companyID)
					if err != nil {
						return nil, err
					}
				}
				for _, userID := range groupMemberIDs[subjectID] {
					out[userID] = mergeRaciRole(out[userID], assignment.Role)
				}
			}
		}
		return out, nil
	}
	return map[string]string{}, nil
}

func (s *Service) companyGroupMemberUserIDs(companyID string) (map[string][]string, error) {
	groups, err := s.Repo.ListCompanyUserGroups(companyID)
	if err != nil {
		return nil, err
	}
	members, err := s.Repo.ListCompanyUserGroupMembers(companyID)
	if err != nil {
		return nil, err
	}
	children := map[string][]string{}
	for _, group := range groups {
		if group.ParentGroupID == nil {
			continue
		}
		parentID := strings.TrimSpace(*group.ParentGroupID)
		groupID := strings.TrimSpace(group.GroupID)
		if parentID != "" && groupID != "" {
			children[parentID] = append(children[parentID], groupID)
		}
	}
	directMembers := map[string][]string{}
	for _, member := range members {
		groupID := strings.TrimSpace(member.GroupID)
		userID := strings.TrimSpace(member.UserID)
		if groupID != "" && userID != "" {
			directMembers[groupID] = append(directMembers[groupID], userID)
		}
	}
	out := map[string][]string{}
	visiting := map[string]bool{}
	var collect func(string) []string
	collect = func(groupID string) []string {
		groupID = strings.TrimSpace(groupID)
		if groupID == "" {
			return []string{}
		}
		if values, ok := out[groupID]; ok {
			return values
		}
		if visiting[groupID] {
			return []string{}
		}
		visiting[groupID] = true
		values := append([]string{}, directMembers[groupID]...)
		for _, childID := range children[groupID] {
			values = append(values, collect(childID)...)
		}
		visiting[groupID] = false
		values = cleanStrings(values)
		out[groupID] = values
		return values
	}
	for _, group := range groups {
		collect(group.GroupID)
	}
	return out, nil
}

func notificationMetaForLogicGateRole(role, logicGateID, nodeID string) notificationRecipientMeta {
	role = normalizeNotificationRole(role)
	meta := notificationRecipientMeta{
		Role:        role,
		LogicGateID: strings.TrimSpace(logicGateID),
		NodeID:      strings.TrimSpace(nodeID),
	}
	switch role {
	case domain.LogicGateRaciRoleResponsible:
		meta.Surface = domain.NotificationSurfaceRInbox
	case domain.LogicGateRaciRoleAccountable, domain.LogicGateRaciRoleConsulted, domain.LogicGateRaciRoleInformed:
		meta.Surface = domain.NotificationSurfaceACIInbox
	case domain.NotificationRoleOther:
		meta.Surface = domain.NotificationSurfaceACIInbox
	}
	return meta
}

func notificationMetaForEffectiveLogicGateUser(role, logicGateID, nodeID string) notificationRecipientMeta {
	if normalizeNotificationRole(role) == "" {
		return notificationRecipientMeta{
			Surface:     domain.NotificationSurfaceACIInbox,
			Role:        domain.NotificationRoleOther,
			LogicGateID: strings.TrimSpace(logicGateID),
			NodeID:      strings.TrimSpace(nodeID),
		}
	}
	return notificationMetaForLogicGateRole(role, logicGateID, nodeID)
}

func notificationMetaForSharedInboxRole(role string) notificationRecipientMeta {
	role = normalizeNotificationRole(role)
	if role == "" {
		role = domain.NotificationRoleOther
	}
	return notificationRecipientMeta{
		Surface: domain.NotificationSurfaceSharedTriage,
		Role:    role,
	}
}

func notificationMetaForNode(node domain.Node) notificationRecipientMeta {
	return notificationRecipientMeta{
		Surface:     domain.NotificationSurfaceMyTriage,
		Role:        domain.NotificationRoleOther,
		LogicGateID: firstCleanString(node.LogicGateIDs),
		NodeID:      node.NodeID,
	}
}

func mergeNotificationRecipientMeta(current, next notificationRecipientMeta) notificationRecipientMeta {
	current.Surface = strings.TrimSpace(current.Surface)
	current.Role = normalizeNotificationRole(current.Role)
	current.LogicGateID = strings.TrimSpace(current.LogicGateID)
	current.NodeID = strings.TrimSpace(current.NodeID)
	current.InformationID = strings.TrimSpace(current.InformationID)
	next.Surface = strings.TrimSpace(next.Surface)
	next.Role = normalizeNotificationRole(next.Role)
	next.LogicGateID = strings.TrimSpace(next.LogicGateID)
	next.NodeID = strings.TrimSpace(next.NodeID)
	next.InformationID = strings.TrimSpace(next.InformationID)
	if current.Surface == "" && current.Role == "" && current.LogicGateID == "" && current.NodeID == "" && current.InformationID == "" {
		return next
	}
	roleChanged := false
	if raciRoleRank(next.Role) > raciRoleRank(current.Role) {
		current.Role = next.Role
		roleChanged = true
	}
	if current.Surface == "" || roleChanged {
		current.Surface = next.Surface
	}
	if current.LogicGateID == "" || (roleChanged && next.LogicGateID != "") {
		current.LogicGateID = next.LogicGateID
	}
	if current.NodeID == "" || (roleChanged && next.NodeID != "") {
		current.NodeID = next.NodeID
	}
	if current.InformationID == "" {
		current.InformationID = next.InformationID
	}
	return current
}

func mergeRaciRole(current, next string) string {
	current = normalizeNotificationRole(current)
	next = normalizeNotificationRole(next)
	if raciRoleRank(next) > raciRoleRank(current) {
		return next
	}
	return current
}

func normalizeNotificationRole(role string) string {
	switch strings.TrimSpace(role) {
	case domain.LogicGateRaciRoleResponsible:
		return domain.LogicGateRaciRoleResponsible
	case domain.LogicGateRaciRoleAccountable:
		return domain.LogicGateRaciRoleAccountable
	case domain.LogicGateRaciRoleConsulted:
		return domain.LogicGateRaciRoleConsulted
	case domain.LogicGateRaciRoleInformed:
		return domain.LogicGateRaciRoleInformed
	case domain.NotificationRoleOther:
		return domain.NotificationRoleOther
	default:
		return ""
	}
}

func raciRoleRank(role string) int {
	switch normalizeNotificationRole(role) {
	case domain.LogicGateRaciRoleResponsible:
		return 5
	case domain.LogicGateRaciRoleAccountable:
		return 4
	case domain.LogicGateRaciRoleConsulted:
		return 3
	case domain.LogicGateRaciRoleInformed:
		return 2
	case domain.NotificationRoleOther:
		return 1
	default:
		return 0
	}
}

func firstCleanString(values []string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}
func payloadString(payload map[string]any, key string) string {
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func payloadStringSlice(payload map[string]any, key string) []string {
	value, ok := payload[key]
	if !ok || value == nil {
		return nil
	}
	switch typed := value.(type) {
	case []string:
		return cleanStrings(typed)
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			out = append(out, payloadValueString(item))
		}
		return cleanStrings(out)
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return cleanStrings(strings.Split(typed, ","))
	default:
		return nil
	}
}

func payloadBool(payload map[string]any, key string) (bool, bool) {
	value, ok := payload[key]
	if !ok || value == nil {
		return false, false
	}
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes", "y":
			return true, true
		case "false", "0", "no", "n":
			return false, true
		default:
			return false, false
		}
	default:
		return false, false
	}
}

func stringSliceContains(values []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, value := range values {
		if strings.TrimSpace(value) == target {
			return true
		}
	}
	return false
}

func payloadValueString(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func cleanStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func compactPreview(text string, limit int) string {
	text = strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if limit <= 0 || len([]rune(text)) <= limit {
		return text
	}
	runes := []rune(text)
	return string(runes[:limit-1]) + "..."
}
