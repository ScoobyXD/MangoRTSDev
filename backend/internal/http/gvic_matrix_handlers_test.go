package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestGVICMatrixNodeCreateAndMoveV2(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777401"
	repo.EnsureCompany(companyID, "GVICMatrix Matrix HTTP Co")
	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "GVICMatrix-matrix-editor")

	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	createRec := httptest.NewRecorder()
	createReq := logicGateWorkV2Request(t, http.MethodPost, "/v2/gvic-matrix/nodes", map[string]any{
		"company_id":                   companyID,
		"name":                         "Matrix-created node",
		"create_logic_gate_header":     "Matrix-created gate",
		"creator_logic_gate_gvic_role": domain.GVICRoleGenerated,
		"priority":                     3,
		"status":                       "pending",
		"position":                     10,
	}, editor, companyID)
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s, want 201", createRec.Code, createRec.Body.String())
	}
	createPayload := decodeGVICMatrixNodeCreatePayloadForTest(t, createRec)
	if createPayload.Node.NodeID == "" || createPayload.Node.Title != "Matrix-created node" {
		t.Fatalf("created node = %+v, want titled node", createPayload.Node)
	}
	if createPayload.LogicGate == nil || createPayload.LogicGate.Header != "Matrix-created gate" {
		t.Fatalf("created logic gate = %+v, want Matrix-created gate", createPayload.LogicGate)
	}
	if createPayload.Assignment == nil || createPayload.Assignment.LogicGateID != createPayload.LogicGate.LogicGateID || createPayload.Assignment.StatusKey != store.LogicGateWorkStatusPending {
		t.Fatalf("created assignment = %+v, want pending assignment in created gate", createPayload.Assignment)
	}
	if len(createPayload.GVICMatrixProjectionRows) != 0 {
		t.Fatalf("create response projection rows = %+v, want fast-return response without projection rows", createPayload.GVICMatrixProjectionRows)
	}
	createProjectionRows := getGVICMatrixProjectionRowsForTest(t, handler, companyID, editor)
	if !projectionRowsContainNodeGate(createProjectionRows, createPayload.Node.NodeID, createPayload.LogicGate.LogicGateID) {
		t.Fatalf("projection refetch rows missing created node leaf path: %+v", createProjectionRows)
	}

	targetGate, err := repo.CreateGVICMatrixNode(store.GVICMatrixNodeCreateInput{
		CompanyID:                companyID,
		Title:                    "Target gate seed node",
		CreateLogicGateHeader:    "Target gate",
		CreatorLogicGateGVICRole: domain.GVICRoleGenerated,
		Priority:                 testPriority(2),
		PrioritySet:              true,
		Status:                   "pending",
		ActorUserID:              editor.UserID,
	})
	if err != nil {
		t.Fatalf("CreateGVICMatrixNode target gate: %v", err)
	}
	if targetGate.LogicGate == nil {
		t.Fatalf("target gate missing from seed result")
	}

	moveRec := httptest.NewRecorder()
	moveReq := logicGateWorkV2Request(t, http.MethodPost, "/v2/gvic-matrix/nodes/"+createPayload.Node.NodeID+"/move", map[string]any{
		"company_id":         companyID,
		"from_logic_gate_id": createPayload.LogicGate.LogicGateID,
		"to_logic_gate_id":   targetGate.LogicGate.LogicGateID,
		"status":             "done",
		"priority":           4,
	}, editor, companyID)
	handler.ServeHTTP(moveRec, moveReq)
	if moveRec.Code != http.StatusOK {
		t.Fatalf("move status = %d body=%s, want 200", moveRec.Code, moveRec.Body.String())
	}
	movePayload := decodeLogicGateWorkMutationPayloadForTest(t, moveRec)
	if movePayload.Assignment.LogicGateID != targetGate.LogicGate.LogicGateID || movePayload.Assignment.StatusKey != store.LogicGateWorkStatusDone {
		t.Fatalf("move assignment = %+v, want done in target gate", movePayload.Assignment)
	}
	if len(movePayload.GVICMatrixProjectionRows) != 0 {
		t.Fatalf("move response projection rows = %+v, want fast-return response without projection rows", movePayload.GVICMatrixProjectionRows)
	}
	moveProjectionRows := getGVICMatrixProjectionRowsForTest(t, handler, companyID, editor)
	if projectionRowsContainNodeGate(moveProjectionRows, createPayload.Node.NodeID, targetGate.LogicGate.LogicGateID) {
		t.Fatalf("move projection refetch rows = %+v, want done node removed from active My Work projection", moveProjectionRows)
	}
}

