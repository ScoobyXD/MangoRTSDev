package httpapi

import (
	"encoding/json"
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
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
		UserID:     actor.User.UserID,
		CompanyID:  strings.TrimSpace(r.URL.Query().Get("company_id")),
		UnreadOnly: parseBoolQuery(r.URL.Query().Get("unread_only")),
		Limit:      limit,
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

func (s *Server) recordNotificationEvent(input store.NotificationEventInput) {
	items, err := s.notifications.RecordAndProcess(input)
	if err != nil {
		log.Printf("failed to process notification event type=%s company_id=%s entity_type=%s entity_id=%s: %v", input.Type, input.CompanyID, input.EntityType, input.EntityID, err)
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
		parts = append(parts, strings.TrimSpace(assignment.Role)+":"+strings.TrimSpace(assignment.UserID))
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}
func (s *Server) kanbanCardNotificationSnapshot(companyID, boardID, cardID string) (domain.KanbanCard, map[string]string, bool) {
	columnTitles := map[string]string{}
	columns, err := s.repo.ListKanbanColumns(companyID, boardID)
	if err == nil {
		for _, column := range columns {
			columnTitles[column.ColumnID] = column.Title
		}
	}
	cards, err := s.repo.ListKanbanCards(companyID, boardID, store.KanbanCardQuery{Limit: store.KanbanMaxCardsLimit})
	if err != nil {
		return domain.KanbanCard{}, columnTitles, false
	}
	for _, card := range cards {
		if card.CardID == cardID {
			return card, columnTitles, true
		}
	}
	return domain.KanbanCard{}, columnTitles, false
}

func (s *Server) recordKanbanStateNotification(r *http.Request, before domain.KanbanCard, after domain.KanbanCard, columnTitles map[string]string) {
	if before.CardID == "" || after.LogicGateID == nil || before.ColumnID == after.ColumnID {
		return
	}
	actorUserID, actorLabel := notificationActorPayload(r)
	payload := map[string]any{
		"actor_display_name":    actorLabel,
		"logic_gate_id":         *after.LogicGateID,
		"board_id":              after.BoardID,
		"card_id":               after.CardID,
		"node_id":               after.NodeID,
		"node_title":            after.NodeTitle,
		"previous_column_id":    before.ColumnID,
		"previous_column_title": columnTitles[before.ColumnID],
		"column_id":             after.ColumnID,
		"column_title":          columnTitles[after.ColumnID],
	}
	s.recordNotificationEvent(store.NotificationEventInput{
		CompanyID:      after.CompanyID,
		ActorUserID:    actorUserID,
		Type:           domain.NotificationEventLogicGateStateChanged,
		EntityType:     "kanban_card",
		EntityID:       after.CardID,
		IdempotencyKey: "logic-gate-state:" + after.CompanyID + ":" + after.CardID + ":" + after.UpdatedTimestamp.Format(time.RFC3339Nano),
		Payload:        payload,
	})
}
