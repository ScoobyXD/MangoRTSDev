package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
	"time"
)

func TestMemoryRepo_AddNodeInformation_ProjectionKeyStaysStableWhenInformationIDProvided(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	node, err := repo.CreateNode(companyID, "Projection stability node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}

	const stableProjectionID = "22222222-2222-4222-8222-222222222222"
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "first snapshot", stableProjectionID); err != nil {
		t.Fatalf("first AddNodeInformation failed: %v", err)
	}
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "second snapshot", stableProjectionID); err != nil {
		t.Fatalf("second AddNodeInformation failed: %v", err)
	}

	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections failed: %v", err)
	}
	if len(projections) != 1 {
		t.Fatalf("expected 1 projection row for stable information_id, got %d", len(projections))
	}
	if projections[0].InformationID != stableProjectionID {
		t.Fatalf("expected projection information_id %s, got %s", stableProjectionID, projections[0].InformationID)
	}
	if projections[0].Information != "second snapshot" {
		t.Fatalf("expected latest projection information to be updated, got %q", projections[0].Information)
	}
}

func TestMemoryRepo_AddNodeInformation_TextBoxProjectionsRemainIndependent(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	node, err := repo.CreateNode(companyID, "Single editor document node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}

	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "old document", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"); err != nil {
		t.Fatalf("first AddNodeInformation failed: %v", err)
	}
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "current document", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"); err != nil {
		t.Fatalf("second AddNodeInformation failed: %v", err)
	}

	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections failed: %v", err)
	}
	if len(projections) != 2 {
		t.Fatalf("expected two Text box projections, got %d", len(projections))
	}
	if projections[0].Information != "old document" || projections[1].Information != "current document" {
		t.Fatalf("projection information = %+v, want both text boxes in created order", projections)
	}
}

func TestMemoryRepo_DeleteNode_RemovesProjectionRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	node, err := repo.CreateNode(companyID, "Delete cleanup node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "payload", "33333333-3333-4333-8333-333333333333"); err != nil {
		t.Fatalf("AddNodeInformation failed: %v", err)
	}

	if err := repo.DeleteNode(companyID, node.NodeID); err != nil {
		t.Fatalf("DeleteNode failed: %v", err)
	}

	if _, err := repo.ListNodeProjections(companyID, node.NodeID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestMemoryRepo_DeleteNodeProjection_ClearsLatestDocumentWithoutDeletingHistory(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	node, err := repo.CreateNode(companyID, "Clear document node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}
	const stableProjectionID = "66666666-6666-4666-8666-666666666666"
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "payload", stableProjectionID); err != nil {
		t.Fatalf("AddNodeInformation failed: %v", err)
	}
	if err := repo.DeleteNodeProjection(companyID, node.NodeID, stableProjectionID); err != nil {
		t.Fatalf("DeleteNodeProjection failed: %v", err)
	}

	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections failed: %v", err)
	}
	if len(projections) != 0 {
		t.Fatalf("expected cleared projection rows, got %d", len(projections))
	}
	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails failed: %v", err)
	}
	if len(details.Information) != 1 {
		t.Fatalf("expected history to remain append-only, got %d rows", len(details.Information))
	}
}

