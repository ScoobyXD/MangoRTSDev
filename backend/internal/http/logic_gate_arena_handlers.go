package httpapi

import (
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleLogicGateArena(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	logicGateID := strings.TrimSpace(r.URL.Query().Get("logic_gate_id"))
	if companyID == "" || logicGateID == "" {
		writeError(w, http.StatusBadRequest, "company_id_and_logic_gate_id_required")
		return
	}
	if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
		return
	}

	logicGate, err := s.repo.GetLogicGate(companyID, logicGateID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		log.Printf("failed to load logic gate for arena company_id=%s logic_gate_id=%s: %v", companyID, logicGateID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_arena")
		return
	}

	boards, err := s.repo.ListKanbanBoards(companyID, store.KanbanBoardQuery{LogicGateID: logicGateID, Limit: 2})
	if err != nil {
		log.Printf("failed to list logic gate arena boards company_id=%s logic_gate_id=%s: %v", companyID, logicGateID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_arena")
		return
	}
	expectedBoardID := store.LogicGateKanbanBoardID(logicGateID)
	board, ok := selectLogicGateArenaBoard(boards, expectedBoardID)
	if !ok {
		writeError(w, http.StatusNotFound, "logic_gate_arena_board_not_found")
		return
	}
	columns, err := s.repo.ListKanbanColumns(companyID, board.BoardID)
	if err != nil {
		log.Printf("failed to list logic gate arena columns company_id=%s logic_gate_id=%s board_id=%s: %v", companyID, logicGateID, board.BoardID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_arena")
		return
	}
	if logicGateArenaDefaultColumnsMissing(columns) {
		writeError(w, http.StatusConflict, "logic_gate_arena_columns_not_provisioned")
		return
	}
	cards, err := s.repo.ListKanbanCards(companyID, board.BoardID, store.KanbanCardQuery{Limit: store.KanbanMaxCardsLimit})
	if err != nil {
		log.Printf("failed to list logic gate arena cards company_id=%s logic_gate_id=%s board_id=%s: %v", companyID, logicGateID, board.BoardID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_arena")
		return
	}

	writeJSONMaybeNotModified(w, r, http.StatusOK, domain.LogicGateArenaView{
		LogicGate:  logicGate,
		Board:      board,
		Columns:    columns,
		Cards:      cards,
		CardsLimit: store.KanbanMaxCardsLimit,
	})
}

func selectLogicGateArenaBoard(boards []domain.KanbanBoard, expectedBoardID string) (domain.KanbanBoard, bool) {
	for _, board := range boards {
		if board.BoardID == expectedBoardID {
			return board, true
		}
	}
	if len(boards) > 0 {
		return boards[0], true
	}
	return domain.KanbanBoard{}, false
}

func logicGateArenaDefaultColumnsMissing(columns []domain.KanbanColumn) bool {
	required := map[string]bool{
		"pending":     false,
		"in progress": false,
		"done":        false,
	}
	for _, column := range columns {
		title := strings.ToLower(strings.TrimSpace(column.Title))
		if _, ok := required[title]; ok {
			required[title] = true
		}
	}
	for _, found := range required {
		if !found {
			return true
		}
	}
	return false
}
