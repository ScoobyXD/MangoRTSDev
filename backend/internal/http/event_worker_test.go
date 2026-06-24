package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEventWorkerPublishesKanbanDeltaNotRequestPath(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777601"
	token := "event-worker-request-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "event-worker-request-user", domain.RoleCompanyAdmin)
	logicGate, err := repo.CreateLogicGate(companyID, "Request path worker gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Request path worker node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	server := newEventWorkerAuthServerForTest(repo, token, user)
	defer server.Close()

	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	scope := realtimeBoardScope(boardID)
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)

	body := map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"column_id":  "pending",
		"node_id":    node.NodeID,
		"priority":   2,
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/kanban/cards status = %d body=%s", rec.Code, rec.Body.String())
	}
	client.assertNoMessage(t)

	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed == 0 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v, want event processed", processed, err)
	}
	delta := client.readProjectionDelta(t)
	if delta.Type != realtimeMessageProjectionDelta || delta.Scope != scope || len(delta.Deltas) != 1 {
		t.Fatalf("worker delta = %+v, want one board-scoped projection delta", delta)
	}
}

func TestEventWorkerKanbanDeltaRoutesByBoardAndFiltersPerUser(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777602"
	tokenVisible := "event-worker-visible-token"
	tokenBlocked := "event-worker-blocked-token"
	visible := mustRealtimeAuthUser(t, repo, companyID, "event-worker-visible", domain.RoleCompanyUser)
	blocked := mustRealtimeAuthUser(t, repo, companyID, "event-worker-blocked", domain.RoleCompanyUser)
	logicGate, err := repo.CreateLogicGate(companyID, "Worker filtered gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Worker filtered node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
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
	drainEventRowsForTest(t, repo, companyID)
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			tokenVisible: {Subject: visible.CognitoSubject, Email: visible.Email, Name: visible.DisplayName},
			tokenBlocked: {Subject: blocked.CognitoSubject, Email: blocked.Email, Name: blocked.DisplayName},
		}},
		DisableEventWorker: true,
	})
	defer server.Close()

	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	scope := realtimeBoardScope(boardID)
	clientVisible := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, tokenVisible)
	defer clientVisible.close()
	clientBlocked := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, tokenBlocked)
	defer clientBlocked.close()
	clientVisible.readJSON(t)
	clientBlocked.readJSON(t)
	clientVisible.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	clientBlocked.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	clientVisible.readJSON(t)
	clientBlocked.readJSON(t)

	assigned, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    testPriority(2),
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed == 0 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v", processed, err)
	}
	visibleDelta := clientVisible.readProjectionDelta(t)
	blockedDelta := clientBlocked.readProjectionDelta(t)
	if got := visibleDelta.Deltas[0]; got.Operation != store.ProjectionDeltaOperationUpsert || got.Row == nil || got.Row.CardID != assigned.Card.CardID {
		t.Fatalf("visible worker delta = %+v, want upsert", visibleDelta.Deltas)
	}
	if got := blockedDelta.Deltas[0]; got.Operation != store.ProjectionDeltaOperationDelete || got.Row != nil || got.RowKey.CardID != assigned.Card.CardID {
		t.Fatalf("blocked worker delta = %+v, want delete without row", blockedDelta.Deltas)
	}
}

func TestEventWorkerPublishesGVICMatrixDeltaToUserScopeOnly(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777605"
	tokenA := "event-worker-GVICMatrix-a-token"
	tokenB := "event-worker-GVICMatrix-b-token"
	userA := mustRealtimeAuthUser(t, repo, companyID, "event-worker-GVICMatrix-a", domain.RoleCompanyUser)
	userB := mustRealtimeAuthUser(t, repo, companyID, "event-worker-GVICMatrix-b", domain.RoleCompanyUser)
	logicGate, err := repo.CreateLogicGate(companyID, "Worker GVICMatrix gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Worker GVICMatrix node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      store.LogicGateWorkStatusPending,
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			tokenA: {Subject: userA.CognitoSubject, Email: userA.Email, Name: userA.DisplayName},
			tokenB: {Subject: userB.CognitoSubject, Email: userB.Email, Name: userB.DisplayName},
		}},
		DisableEventWorker: true,
	})
	defer server.Close()

	clientA := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, tokenA)
	defer clientA.close()
	clientB := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, tokenB)
	defer clientB.close()
	clientA.readJSON(t)
	clientB.readJSON(t)
	scopeA := realtimeGVICMatrixScope(userA.UserID)
	scopeB := realtimeGVICMatrixScope(userB.UserID)
	clientA.writeJSON(t, map[string]any{"type": "subscribe", "scope": scopeA})
	clientB.writeJSON(t, map[string]any{"type": "subscribe", "scope": scopeB})
	clientA.readJSON(t)
	clientB.readJSON(t)

	if _, err := repo.AddLogicGateGVICAssignments(store.LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		ActorUserID: userA.UserID,
		Assignments: []store.LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: userA.UserID,
		}},
	}); err != nil {
		t.Fatalf("AddLogicGateGVICAssignments: %v", err)
	}
	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed == 0 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v", processed, err)
	}
	delta := clientA.readProjectionDelta(t)
	if delta.Scope != scopeA || delta.Projection != store.ProjectionNameGVICMatrix || len(delta.Deltas) != 1 {
		t.Fatalf("GVICMatrix worker delta = %+v, want user A scoped delta", delta)
	}
	if got := delta.Deltas[0]; got.Operation != store.ProjectionDeltaOperationUpsert || got.Row == nil || got.Row.UserID != userA.UserID {
		t.Fatalf("GVICMatrix worker delta payload = %+v, want upsert for user A", delta.Deltas)
	}
	clientB.assertNoMessage(t)
}

