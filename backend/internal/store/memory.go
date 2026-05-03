package store

import (
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"miraeopus/backend/internal/domain"
)

var (
	ErrNotFound = errors.New("not found")
	ErrInvalid  = errors.New("invalid")
)

type Repository interface {
	CreateNode(companyID, title string) (domain.Node, error)
	UpdateNodeTitle(companyID, nodeID, title string) (domain.Node, error)
	ListNodes(companyID string) ([]domain.Node, error)
	ListNodeRelationships(companyID string) ([]domain.NodeRelationship, error)
	DeleteNodeRelationship(companyID, relationshipID string) error
	GetNode(companyID, nodeID string) (domain.Node, error)
	DeleteNode(companyID, nodeID string) error
	GetNodeDetails(companyID, nodeID string) (domain.NodeDetails, error)
	AddNodeInformation(companyID, nodeID, infoType, information, informationID string) (domain.NodeInformation, error)
	ListNodeProjections(companyID, nodeID string) ([]domain.NodeProjection, error)
	DeleteNodeProjection(companyID, nodeID, informationID string) error
	CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error)
	CreateLogicGate(companyID, header string) (domain.LogicGate, error)
	UpdateLogicGateHeader(companyID, logicGateID, header string) (domain.LogicGate, error)
	ListLogicGates(companyID string) ([]domain.LogicGate, error)
	ListLogicGateRelationships(companyID string) ([]domain.LogicGateRelationship, error)
	DeleteLogicGateRelationship(companyID, relationshipID string) error
	GetLogicGate(companyID, logicGateID string) (domain.LogicGate, error)
	DeleteLogicGate(companyID, logicGateID string) error
	GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error)
	AddLogicGateInformation(companyID, logicGateID, infoType, information, informationID string) (domain.LogicGateInformation, error)
	ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error)
	DeleteLogicGateProjection(companyID, logicGateID, informationID string) error
	CreateLogicGateRelationship(companyID, logicGateIDA, logicGateIDB, aPosition, bPosition string) (domain.LogicGateRelationship, error)
	CreateCompanyExplorerFolder(companyID, parentFolderID, folderKind, name string) (domain.CompanyExplorerFolder, error)
	ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error)
	MoveCompanyExplorerFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error)
	RenameCompanyExplorerFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error)
	DeleteCompanyExplorerFolder(companyID, folderID string) error
	AssignCompanyExplorerFolderItem(companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, error)
	ListCompanyExplorerFolderItems(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error)
	RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error
	ListNodeMapPositions(companyID string) ([]domain.NodeMapPosition, error)
	UpsertNodeMapPositions(companyID string, positions []domain.NodeMapPosition) ([]domain.NodeMapPosition, error)
	ListLogicGateMapPositions(companyID string) ([]domain.LogicGateMapPosition, error)
	UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error)
	CreateOperation(in CreateOperationInput) (domain.Operation, error)
	GetOperation(companyID, operationID string) (domain.Operation, error)
	ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error)
	CreateKanbanColumn(companyID, boardID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error)
	UpdateKanbanColumn(companyID, boardID, columnID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error)
	DeleteKanbanColumn(companyID, boardID, columnID string) error
	ListKanbanCards(companyID, boardID string, query KanbanCardQuery) ([]domain.KanbanCard, error)
	UpsertKanbanCard(input KanbanCardMutationInput) (domain.KanbanCard, error)
	MoveKanbanCard(input KanbanCardMoveInput) (domain.KanbanCard, error)
	DeleteKanbanCard(companyID, boardID, cardID string) error
}

type CreateOperationInput struct {
	CompanyID      string
	NodeID         *string
	LogicGateID    *string
	Status         string
	StartTimestamp time.Time
	EndTimestamp   *time.Time
}

type MemoryRepo struct {
	mu                sync.RWMutex
	nodes             map[string]domain.Node
	nodeInfo          map[string][]domain.NodeInformation
	nodeText          map[string]map[string]domain.NodeProjection
	nodeRels          map[string][]domain.NodeRelationship
	logicGates        map[string]domain.LogicGate
	logicGateInfo     map[string][]domain.LogicGateInformation
	logicGateText     map[string]map[string]domain.LogicGateProjection
	logicGateRels     map[string][]domain.LogicGateRelationship
	folders           map[string]domain.CompanyExplorerFolder
	folderItems       map[string]domain.CompanyExplorerFolderItem
	nodeMapPositions  map[string]domain.NodeMapPosition
	logicMapPositions map[string]domain.LogicGateMapPosition
	operations        map[string]domain.Operation
	kanbanColumns     map[string][]domain.KanbanColumn
	kanbanCards       map[string][]domain.KanbanCard
}

