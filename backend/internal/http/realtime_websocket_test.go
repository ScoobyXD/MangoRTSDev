package httpapi

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestRealtimeWebSocketAuthenticatedHandshakeSendsReady(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	token := "realtime-ready-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "realtime-ready", domain.RoleCompanyUser)
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	ready := client.readJSON(t)
	if ready["type"] != realtimeMessageReady || ready["company_id"] != companyID || ready["user_id"] != user.UserID {
		t.Fatalf("ready message = %+v", ready)
	}
}

func TestRealtimeWebSocketTicketHandshakeSendsReady(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "12121212-1212-4121-8121-121212121212"
	token := "realtime-ticket-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "realtime-ticket", domain.RoleCompanyUser)
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:        &tokenClaimsValidator{claims: map[string]auth.Claims{token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName}}},
		RealtimeTicketSecret: "test-realtime-ticket-secret",
	})
	defer server.Close()
	cookie := mintRealtimeTicketCookieForTest(t, server.Routes(), companyID, token)
	client := openRealtimeWebSocketWithCookieForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, cookie)
	defer client.close()
	if message := client.readJSON(t); message["type"] != realtimeMessageReady {
		t.Fatalf("ticket ready message = %+v", message)
	}
}

func TestRealtimeWebSocketOnlyAllowsNotificationChatAndBoardScopes(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222222"
	token := "realtime-scopes-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "realtime-scopes", domain.RoleCompanyUser)
	node, err := repo.CreateNode(companyID, "Chat node")
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Board gate")
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []store.EntityPermissionUpdateInput{
		{CompanyID: companyID, EntityType: store.EntityTypeNode, EntityID: node.NodeID, Permissions: []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: store.EntityPermissionEdit}}},
		{CompanyID: companyID, EntityType: store.EntityTypeLogicGate, EntityID: gate.LogicGateID, Permissions: []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: store.EntityPermissionView}}},
	} {
		if _, err := repo.SetEntityPermissions(input); err != nil {
			t.Fatal(err)
		}
	}
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	allowed := []string{realtimeNotificationScope(user.UserID), realtimeChatScope(node.NodeID), realtimeBoardScope(store.LogicGateKanbanBoardID(gate.LogicGateID))}
	for _, scope := range allowed {
		client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": scope})
		message := client.readJSON(t)
		if message["type"] != realtimeMessageSubscriptionAccepted || message["scope"] != scope {
			t.Fatalf("scope %s response = %+v", scope, message)
		}
	}
	forbidden := []string{
		"workspace:user:" + user.UserID, "company_explorer:user:" + user.UserID,
		"node_graph:user:" + user.UserID, "logic_gate_graph:user:" + user.UserID,
		"gvic_matrix:user:" + user.UserID, "project_management:user:" + user.UserID,
		"communications:user:" + user.UserID, "editor:node:" + node.NodeID,
	}
	for _, scope := range forbidden {
		client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": scope})
		message := client.readJSON(t)
		if message["type"] != realtimeMessageSubscriptionRejected || message["error"] != "unsupported_scope" {
			t.Fatalf("forbidden scope %s response = %+v", scope, message)
		}
	}
}

