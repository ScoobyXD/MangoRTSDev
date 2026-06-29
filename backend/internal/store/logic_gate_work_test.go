package store

import (
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
)

func TestMemoryLogicGateWorkReadsAssignmentsWithoutKanbanCards(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555401"
	repo.EnsureCompany(companyID, "Logic Gate Work Store Co")

	logicGate, err := repo.CreateLogicGate(companyID, "Release Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	firstNode, err := repo.CreateNode(companyID, "Pending work")
	if err != nil {
		t.Fatalf("CreateNode first: %v", err)
	}
	secondNode, err := repo.CreateNode(companyID, "Progress work")
	if err != nil {
		t.Fatalf("CreateNode second: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      secondNode.NodeID,
		Status:      "in_progress",
		Position:    20,
		Priority:    testPriority(4),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus second: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      firstNode.NodeID,
		Status:      "pending",
		Position:    10,
		Priority:    testPriority(2),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus first: %v", err)
	}

	repo.mu.Lock()
	delete(repo.kanbanCards, boardKey(companyID, LogicGateKanbanBoardID(logicGate.LogicGateID)))
	repo.mu.Unlock()

	work, err := repo.GetLogicGateWork(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateWork: %v", err)
	}
	if len(work.Assignments) != 2 {
		t.Fatalf("assignments len = %d, want 2", len(work.Assignments))
	}
	if work.Assignments[0].Assignment.NodeID != firstNode.NodeID || work.Assignments[0].Assignment.StatusKey != LogicGateWorkStatusPending {
		t.Fatalf("first assignment = %+v, want pending first node", work.Assignments[0].Assignment)
	}
	if work.Assignments[1].Assignment.NodeID != secondNode.NodeID || work.Assignments[1].Assignment.StatusKey != LogicGateWorkStatusInProgress {
		t.Fatalf("second assignment = %+v, want in_progress second node", work.Assignments[1].Assignment)
	}
	if len(work.Cards) != 2 || work.Cards[1].ColumnID != LogicGateWorkStatusInProgress {
		t.Fatalf("synthesized cards = %+v, want canonical in_progress card", work.Cards)
	}
	if work.Cards[0].Priority == nil || *work.Cards[0].Priority != 2 || work.Cards[1].Priority == nil || *work.Cards[1].Priority != 4 {
		t.Fatalf("synthesized card priorities = %+v, want node priorities 2 and 4", work.Cards)
	}
}

func TestMemoryLogicGateRequestedAssignmentsTrackRequester(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555402"
	repo.EnsureCompany(companyID, "Logic Gate Request Store Co")

	requester := mustCreateGVICMembershipUser(t, repo, "logic-gate-requester", companyID)
	responsible := mustCreateGVICMembershipUser(t, repo, "logic-gate-responsible", companyID)
	logicGate, err := repo.CreateLogicGate(companyID, "Request Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: responsible.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Requested work")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 3
	requested, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusRequested,
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: requester.UserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus requested: %v", err)
	}
	if requested.Card.RequestedByUserID != requester.UserID || requested.Assignment.RequestedByUserID != requester.UserID {
		t.Fatalf("requested sender card=%q assignment=%q, want %q", requested.Card.RequestedByUserID, requested.Assignment.RequestedByUserID, requester.UserID)
	}

	accepted, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		ActorUserID: responsible.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment accept: %v", err)
	}
	if accepted.Card.ColumnID != LogicGateWorkStatusPending || accepted.Card.RequestedByUserID != "" || accepted.Assignment.RequestedByUserID != "" {
		t.Fatalf("accepted card=%+v assignment=%+v, want pending with cleared requester", accepted.Card, accepted.Assignment)
	}

	requestedAgain, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusRequested,
		ActorUserID: requester.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment request again: %v", err)
	}
	if requestedAgain.Card.RequestedByUserID != requester.UserID {
		t.Fatalf("requested again sender = %q, want %q", requestedAgain.Card.RequestedByUserID, requester.UserID)
	}
	denied, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusBacklog,
		ActorUserID: responsible.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment deny: %v", err)
	}
	if denied.Card.ColumnID != LogicGateWorkStatusBacklog || denied.Card.RequestedByUserID != "" || denied.Assignment.RequestedByUserID != "" {
		t.Fatalf("denied card=%+v assignment=%+v, want backlog with cleared requester", denied.Card, denied.Assignment)
	}
}

