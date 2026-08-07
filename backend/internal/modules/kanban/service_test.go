package kanban

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"testing"
)

func TestAssignNodeToLogicGateStatusWritesAssignmentSourceAndKanbanProjection(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "11111111-1111-4111-8111-aaaaaaaaaaaa"
	repo.EnsureCompany(companyID, "Assignment Company")

	logicGate, err := repo.CreateLogicGate(companyID, "Launch Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Ship checklist")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	responsibleUser, err := repo.UpsertAuthUser("assignment-responsible", "responsible@example.com", "Responsible User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("assignment-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	if _, err := repo.SetLogicGateRACIAssignments(store.LogicGateRACIAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRACIAssignmentInput{{
			Role:   domain.RACIRoleResponsible,
			UserID: responsibleUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRACIAssignments: %v", err)
	}

	fallbackStatus := "Direct fallback"
	if _, err := repo.UpdateNode(store.UpdateNodeInput{
		CompanyID: companyID,
		NodeID:    node.NodeID,
		Status:    &fallbackStatus,
		StatusSet: true,
	}); err != nil {
		t.Fatalf("UpdateNode fallback status: %v", err)
	}
	loaded, err := repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode before assignment: %v", err)
	}
	if loaded.Status == nil || *loaded.Status != fallbackStatus || len(loaded.LogicGateIDs) != 0 {
		t.Fatalf("fallback node = %+v, want direct status with no Logic Gate membership", loaded)
	}

	priority := 2
	assigned, err := service.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "in_progress",
		Priority:    &priority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if assigned.Card.LogicGateID == nil || *assigned.Card.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("assigned card logic_gate_id = %+v, want %q", assigned.Card.LogicGateID, logicGate.LogicGateID)
	}
	if assigned.Node.Status == nil || *assigned.Node.Status != "In Progress" {
		t.Fatalf("assigned node status = %+v, want In Progress", assigned.Node.Status)
	}
	if assigned.Node.Priority == nil || *assigned.Node.Priority != priority {
		t.Fatalf("assigned node priority = %+v, want %d", assigned.Node.Priority, priority)
	}
	if len(assigned.Node.LogicGateIDs) != 1 || assigned.Node.LogicGateIDs[0] != logicGate.LogicGateID {
		t.Fatalf("assigned node logic_gate_ids = %+v, want assignment-derived Logic Gate", assigned.Node.LogicGateIDs)
	}
	assertLogicGateAssignmentSource(t, repo, companyID, node.NodeID, logicGate.LogicGateID, assigned.Card, false)

	directOverride := "Direct override"
	if _, err := repo.UpdateNode(store.UpdateNodeInput{
		CompanyID: companyID,
		NodeID:    node.NodeID,
		Status:    &directOverride,
		StatusSet: true,
	}); err != nil {
		t.Fatalf("UpdateNode direct override: %v", err)
	}
	loaded, err = repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after direct override: %v", err)
	}
	if loaded.Status == nil || *loaded.Status != "In Progress" {
		t.Fatalf("status after direct override = %+v, want assignment-derived In Progress", loaded.Status)
	}

	issue := true
	issueResult, err := service.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "done",
		IsIssue:     issue,
		IsIssueSet:  true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus issue: %v", err)
	}
	if issueResult.Card.CardID != assigned.Card.CardID {
		t.Fatalf("issue assignment card_id = %q, want existing card %q", issueResult.Card.CardID, assigned.Card.CardID)
	}
	if issueResult.Node.Status == nil || *issueResult.Node.Status != "Issue" {
		t.Fatalf("issue node status = %+v, want Issue", issueResult.Node.Status)
	}
	assertLogicGateAssignmentSource(t, repo, companyID, node.NodeID, logicGate.LogicGateID, issueResult.Card, true)
}

