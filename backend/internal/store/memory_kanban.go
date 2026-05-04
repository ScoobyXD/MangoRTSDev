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
	for _, column := range r.kanbanColumns[boardKey(companyID, boardID)] {
		if column.ColumnID == columnID {
			return column.Title, true
		}
	}
	return "", false
}

func (r *MemoryRepo) ensureKanbanBoardLocked(companyID, boardID, title string) domain.KanbanBoard {
	k := boardKey(companyID, boardID)
	if board, ok := r.kanbanBoards[k]; ok {
		return board
	}
	now := time.Now().UTC()
	board := domain.KanbanBoard{
		CompanyID:        companyID,
		BoardID:          boardID,
		Title:            normalizeKanbanBoardTitle(boardID, title),
		Position:         nextKanbanBoardPosition(r.kanbanBoards, companyID),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.kanbanBoards[k] = board
	return board
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
		if strings.TrimSpace(title) != "" {
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
	if strings.TrimSpace(title) != "" {
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
	k := boardKey(companyID, boardID)
	if _, ok := r.kanbanBoards[k]; !ok {
		return ErrNotFound
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

func (r *MemoryRepo) UpsertKanbanCard(input KanbanCardMutationInput) (domain.KanbanCard, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.kanbanColumnExistsLocked(input.CompanyID, input.BoardID, input.ColumnID) {
		return domain.KanbanCard{}, ErrNotFound
	}
	if _, ok := r.nodes[key(input.CompanyID, input.NodeID)]; !ok {
		return domain.KanbanCard{}, ErrNotFound
	}
	k := boardKey(input.CompanyID, input.BoardID)
	r.ensureKanbanBoardLocked(input.CompanyID, input.BoardID, input.BoardID)
	if input.Position <= 0 {
		input.Position = nextKanbanCardPosition(r.kanbanCards[k], input.ColumnID)
	}
	now := time.Now().UTC()
	nodeTitle := r.nodes[key(input.CompanyID, input.NodeID)].Title
	if strings.TrimSpace(nodeTitle) == "" {
		nodeTitle = normalizeKanbanBoardTitle(input.NodeID, input.NodeTitle)
	}
	description := strings.TrimSpace(input.DescriptionSnapshot)
	for index, card := range r.kanbanCards[k] {
		if card.NodeID != input.NodeID {
			continue
		}
		// A drop is a command, not append-only history. Moving the existing card keeps
		// repeated UI drops and retrying agents idempotent.
		card.ColumnID = input.ColumnID
		card.NodeTitle = nodeTitle
		card.Position = input.Position
		if description != "" || card.DescriptionSnapshot == "" {
			card.DescriptionSnapshot = description
		}
		card.UpdatedTimestamp = now
		r.kanbanCards[k][index] = card
		return card, nil
	}
	card := domain.KanbanCard{
		CompanyID:           input.CompanyID,
		BoardID:             input.BoardID,
		CardID:              newUUIDv7String(),
		ColumnID:            input.ColumnID,
		NodeID:              input.NodeID,
		NodeTitle:           nodeTitle,
		DescriptionSnapshot: description,
		Position:            input.Position,
		CreatedTimestamp:    now,
		UpdatedTimestamp:    now,
	}
	r.kanbanCards[k] = append(r.kanbanCards[k], card)
	return card, nil
}

func (r *MemoryRepo) MoveKanbanCard(input KanbanCardMoveInput) (domain.KanbanCard, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.kanbanColumnExistsLocked(input.CompanyID, input.BoardID, input.ColumnID) {
		return domain.KanbanCard{}, ErrNotFound
	}
	k := boardKey(input.CompanyID, input.BoardID)
	if input.Position <= 0 {
		input.Position = nextKanbanCardPosition(r.kanbanCards[k], input.ColumnID)
	}
	for index, card := range r.kanbanCards[k] {
		if card.CardID != input.CardID {
			continue
		}
		now := time.Now().UTC()
		card.ColumnID = input.ColumnID
		if node, ok := r.nodes[key(input.CompanyID, card.NodeID)]; ok && strings.TrimSpace(node.Title) != "" {
			card.NodeTitle = node.Title
		}
		card.Position = input.Position
		card.UpdatedTimestamp = now
		r.kanbanCards[k][index] = card
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
	for _, card := range cards {
		if card.CardID == cardID {
			deleted = true
			continue
		}
		next = append(next, card)
	}
	if !deleted {
		return ErrNotFound
	}
	r.kanbanCards[k] = next
	return nil
}
