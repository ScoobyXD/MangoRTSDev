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
	"miraeopus/backend/internal/store"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	webSocketGUID                              = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	maxRealtimeMessageBytes                    = 1 << 20
	maxRealtimeScopeBytes                      = 384
	maxRealtimeSubscriptionsPerConnection      = 16
	realtimeWebSocketWriteTimeout              = 2 * time.Second
	realtimeWebSocketHeartbeatInterval         = 25 * time.Second
	webSocketOpcodeText                   byte = 0x1
	webSocketOpcodeClose                  byte = 0x8
	webSocketOpcodePing                   byte = 0x9
	webSocketOpcodePong                   byte = 0xA
)

const (
	realtimeNotificationScopePrefix    = "notifications:user:"
	realtimePersonalMailboxScopePrefix = "mailbox:personal:account:"
	realtimeSharedMailboxScopePrefix   = "mailbox:shared:"
	realtimeChatScopePrefix            = "chat:node:"
	realtimeBoardScopePrefix           = "board:"
)

const (
	realtimeMessageReady                 = "ready"
	realtimeMessageSubscribe             = "subscribe"
	realtimeMessageUnsubscribe           = "unsubscribe"
	realtimeMessageSubscriptionAccepted  = "subscription.accepted"
	realtimeMessageSubscriptionRejected  = "subscription.rejected"
	realtimeMessageNotificationCreated   = "notification.created"
	realtimeMessageNotificationDeleted   = "notification.deleted"
	realtimeMessageNotificationsCleared  = "notifications.cleared"
	realtimeMessageChatCreated           = "chat.message.created"
	realtimeMessageChatDeleted           = "chat.message.deleted"
	realtimeMessageKanbanChanged         = "kanban.changed"
	realtimeMessageMailboxMessageChanged = "mailbox.message.changed"
	realtimeMessageMailboxFolderChanged  = "mailbox.folder.changed"
	realtimeMessagePing                  = "ping"
	realtimeMessagePong                  = "pong"
	realtimeMessageError                 = "error"
)

type realtimeConnection struct {
	id        string
	companyID string
	userID    string
	actor     ActorContext
	conn      net.Conn
	reader    *bufio.Reader
	writeMu   sync.Mutex
	closeOnce sync.Once
}

type realtimeClientMessage struct {
	Type  string `json:"type"`
	Scope string `json:"scope,omitempty"`
}

type realtimeServerMessage struct {
	Type         string `json:"type"`
	CompanyID    string `json:"company_id,omitempty"`
	UserID       string `json:"user_id,omitempty"`
	ConnectionID string `json:"connection_id,omitempty"`
	Scope        string `json:"scope,omitempty"`
	Error        string `json:"error,omitempty"`
}

type realtimeChatMessage struct {
	Type      string `json:"type"`
	CompanyID string `json:"company_id"`
	Scope     string `json:"scope"`
	NodeID    string `json:"node_id"`
	BlockID   string `json:"block_id,omitempty"`
	MessageID string `json:"message_id"`
}

type realtimeKanbanChangedMessage struct {
	Type       string `json:"type"`
	CompanyID  string `json:"company_id"`
	Scope      string `json:"scope"`
	BoardID    string `json:"board_id"`
	ChangeType string `json:"change_type,omitempty"`
}

type realtimeMailboxChangedMessage struct {
	Type          string     `json:"type"`
	CompanyID     string     `json:"company_id"`
	Scope         string     `json:"scope"`
	Trigger       string     `json:"trigger"`
	MessageID     string     `json:"message_id,omitempty"`
	ThreadID      string     `json:"thread_id,omitempty"`
	SharedInboxID string     `json:"shared_inbox_id,omitempty"`
	OccurredAt    *time.Time `json:"occurred_at,omitempty"`
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
		realtimeConn.close()
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
	heartbeatDone := make(chan struct{})
	go runRealtimeWebSocketHeartbeat(realtimeConn, realtimeWebSocketHeartbeatInterval, heartbeatDone)
	defer close(heartbeatDone)
	s.readRealtimeMessages(realtimeConn)
}

func runRealtimeWebSocketHeartbeat(conn *realtimeConnection, interval time.Duration, done <-chan struct{}) {
	if conn == nil || interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			// A protocol-level ping is handled by the browser networking stack, so
			// background-tab timer throttling cannot turn an idle connection into
			// an application reconnect and canonical-refetch cycle.
			if err := conn.writeFrame(webSocketOpcodePing, nil); err != nil {
				return
			}
		}
	}
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
	if len(scope) > maxRealtimeScopeBytes {
		_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessageSubscriptionRejected, Error: "scope_too_long"})
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
	if !s.realtimeRegistry.subscribeWithinLimit(conn, scope, maxRealtimeSubscriptionsPerConnection) {
		_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessageSubscriptionRejected, Scope: scope, Error: "subscription_limit_exceeded"})
		return
	}
	s.recordRealtimeActiveSubscriptions()
	log.Printf("realtime_subscription_accepted company_id=%s user_id=%s connection_id=%s scope_type=%s scope=%s", conn.companyID, conn.userID, conn.id, realtimeScopeType(scope), scope)
	_ = conn.sendJSON(realtimeServerMessage{Type: realtimeMessageSubscriptionAccepted, CompanyID: conn.companyID, Scope: scope})
}

