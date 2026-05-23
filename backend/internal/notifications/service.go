package notifications

import (
	"context"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"regexp"
	"strings"
)

type Service struct {
	Repo store.Repository
}

type notificationRecipientMeta struct {
	Surface     string
	Role        string
	LogicGateID string
	NodeID      string
}

func NewService(repo store.Repository) *Service {
	return &Service{Repo: repo}
}

func (s *Service) RecordAndProcess(input store.NotificationEventInput) ([]domain.Notification, error) {
	event, err := s.Repo.CreateNotificationEvent(input)
	if err != nil {
		return nil, err
	}
	notifications, err := s.ProcessEvent(event)
	if err != nil {
		return nil, err
	}
	if err := s.Repo.MarkNotificationEventProcessed(event.EventID); err != nil {
		return notifications, err
	}
	return notifications, nil
}

func (s *Service) ProcessPending(limit int) ([]domain.Notification, error) {
	events, err := s.Repo.ListPendingNotificationEvents(limit)
	if err != nil {
		return nil, err
	}
	all := make([]domain.Notification, 0)
	for _, event := range events {
		notifications, err := s.ProcessEvent(event)
		if err != nil {
			return all, err
		}
		if err := s.Repo.MarkNotificationEventProcessed(event.EventID); err != nil {
			return all, err
		}
		all = append(all, notifications...)
	}
	return all, nil
}

func (s *Service) ProcessEvent(event domain.NotificationEvent) ([]domain.Notification, error) {
	candidates, err := s.notificationCandidates(event)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return []domain.Notification{}, nil
	}
	return s.Repo.CreateNotifications(store.CreateNotificationsInput{Notifications: candidates})
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

