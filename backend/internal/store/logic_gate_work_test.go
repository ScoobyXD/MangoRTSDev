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
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus second: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      firstNode.NodeID,
		Status:      "pending",
		Position:    10,
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
}

func TestPhase4LogicGateWorkSourceShape(t *testing.T) {
	postgresSource := readPhase4SourceForTest(t, "postgres_logic_gate_work.go")
	normalizedPostgres := strings.ToLower(postgresSource)
	if !strings.Contains(normalizedPostgres, "from node_logic_gate_assignments assignment") {
		t.Fatalf("postgres logic gate work read does not select from node_logic_gate_assignments")
	}
	for _, forbidden := range []string{
		"from kanban_boards",
		"from kanban_columns",
		"from kanban_cards",
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

func readPhase4SourceForTest(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile %s: %v", path, err)
	}
	return string(content)
}