func NewMemoryRepo() *MemoryRepo {
	return &MemoryRepo{
		nodes:             map[string]domain.Node{},
		nodeInfo:          map[string][]domain.NodeInformation{},
		nodeText:          map[string]map[string]domain.NodeProjection{},
		nodeRels:          map[string][]domain.NodeRelationship{},
		logicGates:        map[string]domain.LogicGate{},
		logicGateInfo:     map[string][]domain.LogicGateInformation{},
		logicGateText:     map[string]map[string]domain.LogicGateProjection{},
		logicGateRels:     map[string][]domain.LogicGateRelationship{},
		folders:           map[string]domain.CompanyExplorerFolder{},
		folderItems:       map[string]domain.CompanyExplorerFolderItem{},
		nodeMapPositions:  map[string]domain.NodeMapPosition{},
		logicMapPositions: map[string]domain.LogicGateMapPosition{},
		operations:        map[string]domain.Operation{},
		kanbanColumns:     map[string][]domain.KanbanColumn{},
		kanbanCards:       map[string][]domain.KanbanCard{},
	}
}

func key(companyID, id string) string {
	return companyID + ":" + id
}

func folderItemKey(companyID, itemType, itemID string) string {
	return companyID + ":" + itemType + ":" + itemID
}

func (r *MemoryRepo) CreateNode(companyID, title string) (domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	n := domain.Node{
		CompanyID:        companyID,
		NodeID:           newUUIDv7String(),
		Title:            title,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.nodes[key(companyID, n.NodeID)] = n
	return n, nil
}

func (r *MemoryRepo) UpdateNodeTitle(companyID, nodeID, title string) (domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := companyID + ":" + nodeID
	node, ok := r.nodes[key]
	if !ok {
		return domain.Node{}, ErrNotFound
	}
	node.Title = title
	r.nodes[key] = node
	return node, nil
}

func (r *MemoryRepo) ListNodes(companyID string) ([]domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Node, 0)
	for _, node := range r.nodes {
		if node.CompanyID == companyID {
			items = append(items, node)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) GetNode(companyID, nodeID string) (domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	n, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return domain.Node{}, ErrNotFound
	}
	return n, nil
}

func (r *MemoryRepo) ListNodeRelationships(companyID string) ([]domain.NodeRelationship, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := append([]domain.NodeRelationship{}, r.nodeRels[companyID]...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) DeleteNode(companyID, nodeID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	k := key(companyID, nodeID)
	if _, ok := r.nodes[k]; !ok {
		return ErrNotFound
	}

	delete(r.nodes, k)
	delete(r.nodeInfo, k)
	delete(r.nodeText, k)
	delete(r.folderItems, folderItemKey(companyID, "node", nodeID))
	delete(r.nodeMapPositions, k)
	for board, cards := range r.kanbanCards {
		next := make([]domain.KanbanCard, 0, len(cards))
		for _, card := range cards {
			if card.CompanyID == companyID && card.NodeID == nodeID {
				continue
			}
			next = append(next, card)
		}
		r.kanbanCards[board] = next
	}
	for operationKey, operation := range r.operations {
		if operation.CompanyID != companyID || operation.NodeID == nil || *operation.NodeID != nodeID {
			continue
		}
		// Preserve operation history while releasing the FK-shaped in-memory pointer.
		operation.NodeID = nil
		r.operations[operationKey] = operation
	}

	filtered := make([]domain.NodeRelationship, 0, len(r.nodeRels[companyID]))
	for _, rel := range r.nodeRels[companyID] {
		if rel.NodeIDA == nodeID || rel.NodeIDB == nodeID {
			continue
		}
		filtered = append(filtered, rel)
	}
	r.nodeRels[companyID] = filtered
	return nil
}

func (r *MemoryRepo) ListNodeMapPositions(companyID string) ([]domain.NodeMapPosition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.NodeMapPosition, 0)
	for _, item := range r.nodeMapPositions {
		if item.CompanyID == companyID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].NodeID < items[j].NodeID
	})
	return items, nil
}

