package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestRacioMatrixNodeCreateAndMoveV2(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777401"
	repo.EnsureCompany(companyID, "RACIO Matrix HTTP Co")
	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "racio-matrix-editor")

	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	createRec := httptest.NewRecorder()
	createReq := logicGateWorkV2Request(t, http.MethodPost, "/v2/racio-matrix/nodes", map[string]any{
		"company_id":                   companyID,
		"title":                        "Matrix-created node",
		"create_logic_gate_header":     "Matrix-created gate",
		"creator_logic_gate_raci_role": domain.LogicGateRaciRoleResponsible,
		"priority":                     3,
		"status":                       "pending",
		"position":                     10,
	}, editor, companyID)
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s, want 201", createRec.Code, createRec.Body.String())
	}
	createPayload := decodeRacioMatrixNodeCreatePayloadForTest(t, createRec)
	if createPayload.Node.NodeID == "" || createPayload.Node.Title != "Matrix-created node" {
		t.Fatalf("created node = %+v, want titled node", createPayload.Node)
	}
	if createPayload.LogicGate == nil || createPayload.LogicGate.Header != "Matrix-created gate" {
		t.Fatalf("created logic gate = %+v, want Matrix-created gate", createPayload.LogicGate)
	}
	if createPayload.Assignment == nil || createPayload.Assignment.LogicGateID != createPayload.LogicGate.LogicGateID || createPayload.Assignment.StatusKey != store.LogicGateWorkStatusPending {
		t.Fatalf("created assignment = %+v, want pending assignment in created gate", createPayload.Assignment)
	}
	if len(createPayload.RacioProjectionRows) != 0 {
		t.Fatalf("create response projection rows = %+v, want fast-return response without projection rows", createPayload.RacioProjectionRows)
	}
	createProjectionRows := getRacioMatrixProjectionRowsForTest(t, handler, companyID, editor)
	if !projectionRowsContainResource(createProjectionRows, "logic_gate", createPayload.LogicGate.LogicGateID) {
		t.Fatalf("projection refetch rows missing created gate row: %+v", createProjectionRows)
	}
	if !projectionRowsContainResource(createProjectionRows, "node", createPayload.Node.NodeID) {
		t.Fatalf("projection refetch rows missing created node row: %+v", createProjectionRows)
	}

	targetGate, err := repo.CreateRacioMatrixNode(store.RacioMatrixNodeCreateInput{
		CompanyID:                companyID,
		Title:                    "Target gate seed node",
		CreateLogicGateHeader:    "Target gate",
		CreatorLogicGateRaciRole: domain.LogicGateRaciRoleResponsible,
		Priority:                 testPriority(2),
		PrioritySet:              true,
		Status:                   "pending",
		ActorUserID:              editor.UserID,
	})
	if err != nil {
		t.Fatalf("CreateRacioMatrixNode target gate: %v", err)
	}
	if targetGate.LogicGate == nil {
		t.Fatalf("target gate missing from seed result")
	}

	moveRec := httptest.NewRecorder()
	moveReq := logicGateWorkV2Request(t, http.MethodPost, "/v2/racio-matrix/nodes/"+createPayload.Node.NodeID+"/move", map[string]any{
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
	if len(movePayload.RacioProjectionRows) != 0 {
		t.Fatalf("move response projection rows = %+v, want fast-return response without projection rows", movePayload.RacioProjectionRows)
	}
	moveProjectionRows := getRacioMatrixProjectionRowsForTest(t, handler, companyID, editor)
	if !projectionRowsContainNodeGate(moveProjectionRows, createPayload.Node.NodeID, targetGate.LogicGate.LogicGateID) {
		t.Fatalf("move projection refetch rows = %+v, want node projected under target gate", moveProjectionRows)
	}
}

type racioMatrixNodeCreatePayloadForTest struct {
	Node                domain.Node                        `json:"node"`
	LogicGate           *domain.LogicGate                  `json:"logic_gate"`
	Assignment          *domain.NodeLogicGateAssignment    `json:"assignment"`
	Card                *domain.KanbanCard                 `json:"card"`
	FolderItems         []domain.CompanyExplorerFolderItem `json:"folder_items"`
	RacioProjectionRows []store.RacioMatrixProjectionRow   `json:"racio_projection_rows"`
}

func decodeRacioMatrixNodeCreatePayloadForTest(t *testing.T, rr *httptest.ResponseRecorder) racioMatrixNodeCreatePayloadForTest {
	t.Helper()
	var payload racioMatrixNodeCreatePayloadForTest
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode RACIO create response: %v body=%s", err, rr.Body.String())
	}
	return payload
}

func getRacioMatrixProjectionRowsForTest(t *testing.T, handler http.Handler, companyID string, actor domain.User) []store.RacioMatrixProjectionRow {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/work-items/racio-matrix-projection?company_id="+companyID+"&limit=500", nil)
	req = requestWithLogicGateWorkActorForTest(req, actor, companyID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET RACI projection status = %d body=%s, want 200", rr.Code, rr.Body.String())
	}
	var payload struct {
		Projection         string                           `json:"projection"`
		ProjectionSequence *int64                           `json:"projection_sequence"`
		Rows               []store.RacioMatrixProjectionRow `json:"rows"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode RACI projection response: %v body=%s", err, rr.Body.String())
	}
	if payload.Projection != store.ProjectionNameRacioMatrix {
		t.Fatalf("projection = %q, want %q", payload.Projection, store.ProjectionNameRacioMatrix)
	}
	if payload.ProjectionSequence == nil {
		t.Fatalf("projection_sequence missing from RACI projection response")
	}
	return payload.Rows
}

func projectionRowsContainResource(rows []store.RacioMatrixProjectionRow, resourceType, resourceID string) bool {
	for _, row := range rows {
		if row.ResourceType == resourceType && row.ResourceID == resourceID {
			return true
		}
	}
	return false
}

func projectionRowsContainNodeGate(rows []store.RacioMatrixProjectionRow, nodeID, logicGateID string) bool {
	for _, row := range rows {
		if row.ResourceType == "node" && row.ResourceID == nodeID && row.LogicGateID != nil && *row.LogicGateID == logicGateID {
			return true
		}
	}
	return false
}
