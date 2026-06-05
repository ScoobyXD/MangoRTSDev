package httpapi

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	webSocketGUID                     = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	maxRealtimeMessageBytes           = 1 << 20
	realtimeWorkspaceReplayLimit      = 100
	webSocketOpcodeText          byte = 0x1
	webSocketOpcodeClose         byte = 0x8
	webSocketOpcodePing          byte = 0x9
	webSocketOpcodePong          byte = 0xA
)

const (
	realtimeMessageReady                = "ready"
	realtimeMessageSubscribe            = "subscribe"
	realtimeMessageUnsubscribe          = "unsubscribe"
	realtimeMessageSubscriptionAccepted = "subscription.accepted"
	realtimeMessageSubscriptionRejected = "subscription.rejected"
	realtimeMessageProjectionDelta      = "projection.delta"
	realtimeMessageWorkspaceEvent       = "workspace.event"
	realtimeMessageNotificationCreated  = "notification.created"
	realtimeMessageNotificationDeleted  = "notification.deleted"
	realtimeMessageCommunicationsEvent  = "communications.event"
	realtimeMessageSnapshotRefetch      = "snapshot.refetch"
	realtimeMessagePermissionRevoked    = "permission.revoked"
	realtimeMessagePing                 = "ping"
	realtimeMessagePong                 = "pong"
	realtimeMessageError                = "error"
)

type realtimeConnection struct {
	id        string
	companyID string
	userID    string
	actor     ActorContext
	conn      net.Conn
	reader    *bufio.Reader
	writeMu   sync.Mutex
}

type realtimeClientMessage struct {
	Type          string `json:"type"`
	Scope         string `json:"scope,omitempty"`
	AfterSequence *int64 `json:"after_sequence,omitempty"`
}

type realtimeServerMessage struct {
	Type            string `json:"type"`
	CompanyID       string `json:"company_id,omitempty"`
	UserID          string `json:"user_id,omitempty"`
	ConnectionID    string `json:"connection_id,omitempty"`
	Scope           string `json:"scope,omitempty"`
	CurrentSequence int64  `json:"current_sequence,omitempty"`
	Sequence        int64  `json:"sequence,omitempty"`
	ResourceType    string `json:"resource_type,omitempty"`
	ResourceID      string `json:"resource_id,omitempty"`
	Error           string `json:"error,omitempty"`
	Message         string `json:"message,omitempty"`
	Reason          string `json:"reason,omitempty"`
}

type realtimeProjectionDeltaMessage struct {
	Type               string                  `json:"type"`
	CompanyID          string                  `json:"company_id"`
	Scope              string                  `json:"scope"`
	Sequence           int64                   `json:"sequence"`
	Projection         string                  `json:"projection"`
	ProjectionScope    string                  `json:"projection_scope,omitempty"`
	ProjectionSequence int64                   `json:"projection_sequence"`
	Deltas             []store.ProjectionDelta `json:"deltas"`
	ProjectedTimestamp time.Time               `json:"projected_timestamp"`
}

type realtimeEditorProjectionDeltaMessage struct {
	Type               string                        `json:"type"`
	CompanyID          string                        `json:"company_id"`
	Scope              string                        `json:"scope"`
	Sequence           int64                         `json:"sequence"`
	Projection         string                        `json:"projection"`
	ResourceType       string                        `json:"resource_type"`
	ResourceID         string                        `json:"resource_id"`
	Deltas             []store.EditorProjectionDelta `json:"deltas"`
	ProjectedTimestamp time.Time                     `json:"projected_timestamp"`
}

type realtimeWorkspaceEventMessage struct {
	Type      string                 `json:"type"`
	CompanyID string                 `json:"company_id"`
	Scope     string                 `json:"scope"`
	Sequence  int64                  `json:"sequence"`
	Event     workspaceEventEnvelope `json:"event"`
}

type realtimeCommunicationsEventMessage struct {
	Type      string                      `json:"type"`
	CompanyID string                      `json:"company_id"`
	Scope     string                      `json:"scope"`
	Event     communicationsEventEnvelope `json:"event"`
}

