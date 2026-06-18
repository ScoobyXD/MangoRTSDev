package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestHomeDropAssignmentCommandKeepsSourceProjectionNodeAndEventsConsistent(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-aabbccddeeff"
	repo.EnsureCompany(companyID, "Home Drop Command Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Home Drop Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Home dropped node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	responsible, err := repo.UpsertAuthUser("home-drop-responsible", "home-drop-responsible@example.com", "Home Responsible")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("home-drop-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: responsible.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}

	stream := server.workspaceEvents.subscribe(companyID)
	defer server.workspaceEvents.unsubscribe(companyID, stream)

	rec := postHomeDropWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments", map[string]any{
		"company_id":      companyID,
		"logic_gate_id":   logicGate.LogicGateID,
		"node_id":         node.NodeID,
		"status":          "in_progress",
		"priority":        1,
		"assignee_policy": "first_responsible",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("home drop assignment status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var payload store.LogicGateNodeAssignmentResult
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode home drop assignment response: %v", err)
	}
	if payload.Card.LogicGateID == nil || *payload.Card.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("card logic_gate_id = %+v, want %q", payload.Card.LogicGateID, logicGate.LogicGateID)
	}
	if payload.Node.Status == nil || *payload.Node.Status != "In Progress" {
		t.Fatalf("node status = %+v, want In Progress", payload.Node.Status)
	}
	if payload.Node.Priority == nil || *payload.Node.Priority != 1 {
		t.Fatalf("node priority = %+v, want 1", payload.Node.Priority)
	}
	if payload.Node.AssigneeUserID != nil {
		t.Fatalf("node assignee = %+v, want nil after GVIC migration", payload.Node.AssigneeUserID)
	}
	if len(payload.Node.LogicGateIDs) != 1 || payload.Node.LogicGateIDs[0] != logicGate.LogicGateID {
		t.Fatalf("node logic_gate_ids = %+v, want assignment-derived Logic Gate", payload.Node.LogicGateIDs)
	}

	assignments, err := repo.ListNodeLogicGateAssignments(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments: %v", err)
	}
	if len(assignments) != 1 {
		t.Fatalf("assignments = %+v, want one source row", assignments)
	}
	assignment := assignments[0]
	if assignment.LogicGateID != logicGate.LogicGateID || assignment.ColumnID != payload.Card.ColumnID || assignment.StatusKey != "in progress" {
		t.Fatalf("assignment source row = %+v, want Home drop placement", assignment)
	}
	if assignment.CompatibilityBoardID != payload.Card.BoardID || assignment.CompatibilityCardID != payload.Card.CardID {
		t.Fatalf("assignment compatibility link = %+v, want card %s/%s", assignment, payload.Card.BoardID, payload.Card.CardID)
	}

	cards, err := repo.ListKanbanCards(companyID, store.LogicGateKanbanBoardID(logicGate.LogicGateID), store.KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards: %v", err)
	}
	if len(cards) != 1 || cards[0].CardID != payload.Card.CardID || cards[0].ColumnID != payload.Card.ColumnID {
		t.Fatalf("compatibility cards = %+v, want command card", cards)
	}

	semanticEvent := readWorkspaceEventForTest(t, stream)
	cardEvent := readWorkspaceEventForTest(t, stream)
	nodeEvent := readWorkspaceEventForTest(t, stream)
	if semanticEvent.Type != store.WorkItemLogicGateAssignmentSavedEventType || semanticEvent.Data["logic_gate_id"] != logicGate.LogicGateID || semanticEvent.Data["node_id"] != node.NodeID {
		t.Fatalf("semantic hub event = %+v", semanticEvent)
	}
	if cardEvent.Type != "kanban_card_upserted" || nodeEvent.Type != "node_updated" {
		t.Fatalf("compatibility hub events = %+v / %+v", cardEvent, nodeEvent)
	}

	durable, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(durable) != 3 || durable[0].Type != store.WorkItemLogicGateAssignmentSavedEventType || durable[1].Type != "kanban_card_upserted" || durable[2].Type != "node_updated" {
		t.Fatalf("durable events = %+v, want atomic Home drop semantic plus compatibility events", durable)
	}
}

func TestHomeDropAssignmentCommandFailureDoesNotPartiallyUpdateOrPublish(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-bbccddeeff00"
	repo.EnsureCompany(companyID, "Home Drop Failure Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Home Drop Failure Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Home failed drop node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 4
	status := "Backlog"
	if _, err := repo.UpdateNode(store.UpdateNodeInput{
		CompanyID:   companyID,
		NodeID:      node.NodeID,
		Status:      &status,
		StatusSet:   true,
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("seed node fallback state: %v", err)
	}

	stream := server.workspaceEvents.subscribe(companyID)
	defer server.workspaceEvents.unsubscribe(companyID, stream)

	rec := postHomeDropWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"status":        "not a real status",
		"priority":      nil,
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("failed home drop status = %d, want %d body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}

	assignments, err := repo.ListNodeLogicGateAssignments(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments: %v", err)
	}
	if len(assignments) != 0 {
		t.Fatalf("assignments after failed Home drop = %+v, want none", assignments)
	}
	cards, err := repo.ListKanbanCards(companyID, store.LogicGateKanbanBoardID(logicGate.LogicGateID), store.KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards: %v", err)
	}
	if len(cards) != 0 {
		t.Fatalf("cards after failed Home drop = %+v, want none", cards)
	}
	loaded, err := repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after failed Home drop: %v", err)
	}
	if loaded.Status == nil || *loaded.Status != status || loaded.StatusColor != nil || loaded.Priority == nil || *loaded.Priority != priority {
		t.Fatalf("node after failed Home drop = %+v, want original fallback state", loaded)
	}
	durable, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(durable) != 0 {
		t.Fatalf("durable events after failed Home drop = %+v, want none", durable)
	}
	select {
	case payload := <-stream:
		t.Fatalf("hub published payload for failed Home drop: %s", string(payload))
	case <-time.After(100 * time.Millisecond):
	}
}

func postHomeDropWorkItemJSON(t *testing.T, handler http.Handler, path string, body map[string]any) *httptest.ResponseRecorder {
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