func TestAssignNodeToLogicGateStatusDoesNotPatchNodeWhenPlacementFails(t *testing.T) {
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "11111111-1111-4111-8111-bbbbbbbbbbbb"
	repo.EnsureCompany(companyID, "Assignment Atomic Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Atomic Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Atomic node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 4
	if _, err := repo.UpdateNode(store.UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: &priority, PrioritySet: true}); err != nil {
		t.Fatalf("seed priority: %v", err)
	}

	clearPriority := (*int)(nil)
	_, err = service.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		ColumnID:    "missing-column",
		Priority:    clearPriority,
		PrioritySet: true,
	})
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("AssignNodeToLogicGateStatus error = %v, want ErrNotFound", err)
	}
	loaded, err := repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after failed assignment: %v", err)
	}
	if loaded.Priority == nil || *loaded.Priority != priority {
		t.Fatalf("priority after failed assignment = %+v, want unchanged %d", loaded.Priority, priority)
	}
	cards, err := repo.ListKanbanCards(companyID, store.LogicGateKanbanBoardID(logicGate.LogicGateID), store.KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards after failed assignment: %v", err)
	}
	if len(cards) != 0 {
		t.Fatalf("cards after failed assignment = %+v, want none", cards)
	}
}

func TestLogicGateAssignmentMoveIssueAndRemoveCommands(t *testing.T) {
	repo, service, companyID, logicGate, node := setupLogicGateAssignmentCommandTest(t, "cccccccccccc")
	priority := 4
	assigned, err := service.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	assertLogicGateAssignmentSource(t, repo, companyID, node.NodeID, logicGate.LogicGateID, assigned.Card, false)

	moved, err := service.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "done",
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment: %v", err)
	}
	if moved.Card.CardID != assigned.Card.CardID {
		t.Fatalf("moved card_id = %q, want existing card %q", moved.Card.CardID, assigned.Card.CardID)
	}
	if moved.Node.Status == nil || *moved.Node.Status != "Done" {
		t.Fatalf("moved node status = %+v, want Done", moved.Node.Status)
	}
	if moved.Node.Priority == nil || *moved.Node.Priority != priority {
		t.Fatalf("moved node priority = %+v, want unchanged %d", moved.Node.Priority, priority)
	}
	assertLogicGateAssignmentSource(t, repo, companyID, node.NodeID, logicGate.LogicGateID, moved.Card, false)

	issueOn, err := service.SetLogicGateNodeAssignmentIssue(store.LogicGateNodeAssignmentIssueInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		IsIssue:     true,
	})
	if err != nil {
		t.Fatalf("SetLogicGateNodeAssignmentIssue true: %v", err)
	}
	if issueOn.Node.Status == nil || *issueOn.Node.Status != "Issue" {
		t.Fatalf("issue node status = %+v, want Issue", issueOn.Node.Status)
	}
	assertLogicGateAssignmentSource(t, repo, companyID, node.NodeID, logicGate.LogicGateID, issueOn.Card, true)

	issueOff, err := service.SetLogicGateNodeAssignmentIssue(store.LogicGateNodeAssignmentIssueInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		IsIssue:     false,
	})
	if err != nil {
		t.Fatalf("SetLogicGateNodeAssignmentIssue false: %v", err)
	}
	if issueOff.Node.Status == nil || *issueOff.Node.Status != "Done" {
		t.Fatalf("cleared issue node status = %+v, want column-derived Done", issueOff.Node.Status)
	}
	assertLogicGateAssignmentSource(t, repo, companyID, node.NodeID, logicGate.LogicGateID, issueOff.Card, false)

	removed, err := service.RemoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentRemoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
	})
	if err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment: %v", err)
	}
	if removed.Card.CardID != assigned.Card.CardID {
		t.Fatalf("removed card_id = %q, want %q", removed.Card.CardID, assigned.Card.CardID)
	}
	if removed.Node.Status != nil {
		t.Fatalf("removed node status = %+v, want cleared fallback", removed.Node.Status)
	}
	if len(removed.Node.LogicGateIDs) != 0 {
		t.Fatalf("removed node logic_gate_ids = %+v, want none", removed.Node.LogicGateIDs)
	}
	assertNoLogicGateAssignmentSource(t, repo, companyID, node.NodeID)
	cards, err := repo.ListKanbanCards(companyID, store.LogicGateKanbanBoardID(logicGate.LogicGateID), store.KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards after remove: %v", err)
	}
	if len(cards) != 0 {
		t.Fatalf("cards after remove = %+v, want none", cards)
	}
}