func (s *Server) handleRealtimeWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}
	if !isWebSocketUpgradeRequest(r) {
		writeError(w, http.StatusBadRequest, "websocket_upgrade_required")
		return
	}

	conn, reader, err := acceptWebSocket(w, r)
	if err != nil {
		log.Printf("failed to accept realtime websocket company_id=%s user_id=%s: %v", companyID, actor.User.UserID, err)
		return
	}
	realtimeConn := &realtimeConnection{
		id:        newRealtimeConnectionID(),
		companyID: companyID,
		userID:    strings.TrimSpace(actor.User.UserID),
		actor:     actor,
		conn:      conn,
		reader:    reader,
	}
	s.realtimeRegistry.addConnection(realtimeConn)
	s.recordRealtimeActiveConnections()
	log.Printf("realtime_connection_open company_id=%s user_id=%s connection_id=%s", companyID, realtimeConn.userID, realtimeConn.id)
	defer func() {
		s.realtimeRegistry.removeConnection(realtimeConn.id)
		s.recordRealtimeActiveConnections()
		s.recordRealtimeActiveSubscriptions()
		_ = conn.Close()
		log.Printf("realtime_connection_closed company_id=%s user_id=%s connection_id=%s", companyID, realtimeConn.userID, realtimeConn.id)
	}()

	if err := realtimeConn.sendJSON(realtimeServerMessage{
		Type:         realtimeMessageReady,
		CompanyID:    companyID,
		UserID:       realtimeConn.userID,
		ConnectionID: realtimeConn.id,
	}); err != nil {
		return
	}
	s.readRealtimeMessages(realtimeConn)
}

func isWebSocketUpgradeRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		headerContainsToken(r.Header.Get("Connection"), "upgrade") &&
		strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key")) != ""
}

func headerContainsToken(header, token string) bool {
	token = strings.ToLower(strings.TrimSpace(token))
	for _, part := range strings.Split(header, ",") {
		if strings.ToLower(strings.TrimSpace(part)) == token {
			return true
		}
	}
	return false
}

func acceptWebSocket(w http.ResponseWriter, r *http.Request) (net.Conn, *bufio.Reader, error) {
	version := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Version"))
	if version != "13" {
		writeError(w, http.StatusBadRequest, "unsupported_websocket_version")
		return nil, nil, errors.New("unsupported websocket version")
	}
	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	decoded, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(decoded) != 16 {
		writeError(w, http.StatusBadRequest, "invalid_websocket_key")
		return nil, nil, errors.New("invalid websocket key")
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		writeError(w, http.StatusInternalServerError, "websocket_hijack_not_supported")
		return nil, nil, errors.New("hijack not supported")
	}
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		return nil, nil, err
	}
	accept := webSocketAcceptKey(key)
	response := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
	if _, err := rw.WriteString(response); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	if err := rw.Flush(); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	return conn, rw.Reader, nil
}

func webSocketAcceptKey(key string) string {
	sum := sha1.Sum([]byte(key + webSocketGUID))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func newRealtimeConnectionID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes[:])
}

func (s *Server) readRealtimeMessages(conn *realtimeConnection) {
	for {
		frame, err := readWebSocketFrame(conn.reader, true)
		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, net.ErrClosed) {
				log.Printf("realtime websocket read failed company_id=%s user_id=%s connection_id=%s: %v", conn.companyID, conn.userID, conn.id, err)
			}
			return
		}
		switch frame.opcode {
		case webSocketOpcodeClose:
			_ = conn.writeFrame(webSocketOpcodeClose, nil)
			return
		case webSocketOpcodePing:
			_ = conn.writeFrame(webSocketOpcodePong, frame.payload)
		case webSocketOpcodePong:
			continue
		case webSocketOpcodeText:
			s.handleRealtimeMessage(conn, frame.payload)
		default:
			_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessageError, Error: "unsupported_websocket_frame"})
		}
	}
}

func (s *Server) handleRealtimeMessage(conn *realtimeConnection, payload []byte) {
	var message realtimeClientMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessageError, Error: "invalid_json"})
		return
	}
	message.Type = strings.TrimSpace(message.Type)
	switch message.Type {
	case realtimeMessageSubscribe:
		s.handleRealtimeSubscribe(conn, message)
	case realtimeMessageUnsubscribe:
		scope := strings.TrimSpace(message.Scope)
		if scope != "" {
			s.realtimeRegistry.unsubscribe(conn.id, conn.companyID, scope)
			s.recordRealtimeActiveSubscriptions()
		}
	case realtimeMessagePing:
		_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessagePong})
	default:
		_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessageError, Error: "unknown_message_type"})
	}
}

