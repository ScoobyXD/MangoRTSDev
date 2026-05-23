package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
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

func writeLegacyKanbanDisabled(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "legacy_kanban_routes_disabled")
}

func (s *Server) logicGateWorkForKanbanCompatibility(w http.ResponseWriter, r *http.Request, companyID, logicGateID, accessLevel string) (domain.LogicGateWorkView, bool) {
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, accessLevel) {
		return domain.LogicGateWorkView{}, false
	}
	work, err := s.repo.GetLogicGateWork(companyID, logicGateID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_work_request")
		return domain.LogicGateWorkView{}, false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return domain.LogicGateWorkView{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_work")
		return domain.LogicGateWorkView{}, false
	}
	return work, true
}

func filterKanbanCompatibilityCards(cards []domain.KanbanCard, query store.KanbanCardQuery) []domain.KanbanCard {
	query = store.NormalizeKanbanCardQuery(query)
	items := make([]domain.KanbanCard, 0, min(query.Limit, len(cards)))
	for _, card := range cards {
		if query.ColumnID != "" && card.ColumnID != query.ColumnID {
			continue
		}
		if query.AfterPosition > 0 && card.Position <= query.AfterPosition {
			continue
		}
		items = append(items, card)
		if len(items) >= query.Limit {
			break
		}
	}
	return items
}

func logicGateWorkCardByID(work domain.LogicGateWorkView, cardID string) (domain.KanbanCard, bool) {
	cardID = strings.TrimSpace(cardID)
	for _, card := range work.Cards {
		if card.CardID == cardID {
			return card, true
		}
	}
	return domain.KanbanCard{}, false
}

func (s *Server) logicGateWorkCompatibilityCardAfterMutation(companyID, logicGateID string, fallback domain.KanbanCard) domain.KanbanCard {
	work, err := s.repo.GetLogicGateWork(companyID, logicGateID)
	if err != nil {
		return fallback
	}
	if card, ok := logicGateWorkCardByID(work, fallback.CardID); ok {
		return card
	}
	return fallback
}

func (s *Server) handleKanbanBoardsCompatibility(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeLegacyKanbanDisabled(w)
		return
	}
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
	if query.LogicGateID == "" {
		writeLegacyKanbanDisabled(w)
		return
	}
	work, ok := s.logicGateWorkForKanbanCompatibility(w, r, companyID, query.LogicGateID, store.EntityPermissionView)
	if !ok {
		return
	}
	boards := []domain.KanbanBoard{work.Board}
	if query.AfterPosition > 0 && work.Board.Position <= query.AfterPosition {
		boards = []domain.KanbanBoard{}
	}
	if len(boards) > query.Limit {
		boards = boards[:query.Limit]
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"boards": boards})
}

func (s *Server) handleKanbanColumnsCompatibility(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeLegacyKanbanDisabled(w)
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
	if companyID == "" || boardID == "" {
		writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
		return
	}
	logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
	if logicGateID == "" {
		writeLegacyKanbanDisabled(w)
		return
	}
	work, ok := s.logicGateWorkForKanbanCompatibility(w, r, companyID, logicGateID, store.EntityPermissionView)
	if !ok {
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"columns": work.Columns})
}