func (r *MemoryRepo) UpsertNodeMapPositions(companyID string, positions []domain.NodeMapPosition) ([]domain.NodeMapPosition, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	out := make([]domain.NodeMapPosition, 0, len(positions))
	for _, position := range positions {
		if _, ok := r.nodes[key(companyID, position.NodeID)]; !ok {
			return nil, ErrNotFound
		}
		item := domain.NodeMapPosition{
			CompanyID:        companyID,
			NodeID:           position.NodeID,
			X:                position.X,
			Y:                position.Y,
			UpdatedTimestamp: now,
		}
		r.nodeMapPositions[key(companyID, item.NodeID)] = item
		out = append(out, item)
	}
	return out, nil
}

func (r *MemoryRepo) AddNodeInformation(companyID, nodeID, infoType, information, informationID string) (domain.NodeInformation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return domain.NodeInformation{}, ErrNotFound
	}
	now := time.Now().UTC()
	item := domain.NodeInformation{
		CompanyID:        companyID,
		InformationID:    newUUIDv7String(),
		NodeID:           nodeID,
		Type:             infoType,
		Information:      information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	k := key(companyID, nodeID)
	r.nodeInfo[k] = append(r.nodeInfo[k], item)
	sort.Slice(r.nodeInfo[k], func(i, j int) bool {
		return r.nodeInfo[k][i].CreatedTimestamp.Before(r.nodeInfo[k][j].CreatedTimestamp)
	})
	keyValue := informationID
	if keyValue == "" {
		keyValue = item.InformationID
	}
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	existing, ok := r.nodeText[k][keyValue]
	created := item.CreatedTimestamp
	if ok {
		created = existing.CreatedTimestamp
	}
	r.nodeText[k][keyValue] = domain.NodeProjection{
		CompanyID:        companyID,
		NodeID:           nodeID,
		Type:             infoType,
		Information:      information,
		InformationID:    keyValue,
		CreatedTimestamp: created,
		UpdatedTimestamp: item.UpdatedTimestamp,
	}
	return item, nil
}

func (r *MemoryRepo) ListNodeProjections(companyID, nodeID string) ([]domain.NodeProjection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return nil, ErrNotFound
	}
	items := make([]domain.NodeProjection, 0)
	for _, item := range r.nodeText[key(companyID, nodeID)] {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedTimestamp.Before(items[j].UpdatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) DeleteNodeProjection(companyID, nodeID, informationID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return ErrNotFound
	}
	delete(r.nodeText[key(companyID, nodeID)], informationID)
	return nil
}

func (r *MemoryRepo) CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.nodes[key(companyID, nodeIDA)]; !ok {
		return domain.NodeRelationship{}, ErrNotFound
	}
	if _, ok := r.nodes[key(companyID, nodeIDB)]; !ok {
		return domain.NodeRelationship{}, ErrNotFound
	}

	item := domain.NodeRelationship{
		CompanyID:          companyID,
		NodeRelationshipID: newUUIDv7String(),
		NodeIDA:            nodeIDA,
		NodeIDB:            nodeIDB,
		APosition:          aPosition,
		BPosition:          bPosition,
		CreatedTimestamp:   time.Now().UTC(),
	}
	r.nodeRels[companyID] = append(r.nodeRels[companyID], item)
	return item, nil
}

func (r *MemoryRepo) DeleteNodeRelationship(companyID, relationshipID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	items := r.nodeRels[companyID]
	filtered := make([]domain.NodeRelationship, 0, len(items))
	deleted := false
	for _, item := range items {
		if item.NodeRelationshipID == relationshipID {
			deleted = true
			continue
		}
		filtered = append(filtered, item)
	}
	if !deleted {
		return ErrNotFound
	}
	r.nodeRels[companyID] = filtered
	return nil
}