func (s *Server) handleRealtimeSubscribe(conn *realtimeConnection, message realtimeClientMessage) {
	scope := strings.TrimSpace(message.Scope)
	if scope == "" {
		_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessageSubscriptionRejected, Error: "scope_required"})
		return
	}
	authorized, rejectCode, err := s.authorizeRealtimeSubscription(conn.actor, conn.companyID, scope)
	if err != nil {
		log.Printf("failed to authorize realtime subscription company_id=%s user_id=%s scope=%s: %v", conn.companyID, conn.userID, scope, err)
		_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessageSubscriptionRejected, Scope: scope, Error: "failed_to_check_subscription"})
		return
	}
	if !authorized {
		log.Printf("realtime_subscription_rejected company_id=%s user_id=%s connection_id=%s scope_type=%s scope=%s error=%s", conn.companyID, conn.userID, conn.id, realtimeScopeType(scope), scope, rejectCode)
		_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessageSubscriptionRejected, Scope: scope, Error: rejectCode})
		return
	}
	s.realtimeRegistry.subscribe(conn, scope)
	s.recordRealtimeActiveSubscriptions()
	currentSequence := s.currentRealtimeScopeSequence(conn.companyID, scope)
	log.Printf("realtime_subscription_accepted company_id=%s user_id=%s connection_id=%s scope_type=%s scope=%s current_sequence=%d", conn.companyID, conn.userID, conn.id, realtimeScopeType(scope), scope, currentSequence)
	_ = conn.sendJSON(realtimeServerMessage{
		Type:            realtimeMessageSubscriptionAccepted,
		CompanyID:       conn.companyID,
		Scope:           scope,
		CurrentSequence: currentSequence,
	})
	if message.AfterSequence != nil && currentSequence > *message.AfterSequence {
		if realtimeWorkspaceDomainEventScopeType(scope) != "" && s.replayWorkspaceEventsForSubscription(conn, scope, *message.AfterSequence, currentSequence) {
			return
		}
		s.sendRealtimeSnapshotRefetch(conn, scope, currentSequence, "sequence_unavailable")
	}
}

func (s *Server) authorizeRealtimeSubscription(actor ActorContext, companyID, scope string) (bool, string, error) {
	if actorRoleForCompany(actor, companyID) == "" {
		return false, "company_access_denied", nil
	}
	if boardID := realtimeBoardIDFromScope(scope); boardID != "" {
		logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
		if logicGateID == "" {
			return false, "unsupported_scope", nil
		}
		if actorCanManageCompany(actor, companyID) {
			return true, "", nil
		}
		userID := strings.TrimSpace(actor.User.UserID)
		if userID == "" {
			return false, "unauthorized", nil
		}
		allowed, err := s.repo.UserHasEffectiveAccess(companyID, userID, store.EntityTypeLogicGate, logicGateID, store.EntityPermissionEdit)
		if err != nil {
			return false, "", err
		}
		if !allowed {
			return false, "access_denied", nil
		}
		return true, "", nil
	}
	if resourceType, resourceID := realtimeEditorResourceFromScope(scope); resourceID != "" {
		if actorCanManageCompany(actor, companyID) {
			return true, "", nil
		}
		userID := strings.TrimSpace(actor.User.UserID)
		if userID == "" {
			return false, "unauthorized", nil
		}
		allowed, err := s.repo.UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, store.EntityPermissionEdit)
		if err != nil {
			return false, "", err
		}
		if !allowed {
			return false, "access_denied", nil
		}
		return true, "", nil
	}
	if userID := realtimeNotificationUserIDFromScope(scope); userID != "" {
		if userID != strings.TrimSpace(actor.User.UserID) {
			return false, "access_denied", nil
		}
		return true, "", nil
	}
	if userID := realtimeCommunicationsUserIDFromScope(scope); userID != "" {
		if userID != strings.TrimSpace(actor.User.UserID) {
			return false, "access_denied", nil
		}
		return true, "", nil
	}
	if userID := realtimeWorkspaceUserIDFromScope(scope); userID != "" {
		if userID != strings.TrimSpace(actor.User.UserID) && !actorCanManageCompany(actor, companyID) {
			return false, "access_denied", nil
		}
		return true, "", nil
	}
	if userID := realtimeRacioUserIDFromScope(scope); userID != "" {
		if userID != strings.TrimSpace(actor.User.UserID) && !actorCanManageCompany(actor, companyID) {
			return false, "access_denied", nil
		}
		return true, "", nil
	}
	return false, "unsupported_scope", nil
}

