package kanban

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"testing"
)

func TestAssignNodeToLogicGateStatusUsesKanbanCardAsWorkModel(t *testing.T) {
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
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: responsibleUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}

	fallbackStatus := "Direct fallback"
	fallbackColor := "#123abc"
	if _, err := repo.UpdateNode(store.UpdateNodeInput{
		CompanyID:      companyID,
		NodeID:         node.NodeID,
		Status:         &fallbackStatus,
		StatusSet:      true,
		StatusColor:    &fallbackColor,
		StatusColorSet: true,
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
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		NodeID:         node.NodeID,
		Status:         "in_progress",
		Priority:       &priority,
		PrioritySet:    true,
		AssigneePolicy: store.LogicGateAssignmentAssigneePolicyFirstResponsible,
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
	if assigned.Node.StatusColor == nil || *assigned.Node.StatusColor != store.KanbanDefaultInProgressColor {
		t.Fatalf("assigned node status_color = %+v, want %q", assigned.Node.StatusColor, store.KanbanDefaultInProgressColor)
	}
	if assigned.Node.Priority == nil || *assigned.Node.Priority != priority {
		t.Fatalf("assigned node priority = %+v, want %d", assigned.Node.Priority, priority)
	}
	if assigned.Node.AssigneeUserID == nil || *assigned.Node.AssigneeUserID != responsibleUser.UserID {
		t.Fatalf("assigned node assignee = %+v, want responsible user", assigned.Node.AssigneeUserID)
	}
	if len(assigned.Node.LogicGateIDs) != 1 || assigned.Node.LogicGateIDs[0] != logicGate.LogicGateID {
		t.Fatalf("assigned node logic_gate_ids = %+v, want card-derived Logic Gate", assigned.Node.LogicGateIDs)
	}

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
		t.Fatalf("status after direct override = %+v, want card-derived In Progress", loaded.Status)
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
	if issueResult.Node.StatusColor == nil || *issueResult.Node.StatusColor != "#ffd400" {
		t.Fatalf("issue node status_color = %+v, want issue color", issueResult.Node.StatusColor)
	}
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
	if removed.Node.Status != nil || removed.Node.StatusColor != nil {
		t.Fatalf("removed node status = %+v/%+v, want cleared fallback", removed.Node.Status, removed.Node.StatusColor)
	}
	if len(removed.Node.LogicGateIDs) != 0 {
		t.Fatalf("removed node logic_gate_ids = %+v, want none", removed.Node.LogicGateIDs)
	}
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
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment clear priority: %v", err)
	}
	if cleared.Node.Priority != nil {
		t.Fatalf("cleared priority = %+v, want nil", cleared.Node.Priority)
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
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	fallbackStatus := "Backlog"
	fallbackColor := "#123456"
	removed, err := service.RemoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentRemoveInput{
		CompanyID:           companyID,
		LogicGateID:         logicGate.LogicGateID,
		NodeID:              node.NodeID,
		FallbackStatus:      &fallbackStatus,
		FallbackStatusColor: &fallbackColor,
	})
	if err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment fallback: %v", err)
	}
	if removed.Node.Status == nil || *removed.Node.Status != fallbackStatus {
		t.Fatalf("fallback status = %+v, want %q", removed.Node.Status, fallbackStatus)
	}
	if removed.Node.StatusColor == nil || *removed.Node.StatusColor != fallbackColor {
		t.Fatalf("fallback status color = %+v, want %q", removed.Node.StatusColor, fallbackColor)
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
