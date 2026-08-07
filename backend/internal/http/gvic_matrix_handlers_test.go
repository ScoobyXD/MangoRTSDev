package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestRACIMatrixNodeCreateAndMoveV2IgnoresStaleSourceHint(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777401"
	repo.EnsureCompany(companyID, "RACIMatrix Matrix HTTP Co")
	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "RACIMatrix-matrix-editor")

	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	createRec := httptest.NewRecorder()
	createReq := logicGateWorkV2Request(t, http.MethodPost, "/v2/gvic-matrix/nodes", map[string]any{
		"company_id":                   companyID,
		"name":                         "Matrix-created node",
		"create_logic_gate_header":     "Matrix-created gate",
		"creator_logic_gate_gvic_role": domain.RACIRoleResponsible,
		"priority":                     3,
		"status":                       "pending",
		"position":                     10,
	}, editor, companyID)
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s, want 201", createRec.Code, createRec.Body.String())
	}
	createPayload := decodeRACIMatrixNodeCreatePayloadForTest(t, createRec)
	if createPayload.Node.NodeID == "" || createPayload.Node.Title != "Matrix-created node" {
		t.Fatalf("created node = %+v, want titled node", createPayload.Node)
	}
	if createPayload.LogicGate == nil || createPayload.LogicGate.Header != "Matrix-created gate" {
		t.Fatalf("created logic gate = %+v, want Matrix-created gate", createPayload.LogicGate)
	}
	if createPayload.Assignment == nil || createPayload.Assignment.LogicGateID != createPayload.LogicGate.LogicGateID || createPayload.Assignment.StatusKey != store.LogicGateWorkStatusPending {
		t.Fatalf("created assignment = %+v, want pending assignment in created gate", createPayload.Assignment)
	}
	if len(createPayload.RACIMatrixProjectionRows) != 0 {
		t.Fatalf("create response projection rows = %+v, want fast-return response without projection rows", createPayload.RACIMatrixProjectionRows)
	}
	createProjectionRows := getRACIMatrixProjectionRowsForTest(t, handler, companyID, editor)
	if !projectionRowsContainNodeGate(createProjectionRows, createPayload.Node.NodeID, createPayload.LogicGate.LogicGateID) {
		t.Fatalf("projection refetch rows missing created node leaf path: %+v", createProjectionRows)
	}

	targetGate, err := repo.CreateRACIMatrixNode(store.RACIMatrixNodeCreateInput{
		CompanyID:                companyID,
		Title:                    "Target gate seed node",
		CreateLogicGateHeader:    "Target gate",
		CreatorLogicGateRACIRole: domain.RACIRoleResponsible,
		Priority:                 testPriority(2),
		PrioritySet:              true,
		Status:                   "pending",
		ActorUserID:              editor.UserID,
	})
	if err != nil {
		t.Fatalf("CreateRACIMatrixNode target gate: %v", err)
	}
	if targetGate.LogicGate == nil {
		t.Fatalf("target gate missing from seed result")
	}

	moveRec := httptest.NewRecorder()
	moveReq := logicGateWorkV2Request(t, http.MethodPost, "/v2/gvic-matrix/nodes/"+createPayload.Node.NodeID+"/move", map[string]any{
		"company_id":         companyID,
		"from_logic_gate_id": "77777777-7777-4777-8777-777777777499",
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
	if len(movePayload.RACIMatrixProjectionRows) != 0 {
		t.Fatalf("move response projection rows = %+v, want fast-return response without projection rows", movePayload.RACIMatrixProjectionRows)
	}
	moveProjectionRows := getRACIMatrixProjectionRowsForTest(t, handler, companyID, editor)
	if projectionRowsContainNodeGate(moveProjectionRows, createPayload.Node.NodeID, targetGate.LogicGate.LogicGateID) {
		t.Fatalf("move projection refetch rows = %+v, want done node removed from active My Work projection", moveProjectionRows)
	}
}

func TestRACIMatrixNodeCreateInExistingLogicGateInheritsCurrentPolicy(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777402"
	repo.EnsureCompany(companyID, "RACIMatrix Matrix Creator Co")
	creator := mustLogicGateWorkHTTPUser(t, repo, companyID, "RACIMatrix-node-creator")
	responsible := mustLogicGateWorkHTTPUser(t, repo, companyID, "RACIMatrix-node-responsible")

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
	if _, err := repo.SetLogicGateRACIAssignments(store.LogicGateRACIAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRACIAssignmentInput{{
			Role:   domain.RACIRoleResponsible,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRACIAssignments: %v", err)
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
	payload := decodeRACIMatrixNodeCreatePayloadForTest(t, createRec)
	loaded, err := repo.GetNode(companyID, payload.Node.NodeID)
	if err != nil {
		t.Fatalf("GetNode: %v", err)
	}
	if loaded.NodeID != payload.Node.NodeID {
		t.Fatalf("stored node = %+v, want response node %s", loaded, payload.Node.NodeID)
	}
	effective, err := repo.ListResourceRACIEffectiveAssignments(companyID, store.EntityTypeNode, payload.Node.NodeID)
	if err != nil {
		t.Fatalf("ListResourceRACIEffectiveAssignments: %v", err)
	}
	if len(effective) != 1 ||
		effective[0].Role != domain.RACIRoleResponsible ||
		effective[0].UserID != responsible.UserID ||
		effective[0].SourceResourceType != store.EntityTypeLogicGate ||
		effective[0].SourceResourceID != logicGate.LogicGateID ||
		effective[0].InheritanceType != store.PolicyModeInherited {
		t.Fatalf("effective node RACI = %+v, want inherited Responsible assignment from Logic Gate", effective)
	}
}

type RACIMatrixNodeCreatePayloadForTest struct {
	Node                     domain.Node                        `json:"node"`
	LogicGate                *domain.LogicGate                  `json:"logic_gate"`
	Assignment               *domain.NodeLogicGateAssignment    `json:"assignment"`
	Card                     *domain.KanbanCard                 `json:"card"`
	FolderItems              []domain.CompanyExplorerFolderItem `json:"folder_items"`
	RACIMatrixProjectionRows []store.RACIMatrixProjectionRow    `json:"gvic_projection_rows"`
}

func decodeRACIMatrixNodeCreatePayloadForTest(t *testing.T, rr *httptest.ResponseRecorder) RACIMatrixNodeCreatePayloadForTest {
	t.Helper()
	var payload RACIMatrixNodeCreatePayloadForTest
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode RACIMatrix create response: %v body=%s", err, rr.Body.String())
	}
	return payload
}

func getRACIMatrixProjectionRowsForTest(t *testing.T, handler http.Handler, companyID string, actor domain.User) []store.RACIMatrixProjectionRow {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/work-items/gvic-matrix-projection?company_id="+companyID+"&limit=500", nil)
	req = requestWithLogicGateWorkActorForTest(req, actor, companyID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET RACI projection status = %d body=%s, want 200", rr.Code, rr.Body.String())
	}
	var payload struct {
		Projection string                          `json:"projection"`
		Rows       []store.RACIMatrixProjectionRow `json:"rows"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode RACI projection response: %v body=%s", err, rr.Body.String())
	}
	if payload.Projection != "gvic_matrix" {
		t.Fatalf("projection = %q, want %q", payload.Projection, "gvic_matrix")
	}
	return payload.Rows
}

func projectionRowsContainNodeGate(rows []store.RACIMatrixProjectionRow, nodeID, logicGateID string) bool {
	for _, row := range rows {
		if row.NodeID == nodeID && row.LogicGateID != nil && *row.LogicGateID == logicGateID {
			return true
		}
	}
	return false
}
