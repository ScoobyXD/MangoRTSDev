package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	htmlpkg "html"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type realtimeNotificationCreatedMessage struct {
	Type         string              `json:"type"`
	CompanyID    string              `json:"company_id,omitempty"`
	Scope        string              `json:"scope"`
	Notification domain.Notification `json:"notification"`
	TS           time.Time           `json:"ts"`
}

type realtimeNotificationDeletedMessage struct {
	Type           string    `json:"type"`
	CompanyID      string    `json:"company_id,omitempty"`
	Scope          string    `json:"scope"`
	NotificationID string    `json:"notification_id"`
	TS             time.Time `json:"ts"`
}

type realtimeNotificationsClearedMessage struct {
	Type         string    `json:"type"`
	CompanyID    string    `json:"company_id,omitempty"`
	Scope        string    `json:"scope"`
	DeletedCount int       `json:"deleted_count"`
	TS           time.Time `json:"ts"`
}

const editorRichTextPrefix = "<!-- mango-editor-html-v1 -->"
const editorNodeTextBlockPrefix = "<!-- mango-node-text-block-v1 -->"

var (
	editorHTMLBlockBoundaryPattern = regexp.MustCompile(`(?i)</?(?:address|article|aside|blockquote|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)[^>]*>`)
	editorHTMLBreakPattern         = regexp.MustCompile(`(?i)<br\s*/?>`)
	editorHTMLTagPattern           = regexp.MustCompile(`<[^>]+>`)
)

func (s *Server) handleNotifications(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleNotificationList(w, r)
	case http.MethodDelete:
		s.handleNotificationDeleteAll(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleNotificationList(w http.ResponseWriter, r *http.Request) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
		limit = parsed
	}
	items, err := s.repo.ListNotifications(store.NotificationListInput{
		UserID:           actor.User.UserID,
		CompanyID:        strings.TrimSpace(r.URL.Query().Get("company_id")),
		NotificationType: strings.TrimSpace(r.URL.Query().Get("type")),
		UnreadOnly:       parseBoolQuery(r.URL.Query().Get("unread_only")),
		Limit:            limit,
	})
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_notifications_request")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_notifications")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"notifications": items})
}

func updatesQueryFromRequest(r *http.Request, userID, rootID string) (store.UpdatesQuery, error) {
	query := store.UpdatesQuery{
		UserID: userID, CompanyID: strings.TrimSpace(r.URL.Query().Get("company_id")),
		Filter: strings.TrimSpace(r.URL.Query().Get("filter")), RootID: strings.TrimSpace(rootID),
	}
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("view"))) {
	case "", "current":
		return query, nil
	case "seen":
		createdFrom, fromErr := time.Parse("2006-01-02", strings.TrimSpace(r.URL.Query().Get("from")))
		createdThrough, toErr := time.Parse("2006-01-02", strings.TrimSpace(r.URL.Query().Get("to")))
		if fromErr != nil || toErr != nil {
			return store.UpdatesQuery{}, store.ErrInvalid
		}
		query.SeenOnly = true
		query.CreatedFrom = createdFrom.UTC()
		query.CreatedTo = createdThrough.AddDate(0, 0, 1).UTC()
		return query, nil
	default:
		return store.UpdatesQuery{}, store.ErrInvalid
	}
}

func (s *Server) handleUpdateRootGroups(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	query, queryErr := updatesQueryFromRequest(r, actor.User.UserID, "")
	if queryErr != nil {
		writeError(w, http.StatusBadRequest, "invalid_updates_request")
		return
	}
	groups, err := s.repo.ListUpdateRootGroups(query)
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_updates_request")
		return
	}
	if err != nil {
		log.Printf("failed_to_list_update_groups user_id=%s company_id=%s filter=%s err=%v", actor.User.UserID, strings.TrimSpace(r.URL.Query().Get("company_id")), strings.TrimSpace(r.URL.Query().Get("filter")), err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_update_groups")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"groups": groups})
}

func (s *Server) handleUpdateBranch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	query, queryErr := updatesQueryFromRequest(r, actor.User.UserID, r.URL.Query().Get("root_id"))
	if queryErr != nil {
		writeError(w, http.StatusBadRequest, "invalid_updates_request")
		return
	}
	group, err := s.repo.ListUpdateBranch(query)
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_updates_request")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "update_group_not_found")
		return
	}
	if err != nil {
		log.Printf("failed_to_load_update_branch user_id=%s company_id=%s filter=%s root_id=%s err=%v", actor.User.UserID, strings.TrimSpace(r.URL.Query().Get("company_id")), strings.TrimSpace(r.URL.Query().Get("filter")), strings.TrimSpace(r.URL.Query().Get("root_id")), err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_update_branch")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"group": group})
}

func (s *Server) handleSeenUpdatesRange(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	historyRange, err := s.repo.GetSeenUpdatesRange(store.UpdatesQuery{
		UserID: actor.User.UserID, CompanyID: strings.TrimSpace(r.URL.Query().Get("company_id")),
	})
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_updates_request")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_seen_updates_range")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, historyRange)
}