func TestEventWorkerGVICMatrixPermissionLossSendsDeleteWithoutRowPayload(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777606"
	token := "event-worker-GVICMatrix-delete-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "event-worker-GVICMatrix-delete", domain.RoleCompanyUser)
	logicGate, err := repo.CreateLogicGate(companyID, "Worker GVICMatrix delete gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Worker GVICMatrix delete node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      store.LogicGateWorkStatusPending,
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.AddLogicGateGVICAssignments(store.LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: user.UserID,
		}},
	}); err != nil {
		t.Fatalf("AddLogicGateGVICAssignments: %v", err)
	}
	drainEventRowsForTest(t, repo, companyID)
	server := newEventWorkerAuthServerForTest(repo, token, user)
	defer server.Close()

	scope := realtimeGVICMatrixScope(user.UserID)
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}
	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed == 0 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v", processed, err)
	}
	delta := client.readProjectionDelta(t)
	if delta.Scope != scope || delta.Projection != store.ProjectionNameGVICMatrix || len(delta.Deltas) != 1 {
		t.Fatalf("GVICMatrix permission delta = %+v, want one scoped delta", delta)
	}
	got := delta.Deltas[0]
	if got.Operation != store.ProjectionDeltaOperationDelete || got.Row != nil || got.RowKey.ResourceType != store.EntityTypeLogicGate || got.RowKey.ResourceID != logicGate.LogicGateID {
		t.Fatalf("GVICMatrix permission delta payload = %+v, want logic gate delete without row payload", got)
	}
}

func TestEventWorkerPublishesEditorDeltaToResourceScopeOnly(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777607"
	token := "event-worker-editor-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "event-worker-editor-user", domain.RoleCompanyAdmin)
	nodeA, err := repo.CreateNode(companyID, "Worker editor node A")
	if err != nil {
		t.Fatalf("CreateNode A: %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Worker editor node B")
	if err != nil {
		t.Fatalf("CreateNode B: %v", err)
	}
	server := newEventWorkerAuthServerForTest(repo, token, user)
	defer server.Close()

	clientA := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer clientA.close()
	clientB := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer clientB.close()
	clientA.readJSON(t)
	clientB.readJSON(t)
	scopeA := store.EditorRealtimeScope(store.EntityTypeNode, nodeA.NodeID)
	scopeB := store.EditorRealtimeScope(store.EntityTypeNode, nodeB.NodeID)
	clientA.writeJSON(t, map[string]any{"type": "subscribe", "scope": scopeA})
	clientB.writeJSON(t, map[string]any{"type": "subscribe", "scope": scopeB})
	clientA.readJSON(t)
	clientB.readJSON(t)

	informationID := "77777777-7777-4777-8777-777777777608"
	if _, err := repo.AddNodeInformationWithActor(store.NodeInformationInput{
		CompanyID:     companyID,
		NodeID:        nodeA.NodeID,
		InformationID: informationID,
		Type:          "Text block chat",
		Information:   "chat update",
		ActorUserID:   user.UserID,
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor: %v", err)
	}
	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed == 0 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v, want event processed", processed, err)
	}

	message := clientA.readJSON(t)
	if message["type"] != realtimeMessageProjectionDelta || message["projection"] != "editor" || message["scope"] != scopeA || message["resource_type"] != store.EntityTypeNode || message["resource_id"] != nodeA.NodeID {
		t.Fatalf("editor worker delta = %+v, want node A scoped editor delta", message)
	}
	if sequence, ok := message["sequence"].(float64); !ok || sequence != 1 {
		t.Fatalf("editor worker sequence = %v, want 1", message["sequence"])
	}
	deltas, ok := message["deltas"].([]any)
	if !ok || len(deltas) != 1 {
		t.Fatalf("editor worker deltas = %+v, want one delta", message["deltas"])
	}
	delta, ok := deltas[0].(map[string]any)
	if !ok || delta["operation"] != store.ProjectionDeltaOperationUpsert {
		t.Fatalf("editor worker delta payload = %+v, want upsert", deltas[0])
	}
	row, ok := delta["row"].(map[string]any)
	if !ok || row["node_id"] != nodeA.NodeID || row["information_id"] != informationID || row["information"] != "chat update" {
		t.Fatalf("editor worker row = %+v, want node A row payload", delta["row"])
	}
	clientB.assertNoMessage(t)
}

func TestEventWorkerPermissionChangeRevokesEditorRealtimeSubscription(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777608"
	token := "event-worker-editor-revoke-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "event-worker-editor-revoke-user", domain.RoleCompanyUser)
	node, err := repo.CreateNode(companyID, "Worker editor revoke node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions grant: %v", err)
	}
	drainEventRowsForTest(t, repo, companyID)
	server := newEventWorkerAuthServerForTest(repo, token, user)
	defer server.Close()

	scope := store.EditorRealtimeScope(store.EntityTypeNode, node.NodeID)
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	ready := client.readJSON(t)
	connectionID := ready["connection_id"].(string)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}
	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed == 0 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v", processed, err)
	}
	message := client.readJSON(t)
	if message["type"] != realtimeMessagePermissionRevoked || message["scope"] != scope || message["resource_type"] != store.EntityTypeNode || message["resource_id"] != node.NodeID {
		t.Fatalf("editor permission message = %+v, want permission.revoked for %s", message, scope)
	}
	if server.realtimeRegistry.hasSubscription(connectionID, companyID, scope) {
		t.Fatalf("revoked editor subscription still stored")
	}
}

