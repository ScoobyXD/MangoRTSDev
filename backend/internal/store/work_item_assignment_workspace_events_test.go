package store

import (
	"encoding/json"
	"errors"
	"maps"
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
	payload := assigned.Events[0].Payload
	if _, hasAssignee := payload["assignee_user_id"]; payload["status"] != "In Progress" || payload["priority"] != priority || hasAssignee {
		t.Fatalf("saved payload = %+v, want status/priority source state and no assignee", payload)
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
	if moved.Events[0].Payload["status"] != "Done" {
		t.Fatalf("moved payload = %+v, want done placement", moved.Events[0].Payload)
	}

	issue, err := repo.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, IsIssue: true})
	if err != nil {
		t.Fatalf("SetLogicGateNodeAssignmentIssue: %v", err)
	}
	assertWorkItemAssignmentSemanticEvent(t, issue.Events, WorkItemLogicGateIssueToggledEventType, companyID, logicGate.LogicGateID, node.NodeID, issue.Assignment.AssignmentID)
	if issue.Events[0].Payload["is_issue"] != true || issue.Events[0].Payload["status"] != "Done" {
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
		LogicGateRACIUpdatedEventType,
		WorkItemLogicGateAssignmentSavedEventType, "node_updated",
		WorkItemLogicGateAssignmentMovedEventType, "node_updated",
		WorkItemLogicGateIssueToggledEventType, "node_updated",
		WorkItemLogicGateAssignmentRemovedEventType, "node_updated",
	}
	if gotTypes := domainEventTypes(replay); !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("durable event types = %+v, want %+v", gotTypes, wantTypes)
	}
}

func TestMemoryCrossLogicGateMoveEventsIdentifySourceAndDestinationBoards(t *testing.T) {
	repo, companyID, sourceGate, node, actorUserID := setupWorkItemAssignmentEventTest(t, "aaaaaaaaaaac")
	targetGate, err := repo.CreateLogicGate(companyID, "Target Event Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate target: %v", err)
	}
	priority := 3
	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: sourceGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: actorUserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	moved, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:       companyID,
		LogicGateID:     targetGate.LogicGateID,
		FromLogicGateID: sourceGate.LogicGateID,
		NodeID:          node.NodeID,
		Status:          "requested",
		ActorUserID:     actorUserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment: %v", err)
	}

	if assigned.Assignment.LogicGateID == moved.Assignment.LogicGateID {
		t.Fatal("Expected distinct Processes")
	}
	payload := moved.Events[0].Payload
	if payload["logic_gate_id"] != targetGate.LogicGateID || payload["source_logic_gate_id"] != sourceGate.LogicGateID {
		t.Fatalf("move routing = %+v", payload)
	}
}

func TestMemoryWorkItemAssignmentEventAppendFailureRollsBackState(t *testing.T) {
	errAppend := errors.New("append failed")

	t.Run("assign", func(t *testing.T) {
		repo, companyID, logicGate, node, _ := setupWorkItemAssignmentEventTest(t, "bbbbbbbbbbba")
		priority := 5
		beforeEvents := maps.Clone(repo.domainEvents)
		repo.domainEventAppendErr = errAppend
		_, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "done", Priority: &priority, PrioritySet: true})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		assertMemoryDomainEventsUnchanged(t, repo.domainEvents, beforeEvents)
		assertNoLogicGateAssignmentForStoreTest(t, repo, companyID, node.NodeID)

	})

	t.Run("move", func(t *testing.T) {
		repo, companyID, logicGate, node, _ := setupWorkItemAssignmentEventTest(t, "bbbbbbbbbbbb")
		assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "pending", Priority: testPriority(3), PrioritySet: true})
		if err != nil {
			t.Fatalf("AssignNodeToLogicGateStatus setup: %v", err)
		}
		beforeEvents := maps.Clone(repo.domainEvents)
		repo.domainEventAppendErr = errAppend
		_, err = repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "done"})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		assertMemoryDomainEventsUnchanged(t, repo.domainEvents, beforeEvents)
		assignment := assertOneLogicGateAssignmentForStoreTest(t, repo, companyID, node.NodeID)
		if assignment.Version != assigned.Assignment.Version || nodeWorkStatus(repo.nodes[key(companyID, node.NodeID)]) != nodeWorkStatus(assigned.Node) {
			t.Fatalf("assignment after failed move = %+v, want original %+v", assignment, assigned.Assignment)
		}
	})

	t.Run("remove", func(t *testing.T) {
		repo, companyID, logicGate, node, _ := setupWorkItemAssignmentEventTest(t, "bbbbbbbbbbbc")
		assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, Status: "pending", Priority: testPriority(3), PrioritySet: true})
		if err != nil {
			t.Fatalf("AssignNodeToLogicGateStatus setup: %v", err)
		}
		beforeEvents := maps.Clone(repo.domainEvents)
		repo.domainEventAppendErr = errAppend
		_, err = repo.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		assertMemoryDomainEventsUnchanged(t, repo.domainEvents, beforeEvents)
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
		beforeEvents := maps.Clone(repo.domainEvents)
		repo.domainEventAppendErr = errAppend
		_, err := repo.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID, IsIssue: true})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		assertMemoryDomainEventsUnchanged(t, repo.domainEvents, beforeEvents)
		assignment := assertOneLogicGateAssignmentForStoreTest(t, repo, companyID, node.NodeID)
		if assignment.IsIssue {
			t.Fatalf("assignment after failed issue toggle = %+v, want is_issue false", assignment)
		}
	})
}

func assertMemoryDomainEventsUnchanged(t *testing.T, got, want map[string]domain.DomainEvent) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("domain events changed across failed mutation: got %+v want %+v", got, want)
	}
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
	resetMemoryMembershipEventState(repo)
	if _, err := repo.SetLogicGateRACIAssignments(LogicGateRACIAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: user.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateRACIAssignments: %v", err)
	}
	return repo, companyID, logicGate, node, user.UserID
}

func assertWorkItemAssignmentSemanticEvent(t *testing.T, events []domain.DomainEvent, eventType, companyID, logicGateID, nodeID, assignmentID string) {
	t.Helper()
	if len(events) != 2 {
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
	for _, field := range []string{"compatibility_board_id", "compatibility_card_id", "board_id", "card_id", "column_id", "status_key"} {
		if _, exists := payload[field]; exists {
			t.Fatalf("Obsolete event field %s", field)
		}
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
	if _, ok := fields["assignment"]; !ok {
		t.Fatalf("assignment response fields = %+v, want assignment", fields)
	}
	if _, ok := fields["node"]; !ok {
		t.Fatalf("assignment response fields = %+v, want node", fields)
	}
	if _, ok := fields["card"]; ok {
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