func TestRealtimeNodeChatCreateDeletePublishesOnlyNodeScope(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333333"
	token := "realtime-chat-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "realtime-chat", domain.RoleCompanyUser)
	node, err := repo.CreateNode(companyID, "Realtime chat node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: companyID, EntityType: store.EntityTypeNode, EntityID: node.NodeID, Permissions: []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: store.EntityPermissionEdit}}}); err != nil {
		t.Fatal(err)
	}
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	scope := realtimeChatScope(node.NodeID)
	client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": scope})
	client.readJSON(t)
	messageID := "44444444-4444-4444-8444-444444444444"
	blockID := "55555555-5555-4555-8555-555555555555"
	body, _ := json.Marshal(map[string]any{"company_id": companyID, "type": "Text block chat", "information_id": messageID, "information": `{"block_id":"` + blockID + `","author_name":"User","message":"Hello"}`})
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("chat create status=%d body=%s", rec.Code, rec.Body.String())
	}
	created := client.readJSON(t)
	if created["type"] != realtimeMessageChatCreated || created["scope"] != scope || created["node_id"] != node.NodeID || created["block_id"] != blockID || created["message_id"] != messageID {
		t.Fatalf("created chat message = %+v", created)
	}
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+node.NodeID+"/projection/"+messageID+"?company_id="+companyID, nil)
	deleteReq.Header.Set("Authorization", "Bearer "+token)
	deleteRec := httptest.NewRecorder()
	server.Routes().ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("chat delete status=%d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
	deleted := client.readJSON(t)
	if deleted["type"] != realtimeMessageChatDeleted || deleted["scope"] != scope || deleted["message_id"] != messageID {
		t.Fatalf("deleted chat message = %+v", deleted)
	}
}

func TestRealtimeKanbanCommittedEventsPublishOnlyMountedBoardScope(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666666"
	token := "realtime-board-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "realtime-board", domain.RoleCompanyUser)
	gate, err := repo.CreateLogicGate(companyID, "Realtime board gate")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Realtime board node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: companyID, EntityType: store.EntityTypeLogicGate, EntityID: gate.LogicGateID, Permissions: []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: store.EntityPermissionView}}}); err != nil {
		t.Fatal(err)
	}
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	boardID := store.LogicGateKanbanBoardID(gate.LogicGateID)
	scope := realtimeBoardScope(boardID)
	client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": scope})
	client.readJSON(t)
	priority := 1
	result, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "pending", Priority: &priority, PrioritySet: true})
	if err != nil {
		t.Fatal(err)
	}
	server.publishCommittedWorkspaceEvents(result.Events)
	message := client.readJSON(t)
	if message["type"] != realtimeMessageKanbanChanged || message["scope"] != scope || message["board_id"] != boardID {
		t.Fatalf("kanban message = %+v", message)
	}
	_, event, err := repo.UpdateNodeAndWorkspaceEvent(store.UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Title: "Renamed board node", TitleSet: true})
	if err != nil {
		t.Fatal(err)
	}
	server.publishCommittedWorkspaceEvent(event)
	renamed := client.readJSON(t)
	if renamed["type"] != realtimeMessageKanbanChanged || renamed["board_id"] != boardID || renamed["change_type"] != "node_updated" {
		t.Fatalf("node rename kanban message = %+v", renamed)
	}
	server.publishKanbanChanged(companyID, "99999999-9999-4999-8999-999999999999", "unmounted_change")
	client.assertNoMessage(t)
}

func TestRealtimeNotificationCreatePublishesOnlyRecipientScope(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777777"
	token := "realtime-notification-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "realtime-notification", domain.RoleCompanyUser)
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	scope := realtimeNotificationScope(user.UserID)
	client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": scope})
	client.readJSON(t)
	items, err := repo.CreateNotifications(store.CreateNotificationsInput{Notifications: []store.NotificationCreateInput{{CompanyID: companyID, RecipientUserID: user.UserID, Type: domain.NotificationEventMentionCreated, SourceEventID: "88888888-8888-4888-8888-888888888888", EntityType: store.EntityTypeNode, EntityID: "node", Title: "Mention"}}})
	if err != nil {
		t.Fatal(err)
	}
	server.publishNotifications(items)
	message := client.readJSON(t)
	if message["type"] != realtimeMessageNotificationCreated || message["scope"] != scope {
		t.Fatalf("notification message = %+v", message)
	}
}
func mustRealtimeAuthUser(t *testing.T, repo *store.MemoryRepo, companyID, subject, role string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", strings.ReplaceAll(subject, "-", " "))
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, role); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func newRealtimeAuthServerForTest(repo *store.MemoryRepo, token string, user domain.User) *Server {
	return NewServerWithOptions(repo, ServerOptions{AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
		token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
	}}})
}

