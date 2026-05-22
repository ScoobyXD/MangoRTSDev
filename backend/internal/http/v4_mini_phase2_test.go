package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestV4MiniAccessDeniedSemanticsAndOmission(t *testing.T) {
	t.Parallel()

	base := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777701"
	base.EnsureCompany(companyID, "V4 Mini Access Co")

	viewer := mustLogicGateWorkHTTPUser(t, base, companyID, "v4-mini-viewer")
	blocked := mustLogicGateWorkHTTPUser(t, base, companyID, "v4-mini-blocked")

	visibleNode, err := base.CreateNode(companyID, "Visible V4 Mini Node")
	if err != nil {
		t.Fatalf("CreateNode visible: %v", err)
	}
	hiddenNode, err := base.CreateNode(companyID, "Hidden V4 Mini Node")
	if err != nil {
		t.Fatalf("CreateNode hidden: %v", err)
	}
	folder, err := base.CreateCompanyExplorerFolder(companyID, "", "node", "V4 Mini Folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder: %v", err)
	}
	if _, _, err := base.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, "node", visibleNode.NodeID, 1000); err != nil {
		t.Fatalf("Assign visible folder item: %v", err)
	}
	if _, _, err := base.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, "node", hiddenNode.NodeID, 2000); err != nil {
		t.Fatalf("Assign hidden folder item: %v", err)
	}
	if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   visibleNode.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions visible node: %v", err)
	}
	if err := base.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	repo := &phase5ForbiddenLegacyAndKanbanReadsRepo{Repository: base}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	listReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	listReq = requestWithLogicGateWorkActorForTest(listReq, viewer, companyID)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("node list status = %d body=%s", listRec.Code, listRec.Body.String())
	}
	var listPayload struct {
		Nodes []domain.Node `json:"nodes"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode node list: %v", err)
	}
	if len(listPayload.Nodes) != 1 || listPayload.Nodes[0].NodeID != visibleNode.NodeID {
		t.Fatalf("visible node list = %+v, want only %s", listPayload.Nodes, visibleNode.NodeID)
	}

	snapshotReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	snapshotReq = requestWithLogicGateWorkActorForTest(snapshotReq, viewer, companyID)
	snapshotRec := httptest.NewRecorder()
	handler.ServeHTTP(snapshotRec, snapshotReq)
	if snapshotRec.Code != http.StatusOK {
		t.Fatalf("workspace snapshot status = %d body=%s", snapshotRec.Code, snapshotRec.Body.String())
	}
	var snapshot struct {
		Nodes       []domain.Node                      `json:"nodes"`
		FolderItems []domain.CompanyExplorerFolderItem `json:"folder_items"`
	}
	if err := json.NewDecoder(snapshotRec.Body).Decode(&snapshot); err != nil {
		t.Fatalf("decode workspace snapshot: %v", err)
	}
	if containsNodeID(snapshot.Nodes, hiddenNode.NodeID) || !containsNodeID(snapshot.Nodes, visibleNode.NodeID) {
		t.Fatalf("snapshot nodes = %+v, want visible node only", snapshot.Nodes)
	}
	if containsFolderItem(snapshot.FolderItems, hiddenNode.NodeID) || !containsFolderItem(snapshot.FolderItems, visibleNode.NodeID) {
		t.Fatalf("snapshot folder_items = %+v, want visible item only", snapshot.FolderItems)
	}

	hiddenReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+hiddenNode.NodeID+"?company_id="+companyID, nil)
	hiddenReq = requestWithLogicGateWorkActorForTest(hiddenReq, viewer, companyID)
	hiddenRec := httptest.NewRecorder()
	handler.ServeHTTP(hiddenRec, hiddenReq)
	assertGenericResourceDenied(t, hiddenRec, hiddenNode.Title)

	blockedReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+visibleNode.NodeID+"?company_id="+companyID, nil)
	blockedReq = requestWithLogicGateWorkActorForTest(blockedReq, blocked, companyID)
	blockedRec := httptest.NewRecorder()
	handler.ServeHTTP(blockedRec, blockedReq)
	assertGenericResourceDenied(t, blockedRec, visibleNode.Title)

	editBody, _ := json.Marshal(map[string]string{"company_id": companyID, "title": "Blocked edit"})
	editReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+visibleNode.NodeID, bytes.NewReader(editBody))
	editReq.Header.Set("Content-Type", "application/json")
	editReq = requestWithLogicGateWorkActorForTest(editReq, viewer, companyID)
	editRec := httptest.NewRecorder()
	handler.ServeHTTP(editRec, editReq)
	assertGenericActionDenied(t, editRec, visibleNode.Title)

	if repo.legacyAccessReadCount != 0 {
		t.Fatalf("active access path used legacy entity access reads %d times", repo.legacyAccessReadCount)
	}
}

func TestV4MiniOldV1SurfacePolicy(t *testing.T) {
	t.Parallel()

	base := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777702"
	base.EnsureCompany(companyID, "V4 Mini Route Co")

	viewer := mustLogicGateWorkHTTPUser(t, base, companyID, "v4-mini-route-viewer")
	node, err := base.CreateNode(companyID, "V4 Mini Route Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	gate, err := base.CreateLogicGate(companyID, "V4 Mini Route Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := base.AddNodeInformationWithActor(store.NodeInformationInput{
		CompanyID:     companyID,
		NodeID:        node.NodeID,
		Type:          "Text box",
		Information:   "node projection",
		InformationID: "77777777-7777-4777-8777-777777777703",
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor: %v", err)
	}
	if _, err := base.AddLogicGateInformation(companyID, gate.LogicGateID, "Text box", "gate projection", "77777777-7777-4777-8777-777777777704"); err != nil {
		t.Fatalf("AddLogicGateInformation: %v", err)
	}
	for _, grant := range []struct {
		entityType string
		entityID   string
	}{
		{store.EntityTypeNode, node.NodeID},
		{store.EntityTypeLogicGate, gate.LogicGateID},
	} {
		if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID:  companyID,
			EntityType: grant.entityType,
			EntityID:   grant.entityID,
			Permissions: []store.EntityPermissionInput{{
				SubjectType: store.EntityPermissionSubjectUser,
				SubjectID:   viewer.UserID,
				AccessLevel: store.EntityPermissionView,
			}},
		}); err != nil {
			t.Fatalf("SetEntityPermissions %s: %v", grant.entityType, err)
		}
	}
	if err := base.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	repo := &phase5ForbiddenLegacyAndKanbanReadsRepo{Repository: base}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	for _, target := range []string{
		"/v1/nodes/" + node.NodeID + "?company_id=" + companyID,
		"/v1/nodes/" + node.NodeID + "/projection?company_id=" + companyID,
		"/v1/logic-gates/" + gate.LogicGateID + "?company_id=" + companyID,
		"/v1/logic-gates/" + gate.LogicGateID + "/projection?company_id=" + companyID,
		"/v2/nodes/" + node.NodeID + "/view?company_id=" + companyID,
		"/v2/logic-gates/" + gate.LogicGateID + "/view?company_id=" + companyID,
	} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req = requestWithLogicGateWorkActorForTest(req, viewer, companyID)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d body=%s", target, rec.Code, rec.Body.String())
		}
	}

	mapReq := httptest.NewRequest(http.MethodGet, "/v1/map-layout?company_id="+companyID+"&map_type=node", nil)
	mapReq = requestWithLogicGateWorkActorForTest(mapReq, viewer, companyID)
	mapRec := httptest.NewRecorder()
	handler.ServeHTTP(mapRec, mapReq)
	if mapRec.Code != http.StatusNotFound || !strings.Contains(mapRec.Body.String(), "legacy_map_routes_disabled") {
		t.Fatalf("disabled map-layout status = %d body=%s", mapRec.Code, mapRec.Body.String())
	}

	batchReq := httptest.NewRequest(http.MethodPost, "/v1/map-entity-batches", strings.NewReader(`{"company_id":"`+companyID+`","entity_kind":"node","items":[]}`))
	batchReq.Header.Set("Content-Type", "application/json")
	batchReq = requestWithLogicGateWorkActorForTest(batchReq, viewer, companyID)
	batchRec := httptest.NewRecorder()
	handler.ServeHTTP(batchRec, batchReq)
	if batchRec.Code != http.StatusNotFound || !strings.Contains(batchRec.Body.String(), "legacy_map_routes_disabled") {
		t.Fatalf("disabled map-entity-batches status = %d body=%s", batchRec.Code, batchRec.Body.String())
	}

	fullReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=full", nil)
	fullReq = requestWithLogicGateWorkActorForTest(fullReq, viewer, companyID)
	fullRec := httptest.NewRecorder()
	handler.ServeHTTP(fullRec, fullReq)
	if fullRec.Code != http.StatusOK {
		t.Fatalf("full workspace snapshot status = %d body=%s", fullRec.Code, fullRec.Body.String())
	}
	raw := map[string]json.RawMessage{}
	if err := json.NewDecoder(fullRec.Body).Decode(&raw); err != nil {
		t.Fatalf("decode full workspace snapshot: %v", err)
	}
	for _, key := range []string{"node_map_positions", "logic_gate_map_positions", "kanban_boards"} {
		if _, ok := raw[key]; ok {
			t.Fatalf("full workspace snapshot unexpectedly included %q", key)
		}
	}

	if repo.legacyAccessReadCount != 0 {
		t.Fatalf("old v1 compatibility reads used legacy entity access reads %d times", repo.legacyAccessReadCount)
	}
}

func assertGenericResourceDenied(t *testing.T, rec *httptest.ResponseRecorder, leakedValue string) {
	t.Helper()
	if rec.Code != http.StatusNotFound {
		t.Fatalf("resource denied status = %d, want %d body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, accessDeniedResourceMessage) {
		t.Fatalf("resource denied body = %s, want generic access message", body)
	}
	if leakedValue != "" && strings.Contains(body, leakedValue) {
		t.Fatalf("resource denied body leaked resource metadata: %s", body)
	}
}

func assertGenericActionDenied(t *testing.T, rec *httptest.ResponseRecorder, leakedValue string) {
	t.Helper()
	if rec.Code != http.StatusForbidden {
		t.Fatalf("action denied status = %d, want %d body=%s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, accessDeniedActionMessage) {
		t.Fatalf("action denied body = %s, want generic action message", body)
	}
	if leakedValue != "" && strings.Contains(body, leakedValue) {
		t.Fatalf("action denied body leaked resource metadata: %s", body)
	}
}

func containsNodeID(nodes []domain.Node, nodeID string) bool {
	for _, node := range nodes {
		if node.NodeID == nodeID {
			return true
		}
	}
	return false
}

func containsFolderItem(items []domain.CompanyExplorerFolderItem, itemID string) bool {
	for _, item := range items {
		if item.ItemID == itemID {
			return true
		}
	}
	return false
}