func TestMemoryLogicGateAssignmentsTrackPlacedByUser(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555403"
	repo.EnsureCompany(companyID, "Logic Gate Placement Store Co")

	creator := mustCreateGVICMembershipUser(t, repo, "logic-gate-placement-creator", companyID)
	transferActor := mustCreateGVICMembershipUser(t, repo, "logic-gate-placement-transfer", companyID)
	sourceGate, err := repo.CreateLogicGate(companyID, "Placement Source")
	if err != nil {
		t.Fatalf("CreateLogicGate source: %v", err)
	}
	targetGate, err := repo.CreateLogicGate(companyID, "Placement Target")
	if err != nil {
		t.Fatalf("CreateLogicGate target: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Placed work")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: sourceGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: creator.UserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if assigned.Card.PlacedByUserID != creator.UserID || assigned.Assignment.PlacedByUserID != creator.UserID {
		t.Fatalf("assigned placed_by card=%q assignment=%q, want %q", assigned.Card.PlacedByUserID, assigned.Assignment.PlacedByUserID, creator.UserID)
	}

	sameGateMove, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: sourceGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusInProgress,
		ActorUserID: transferActor.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment same gate: %v", err)
	}
	if sameGateMove.Card.PlacedByUserID != creator.UserID || sameGateMove.Assignment.PlacedByUserID != creator.UserID {
		t.Fatalf("same-gate placed_by card=%q assignment=%q, want original %q", sameGateMove.Card.PlacedByUserID, sameGateMove.Assignment.PlacedByUserID, creator.UserID)
	}

	crossGateMove, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:       companyID,
		LogicGateID:     targetGate.LogicGateID,
		FromLogicGateID: sourceGate.LogicGateID,
		NodeID:          node.NodeID,
		Status:          LogicGateWorkStatusPending,
		ActorUserID:     transferActor.UserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment cross gate: %v", err)
	}
	if crossGateMove.Card.PlacedByUserID != transferActor.UserID || crossGateMove.Assignment.PlacedByUserID != transferActor.UserID {
		t.Fatalf("cross-gate placed_by card=%q assignment=%q, want transfer actor %q", crossGateMove.Card.PlacedByUserID, crossGateMove.Assignment.PlacedByUserID, transferActor.UserID)
	}

	work, err := repo.GetLogicGateWork(companyID, targetGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateWork: %v", err)
	}
	if len(work.Cards) != 1 || work.Cards[0].PlacedByUserID != transferActor.UserID {
		t.Fatalf("target work cards = %+v, want placed_by transfer actor", work.Cards)
	}
}

func TestPhase4LogicGateWorkSourceShape(t *testing.T) {
	postgresSource := readPhase4SourceForTest(t, "postgres_logic_gate_work.go")
	normalizedPostgres := strings.ToLower(postgresSource)
	if !strings.Contains(normalizedPostgres, "from kanban_board_projection projection") {
		t.Fatalf("postgres logic gate work read does not select from kanban_board_projection")
	}
	if !strings.Contains(normalizedPostgres, "join node_logic_gate_assignments assignment") {
		t.Fatalf("postgres logic gate work read does not join assignment metadata narrowly")
	}
	if !strings.Contains(normalizedPostgres, "projection.priority") {
		t.Fatalf("postgres logic gate work read does not select projection priority")
	}
	for _, forbidden := range []string{
		"from kanban_boards",
		"from kanban_columns",
		"from kanban_cards",
		"join nodes",
		"join kanban_boards",
		"join kanban_columns",
		"join kanban_cards",
		"listaccessibleentityids",
		"mangorts_user_can_access_resource",
	} {
		if strings.Contains(normalizedPostgres, forbidden) {
			t.Fatalf("postgres logic gate work read contains forbidden source %q", forbidden)
		}
	}

	handlerSource := strings.ToLower(readPhase4SourceForTest(t, "../http/logic_gate_work_handlers.go"))
	for _, forbidden := range []string{
		"listaccessibleentityids",
		"mangorts_user_can_access_resource",
		"usercanaccessentity",
		"requireentityview",
		"requireentityedit",
		"requirekanbanboardview",
		"requirekanbancardview",
		"recordkanbanstatenotification",
		"kanbancardnotificationsnapshot",
	} {
		if strings.Contains(handlerSource, forbidden) {
			t.Fatalf("v2 logic gate work handler contains forbidden access path %q", forbidden)
		}
	}

	workItemHandlerSource := strings.ToLower(readPhase4SourceForTest(t, "../http/work_item_handlers.go"))
	for _, forbidden := range []string{
		"recordkanbanstatenotification",
		"logicgateassignmentnotificationsnapshot",
		"kanbancardnotificationsnapshot",
	} {
		if strings.Contains(workItemHandlerSource, forbidden) {
			t.Fatalf("work item assignment handler contains replaced notification helper %q", forbidden)
		}
	}
}

func TestPostgresKanbanProjectionCardListSelectsCardMetadata(t *testing.T) {
	source := strings.ToLower(readPhase4SourceForTest(t, "postgres_kanban_projection.go"))
	functionIndex := strings.Index(source, "func listkanbanboardprojectioncardstx")
	if functionIndex < 0 {
		t.Fatalf("postgres kanban projection card list function not found")
	}
	functionSource := source[functionIndex:]
	fromProjectedIndex := strings.Index(functionSource, "from projected")
	if fromProjectedIndex < 0 {
		t.Fatalf("postgres kanban projection card list does not select from projected CTE")
	}
	outerSelectSource := functionSource[:fromProjectedIndex]
	outerSelectIndex := strings.LastIndex(outerSelectSource, "select")
	if outerSelectIndex < 0 {
		t.Fatalf("postgres kanban projection card list outer select not found")
	}
	outerSelect := outerSelectSource[outerSelectIndex:]
	for _, required := range []string{
		"due_date",
		"priority",
	} {
		if !strings.Contains(outerSelect, required) {
			t.Fatalf("postgres kanban projection card list outer select missing %s", required)
		}
	}
	for _, removed := range []string{
		"assignee_user_id",
		"assignee_display_name",
		"assignee_email",
	} {
		if strings.Contains(outerSelect, removed) {
			t.Fatalf("postgres kanban projection card list outer select still contains removed %s", removed)
		}
	}
}

func readPhase4SourceForTest(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile %s: %v", path, err)
	}
	return string(content)
}