func TestMemoryRepo_DeleteNode_RemovesKanbanCardsAndKeepsOperations(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	boardID := "board-delete-node"

	node, err := repo.CreateNode(companyID, "Kanban cleanup node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}
	column, err := repo.CreateKanbanColumn(companyID, boardID, "Ready", 0, 260, 240, "#fbb152")
	if err != nil {
		t.Fatalf("CreateKanbanColumn failed: %v", err)
	}
	if _, err := repo.UpsertKanbanCard(KanbanCardMutationInput{
		CompanyID: companyID,
		BoardID:   boardID,
		ColumnID:  column.ColumnID,
		NodeID:    node.NodeID,
		NodeTitle: node.Title,
	}); err != nil {
		t.Fatalf("UpsertKanbanCard failed: %v", err)
	}
	nodeID := node.NodeID
	operation, err := repo.CreateOperation(CreateOperationInput{
		CompanyID:      companyID,
		NodeID:         &nodeID,
		Status:         "In Progress",
		StartTimestamp: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("CreateOperation failed: %v", err)
	}

	if err := repo.DeleteNode(companyID, node.NodeID); err != nil {
		t.Fatalf("DeleteNode failed: %v", err)
	}

	cards, err := repo.ListKanbanCards(companyID, boardID, KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards failed: %v", err)
	}
	if len(cards) != 0 {
		t.Fatalf("expected node kanban card cleanup, got %d cards", len(cards))
	}
	storedOperation, err := repo.GetOperation(companyID, operation.OperationID)
	if err != nil {
		t.Fatalf("GetOperation failed: %v", err)
	}
	if storedOperation.NodeID != nil {
		t.Fatalf("expected operation node pointer to be cleared, got %q", *storedOperation.NodeID)
	}
}

func TestMemoryRepo_UpdateNodeTitleRefreshesKanbanCardSnapshots(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	boardID := "board-node-title-sync"

	node, err := repo.CreateNode(companyID, "Old node title")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}
	column, err := repo.CreateKanbanColumn(companyID, boardID, "Ready", 0, 260, 240, "#fbb152")
	if err != nil {
		t.Fatalf("CreateKanbanColumn failed: %v", err)
	}
	if _, err := repo.UpsertKanbanCard(KanbanCardMutationInput{
		CompanyID: companyID,
		BoardID:   boardID,
		ColumnID:  column.ColumnID,
		NodeID:    node.NodeID,
		NodeTitle: "stale title from caller",
	}); err != nil {
		t.Fatalf("UpsertKanbanCard failed: %v", err)
	}
	if _, err := repo.UpdateNodeTitle(companyID, node.NodeID, "New node title"); err != nil {
		t.Fatalf("UpdateNodeTitle failed: %v", err)
	}
	cards, err := repo.ListKanbanCards(companyID, boardID, KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards failed: %v", err)
	}
	if len(cards) != 1 || cards[0].NodeTitle != "New node title" {
		t.Fatalf("kanban card snapshots = %+v, want renamed title", cards)
	}
}

func TestMemoryRepo_AddLogicGateInformation_ProjectionKeyStaysStableAndHistoryAppends(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Projection stability logic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}

	const stableProjectionID = "44444444-4444-4444-8444-444444444444"
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "first logic snapshot", stableProjectionID); err != nil {
		t.Fatalf("first AddLogicGateInformation failed: %v", err)
	}
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "second logic snapshot", stableProjectionID); err != nil {
		t.Fatalf("second AddLogicGateInformation failed: %v", err)
	}

	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails failed: %v", err)
	}
	if len(details.Information) != 2 {
		t.Fatalf("expected 2 history rows, got %d", len(details.Information))
	}
	if details.Information[0].InformationID == stableProjectionID || details.Information[1].InformationID == stableProjectionID {
		t.Fatalf("history rows should use durable history IDs, not the stable projection key")
	}

	projections, err := repo.ListLogicGateProjections(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListLogicGateProjections failed: %v", err)
	}
	if len(projections) != 1 {
		t.Fatalf("expected 1 projection row for stable information_id, got %d", len(projections))
	}
	if projections[0].InformationID != stableProjectionID {
		t.Fatalf("expected projection information_id %s, got %s", stableProjectionID, projections[0].InformationID)
	}
	if projections[0].Information != "second logic snapshot" {
		t.Fatalf("expected latest projection information to be updated, got %q", projections[0].Information)
	}
}

func TestMemoryRepo_AddLogicGateInformation_TextBoxProjectionCollapsesToOneCurrentDocument(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Single editor document gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}

	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "old logic document", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"); err != nil {
		t.Fatalf("first AddLogicGateInformation failed: %v", err)
	}
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "current logic document", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"); err != nil {
		t.Fatalf("second AddLogicGateInformation failed: %v", err)
	}

	projections, err := repo.ListLogicGateProjections(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListLogicGateProjections failed: %v", err)
	}
	if len(projections) != 1 {
		t.Fatalf("expected one current Text box projection, got %d", len(projections))
	}
	if projections[0].Information != "current logic document" {
		t.Fatalf("projection information = %q, want current logic document", projections[0].Information)
	}
}