type realtimeWSClientForTest struct {
	conn   net.Conn
	reader *bufio.Reader
}

func realtimeHandshakeStatusForTest(t *testing.T, handler http.Handler, target, token string) int {
	t.Helper()
	conn, reader, resp := openRealtimeHandshakeForTest(t, handler, target, token)
	defer conn.Close()
	defer resp.Body.Close()
	_ = reader
	return resp.StatusCode
}

func openRealtimeWebSocketForTest(t *testing.T, handler http.Handler, target, token string) *realtimeWSClientForTest {
	t.Helper()
	conn, reader, resp := openRealtimeHandshakeForTest(t, handler, target, token)
	if resp.StatusCode != http.StatusSwitchingProtocols {
		body, _ := io.ReadAll(resp.Body)
		_ = conn.Close()
		t.Fatalf("websocket handshake status = %d body=%s", resp.StatusCode, string(body))
	}
	return &realtimeWSClientForTest{conn: conn, reader: reader}
}

func openRealtimeWebSocketWithCookieForTest(t *testing.T, handler http.Handler, target string, cookie *http.Cookie) *realtimeWSClientForTest {
	t.Helper()
	conn, reader, resp := openRealtimeHandshakeForTestWithCookie(t, handler, target, "", cookie)
	if resp.StatusCode != http.StatusSwitchingProtocols {
		body, _ := io.ReadAll(resp.Body)
		_ = conn.Close()
		t.Fatalf("websocket handshake status = %d body=%s", resp.StatusCode, string(body))
	}
	return &realtimeWSClientForTest{conn: conn, reader: reader}
}

func openRealtimeHandshakeForTest(t *testing.T, handler http.Handler, target, token string) (net.Conn, *bufio.Reader, *http.Response) {
	return openRealtimeHandshakeForTestWithCookie(t, handler, target, token, nil)
}

func openRealtimeHandshakeForTestWithCookie(t *testing.T, handler http.Handler, target, token string, cookie *http.Cookie) (net.Conn, *bufio.Reader, *http.Response) {
	t.Helper()
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)
	parsed, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	conn, err := net.DialTimeout("tcp", parsed.Host, time.Second)
	if err != nil {
		t.Fatalf("dial websocket server: %v", err)
	}
	key := randomWebSocketKeyForTest(t)
	var request strings.Builder
	request.WriteString("GET " + target + " HTTP/1.1\r\n")
	request.WriteString("Host: " + parsed.Host + "\r\n")
	request.WriteString("Upgrade: websocket\r\n")
	request.WriteString("Connection: Upgrade\r\n")
	request.WriteString("Sec-WebSocket-Key: " + key + "\r\n")
	request.WriteString("Sec-WebSocket-Version: 13\r\n")
	if token != "" {
		request.WriteString("Authorization: Bearer " + token + "\r\n")
	}
	if cookie != nil {
		request.WriteString("Cookie: " + cookie.String() + "\r\n")
	}
	request.WriteString("\r\n")
	if _, err := conn.Write([]byte(request.String())); err != nil {
		_ = conn.Close()
		t.Fatalf("write websocket handshake: %v", err)
	}
	reader := bufio.NewReader(conn)
	req, err := http.NewRequest(http.MethodGet, "http://"+parsed.Host+target, nil)
	if err != nil {
		_ = conn.Close()
		t.Fatalf("new response request: %v", err)
	}
	resp, err := http.ReadResponse(reader, req)
	if err != nil {
		_ = conn.Close()
		t.Fatalf("read websocket handshake response: %v", err)
	}
	return conn, reader, resp
}