func TestLogicGateAssignmentMovePriorityOmittedNullAndValue(t *testing.T) {
	_, service, companyID, logicGate, node := setupLogicGateAssignmentCommandTest(t, "dddddddddddd")
	priority := 2
	if _, err := service.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	omitted, err := service.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "in_progress",
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment omitted priority: %v", err)
	}
	if omitted.Node.Priority == nil || *omitted.Node.Priority != priority {
		t.Fatalf("omitted priority node priority = %+v, want %d", omitted.Node.Priority, priority)
	}

	cleared, err := service.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		PrioritySet: true,
	})
	if !errors.Is(err, store.ErrPriorityRequired) {
		t.Fatalf("MoveLogicGateNodeAssignment clear priority err = %v, want priority required", err)
	}
	if cleared.Node.NodeID != "" {
		t.Fatalf("cleared priority result = %+v, want zero result on rejected move", cleared)
	}

	newPriority := 5
	valued, err := service.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Priority:    &newPriority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment set priority: %v", err)
	}
	if valued.Node.Priority == nil || *valued.Node.Priority != newPriority {
		t.Fatalf("value priority = %+v, want %d", valued.Node.Priority, newPriority)
	}
}

func TestLogicGateAssignmentCrossGateMoveWithoutStatusResolvesTargetColumn(t *testing.T) {
	repo, service, companyID, sourceGate, node := setupLogicGateAssignmentCommandTest(t, "ddddddddddde")
	targetGate, err := repo.CreateLogicGate(companyID, "Target Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate target: %v", err)
	}
	priority := 2
	assigned, err := service.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: sourceGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "in_progress",
		Priority:    &priority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus source: %v", err)
	}

	targetColumns, err := repo.ListKanbanColumns(companyID, store.LogicGateKanbanBoardID(targetGate.LogicGateID))
	if err != nil {
		t.Fatalf("ListKanbanColumns target: %v", err)
	}
	targetColumnID := ""
	for _, column := range targetColumns {
		if column.Title == "In Progress" {
			targetColumnID = column.ColumnID
			break
		}
	}
	if targetColumnID == "" {
		t.Fatalf("target in-progress column missing: %+v", targetColumns)
	}
	if assigned.Card.ColumnID != targetColumnID {
		t.Fatalf("stable status column id = %q, want target status id %q", assigned.Card.ColumnID, targetColumnID)
	}

	moved, err := service.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID:       companyID,
		LogicGateID:     targetGate.LogicGateID,
		FromLogicGateID: sourceGate.LogicGateID,
		NodeID:          node.NodeID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment cross gate without status: %v", err)
	}
	if moved.Card.BoardID != store.LogicGateKanbanBoardID(targetGate.LogicGateID) || moved.Card.ColumnID != targetColumnID {
		t.Fatalf("moved card placement = board %q column %q, want target board %q column %q", moved.Card.BoardID, moved.Card.ColumnID, store.LogicGateKanbanBoardID(targetGate.LogicGateID), targetColumnID)
	}
	if moved.Node.Status == nil || *moved.Node.Status != "In Progress" {
		t.Fatalf("moved node status = %+v, want In Progress", moved.Node.Status)
	}
	if len(moved.Node.LogicGateIDs) != 1 || moved.Node.LogicGateIDs[0] != targetGate.LogicGateID {
		t.Fatalf("moved node logic_gate_ids = %+v, want target gate", moved.Node.LogicGateIDs)
	}
	assertLogicGateAssignmentSource(t, repo, companyID, node.NodeID, targetGate.LogicGateID, moved.Card, false)
}

