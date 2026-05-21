package notifications

import (
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
	addLogicGateRecipients := func(logicGateID, nodeID string) error {
		roles, err := s.logicGateRaciRecipientRoles(event.CompanyID, logicGateID)
		if err != nil {
			return err
		}
		for userID, role := range roles {
			addRecipient(userID, notificationMetaForLogicGateRole(role, logicGateID, nodeID))
		}
		return nil
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
	case domain.NotificationEventLogicGateRaciUpdated:
		logicGateID := payloadString(payload, "logic_gate_id")
		if logicGateID == "" {
			logicGateID = event.EntityID
		}
		assignmentUserIDs := payloadStringSlice(payload, "assignment_user_ids")
		roles, err := s.logicGateRaciRecipientRoles(event.CompanyID, logicGateID)
		if err == nil && len(roles) > 0 {
			for _, userID := range assignmentUserIDs {
				addRecipient(userID, notificationMetaForLogicGateRole(roles[strings.TrimSpace(userID)], logicGateID, ""))
			}
		} else {
			addRecipients(assignmentUserIDs, notificationRecipientMeta{LogicGateID: logicGateID})
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
		addRecipients(payloadStringSlice(payload, "recipient_user_ids"), notificationMetaForNode(node))
		if len(recipients) == 0 && node.AssigneeUserID != nil {
			addRecipient(*node.AssigneeUserID, notificationMetaForNode(node))
		}
		nodeTitle := strings.TrimSpace(node.Title)
		if nodeTitle == "" {
			nodeTitle = "a node"
		}
		title = "Node assigned to you"
		body = nodeTitle + " was assigned to you."
	case domain.NotificationEventNodeFieldsChanged:
		node, err := s.Repo.GetNode(event.CompanyID, event.EntityID)
		if err != nil {
			return nil, err
		}
		addRecipients(payloadStringSlice(payload, "recipient_user_ids"), notificationMetaForNode(node))
		if len(recipients) == 0 && node.AssigneeUserID != nil {
			addRecipient(*node.AssigneeUserID, notificationMetaForNode(node))
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
			addRecipient(*node.AssigneeUserID, notificationRecipientMeta{Surface: domain.NotificationSurfaceRInbox, Role: domain.LogicGateRaciRoleResponsible, LogicGateID: firstLogicGateID, NodeID: node.NodeID})
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
			for _, userID := range mentionedUserIDs {
				addRecipient(userID, notificationMetaForLogicGateRole(roles[strings.TrimSpace(userID)], event.EntityID, ""))
			}
		case "node":
			node, err := s.Repo.GetNode(event.CompanyID, event.EntityID)
			if err != nil {
				addRecipients(mentionedUserIDs, notificationRecipientMeta{})
				break
			}
			metas := map[string]notificationRecipientMeta{}
			firstLogicGateID := firstCleanString(node.LogicGateIDs)
			if node.AssigneeUserID != nil {
				userID := strings.TrimSpace(*node.AssigneeUserID)
				metas[userID] = mergeNotificationRecipientMeta(metas[userID], notificationRecipientMeta{Surface: domain.NotificationSurfaceRInbox, Role: domain.LogicGateRaciRoleResponsible, LogicGateID: firstLogicGateID, NodeID: node.NodeID})
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
			for _, userID := range mentionedUserIDs {
				addRecipient(userID, metas[strings.TrimSpace(userID)])
			}
		default:
			addRecipients(mentionedUserIDs, notificationRecipientMeta{})
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
		allowed, err := s.recipientCanSeeNotification(event, userID, meta)
		if err != nil {
			return nil, err
		}
		if !allowed {
			continue
		}
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

func (s *Service) recipientCanSeeNotification(event domain.NotificationEvent, userID string, meta notificationRecipientMeta) (bool, error) {
	companyID := strings.TrimSpace(event.CompanyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return true, nil
	}
	targets := store.NotificationAccessTargets(event.EntityType, event.EntityID, meta.LogicGateID, meta.NodeID)
	for _, target := range targets {
		allowed, err := s.Repo.UserCanAccessEntity(companyID, target.EntityType, target.EntityID, userID, store.EntityPermissionView)
		if errors.Is(err, store.ErrNotFound) || errors.Is(err, store.ErrInvalid) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if !allowed {
			return false, nil
		}
	}
	return true, nil
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
	role = normalizeRaciRole(role)
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
	}
	return meta
}

func notificationMetaForNode(node domain.Node) notificationRecipientMeta {
	return notificationRecipientMeta{
		Surface:     domain.NotificationSurfaceRInbox,
		Role:        domain.LogicGateRaciRoleResponsible,
		LogicGateID: firstCleanString(node.LogicGateIDs),
		NodeID:      node.NodeID,
	}
}

func mergeNotificationRecipientMeta(current, next notificationRecipientMeta) notificationRecipientMeta {
	current.Surface = strings.TrimSpace(current.Surface)
	current.Role = normalizeRaciRole(current.Role)
	current.LogicGateID = strings.TrimSpace(current.LogicGateID)
	current.NodeID = strings.TrimSpace(current.NodeID)
	next.Surface = strings.TrimSpace(next.Surface)
	next.Role = normalizeRaciRole(next.Role)
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
	current = normalizeRaciRole(current)
	next = normalizeRaciRole(next)
	if raciRoleRank(next) > raciRoleRank(current) {
		return next
	}
	return current
}

func normalizeRaciRole(role string) string {
	switch strings.TrimSpace(role) {
	case domain.LogicGateRaciRoleResponsible:
		return domain.LogicGateRaciRoleResponsible
	case domain.LogicGateRaciRoleAccountable:
		return domain.LogicGateRaciRoleAccountable
	case domain.LogicGateRaciRoleConsulted:
		return domain.LogicGateRaciRoleConsulted
	case domain.LogicGateRaciRoleInformed:
		return domain.LogicGateRaciRoleInformed
	default:
		return ""
	}
}

func raciRoleRank(role string) int {
	switch normalizeRaciRole(role) {
	case domain.LogicGateRaciRoleResponsible:
		return 4
	case domain.LogicGateRaciRoleAccountable:
		return 3
	case domain.LogicGateRaciRoleConsulted:
		return 2
	case domain.LogicGateRaciRoleInformed:
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