func (s *Server) handleNotificationDeleteAll(w http.ResponseWriter, r *http.Request) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req struct {
		CompanyID        string `json:"company_id"`
		Type             string `json:"type"`
		NotificationType string `json:"notification_type"`
		Surface          string `json:"surface"`
		Role             string `json:"role"`
		LogicGateID      string `json:"logic_gate_id"`
		NodeID           string `json:"node_id"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	companyID := strings.TrimSpace(firstNonEmptyString(req.CompanyID, r.URL.Query().Get("company_id")))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	deleted, err := s.repo.DeleteNotifications(store.NotificationDeleteInput{
		UserID:           actor.User.UserID,
		CompanyID:        companyID,
		NotificationType: strings.TrimSpace(firstNonEmptyString(req.Type, req.NotificationType, r.URL.Query().Get("type"), r.URL.Query().Get("notification_type"))),
		Surface:          firstNonEmptyString(req.Surface, r.URL.Query().Get("surface")),
		Role:             firstNonEmptyString(req.Role, r.URL.Query().Get("role")),
		LogicGateID:      firstNonEmptyString(req.LogicGateID, r.URL.Query().Get("logic_gate_id")),
		NodeID:           firstNonEmptyString(req.NodeID, r.URL.Query().Get("node_id")),
		RealtimeMode:     store.NotificationRealtimeClear,
	})
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_notifications_request")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_notifications")
		return
	}
	s.publishNotificationsCleared(deleted)
	writeJSON(w, http.StatusOK, map[string]any{"deleted_count": len(deleted)})
}

func (s *Server) handleNotificationSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	summary, err := s.repo.GetNotificationSummary(store.NotificationSummaryInput{
		UserID:    actor.User.UserID,
		CompanyID: strings.TrimSpace(r.URL.Query().Get("company_id")),
	})
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_notifications_request")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_get_notification_summary")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, summary)
}
func (s *Server) handleNotificationUnreadCount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	count, err := s.repo.CountUnreadNotifications(actor.User.UserID, strings.TrimSpace(r.URL.Query().Get("company_id")))
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_notifications_request")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_count_notifications")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"unread_count": count})
}

func (s *Server) handleNotificationReadAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req struct {
		CompanyID        string `json:"company_id"`
		Type             string `json:"type"`
		NotificationType string `json:"notification_type"`
		Surface          string `json:"surface"`
		Role             string `json:"role"`
		LogicGateID      string `json:"logic_gate_id"`
		NodeID           string `json:"node_id"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	if req.CompanyID == "" {
		req.CompanyID = strings.TrimSpace(r.URL.Query().Get("company_id"))
	}
	notificationType := firstNonEmptyString(req.Type, req.NotificationType, r.URL.Query().Get("type"), r.URL.Query().Get("notification_type"))
	count, err := s.repo.MarkNotificationsRead(store.NotificationMarkReadInput{
		UserID:           actor.User.UserID,
		CompanyID:        strings.TrimSpace(req.CompanyID),
		NotificationType: strings.TrimSpace(notificationType),
		Surface:          firstNonEmptyString(req.Surface, r.URL.Query().Get("surface")),
		Role:             firstNonEmptyString(req.Role, r.URL.Query().Get("role")),
		LogicGateID:      firstNonEmptyString(req.LogicGateID, r.URL.Query().Get("logic_gate_id")),
		NodeID:           firstNonEmptyString(req.NodeID, r.URL.Query().Get("node_id")),
	})
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_notifications_request")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_mark_notifications_read")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated_count": count})
}