func (s *Server) handleKanbanCardsCompatibility(w http.ResponseWriter, r *http.Request) {
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
		logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
		if logicGateID == "" {
			writeLegacyKanbanDisabled(w)
			return
		}
		work, ok := s.logicGateWorkForKanbanCompatibility(w, r, companyID, logicGateID, store.EntityPermissionView)
		if !ok {
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"cards": filterKanbanCompatibilityCards(work.Cards, query)})
		return
	}
	if r.Method != http.MethodPost {
		writeLegacyKanbanDisabled(w)
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
		IsIssue             bool   `json:"is_issue"`
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
	logicGateID := store.LogicGateIDFromKanbanBoardID(req.BoardID)
	if logicGateID == "" {
		writeLegacyKanbanDisabled(w)
		return
	}
	if !s.requireLogicGateWorkEffectiveAccess(w, r, req.CompanyID, logicGateID, store.EntityPermissionEdit) {
		return
	}
	input := store.LogicGateNodeAssignmentInput{
		CompanyID:           req.CompanyID,
		LogicGateID:         logicGateID,
		NodeID:              req.NodeID,
		Status:              req.ColumnID,
		NodeTitle:           req.NodeTitle,
		DescriptionSnapshot: req.DescriptionSnapshot,
		Position:            req.Position,
		IsIssue:             req.IsIssue,
		IsIssueSet:          req.IsIssue,
	}
	input.ActorUserID, input.IdempotencyKey = workItemAssignmentRequestEventMetadata(r)
	result, err := s.repo.AssignNodeToLogicGateStatus(input)
	if !writeLogicGateWorkMutationError(w, err, "failed_to_assign_logic_gate_work_node") {
		return
	}
	s.refreshEffectiveAccessProjection(req.CompanyID, "legacy_kanban_card_assigned_to_logic_gate_work")
	s.publishCommittedWorkspaceEvents(result.Events)
	s.projectCommittedNotificationEvents(result.Events)
	writeJSON(w, http.StatusCreated, s.logicGateWorkCompatibilityCardAfterMutation(req.CompanyID, logicGateID, result.Card))
}

func (s *Server) handleKanbanBoardByIDCompatibility(w http.ResponseWriter, r *http.Request) {
	writeLegacyKanbanDisabled(w)
}

func (s *Server) handleKanbanColumnByIDCompatibility(w http.ResponseWriter, r *http.Request) {
	writeLegacyKanbanDisabled(w)
}

func (s *Server) handleKanbanCardByIDCompatibility(w http.ResponseWriter, r *http.Request) {
	cardID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/kanban/cards/"))
	if cardID == "" || strings.Contains(cardID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodPut && r.Method != http.MethodDelete {
		writeLegacyKanbanDisabled(w)
		return
	}
	var companyID string
	var boardID string
	var columnID string
	var position int
	var isIssue *bool
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
		companyID = strings.TrimSpace(req.CompanyID)
		boardID = strings.TrimSpace(req.BoardID)
		if req.ColumnID != nil {
			columnID = strings.TrimSpace(*req.ColumnID)
		}
		position = req.Position
		isIssue = req.IsIssue
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_and_board_required")
			return
		}
		if columnID == "" && isIssue == nil {
			writeError(w, http.StatusBadRequest, "kanban_card_update_required")
			return
		}
	} else {
		companyID = strings.TrimSpace(r.URL.Query().Get("company_id"))
		boardID = strings.TrimSpace(r.URL.Query().Get("board_id"))
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
	}
	logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
	if logicGateID == "" {
		writeLegacyKanbanDisabled(w)
		return
	}
	work, ok := s.logicGateWorkForKanbanCompatibility(w, r, companyID, logicGateID, store.EntityPermissionEdit)
	if !ok {
		return
	}
	card, ok := logicGateWorkCardByID(work, cardID)
	if !ok {
		writeError(w, http.StatusNotFound, "kanban_card_not_found")
		return
	}
	if r.Method == http.MethodDelete {
		actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
		result, err := s.repo.RemoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentRemoveInput{
			CompanyID:      companyID,
			LogicGateID:    logicGateID,
			NodeID:         card.NodeID,
			ActorUserID:    actorUserID,
			IdempotencyKey: idempotencyKey,
		})
		if !writeLogicGateWorkRemoveError(w, err) {
			return
		}
		s.refreshEffectiveAccessProjection(companyID, "legacy_kanban_card_removed_from_logic_gate_work")
		s.publishCommittedWorkspaceEvents(result.Events)
		s.projectCommittedNotificationEvents(result.Events)
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}
	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	var result store.LogicGateNodeAssignmentResult
	if columnID != "" {
		var err error
		result, err = s.repo.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
			CompanyID:      companyID,
			LogicGateID:    logicGateID,
			NodeID:         card.NodeID,
			Status:         columnID,
			Position:       position,
			ActorUserID:    actorUserID,
			IdempotencyKey: idempotencyKey,
		})
		if !writeLogicGateWorkMutationError(w, err, "failed_to_update_logic_gate_work_node_state") {
			return
		}
		s.refreshEffectiveAccessProjection(companyID, "legacy_kanban_card_moved_as_logic_gate_work")
		s.publishCommittedWorkspaceEvents(result.Events)
		s.projectCommittedNotificationEvents(result.Events)
		card = s.logicGateWorkCompatibilityCardAfterMutation(companyID, logicGateID, result.Card)
	}
	if isIssue != nil {
		issueResult, err := s.repo.SetLogicGateNodeAssignmentIssue(store.LogicGateNodeAssignmentIssueInput{
			CompanyID:      companyID,
			LogicGateID:    logicGateID,
			NodeID:         card.NodeID,
			IsIssue:        *isIssue,
			ActorUserID:    actorUserID,
			IdempotencyKey: idempotencyKey,
		})
		if !writeLogicGateWorkMutationError(w, err, "failed_to_update_logic_gate_work_node_issue_state") {
			return
		}
		s.refreshEffectiveAccessProjection(companyID, "legacy_kanban_card_issue_toggled_as_logic_gate_work")
		s.publishCommittedWorkspaceEvents(issueResult.Events)
		s.projectCommittedNotificationEvents(issueResult.Events)
		card = s.logicGateWorkCompatibilityCardAfterMutation(companyID, logicGateID, issueResult.Card)
		result = issueResult
	}
	if result.Card.CardID != "" {
		card = s.logicGateWorkCompatibilityCardAfterMutation(companyID, logicGateID, result.Card)
	}
	writeJSON(w, http.StatusOK, card)
}