func boardKey(companyID, boardID string) string {
	return companyID + ":" + boardID
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

func nextKanbanColumnPosition(columns []domain.KanbanColumn) int {
	next := 1000
	for _, column := range columns {
		if column.Position >= next {
			next = column.Position + 1000
		}
	}
	return next
}

func normalizeKanbanColumnWidth(widthPx int) int {
	if widthPx <= 0 {
		return 260
	}
	if widthPx < 180 {
		return 180
	}
	if widthPx > 520 {
		return 520
	}
	return widthPx
}

func normalizeKanbanColumnHeight(heightPx int) int {
	if heightPx <= 0 {
		return 240
	}
	if heightPx < 160 {
		return 160
	}
	if heightPx > 720 {
		return 720
	}
	return heightPx
}

func normalizeKanbanColumnItemColor(itemColor string) string {
	itemColor = strings.TrimSpace(itemColor)
	if len(itemColor) != 7 || itemColor[0] != '#' {
		return "#2f7d62"
	}
	for _, char := range itemColor[1:] {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F') {
			continue
		}
		return "#2f7d62"
	}
	return itemColor
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

func companyExplorerParentID(folder domain.CompanyExplorerFolder) string {
	if folder.ParentFolderID == nil {
		return ""
	}
	return *folder.ParentFolderID
}

func nextCompanyExplorerFolderPosition(folders map[string]domain.CompanyExplorerFolder, companyID, folderKind, parentFolderID string) int {
	next := 1000
	for _, folder := range folders {
		if folder.CompanyID != companyID || folder.FolderKind != folderKind || companyExplorerParentID(folder) != parentFolderID {
			continue
		}
		if folder.Position >= next {
			next = folder.Position + 1000
		}
	}
	return next
}

func nextCompanyExplorerFolderItemPosition(items map[string]domain.CompanyExplorerFolderItem, companyID, folderID, itemType string) int {
	next := 1000
	for _, item := range items {
		if item.CompanyID != companyID || item.FolderID != folderID || item.ItemType != itemType {
			continue
		}
		if item.Position >= next {
			next = item.Position + 1000
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
	if input.Position <= 0 {
		input.Position = nextKanbanCardPosition(r.kanbanCards[k], input.ColumnID)
	}
	now := time.Now().UTC()
	nodeTitle := strings.TrimSpace(input.NodeTitle)
	if nodeTitle == "" {
		nodeTitle = input.NodeID
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

func (r *MemoryRepo) GetNodeDetails(companyID, nodeID string) (domain.NodeDetails, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	node, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return domain.NodeDetails{}, ErrNotFound
	}

	info := append([]domain.NodeInformation{}, r.nodeInfo[key(companyID, nodeID)]...)
	sort.Slice(info, func(i, j int) bool {
		return info[i].CreatedTimestamp.Before(info[j].CreatedTimestamp)
	})

	relationships := make([]domain.NodeRelationship, 0)
	for _, rel := range r.nodeRels[companyID] {
		if rel.NodeIDA == nodeID || rel.NodeIDB == nodeID {
			relationships = append(relationships, rel)
		}
	}
	sort.Slice(relationships, func(i, j int) bool {
		return relationships[i].CreatedTimestamp.Before(relationships[j].CreatedTimestamp)
	})

	return domain.NodeDetails{
		Node:          node,
		Information:   info,
		Relationships: relationships,
	}, nil
}

func (r *MemoryRepo) CreateLogicGate(companyID, header string) (domain.LogicGate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	item := domain.LogicGate{
		CompanyID:        companyID,
		LogicGateID:      newUUIDv7String(),
		Header:           header,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.logicGates[key(companyID, item.LogicGateID)] = item
	return item, nil
}

func (r *MemoryRepo) UpdateLogicGateHeader(companyID, logicGateID, header string) (domain.LogicGate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(companyID, logicGateID)
	item, ok := r.logicGates[k]
	if !ok {
		return domain.LogicGate{}, ErrNotFound
	}
	item.Header = header
	r.logicGates[k] = item
	return item, nil
}

func (r *MemoryRepo) ListLogicGates(companyID string) ([]domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID == companyID {
			items = append(items, gate)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) GetLogicGate(companyID, logicGateID string) (domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return domain.LogicGate{}, ErrNotFound
	}
	return item, nil
}

func (r *MemoryRepo) DeleteLogicGate(companyID, logicGateID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	k := key(companyID, logicGateID)
	if _, ok := r.logicGates[k]; !ok {
		return ErrNotFound
	}
	delete(r.logicGates, k)
	delete(r.logicGateInfo, k)
	delete(r.logicGateText, k)
	delete(r.folderItems, folderItemKey(companyID, "logic_gate", logicGateID))
	delete(r.logicMapPositions, k)
	for operationKey, operation := range r.operations {
		if operation.CompanyID != companyID || operation.LogicGateID == nil || *operation.LogicGateID != logicGateID {
			continue
		}
		operation.LogicGateID = nil
		r.operations[operationKey] = operation
	}

	filtered := make([]domain.LogicGateRelationship, 0, len(r.logicGateRels[companyID]))
	for _, rel := range r.logicGateRels[companyID] {
		if rel.LogicGateIDA == logicGateID || rel.LogicGateIDB == logicGateID {
			continue
		}
		filtered = append(filtered, rel)
	}
	r.logicGateRels[companyID] = filtered
	return nil
}

func (r *MemoryRepo) ListLogicGateMapPositions(companyID string) ([]domain.LogicGateMapPosition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.LogicGateMapPosition, 0)
	for _, item := range r.logicMapPositions {
		if item.CompanyID == companyID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].LogicGateID < items[j].LogicGateID
	})
	return items, nil
}

func (r *MemoryRepo) UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	out := make([]domain.LogicGateMapPosition, 0, len(positions))
	for _, position := range positions {
		if _, ok := r.logicGates[key(companyID, position.LogicGateID)]; !ok {
			return nil, ErrNotFound
		}
		item := domain.LogicGateMapPosition{
			CompanyID:        companyID,
			LogicGateID:      position.LogicGateID,
			X:                position.X,
			Y:                position.Y,
			UpdatedTimestamp: now,
		}
		r.logicMapPositions[key(companyID, item.LogicGateID)] = item
		out = append(out, item)
	}
	return out, nil
}

func (r *MemoryRepo) ListLogicGateRelationships(companyID string) ([]domain.LogicGateRelationship, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := append([]domain.LogicGateRelationship{}, r.logicGateRels[companyID]...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) CreateLogicGateRelationship(companyID, logicGateIDA, logicGateIDB, aPosition, bPosition string) (domain.LogicGateRelationship, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateIDA)]; !ok {
		return domain.LogicGateRelationship{}, ErrNotFound
	}
	if _, ok := r.logicGates[key(companyID, logicGateIDB)]; !ok {
		return domain.LogicGateRelationship{}, ErrNotFound
	}

	item := domain.LogicGateRelationship{
		CompanyID:               companyID,
		LogicGateRelationshipID: newUUIDv7String(),
		LogicGateIDA:            logicGateIDA,
		LogicGateIDB:            logicGateIDB,
		APosition:               aPosition,
		BPosition:               bPosition,
		CreatedTimestamp:        time.Now().UTC(),
	}
	r.logicGateRels[companyID] = append(r.logicGateRels[companyID], item)
	return item, nil
}

