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
	"sync"
	"testing"
	"time"
)

func TestRealtimeWebSocketUnauthenticatedHandshakeRejected(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888001"
	repo.EnsureCompany(companyID, "Realtime Auth Co")
	server := NewServerWithOptions(repo, ServerOptions{AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{}}})
	defer server.Close()

	status := realtimeHandshakeStatusForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, "")
	if status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated websocket status = %d, want %d", status, http.StatusUnauthorized)
	}
}

func TestRealtimeWebSocketAuthenticatedHandshakeSendsReady(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888002"
	token := "ready-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "ready-user", domain.RoleCompanyUser)
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()

	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	ready := client.readJSON(t)
	if ready["type"] != realtimeMessageReady || ready["company_id"] != companyID || ready["user_id"] != user.UserID {
		t.Fatalf("ready = %+v, want ready for company/user", ready)
	}
	if ready["connection_id"] == "" {
		t.Fatalf("ready missing connection_id: %+v", ready)
	}
}

func TestRealtimeWebSocketTicketHandshakeSendsReady(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888010"
	token := "ticket-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "ticket-user", domain.RoleCompanyUser)
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()

	ticket := mintRealtimeTicketForTest(t, server.Routes(), companyID, token)
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID+"&ticket="+url.QueryEscape(ticket), "")
	defer client.close()

	ready := client.readJSON(t)
	if ready["type"] != realtimeMessageReady || ready["company_id"] != companyID || ready["user_id"] != user.UserID {
		t.Fatalf("ticket ready = %+v, want ready for company/user", ready)
	}
}

func TestRealtimeWebSocketNormalAccessTokenQueryRejected(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888011"
	token := "query-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "query-token-user", domain.RoleCompanyUser)
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()

	status := realtimeHandshakeStatusForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID+"&access_token="+url.QueryEscape(token), "")
	if status != http.StatusUnauthorized {
		t.Fatalf("access_token query websocket status = %d, want %d", status, http.StatusUnauthorized)
	}
}

func TestRealtimeWebSocketUnauthorizedSubscriptionRejectedAndNotStored(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888003"
	token := "rejected-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "rejected-user", domain.RoleCompanyUser)
	logicGate, err := repo.CreateLogicGate(companyID, "Hidden realtime gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()

	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	ready := client.readJSON(t)
	connectionID := ready["connection_id"].(string)
	scope := realtimeBoardScope(store.LogicGateKanbanBoardID(logicGate.LogicGateID))
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})

	rejected := client.readJSON(t)
	if rejected["type"] != realtimeMessageSubscriptionRejected || rejected["scope"] != scope {
		t.Fatalf("subscription rejected message = %+v, want rejection for %s", rejected, scope)
	}
	if server.realtimeRegistry.hasSubscription(connectionID, companyID, scope) {
		t.Fatalf("unauthorized subscription was stored")
	}
}

func TestRealtimeWebSocketAuthorizedSubscriptionAcceptedAndStored(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888004"
	token := "accepted-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "accepted-user", domain.RoleCompanyUser)
	logicGate, err := repo.CreateLogicGate(companyID, "Visible realtime gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()

	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	ready := client.readJSON(t)
	connectionID := ready["connection_id"].(string)
	scope := realtimeBoardScope(store.LogicGateKanbanBoardID(logicGate.LogicGateID))
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})

	accepted := client.readJSON(t)
	if accepted["type"] != realtimeMessageSubscriptionAccepted || accepted["scope"] != scope {
		t.Fatalf("subscription accepted message = %+v, want accepted for %s", accepted, scope)
	}
	if !server.realtimeRegistry.hasSubscription(connectionID, companyID, scope) {
		t.Fatalf("authorized subscription was not stored")
	}
}

