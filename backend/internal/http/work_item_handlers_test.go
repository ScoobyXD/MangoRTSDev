package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/store"
)

func TestProcessWorkAssignmentKeepsExactNodeIdentity(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "11111111-1111-4111-8111-cccccccccccc"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	repo.EnsureCompany(companyID, "Assignment API Company")
	logicGate, err := repo.CreateLogicGate(companyID, "API Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "API node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"status":        "done",
		"priority":      3,
	})
	req := httptest.NewRequest(http.MethodPost, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST work item assignment status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var payload store.LogicGateNodeAssignmentResult
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode assignment payload: %v", err)
	}
	if payload.Assignment.LogicGateID != logicGate.LogicGateID || payload.Assignment.NodeID != node.NodeID {
		t.Fatalf("assignment = %+v, want exact Process and Node IDs", payload.Assignment)
	}
	if payload.Node.Status == nil || *payload.Node.Status != "Done" {
		t.Fatalf("node status = %+v, want Done", payload.Node.Status)
	}
	if payload.Node.Priority == nil || *payload.Node.Priority != 3 {
		t.Fatalf("node priority = %+v, want 3", payload.Node.Priority)
	}
	if len(payload.Node.LogicGateIDs) != 1 || payload.Node.LogicGateIDs[0] != logicGate.LogicGateID {
		t.Fatalf("node logic_gate_ids = %+v, want assigned Process", payload.Node.LogicGateIDs)
	}

	work, err := repo.GetLogicGateWork(companyID, logicGate.LogicGateID, "")
	if err != nil || len(work.Nodes) != 1 || work.Nodes[0].NodeID != node.NodeID || work.Nodes[0].Status != "Done" {
		t.Fatalf("work = %+v, err=%v, want the canonical Done Node", work, err)
	}

	methodReq := httptest.NewRequest(http.MethodGet, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes", nil)
	methodRec := httptest.NewRecorder()
	handler.ServeHTTP(methodRec, methodReq)
	if methodRec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET work item assignment status = %d, want %d", methodRec.Code, http.StatusMethodNotAllowed)
	}
}