func (r *MemoryRepo) DeleteLogicGateRelationship(companyID, relationshipID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	items := r.logicGateRels[companyID]
	filtered := make([]domain.LogicGateRelationship, 0, len(items))
	deleted := false
	for _, item := range items {
		if item.LogicGateRelationshipID == relationshipID {
			deleted = true
			continue
		}
		filtered = append(filtered, item)
	}
	if !deleted {
		return ErrNotFound
	}
	r.logicGateRels[companyID] = filtered
	return nil
}

func (r *MemoryRepo) AddLogicGateInformation(companyID, logicGateID, infoType, information, informationID string) (domain.LogicGateInformation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return domain.LogicGateInformation{}, ErrNotFound
	}
	now := time.Now().UTC()
	item := domain.LogicGateInformation{
		CompanyID:        companyID,
		InformationID:    newUUIDv7String(),
		LogicGateID:      logicGateID,
		Type:             infoType,
		Information:      information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	k := key(companyID, logicGateID)
	r.logicGateInfo[k] = append(r.logicGateInfo[k], item)
	sort.Slice(r.logicGateInfo[k], func(i, j int) bool {
		return r.logicGateInfo[k][i].CreatedTimestamp.Before(r.logicGateInfo[k][j].CreatedTimestamp)
	})

	// Keep one latest-value row per stable information_id while preserving every
	// save above as history. Clients/agents should reuse information_id for edits.
	projectionID := informationID
	if projectionID == "" {
		projectionID = item.InformationID
	}
	if r.logicGateText[k] == nil {
		r.logicGateText[k] = map[string]domain.LogicGateProjection{}
	}
	created := item.CreatedTimestamp
	if existing, ok := r.logicGateText[k][projectionID]; ok {
		created = existing.CreatedTimestamp
	}
	r.logicGateText[k][projectionID] = domain.LogicGateProjection{
		CompanyID:        companyID,
		LogicGateID:      logicGateID,
		Type:             infoType,
		Information:      information,
		InformationID:    projectionID,
		CreatedTimestamp: created,
		UpdatedTimestamp: item.UpdatedTimestamp,
	}
	return item, nil
}