func (s *Service) notificationCandidates(event domain.NotificationEvent) ([]store.NotificationCreateInput, error) {
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
	addRecipients := func(userIDs []string, meta notificationRecipientMeta) {
		for _, userID := range userIDs {
			addRecipient(userID, meta)
		}
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

	title := "Mango notification"
	body := payloadString(payload, "body_preview")
	notificationType := event.Type

	switch event.Type {
	case domain.NotificationEventLogicGateStateChanged:
		logicGateID := payloadString(payload, "logic_gate_id")
		if logicGateID == "" {
			logicGateID = event.EntityID
		}
		if err := addLogicGateRecipients(logicGateID, payloadString(payload, "node_id")); err != nil {
			return nil, err
		}
		toColumn := payloadString(payload, "column_title")
		nodeTitle := payloadString(payload, "node_title")
		if toColumn == "" {
			toColumn = "a new state"
		}
		actorLabel := payloadString(payload, "actor_display_name")
		if actorLabel == "" {
			actorLabel = "Someone"
		}
		title = "Node status changed to " + toColumn
		if nodeTitle != "" {
			body = fmt.Sprintf("%s changed %s to %s.", actorLabel, nodeTitle, toColumn)
		} else {
			body = fmt.Sprintf("%s changed this node to %s.", actorLabel, toColumn)
		}
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
		title = "Node assigned to you in Others"
		body = nodeTitle + " is now in your ACIO Others column."
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
		switch event.EntityType {
		case "logic_gate":
			roles, _ := s.logicGateRaciRecipientRoles(event.CompanyID, event.EntityID)
			if err := addEffectiveRecipientSubset(store.EntityTypeLogicGate, event.EntityID, mentionedUserIDs, func(userID string) notificationRecipientMeta {
				return notificationMetaForLogicGateRole(roles[strings.TrimSpace(userID)], event.EntityID, "")
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
			metas := map[string]notificationRecipientMeta{}
			firstLogicGateID := firstCleanString(node.LogicGateIDs)
			if node.AssigneeUserID != nil {
				userID := strings.TrimSpace(*node.AssigneeUserID)
				metas[userID] = mergeNotificationRecipientMeta(metas[userID], notificationRecipientMeta{Surface: domain.NotificationSurfaceACIInbox, Role: domain.NotificationRoleOther, LogicGateID: firstLogicGateID, NodeID: node.NodeID})
			}
			for _, logicGateID := range cleanStrings(node.LogicGateIDs) {
				roles, roleErr := s.logicGateRaciRecipientRoles(event.CompanyID, logicGateID)
				if roleErr != nil {
					continue
				}
				for userID, role := range roles {
					metas[userID] = mergeNotificationRecipientMeta(metas[userID], notificationMetaForLogicGateRole(role, logicGateID, node.NodeID))
				}
			}
			if err := addEffectiveRecipientSubset(store.EntityTypeNode, node.NodeID, mentionedUserIDs, func(userID string) notificationRecipientMeta {
				return metas[strings.TrimSpace(userID)]
			}); err != nil {
				return nil, err
			}
		default:
			target, ok := store.NotificationPrimaryAccessTarget(event.EntityType, event.EntityID, "", "")
			if ok {
				if err := addEffectiveRecipientSubset(target.EntityType, target.EntityID, mentionedUserIDs, func(string) notificationRecipientMeta {
					return notificationRecipientMeta{}
				}); err != nil {
					return nil, err
				}
			} else {
				addRecipients(mentionedUserIDs, notificationRecipientMeta{})
			}
		}
		actorLabel := payloadString(payload, "actor_display_name")
		if actorLabel == "" {
			actorLabel = "Someone"
		}
		title = actorLabel + " mentioned you"
		body = compactPreview(payloadString(payload, "comment"), 180)
	case domain.NotificationEventACIInboxChanged:
		return []store.NotificationCreateInput{}, nil
	case domain.NotificationEventACIInboxRaciUpdated:
		return []store.NotificationCreateInput{}, nil
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
		})
	}
	return items, nil
}

func notificationEventFromDomainEvent(event domain.DomainEvent) (domain.NotificationEvent, bool) {
	switch event.Type {
	case store.WorkItemLogicGateAssignmentSavedEventType,
		store.WorkItemLogicGateAssignmentMovedEventType,
		store.WorkItemLogicGateAssignmentRemovedEventType,
		store.WorkItemLogicGateIssueToggledEventType:
	default:
		return domain.NotificationEvent{}, false
	}
	payload := event.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	logicGateID := payloadString(payload, "logic_gate_id")
	actorUserID := ""
	if event.ActorUserID != nil {
		actorUserID = strings.TrimSpace(*event.ActorUserID)
	}
	if actorUserID == "" {
		actorUserID = payloadString(payload, "actor_user_id")
	}
	out := domain.NotificationEvent{
		EventID:          strings.TrimSpace(event.EventID),
		CompanyID:        strings.TrimSpace(event.CompanyID),
		Type:             strings.TrimSpace(event.Type),
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGateID,
		IdempotencyKey:   event.IdempotencyKey,
		Payload:          payload,
		CreatedTimestamp: event.CreatedTimestamp,
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
	companyID = strings.TrimSpace(companyID)
	text = strings.TrimSpace(text)
	if companyID == "" || text == "" || !strings.Contains(text, "@") {
		return []string{}, nil
	}
	users, err := s.Repo.ListCompanyUsers(companyID)
	if err != nil {
		return nil, err
	}
	mentioned := make([]string, 0)
	seen := map[string]struct{}{}
	for _, user := range users {
		for _, alias := range mentionAliases(user) {
			if alias == "" || !containsMentionAlias(text, alias) {
				continue
			}
			if _, ok := seen[user.UserID]; !ok {
				seen[user.UserID] = struct{}{}
				mentioned = append(mentioned, user.UserID)
			}
			break
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
	pattern := `(?i)(^|[^A-Za-z0-9_@.-])@` + regexp.QuoteMeta(alias) + `($|[^A-Za-z0-9_@.-])`
	return regexp.MustCompile(pattern).FindStringIndex(text) != nil
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
		for _, assignment := range folder.RaciAssignments {
			userID := strings.TrimSpace(assignment.UserID)
			if userID == "" {
				continue
			}
			out[userID] = mergeRaciRole(out[userID], assignment.Role)
		}
		return out, nil
	}
	return map[string]string{}, nil
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

func notificationMetaForNode(node domain.Node) notificationRecipientMeta {
	return notificationRecipientMeta{
		Surface:     domain.NotificationSurfaceACIInbox,
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
	next.Surface = strings.TrimSpace(next.Surface)
	next.Role = normalizeNotificationRole(next.Role)
	next.LogicGateID = strings.TrimSpace(next.LogicGateID)
	next.NodeID = strings.TrimSpace(next.NodeID)
	if current.Surface == "" && current.Role == "" && current.LogicGateID == "" && current.NodeID == "" {
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
