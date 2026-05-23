package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
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

type notificationStreamEnvelope struct {
	Type         string              `json:"type"`
	Notification domain.Notification `json:"notification"`
	TS           time.Time           `json:"ts"`
}

const editorRichTextPrefix = "<!-- mango-editor-html-v1 -->"
const editorNodeTextBlockPrefix = "<!-- mango-node-text-block-v1 -->"

var (
	editorHTMLBreakPattern = regexp.MustCompile(`(?i)<br\s*/?>`)
	editorHTMLTagPattern   = regexp.MustCompile(`<[^>]+>`)
)

func (s *Server) handleNotifications(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
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
		CompanyID string `json:"company_id"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	if req.CompanyID == "" {
		req.CompanyID = strings.TrimSpace(r.URL.Query().Get("company_id"))
	}
	count, err := s.repo.MarkAllNotificationsRead(actor.User.UserID, strings.TrimSpace(req.CompanyID))
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

func (s *Server) handleNotificationStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "stream_unsupported")
		return
	}

	prepareSSEHeaders(w)
	ch := s.notificationHub.subscribe(actor.User.UserID)
	defer s.notificationHub.unsubscribe(actor.User.UserID, ch)

	fmt.Fprintf(w, "event: ready\ndata: {\"user_id\":%q}\n\n", actor.User.UserID)
	flusher.Flush()

	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(w, "event: ping\ndata: {}\n\n")
			flusher.Flush()
		case payload := <-ch:
			fmt.Fprintf(w, "event: notification\ndata: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func (s *Server) projectCommittedNotificationEvents(events []domain.DomainEvent) {
	items, err := s.notifications.ProcessDomainEvents(context.Background(), events)
	if err != nil {
		log.Printf("failed to project committed notification events: %v", err)
		go s.runNotificationDomainEventCatchupOnce(context.Background())
		return
	}
	s.publishNotifications(items)
}

func (s *Server) publishNotifications(items []domain.Notification) {
	for _, item := range items {
		payload, err := json.Marshal(notificationStreamEnvelope{
			Type:         "notification.created",
			Notification: item,
			TS:           time.Now().UTC(),
		})
		if err != nil {
			continue
		}
		s.notificationHub.publish(item.RecipientUserID, payload)
	}
}

func (s *Server) refreshEffectiveAccessProjection(companyID, reason string) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return
	}
	if err := s.repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		log.Printf("failed to refresh effective access company_id=%s reason=%s: %v", companyID, reason, err)
	}
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
	text = editorHTMLBreakPattern.ReplaceAllString(text, "\n")
	text = editorHTMLTagPattern.ReplaceAllString(text, " ")
	return strings.TrimSpace(htmlpkg.UnescapeString(text))
}

func (s *Server) recordMentionNotifications(r *http.Request, companyID, entityType, entityID, informationID, infoType, information string) {
	companyID = strings.TrimSpace(companyID)
	entityType = strings.TrimSpace(entityType)
	entityID = strings.TrimSpace(entityID)
	informationID = strings.TrimSpace(informationID)
	if companyID == "" || entityType == "" || entityID == "" || informationID == "" || !isMentionNotificationInformationType(infoType) {
		return
	}
	mentionedUserIDs, err := s.notifications.ResolveMentionedUserIDs(companyID, information)
	if err != nil || len(mentionedUserIDs) == 0 {
		return
	}
	actorUserID, actorLabel := notificationActorPayload(r)
	comment := editorMentionCommentPreview(infoType, information)
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
	default:
		return
	}
	events := make([]domain.DomainEvent, 0, len(mentionedUserIDs))
	for _, userID := range mentionedUserIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		event, err := s.repo.AppendDomainEvent(store.DomainEventInput{
			CompanyID:      companyID,
			StreamType:     "notification",
			StreamID:       streamID,
			Type:           eventType,
			ActorUserID:    actorUserID,
			IdempotencyKey: "mention:" + idempotencyEntityKey + ":" + entityID + ":" + informationID + ":" + userID,
			Payload: map[string]any{
				payloadResourceKey:   entityID,
				"entity_type":        entityType,
				"entity_id":          entityID,
				"comment":            comment,
				"information_id":     informationID,
				"mentioned_user_ids": []string{userID},
				"actor_display_name": actorLabel,
			},
		})
		if err != nil {
			log.Printf("failed to append mention notification domain event company_id=%s entity_type=%s entity_id=%s information_id=%s user_id=%s: %v", companyID, entityType, entityID, informationID, userID, err)
			return
		}
		events = append(events, event)
	}
	if len(events) > 0 {
		s.projectCommittedNotificationEvents(events)
	}
}

func parseBoolQuery(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "y":
		return true
	default:
		return false
	}
}

func errorsIsInvalid(err error) bool {
	return err == store.ErrInvalid
}

func logicGateRaciAssignmentUserIDs(assignments []domain.LogicGateRaciAssignment) []string {
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

func newlyAssignedLogicGateRaciUserIDs(before, after []domain.LogicGateRaciAssignment) []string {
	beforeRoles := highestLogicGateRaciRolesByUser(before)
	afterRoles := highestLogicGateRaciRolesByUser(after)
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

func highestLogicGateRaciRolesByUser(assignments []domain.LogicGateRaciAssignment) map[string]string {
	out := map[string]string{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		role, ok := store.NormalizeLogicGateRaciRole(assignment.Role)
		if !ok || userID == "" {
			continue
		}
		if raciNotificationRoleRank(role) > raciNotificationRoleRank(out[userID]) {
			out[userID] = role
		}
	}
	return out
}

func raciNotificationRoleRank(role string) int {
	switch strings.TrimSpace(role) {
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

func sharedInboxRaciAssignmentUserIDs(assignments []domain.SharedInboxRaciAssignment) []string {
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

func logicGateRaciFingerprint(assignments []domain.LogicGateRaciAssignment) string {
	parts := make([]string, 0, len(assignments))
	for _, assignment := range assignments {
		parts = append(parts, strings.TrimSpace(assignment.Role)+":"+strings.TrimSpace(assignment.UserID))
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}

func sharedInboxRaciFingerprint(assignments []domain.SharedInboxRaciAssignment) string {
	parts := make([]string, 0, len(assignments))
	for _, assignment := range assignments {
		subjectType := strings.TrimSpace(assignment.SubjectType)
		subjectID := strings.TrimSpace(assignment.SubjectID)
		if subjectType == "" {
			subjectType = "user"
			subjectID = strings.TrimSpace(assignment.UserID)
		}
		parts = append(parts, strings.TrimSpace(assignment.Role)+":"+subjectType+":"+subjectID)
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}