func realtimeBoardScope(boardID string) string {
	boardID = strings.TrimSpace(boardID)
	if boardID == "" {
		return ""
	}
	return "board:" + boardID
}

func realtimeBoardIDFromScope(scope string) string {
	scope = strings.TrimSpace(scope)
	if !strings.HasPrefix(scope, "board:") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(scope, "board:"))
}

func realtimeEditorScope(resourceType, resourceID string) string {
	return store.EditorRealtimeScope(resourceType, resourceID)
}

func realtimeEditorResourceFromScope(scope string) (string, string) {
	scope = strings.TrimSpace(scope)
	for _, candidate := range []struct {
		prefix       string
		resourceType string
	}{
		{prefix: "editor:node:", resourceType: store.EntityTypeNode},
		{prefix: "editor:logic_gate:", resourceType: store.EntityTypeLogicGate},
	} {
		if strings.HasPrefix(scope, candidate.prefix) {
			return candidate.resourceType, strings.TrimSpace(strings.TrimPrefix(scope, candidate.prefix))
		}
	}
	return "", ""
}

func realtimeNotificationScope(userID string) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	return "notifications:user:" + userID
}

func realtimeNotificationUserIDFromScope(scope string) string {
	scope = strings.TrimSpace(scope)
	if !strings.HasPrefix(scope, "notifications:user:") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(scope, "notifications:user:"))
}

func realtimeCommunicationsScope(userID string) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	return "communications:user:" + userID
}

func realtimeCommunicationsUserIDFromScope(scope string) string {
	scope = strings.TrimSpace(scope)
	if !strings.HasPrefix(scope, "communications:user:") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(scope, "communications:user:"))
}

func realtimeRacioScope(userID string) string {
	return store.RacioRealtimeUserScope(userID)
}

func realtimeRacioUserIDFromScope(scope string) string {
	scope = strings.TrimSpace(scope)
	if !strings.HasPrefix(scope, "racio:user:") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(scope, "racio:user:"))
}

func realtimeWorkspaceScope(userID string) string {
	return realtimeUserScopedWorkspaceScope("workspace", userID)
}

func realtimeCompanyExplorerScope(userID string) string {
	return realtimeUserScopedWorkspaceScope("company_explorer", userID)
}

func realtimeNodeGraphScope(userID string) string {
	return realtimeUserScopedWorkspaceScope("node_graph", userID)
}

func realtimeLogicGateGraphScope(userID string) string {
	return realtimeUserScopedWorkspaceScope("logic_gate_graph", userID)
}

func realtimeUserScopedWorkspaceScope(prefix, userID string) string {
	prefix = strings.TrimSpace(prefix)
	userID = strings.TrimSpace(userID)
	if prefix == "" || userID == "" {
		return ""
	}
	return prefix + ":user:" + userID
}

func realtimeWorkspaceUserIDFromScope(scope string) string {
	scope = strings.TrimSpace(scope)
	for _, prefix := range []string{
		"workspace:user:",
		"company_explorer:user:",
		"node_graph:user:",
		"logic_gate_graph:user:",
	} {
		if strings.HasPrefix(scope, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(scope, prefix))
		}
	}
	return ""
}

func realtimeWorkspaceDomainEventScopeType(scope string) string {
	scope = strings.TrimSpace(scope)
	for _, prefix := range []string{
		"workspace",
		"company_explorer",
		"node_graph",
		"logic_gate_graph",
	} {
		if strings.HasPrefix(scope, prefix+":user:") {
			return prefix
		}
	}
	return ""
}

func realtimeScopeType(scope string) string {
	scope = strings.TrimSpace(scope)
	switch {
	case realtimeBoardIDFromScope(scope) != "":
		return "board"
	case realtimeEditorResourceIDFromScope(scope) != "":
		return "editor"
	case realtimeNotificationUserIDFromScope(scope) != "":
		return "notifications"
	case realtimeCommunicationsUserIDFromScope(scope) != "":
		return "communications"
	case realtimeWorkspaceDomainEventScopeType(scope) != "":
		return realtimeWorkspaceDomainEventScopeType(scope)
	case realtimeRacioUserIDFromScope(scope) != "":
		return "racio"
	default:
		if index := strings.Index(scope, ":"); index > 0 {
			return strings.TrimSpace(scope[:index])
		}
		return scope
	}
}