func TestMemoryRepo_DeleteLogicGate_RemovesProjectionRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Delete cleanup logic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "payload", "55555555-5555-4555-8555-555555555555"); err != nil {
		t.Fatalf("AddLogicGateInformation failed: %v", err)
	}

	if err := repo.DeleteLogicGate(companyID, logicGate.LogicGateID); err != nil {
		t.Fatalf("DeleteLogicGate failed: %v", err)
	}

	if _, err := repo.ListLogicGateProjections(companyID, logicGate.LogicGateID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestMemoryRepo_DeleteLogicGateProjection_ClearsLatestDocumentWithoutDeletingHistory(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Clear document logic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	const stableProjectionID = "77777777-7777-4777-8777-777777777777"
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "payload", stableProjectionID); err != nil {
		t.Fatalf("AddLogicGateInformation failed: %v", err)
	}
	if err := repo.DeleteLogicGateProjection(companyID, logicGate.LogicGateID, stableProjectionID); err != nil {
		t.Fatalf("DeleteLogicGateProjection failed: %v", err)
	}

	projections, err := repo.ListLogicGateProjections(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListLogicGateProjections failed: %v", err)
	}
	if len(projections) != 0 {
		t.Fatalf("expected cleared projection rows, got %d", len(projections))
	}
	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails failed: %v", err)
	}
	if len(details.Information) != 1 {
		t.Fatalf("expected history to remain append-only, got %d rows", len(details.Information))
	}
}

func TestMemoryRepo_DeleteLogicGate_KeepsOperations(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Kanban cleanup logic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	logicGateID := logicGate.LogicGateID
	operation, err := repo.CreateOperation(CreateOperationInput{
		CompanyID:      companyID,
		LogicGateID:    &logicGateID,
		Status:         "In Progress",
		StartTimestamp: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("CreateOperation failed: %v", err)
	}

	if err := repo.DeleteLogicGate(companyID, logicGate.LogicGateID); err != nil {
		t.Fatalf("DeleteLogicGate failed: %v", err)
	}

	storedOperation, err := repo.GetOperation(companyID, operation.OperationID)
	if err != nil {
		t.Fatalf("GetOperation failed: %v", err)
	}
	if storedOperation.LogicGateID != nil {
		t.Fatalf("expected operation logic-gate pointer to be cleared, got %q", *storedOperation.LogicGateID)
	}
}

func mustFindKanbanColumn(t *testing.T, columns []domain.KanbanColumn, title string) domain.KanbanColumn {
	t.Helper()
	for _, column := range columns {
		if column.Title == title {
			return column
		}
	}
	t.Fatalf("expected column %q in %+v", title, columns)
	return domain.KanbanColumn{}
}

func TestMemoryRepo_CreateLogicGateCreatesAttachedKanbanBoard(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Assembly Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}

	boards, err := repo.ListKanbanBoards(companyID, KanbanBoardQuery{LogicGateID: logicGate.LogicGateID, Limit: 10})
	if err != nil {
		t.Fatalf("ListKanbanBoards failed: %v", err)
	}
	if len(boards) != 1 {
		t.Fatalf("expected one attached board, got %d", len(boards))
	}
	if boards[0].BoardID != LogicGateKanbanBoardID(logicGate.LogicGateID) {
		t.Fatalf("board_id = %q, want attached board id", boards[0].BoardID)
	}
	if boards[0].LogicGateID == nil || *boards[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("logic_gate_id = %+v, want %q", boards[0].LogicGateID, logicGate.LogicGateID)
	}

	columns, err := repo.ListKanbanColumns(companyID, boards[0].BoardID)
	if err != nil {
		t.Fatalf("ListKanbanColumns failed: %v", err)
	}
	pending := mustFindKanbanColumn(t, columns, "Pending")
	inProgress := mustFindKanbanColumn(t, columns, "In Progress")
	done := mustFindKanbanColumn(t, columns, "Done")
	if pending.ItemColor != KanbanDefaultPendingColor || inProgress.ItemColor != KanbanDefaultInProgressColor || done.ItemColor != KanbanDefaultDoneColor {
		t.Fatalf("default colors = %q/%q/%q", pending.ItemColor, inProgress.ItemColor, done.ItemColor)
	}
	if err := repo.DeleteKanbanBoard(companyID, boards[0].BoardID); err != ErrInvalid {
		t.Fatalf("expected attached board delete to return ErrInvalid, got %v", err)
	}
}

