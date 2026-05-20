package store

import (
	"errors"
	"reflect"
	"testing"
)

func TestMemoryKanbanWorkspaceEventsAreDurableAndCompatible(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "12121212-1212-4121-8121-121212121212"
	boardID := "workspace-kanban-events"

	board, err := repo.CreateKanbanBoardWithWorkspaceEvent(companyID, boardID, "Workspace Events", 100)
	if err != nil {
		t.Fatalf("CreateKanbanBoardWithWorkspaceEvent: %v", err)
	}
	if len(board.Events) != 1 || board.Events[0].Type != "kanban_board_saved" || board.Events[0].Payload["board_id"] != boardID {
		t.Fatalf("board saved events = %+v", board.Events)
	}
	if _, err := repo.UpdateKanbanBoardWithWorkspaceEvent(companyID, boardID, "Workspace Events Updated", 200); err != nil {
		t.Fatalf("UpdateKanbanBoardWithWorkspaceEvent: %v", err)
	}
	column, err := repo.CreateKanbanColumnWithWorkspaceEvent(companyID, boardID, "Ready", 1000, 280, 240, "#123abc")
	if err != nil {
		t.Fatalf("CreateKanbanColumnWithWorkspaceEvent: %v", err)
	}
	if len(column.Events) != 1 || column.Events[0].Type != "kanban_column_created" || column.Events[0].Payload["board_id"] != boardID || column.Events[0].Payload["column_id"] != column.Column.ColumnID {
		t.Fatalf("column created events = %+v", column.Events)
	}
	if _, err := repo.UpdateKanbanColumnWithWorkspaceEvent(companyID, boardID, column.Column.ColumnID, "Doing", 1100, 300, 260, "#abcdef"); err != nil {
		t.Fatalf("UpdateKanbanColumnWithWorkspaceEvent: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Kanban event node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	card, err := repo.UpsertKanbanCardWithWorkspaceEvent(KanbanCardMutationInput{CompanyID: companyID, BoardID: boardID, ColumnID: column.Column.ColumnID, NodeID: node.NodeID, NodeTitle: node.Title, Position: 1000})
	if err != nil {
		t.Fatalf("UpsertKanbanCardWithWorkspaceEvent: %v", err)
	}
	if card.DerivedNode != nil || len(card.Events) != 1 || card.Events[0].Type != "kanban_card_upserted" || card.Events[0].Payload["card_id"] != card.Card.CardID {
		t.Fatalf("card upsert events = %+v derived=%+v", card.Events, card.DerivedNode)
	}
	if _, err := repo.MoveKanbanCardWithWorkspaceEvent(KanbanCardMoveInput{CompanyID: companyID, BoardID: boardID, CardID: card.Card.CardID, ColumnID: column.Column.ColumnID, Position: 2000}); err != nil {
		t.Fatalf("MoveKanbanCardWithWorkspaceEvent: %v", err)
	}
	if _, err := repo.DeleteKanbanCardWithWorkspaceEvent(companyID, boardID, card.Card.CardID); err != nil {
		t.Fatalf("DeleteKanbanCardWithWorkspaceEvent: %v", err)
	}
	if _, err := repo.DeleteKanbanColumnWithWorkspaceEvent(companyID, boardID, column.Column.ColumnID); err != nil {
		t.Fatalf("DeleteKanbanColumnWithWorkspaceEvent: %v", err)
	}
	if _, err := repo.DeleteKanbanBoardWithWorkspaceEvent(companyID, boardID); err != nil {
		t.Fatalf("DeleteKanbanBoardWithWorkspaceEvent: %v", err)
	}

	replay, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	wantTypes := []string{
		"kanban_board_saved",
		"kanban_board_updated",
		"kanban_column_created",
		"kanban_column_updated",
		"kanban_card_upserted",
		"kanban_card_moved",
		"kanban_card_deleted",
		"kanban_column_deleted",
		"kanban_board_deleted",
	}
	if gotTypes := domainEventTypes(replay); !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("durable event types = %+v, want %+v", gotTypes, wantTypes)
	}
}

func TestMemoryKanbanWorkspaceEventAppendFailureRollsBackState(t *testing.T) {
	errAppend := errors.New("append failed")

	t.Run("board create", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "13131313-1313-4131-8131-131313131311"
		repo.domainEventAppendErr = errAppend
		_, err := repo.CreateKanbanBoardWithWorkspaceEvent(companyID, "rollback-board", "Rollback", 100)
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		boards, err := repo.ListKanbanBoards(companyID, KanbanBoardQuery{Limit: 10})
		if err != nil || len(boards) != 0 {
			t.Fatalf("boards after failed event append = %+v err=%v, want none", boards, err)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
	})

	t.Run("column create", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "13131313-1313-4131-8131-131313131312"
		repo.domainEventAppendErr = errAppend
		_, err := repo.CreateKanbanColumnWithWorkspaceEvent(companyID, "rollback-board", "Ready", 1000, 0, 0, "")
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		columns, err := repo.ListKanbanColumns(companyID, "rollback-board")
		if err != nil || len(columns) != 0 {
			t.Fatalf("columns after failed event append = %+v err=%v, want none", columns, err)
		}
		boards, err := repo.ListKanbanBoards(companyID, KanbanBoardQuery{Limit: 10})
		if err != nil || len(boards) != 0 {
			t.Fatalf("implicit board after failed column append = %+v err=%v, want none", boards, err)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
	})

	t.Run("card upsert", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "13131313-1313-4131-8131-131313131313"
		boardID := "rollback-board"
		column, err := repo.CreateKanbanColumn(companyID, boardID, "Ready", 1000, 0, 0, "")
		if err != nil {
			t.Fatalf("CreateKanbanColumn setup: %v", err)
		}
		node, err := repo.CreateNode(companyID, "Rollback node")
		if err != nil {
			t.Fatalf("CreateNode setup: %v", err)
		}
		repo.domainEventAppendErr = errAppend
		_, err = repo.UpsertKanbanCardWithWorkspaceEvent(KanbanCardMutationInput{CompanyID: companyID, BoardID: boardID, ColumnID: column.ColumnID, NodeID: node.NodeID, NodeTitle: node.Title, Position: 1000})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		cards, err := repo.ListKanbanCards(companyID, boardID, KanbanCardQuery{Limit: 10})
		if err != nil || len(cards) != 0 {
			t.Fatalf("cards after failed event append = %+v err=%v, want none", cards, err)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
	})

	t.Run("card move", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "13131313-1313-4131-8131-131313131314"
		boardID := "rollback-board"
		column, err := repo.CreateKanbanColumn(companyID, boardID, "Ready", 1000, 0, 0, "")
		if err != nil {
			t.Fatalf("CreateKanbanColumn setup: %v", err)
		}
		node, err := repo.CreateNode(companyID, "Rollback move node")
		if err != nil {
			t.Fatalf("CreateNode setup: %v", err)
		}
		card, err := repo.UpsertKanbanCard(KanbanCardMutationInput{CompanyID: companyID, BoardID: boardID, ColumnID: column.ColumnID, NodeID: node.NodeID, NodeTitle: node.Title, Position: 1000})
		if err != nil {
			t.Fatalf("UpsertKanbanCard setup: %v", err)
		}
		repo.domainEventAppendErr = errAppend
		_, err = repo.MoveKanbanCardWithWorkspaceEvent(KanbanCardMoveInput{CompanyID: companyID, BoardID: boardID, CardID: card.CardID, ColumnID: column.ColumnID, Position: 2000})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		cards, err := repo.ListKanbanCards(companyID, boardID, KanbanCardQuery{Limit: 10})
		if err != nil || len(cards) != 1 || cards[0].Position != 1000 {
			t.Fatalf("cards after failed move append = %+v err=%v, want original position", cards, err)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
	})
}
