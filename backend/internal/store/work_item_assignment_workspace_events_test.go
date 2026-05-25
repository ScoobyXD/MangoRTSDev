package store

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryWorkItemAssignmentWorkspaceEventsAreAtomicAndSemantic(t *testing.T) {
	repo, companyID, logicGate, node, actorUserID := setupWorkItemAssignmentEventTest(t, "aaaaaaaaaaaa")
	priority := 4

	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		NodeID:         node.NodeID,
		Status:         "in_progress",
		Priority:       &priority,
		PrioritySet:    true,
		ActorUserID:    actorUserID,
		IdempotencyKey: "assign-key",
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	assertWorkItemAssignmentSemanticEvent(t, assigned.Events, WorkItemLogicGateAssignmentSavedEventType, companyID, logicGate.LogicGateID, node.NodeID, assigned.Assignment.AssignmentID)
	assertKanbanEventCardColumn(t, assigned.Events[1], LogicGateWorkStatusInProgress)
	payload := assigned.Events[0].Payload
	if payload["status"] != "In Progress" || payload["status_key"] != "in progress" || payload["priority"] != priority || payload["assignee_user_id"] != actorUserID {
		t.Fatalf("saved payload = %+v, want status/priority/assignee from source state", payload)
	}
	if assigned.Events[0].ActorUserID == nil || *assigned.Events[0].ActorUserID != actorUserID || payload["actor_user_id"] != actorUserID || payload["idempotency_key"] != "assign-key" {
		t.Fatalf("saved actor/idempotency = actor=%+v payload=%+v", assigned.Events[0].ActorUserID, payload)
	}
	assertAssignmentResponseContractHiddenFields(t, assigned)

	moved, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "done"})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment: %v", err)
	}
	assertWorkItemAssignmentSemanticEvent(t, moved.Events, WorkItemLogicGateAssignmentMovedEventType, companyID, logicGate.LogicGateID, node.NodeID, moved.Assignment.AssignmentID)
	assertKanbanEventCardColumn(t, moved.Events[1], LogicGateWorkStatusDone)
	if moved.Events[0].Payload["status"] != "Done" || moved.Events[0].Payload["column_id"] != moved.Card.ColumnID {
		t.Fatalf("moved payload = %+v, want done placement", moved.Events[0].Payload)
	}

	issue, err := repo.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, IsIssue: true})
	if err != nil {
		t.Fatalf("SetLogicGateNodeAssignmentIssue: %v", err)
	}
	assertWorkItemAssignmentSemanticEvent(t, issue.Events, WorkItemLogicGateIssueToggledEventType, companyID, logicGate.LogicGateID, node.NodeID, issue.Assignment.AssignmentID)
	assertKanbanEventCardColumn(t, issue.Events[1], LogicGateWorkStatusDone)
	if issue.Events[0].Payload["is_issue"] != true || issue.Events[0].Payload["status"] != "Issue" {
		t.Fatalf("issue payload = %+v, want issue state", issue.Events[0].Payload)
	}

	removed, err := repo.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID})
	if err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment: %v", err)
	}
	assertWorkItemAssignmentSemanticEvent(t, removed.Events, WorkItemLogicGateAssignmentRemovedEventType, companyID, logicGate.LogicGateID, node.NodeID, removed.Assignment.AssignmentID)

	replay, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	wantTypes := []string{
		WorkItemLogicGateAssignmentSavedEventType, "kanban_card_upserted", "node_updated",
		WorkItemLogicGateAssignmentMovedEventType, "kanban_card_moved", "node_updated",
		WorkItemLogicGateIssueToggledEventType, "kanban_card_moved", "node_updated",
		WorkItemLogicGateAssignmentRemovedEventType, "kanban_card_deleted", "node_updated",
	}
	if gotTypes := domainEventTypes(replay); !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("durable event types = %+v, want %+v", gotTypes, wantTypes)
	}
}

func assertKanbanEventCardColumn(t *testing.T, event domain.DomainEvent, wantColumnID string) {
	t.Helper()
	card, ok := event.Payload["card"].(domain.KanbanCard)
	if !ok {
		t.Fatalf("%s card payload = %T, want domain.KanbanCard", event.Type, event.Payload["card"])
	}
	if card.ColumnID != wantColumnID {
		t.Fatalf("%s card column = %q, want %q: %+v", event.Type, card.ColumnID, wantColumnID, card)
	}
}