func TestRealtimeWebSocketKanbanBoardSubscriptionAuthorizationRequiresEditAccess(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &recordingRealtimeAccessRepo{Repository: base}
	companyID := "88888888-8888-4888-8888-888888888007"
	token := "edit-subscription-token"
	base.EnsureCompany(companyID, "Realtime Edit Auth Co")
	user := mustRealtimeAuthUser(t, base, companyID, "edit-subscription-user", domain.RoleCompanyUser)
	logicGate, err := base.CreateLogicGate(companyID, "Edit required realtime gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	server := NewServerWithOptions(repo, ServerOptions{AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
		token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
	}}})
	defer server.Close()

	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	scope := realtimeBoardScope(store.LogicGateKanbanBoardID(logicGate.LogicGateID))
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})

	accepted := client.readJSON(t)
	if accepted["type"] != realtimeMessageSubscriptionAccepted || accepted["scope"] != scope {
		t.Fatalf("subscription accepted message = %+v, want accepted for %s", accepted, scope)
	}
	if !repo.sawAccessCheck(store.EntityTypeLogicGate, store.EntityPermissionEdit) {
		t.Fatalf("subscription authorization access checks = %+v, want logic_gate edit", repo.accessChecks())
	}
	if repo.sawAccessCheck(store.EntityTypeLogicGate, store.EntityPermissionView) {
		t.Fatalf("subscription authorization used view access: %+v", repo.accessChecks())
	}
}

func TestRealtimeWebSocketCloseRemovesSubscriptions(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888005"
	token := "cleanup-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "cleanup-user", domain.RoleCompanyAdmin)
	logicGate, err := repo.CreateLogicGate(companyID, "Cleanup realtime gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()

	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	ready := client.readJSON(t)
	connectionID := ready["connection_id"].(string)
	scope := realtimeBoardScope(store.LogicGateKanbanBoardID(logicGate.LogicGateID))
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)
	if !server.realtimeRegistry.hasSubscription(connectionID, companyID, scope) {
		t.Fatalf("subscription was not stored before close")
	}
	client.close()
	waitForRealtimeCondition(t, func() bool {
		return server.realtimeRegistry.connectionSubscriptionCount(connectionID) == 0 &&
			server.realtimeRegistry.scopeSubscriptionCount(companyID, scope) == 0
	})
}

func TestRealtimeWebSocketKanbanBoardDeltaRoutesOnlyToSubscribedBoard(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888006"
	tokenA := "board-a-token"
	tokenB := "board-b-token"
	userA := mustRealtimeAuthUser(t, repo, companyID, "board-a-user", domain.RoleCompanyAdmin)
	userB := mustRealtimeAuthUser(t, repo, companyID, "board-b-user", domain.RoleCompanyAdmin)
	server := NewServerWithOptions(repo, ServerOptions{AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
		tokenA: {Subject: "board-a-user", Email: "board-a-user@example.com", Name: "Board A User"},
		tokenB: {Subject: "board-b-user", Email: "board-b-user@example.com", Name: "Board B User"},
	}}})
	defer server.Close()
	if userA.UserID == "" || userB.UserID == "" {
		t.Fatal("users were not created")
	}

	logicGateA, err := repo.CreateLogicGate(companyID, "Realtime Board A")
	if err != nil {
		t.Fatalf("CreateLogicGate A: %v", err)
	}
	nodeA, err := repo.CreateNode(companyID, "Realtime Node A")
	if err != nil {
		t.Fatalf("CreateNode A: %v", err)
	}
	priority := 2
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGateA.LogicGateID,
		NodeID:      nodeA.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus A: %v", err)
	}
	logicGateB, err := repo.CreateLogicGate(companyID, "Realtime Board B")
	if err != nil {
		t.Fatalf("CreateLogicGate B: %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Realtime Node B")
	if err != nil {
		t.Fatalf("CreateNode B: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGateB.LogicGateID,
		NodeID:      nodeB.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus B: %v", err)
	}

	clientA := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, tokenA)
	defer clientA.close()
	clientB := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, tokenB)
	defer clientB.close()
	clientA.readJSON(t)
	clientB.readJSON(t)

	boardA := store.LogicGateKanbanBoardID(logicGateA.LogicGateID)
	boardB := store.LogicGateKanbanBoardID(logicGateB.LogicGateID)
	scopeA := realtimeBoardScope(boardA)
	scopeB := realtimeBoardScope(boardB)
	clientA.writeJSON(t, map[string]any{"type": "subscribe", "scope": scopeA})
	clientB.writeJSON(t, map[string]any{"type": "subscribe", "scope": scopeB})
	clientA.readJSON(t)
	clientB.readJSON(t)

	rowsA, err := repo.ListKanbanBoardProjectionRowsForNode(companyID, nodeA.NodeID)
	if err != nil {
		t.Fatalf("ListKanbanBoardProjectionRowsForNode A: %v", err)
	}
	server.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rowsA))

	deltaA := clientA.readJSON(t)
	if deltaA["type"] != realtimeMessageProjectionDelta || deltaA["scope"] != scopeA || deltaA["sequence"].(float64) <= 0 {
		t.Fatalf("board A delta = %+v, want scoped projection delta", deltaA)
	}
	clientB.assertNoMessage(t)

	rowsB, err := repo.ListKanbanBoardProjectionRowsForNode(companyID, nodeB.NodeID)
	if err != nil {
		t.Fatalf("ListKanbanBoardProjectionRowsForNode B: %v", err)
	}
	server.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rowsB))

	deltaB := clientB.readJSON(t)
	if deltaB["type"] != realtimeMessageProjectionDelta || deltaB["scope"] != scopeB || deltaB["sequence"].(float64) <= 0 {
		t.Fatalf("board B delta = %+v, want scoped projection delta", deltaB)
	}
	clientA.assertNoMessage(t)
}

