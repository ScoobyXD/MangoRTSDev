package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
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
	AssignCompanyExplorerFolderItem(companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, []string, error)
	ListCompanyExplorerFolderItems(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error)
	RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error
	ListNodeMapPositions(companyID string) ([]domain.NodeMapPosition, error)
	UpsertNodeMapPositions(companyID string, positions []domain.NodeMapPosition) ([]domain.NodeMapPosition, error)
	ListLogicGateMapPositions(companyID string) ([]domain.LogicGateMapPosition, error)
	UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error)
	CreateOperation(in CreateOperationInput) (domain.Operation, error)
	GetOperation(companyID, operationID string) (domain.Operation, error)
	ListKanbanBoards(companyID string, query KanbanBoardQuery) ([]domain.KanbanBoard, error)
	CreateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error)
	UpdateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error)
	DeleteKanbanBoard(companyID, boardID string) error
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

const KanbanMaxCardsLimit = 500

const KanbanMaxBoardsLimit = 200

type KanbanBoardQuery struct {
	AfterPosition int
	Limit         int
}

type KanbanCardQuery struct {
	ColumnID      string
	AfterPosition int
	Limit         int
}

type KanbanCardMutationInput struct {
	CompanyID           string
	BoardID             string
	ColumnID            string
	NodeID              string
	NodeTitle           string
	DescriptionSnapshot string
	Position            int
}

type KanbanCardMoveInput struct {
	CompanyID string
	BoardID   string
	CardID    string
	ColumnID  string
	Position  int
}

func NormalizeKanbanBoardQuery(query KanbanBoardQuery) KanbanBoardQuery {
	if query.AfterPosition < 0 {
		query.AfterPosition = 0
	}
	if query.Limit <= 0 || query.Limit > KanbanMaxBoardsLimit {
		query.Limit = 100
	}
	return query
}

func NormalizeKanbanCardQuery(query KanbanCardQuery) KanbanCardQuery {
	query.ColumnID = strings.TrimSpace(query.ColumnID)
	if query.AfterPosition < 0 {
		query.AfterPosition = 0
	}
	if query.Limit <= 0 || query.Limit > KanbanMaxCardsLimit {
		query.Limit = 200
	}
	return query
}

func isEditorTextBoxType(infoType string) bool {
	return infoType == "Text box"
}

func normalizeKanbanBoardTitle(boardID, title string) string {
	title = strings.TrimSpace(title)
	if title != "" {
		return title
	}
	boardID = strings.TrimSpace(boardID)
	if boardID != "" {
		return boardID
	}
	return "Kanban board"
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
