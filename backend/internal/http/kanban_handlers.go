package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

func parsePositiveLimit(raw string, fallback int, maximum int) (int, bool) {
	value := fallback
	if strings.TrimSpace(raw) != "" {
		parsed, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || parsed <= 0 {
			return 0, false
		}
		value = parsed
	}
	if value > maximum {
		value = maximum
	}
	return value, true
}

func parseKanbanBoardQueryParams(r *http.Request) (store.KanbanBoardQuery, bool, string) {
	limit, ok := parsePositiveLimit(r.URL.Query().Get("limit"), 100, store.KanbanMaxBoardsLimit)
	if !ok {
		return store.KanbanBoardQuery{}, false, "invalid_limit"
	}
	query := store.KanbanBoardQuery{Limit: limit}
	for key := range r.URL.Query() {
		if key != "company_id" && key != "limit" && key != "after_position" && key != "logic_gate_id" {
			return store.KanbanBoardQuery{}, false, "unsupported_kanban_board_query_param"
		}
	}
	query.LogicGateID = strings.TrimSpace(r.URL.Query().Get("logic_gate_id"))
	if raw := strings.TrimSpace(r.URL.Query().Get("after_position")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			return store.KanbanBoardQuery{}, false, "invalid_after_position"
		}
		query.AfterPosition = parsed
	}
	return query, true, ""
}

func parseKanbanCardQueryParams(r *http.Request) (store.KanbanCardQuery, bool, string) {
	limit, ok := parsePositiveLimit(r.URL.Query().Get("limit"), 200, store.KanbanMaxCardsLimit)
	if !ok {
		return store.KanbanCardQuery{}, false, "invalid_limit"
	}
	query := store.KanbanCardQuery{
		ColumnID: strings.TrimSpace(r.URL.Query().Get("column_id")),
		Limit:    limit,
	}
	for key := range r.URL.Query() {
		if key != "company_id" && key != "board_id" && key != "column_id" && key != "limit" && key != "after_position" && key != "scope" {
			return store.KanbanCardQuery{}, false, "unsupported_kanban_card_query_param"
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("after_position")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			return store.KanbanCardQuery{}, false, "invalid_after_position"
		}
		query.AfterPosition = parsed
	}
	return query, true, ""
}

func (s *Server) handleKanbanBoards(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		query, ok, errCode := parseKanbanBoardQueryParams(r)
		if !ok {
			writeError(w, http.StatusBadRequest, errCode)
			return
		}
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		etag, notModified, err := s.writeWorkspaceEventNotModified(w, r, companyID, "kanban-boards", []store.DomainEventStreamQuery{
			workspaceEventQuery(kanbanBoardWorkspaceEventTypes...),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_workspace_version")
			return
		}
		if notModified {
			return
		}
		items, err := s.repo.ListKanbanBoards(companyID, query)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_boards")
			return
		}
		items, err = s.filterVisibleKanbanBoards(r, companyID, items)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_filter_kanban_boards")
			return
		}
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{"boards": items}, etag)
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
		BoardID   string `json:"board_id"`
		Title     string `json:"title"`
		Position  int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.BoardID = strings.TrimSpace(req.BoardID)
	req.Title = strings.TrimSpace(req.Title)
	if req.CompanyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	result, err := s.repo.CreateKanbanBoardWithWorkspaceEvent(req.CompanyID, req.BoardID, req.Title, req.Position)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_kanban_board")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusCreated, result.Board)
}

func (s *Server) handleKanbanBoardByID(w http.ResponseWriter, r *http.Request) {
	boardID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/kanban/boards/"))
	if boardID == "" || strings.Contains(boardID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireKanbanBoardView(w, r, companyID, boardID, "") {
			return
		}
		result, err := s.repo.DeleteKanbanBoardWithWorkspaceEvent(companyID, boardID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "kanban_board_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusConflict, "attached_kanban_board_cannot_be_deleted")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_kanban_board")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
		Title     string `json:"title"`
		Position  int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.Title = strings.TrimSpace(req.Title)
	if req.CompanyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if req.Title == "" && req.Position <= 0 {
		writeError(w, http.StatusBadRequest, "kanban_board_update_required")
		return
	}
	if !s.requireKanbanBoardView(w, r, req.CompanyID, boardID, "") {
		return
	}
	result, err := s.repo.UpdateKanbanBoardWithWorkspaceEvent(req.CompanyID, boardID, req.Title, req.Position)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "kanban_board_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_kanban_board")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusOK, result.Board)
}