func TestRealtimeWebSocketKanbanBoardDeltaFiltersPerUserForSameBoard(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888008"
	tokenVisible := "same-board-visible-token"
	tokenBlocked := "same-board-blocked-token"
	repo.EnsureCompany(companyID, "Realtime Same Board Filter Co")
	visible := mustRealtimeAuthUser(t, repo, companyID, "same-board-visible", domain.RoleCompanyUser)
	blocked := mustRealtimeAuthUser(t, repo, companyID, "same-board-blocked", domain.RoleCompanyUser)
	server := NewServerWithOptions(repo, ServerOptions{AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
		tokenVisible: {Subject: visible.CognitoSubject, Email: visible.Email, Name: visible.DisplayName},
		tokenBlocked: {Subject: blocked.CognitoSubject, Email: blocked.Email, Name: blocked.DisplayName},
	}}})
	defer server.Close()

	logicGate, err := repo.CreateLogicGate(companyID, "Per-user realtime gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Per-user realtime node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	assigned, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    testPriority(2),
		PrioritySet: true,
		ActorUserID: visible.UserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: visible.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: blocked.UserID, AccessLevel: store.EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions logic gate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   visible.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions node: %v", err)
	}

	clientVisible := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, tokenVisible)
	defer clientVisible.close()
	clientBlocked := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, tokenBlocked)
	defer clientBlocked.close()
	clientVisible.readJSON(t)
	clientBlocked.readJSON(t)
	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	scope := realtimeBoardScope(boardID)
	clientVisible.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	clientBlocked.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	clientVisible.readJSON(t)
	clientBlocked.readJSON(t)

	rows, err := repo.ListKanbanBoardProjectionRowsForNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListKanbanBoardProjectionRowsForNode: %v", err)
	}
	server.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rows))

	visibleDelta := clientVisible.readProjectionDelta(t)
	blockedDelta := clientBlocked.readProjectionDelta(t)
	if visibleDelta.Scope != scope || blockedDelta.Scope != scope || visibleDelta.Sequence <= 0 || blockedDelta.Sequence != visibleDelta.Sequence {
		t.Fatalf("realtime sequences visible=%+v blocked=%+v, want same scoped board sequence", visibleDelta, blockedDelta)
	}
	if len(visibleDelta.Deltas) != 1 {
		t.Fatalf("visible delta = %+v, want one delta", visibleDelta.Deltas)
	}
	if got := visibleDelta.Deltas[0]; got.Operation != store.ProjectionDeltaOperationUpsert || got.Row == nil || got.Row.CardID != assigned.Card.CardID {
		t.Fatalf("visible delta = %+v, want upsert row for visible card", visibleDelta.Deltas)
	}
	if len(blockedDelta.Deltas) != 1 {
		t.Fatalf("blocked delta = %+v, want one delta", blockedDelta.Deltas)
	}
	if got := blockedDelta.Deltas[0]; got.Operation != store.ProjectionDeltaOperationDelete || got.Row != nil || got.RowKey.CardID != assigned.Card.CardID || got.RowKey.BoardID != boardID {
		t.Fatalf("blocked delta = %+v, want delete without row payload", blockedDelta.Deltas)
	}
}

