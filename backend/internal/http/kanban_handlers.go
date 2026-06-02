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

func (s *Server) filterKanbanCardsVisibleToActor(w http.ResponseWriter, r *http.Request, companyID string, cards []domain.KanbanCard) ([]domain.KanbanCard, bool) {
	actor, hasActor := authenticatedActor(r)
	if !hasActor || actorCanManageCompany(actor, companyID) {
		return cards, true
	}
	userID := strings.TrimSpace(actor.User.UserID)
	if userID == "" {
		return cards, true
	}
	nodeIDs := make([]string, 0, len(cards))
	seen := map[string]bool{}
	for _, card := range cards {
		nodeID := strings.TrimSpace(card.NodeID)
		if nodeID == "" || seen[nodeID] {
			continue
		}
		seen[nodeID] = true
		nodeIDs = append(nodeIDs, nodeID)
	}
	if len(nodeIDs) == 0 {
		return cards, true
	}
	allowed, err := s.repo.ListEffectiveResourceIDsForUser(companyID, userID, store.EntityTypeNode, store.EntityPermissionView, nodeIDs)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_kanban_card_query")
		return nil, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_filter_kanban_cards")
		return nil, false
	}
	filtered := make([]domain.KanbanCard, 0, len(cards))
	for _, card := range cards {
		if allowed[strings.TrimSpace(card.NodeID)] {
			filtered = append(filtered, card)
		}
	}
	return filtered, true
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

func logicGateProjectionBoards(gates []domain.LogicGate, query store.KanbanBoardQuery) []domain.KanbanBoard {
	query = store.NormalizeKanbanBoardQuery(query)
	boards := make([]domain.KanbanBoard, 0, min(query.Limit, len(gates)))
	for index, gate := range gates {
		position := (index + 1) * 1000
		if query.AfterPosition > 0 && position <= query.AfterPosition {
			continue
		}
		logicGateID := strings.TrimSpace(gate.LogicGateID)
		if logicGateID == "" {
			continue
		}
		boardID := store.LogicGateKanbanBoardID(logicGateID)
		title := strings.TrimSpace(gate.Header)
		if title == "" {
			title = boardID
		}
		boards = append(boards, domain.KanbanBoard{
			CompanyID:        gate.CompanyID,
			BoardID:          boardID,
			LogicGateID:      &logicGateID,
			Title:            title,
			Position:         position,
			CreatedTimestamp: gate.CreatedTimestamp,
			UpdatedTimestamp: gate.CreatedTimestamp,
		})
		if len(boards) >= query.Limit {
			break
		}
	}
	return boards
}

func (s *Server) handleKanbanBoards(w http.ResponseWriter, r *http.Request) {
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
		actor, hasActor := authenticatedActor(r)
		if hasActor && actorRoleForCompany(actor, companyID) == "" {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return
		}
		var gates []domain.LogicGate
		var err error
		if hasActor && !actorCanManageCompany(actor, companyID) {
			gates, err = s.repo.ListVisibleLogicGates(companyID, actor.User.UserID)
		} else {
			gates, err = s.repo.ListLogicGates(companyID)
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_kanban_board_query")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_boards")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"boards": logicGateProjectionBoards(gates, query)})
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

func (s *Server) handleKanbanBoardByID(w http.ResponseWriter, r *http.Request) {
	writeLegacyKanbanDisabled(w)
}

func (s *Server) handleKanbanColumns(w http.ResponseWriter, r *http.Request) {
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
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionView) {
		return
	}
	columns, err := s.repo.ListKanbanColumns(companyID, boardID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_kanban_column_query")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_columns")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"columns": columns})
}

func (s *Server) handleKanbanColumnByID(w http.ResponseWriter, r *http.Request) {
	writeLegacyKanbanDisabled(w)
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
		logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
		if logicGateID == "" {
			writeLegacyKanbanDisabled(w)
			return
		}
		if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionView) {
			return
		}
		cards, err := s.repo.ListKanbanCards(companyID, boardID, query)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_kanban_card_query")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "logic_gate_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_cards")
			return
		}
		cards, ok = s.filterKanbanCardsVisibleToActor(w, r, companyID, cards)
		if !ok {
			return
		}
		sequence, err := s.repo.CurrentProjectionSequence(companyID, store.ProjectionNameKanbanBoard)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_kanban_projection_sequence")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"cards":               cards,
			"projection":          store.ProjectionNameKanbanBoard,
			"projection_sequence": sequence,
		})
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
		Priority            *int   `json:"priority"`
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
		ColumnID:            req.ColumnID,
		NodeTitle:           req.NodeTitle,
		DescriptionSnapshot: req.DescriptionSnapshot,
		Position:            req.Position,
		IsIssue:             req.IsIssue,
		IsIssueSet:          req.IsIssue,
		MutationOrigin:      store.MutationOriginKanban,
	}
	if req.Priority != nil {
		input.Priority = req.Priority
		input.PrioritySet = true
	}
	input.ActorUserID, input.IdempotencyKey = workItemAssignmentRequestEventMetadata(r)
	result, err := s.repo.AssignNodeToLogicGateStatus(input)
	if !writeLogicGateWorkMutationError(w, err, "failed_to_assign_logic_gate_work_node") {
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	s.publishProjectionDeltas(result.ProjectionDeltas)
	s.projectCommittedNotificationEvents(result.Events)
	writeJSON(w, http.StatusCreated, result.Card)
}

func (s *Server) handleKanbanCardByID(w http.ResponseWriter, r *http.Request) {
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
	card, ok := s.requireKanbanCardAccess(w, r, companyID, boardID, cardID, store.EntityPermissionEdit)
	if !ok {
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
		s.publishCommittedWorkspaceEvents(result.Events)
		s.publishProjectionDeltas(result.ProjectionDeltas)
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
			MutationOrigin: store.MutationOriginKanban,
		})
		if !writeLogicGateWorkMutationError(w, err, "failed_to_update_logic_gate_work_node_state") {
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		s.publishProjectionDeltas(result.ProjectionDeltas)
		s.projectCommittedNotificationEvents(result.Events)
		card = result.Card
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
		s.publishCommittedWorkspaceEvents(issueResult.Events)
		s.publishProjectionDeltas(issueResult.ProjectionDeltas)
		s.projectCommittedNotificationEvents(issueResult.Events)
		card = issueResult.Card
		result = issueResult
	}
	if result.Card.CardID != "" {
		card = result.Card
	}
	writeJSON(w, http.StatusOK, card)
}