func (r *MemoryRepo) ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return nil, ErrNotFound
	}
	items := make([]domain.LogicGateProjection, 0)
	for _, item := range r.logicGateText[key(companyID, logicGateID)] {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedTimestamp.Before(items[j].UpdatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) DeleteLogicGateProjection(companyID, logicGateID, informationID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return ErrNotFound
	}
	delete(r.logicGateText[key(companyID, logicGateID)], informationID)
	return nil
}

func (r *MemoryRepo) GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	logicGate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return domain.LogicGateDetails{}, ErrNotFound
	}

	info := append([]domain.LogicGateInformation{}, r.logicGateInfo[key(companyID, logicGateID)]...)
	sort.Slice(info, func(i, j int) bool {
		return info[i].CreatedTimestamp.Before(info[j].CreatedTimestamp)
	})

	relationships := make([]domain.LogicGateRelationship, 0)
	for _, rel := range r.logicGateRels[companyID] {
		if rel.LogicGateIDA == logicGateID || rel.LogicGateIDB == logicGateID {
			relationships = append(relationships, rel)
		}
	}
	sort.Slice(relationships, func(i, j int) bool {
		return relationships[i].CreatedTimestamp.Before(relationships[j].CreatedTimestamp)
	})

	return domain.LogicGateDetails{
		LogicGate:     logicGate,
		Information:   info,
		Relationships: relationships,
	}, nil
}

