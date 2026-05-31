package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type failingWorkItemAssignmentRepo struct {
	*store.MemoryRepo
	err error
}

func (r *failingWorkItemAssignmentRepo) AssignNodeToLogicGateStatus(input store.LogicGateNodeAssignmentInput) (store.LogicGateNodeAssignmentResult, error) {
	return store.LogicGateNodeAssignmentResult{}, r.err
}

func TestWorkItemAssignmentPublishesCommittedWorkspaceEventAfterAtomicCommit(t *testing.T) {
	backing := store.NewMemoryRepo()
	repo := backing
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "55555555-5555-4555-8555-555555555555"
	repo.EnsureCompany(companyID, "HTTP Assignment Event Company")
	logicGate, err := repo.CreateLogicGate(companyID, "HTTP Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "HTTP node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	actor := domain.User{UserID: "66666666-6666-4666-8666-666666666666", Email: "actor@example.com", DisplayName: "Actor"}

	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	body, _ := json.Marshal(map[string]any{"company_id": companyID, "logic_gate_id": logicGate.LogicGateID, "node_id": node.NodeID, "priority": 3, "status": "done"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/work-items/logic-gate-assignments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "http-assign-key")
	req = requestWithActorForTest(req, actor, companyID)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST assignment status = %d body=%s", rec.Code, rec.Body.String())
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := response["card"]; !ok {
		t.Fatalf("response = %+v, want card", response)
	}
	if _, ok := response["node"]; !ok {
		t.Fatalf("response = %+v, want node", response)
	}
	if _, ok := response["events"]; ok {
		t.Fatalf("response leaked events: %s", rec.Body.String())
	}
	if _, ok := response["assignment"]; ok {
		t.Fatalf("response leaked assignment: %s", rec.Body.String())
	}

	semantic := readWorkspaceEventForTest(t, stream)
	if semantic.Type != store.WorkItemLogicGateAssignmentSavedEventType || semantic.Data["company_id"] != companyID || semantic.Data["logic_gate_id"] != logicGate.LogicGateID || semantic.Data["node_id"] != node.NodeID {
		t.Fatalf("semantic hub event = %+v", semantic)
	}
	if semantic.Data["actor_user_id"] != actor.UserID || semantic.Data["idempotency_key"] != "http-assign-key" {
		t.Fatalf("semantic metadata = %+v", semantic.Data)
	}
	cardEvent := readWorkspaceEventForTest(t, stream)
	nodeEvent := readWorkspaceEventForTest(t, stream)
	if cardEvent.Type != "kanban_card_upserted" || nodeEvent.Type != "node_updated" {
		t.Fatalf("compatibility hub events = %+v / %+v", cardEvent, nodeEvent)
	}

	durable, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(durable) != 3 || durable[0].Type != store.WorkItemLogicGateAssignmentSavedEventType || durable[1].Type != "kanban_card_upserted" || durable[2].Type != "node_updated" {
		t.Fatalf("durable events = %+v, want atomic semantic plus compatibility events", durable)
	}
}

func TestWorkItemAssignmentDoesNotPublishHubEventWhenAtomicMutationFails(t *testing.T) {
	companyID := "77777777-7777-4777-8777-777777777777"
	repo := &failingWorkItemAssignmentRepo{MemoryRepo: store.NewMemoryRepo(), err: errors.New("commit failed")}
	server := NewServer(repo)
	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	body, _ := json.Marshal(map[string]any{"company_id": companyID, "logic_gate_id": "gate", "node_id": "node", "status": "done"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/work-items/logic-gate-assignments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("POST assignment status = %d body=%s, want 500", rec.Code, rec.Body.String())
	}

	select {
	case payload := <-stream:
		t.Fatalf("hub published payload for failed atomic mutation: %s", string(payload))
	case <-time.After(100 * time.Millisecond):
	}
}
