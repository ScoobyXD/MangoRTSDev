package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func sortKanbanBoards(items []domain.KanbanBoard) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
				return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
			}
			return items[i].BoardID < items[j].BoardID
		}
		return items[i].Position < items[j].Position
	})
}

func sortKanbanColumns(items []domain.KanbanColumn) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].Position < items[j].Position
	})
}

func sortKanbanCards(items []domain.KanbanCard) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].Position < items[j].Position
	})
}

func nextKanbanBoardPosition(boards map[string]domain.KanbanBoard, companyID string) int {
	next := 1000
	for _, board := range boards {
		if board.CompanyID != companyID {
			continue
		}
		if board.Position >= next {
			next = board.Position + 1000
		}
	}
	return next
}

func nextKanbanColumnPosition(columns []domain.KanbanColumn) int {
	next := 1000
	for _, column := range columns {
		if column.Position >= next {
			next = column.Position + 1000
		}
	}
	return next
}

func nextKanbanCardPosition(cards []domain.KanbanCard, columnID string) int {
	next := 1000
	for _, card := range cards {
		if card.ColumnID != columnID {
			continue
		}
		if card.Position >= next {
			next = card.Position + 1000
		}
	}
	return next
}

func (r *MemoryRepo) kanbanColumnExistsLocked(companyID, boardID, columnID string) bool {
	_, ok := r.kanbanColumnTitleLocked(companyID, boardID, columnID)
	return ok
}

func (r *MemoryRepo) kanbanColumnTitleLocked(companyID, boardID, columnID string) (string, bool) {
	column, ok := r.kanbanColumnLocked(companyID, boardID, columnID)
	if !ok {
		return "", false
	}
	return column.Title, true
}

func (r *MemoryRepo) kanbanColumnLocked(companyID, boardID, columnID string) (domain.KanbanColumn, bool) {
	for _, column := range r.kanbanColumns[boardKey(companyID, boardID)] {
		if column.ColumnID == columnID {
			return column, true
		}
	}
	return domain.KanbanColumn{}, false
}

func (r *MemoryRepo) syncNodeStatusFromKanbanCardLocked(card domain.KanbanCard) {
	if card.LogicGateID == nil {
		return
	}
	node, ok := r.nodes[key(card.CompanyID, card.NodeID)]
	if !ok {
		return
	}
	status := ""
	statusColor := ""
	if card.IsIssue {
		status = "Issue"
		statusColor = "#ffd400"
	} else if column, found := r.kanbanColumnLocked(card.CompanyID, card.BoardID, card.ColumnID); found {
		status = column.Title
		statusColor = column.ItemColor
	}
	if status != "" {
		node.Status = &status
	}
	if statusColor != "" {
		node.StatusColor = &statusColor
	}
	r.nodes[key(card.CompanyID, card.NodeID)] = node
}

func (r *MemoryRepo) ensureKanbanBoardLocked(companyID, boardID, title string) domain.KanbanBoard {
	return r.ensureKanbanBoardLockedWithLogicGate(companyID, boardID, title, nil)
}

func (r *MemoryRepo) ensureKanbanBoardLockedWithLogicGate(companyID, boardID, title string, logicGateID *string) domain.KanbanBoard {
	k := boardKey(companyID, boardID)
	if board, ok := r.kanbanBoards[k]; ok {
		if logicGateID != nil && (board.LogicGateID == nil || *board.LogicGateID != *logicGateID) {
			copied := *logicGateID
			board.LogicGateID = &copied
			board.UpdatedTimestamp = time.Now().UTC()
			r.kanbanBoards[k] = board
		}
		return board
	}
	now := time.Now().UTC()
	var copiedLogicGateID *string
	if logicGateID != nil {
		value := *logicGateID
		copiedLogicGateID = &value
	}
	board := domain.KanbanBoard{
		CompanyID:        companyID,
		BoardID:          boardID,
		LogicGateID:      copiedLogicGateID,
		Title:            normalizeKanbanBoardTitle(boardID, title),
		Position:         nextKanbanBoardPosition(r.kanbanBoards, companyID),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.kanbanBoards[k] = board
	return board
}

func (r *MemoryRepo) ensureLogicGateKanbanBoardLocked(companyID, logicGateID, title string) domain.KanbanBoard {
	boardID := LogicGateKanbanBoardID(logicGateID)
	logicGateIDCopy := logicGateID
	board := r.ensureKanbanBoardLockedWithLogicGate(companyID, boardID, title, &logicGateIDCopy)
	defaults := []struct {
		title string
		color string
	}{
		{title: "Pending", color: KanbanDefaultPendingColor},
		{title: "In Progress", color: KanbanDefaultInProgressColor},
		{title: "Done", color: KanbanDefaultDoneColor},
	}
	existing := map[string]bool{}
	for _, column := range r.kanbanColumns[boardKey(companyID, boardID)] {
		existing[strings.ToLower(strings.TrimSpace(column.Title))] = true
	}
	for index, column := range defaults {
		if existing[strings.ToLower(column.title)] {
			continue
		}
		now := time.Now().UTC()
		r.kanbanColumns[boardKey(companyID, boardID)] = append(r.kanbanColumns[boardKey(companyID, boardID)], domain.KanbanColumn{
			CompanyID:        companyID,
			BoardID:          boardID,
			ColumnID:         newUUIDv7String(),
			Title:            column.title,
			Position:         (index + 1) * 1000,
			WidthPx:          normalizeKanbanColumnWidth(0),
			HeightPx:         normalizeKanbanColumnHeight(0),
			ItemColor:        column.color,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		})
	}
	return board
}

func (r *MemoryRepo) EnsureLogicGateKanbanBoard(companyID, logicGateID, title string) (domain.KanbanBoard, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return domain.KanbanBoard{}, ErrNotFound
	}
	return r.ensureLogicGateKanbanBoardLocked(companyID, logicGateID, title), nil
}