func (s *Server) handleNotificationByID(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/notifications/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 1 && strings.TrimSpace(parts[0]) != "" && r.Method == http.MethodDelete {
		s.handleNotificationDeleteByID(w, r, strings.TrimSpace(parts[0]))
		return
	}
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	read := true
	switch parts[1] {
	case "read":
		read = true
	case "unread":
		read = false
	default:
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	item, err := s.repo.MarkNotificationRead(actor.User.UserID, strings.TrimSpace(parts[0]), read)
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_notification_id")
		return
	}
	if err == store.ErrNotFound {
		writeError(w, http.StatusNotFound, "notification_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_notification")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleNotificationDeleteByID(w http.ResponseWriter, r *http.Request, notificationID string) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	deleted, err := s.repo.DeleteNotifications(store.NotificationDeleteInput{
		UserID:         actor.User.UserID,
		NotificationID: notificationID,
	})
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_notification_id")
		return
	}
	if err == store.ErrNotFound {
		writeError(w, http.StatusNotFound, "notification_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_notification")
		return
	}
	s.publishNotificationDeletions(deleted)
	writeJSON(w, http.StatusOK, map[string]any{"deleted_count": len(deleted), "notification_id": notificationID})
}

func (s *Server) projectCommittedNotificationEvents(events []domain.DomainEvent) {
	s.projectCommittedNotificationEventsWithTiming(events, nil)
}

func (s *Server) projectCommittedNotificationEventsWithTiming(events []domain.DomainEvent, timings *requestTimingRecorder) {
	stop := timings.observeAccounted("notifications.enqueue")
	events = cloneDomainEventsForAsync(events)
	stop()
	if len(events) == 0 {
		return
	}
	go s.projectCommittedNotificationEventsAsync(events)
}

func (s *Server) projectCommittedNotificationEventsAsync(events []domain.DomainEvent) {
	start := time.Now()
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("async notification projection failed count=%d event_types=%s panic=%v", len(events), domainEventTypesForLog(events), recovered)
		}
	}()
	items, err := s.notifications.ProcessDomainEventsWithTiming(context.Background(), events, nil)
	if err != nil {
		log.Printf("failed to project committed notification events asynchronously count=%d event_types=%s: %v", len(events), domainEventTypesForLog(events), err)
		return
	}
	s.publishNotificationsWithTiming(items, nil)
	duration := time.Since(start)
	log.Printf("async_notification_projection count=%d notifications=%d duration=%s notifications.total=%s event_types=%s", len(events), len(items), formatTimingDuration(duration), formatTimingDuration(duration), domainEventTypesForLog(events))
}

func (s *Server) publishNotifications(items []domain.Notification) {
	s.publishNotificationsWithTiming(items, nil)
}

func (s *Server) publishNotificationsWithTiming(items []domain.Notification, timings *requestTimingRecorder) {
	if len(items) > 0 {
		s.recordOperationalMetric("notifications.created_count", "", int64(len(items)), 0)
	}
	for _, item := range items {
		stop := timings.observe("notifications.publish.serialize")
		stop()
		stop = timings.observe("notifications.publish")
		s.publishNotificationCreatedRealtime(item)
		stop()
	}
}

func (s *Server) publishNotificationDeletions(items []domain.Notification) {
	if len(items) > 0 {
		s.recordOperationalMetric("notifications.deleted_count", "", int64(len(items)), 0)
	}
	for _, item := range items {
		s.publishNotificationDeletedRealtime(item)
	}
}

func (s *Server) publishNotificationsCleared(items []domain.Notification) {
	if len(items) > 0 {
		s.recordOperationalMetric("notifications.deleted_count", "", int64(len(items)), 0)
	}
	type clearGroup struct {
		companyID string
		userID    string
	}
	counts := map[clearGroup]int{}
	for _, item := range items {
		companyID := strings.TrimSpace(item.CompanyID)
		userID := strings.TrimSpace(item.RecipientUserID)
		if companyID == "" || userID == "" {
			continue
		}
		counts[clearGroup{companyID: companyID, userID: userID}]++
	}
	for group, count := range counts {
		s.publishNotificationsClearedRealtime(group.companyID, group.userID, count)
	}
}

func (s *Server) publishNotificationCreatedRealtime(item domain.Notification) {
	if s == nil || strings.TrimSpace(item.CompanyID) == "" || realtimeNotificationScope(item.RecipientUserID) == "" {
		return
	}
	s.wakeRealtimeSpine()
}

