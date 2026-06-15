package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

const editorRichTextPrefix = "<!-- mango-editor-html-v1 -->"
const editorNodeTextBlockPrefix = "<!-- mango-node-text-block-v1 -->"

var (
	editorHTMLBreakPattern = regexp.MustCompile(`(?i)<br\s*/?>`)
	editorHTMLTagPattern   = regexp.MustCompile(`<[^>]+>`)
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
	})
	if errorsIsInvalid(err) {
		writeError(w, http.StatusBadRequest, "invalid_notifications_request")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_notifications")
		return
	}
	s.publishNotificationDeletions(deleted)
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
			go s.runNotificationDomainEventCatchupOnce(context.Background())
		}
	}()
	items, err := s.notifications.ProcessDomainEventsWithTiming(context.Background(), events, nil)
	if err != nil {
		log.Printf("failed to project committed notification events asynchronously count=%d event_types=%s: %v", len(events), domainEventTypesForLog(events), err)
		go s.runNotificationDomainEventCatchupOnce(context.Background())
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

func (s *Server) publishNotificationCreatedRealtime(item domain.Notification) {
	if s == nil || s.realtimeRegistry == nil {
		return
	}
	scope := realtimeNotificationScope(item.RecipientUserID)
	if scope == "" || strings.TrimSpace(item.CompanyID) == "" {
		return
	}
	payload, err := json.Marshal(realtimeNotificationCreatedMessage{
		Type:         realtimeMessageNotificationCreated,
		CompanyID:    item.CompanyID,
		Scope:        scope,
		Notification: item,
		TS:           time.Now().UTC(),
	})
	if err != nil {
		return
	}
	s.realtimeRegistry.publish(item.CompanyID, scope, payload)
}

func (s *Server) publishNotificationDeletedRealtime(item domain.Notification) {
	if s == nil || s.realtimeRegistry == nil {
		return
	}
	scope := realtimeNotificationScope(item.RecipientUserID)
	if scope == "" || strings.TrimSpace(item.CompanyID) == "" || strings.TrimSpace(item.NotificationID) == "" {
		return
	}
	payload, err := json.Marshal(realtimeNotificationDeletedMessage{
		Type:           realtimeMessageNotificationDeleted,
		CompanyID:      item.CompanyID,
		Scope:          scope,
		NotificationID: item.NotificationID,
		TS:             time.Now().UTC(),
	})
	if err != nil {
		return
	}
	s.realtimeRegistry.publish(item.CompanyID, scope, payload)
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

func mentionNotificationContentKey(infoType, information string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(infoType) + "\x00" + strings.TrimSpace(information)))
	return hex.EncodeToString(sum[:8])
}

func (s *Server) recordMentionNotifications(r *http.Request, companyID, entityType, entityID, informationID, infoType, information string) {
	companyID = strings.TrimSpace(companyID)
	entityType = strings.TrimSpace(entityType)
	entityID = strings.TrimSpace(entityID)
	informationID = strings.TrimSpace(informationID)
	if companyID == "" || entityType == "" || entityID == "" || informationID == "" || !isMentionNotificationInformationType(infoType) {
		return
	}
	mentionedUserIDs, err := s.notifications.ResolveMentionedUserIDOccurrences(companyID, information)
	if err != nil || len(mentionedUserIDs) == 0 {
		return
	}
	actorUserID, actorLabel := notificationActorPayload(r)
	comment := editorMentionCommentPreview(infoType, information)
	contentKey := mentionNotificationContentKey(infoType, information)
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
	mentionOccurrenceByUserID := map[string]int{}
	for _, userID := range mentionedUserIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		occurrenceIndex := mentionOccurrenceByUserID[userID]
		mentionOccurrenceByUserID[userID] = occurrenceIndex + 1
		idempotencyKey := "mention:" + idempotencyEntityKey + ":" + entityID + ":" + informationID + ":" + userID + ":" + contentKey
		if occurrenceIndex > 0 {
			idempotencyKey += ":" + strconv.Itoa(occurrenceIndex+1)
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
