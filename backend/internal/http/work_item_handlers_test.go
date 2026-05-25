package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/store"
)

func TestWorkItemLogicGateAssignmentAPIUsesKanbanBackedCommand(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-cccccccccccc"
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
		"company_id":      companyID,
		"logic_gate_id":   logicGate.LogicGateID,
		"node_id":         node.NodeID,
		"status":          "done",
		"priority":        3,
		"assignee_policy": "first_responsible",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/work-items/logic-gate-assignments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST work item assignment status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var payload store.LogicGateNodeAssignmentResult
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode assignment payload: %v", err)
	}
	if payload.Card.LogicGateID == nil || *payload.Card.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("card logic_gate_id = %+v, want %q", payload.Card.LogicGateID, logicGate.LogicGateID)
	}
	if payload.Node.Status == nil || *payload.Node.Status != "Done" {
		t.Fatalf("node status = %+v, want Done", payload.Node.Status)
	}
	if payload.Node.Priority == nil || *payload.Node.Priority != 3 {
		t.Fatalf("node priority = %+v, want 3", payload.Node.Priority)
	}
	if len(payload.Node.LogicGateIDs) != 1 || payload.Node.LogicGateIDs[0] != logicGate.LogicGateID {
		t.Fatalf("node logic_gate_ids = %+v, want card-derived Logic Gate", payload.Node.LogicGateIDs)
	}

	cards, err := repo.ListKanbanCards(companyID, store.LogicGateKanbanBoardID(logicGate.LogicGateID), store.KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards: %v", err)
	}
	if len(cards) != 1 || cards[0].CardID != payload.Card.CardID || cards[0].ColumnID != payload.Card.ColumnID {
		t.Fatalf("persisted cards = %+v, want command card", cards)
	}

	methodReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/logic-gate-assignments", nil)
	methodRec := httptest.NewRecorder()
	handler.ServeHTTP(methodRec, methodReq)
	if methodRec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET work item assignment status = %d, want %d", methodRec.Code, http.StatusMethodNotAllowed)
	}
}

func TestWorkItemLogicGateAssignmentParityEndpoints(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-dddddddddddd"
	repo.EnsureCompany(companyID, "Assignment Parity API Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Parity Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Parity node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	assignRec := postWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"status":        "pending",
		"priority":      2,
	})
	if assignRec.Code != http.StatusOK {
		t.Fatalf("assign status = %d, want %d body=%s", assignRec.Code, http.StatusOK, assignRec.Body.String())
	}

	invalidMoveRec := postWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/move", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"status":        "Not a status",
		"priority":      nil,
	})
	if invalidMoveRec.Code != http.StatusNotFound {
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

	moveRec := postWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/move", map[string]any{
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
	if moved.Card.ColumnID == "" || moved.Node.NodeID != node.NodeID {
		t.Fatalf("move response = %+v, want card and node", moved)
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
	if issueOn.Node.Status == nil || *issueOn.Node.Status != "Issue" {
		t.Fatalf("issue true node status = %+v, want Issue", issueOn.Node.Status)
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
		"company_id":            companyID,
		"logic_gate_id":         logicGate.LogicGateID,
		"node_id":               node.NodeID,
		"fallback_status":       "Backlog",
		"fallback_status_color": "#654321",
	})
	if removeRec.Code != http.StatusOK {
		t.Fatalf("remove status = %d, want %d body=%s", removeRec.Code, http.StatusOK, removeRec.Body.String())
	}
	var removed store.LogicGateNodeAssignmentRemoveResult
	if err := json.NewDecoder(removeRec.Body).Decode(&removed); err != nil {
		t.Fatalf("decode remove response: %v", err)
	}
	if removed.Card.CardID == "" || removed.Node.NodeID != node.NodeID {
		t.Fatalf("remove response = %+v, want removed card and node", removed)
	}
	if removed.Node.Status == nil || *removed.Node.Status != "Backlog" {
		t.Fatalf("remove fallback status = %+v, want Backlog", removed.Node.Status)
	}
	if len(removed.Node.LogicGateIDs) != 0 {
		t.Fatalf("remove node logic_gate_ids = %+v, want none", removed.Node.LogicGateIDs)
	}
}

func TestWorkItemLogicGateAssignmentParityEndpointValidation(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-eeeeeeeeeeee"
	repo.EnsureCompany(companyID, "Assignment Validation API Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Validation Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}

	missingNodeRec := postWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/move", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"status":        "done",
	})
	if missingNodeRec.Code != http.StatusBadRequest {
		t.Fatalf("move missing node status = %d, want %d body=%s", missingNodeRec.Code, http.StatusBadRequest, missingNodeRec.Body.String())
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
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}
