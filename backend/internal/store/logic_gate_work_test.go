package store

import (
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
