package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestInboxPriorityMoveCommandKeepsSourceProjectionReadsAndEventsConsistent(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-123456789abc"
	repo.EnsureCompany(companyID, "Inbox Command Company")
	logicGate, node, responsibleUserID := setupInboxCommandAssignedNode(t, repo, companyID, "inbox-command-priority", 4)

	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	rec := postHomeDropWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/move", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"priority":      2,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("inbox priority move status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload store.LogicGateNodeAssignmentResult
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode move response: %v", err)
	}
	if payload.Node.Status == nil || *payload.Node.Status != "Pending" {
		t.Fatalf("moved node status = %+v, want Pending", payload.Node.Status)
	}
	if payload.Node.Priority == nil || *payload.Node.Priority != 2 {
		t.Fatalf("moved node priority = %+v, want 2", payload.Node.Priority)
	}
	if payload.Node.AssigneeUserID == nil || *payload.Node.AssigneeUserID != responsibleUserID {
		t.Fatalf("moved node assignee = %+v, want first Responsible user", payload.Node.AssigneeUserID)
	}
	if len(payload.Node.LogicGateIDs) != 1 || payload.Node.LogicGateIDs[0] != logicGate.LogicGateID {
		t.Fatalf("moved node logic_gate_ids = %+v, want assignment source", payload.Node.LogicGateIDs)
	}

	assignments, err := repo.ListNodeLogicGateAssignments(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments: %v", err)
	}
	if len(assignments) != 1 || assignments[0].StatusKey != "pending" || assignments[0].ColumnID != payload.Card.ColumnID {
		t.Fatalf("assignment after priority move = %+v, want pending source row", assignments)
	}
	if assignments[0].CompatibilityBoardID != payload.Card.BoardID || assignments[0].CompatibilityCardID != payload.Card.CardID {
		t.Fatalf("assignment compatibility link = %+v, want moved card", assignments[0])
	}

	cards, err := repo.ListKanbanCards(companyID, store.LogicGateKanbanBoardID(logicGate.LogicGateID), store.KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards: %v", err)
	}
	if len(cards) != 1 || cards[0].CardID != payload.Card.CardID || cards[0].ColumnID != payload.Card.ColumnID {
		t.Fatalf("compatibility cards after priority move = %+v, want moved command card", cards)
	}

	readRec := getWorkItemInboxRead(t, handler, "/v1/work-items/responsible-inbox?company_id="+companyID+"&user_id="+responsibleUserID)
	var readPayload struct {
		Nodes []domain.Node `json:"nodes"`
	}
	decodeWorkItemInboxReadPayload(t, readRec, &readPayload)
	if len(readPayload.Nodes) != 1 || readPayload.Nodes[0].Priority == nil || *readPayload.Nodes[0].Priority != 2 {
		t.Fatalf("responsible inbox nodes = %+v, want projection with priority 2", readPayload.Nodes)
	}

	semanticEvent := readWorkspaceEventForTest(t, stream)
	cardEvent := readWorkspaceEventForTest(t, stream)
	nodeEvent := readWorkspaceEventForTest(t, stream)
	if semanticEvent.Type != store.WorkItemLogicGateAssignmentMovedEventType || semanticEvent.Data["priority"] != float64(2) {
		t.Fatalf("semantic move event = %+v, want priority move", semanticEvent)
	}
	if cardEvent.Type != "kanban_card_moved" || nodeEvent.Type != "node_updated" {
		t.Fatalf("compatibility move events = %+v / %+v", cardEvent, nodeEvent)
	}

	durable, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if got := domainEventTypesForHTTPTest(durable); len(got) != 6 || got[3] != store.WorkItemLogicGateAssignmentMovedEventType || got[4] != "kanban_card_moved" || got[5] != "node_updated" {
		t.Fatalf("durable events = %+v, want initial assign plus priority move events", got)
	}
}

func TestInboxMoveCommandFailureDoesNotPartiallyUpdateOrPublish(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-abcdef123456"
	repo.EnsureCompany(companyID, "Inbox Command Failure Company")
	logicGate, node, _ := setupInboxCommandAssignedNode(t, repo, companyID, "inbox-command-failure", 4)

	beforeEvents, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter before failure: %v", err)
	}
	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	rec := postHomeDropWorkItemJSON(t, handler, "/v1/work-items/logic-gate-assignments/move", map[string]any{
		"company_id":    companyID,
		"logic_gate_id": logicGate.LogicGateID,
		"node_id":       node.NodeID,
		"status":        "blocked",
		"priority":      2,
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("failed inbox move status = %d, want %d body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}

	loaded, err := repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after failed move: %v", err)
	}
	if loaded.Status == nil || *loaded.Status != "Pending" || loaded.Priority == nil || *loaded.Priority != 4 {
		t.Fatalf("node after failed move = %+v, want original pending priority 4", loaded)
	}
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments after failed move: %v", err)
	}
	if len(assignments) != 1 || assignments[0].StatusKey != "pending" {
		t.Fatalf("assignment after failed move = %+v, want original pending row", assignments)
	}
	afterEvents, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter after failure: %v", err)
	}
	if len(afterEvents) != len(beforeEvents) {
		t.Fatalf("durable events after failed move = %+v, want unchanged count %d", domainEventTypesForHTTPTest(afterEvents), len(beforeEvents))
	}
	select {
	case payload := <-stream:
		t.Fatalf("hub published payload for failed inbox move: %s", string(payload))
	case <-time.After(100 * time.Millisecond):
	}
}

func setupInboxCommandAssignedNode(t *testing.T, repo *store.MemoryRepo, companyID, subject string, priority int) (domain.LogicGate, domain.Node, string) {
	t.Helper()
	logicGate, err := repo.CreateLogicGate(companyID, "Inbox Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Inbox command node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	responsible, err := repo.UpsertAuthUser(subject, subject+"@example.com", "Inbox Responsible")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleResponsible, UserID: responsible.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		NodeID:         node.NodeID,
		Status:         "pending",
		Priority:       &priority,
		PrioritySet:    true,
		AssigneePolicy: store.LogicGateAssignmentAssigneePolicyFirstResponsible,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus setup: %v", err)
	}
	return logicGate, node, responsible.UserID
}
func domainEventTypesForHTTPTest(events []domain.DomainEvent) []string {
	out := make([]string, 0, len(events))
	for _, event := range events {
		out = append(out, event.Type)
	}
	return out
}