func TestMemoryWorkItemAssignmentEventAppendFailureRollsBackState(t *testing.T) {
	errAppend := errors.New("append failed")

	t.Run("assign", func(t *testing.T) {
		repo, companyID, logicGate, node, _ := setupWorkItemAssignmentEventTest(t, "bbbbbbbbbbba")
		priority := 5
		repo.domainEventAppendErr = errAppend
		_, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "done", Priority: &priority, PrioritySet: true})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
		assertNoLogicGateAssignmentForStoreTest(t, repo, companyID, node.NodeID)
		cards, err := repo.ListKanbanCards(companyID, LogicGateKanbanBoardID(logicGate.LogicGateID), KanbanCardQuery{Limit: 10})
		if err != nil || len(cards) != 0 {
			t.Fatalf("cards after failed assign = %+v err=%v, want none", cards, err)
		}
	})

	t.Run("move", func(t *testing.T) {
		repo, companyID, logicGate, node, _ := setupWorkItemAssignmentEventTest(t, "bbbbbbbbbbbb")
		assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "pending", Priority: testPriority(3), PrioritySet: true})
		if err != nil {
			t.Fatalf("AssignNodeToLogicGateStatus setup: %v", err)
		}
		repo.domainEventAppendErr = errAppend
		_, err = repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "done"})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		assertWorkspaceEventCount(t, repo, companyID, 3)
		assignment := assertOneLogicGateAssignmentForStoreTest(t, repo, companyID, node.NodeID)
		if assignment.ColumnID != assigned.Card.ColumnID || assignment.StatusKey != assigned.Assignment.StatusKey {
			t.Fatalf("assignment after failed move = %+v, want original %+v", assignment, assigned.Assignment)
		}
	})

	t.Run("remove", func(t *testing.T) {
		repo, companyID, logicGate, node, _ := setupWorkItemAssignmentEventTest(t, "bbbbbbbbbbbc")
		assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "pending", Priority: testPriority(3), PrioritySet: true})
		if err != nil {
			t.Fatalf("AssignNodeToLogicGateStatus setup: %v", err)
		}
		repo.domainEventAppendErr = errAppend
		_, err = repo.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		assertWorkspaceEventCount(t, repo, companyID, 3)
		assignment := assertOneLogicGateAssignmentForStoreTest(t, repo, companyID, node.NodeID)
		if assignment.AssignmentID != assigned.Assignment.AssignmentID {
			t.Fatalf("assignment after failed remove = %+v, want original %+v", assignment, assigned.Assignment)
		}
	})

	t.Run("issue", func(t *testing.T) {
		repo, companyID, logicGate, node, _ := setupWorkItemAssignmentEventTest(t, "bbbbbbbbbbbd")
		if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "pending", Priority: testPriority(3), PrioritySet: true}); err != nil {
			t.Fatalf("AssignNodeToLogicGateStatus setup: %v", err)
		}
		repo.domainEventAppendErr = errAppend
		_, err := repo.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, IsIssue: true})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		assertWorkspaceEventCount(t, repo, companyID, 3)
		assignment := assertOneLogicGateAssignmentForStoreTest(t, repo, companyID, node.NodeID)
		if assignment.IsIssue {
			t.Fatalf("assignment after failed issue toggle = %+v, want is_issue false", assignment)
		}
	})
}

func setupWorkItemAssignmentEventTest(t *testing.T, suffix string) (*MemoryRepo, string, domain.LogicGate, domain.Node, string) {
	t.Helper()
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-" + suffix
	repo.EnsureCompany(companyID, "Assignment Event Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Event Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Event node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	user, err := repo.UpsertAuthUser("actor-"+suffix, "actor-"+suffix+"@example.com", "Actor User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("actor-"+suffix, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleResponsible, UserID: user.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	return repo, companyID, logicGate, node, user.UserID
}

func assertWorkItemAssignmentSemanticEvent(t *testing.T, events []domain.DomainEvent, eventType, companyID, logicGateID, nodeID, assignmentID string) {
	t.Helper()
	if len(events) != 3 {
		t.Fatalf("events len = %d, want semantic plus compatibility events: %+v", len(events), events)
	}
	event := events[0]
	if event.Type != eventType || event.StreamType != workspaceDomainStreamType || event.StreamID != companyID {
		t.Fatalf("semantic event = %+v, want %s on workspace stream", event, eventType)
	}
	payload := event.Payload
	if payload["company_id"] != companyID || payload["logic_gate_id"] != logicGateID || payload["node_id"] != nodeID || payload["assignment_id"] != assignmentID {
		t.Fatalf("semantic payload identifiers = %+v", payload)
	}
	if payload["compatibility_board_id"] == "" || payload["compatibility_card_id"] == "" || payload["board_id"] == "" || payload["card_id"] == "" {
		t.Fatalf("semantic payload compatibility ids = %+v", payload)
	}
}

func assertAssignmentResponseContractHiddenFields(t *testing.T, result LogicGateNodeAssignmentResult) {
	t.Helper()
	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal assignment result: %v", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		t.Fatalf("unmarshal assignment result: %v", err)
	}
	if _, ok := fields["card"]; !ok {
		t.Fatalf("assignment response fields = %+v, want card", fields)
	}
	if _, ok := fields["node"]; !ok {
		t.Fatalf("assignment response fields = %+v, want node", fields)
	}
	if _, ok := fields["assignment"]; ok {
		t.Fatalf("assignment response leaked hidden assignment field: %s", string(body))
	}
	if _, ok := fields["events"]; ok {
		t.Fatalf("assignment response leaked hidden events field: %s", string(body))
	}
}

func domainEventTypes(events []domain.DomainEvent) []string {
	out := make([]string, 0, len(events))
	for _, event := range events {
		out = append(out, event.Type)
	}
	return out
}

func assertWorkspaceEventCount(t *testing.T, repo *MemoryRepo, companyID string, want int) {
	t.Helper()
	events, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(events) != want {
		t.Fatalf("workspace events len = %d, want %d: %+v", len(events), want, events)
	}
}

func assertOneLogicGateAssignmentForStoreTest(t *testing.T, repo *MemoryRepo, companyID, nodeID string) domain.NodeLogicGateAssignment {
	t.Helper()
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, nodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments: %v", err)
	}
	if len(assignments) != 1 {
		t.Fatalf("assignments = %+v, want one", assignments)
	}
	return assignments[0]
}

func assertNoLogicGateAssignmentForStoreTest(t *testing.T, repo *MemoryRepo, companyID, nodeID string) {
	t.Helper()
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, nodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments: %v", err)
	}
	if len(assignments) != 0 {
		t.Fatalf("assignments = %+v, want none", assignments)
	}
}