func (s *Server) handleKanbanColumns(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
		if !s.requireKanbanBoardView(w, r, companyID, boardID, "") {
			return
		}
		etag, notModified, err := s.writeWorkspaceEventNotModified(w, r, companyID, "kanban-columns", []store.DomainEventStreamQuery{
			workspaceEventQueryPayload(kanbanColumnWorkspaceEventTypes, boardIDPayload(boardID)),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_workspace_version")
			return
		}
		if notModified {
			return
		}
		items, err := s.repo.ListKanbanColumns(companyID, boardID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_columns")
			return
		}
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{"columns": items}, etag)
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
		BoardID   string `json:"board_id"`
		Title     string `json:"title"`
		Position  int    `json:"position"`
		WidthPx   int    `json:"width_px"`
		HeightPx  int    `json:"height_px"`
		ItemColor string `json:"item_color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.BoardID = strings.TrimSpace(req.BoardID)
	req.Title = strings.TrimSpace(req.Title)
	if req.CompanyID == "" || req.BoardID == "" || req.Title == "" {
		writeError(w, http.StatusBadRequest, "company_id_board_id_and_title_required")
		return
	}
	if !s.requireKanbanBoardView(w, r, req.CompanyID, req.BoardID, "") {
		return
	}
	result, err := s.repo.CreateKanbanColumnWithWorkspaceEvent(req.CompanyID, req.BoardID, req.Title, req.Position, req.WidthPx, req.HeightPx, req.ItemColor)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_kanban_column")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusCreated, result.Column)
}

func (s *Server) handleKanbanColumnByID(w http.ResponseWriter, r *http.Request) {
	columnID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/kanban/columns/"))
	if columnID == "" || strings.Contains(columnID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method == http.MethodPut {
		var req struct {
			CompanyID string `json:"company_id"`
			BoardID   string `json:"board_id"`
			Title     string `json:"title"`
			Position  int    `json:"position"`
			WidthPx   int    `json:"width_px"`
			HeightPx  int    `json:"height_px"`
			ItemColor string `json:"item_color"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		req.BoardID = strings.TrimSpace(req.BoardID)
		req.Title = strings.TrimSpace(req.Title)
		if req.CompanyID == "" || req.BoardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
		if !s.requireKanbanBoardView(w, r, req.CompanyID, req.BoardID, "") {
			return
		}
		result, err := s.repo.UpdateKanbanColumnWithWorkspaceEvent(req.CompanyID, req.BoardID, columnID, req.Title, req.Position, req.WidthPx, req.HeightPx, req.ItemColor)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "kanban_column_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_update_kanban_column")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, http.StatusOK, result.Column)
		return
	}
	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
		if !s.requireKanbanBoardView(w, r, companyID, boardID, "") {
			return
		}
		result, err := s.repo.DeleteKanbanColumnWithWorkspaceEvent(companyID, boardID, columnID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "kanban_column_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_kanban_column")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func (s *Server) handleKanbanCards(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		query, ok, errCode := parseKanbanCardQueryParams(r)
		if !ok {
			writeError(w, http.StatusBadRequest, errCode)
			return
		}
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
		if !s.requireKanbanBoardView(w, r, companyID, boardID, "") {
			return
		}
		etag, notModified, err := s.writeWorkspaceEventNotModified(w, r, companyID, "kanban-cards", []store.DomainEventStreamQuery{
			workspaceEventQueryPayload(kanbanCardWorkspaceEventTypes, boardIDPayload(boardID)),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_workspace_version")
			return
		}
		if notModified {
			return
		}
		items, err := s.repo.ListKanbanCards(companyID, boardID, query)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_kanban_card_query")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_cards")
			return
		}
		items, err = s.filterVisibleKanbanCards(r, companyID, items)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_filter_kanban_cards")
			return
		}
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{"cards": items}, etag)
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID           string `json:"company_id"`
		BoardID             string `json:"board_id"`
		ColumnID            string `json:"column_id"`
		NodeID              string `json:"node_id"`
		NodeTitle           string `json:"node_title"`
		DescriptionSnapshot string `json:"description_snapshot"`
		Position            int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.BoardID = strings.TrimSpace(req.BoardID)
	req.ColumnID = strings.TrimSpace(req.ColumnID)
	req.NodeID = strings.TrimSpace(req.NodeID)
	req.NodeTitle = strings.TrimSpace(req.NodeTitle)
	req.DescriptionSnapshot = strings.TrimSpace(req.DescriptionSnapshot)
	if req.CompanyID == "" || req.BoardID == "" || req.ColumnID == "" || req.NodeID == "" {
		writeError(w, http.StatusBadRequest, "company_board_column_and_node_required")
		return
	}
	if !s.requireKanbanBoardView(w, r, req.CompanyID, req.BoardID, "") {
		return
	}
	if !s.requireEntityView(w, r, req.CompanyID, store.EntityTypeNode, req.NodeID, "node_not_found") {
		return
	}
	if req.NodeTitle == "" {
		req.NodeTitle = req.NodeID
	}
	result, err := s.kanban.UpsertCard(store.KanbanCardMutationInput{
		CompanyID:           req.CompanyID,
		BoardID:             req.BoardID,
		ColumnID:            req.ColumnID,
		NodeID:              req.NodeID,
		NodeTitle:           req.NodeTitle,
		DescriptionSnapshot: req.DescriptionSnapshot,
		Position:            req.Position,
	})
	item := result.Card
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_kanban_item_type")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "kanban_column_or_node_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_upsert_kanban_card")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleKanbanCardByID(w http.ResponseWriter, r *http.Request) {
	cardID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/kanban/cards/"))
	if cardID == "" || strings.Contains(cardID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method == http.MethodPut {
		var req struct {
			CompanyID string  `json:"company_id"`
			BoardID   string  `json:"board_id"`
			ColumnID  *string `json:"column_id"`
			Position  int     `json:"position"`
			IsIssue   *bool   `json:"is_issue"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		req.BoardID = strings.TrimSpace(req.BoardID)
		columnID := ""
		if req.ColumnID != nil {
			columnID = strings.TrimSpace(*req.ColumnID)
		}
		if req.CompanyID == "" || req.BoardID == "" {
			writeError(w, http.StatusBadRequest, "company_and_board_required")
			return
		}
		if !s.requireKanbanBoardView(w, r, req.CompanyID, req.BoardID, "") {
			return
		}
		if !s.requireKanbanCardView(w, r, req.CompanyID, req.BoardID, cardID) {
			return
		}
		if columnID == "" && req.IsIssue == nil {
			writeError(w, http.StatusBadRequest, "kanban_card_update_required")
			return
		}
		beforeCard, columnTitles, hadBeforeCard := s.kanbanCardNotificationSnapshot(req.CompanyID, req.BoardID, cardID)
		result, err := s.kanban.MoveCard(store.KanbanCardMoveInput{
			CompanyID: req.CompanyID,
			BoardID:   req.BoardID,
			CardID:    cardID,
			ColumnID:  columnID,
			Position:  req.Position,
			IsIssue:   req.IsIssue,
		})
		item := result.Card
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "kanban_card_or_column_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_move_kanban_card")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		if item.LogicGateID != nil && hadBeforeCard {
			s.recordKanbanStateNotification(r, beforeCard, item, columnTitles)
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
		if !s.requireKanbanBoardView(w, r, companyID, boardID, "") {
			return
		}
		if !s.requireKanbanCardView(w, r, companyID, boardID, cardID) {
			return
		}
		result, err := s.repo.DeleteKanbanCardWithWorkspaceEvent(companyID, boardID, cardID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "kanban_card_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_kanban_card")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}
