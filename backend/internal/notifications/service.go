package notifications

import (
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"regexp"
	"strings"
)

type Service struct {
	Repo store.Repository
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

	recipients := map[string]struct{}{}
	addRecipient := func(userID string) {
		userID = strings.TrimSpace(userID)
		if userID == "" || userID == actorID {
			return
		}
		recipients[userID] = struct{}{}
	}
	addRecipients := func(userIDs []string) {
		for _, userID := range userIDs {
			addRecipient(userID)
		}
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
		userIDs, err := s.logicGateRaciRecipientIDs(event.CompanyID, logicGateID)
		if err != nil {
			return nil, err
		}
		addRecipients(userIDs)
		toColumn := payloadString(payload, "column_title")
		fromColumn := payloadString(payload, "previous_column_title")
		nodeTitle := payloadString(payload, "node_title")
		if toColumn == "" {
			toColumn = "a new state"
		}
		title = "Logic Gate item moved to " + toColumn
		if nodeTitle != "" && fromColumn != "" {
			body = fmt.Sprintf("%s moved from %s to %s.", nodeTitle, fromColumn, toColumn)
		} else if nodeTitle != "" {
			body = fmt.Sprintf("%s moved to %s.", nodeTitle, toColumn)
		}
	case domain.NotificationEventLogicGateRaciUpdated:
		addRecipients(payloadStringSlice(payload, "assignment_user_ids"))
		gateTitle := payloadString(payload, "logic_gate_title")
		if gateTitle == "" {
			gateTitle = "a Logic Gate"
		}
		title = "Logic Gate responsibilities updated"
		body = "Your responsibility assignment changed on " + gateTitle + "."
	case domain.NotificationEventNodeCommentCreated:
		node, err := s.Repo.GetNode(event.CompanyID, event.EntityID)
		if err != nil {
			return nil, err
		}
		if node.AssigneeUserID != nil {
			addRecipient(*node.AssigneeUserID)
		}
		for _, logicGateID := range node.LogicGateIDs {
			userIDs, err := s.logicGateRaciRecipientIDs(event.CompanyID, logicGateID)
			if err != nil {
				return nil, err
			}
			addRecipients(userIDs)
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
		addRecipients(payloadStringSlice(payload, "mentioned_user_ids"))
		actorLabel := payloadString(payload, "actor_display_name")
		if actorLabel == "" {
			actorLabel = "Someone"
		}
		title = actorLabel + " mentioned you"
		body = compactPreview(payloadString(payload, "comment"), 180)
	case domain.NotificationEventACIInboxChanged:
		addRecipients(payloadStringSlice(payload, "recipient_user_ids"))
		if folderID := payloadString(payload, "folder_id"); folderID != "" {
			userIDs, err := s.sharedInboxRaciRecipientIDs(event.CompanyID, folderID)
			if err != nil {
				return nil, err
			}
			addRecipients(userIDs)
		}
		title = "ACI inbox changed"
		if body == "" {
			body = payloadString(payload, "change_summary")
		}
	case domain.NotificationEventACIInboxRaciUpdated:
		addRecipients(payloadStringSlice(payload, "assignment_user_ids"))
		folderName := payloadString(payload, "folder_name")
		if folderName == "" {
			folderName = "a shared inbox"
		}
		title = "Shared inbox responsibilities updated"
		body = "Your responsibility assignment changed on " + folderName + "."
	default:
		return nil, nil
	}

	items := make([]store.NotificationCreateInput, 0, len(recipients))
	for userID := range recipients {
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
		})
	}
	return items, nil
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