func (r *MemoryRepo) ListKanbanBoards(companyID string, query KanbanBoardQuery) ([]domain.KanbanBoard, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	query = NormalizeKanbanBoardQuery(query)
	items := make([]domain.KanbanBoard, 0, min(query.Limit, len(r.kanbanBoards)))
	for _, board := range r.kanbanBoards {
		if board.CompanyID != companyID {
			continue
		}
		if query.LogicGateID != "" && (board.LogicGateID == nil || *board.LogicGateID != query.LogicGateID) {
			continue
		}
		if query.AfterPosition > 0 && board.Position <= query.AfterPosition {
			continue
		}
		items = append(items, board)
	}
	sortKanbanBoards(items)
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) CreateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if boardID == "" {
		boardID = newUUIDv7String()
	}
	k := boardKey(companyID, boardID)
	if existing, ok := r.kanbanBoards[k]; ok {
		if existing.LogicGateID != nil {
			if logicGate, ok := r.logicGates[key(companyID, *existing.LogicGateID)]; ok {
				existing.Title = normalizeKanbanBoardTitle(boardID, logicGate.Header)
			}
		} else if strings.TrimSpace(title) != "" {
			existing.Title = normalizeKanbanBoardTitle(boardID, title)
		}
		if position > 0 {
			existing.Position = position
		}
		existing.UpdatedTimestamp = time.Now().UTC()
		r.kanbanBoards[k] = existing
		return existing, nil
	}
	if position <= 0 {
		position = nextKanbanBoardPosition(r.kanbanBoards, companyID)
	}
	now := time.Now().UTC()
	item := domain.KanbanBoard{
		CompanyID:        companyID,
		BoardID:          boardID,
		LogicGateID:      nil,
		Title:            normalizeKanbanBoardTitle(boardID, title),
		Position:         position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.kanbanBoards[k] = item
	return item, nil
}

func (r *MemoryRepo) UpdateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := boardKey(companyID, boardID)
	item, ok := r.kanbanBoards[k]
	if !ok {
		return domain.KanbanBoard{}, ErrNotFound
	}
	if item.LogicGateID != nil {
		if logicGate, ok := r.logicGates[key(companyID, *item.LogicGateID)]; ok {
			item.Title = normalizeKanbanBoardTitle(boardID, logicGate.Header)
		}
	} else if strings.TrimSpace(title) != "" {
		item.Title = normalizeKanbanBoardTitle(boardID, title)
	}
	if position > 0 {
		item.Position = position
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.kanbanBoards[k] = item
	return item, nil
}

func (r *MemoryRepo) DeleteKanbanBoard(companyID, boardID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.deleteKanbanBoardLocked(companyID, boardID)
}

func (r *MemoryRepo) deleteKanbanBoardLocked(companyID, boardID string) error {
	k := boardKey(companyID, boardID)
	board, ok := r.kanbanBoards[k]
	if !ok {
		return ErrNotFound
	}
	if board.LogicGateID != nil {
		return ErrInvalid
	}
	delete(r.kanbanBoards, k)
	delete(r.kanbanColumns, k)
	delete(r.kanbanCards, k)
	delete(r.folderItems, folderItemKey(companyID, "kanban", boardID))
	return nil
}

func (r *MemoryRepo) ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := append([]domain.KanbanColumn{}, r.kanbanColumns[boardKey(companyID, boardID)]...)
	sortKanbanColumns(items)
	return items, nil
}