func realtimeEditorResourceIDFromScope(scope string) string {
	_, resourceID := realtimeEditorResourceFromScope(scope)
	return resourceID
}

func (s *Server) recordRealtimeActiveConnections() {
	if s == nil || s.realtimeRegistry == nil {
		return
	}
	s.recordOperationalMetric("realtime.active_connections", "", int64(s.realtimeRegistry.connectionCount()), 0)
}

func (s *Server) recordRealtimeActiveSubscriptions() {
	if s == nil || s.realtimeRegistry == nil {
		return
	}
	counts := s.realtimeRegistry.scopeTypeCounts()
	for _, scopeType := range []string{"board", "communications", "notifications", "racio", "workspace", "company_explorer", "node_graph", "logic_gate_graph"} {
		s.recordOperationalMetric("realtime.active_subscriptions", scopeType, int64(counts[scopeType]), 0)
	}
	for scopeType, count := range counts {
		if scopeType == "board" || scopeType == "communications" || scopeType == "notifications" || scopeType == "racio" ||
			scopeType == "workspace" || scopeType == "company_explorer" || scopeType == "node_graph" || scopeType == "logic_gate_graph" {
			continue
		}
		s.recordOperationalMetric("realtime.active_subscriptions", scopeType, int64(count), 0)
	}
}

func (s *Server) sendRealtimeSnapshotRefetch(conn *realtimeConnection, scope string, sequence int64, reason string) {
	if conn == nil {
		return
	}
	_ = conn.sendJSON(realtimeServerMessage{
		Type:      realtimeMessageSnapshotRefetch,
		CompanyID: conn.companyID,
		Scope:     scope,
		Sequence:  sequence,
		Reason:    reason,
	})
	s.recordOperationalMetric("realtime.snapshot_refetch_count", realtimeScopeType(scope), 1, 0)
	if realtimeWorkspaceDomainEventScopeType(scope) != "" {
		s.recordOperationalMetric("realtime.workspace_replay_refetch_count", realtimeScopeType(scope), 1, 0)
	}
}

func (s *Server) replayWorkspaceEventsForSubscription(conn *realtimeConnection, scope string, afterSequence, currentSequence int64) bool {
	if s == nil || s.repo == nil || conn == nil || realtimeWorkspaceDomainEventScopeType(scope) == "" {
		return false
	}
	if afterSequence < 0 || currentSequence-afterSequence > realtimeWorkspaceReplayLimit {
		return false
	}
	events, err := s.repo.ListDomainEventsAfter(store.DomainEventReplayQuery{
		CompanyID:     conn.companyID,
		StreamType:    workspaceDomainStreamType,
		StreamID:      conn.companyID,
		AfterSequence: afterSequence,
		Limit:         realtimeWorkspaceReplayLimit + 1,
	})
	if err != nil {
		log.Printf("failed to replay realtime workspace events company_id=%s user_id=%s scope=%s after_sequence=%d: %v", conn.companyID, conn.userID, scope, afterSequence, err)
		return false
	}
	if len(events) > realtimeWorkspaceReplayLimit {
		return false
	}
	for _, event := range events {
		if event.Sequence <= afterSequence || event.Sequence > currentSequence {
			continue
		}
		visible, err := s.workspaceEventVisibleForRealtimeScope(event, scope)
		if err != nil {
			log.Printf("failed to filter realtime workspace replay company_id=%s scope=%s sequence=%d event_id=%s: %v", conn.companyID, scope, event.Sequence, event.EventID, err)
			return false
		}
		if !visible {
			continue
		}
		payload, err := json.Marshal(realtimeWorkspaceEventMessage{
			Type:      realtimeMessageWorkspaceEvent,
			CompanyID: conn.companyID,
			Scope:     scope,
			Sequence:  event.Sequence,
			Event:     workspaceEventEnvelopeFromDomainEvent(event),
		})
		if err != nil {
			log.Printf("failed to marshal realtime workspace replay company_id=%s scope=%s sequence=%d event_id=%s: %v", conn.companyID, scope, event.Sequence, event.EventID, err)
			return false
		}
		if err := conn.sendText(payload); err != nil {
			return true
		}
		s.recordOperationalMetric("realtime.workspace_events_replayed", realtimeScopeType(scope), 1, 0)
	}
	return true
}