func TestGVICMatrixNodeCreateInExistingLogicGateAssignsCreator(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777402"
	repo.EnsureCompany(companyID, "GVICMatrix Matrix Creator Co")
	creator := mustLogicGateWorkHTTPUser(t, repo, companyID, "GVICMatrix-node-creator")
	responsible := mustLogicGateWorkHTTPUser(t, repo, companyID, "GVICMatrix-node-responsible")

	batch, err := repo.CreateWorkspaceEntityBatch(store.WorkspaceEntityBatchInput{
		CompanyID:     companyID,
		EntityKind:    "logic_gate",
		CreatorUserID: responsible.UserID,
		Items: []store.WorkspaceEntityBatchItemInput{{
			ClientID: "target-gate",
			Title:    "Target gate",
		}},
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceEntityBatch logic gate: %v", err)
	}
	if len(batch.LogicGates) != 1 {
		t.Fatalf("created logic gates = %d, want 1", len(batch.LogicGates))
	}
	logicGate := batch.LogicGates[0]
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	createRec := httptest.NewRecorder()
	createReq := logicGateWorkV2Request(t, http.MethodPost, "/v2/gvic-matrix/nodes", map[string]any{
		"company_id":    companyID,
		"name":          "Creator-owned node",
		"logic_gate_id": logicGate.LogicGateID,
		"priority":      3,
		"status":        "pending",
	}, creator, companyID)
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s, want 201", createRec.Code, createRec.Body.String())
	}
	payload := decodeGVICMatrixNodeCreatePayloadForTest(t, createRec)
	loaded, err := repo.GetNode(companyID, payload.Node.NodeID)
	if err != nil {
		t.Fatalf("GetNode: %v", err)
	}
	if loaded.NodeID != payload.Node.NodeID {
		t.Fatalf("stored node = %+v, want response node %s", loaded, payload.Node.NodeID)
	}
	effective, err := repo.ListResourceGVICEffectiveAssignments(companyID, store.EntityTypeNode, payload.Node.NodeID)
	if err != nil {
		t.Fatalf("ListResourceGVICEffectiveAssignments: %v", err)
	}
	if len(effective) != 1 ||
		effective[0].Role != domain.GVICRoleGenerated ||
		effective[0].UserID != responsible.UserID ||
		effective[0].SourceResourceType != store.EntityTypeNode ||
		effective[0].SourceResourceID != payload.Node.NodeID ||
		effective[0].InheritanceType != store.GVICInheritanceDirect {
		t.Fatalf("effective node GVIC = %+v, want direct generated snapshot from node", effective)
	}
}

type GVICMatrixNodeCreatePayloadForTest struct {
	Node                     domain.Node                        `json:"node"`
	LogicGate                *domain.LogicGate                  `json:"logic_gate"`
	Assignment               *domain.NodeLogicGateAssignment    `json:"assignment"`
	Card                     *domain.KanbanCard                 `json:"card"`
	FolderItems              []domain.CompanyExplorerFolderItem `json:"folder_items"`
	GVICMatrixProjectionRows []store.GVICMatrixProjectionRow    `json:"gvic_projection_rows"`
}

func decodeGVICMatrixNodeCreatePayloadForTest(t *testing.T, rr *httptest.ResponseRecorder) GVICMatrixNodeCreatePayloadForTest {
	t.Helper()
	var payload GVICMatrixNodeCreatePayloadForTest
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode GVICMatrix create response: %v body=%s", err, rr.Body.String())
	}
	return payload
}

func getGVICMatrixProjectionRowsForTest(t *testing.T, handler http.Handler, companyID string, actor domain.User) []store.GVICMatrixProjectionRow {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/work-items/gvic-matrix-projection?company_id="+companyID+"&limit=500", nil)
	req = requestWithLogicGateWorkActorForTest(req, actor, companyID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET GVIC projection status = %d body=%s, want 200", rr.Code, rr.Body.String())
	}
	var payload struct {
		Projection         string                          `json:"projection"`
		ProjectionSequence *int64                          `json:"projection_sequence"`
		Rows               []store.GVICMatrixProjectionRow `json:"rows"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode GVIC projection response: %v body=%s", err, rr.Body.String())
	}
	if payload.Projection != store.ProjectionNameGVICMatrix {
		t.Fatalf("projection = %q, want %q", payload.Projection, store.ProjectionNameGVICMatrix)
	}
	if payload.ProjectionSequence == nil {
		t.Fatalf("projection_sequence missing from GVIC projection response")
	}
	return payload.Rows
}

func projectionRowsContainNodeGate(rows []store.GVICMatrixProjectionRow, nodeID, logicGateID string) bool {
	for _, row := range rows {
		if row.NodeID == nodeID && row.LogicGateID != nil && *row.LogicGateID == logicGateID {
			return true
		}
	}
	return false
}