func (r *MemoryRepo) CreateCompanyExplorerFolder(companyID, parentFolderID, folderKind, name string) (domain.CompanyExplorerFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	var parent *string
	if parentFolderID != "" {
		parentFolder, ok := r.folders[key(companyID, parentFolderID)]
		if !ok || parentFolder.FolderKind != folderKind {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		parentValue := parentFolderID
		parent = &parentValue
	}

	now := time.Now().UTC()
	item := domain.CompanyExplorerFolder{
		CompanyID:        companyID,
		FolderID:         newUUIDv7String(),
		ParentFolderID:   parent,
		FolderKind:       folderKind,
		Name:             name,
		Position:         nextCompanyExplorerFolderPosition(r.folders, companyID, folderKind, parentFolderID),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.folders[key(companyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyExplorerFolder, 0)
	for _, folder := range r.folders {
		if folder.CompanyID != companyID {
			continue
		}
		if folderKind != "" && folder.FolderKind != folderKind {
			continue
		}
		items = append(items, folder)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].Position < items[j].Position
	})
	return items, nil
}

func (r *MemoryRepo) MoveCompanyExplorerFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	parent := item.ParentFolderID
	targetParentID := companyExplorerParentID(item)
	parentChanged := false
	if parentFolderID != nil {
		targetParentID = strings.TrimSpace(*parentFolderID)
		if targetParentID == folderID {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parentChanged = targetParentID != companyExplorerParentID(item)
		parent = nil
	}
	if parentFolderID != nil && targetParentID != "" {
		parentFolder, ok := r.folders[key(companyID, targetParentID)]
		if !ok || parentFolder.FolderKind != item.FolderKind {
			return domain.CompanyExplorerFolder{}, ErrNotFound
		}
		// A folder cannot be moved under one of its descendants; that would
		// create a cycle and make folder-scope queries loop forever.
		toCheck := map[string]bool{folderID: true}
		changed := true
		for changed {
			changed = false
			for _, folder := range r.folders {
				if folder.CompanyID != companyID || folder.ParentFolderID == nil {
					continue
				}
				if toCheck[*folder.ParentFolderID] && !toCheck[folder.FolderID] {
					toCheck[folder.FolderID] = true
					changed = true
				}
			}
		}
		if toCheck[targetParentID] {
			return domain.CompanyExplorerFolder{}, ErrInvalid
		}
		parentValue := targetParentID
		parent = &parentValue
	}
	if position <= 0 {
		if parentChanged {
			position = nextCompanyExplorerFolderPosition(r.folders, companyID, item.FolderKind, targetParentID)
		} else {
			position = item.Position
		}
	}

	item.ParentFolderID = parent
	item.Position = position
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) RenameCompanyExplorerFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.folders[key(companyID, folderID)]
	if !ok {
		return domain.CompanyExplorerFolder{}, ErrNotFound
	}
	item.Name = name
	item.UpdatedTimestamp = time.Now().UTC()
	r.folders[key(companyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) DeleteCompanyExplorerFolder(companyID, folderID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.folders[key(companyID, folderID)]; !ok {
		return ErrNotFound
	}

	// Delete the selected folder and every descendant. This matches file-explorer
	// folder semantics while keeping item delete independent from node/gate delete.
	toDelete := map[string]bool{folderID: true}
	changed := true
	for changed {
		changed = false
		for _, folder := range r.folders {
			if folder.CompanyID != companyID || folder.ParentFolderID == nil {
				continue
			}
			if toDelete[*folder.ParentFolderID] && !toDelete[folder.FolderID] {
				toDelete[folder.FolderID] = true
				changed = true
			}
		}
	}

	for id := range toDelete {
		delete(r.folders, key(companyID, id))
	}
	for k, item := range r.folderItems {
		if item.CompanyID == companyID && toDelete[item.FolderID] {
			delete(r.folderItems, k)
		}
	}
	return nil
}

func (r *MemoryRepo) AssignCompanyExplorerFolderItem(companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	folder, ok := r.folders[key(companyID, folderID)]
	if !ok || folder.FolderKind != itemType {
		return domain.CompanyExplorerFolderItem{}, ErrNotFound
	}
	if itemType == "node" {
		if _, ok := r.nodes[key(companyID, itemID)]; !ok {
			return domain.CompanyExplorerFolderItem{}, ErrNotFound
		}
	} else if itemType == "logic_gate" {
		if _, ok := r.logicGates[key(companyID, itemID)]; !ok {
			return domain.CompanyExplorerFolderItem{}, ErrNotFound
		}
	} else {
		return domain.CompanyExplorerFolderItem{}, ErrNotFound
	}

	now := time.Now().UTC()
	k := folderItemKey(companyID, itemType, itemID)
	created := now
	if existing, ok := r.folderItems[k]; ok {
		created = existing.CreatedTimestamp
		if position <= 0 && existing.FolderID == folderID {
			position = existing.Position
		}
	}
	if position <= 0 {
		position = nextCompanyExplorerFolderItemPosition(r.folderItems, companyID, folderID, itemType)
	}
	item := domain.CompanyExplorerFolderItem{
		CompanyID:        companyID,
		FolderID:         folderID,
		ItemType:         itemType,
		ItemID:           itemID,
		Position:         position,
		CreatedTimestamp: created,
		UpdatedTimestamp: now,
	}
	r.folderItems[k] = item
	return item, nil
}

func (r *MemoryRepo) ListCompanyExplorerFolderItems(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyExplorerFolderItem, 0)
	for _, item := range r.folderItems {
		if item.CompanyID != companyID {
			continue
		}
		if folderID != "" && item.FolderID != folderID {
			continue
		}
		if itemType != "" && item.ItemType != itemType {
			continue
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position == items[j].Position {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].Position < items[j].Position
	})
	return items, nil
}

func (r *MemoryRepo) RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	k := folderItemKey(companyID, itemType, itemID)
	if _, ok := r.folderItems[k]; !ok {
		return ErrNotFound
	}
	delete(r.folderItems, k)
	return nil
}

func (r *MemoryRepo) CreateOperation(in CreateOperationInput) (domain.Operation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if in.NodeID != nil {
		if _, ok := r.nodes[key(in.CompanyID, *in.NodeID)]; !ok {
			return domain.Operation{}, ErrNotFound
		}
	}
	if in.LogicGateID != nil {
		if _, ok := r.logicGates[key(in.CompanyID, *in.LogicGateID)]; !ok {
			return domain.Operation{}, ErrNotFound
		}
	}

	item := domain.Operation{
		CompanyID:      in.CompanyID,
		OperationID:    newUUIDv7String(),
		NodeID:         in.NodeID,
		LogicGateID:    in.LogicGateID,
		Status:         in.Status,
		StartTimestamp: in.StartTimestamp,
		EndTimestamp:   in.EndTimestamp,
	}
	r.operations[key(in.CompanyID, item.OperationID)] = item
	return item, nil
}

func (r *MemoryRepo) GetOperation(companyID, operationID string) (domain.Operation, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	item, ok := r.operations[key(companyID, operationID)]
	if !ok {
		return domain.Operation{}, ErrNotFound
	}
	return item, nil
}