func (s *Server) workspaceEventVisibleForRealtimeScope(event domain.DomainEvent, scope string) (bool, error) {
	userID := realtimeWorkspaceUserIDFromScope(scope)
	if userID == "" {
		return true, nil
	}
	userIDs, err := s.repo.ListEffectiveUsersForWorkspaceEvent(event)
	if err != nil {
		return false, err
	}
	for _, candidate := range userIDs {
		if strings.TrimSpace(candidate) == userID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) currentRealtimeScopeSequence(companyID, scope string) int64 {
	projectionName := ""
	projectionScope := ""
	if boardID := realtimeBoardIDFromScope(scope); boardID != "" {
		projectionName = store.ProjectionNameKanbanBoard
		projectionScope = scope
	} else if userID := realtimeRacioUserIDFromScope(scope); userID != "" {
		projectionName = store.ProjectionNameRacioMatrix
		projectionScope = store.RacioProjectionUserScope(userID)
	} else if realtimeEditorResourceIDFromScope(scope) != "" {
		sequence, err := s.repo.CurrentEventRowSequence(companyID, scope)
		if err != nil {
			log.Printf("failed to read realtime editor scope sequence company_id=%s scope=%s: %v", companyID, scope, err)
			return 0
		}
		return sequence
	} else if realtimeWorkspaceDomainEventScopeType(scope) != "" {
		sequence, err := s.repo.CurrentDomainEventSequence(store.DomainEventStreamQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID})
		if err != nil {
			log.Printf("failed to read realtime workspace scope sequence company_id=%s scope=%s: %v", companyID, scope, err)
			return 0
		}
		return sequence
	} else {
		return 0
	}
	sequence, err := s.repo.CurrentProjectionSequence(companyID, projectionName, projectionScope)
	if err != nil {
		log.Printf("failed to read realtime scope sequence company_id=%s scope=%s: %v", companyID, scope, err)
		return 0
	}
	return sequence
}

func (c *realtimeConnection) sendJSON(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.sendText(payload)
}

func (c *realtimeConnection) sendText(payload []byte) error {
	return c.writeFrame(webSocketOpcodeText, payload)
}

func (c *realtimeConnection) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	header := []byte{0x80 | (opcode & 0x0F)}
	length := len(payload)
	switch {
	case length < 126:
		header = append(header, byte(length))
	case length <= 0xFFFF:
		header = append(header, 126, byte(length>>8), byte(length))
	default:
		header = append(header, 127)
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(length))
		header = append(header, size[:]...)
	}
	if _, err := c.conn.Write(header); err != nil {
		return err
	}
	if length == 0 {
		return nil
	}
	_, err := c.conn.Write(payload)
	return err
}

type webSocketFrame struct {
	opcode  byte
	payload []byte
}

func readWebSocketFrame(reader *bufio.Reader, requireMasked bool) (webSocketFrame, error) {
	first, err := reader.ReadByte()
	if err != nil {
		return webSocketFrame{}, err
	}
	second, err := reader.ReadByte()
	if err != nil {
		return webSocketFrame{}, err
	}
	if first&0x70 != 0 {
		return webSocketFrame{}, errors.New("reserved websocket bits are unsupported")
	}
	if first&0x80 == 0 {
		return webSocketFrame{}, errors.New("fragmented websocket frames are unsupported")
	}
	opcode := first & 0x0F
	masked := second&0x80 != 0
	if requireMasked && !masked {
		return webSocketFrame{}, errors.New("client websocket frame was not masked")
	}
	length := uint64(second & 0x7F)
	switch length {
	case 126:
		var bytes [2]byte
		if _, err := io.ReadFull(reader, bytes[:]); err != nil {
			return webSocketFrame{}, err
		}
		length = uint64(binary.BigEndian.Uint16(bytes[:]))
	case 127:
		var bytes [8]byte
		if _, err := io.ReadFull(reader, bytes[:]); err != nil {
			return webSocketFrame{}, err
		}
		length = binary.BigEndian.Uint64(bytes[:])
	}
	if length > maxRealtimeMessageBytes {
		return webSocketFrame{}, errors.New("websocket message too large")
	}
	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(reader, mask[:]); err != nil {
			return webSocketFrame{}, err
		}
	}
	payload := make([]byte, int(length))
	if length > 0 {
		if _, err := io.ReadFull(reader, payload); err != nil {
			return webSocketFrame{}, err
		}
	}
	if masked {
		for index := range payload {
			payload[index] ^= mask[index%4]
		}
	}
	return webSocketFrame{opcode: opcode, payload: payload}, nil
}