func TestLogicGateAssignmentMoveInvalidPlacementDoesNotPatchNode(t *testing.T) {
	repo, service, companyID, logicGate, node := setupLogicGateAssignmentCommandTest(t, "eeeeeeeeeeee")
	priority := 3
	assigned, err := service.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	_, err = service.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "Not a real status",
		PrioritySet: true,
	})
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("MoveLogicGateNodeAssignment invalid status error = %v, want ErrNotFound", err)
	}
	loaded, err := repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after invalid status: %v", err)
	}
	if loaded.Status == nil || *loaded.Status != "Pending" {
		t.Fatalf("status after invalid move = %+v, want Pending", loaded.Status)
	}
	if loaded.Priority == nil || *loaded.Priority != priority {
		t.Fatalf("priority after invalid move = %+v, want unchanged %d", loaded.Priority, priority)
	}
	cards, err := repo.ListKanbanCards(companyID, store.LogicGateKanbanBoardID(logicGate.LogicGateID), store.KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards after invalid status: %v", err)
	}
	if len(cards) != 1 || cards[0].CardID != assigned.Card.CardID || cards[0].ColumnID != assigned.Card.ColumnID {
		t.Fatalf("cards after invalid status = %+v, want unchanged assignment", cards)
	}

	_, err = service.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		ColumnID:    "missing-column",
		PrioritySet: true,
	})
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("MoveLogicGateNodeAssignment invalid column error = %v, want ErrNotFound", err)
	}
	loaded, err = repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after invalid column: %v", err)
	}
	if loaded.Priority == nil || *loaded.Priority != priority {
		t.Fatalf("priority after invalid column = %+v, want unchanged %d", loaded.Priority, priority)
	}
}

func TestLogicGateAssignmentRemoveUsesExplicitFallback(t *testing.T) {
	_, service, companyID, logicGate, node := setupLogicGateAssignmentCommandTest(t, "ffffffffffff")
	if _, err := service.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "done",
		Priority:    testPriority(3),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	fallbackStatus := "Backlog"
	removed, err := service.RemoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentRemoveInput{
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		NodeID:         node.NodeID,
		FallbackStatus: &fallbackStatus,
	})
	if err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment fallback: %v", err)
	}
	if removed.Node.Status == nil || *removed.Node.Status != fallbackStatus {
		t.Fatalf("fallback status = %+v, want %q", removed.Node.Status, fallbackStatus)
	}
}

func setupLogicGateAssignmentCommandTest(t *testing.T, companySuffix string) (*store.MemoryRepo, *Service, string, domain.LogicGate, domain.Node) {
	t.Helper()
	repo := store.NewMemoryRepo()
	service := NewService(repo)
	companyID := "11111111-1111-4111-8111-" + companySuffix
	repo.EnsureCompany(companyID, "Assignment Command Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Command node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	return repo, service, companyID, logicGate, node
}

func assertLogicGateAssignmentSource(t *testing.T, repo *store.MemoryRepo, companyID, nodeID, logicGateID string, card domain.KanbanCard, isIssue bool) domain.NodeLogicGateAssignment {
	t.Helper()
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, nodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments: %v", err)
	}
	if len(assignments) != 1 {
		t.Fatalf("assignments = %+v, want exactly one", assignments)
	}
	assignment := assignments[0]
	if assignment.LogicGateID != logicGateID {
		t.Fatalf("assignment logic_gate_id = %q, want %q", assignment.LogicGateID, logicGateID)
	}
	if assignment.ColumnID != card.ColumnID || assignment.Position != card.Position {
		t.Fatalf("assignment placement = column %q position %d, want column %q position %d", assignment.ColumnID, assignment.Position, card.ColumnID, card.Position)
	}
	if assignment.CompatibilityBoardID != card.BoardID || assignment.CompatibilityCardID != card.CardID {
		t.Fatalf("assignment compatibility link = %q/%q, want %q/%q", assignment.CompatibilityBoardID, assignment.CompatibilityCardID, card.BoardID, card.CardID)
	}
	if assignment.IsIssue != isIssue {
		t.Fatalf("assignment is_issue = %v, want %v", assignment.IsIssue, isIssue)
	}
	return assignment
}

func assertNoLogicGateAssignmentSource(t *testing.T, repo *store.MemoryRepo, companyID, nodeID string) {
	t.Helper()
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, nodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments: %v", err)
	}
	if len(assignments) != 0 {
		t.Fatalf("assignments after remove = %+v, want none", assignments)
	}
}