func (s *Server) publishNotificationDeletedRealtime(item domain.Notification) {
	if s == nil || strings.TrimSpace(item.CompanyID) == "" || strings.TrimSpace(item.NotificationID) == "" || realtimeNotificationScope(item.RecipientUserID) == "" {
		return
	}
	s.wakeRealtimeSpine()
}

func (s *Server) publishNotificationsClearedRealtime(companyID, recipientUserID string, deletedCount int) {
	if s == nil || strings.TrimSpace(companyID) == "" || realtimeNotificationScope(recipientUserID) == "" || deletedCount <= 0 {
		return
	}
	s.wakeRealtimeSpine()
}

func notificationActorPayload(r *http.Request) (string, string) {
	actor, ok := authenticatedActor(r)
	if !ok {
		return "", ""
	}
	label := strings.TrimSpace(actor.User.DisplayName)
	if label == "" {
		label = strings.TrimSpace(actor.User.Email)
	}
	return actor.User.UserID, label
}

func isMentionNotificationInformationType(infoType string) bool {
	switch strings.TrimSpace(infoType) {
	case "Text box", "Text block chat":
		return true
	default:
		return false
	}
}

func editorMentionCommentPreview(infoType, information string) string {
	return editorMentionPlainTextPreview(infoType, information)
}

func editorMentionSourceText(infoType, information string) string {
	infoType = strings.TrimSpace(infoType)
	text := strings.TrimSpace(information)
	if infoType == "Text block chat" {
		var payload struct {
			Message string `json:"message"`
		}
		if err := json.Unmarshal([]byte(text), &payload); err == nil && strings.TrimSpace(payload.Message) != "" {
			text = payload.Message
		}
	}
	if strings.HasPrefix(text, editorNodeTextBlockPrefix) {
		var payload struct {
			Title    string `json:"title"`
			Document string `json:"document"`
		}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(text, editorNodeTextBlockPrefix)), &payload); err == nil {
			if strings.TrimSpace(payload.Document) != "" {
				text = payload.Document
			} else if strings.TrimSpace(payload.Title) != "" {
				text = payload.Title
			}
		}
	}
	if strings.HasPrefix(text, editorRichTextPrefix) {
		text = strings.TrimPrefix(text, editorRichTextPrefix)
	}
	return text
}

func editorMentionPlainTextPreview(infoType, information string) string {
	text := editorMentionSourceText(infoType, information)
	text = editorHTMLBreakPattern.ReplaceAllString(text, "\n")
	text = editorHTMLBlockBoundaryPattern.ReplaceAllString(text, "\n")
	text = editorHTMLTagPattern.ReplaceAllString(text, " ")
	return normalizeEditorMentionPreviewText(htmlpkg.UnescapeString(text))
}

func normalizeEditorMentionPreviewText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.Join(strings.Fields(line), " ")
		if line != "" {
			out = append(out, line)
		}
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

func editorMentionCommentPreviewForOccurrence(infoType, information, mentionKind, userID string, occurrenceIndex int, users []domain.CompanyUser) string {
	fullPreview := editorMentionCommentPreview(infoType, information)
	if strings.TrimSpace(infoType) == "Text block chat" || occurrenceIndex < 0 {
		return fullPreview
	}
	aliases := editorMentionAliasesForUser(users, userID)
	if len(aliases) == 0 {
		return fullPreview
	}
	text := editorMentionPlainTextPreview(infoType, information)
	trigger := editorMentionTriggerForKind(mentionKind)
	starts := editorMentionAliasOccurrenceStarts(text, aliases, trigger)
	if occurrenceIndex >= len(starts) {
		return fullPreview
	}
	if line := editorMentionPreviewLineAt(text, starts[occurrenceIndex], aliases, trigger); line != "" {
		return line
	}
	return fullPreview
}

func editorMentionAliasesForUser(users []domain.CompanyUser, userID string) []string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	for _, user := range users {
		if strings.TrimSpace(user.UserID) == userID {
			return editorMentionAliases(user)
		}
	}
	return []string{userID}
}