func (s *Server) authorizeRealtimeSubscription(actor ActorContext, companyID, scope string) (bool, string, error) {
	if actorRoleForCompany(actor, companyID) == "" {
		return false, "company_access_denied", nil
	}
	if userID := realtimeNotificationUserIDFromScope(scope); userID != "" {
		if userID != strings.TrimSpace(actor.User.UserID) {
			return false, "access_denied", nil
		}
		return true, "", nil
	}
	if userID, accountEmail := realtimePersonalMailboxIdentityFromScope(scope); userID != "" {
		if userID != strings.TrimSpace(actor.User.UserID) {
			return false, "access_denied", nil
		}
		connections, err := s.repo.ListUserEmailConnections(userID)
		if err != nil {
			return false, "", err
		}
		for _, connection := range connections {
			if strings.TrimSpace(connection.UserID) == userID &&
				normalizeEmailForCompare(connection.AccountEmail) == accountEmail &&
				strings.TrimSpace(connection.Status) == "connected" &&
				strings.TrimSpace(connection.GrantID) != "" {
				return true, "", nil
			}
		}
		return false, "resource_not_found", nil
	}
	if sharedInboxID := realtimeSharedMailboxIDFromScope(scope); sharedInboxID != "" {
		return s.authorizeRealtimeEntityScope(actor, companyID, store.EntityTypeSharedInbox, sharedInboxID, store.EntityPermissionView)
	}
	if nodeID := realtimeChatNodeIDFromScope(scope); nodeID != "" {
		return s.authorizeRealtimeEntityScope(actor, companyID, store.EntityTypeNode, nodeID, store.EntityPermissionEdit)
	}
	if boardID := realtimeBoardIDFromScope(scope); boardID != "" {
		logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
		if logicGateID == "" {
			return false, "unsupported_scope", nil
		}
		return s.authorizeRealtimeEntityScope(actor, companyID, store.EntityTypeLogicGate, logicGateID, store.EntityPermissionView)
	}
	if realtimeKnownScopePrefix(scope) {
		return false, "invalid_scope", nil
	}
	return false, "unsupported_scope", nil
}

func (s *Server) authorizeRealtimeEntityScope(actor ActorContext, companyID, resourceType, resourceID, permission string) (bool, string, error) {
	exists, err := s.realtimeEntityExists(companyID, resourceType, resourceID)
	if err != nil {
		return false, "", err
	}
	if !exists {
		return false, "resource_not_found", nil
	}
	if actorCanManageCompany(actor, companyID) {
		return true, "", nil
	}
	userID := strings.TrimSpace(actor.User.UserID)
	if userID == "" {
		return false, "unauthorized", nil
	}
	allowed, err := s.repo.UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, permission)
	if err != nil {
		return false, "", err
	}
	if !allowed {
		return false, "access_denied", nil
	}
	return true, "", nil
}