func TestRealtimeWebSocketKanbanBoardDeltaHidesInaccessibleCardAsDeleteWithoutRowPayload(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888009"
	token := "hidden-card-token"
	repo.EnsureCompany(companyID, "Realtime Hidden Card Co")
	user := mustRealtimeAuthUser(t, repo, companyID, "hidden-card-user", domain.RoleCompanyUser)
	logicGate, err := repo.CreateLogicGate(companyID, "Visible gate hidden card")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Hidden card node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	assigned, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    testPriority(3),
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions node: %v", err)
	}
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()

	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	scope := realtimeBoardScope(boardID)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)

	rows, err := repo.ListKanbanBoardProjectionRowsForNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListKanbanBoardProjectionRowsForNode: %v", err)
	}
	server.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rows))

	message := client.readProjectionDelta(t)
	if message.Scope != scope || message.Projection != store.ProjectionNameKanbanBoard || len(message.Deltas) != 1 {
		t.Fatalf("hidden card delta = %+v, want one scoped Kanban delta", message)
	}
	if got := message.Deltas[0]; got.Operation != store.ProjectionDeltaOperationDelete || got.Row != nil || got.RowKey.CardID != assigned.Card.CardID || got.RowKey.NodeID != node.NodeID {
		t.Fatalf("hidden card delta = %+v, want delete row key only", got)
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

type realtimeAccessCheckForTest struct {
	ResourceType string
	AccessLevel  string
}

type recordingRealtimeAccessRepo struct {
	store.Repository
	mu     sync.Mutex
	checks []realtimeAccessCheckForTest
}

func (r *recordingRealtimeAccessRepo) UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel string) (bool, error) {
	r.mu.Lock()
	r.checks = append(r.checks, realtimeAccessCheckForTest{ResourceType: resourceType, AccessLevel: accessLevel})
	r.mu.Unlock()
	return r.Repository.UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel)
}

func (r *recordingRealtimeAccessRepo) sawAccessCheck(resourceType, accessLevel string) bool {
	for _, check := range r.accessChecks() {
		if check.ResourceType == resourceType && check.AccessLevel == accessLevel {
			return true
		}
	}
	return false
}

func (r *recordingRealtimeAccessRepo) accessChecks() []realtimeAccessCheckForTest {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]realtimeAccessCheckForTest, len(r.checks))
	copy(out, r.checks)
	return out
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

func openRealtimeHandshakeForTest(t *testing.T, handler http.Handler, target, token string) (net.Conn, *bufio.Reader, *http.Response) {
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

func mintRealtimeTicketForTest(t *testing.T, handler http.Handler, companyID, token string) string {
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
		Ticket string `json:"ticket"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode realtime ticket: %v", err)
	}
	if payload.Ticket == "" {
		t.Fatalf("empty realtime ticket")
	}
	return payload.Ticket
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

func (c *realtimeWSClientForTest) readProjectionDelta(t *testing.T) realtimeProjectionDeltaMessage {
	t.Helper()
	frame, ok := c.readFrame(t, time.Second)
	if !ok {
		t.Fatal("timed out waiting for websocket projection delta")
	}
	if frame.opcode != webSocketOpcodeText {
		t.Fatalf("websocket opcode = %d, want text", frame.opcode)
	}
	var payload realtimeProjectionDeltaMessage
	if err := json.Unmarshal(frame.payload, &payload); err != nil {
		t.Fatalf("decode websocket projection delta: %v payload=%s", err, string(frame.payload))
	}
	if payload.Type != realtimeMessageProjectionDelta {
		t.Fatalf("websocket message = %+v, want projection delta", payload)
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