func mintRealtimeTicketCookieForTest(t *testing.T, handler http.Handler, companyID, token string) *http.Cookie {
	t.Helper()
	ts := httptest.NewServer(handler)
	defer ts.Close()
	body := bytes.NewBufferString(`{"company_id":"` + companyID + `"}`)
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/v1/realtime/ticket", body)
	if err != nil {
		t.Fatalf("new ticket request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request realtime ticket: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("ticket status = %d body=%s", resp.StatusCode, string(payload))
	}
	var payload struct {
		Ticket    string `json:"ticket"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode realtime ticket: %v", err)
	}
	if payload.Ticket != "" {
		t.Fatalf("ticket response leaked query credential: %+v", payload)
	}
	if payload.ExpiresAt == "" {
		t.Fatalf("ticket response missing expires_at")
	}
	for _, cookie := range resp.Cookies() {
		if cookie.Name == realtimeTicketCookieName && cookie.Value != "" {
			return cookie
		}
	}
	t.Fatalf("ticket response missing %s cookie", realtimeTicketCookieName)
	return nil
}

func randomWebSocketKeyForTest(t *testing.T) string {
	t.Helper()
	var key [16]byte
	if _, err := rand.Read(key[:]); err != nil {
		t.Fatalf("rand websocket key: %v", err)
	}
	return base64.StdEncoding.EncodeToString(key[:])
}

func (c *realtimeWSClientForTest) writeJSON(t *testing.T, value any) {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal websocket payload: %v", err)
	}
	if err := c.writeFrame(webSocketOpcodeText, payload); err != nil {
		t.Fatalf("write websocket payload: %v", err)
	}
}

func (c *realtimeWSClientForTest) writeFrame(opcode byte, payload []byte) error {
	header := []byte{0x80 | (opcode & 0x0F)}
	length := len(payload)
	switch {
	case length < 126:
		header = append(header, 0x80|byte(length))
	case length <= 0xFFFF:
		header = append(header, 0x80|126, byte(length>>8), byte(length))
	default:
		header = append(header, 0x80|127)
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(length))
		header = append(header, size[:]...)
	}
	var mask [4]byte
	if _, err := rand.Read(mask[:]); err != nil {
		return err
	}
	masked := make([]byte, len(payload))
	for index := range payload {
		masked[index] = payload[index] ^ mask[index%4]
	}
	if _, err := c.conn.Write(header); err != nil {
		return err
	}
	if _, err := c.conn.Write(mask[:]); err != nil {
		return err
	}
	if len(masked) == 0 {
		return nil
	}
	_, err := c.conn.Write(masked)
	return err
}

func (c *realtimeWSClientForTest) readJSON(t *testing.T) map[string]any {
	t.Helper()
	frame, ok := c.readFrame(t, time.Second)
	if !ok {
		t.Fatal("timed out waiting for websocket JSON message")
	}
	if frame.opcode != webSocketOpcodeText {
		t.Fatalf("websocket opcode = %d, want text", frame.opcode)
	}
	var payload map[string]any
	if err := json.Unmarshal(frame.payload, &payload); err != nil {
		t.Fatalf("decode websocket JSON: %v payload=%s", err, string(frame.payload))
	}
	return payload
}

func (c *realtimeWSClientForTest) assertNoMessage(t *testing.T) {
	t.Helper()
	if frame, ok := c.readFrame(t, 50*time.Millisecond); ok {
		t.Fatalf("unexpected websocket message opcode=%d payload=%s", frame.opcode, string(frame.payload))
	}
}

func (c *realtimeWSClientForTest) readFrame(t *testing.T, timeout time.Duration) (webSocketFrame, bool) {
	t.Helper()
	if err := c.conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	defer c.conn.SetReadDeadline(time.Time{})
	frame, err := readWebSocketFrame(c.reader, false)
	if err != nil {
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			return webSocketFrame{}, false
		}
		t.Fatalf("read websocket frame: %v", err)
	}
	return frame, true
}

func (c *realtimeWSClientForTest) close() {
	_ = c.writeFrame(webSocketOpcodeClose, nil)
	_ = c.conn.Close()
}

func waitForRealtimeCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("condition was not met before timeout")
}