func (r *MemoryRepo) CreateKanbanColumn(companyID, boardID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := boardKey(companyID, boardID)
	r.ensureKanbanBoardLocked(companyID, boardID, boardID)
	if position <= 0 {
		position = nextKanbanColumnPosition(r.kanbanColumns[k])
	}
	now := time.Now().UTC()
	item := domain.KanbanColumn{
		CompanyID:        companyID,
		BoardID:          boardID,
		ColumnID:         newUUIDv7String(),
		Title:            title,
		Position:         position,
		WidthPx:          normalizeKanbanColumnWidth(widthPx),
		HeightPx:         normalizeKanbanColumnHeight(heightPx),
		ItemColor:        normalizeKanbanColumnItemColor(itemColor),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.kanbanColumns[k] = append(r.kanbanColumns[k], item)
	return item, nil
}

func (r *MemoryRepo) UpdateKanbanColumn(companyID, boardID, columnID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := boardKey(companyID, boardID)
	for index, column := range r.kanbanColumns[k] {
		if column.ColumnID != columnID {
			continue
		}
		if title != "" {
			column.Title = title
		}
		if position > 0 {
			column.Position = position
		}
		if widthPx > 0 {
			column.WidthPx = normalizeKanbanColumnWidth(widthPx)
		}
		if heightPx > 0 {
			column.HeightPx = normalizeKanbanColumnHeight(heightPx)
		}
		if strings.TrimSpace(itemColor) != "" {
			column.ItemColor = normalizeKanbanColumnItemColor(itemColor)
		}
		column.UpdatedTimestamp = time.Now().UTC()
		r.kanbanColumns[k][index] = column
		return column, nil
	}
	return domain.KanbanColumn{}, ErrNotFound
}

func (r *MemoryRepo) DeleteKanbanColumn(companyID, boardID, columnID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := boardKey(companyID, boardID)
	columns := r.kanbanColumns[k]
	nextColumns := make([]domain.KanbanColumn, 0, len(columns))
	deleted := false
	for _, column := range columns {
		if column.ColumnID == columnID {
			deleted = true
			continue
		}
		nextColumns = append(nextColumns, column)
	}
	if !deleted {
		return ErrNotFound
	}
	r.kanbanColumns[k] = nextColumns

	cards := r.kanbanCards[k]
	for _, card := range cards {
		if card.ColumnID == columnID && card.LogicGateID != nil {
			return ErrInvalid
		}
	}
	nextCards := make([]domain.KanbanCard, 0, len(cards))
	for _, card := range cards {
		if card.ColumnID == columnID {
			continue
		}
		nextCards = append(nextCards, card)
	}
	r.kanbanCards[k] = nextCards
	return nil
}

func (r *MemoryRepo) ListKanbanCards(companyID, boardID string, query KanbanCardQuery) ([]domain.KanbanCard, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	query = NormalizeKanbanCardQuery(query)
	source := r.kanbanCards[boardKey(companyID, boardID)]
	items := make([]domain.KanbanCard, 0, min(query.Limit, len(source)))
	for _, card := range source {
		if query.ColumnID != "" && card.ColumnID != query.ColumnID {
			continue
		}
		if query.AfterPosition > 0 && card.Position <= query.AfterPosition {
			continue
		}
		if node, ok := r.nodes[key(companyID, card.NodeID)]; ok && strings.TrimSpace(node.Title) != "" {
			card.NodeTitle = node.Title
		}
		items = append(items, card)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ColumnID != items[j].ColumnID {
			return items[i].ColumnID < items[j].ColumnID
		}
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].CardID < items[j].CardID
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) GetKanbanCard(companyID, boardID, cardID string) (domain.KanbanCard, error) {
	companyID = strings.TrimSpace(companyID)
	boardID = strings.TrimSpace(boardID)
	cardID = strings.TrimSpace(cardID)
	if companyID == "" || boardID == "" || cardID == "" {
		return domain.KanbanCard{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, card := range r.kanbanCards[boardKey(companyID, boardID)] {
		if card.CardID != cardID {
			continue
		}
		if node, ok := r.nodes[key(companyID, card.NodeID)]; ok && strings.TrimSpace(node.Title) != "" {
			card.NodeTitle = node.Title
		}
		return card, nil
	}
	return domain.KanbanCard{}, ErrNotFound
}

func (r *MemoryRepo) UpsertKanbanCard(input KanbanCardMutationInput) (domain.KanbanCard, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.upsertKanbanCardLocked(input)
}

func (r *MemoryRepo) upsertKanbanCardLocked(input KanbanCardMutationInput) (domain.KanbanCard, error) {
	if !r.kanbanColumnExistsLocked(input.CompanyID, input.BoardID, input.ColumnID) {
		return domain.KanbanCard{}, ErrNotFound
	}
	if _, ok := r.nodes[key(input.CompanyID, input.NodeID)]; !ok {
		return domain.KanbanCard{}, ErrNotFound
	}
	k := boardKey(input.CompanyID, input.BoardID)
	board := r.ensureKanbanBoardLocked(input.CompanyID, input.BoardID, input.BoardID)
	if board.LogicGateID != nil {
		for boardKeyValue, cards := range r.kanbanCards {
			nextCards := cards[:0]
			for _, card := range cards {
				if card.CompanyID == input.CompanyID && card.NodeID == input.NodeID && card.LogicGateID != nil && card.BoardID != input.BoardID {
					continue
				}
				nextCards = append(nextCards, card)
			}
			r.kanbanCards[boardKeyValue] = nextCards
		}
	}
	if input.Position <= 0 {
		input.Position = nextKanbanCardPosition(r.kanbanCards[k], input.ColumnID)
	}
	now := time.Now().UTC()
	nodeKey := key(input.CompanyID, input.NodeID)
	node := r.nodes[nodeKey]
	nodeTitle := node.Title
	if strings.TrimSpace(nodeTitle) == "" {
		nodeTitle = normalizeKanbanBoardTitle(input.NodeID, input.NodeTitle)
	}
	description := strings.TrimSpace(input.DescriptionSnapshot)
	assignResponsible := func() error {
		if board.LogicGateID == nil {
			return nil
		}
		if r.assignNodeToLogicGateResponsibleLocked(input.CompanyID, *board.LogicGateID, input.NodeID) {
			return r.recomputeNodeAssigneeEffectiveAccessLocked(input.CompanyID, input.NodeID)
		}
		return nil
	}
	for index, card := range r.kanbanCards[k] {
		if card.NodeID != input.NodeID {
			continue
		}
		// A drop is a command, not append-only history. Moving the existing card keeps
		// repeated UI drops and retrying agents idempotent.
		card.ColumnID = input.ColumnID
		if board.LogicGateID != nil {
			value := *board.LogicGateID
			card.LogicGateID = &value
		}
		card.NodeTitle = nodeTitle
		card.Position = input.Position
		if description != "" || card.DescriptionSnapshot == "" {
			card.DescriptionSnapshot = description
		}
		if input.IsIssueSet {
			card.IsIssue = input.IsIssue
		}
		card.UpdatedTimestamp = now
		r.kanbanCards[k][index] = card
		if err := assignResponsible(); err != nil {
			return domain.KanbanCard{}, err
		}
		if card.LogicGateID != nil {
			r.upsertNodeLogicGateAssignmentFromCardLocked(card)
		}
		r.syncNodeStatusFromKanbanCardLocked(card)
		return card, nil
	}
	cardID := strings.TrimSpace(input.CardID)
	if cardID == "" {
		cardID = newUUIDv7String()
	}
	card := domain.KanbanCard{
		CompanyID:           input.CompanyID,
		BoardID:             input.BoardID,
		CardID:              cardID,
		ColumnID:            input.ColumnID,
		NodeID:              input.NodeID,
		LogicGateID:         nil,
		NodeTitle:           nodeTitle,
		DescriptionSnapshot: description,
		IsIssue:             input.IsIssueSet && input.IsIssue,
		Position:            input.Position,
		CreatedTimestamp:    now,
		UpdatedTimestamp:    now,
	}
	if board.LogicGateID != nil {
		value := *board.LogicGateID
		card.LogicGateID = &value
	}
	r.kanbanCards[k] = append(r.kanbanCards[k], card)
	if err := assignResponsible(); err != nil {
		return domain.KanbanCard{}, err
	}
	if card.LogicGateID != nil {
		r.upsertNodeLogicGateAssignmentFromCardLocked(card)
	}
	r.syncNodeStatusFromKanbanCardLocked(card)
	return card, nil
}

func (r *MemoryRepo) AssignNodeToLogicGateStatus(input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()

	boardID := LogicGateKanbanBoardID(input.LogicGateID)
	board, ok := r.kanbanBoards[boardKey(input.CompanyID, boardID)]
	if !ok || board.LogicGateID == nil || *board.LogicGateID != input.LogicGateID {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	column, err := resolveLogicGateAssignmentColumn(r.kanbanColumns[boardKey(input.CompanyID, boardID)], input.ColumnID, input.Status)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if _, ok := r.nodes[key(input.CompanyID, input.NodeID)]; !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	nodeKey := key(input.CompanyID, input.NodeID)
	previousNode := r.nodes[nodeKey]
	previousAssigneeUserID := nodeAssigneeUserID(previousNode)
	previousAssignment, hadPreviousAssignment := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, "")

	card, err := r.upsertKanbanCardLocked(KanbanCardMutationInput{
		CompanyID:           input.CompanyID,
		BoardID:             boardID,
		ColumnID:            column.ColumnID,
		NodeID:              input.NodeID,
		NodeTitle:           input.NodeTitle,
		DescriptionSnapshot: input.DescriptionSnapshot,
		Position:            input.Position,
		IsIssue:             input.IsIssue,
		IsIssueSet:          input.IsIssueSet,
	})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	if input.PrioritySet {
		node := r.nodes[nodeKey]
		if input.Priority == nil {
			node.Priority = nil
		} else {
			priority := *input.Priority
			node.Priority = &priority
		}
		r.nodes[nodeKey] = node
	}
	if nodeAssigneeUserID(r.nodes[nodeKey]) != previousAssigneeUserID {
		if err := r.recomputeNodeAssigneeEffectiveAccessLocked(input.CompanyID, input.NodeID); err != nil {
			r.restoreWorkItemAssignmentEventStateLocked(snapshot)
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	if !hadPreviousAssignment || previousAssignment.LogicGateID != input.LogicGateID {
		if err := r.recomputeLogicGateAssignedNodeVisibilityLocked(input.CompanyID, []string{input.LogicGateID}, []string{input.NodeID}); err != nil {
			r.restoreWorkItemAssignmentEventStateLocked(snapshot)
			return LogicGateNodeAssignmentResult{}, err
		}
	}

	assignment, ok := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if !ok {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	result := LogicGateNodeAssignmentResult{
		Card:       card,
		Node:       r.withNodeReadModelLocked(r.nodes[nodeKey]),
		Assignment: assignment,
	}
	events, err := r.appendDomainEventsLocked(logicGateAssignmentSavedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	return result, nil
}

func (r *MemoryRepo) responsibleUserIDForLogicGateLocked(companyID, logicGateID string) string {
	assignments := append([]domain.LogicGateRaciAssignment{}, r.logicGateRaci[key(companyID, logicGateID)]...)
	sortLogicGateRaciAssignments(assignments)
	for _, assignment := range assignments {
		if assignment.Role == domain.LogicGateRaciRoleResponsible && strings.TrimSpace(assignment.UserID) != "" {
			return strings.TrimSpace(assignment.UserID)
		}
	}
	return ""
}

func (r *MemoryRepo) assignNodeToLogicGateResponsibleLocked(companyID, logicGateID, nodeID string) bool {
	responsibleUserID := r.responsibleUserIDForLogicGateLocked(companyID, logicGateID)
	if responsibleUserID == "" {
		return false
	}
	nodeKey := key(companyID, nodeID)
	node, ok := r.nodes[nodeKey]
	if !ok {
		return false
	}
	if nodeAssigneeUserID(node) == responsibleUserID {
		return false
	}
	node.AssigneeUserID = &responsibleUserID
	r.nodes[nodeKey] = node
	return true
}

type memoryKanbanCardLocation struct {
	mapKey string
	index  int
	card   domain.KanbanCard
}

func (r *MemoryRepo) logicGateAssignmentCardLocationsLocked(companyID, nodeID, logicGateID string) []memoryKanbanCardLocation {
	locations := make([]memoryKanbanCardLocation, 0, 1)
	logicGateID = strings.TrimSpace(logicGateID)
	for mapKey, cards := range r.kanbanCards {
		for index, card := range cards {
			if card.CompanyID != companyID || card.NodeID != nodeID || card.LogicGateID == nil {
				continue
			}
			if logicGateID != "" && *card.LogicGateID != logicGateID {
				continue
			}
			locations = append(locations, memoryKanbanCardLocation{mapKey: mapKey, index: index, card: card})
		}
	}
	sort.Slice(locations, func(i, j int) bool {
		left := locations[i].card
		right := locations[j].card
		if !left.UpdatedTimestamp.Equal(right.UpdatedTimestamp) {
			return left.UpdatedTimestamp.After(right.UpdatedTimestamp)
		}
		if !left.CreatedTimestamp.Equal(right.CreatedTimestamp) {
			return left.CreatedTimestamp.After(right.CreatedTimestamp)
		}
		return left.CardID > right.CardID
	})
	return locations
}

func (r *MemoryRepo) applyNodeStatusAfterLogicGateAssignmentRemovalLocked(companyID, nodeID string, fallbackStatus, fallbackStatusColor *string) {
	nodeKey := key(companyID, nodeID)
	node, ok := r.nodes[nodeKey]
	if !ok {
		return
	}
	if derivedStatus, derivedColor := r.deriveNodeStatusLocked(companyID, nodeID); derivedStatus != nil {
		node.Status = derivedStatus
		node.StatusColor = derivedColor
	} else {
		node.Status = fallbackStatus
		node.StatusColor = fallbackStatusColor
	}
	r.nodes[nodeKey] = node
}

func (r *MemoryRepo) MoveLogicGateNodeAssignment(input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentMoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()

	nodeKey := key(input.CompanyID, input.NodeID)
	node, ok := r.nodes[nodeKey]
	if !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	assignment, ok := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	locations := r.logicGateAssignmentCardLocationsLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if len(locations) == 0 {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	location := locations[0]
	card := location.card
	if assignment.CompatibilityBoardID != card.BoardID || assignment.CompatibilityCardID != card.CardID {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}

	columnID := card.ColumnID
	if input.ColumnID != "" || input.Status != "" {
		column, err := resolveLogicGateAssignmentColumn(r.kanbanColumns[boardKey(input.CompanyID, card.BoardID)], input.ColumnID, input.Status)
		if err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		columnID = column.ColumnID
	}
	position := card.Position
	if input.Position > 0 {
		position = input.Position
	} else if columnID != card.ColumnID {
		position = nextKanbanCardPosition(r.kanbanCards[location.mapKey], columnID)
	}

	card.ColumnID = columnID
	card.Position = position
	if strings.TrimSpace(node.Title) != "" {
		card.NodeTitle = node.Title
	}
	card.UpdatedTimestamp = time.Now().UTC()
	column, _ := r.kanbanColumnLocked(input.CompanyID, card.BoardID, columnID)
	r.upsertNodeLogicGateAssignmentLocked(nodeLogicGateAssignmentMutation{
		CompanyID:            input.CompanyID,
		NodeID:               input.NodeID,
		LogicGateID:          input.LogicGateID,
		ColumnID:             columnID,
		StatusKey:            logicGateAssignmentStatusKey(column.Title),
		IsIssue:              card.IsIssue,
		Position:             position,
		CompatibilityBoardID: card.BoardID,
		CompatibilityCardID:  card.CardID,
		UpdatedTimestamp:     card.UpdatedTimestamp,
	})
	r.kanbanCards[location.mapKey][location.index] = card
	if input.AssigneePolicySet {
		previousAssigneeUserID := nodeAssigneeUserID(r.nodes[nodeKey])
		r.assignNodeToLogicGateResponsibleLocked(input.CompanyID, input.LogicGateID, input.NodeID)
		if nodeAssigneeUserID(r.nodes[nodeKey]) != previousAssigneeUserID {
			if err := r.recomputeNodeAssigneeEffectiveAccessLocked(input.CompanyID, input.NodeID); err != nil {
				r.restoreWorkItemAssignmentEventStateLocked(snapshot)
				return LogicGateNodeAssignmentResult{}, err
			}
		}
	}
	r.syncNodeStatusFromKanbanCardLocked(card)
	if input.PrioritySet {
		node = r.nodes[nodeKey]
		if input.Priority == nil {
			node.Priority = nil
		} else {
			priority := *input.Priority
			node.Priority = &priority
		}
		r.nodes[nodeKey] = node
	}

	assignment, ok = r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if !ok {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	result := LogicGateNodeAssignmentResult{
		Card:       card,
		Node:       r.withNodeReadModelLocked(r.nodes[nodeKey]),
		Assignment: assignment,
	}
	events, err := r.appendDomainEventsLocked(logicGateAssignmentMovedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	return result, nil
}

func (r *MemoryRepo) RemoveLogicGateNodeAssignment(input LogicGateNodeAssignmentRemoveInput) (LogicGateNodeAssignmentRemoveResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentRemoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()

	nodeKey := key(input.CompanyID, input.NodeID)
	if _, ok := r.nodes[nodeKey]; !ok {
		return LogicGateNodeAssignmentRemoveResult{}, ErrNotFound
	}
	assignment, ok := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if !ok {
		return LogicGateNodeAssignmentRemoveResult{}, ErrNotFound
	}
	locations := r.logicGateAssignmentCardLocationsLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if len(locations) == 0 {
		return LogicGateNodeAssignmentRemoveResult{}, ErrNotFound
	}
	location := locations[0]
	if assignment.CompatibilityBoardID != location.card.BoardID || assignment.CompatibilityCardID != location.card.CardID {
		return LogicGateNodeAssignmentRemoveResult{}, ErrNotFound
	}
	delete(r.nodeLogicGateAssignments, nodeLogicGateAssignmentKey(input.CompanyID, input.NodeID))
	cards := r.kanbanCards[location.mapKey]
	r.kanbanCards[location.mapKey] = append(cards[:location.index], cards[location.index+1:]...)
	r.applyNodeStatusAfterLogicGateAssignmentRemovalLocked(input.CompanyID, input.NodeID, input.FallbackStatus, input.FallbackStatusColor)
	if err := r.recomputeLogicGateAssignedNodeVisibilityLocked(input.CompanyID, []string{input.LogicGateID}, []string{input.NodeID}); err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentRemoveResult{}, err
	}

	result := LogicGateNodeAssignmentRemoveResult{
		Card:       location.card,
		Node:       r.withNodeReadModelLocked(r.nodes[nodeKey]),
		Assignment: assignment,
	}
	events, err := r.appendDomainEventsLocked(logicGateAssignmentRemovedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	result.Events = events
	return result, nil
}

func (r *MemoryRepo) SetLogicGateNodeAssignmentIssue(input LogicGateNodeAssignmentIssueInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentIssueInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()

	nodeKey := key(input.CompanyID, input.NodeID)
	if _, ok := r.nodes[nodeKey]; !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	assignment, ok := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	locations := r.logicGateAssignmentCardLocationsLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if len(locations) == 0 {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	location := locations[0]
	card := location.card
	if assignment.CompatibilityBoardID != card.BoardID || assignment.CompatibilityCardID != card.CardID {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	card.IsIssue = input.IsIssue
	card.UpdatedTimestamp = time.Now().UTC()
	r.upsertNodeLogicGateAssignmentLocked(nodeLogicGateAssignmentMutation{
		CompanyID:            input.CompanyID,
		NodeID:               input.NodeID,
		LogicGateID:          assignment.LogicGateID,
		ColumnID:             assignment.ColumnID,
		StatusKey:            assignment.StatusKey,
		IsIssue:              input.IsIssue,
		Position:             assignment.Position,
		CompatibilityBoardID: assignment.CompatibilityBoardID,
		CompatibilityCardID:  assignment.CompatibilityCardID,
		UpdatedTimestamp:     card.UpdatedTimestamp,
	})
	r.kanbanCards[location.mapKey][location.index] = card
	r.syncNodeStatusFromKanbanCardLocked(card)

	assignment, ok = r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if !ok {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	result := LogicGateNodeAssignmentResult{
		Card:       card,
		Node:       r.withNodeReadModelLocked(r.nodes[nodeKey]),
		Assignment: assignment,
	}
	events, err := r.appendDomainEventsLocked(logicGateAssignmentIssueWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	return result, nil
}
func (r *MemoryRepo) MoveKanbanCard(input KanbanCardMoveInput) (domain.KanbanCard, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if input.ColumnID != "" && !r.kanbanColumnExistsLocked(input.CompanyID, input.BoardID, input.ColumnID) {
		return domain.KanbanCard{}, ErrNotFound
	}
	k := boardKey(input.CompanyID, input.BoardID)
	if input.ColumnID != "" && input.Position <= 0 {
		input.Position = nextKanbanCardPosition(r.kanbanCards[k], input.ColumnID)
	}
	for index, card := range r.kanbanCards[k] {
		if card.CardID != input.CardID {
			continue
		}
		now := time.Now().UTC()
		if input.ColumnID != "" {
			card.ColumnID = input.ColumnID
		}
		if node, ok := r.nodes[key(input.CompanyID, card.NodeID)]; ok && strings.TrimSpace(node.Title) != "" {
			card.NodeTitle = node.Title
		}
		if input.Position > 0 {
			card.Position = input.Position
		}
		if input.IsIssue != nil {
			card.IsIssue = *input.IsIssue
		}
		card.UpdatedTimestamp = now
		r.kanbanCards[k][index] = card
		if card.LogicGateID != nil {
			r.upsertNodeLogicGateAssignmentFromCardLocked(card)
		}
		r.syncNodeStatusFromKanbanCardLocked(card)
		return card, nil
	}
	return domain.KanbanCard{}, ErrNotFound
}

func (r *MemoryRepo) DeleteKanbanCard(companyID, boardID, cardID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := boardKey(companyID, boardID)
	cards := r.kanbanCards[k]
	next := make([]domain.KanbanCard, 0, len(cards))
	deleted := false
	var deletedCard domain.KanbanCard
	for _, card := range cards {
		if card.CardID == cardID {
			deleted = true
			deletedCard = card
			continue
		}
		next = append(next, card)
	}
	if !deleted {
		return ErrNotFound
	}
	r.kanbanCards[k] = next
	if deletedCard.LogicGateID != nil {
		r.deleteNodeLogicGateAssignmentForCardLocked(deletedCard)
		r.applyNodeStatusAfterLogicGateAssignmentRemovalLocked(companyID, deletedCard.NodeID, nil, nil)
	}
	return nil
}

type memoryKanbanWorkspaceEventSnapshot struct {
	nodes                    map[string]domain.Node
	folderItems              map[string]domain.CompanyExplorerFolderItem
	kanbanBoards             map[string]domain.KanbanBoard
	kanbanColumns            map[string][]domain.KanbanColumn
	kanbanCards              map[string][]domain.KanbanCard
	nodeLogicGateAssignments map[string]domain.NodeLogicGateAssignment
	workItemInboxEntries     map[string]memoryWorkItemInboxEntry
	domainEvents             map[string]domain.DomainEvent
	workspaceReadVersions    map[string]int64
}

func (r *MemoryRepo) snapshotKanbanWorkspaceEventStateLocked() memoryKanbanWorkspaceEventSnapshot {
	return memoryKanbanWorkspaceEventSnapshot{
		nodes:                    cloneMemoryMap(r.nodes),
		folderItems:              cloneMemoryMap(r.folderItems),
		kanbanBoards:             cloneMemoryMap(r.kanbanBoards),
		kanbanColumns:            cloneMemorySliceMap(r.kanbanColumns),
		kanbanCards:              cloneMemorySliceMap(r.kanbanCards),
		nodeLogicGateAssignments: cloneMemoryMap(r.nodeLogicGateAssignments),
		workItemInboxEntries:     cloneMemoryMap(r.workItemInboxEntries),
		domainEvents:             cloneMemoryMap(r.domainEvents),
		workspaceReadVersions:    cloneMemoryMap(r.workspaceReadVersions),
	}
}

func (r *MemoryRepo) restoreKanbanWorkspaceEventStateLocked(snapshot memoryKanbanWorkspaceEventSnapshot) {
	r.nodes = snapshot.nodes
	r.folderItems = snapshot.folderItems
	r.kanbanBoards = snapshot.kanbanBoards
	r.kanbanColumns = snapshot.kanbanColumns
	r.kanbanCards = snapshot.kanbanCards
	r.nodeLogicGateAssignments = snapshot.nodeLogicGateAssignments
	r.workItemInboxEntries = snapshot.workItemInboxEntries
	r.domainEvents = snapshot.domainEvents
	r.workspaceReadVersions = snapshot.workspaceReadVersions
}

func (r *MemoryRepo) kanbanDerivedNodeLocked(card domain.KanbanCard) *domain.Node {
	if card.LogicGateID == nil {
		return nil
	}
	node, ok := r.nodes[key(card.CompanyID, card.NodeID)]
	if !ok {
		return nil
	}
	derived := r.withNodeReadModelLocked(node)
	return &derived
}

func (r *MemoryRepo) CreateKanbanBoardWithWorkspaceEvent(companyID, boardID, title string, position int) (KanbanBoardWorkspaceEventResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotKanbanWorkspaceEventStateLocked()
	if boardID == "" {
		boardID = newUUIDv7String()
	}
	k := boardKey(companyID, boardID)
	var item domain.KanbanBoard
	if existing, ok := r.kanbanBoards[k]; ok {
		if existing.LogicGateID != nil {
			if logicGate, ok := r.logicGates[key(companyID, *existing.LogicGateID)]; ok {
				existing.Title = normalizeKanbanBoardTitle(boardID, logicGate.Header)
			}
		} else if strings.TrimSpace(title) != "" {
			existing.Title = normalizeKanbanBoardTitle(boardID, title)
		}
		if position > 0 {
			existing.Position = position
		}
		existing.UpdatedTimestamp = time.Now().UTC()
		r.kanbanBoards[k] = existing
		item = existing
	} else {
		if position <= 0 {
			position = nextKanbanBoardPosition(r.kanbanBoards, companyID)
		}
		now := time.Now().UTC()
		item = domain.KanbanBoard{
			CompanyID:        companyID,
			BoardID:          boardID,
			LogicGateID:      nil,
			Title:            normalizeKanbanBoardTitle(boardID, title),
			Position:         position,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		r.kanbanBoards[k] = item
	}
	event, err := r.appendDomainEventLocked(kanbanBoardSavedWorkspaceEventInput(item))
	if err != nil {
		r.restoreKanbanWorkspaceEventStateLocked(snapshot)
		return KanbanBoardWorkspaceEventResult{}, err
	}
	return KanbanBoardWorkspaceEventResult{Board: item, Events: []domain.DomainEvent{event}}, nil
}

func (r *MemoryRepo) UpdateKanbanBoardWithWorkspaceEvent(companyID, boardID, title string, position int) (KanbanBoardWorkspaceEventResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotKanbanWorkspaceEventStateLocked()
	k := boardKey(companyID, boardID)
	item, ok := r.kanbanBoards[k]
	if !ok {
		return KanbanBoardWorkspaceEventResult{}, ErrNotFound
	}
	if item.LogicGateID != nil {
		if logicGate, ok := r.logicGates[key(companyID, *item.LogicGateID)]; ok {
			item.Title = normalizeKanbanBoardTitle(boardID, logicGate.Header)
		}
	} else if strings.TrimSpace(title) != "" {
		item.Title = normalizeKanbanBoardTitle(boardID, title)
	}
	if position > 0 {
		item.Position = position
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.kanbanBoards[k] = item
	event, err := r.appendDomainEventLocked(kanbanBoardUpdatedWorkspaceEventInput(item))
	if err != nil {
		r.restoreKanbanWorkspaceEventStateLocked(snapshot)
		return KanbanBoardWorkspaceEventResult{}, err
	}
	return KanbanBoardWorkspaceEventResult{Board: item, Events: []domain.DomainEvent{event}}, nil
}

func (r *MemoryRepo) DeleteKanbanBoardWithWorkspaceEvent(companyID, boardID string) (KanbanWorkspaceEventResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotKanbanWorkspaceEventStateLocked()
	if err := r.deleteKanbanBoardLocked(companyID, boardID); err != nil {
		r.restoreKanbanWorkspaceEventStateLocked(snapshot)
		return KanbanWorkspaceEventResult{}, err
	}
	event, err := r.appendDomainEventLocked(kanbanBoardDeletedWorkspaceEventInput(companyID, boardID))
	if err != nil {
		r.restoreKanbanWorkspaceEventStateLocked(snapshot)
		return KanbanWorkspaceEventResult{}, err
	}
	return KanbanWorkspaceEventResult{Events: []domain.DomainEvent{event}}, nil
}

func (r *MemoryRepo) CreateKanbanColumnWithWorkspaceEvent(companyID, boardID, title string, position int, widthPx int, heightPx int, itemColor string) (KanbanColumnWorkspaceEventResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotKanbanWorkspaceEventStateLocked()
	k := boardKey(companyID, boardID)
	r.ensureKanbanBoardLocked(companyID, boardID, boardID)
	if position <= 0 {
		position = nextKanbanColumnPosition(r.kanbanColumns[k])
	}
	now := time.Now().UTC()
	item := domain.KanbanColumn{
		CompanyID:        companyID,
		BoardID:          boardID,
		ColumnID:         newUUIDv7String(),
		Title:            title,
		Position:         position,
		WidthPx:          normalizeKanbanColumnWidth(widthPx),
		HeightPx:         normalizeKanbanColumnHeight(heightPx),
		ItemColor:        normalizeKanbanColumnItemColor(itemColor),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.kanbanColumns[k] = append(r.kanbanColumns[k], item)
	event, err := r.appendDomainEventLocked(kanbanColumnCreatedWorkspaceEventInput(item))
	if err != nil {
		r.restoreKanbanWorkspaceEventStateLocked(snapshot)
		return KanbanColumnWorkspaceEventResult{}, err
	}
	return KanbanColumnWorkspaceEventResult{Column: item, Events: []domain.DomainEvent{event}}, nil
}

func (r *MemoryRepo) UpdateKanbanColumnWithWorkspaceEvent(companyID, boardID, columnID, title string, position int, widthPx int, heightPx int, itemColor string) (KanbanColumnWorkspaceEventResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotKanbanWorkspaceEventStateLocked()
	k := boardKey(companyID, boardID)
	for index, column := range r.kanbanColumns[k] {
		if column.ColumnID != columnID {
			continue
		}
		if title != "" {
			column.Title = title
		}
		if position > 0 {
			column.Position = position
		}
		if widthPx > 0 {
			column.WidthPx = normalizeKanbanColumnWidth(widthPx)
		}
		if heightPx > 0 {
			column.HeightPx = normalizeKanbanColumnHeight(heightPx)
		}
		if strings.TrimSpace(itemColor) != "" {
			column.ItemColor = normalizeKanbanColumnItemColor(itemColor)
		}
		column.UpdatedTimestamp = time.Now().UTC()
		r.kanbanColumns[k][index] = column
		event, err := r.appendDomainEventLocked(kanbanColumnUpdatedWorkspaceEventInput(column))
		if err != nil {
			r.restoreKanbanWorkspaceEventStateLocked(snapshot)
			return KanbanColumnWorkspaceEventResult{}, err
		}
		return KanbanColumnWorkspaceEventResult{Column: column, Events: []domain.DomainEvent{event}}, nil
	}
	return KanbanColumnWorkspaceEventResult{}, ErrNotFound
}

func (r *MemoryRepo) DeleteKanbanColumnWithWorkspaceEvent(companyID, boardID, columnID string) (KanbanWorkspaceEventResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotKanbanWorkspaceEventStateLocked()
	k := boardKey(companyID, boardID)
	columns := r.kanbanColumns[k]
	found := false
	for _, column := range columns {
		if column.ColumnID == columnID {
			found = true
			break
		}
	}
	if !found {
		return KanbanWorkspaceEventResult{}, ErrNotFound
	}
	for _, card := range r.kanbanCards[k] {
		if card.ColumnID == columnID && card.LogicGateID != nil {
			return KanbanWorkspaceEventResult{}, ErrInvalid
		}
	}
	nextColumns := make([]domain.KanbanColumn, 0, len(columns))
	for _, column := range columns {
		if column.ColumnID != columnID {
			nextColumns = append(nextColumns, column)
		}
	}
	r.kanbanColumns[k] = nextColumns
	nextCards := make([]domain.KanbanCard, 0, len(r.kanbanCards[k]))
	for _, card := range r.kanbanCards[k] {
		if card.ColumnID != columnID {
			nextCards = append(nextCards, card)
		}
	}
	r.kanbanCards[k] = nextCards
	event, err := r.appendDomainEventLocked(kanbanColumnDeletedWorkspaceEventInput(companyID, boardID, columnID))
	if err != nil {
		r.restoreKanbanWorkspaceEventStateLocked(snapshot)
		return KanbanWorkspaceEventResult{}, err
	}
	return KanbanWorkspaceEventResult{Events: []domain.DomainEvent{event}}, nil
}

func (r *MemoryRepo) UpsertKanbanCardWithWorkspaceEvent(input KanbanCardMutationInput) (KanbanCardWorkspaceEventResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotKanbanWorkspaceEventStateLocked()
	card, err := r.upsertKanbanCardLocked(input)
	if err != nil {
		r.restoreKanbanWorkspaceEventStateLocked(snapshot)
		return KanbanCardWorkspaceEventResult{}, err
	}
	derivedNode := r.kanbanDerivedNodeLocked(card)
	events, err := r.appendDomainEventsLocked(kanbanCardMutationWorkspaceEventInputs("kanban_card_upserted", card, derivedNode, true))
	if err != nil {
		r.restoreKanbanWorkspaceEventStateLocked(snapshot)
		return KanbanCardWorkspaceEventResult{}, err
	}
	return KanbanCardWorkspaceEventResult{Card: card, DerivedNode: derivedNode, Events: events}, nil
}

func (r *MemoryRepo) MoveKanbanCardWithWorkspaceEvent(input KanbanCardMoveInput) (KanbanCardWorkspaceEventResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotKanbanWorkspaceEventStateLocked()
	if input.ColumnID != "" && !r.kanbanColumnExistsLocked(input.CompanyID, input.BoardID, input.ColumnID) {
		return KanbanCardWorkspaceEventResult{}, ErrNotFound
	}
	k := boardKey(input.CompanyID, input.BoardID)
	if input.ColumnID != "" && input.Position <= 0 {
		input.Position = nextKanbanCardPosition(r.kanbanCards[k], input.ColumnID)
	}
	for index, card := range r.kanbanCards[k] {
		if card.CardID != input.CardID {
			continue
		}
		now := time.Now().UTC()
		if input.ColumnID != "" {
			card.ColumnID = input.ColumnID
		}
		if node, ok := r.nodes[key(input.CompanyID, card.NodeID)]; ok && strings.TrimSpace(node.Title) != "" {
			card.NodeTitle = node.Title
		}
		if input.Position > 0 {
			card.Position = input.Position
		}
		if input.IsIssue != nil {
			card.IsIssue = *input.IsIssue
		}
		card.UpdatedTimestamp = now
		r.kanbanCards[k][index] = card
		if card.LogicGateID != nil {
			r.upsertNodeLogicGateAssignmentFromCardLocked(card)
		}
		r.syncNodeStatusFromKanbanCardLocked(card)
		derivedNode := r.kanbanDerivedNodeLocked(card)
		events, err := r.appendDomainEventsLocked(kanbanCardMutationWorkspaceEventInputs("kanban_card_moved", card, derivedNode, true))
		if err != nil {
			r.restoreKanbanWorkspaceEventStateLocked(snapshot)
			return KanbanCardWorkspaceEventResult{}, err
		}
		return KanbanCardWorkspaceEventResult{Card: card, DerivedNode: derivedNode, Events: events}, nil
	}
	return KanbanCardWorkspaceEventResult{}, ErrNotFound
}

func (r *MemoryRepo) DeleteKanbanCardWithWorkspaceEvent(companyID, boardID, cardID string) (KanbanCardWorkspaceEventResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotKanbanWorkspaceEventStateLocked()
	k := boardKey(companyID, boardID)
	cards := r.kanbanCards[k]
	next := make([]domain.KanbanCard, 0, len(cards))
	deleted := false
	var deletedCard domain.KanbanCard
	for _, card := range cards {
		if card.CardID == cardID {
			deleted = true
			deletedCard = card
			continue
		}
		next = append(next, card)
	}
	if !deleted {
		return KanbanCardWorkspaceEventResult{}, ErrNotFound
	}
	r.kanbanCards[k] = next
	if deletedCard.LogicGateID != nil {
		r.deleteNodeLogicGateAssignmentForCardLocked(deletedCard)
		r.applyNodeStatusAfterLogicGateAssignmentRemovalLocked(companyID, deletedCard.NodeID, nil, nil)
	}
	derivedNode := r.kanbanDerivedNodeLocked(deletedCard)
	events, err := r.appendDomainEventsLocked(kanbanCardMutationWorkspaceEventInputs("kanban_card_deleted", deletedCard, derivedNode, false))
	if err != nil {
		r.restoreKanbanWorkspaceEventStateLocked(snapshot)
		return KanbanCardWorkspaceEventResult{}, err
	}
	return KanbanCardWorkspaceEventResult{Card: deletedCard, DerivedNode: derivedNode, Events: events}, nil
}