func editorMentionAliases(user domain.CompanyUser) []string {
	aliases := []string{
		strings.TrimSpace(user.DisplayName),
		strings.ReplaceAll(strings.TrimSpace(user.DisplayName), " ", ""),
		strings.TrimSpace(user.Email),
		strings.TrimSpace(user.UserID),
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

func editorMentionTriggerForKind(mentionKind string) string {
	if strings.TrimSpace(mentionKind) == "urgent" {
		return "!"
	}
	return "@"
}

func editorMentionAliasOccurrenceStarts(text string, aliases []string, trigger string) []int {
	if trigger != "!" {
		trigger = "@"
	}
	starts := map[int]struct{}{}
	for _, alias := range aliases {
		alias = strings.TrimSpace(alias)
		if alias == "" {
			continue
		}
		pattern := `(?i)(^|[^A-Za-z0-9_@!])` + regexp.QuoteMeta(trigger) + regexp.QuoteMeta(alias) + `($|[^A-Za-z0-9_@!])`
		for _, match := range regexp.MustCompile(pattern).FindAllStringSubmatchIndex(text, -1) {
			if len(match) < 4 || match[3] < 0 {
				continue
			}
			starts[match[3]] = struct{}{}
		}
	}
	out := make([]int, 0, len(starts))
	for start := range starts {
		out = append(out, start)
	}
	sort.Ints(out)
	return out
}

func editorMentionPreviewLineAt(text string, start int, aliases []string, trigger string) string {
	if start < 0 || start > len(text) {
		return ""
	}
	lineStart := 0
	if before := strings.LastIndex(text[:start], "\n"); before >= 0 {
		lineStart = before + 1
	}
	lineEnd := len(text)
	if after := strings.Index(text[start:], "\n"); after >= 0 {
		lineEnd = start + after
	}
	line := strings.Join(strings.Fields(strings.TrimSpace(text[lineStart:lineEnd])), " ")
	if !editorMentionPreviewLineIsOnlyMention(line, aliases, trigger) {
		return line
	}
	nextLine := editorMentionNextPreviewLine(text, lineEnd)
	if nextLine == "" {
		return line
	}
	return strings.TrimSpace(line + " " + nextLine)
}

func editorMentionPreviewLineIsOnlyMention(line string, aliases []string, trigger string) bool {
	line = strings.TrimSpace(line)
	if line == "" {
		return false
	}
	if trigger != "!" {
		trigger = "@"
	}
	for _, alias := range aliases {
		alias = strings.TrimSpace(alias)
		if alias == "" {
			continue
		}
		if strings.EqualFold(line, trigger+alias) {
			return true
		}
	}
	return false
}

func editorMentionNextPreviewLine(text string, lineEnd int) string {
	cursor := lineEnd
	for cursor < len(text) {
		if text[cursor] == '\n' {
			cursor++
			continue
		}
		if text[cursor] == ' ' || text[cursor] == '\t' {
			cursor++
			continue
		}
		nextEnd := len(text)
		if after := strings.Index(text[cursor:], "\n"); after >= 0 {
			nextEnd = cursor + after
		}
		line := strings.Join(strings.Fields(strings.TrimSpace(text[cursor:nextEnd])), " ")
		if line != "" {
			return line
		}
		cursor = nextEnd + 1
	}
	return ""
}

func (s *Server) mentionNotificationEventAlreadyRecorded(companyID, idempotencyKey string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if companyID == "" || idempotencyKey == "" {
		return false, nil
	}
	return s.repo.DomainEventExistsByIdempotencyKey(companyID, idempotencyKey)
}

func (s *Server) addedEditorHTMLMentionNotificationHTML(companyID, before, after string) string {
	mentionLabels := map[string]string{}
	if users, err := s.repo.ListMentionableCompanyUsers(companyID); err == nil {
		for _, user := range users {
			userID := strings.TrimSpace(user.UserID)
			if userID == "" {
				continue
			}
			mentionLabels[userID] = firstNonEmptyString(user.DisplayName, user.Email, userID)
		}
	}

	var output strings.Builder
	for _, mentionKind := range []string{"regular", "urgent"} {
		beforeUserIDs, beforeErr := s.notifications.ResolveMentionedUserIDOccurrencesByKind(companyID, before, mentionKind)
		afterUserIDs, afterErr := s.notifications.ResolveMentionedUserIDOccurrencesByKind(companyID, after, mentionKind)
		if beforeErr != nil || afterErr != nil {
			return ""
		}
		remaining := map[string]int{}
		for _, userID := range beforeUserIDs {
			remaining[strings.TrimSpace(userID)]++
		}
		for _, userID := range afterUserIDs {
			userID = strings.TrimSpace(userID)
			if userID == "" {
				continue
			}
			if remaining[userID] > 0 {
				remaining[userID]--
				continue
			}
			if output.Len() > 0 {
				output.WriteByte(' ')
			}
			output.WriteString(`<span data-mango-mention="true" data-mango-mention-user-id="`)
			output.WriteString(htmlpkg.EscapeString(userID))
			output.WriteString(`" data-mango-mention-kind="`)
			output.WriteString(mentionKind)
			output.WriteString(`">`)
			if mentionKind == "urgent" {
				output.WriteByte('!')
			} else {
				output.WriteByte('@')
			}
			output.WriteString(htmlpkg.EscapeString(firstNonEmptyString(mentionLabels[userID], userID)))
			output.WriteString(`</span>`)
		}
	}
	return output.String()
}

func (s *Server) recordMentionNotifications(r *http.Request, companyID, entityType, entityID, informationID, infoType, information string) {
	s.recordMentionNotificationsWithIdempotencyScope(r, companyID, entityType, entityID, informationID, infoType, information, "")
}

func (s *Server) recordMentionNotificationsWithIdempotencyScope(r *http.Request, companyID, entityType, entityID, informationID, infoType, information, idempotencyScope string) {
	companyID = strings.TrimSpace(companyID)
	entityType = strings.TrimSpace(entityType)
	entityID = strings.TrimSpace(entityID)
	informationID = strings.TrimSpace(informationID)
	if companyID == "" || entityType == "" || entityID == "" || informationID == "" || !isMentionNotificationInformationType(infoType) {
		return
	}
	regularMentionedUserIDs, regularErr := s.notifications.ResolveMentionedUserIDOccurrencesByKind(companyID, information, "regular")
	urgentMentionedUserIDs, urgentErr := s.notifications.ResolveMentionedUserIDOccurrencesByKind(companyID, information, "urgent")
	if regularErr != nil || urgentErr != nil || (len(regularMentionedUserIDs) == 0 && len(urgentMentionedUserIDs) == 0) {
		return
	}
	actorUserID, actorLabel := notificationActorPayload(r)
	mentionableUsers, mentionableUsersErr := s.repo.ListMentionableCompanyUsers(companyID)
	if mentionableUsersErr != nil {
		mentionableUsers = nil
	}
	eventType := ""
	streamID := ""
	idempotencyEntityKey := ""
	payloadResourceKey := ""
	switch entityType {
	case store.EntityTypeNode:
		eventType = store.NodeMentionCreatedEventType
		streamID = "node:" + entityID
		idempotencyEntityKey = "node"
		payloadResourceKey = "node_id"
	case store.EntityTypeLogicGate:
		eventType = store.LogicGateMentionCreatedEventType
		streamID = "logic_gate:" + entityID
		idempotencyEntityKey = "logic-gate"
		payloadResourceKey = "logic_gate_id"
	case store.EntityTypeProject:
		eventType = store.ProjectMentionCreatedEventType
		streamID = "project:" + entityID
		idempotencyEntityKey = "project"
		payloadResourceKey = "project_id"
	default:
		return
	}
	events := make([]domain.DomainEvent, 0, len(regularMentionedUserIDs)+len(urgentMentionedUserIDs))
	appendMentionEvents := func(mentionedUserIDs []string, mentionKind string) bool {
		mentionKind = strings.TrimSpace(mentionKind)
		if mentionKind == "" {
			mentionKind = "regular"
		}
		mentionOccurrenceByUserID := map[string]int{}
		for _, userID := range mentionedUserIDs {
			userID = strings.TrimSpace(userID)
			if userID == "" {
				continue
			}
			occurrenceIndex := mentionOccurrenceByUserID[userID]
			mentionOccurrenceByUserID[userID] = occurrenceIndex + 1
			comment := editorMentionCommentPreviewForOccurrence(infoType, information, mentionKind, userID, occurrenceIndex, mentionableUsers)
			idempotencyKey := "mention:" + mentionKind + ":" + idempotencyEntityKey + ":" + entityID + ":" + informationID + ":" + userID + ":" + strconv.Itoa(occurrenceIndex+1)
			if idempotencyScope = strings.TrimSpace(idempotencyScope); idempotencyScope != "" {
				idempotencyKey += ":" + idempotencyScope
			}
			alreadyRecorded, err := s.mentionNotificationEventAlreadyRecorded(companyID, idempotencyKey)
			if err != nil {
				log.Printf("failed to check mention notification idempotency company_id=%s entity_type=%s entity_id=%s information_id=%s user_id=%s mention_kind=%s: %v", companyID, entityType, entityID, informationID, userID, mentionKind, err)
				return false
			}
			if alreadyRecorded {
				continue
			}
			event, err := s.repo.AppendDomainEvent(store.DomainEventInput{
				CompanyID:      companyID,
				StreamType:     "notification",
				StreamID:       streamID,
				Type:           eventType,
				ActorUserID:    actorUserID,
				IdempotencyKey: idempotencyKey,
				Payload: map[string]any{
					payloadResourceKey:   entityID,
					"entity_type":        entityType,
					"entity_id":          entityID,
					"comment":            comment,
					"information_id":     informationID,
					"information_type":   strings.TrimSpace(infoType),
					"mention_kind":       mentionKind,
					"mentioned_user_ids": []string{userID},
					"actor_display_name": actorLabel,
				},
			})
			if err != nil {
				log.Printf("failed to append mention notification domain event company_id=%s entity_type=%s entity_id=%s information_id=%s user_id=%s mention_kind=%s: %v", companyID, entityType, entityID, informationID, userID, mentionKind, err)
				return false
			}
			events = append(events, event)
		}
		return true
	}
	if !appendMentionEvents(regularMentionedUserIDs, "regular") || !appendMentionEvents(urgentMentionedUserIDs, "urgent") {
		return
	}
	if len(events) > 0 {
		s.projectCommittedNotificationEvents(events)
	}
}

func (s *Server) recordNodeChatNotification(r *http.Request, companyID, nodeID, informationID, infoType, information string) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	informationID = strings.TrimSpace(informationID)
	if companyID == "" || nodeID == "" || informationID == "" || strings.TrimSpace(infoType) != "Text block chat" {
		return
	}
	comment := editorMentionCommentPreview(infoType, information)
	if strings.TrimSpace(comment) == "" {
		return
	}
	mentionedUserIDs := []string{}
	if regularMentionedUserIDs, err := s.notifications.ResolveMentionedUserIDOccurrencesByKind(companyID, information, "regular"); err == nil {
		mentionedUserIDs = append(mentionedUserIDs, regularMentionedUserIDs...)
	}
	if urgentMentionedUserIDs, err := s.notifications.ResolveMentionedUserIDOccurrencesByKind(companyID, information, "urgent"); err == nil {
		mentionedUserIDs = append(mentionedUserIDs, urgentMentionedUserIDs...)
	}
	actorUserID, actorLabel := notificationActorPayload(r)
	event, err := s.repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:      companyID,
		StreamType:     "notification",
		StreamID:       "node:" + nodeID,
		Type:           domain.NotificationEventNodeCommentCreated,
		ActorUserID:    actorUserID,
		IdempotencyKey: "node-chat:" + nodeID + ":" + informationID,
		Payload: map[string]any{
			"node_id":            nodeID,
			"entity_type":        store.EntityTypeNode,
			"entity_id":          nodeID,
			"comment":            comment,
			"information_id":     informationID,
			"mentioned_user_ids": uniqueCleanStrings(mentionedUserIDs),
			"actor_display_name": actorLabel,
		},
	})
	if err != nil {
		log.Printf("failed to append node chat notification domain event company_id=%s node_id=%s information_id=%s: %v", companyID, nodeID, informationID, err)
		return
	}
	s.projectCommittedNotificationEvents([]domain.DomainEvent{event})
}

func uniqueCleanStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func parseBoolQuery(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "y":
		return true
	default:
		return false
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func errorsIsInvalid(err error) bool {
	return err == store.ErrInvalid
}

func logicGateGVICAssignmentUserIDs(assignments []domain.LogicGateGVICAssignment) []string {
	out := make([]string, 0, len(assignments))
	seen := map[string]struct{}{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		if userID == "" {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		seen[userID] = struct{}{}
		out = append(out, userID)
	}
	return out
}

func newlyAssignedLogicGateGVICUserIDs(before, after []domain.LogicGateGVICAssignment) []string {
	beforeRoles := highestLogicGateGVICRolesByUser(before)
	afterRoles := highestLogicGateGVICRolesByUser(after)
	out := make([]string, 0, len(afterRoles))
	for userID, role := range afterRoles {
		if role == "" || beforeRoles[userID] == role {
			continue
		}
		out = append(out, userID)
	}
	sort.Strings(out)
	return out
}

func highestLogicGateGVICRolesByUser(assignments []domain.LogicGateGVICAssignment) map[string]string {
	out := map[string]string{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		role, ok := store.NormalizeGVICRole(assignment.Role)
		if !ok || userID == "" {
			continue
		}
		if GVICNotificationRoleRank(role) > GVICNotificationRoleRank(out[userID]) {
			out[userID] = role
		}
	}
	return out
}

func GVICNotificationRoleRank(role string) int {
	switch strings.TrimSpace(role) {
	case domain.GVICRoleResponsible:
		return 4
	case domain.GVICRoleVerifier:
		return 3
	case domain.GVICRoleConsulted:
		return 2
	case domain.GVICRoleInformed:
		return 1
	default:
		return 0
	}
}

func sharedInboxGVICAssignmentUserIDs(assignments []domain.SharedInboxGVICAssignment) []string {
	out := make([]string, 0, len(assignments))
	seen := map[string]struct{}{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		if userID == "" {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		seen[userID] = struct{}{}
		out = append(out, userID)
	}
	return out
}

func logicGateGVICFingerprint(assignments []domain.LogicGateGVICAssignment) string {
	parts := make([]string, 0, len(assignments))
	for _, assignment := range assignments {
		parts = append(parts, strings.TrimSpace(assignment.Role)+":"+strings.TrimSpace(assignment.UserID))
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}

func sharedInboxGVICFingerprint(assignments []domain.SharedInboxGVICAssignment) string {
	parts := make([]string, 0, len(assignments))
	for _, assignment := range assignments {
		principalType := strings.TrimSpace(assignment.PrincipalType)
		principalID := strings.TrimSpace(assignment.PrincipalID)
		if principalType == "" {
			principalType = "user"
			principalID = strings.TrimSpace(assignment.UserID)
		}
		parts = append(parts, strings.TrimSpace(assignment.Role)+":"+principalType+":"+principalID)
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}

// recordEmailCollaborationExplicitMentionNotifications runs after participant
// snapshots and node edit grants have committed, but before the legacy alias
// resolver. It gives group-expanded users one deterministic mention event and
// uses the legacy idempotency key so an explicit user is never notified twice.
func (s *Server) recordEmailCollaborationExplicitMentionNotifications(r *http.Request, companyID, nodeID, informationID, infoType, information, collaborationID string, mentionedUserIDs []string) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	informationID = strings.TrimSpace(informationID)
	collaborationID = strings.TrimSpace(collaborationID)
	mentionedUserIDs = uniqueCleanStrings(mentionedUserIDs)
	if companyID == "" || nodeID == "" || informationID == "" || collaborationID == "" || len(mentionedUserIDs) == 0 || !isMentionNotificationInformationType(infoType) {
		return
	}
	actorUserID, actorLabel := notificationActorPayload(r)
	comment := editorMentionCommentPreview(infoType, information)
	events := make([]domain.DomainEvent, 0, len(mentionedUserIDs))
	for _, userID := range mentionedUserIDs {
		idempotencyKey := "mention:regular:node:" + nodeID + ":" + informationID + ":" + userID + ":1"
		alreadyRecorded, err := s.mentionNotificationEventAlreadyRecorded(companyID, idempotencyKey)
		if err != nil {
			log.Printf("failed to check email mention notification idempotency company_id=%s node_id=%s information_id=%s user_id=%s: %v", companyID, nodeID, informationID, userID, err)
			return
		}
		if alreadyRecorded {
			continue
		}
		event, err := s.repo.AppendDomainEvent(store.DomainEventInput{
			CompanyID: companyID, StreamType: "notification", StreamID: "node:" + nodeID,
			Type: store.NodeMentionCreatedEventType, ActorUserID: actorUserID, IdempotencyKey: idempotencyKey,
			Payload: map[string]any{
				"node_id": nodeID, "entity_type": store.EntityTypeNode, "entity_id": nodeID,
				"comment": comment, "information_id": informationID,
				"information_type": strings.TrimSpace(infoType), "mention_kind": "regular",
				"mentioned_user_ids": []string{userID}, "actor_display_name": actorLabel,
				"email_collaboration_id": collaborationID, "icon": "email",
			},
		})
		if err != nil {
			log.Printf("failed to append email mention notification company_id=%s node_id=%s information_id=%s user_id=%s: %v", companyID, nodeID, informationID, userID, err)
			return
		}
		events = append(events, event)
	}
	if len(events) > 0 {
		s.projectCommittedNotificationEvents(events)
	}
}