func TestWorkItemLogicGateAssignmentParityEndpoints(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "11111111-1111-4111-8111-dddddddddddd"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	repo.EnsureCompany(companyID, "Assignment Parity API Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Parity Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Parity node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	assignRec := postWorkItemJSON(t, handler, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"status":        "pending",
		"priority":      2,
	})
	if assignRec.Code != http.StatusCreated {
		t.Fatalf("assign status = %d, want %d body=%s", assignRec.Code, http.StatusOK, assignRec.Body.String())
	}

	invalidMoveRec := workItemJSON(t, handler, http.MethodPut, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes/"+node.NodeID+"/state", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"status":        "Not a status",
		"priority":      nil,
	})
	if invalidMoveRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid move status = %d, want %d body=%s", invalidMoveRec.Code, http.StatusNotFound, invalidMoveRec.Body.String())
	}
	loaded, err := repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after invalid move: %v", err)
	}
	if loaded.Priority == nil || *loaded.Priority != 2 {
		t.Fatalf("priority after invalid move = %+v, want unchanged 2", loaded.Priority)
	}
	if loaded.Status == nil || *loaded.Status != "Pending" {
		t.Fatalf("status after invalid move = %+v, want Pending", loaded.Status)
	}

	moveRec := workItemJSON(t, handler, http.MethodPut, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes/"+node.NodeID+"/state", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"status":        "done",
	})
	if moveRec.Code != http.StatusOK {
		t.Fatalf("move status = %d, want %d body=%s", moveRec.Code, http.StatusOK, moveRec.Body.String())
	}
	var moved store.LogicGateNodeAssignmentResult
	if err := json.NewDecoder(moveRec.Body).Decode(&moved); err != nil {
		t.Fatalf("decode move response: %v", err)
	}
	if moved.Assignment.NodeID != node.NodeID || moved.Node.NodeID != node.NodeID {
		t.Fatalf("move response = %+v, want assignment and Node", moved)
	}
	if moved.Node.Status == nil || *moved.Node.Status != "Done" {
		t.Fatalf("move node status = %+v, want Done", moved.Node.Status)
	}
	if moved.Node.Priority == nil || *moved.Node.Priority != 2 {
		t.Fatalf("move priority = %+v, want unchanged 2", moved.Node.Priority)
	}

	issueRec := postWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/issue", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"is_issue":      true,
	})
	if issueRec.Code != http.StatusOK {
		t.Fatalf("issue true status = %d, want %d body=%s", issueRec.Code, http.StatusOK, issueRec.Body.String())
	}
	var issueOn store.LogicGateNodeAssignmentResult
	if err := json.NewDecoder(issueRec.Body).Decode(&issueOn); err != nil {
		t.Fatalf("decode issue true response: %v", err)
	}
	if issueOn.Node.Status == nil || *issueOn.Node.Status != "Done" {
		t.Fatalf("issue true node status = %+v, want Done", issueOn.Node.Status)
	}

	clearIssueRec := postWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/issue", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"is_issue":      false,
	})
	if clearIssueRec.Code != http.StatusOK {
		t.Fatalf("issue false status = %d, want %d body=%s", clearIssueRec.Code, http.StatusOK, clearIssueRec.Body.String())
	}
	var issueOff store.LogicGateNodeAssignmentResult
	if err := json.NewDecoder(clearIssueRec.Body).Decode(&issueOff); err != nil {
		t.Fatalf("decode issue false response: %v", err)
	}
	if issueOff.Node.Status == nil || *issueOff.Node.Status != "Done" {
		t.Fatalf("issue false node status = %+v, want Done", issueOff.Node.Status)
	}

	removeRec := postWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/remove", map[string]any{
		"company_id":      companyID,
		"logic_gate_id":   logicGate.LogicGateID,
		"node_id":         node.NodeID,
		"fallback_status": "Backlog",
	})
	if removeRec.Code != http.StatusOK {
		t.Fatalf("remove status = %d, want %d body=%s", removeRec.Code, http.StatusOK, removeRec.Body.String())
	}
	var removed store.LogicGateNodeAssignmentRemoveResult
	if err := json.NewDecoder(removeRec.Body).Decode(&removed); err != nil {
		t.Fatalf("decode remove response: %v", err)
	}
	if removed.Assignment.NodeID != node.NodeID || removed.Node.NodeID != node.NodeID {
		t.Fatalf("remove response = %+v, want removed assignment and Node", removed)
	}
	if removed.Node.Status == nil || *removed.Node.Status != "Backlogs" {
		t.Fatalf("remove fallback status = %+v, want Backlog", removed.Node.Status)
	}
	if len(removed.Node.LogicGateIDs) != 0 {
		t.Fatalf("remove node logic_gate_ids = %+v, want none", removed.Node.LogicGateIDs)
	}
}

func TestWorkItemLogicGateAssignmentParityEndpointValidation(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "11111111-1111-4111-8111-eeeeeeeeeeee"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	repo.EnsureCompany(companyID, "Assignment Validation API Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Validation Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}

	missingNodeRec := postWorkItemJSON(t, handler, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes", map[string]any{"company_id": companyID, "status": "done"})
	if missingNodeRec.Code != http.StatusBadRequest {
		t.Fatalf("create missing Node = %d, want 400 body=%s", missingNodeRec.Code, missingNodeRec.Body.String())
	}

	missingIssueRec := postWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/issue", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       "node-1",
	})
	if missingIssueRec.Code != http.StatusBadRequest {
		t.Fatalf("issue missing is_issue status = %d, want %d body=%s", missingIssueRec.Code, http.StatusBadRequest, missingIssueRec.Body.String())
	}

	missingRemoveNodeRec := postWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/remove", map[string]any{
		"company_id": companyID,
	})
	if missingRemoveNodeRec.Code != http.StatusBadRequest {
		t.Fatalf("remove missing node status = %d, want %d body=%s", missingRemoveNodeRec.Code, http.StatusBadRequest, missingRemoveNodeRec.Body.String())
	}
}

func postWorkItemJSON(t *testing.T, handler http.Handler, path string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	return workItemJSON(t, handler, http.MethodPost, path, body)
}

func workItemJSON(t *testing.T, handler http.Handler, method, path string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}