func (s *Server) realtimeEntityExists(companyID, resourceType, resourceID string) (bool, error) {
	var err error
	switch resourceType {
	case store.EntityTypeNode:
		_, err = s.repo.GetNode(companyID, resourceID)
	case store.EntityTypeLogicGate:
		_, err = s.repo.GetLogicGate(companyID, resourceID)
	case store.EntityTypeSharedInbox:
		item, loadErr := s.repo.GetCommunicationsSharedInboxFolder(companyID, resourceID)
		if loadErr == nil {
			return store.CommunicationsSharedInboxResourceType(item) == store.EntityTypeSharedInbox, nil
		}
		err = loadErr
	default:
		return false, store.ErrInvalid
	}
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

func realtimeBoardScope(boardID string) string {
	logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
	if !isCanonicalUUID(logicGateID) {
		return ""
	}
	return realtimeBoardScopePrefix + store.LogicGateKanbanBoardID(logicGateID)
}

func realtimeBoardIDFromScope(scope string) string {
	scope = strings.TrimSpace(scope)
	if len(scope) > maxRealtimeScopeBytes || !strings.HasPrefix(scope, realtimeBoardScopePrefix) {
		return ""
	}
	boardID := strings.TrimSpace(strings.TrimPrefix(scope, realtimeBoardScopePrefix))
	logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
	if !isCanonicalUUID(logicGateID) || scope != realtimeBoardScope(boardID) {
		return ""
	}
	return boardID
}

func realtimeChatScope(nodeID string) string {
	return realtimeResourceScope(realtimeChatScopePrefix, nodeID)
}

func realtimeChatNodeIDFromScope(scope string) string {
	return realtimeResourceIDFromScope(scope, realtimeChatScopePrefix)
}

func realtimeNotificationScope(userID string) string {
	return realtimeResourceScope(realtimeNotificationScopePrefix, userID)
}

func realtimeNotificationUserIDFromScope(scope string) string {
	return realtimeResourceIDFromScope(scope, realtimeNotificationScopePrefix)
}

func realtimePersonalMailboxScope(userID, accountEmail string) string {
	userID = strings.TrimSpace(userID)
	accountEmail = normalizeEmailForCompare(accountEmail)
	if !isCanonicalUUID(userID) || !isRealtimeAccountEmail(accountEmail) {
		return ""
	}
	return realtimePersonalMailboxScopePrefix + userID + ":" + accountEmail
}

func realtimePersonalMailboxIdentityFromScope(scope string) (string, string) {
	scope = strings.TrimSpace(scope)
	if len(scope) > maxRealtimeScopeBytes || !strings.HasPrefix(scope, realtimePersonalMailboxScopePrefix) {
		return "", ""
	}
	identity := strings.TrimPrefix(scope, realtimePersonalMailboxScopePrefix)
	userID, accountEmail, ok := strings.Cut(identity, ":")
	accountEmail = normalizeEmailForCompare(accountEmail)
	if !ok || !isCanonicalUUID(userID) || !isRealtimeAccountEmail(accountEmail) || scope != realtimePersonalMailboxScope(userID, accountEmail) {
		return "", ""
	}
	return userID, accountEmail
}

func realtimeSharedMailboxScope(sharedInboxID string) string {
	return realtimeResourceScope(realtimeSharedMailboxScopePrefix, sharedInboxID)
}

func realtimeSharedMailboxIDFromScope(scope string) string {
	return realtimeResourceIDFromScope(scope, realtimeSharedMailboxScopePrefix)
}

func realtimeResourceScope(prefix, resourceID string) string {
	resourceID = strings.TrimSpace(resourceID)
	if !isCanonicalUUID(resourceID) {
		return ""
	}
	return prefix + resourceID
}

func realtimeResourceIDFromScope(scope, prefix string) string {
	scope = strings.TrimSpace(scope)
	if len(scope) > maxRealtimeScopeBytes || !strings.HasPrefix(scope, prefix) {
		return ""
	}
	resourceID := strings.TrimSpace(strings.TrimPrefix(scope, prefix))
	if !isCanonicalUUID(resourceID) || scope != prefix+resourceID {
		return ""
	}
	return resourceID
}

func isRealtimeAccountEmail(accountEmail string) bool {
	if accountEmail == "" || len(accountEmail) > 254 || accountEmail != normalizeEmailForCompare(accountEmail) || strings.Count(accountEmail, "@") != 1 {
		return false
	}
	at := strings.IndexByte(accountEmail, '@')
	if at <= 0 || at == len(accountEmail)-1 {
		return false
	}
	for _, char := range accountEmail {
		if char <= 0x20 || char == 0x7f {
			return false
		}
	}
	return true
}

func realtimeKnownScopePrefix(scope string) bool {
	for _, prefix := range []string{
		realtimeNotificationScopePrefix,
		realtimePersonalMailboxScopePrefix,
		realtimeSharedMailboxScopePrefix,
		realtimeChatScopePrefix,
		realtimeBoardScopePrefix,
	} {
		if strings.HasPrefix(strings.TrimSpace(scope), prefix) {
			return true
		}
	}
	return false
}

func realtimeScopeType(scope string) string {
	if realtimeNotificationUserIDFromScope(scope) != "" {
		return "notifications"
	}
	personalUserID, _ := realtimePersonalMailboxIdentityFromScope(scope)
	if personalUserID != "" || realtimeSharedMailboxIDFromScope(scope) != "" {
		return "mailbox"
	}
	if realtimeChatNodeIDFromScope(scope) != "" {
		return "chat"
	}
	if realtimeBoardIDFromScope(scope) != "" {
		return "board"
	}
	return ""
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
	for _, scopeType := range []string{"notifications", "mailbox", "chat", "board"} {
		s.recordOperationalMetric("realtime.active_subscriptions", scopeType, int64(counts[scopeType]), 0)
	}
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
	if c == nil || c.conn == nil {
		return net.ErrClosed
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.conn.SetWriteDeadline(time.Now().Add(realtimeWebSocketWriteTimeout)); err != nil {
		c.close()
		return err
	}
	defer func() {
		_ = c.conn.SetWriteDeadline(time.Time{})
	}()
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
		c.close()
		return err
	}
	if length == 0 {
		return nil
	}
	_, err := c.conn.Write(payload)
	if err != nil {
		c.close()
	}
	return err
}

func (c *realtimeConnection) close() {
	if c == nil || c.conn == nil {
		return
	}
	c.closeOnce.Do(func() {
		_ = c.conn.Close()
	})
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