func TestMemoryRepo_LogicGateKanbanPlacementStatusIssueAndNodeMetadata(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	firstGate, err := repo.CreateLogicGate(companyID, "First Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate first failed: %v", err)
	}
	secondGate, err := repo.CreateLogicGate(companyID, "Second Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate second failed: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Tracked node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}

	firstBoardID := LogicGateKanbanBoardID(firstGate.LogicGateID)
	firstColumns, err := repo.ListKanbanColumns(companyID, firstBoardID)
	if err != nil {
		t.Fatalf("ListKanbanColumns first failed: %v", err)
	}
	pending := mustFindKanbanColumn(t, firstColumns, "Pending")
	card, err := repo.UpsertKanbanCard(KanbanCardMutationInput{
		CompanyID: companyID,
		BoardID:   firstBoardID,
		ColumnID:  pending.ColumnID,
		NodeID:    node.NodeID,
		NodeTitle: node.Title,
	})
	if err != nil {
		t.Fatalf("UpsertKanbanCard first failed: %v", err)
	}
	loadedNode, err := repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode failed: %v", err)
	}
	if loadedNode.Status == nil || *loadedNode.Status != "Pending" {
		t.Fatalf("status = %+v, want Pending", loadedNode.Status)
	}

	issue := true
	moved, err := repo.MoveKanbanCard(KanbanCardMoveInput{
		CompanyID: companyID,
		BoardID:   firstBoardID,
		CardID:    card.CardID,
		IsIssue:   &issue,
	})
	if err != nil {
		t.Fatalf("MoveKanbanCard issue toggle failed: %v", err)
	}
	if !moved.IsIssue || moved.ColumnID != pending.ColumnID {
		t.Fatalf("issue card = %+v, want issue in same column", moved)
	}
	loadedNode, err = repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after issue failed: %v", err)
	}
	if loadedNode.Status == nil || *loadedNode.Status != "Issue" {
		t.Fatalf("status after issue = %+v, want Issue", loadedNode.Status)
	}

	secondBoardID := LogicGateKanbanBoardID(secondGate.LogicGateID)
	secondColumns, err := repo.ListKanbanColumns(companyID, secondBoardID)
	if err != nil {
		t.Fatalf("ListKanbanColumns second failed: %v", err)
	}
	done := mustFindKanbanColumn(t, secondColumns, "Done")
	if _, err := repo.UpsertKanbanCard(KanbanCardMutationInput{
		CompanyID: companyID,
		BoardID:   secondBoardID,
		ColumnID:  done.ColumnID,
		NodeID:    node.NodeID,
		NodeTitle: node.Title,
	}); err != nil {
		t.Fatalf("UpsertKanbanCard second failed: %v", err)
	}
	firstCards, err := repo.ListKanbanCards(companyID, firstBoardID, KanbanCardQuery{Limit: 20})
	if err != nil {
		t.Fatalf("ListKanbanCards first failed: %v", err)
	}
	if len(firstCards) != 0 {
		t.Fatalf("expected first logic-gate board placement to be superseded, got %+v", firstCards)
	}
	loadedNode, err = repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after supersede failed: %v", err)
	}
	if loadedNode.Status == nil || *loadedNode.Status != "Done" {
		t.Fatalf("status after supersede = %+v, want Done", loadedNode.Status)
	}

	dueDate := "2026-05-06"
	priority := 5
	updated, err := repo.UpdateNode(UpdateNodeInput{
		CompanyID:   companyID,
		NodeID:      node.NodeID,
		DueDate:     &dueDate,
		DueDateSet:  true,
		Priority:    &priority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("UpdateNode failed: %v", err)
	}
	if updated.DueDate == nil || *updated.DueDate != dueDate || updated.Priority == nil || *updated.Priority != priority {
		t.Fatalf("node metadata = due %+v priority %+v", updated.DueDate, updated.Priority)
	}
}

func TestMemoryRepoUserEmailConnectionLifecycle(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject-email", "User@Example.com", "Email User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing connection error = %v, want ErrNotFound", err)
	}
	connection, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "gmail",
		AccountEmail: "User@Example.com",
		GrantID:      "grant-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if connection.Provider != "google" || connection.AccountEmail != "user@example.com" || connection.GrantID != "grant-1" || connection.Status != "connected" {
		t.Fatalf("connection = %+v, want normalized connected google grant", connection)
	}
	updated, err := repo.UpdateUserEmailConnectionStatus(user.UserID, "reauth_required")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "reauth_required" {
		t.Fatalf("status = %q, want reauth_required", updated.Status)
	}
	if err := repo.DeleteUserEmailConnection(user.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("connection after delete error = %v, want ErrNotFound", err)
	}
}