func (s *Server) handleKanbanBoards(w http.ResponseWriter, r *http.Request) {
	if !s.legacyKanbanRoutesEnabled {
		s.handleKanbanBoardsCompatibility(w, r)
		return
	}
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
	if !s.legacyKanbanRoutesEnabled {
		s.handleKanbanBoardByIDCompatibility(w, r)
		return
	}
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
		if !s.requireKanbanBoardEdit(w, r, companyID, boardID, "") {
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
	if !s.requireKanbanBoardEdit(w, r, req.CompanyID, boardID, "") {
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
	if !s.legacyKanbanRoutesEnabled {
		s.handleKanbanColumnsCompatibility(w, r)
		return
	}
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
	if !s.requireKanbanBoardEdit(w, r, req.CompanyID, req.BoardID, "") {
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
	if !s.legacyKanbanRoutesEnabled {
		s.handleKanbanColumnByIDCompatibility(w, r)
		return
	}
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
		if !s.requireKanbanBoardEdit(w, r, req.CompanyID, req.BoardID, "") {
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
		if !s.requireKanbanBoardEdit(w, r, companyID, boardID, "") {
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
	if !s.legacyKanbanRoutesEnabled {
		s.handleKanbanCardsCompatibility(w, r)
		return
	}
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
	if !s.requireKanbanBoardEdit(w, r, req.CompanyID, req.BoardID, "") {
		return
	}
	if kanbanBoardLogicGateID(req.BoardID, "") == "" && !s.requireEntityView(w, r, req.CompanyID, store.EntityTypeNode, req.NodeID, "node_not_found") {
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
	if !s.legacyKanbanRoutesEnabled {
		s.handleKanbanCardByIDCompatibility(w, r)
		return
	}
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
		if !s.requireKanbanBoardEdit(w, r, req.CompanyID, req.BoardID, "") {
			return
		}
		if _, ok := s.requireKanbanCardAccess(w, r, req.CompanyID, req.BoardID, cardID, store.EntityPermissionEdit); !ok {
			return
		}
		if columnID == "" && req.IsIssue == nil {
			writeError(w, http.StatusBadRequest, "kanban_card_update_required")
			return
		}
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
		if !s.requireKanbanBoardEdit(w, r, companyID, boardID, "") {
			return
		}
		if _, ok := s.requireKanbanCardAccess(w, r, companyID, boardID, cardID, store.EntityPermissionEdit); !ok {
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