func TestEventWorkerPermissionChangeSignalsWorkspaceRealtimeScope(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777609"
	token := "event-worker-workspace-revoke-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "event-worker-workspace-revoke-user", domain.RoleCompanyUser)
	node, err := repo.CreateNode(companyID, "Worker workspace revoke node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions grant: %v", err)
	}
	drainEventRowsForTest(t, repo, companyID)
	server := newEventWorkerAuthServerForTest(repo, token, user)
	defer server.Close()

	scope := realtimeNodeGraphScope(user.UserID)
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	ready := client.readJSON(t)
	connectionID := ready["connection_id"].(string)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}
	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed == 0 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v", processed, err)
	}
	message := client.readJSON(t)
	if message["type"] != realtimeMessagePermissionRevoked || message["scope"] != scope || message["resource_type"] != store.EntityTypeNode || message["resource_id"] != node.NodeID {
		t.Fatalf("workspace permission message = %+v, want permission.revoked for %s", message, scope)
	}
	if !server.realtimeRegistry.hasSubscription(connectionID, companyID, scope) {
		t.Fatalf("workspace scope should remain subscribed after scoped permission signal")
	}
}

func TestEventWorkerPermissionChangeRevokesRealtimeSubscription(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777603"
	token := "event-worker-revoke-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "event-worker-revoke-user", domain.RoleCompanyUser)
	logicGate, err := repo.CreateLogicGate(companyID, "Worker revoke gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
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
		t.Fatalf("SetEntityPermissions grant: %v", err)
	}
	drainEventRowsForTest(t, repo, companyID)
	server := newEventWorkerAuthServerForTest(repo, token, user)
	defer server.Close()
	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	scope := realtimeBoardScope(boardID)
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	ready := client.readJSON(t)
	connectionID := ready["connection_id"].(string)
	client.writeJSON(t, map[string]any{"type": "subscribe", "scope": scope})
	client.readJSON(t)

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}
	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed == 0 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v", processed, err)
	}
	message := client.readJSON(t)
	if message["type"] != realtimeMessagePermissionRevoked || message["scope"] != scope {
		t.Fatalf("permission message = %+v, want permission.revoked for %s", message, scope)
	}
	if server.realtimeRegistry.hasSubscription(connectionID, companyID, scope) {
		t.Fatalf("revoked subscription still stored")
	}
}

func TestEventWorkerRetriesFailedEventRows(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777604"
	repo.EnsureCompany(companyID, "Worker Retry Co")
	if _, err := repo.AppendEventRow(store.EventRowInput{
		CompanyID:     companyID,
		EventType:     "unsupported.worker.test",
		PrimaryScope:  "worker:retry",
		SequenceScope: "worker:retry",
	}); err != nil {
		t.Fatalf("AppendEventRow: %v", err)
	}
	server := NewServerWithOptions(repo, ServerOptions{DisableEventWorker: true})
	defer server.Close()
	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed != 1 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v, want one failed event processed for retry", processed, err)
	}
	rows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	if rows[0].AttemptCount != 1 || rows[0].LastError == "" || rows[0].ProcessingStartedAt != nil || rows[0].AvailableAt.Before(time.Now().UTC()) {
		t.Fatalf("failed worker row = %+v, want retry state", rows[0])
	}
}

func newEventWorkerAuthServerForTest(repo *store.MemoryRepo, token string, user domain.User) *Server {
	return NewServerWithOptions(repo, ServerOptions{
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
		}},
		DisableEventWorker: true,
	})
}

func drainEventRowsForTest(t *testing.T, repo *store.MemoryRepo, companyID string) {
	t.Helper()
	for {
		rows, err := repo.ClaimAvailableEventRows(100, store.DefaultEventRowProcessingLeaseTimeout)
		if err != nil {
			t.Fatalf("ClaimAvailableEventRows drain: %v", err)
		}
		if len(rows) == 0 {
			return
		}
		for _, row := range rows {
			if row.CompanyID == companyID {
				if err := repo.MarkEventRowProcessed(row.CompanyID, row.EventID); err != nil {
					t.Fatalf("MarkEventRowProcessed drain: %v", err)
				}
			}
		}
	}
}
