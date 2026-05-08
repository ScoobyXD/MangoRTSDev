package store

import (
	"miraeopus/backend/internal/domain"
	"sync"
)

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
	defaultFolderSeed map[string]bool
	nodeMapPositions  map[string]domain.NodeMapPosition
	logicMapPositions map[string]domain.LogicGateMapPosition
	operations        map[string]domain.Operation
	kanbanBoards      map[string]domain.KanbanBoard
	kanbanColumns     map[string][]domain.KanbanColumn
	kanbanCards       map[string][]domain.KanbanCard
	users             map[string]domain.User
	companies         map[string]domain.Company
	memberships       map[string]domain.CompanyMembership
	invitations       map[string]domain.Invitation
	emailConnections  map[string]domain.UserEmailConnection
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
		defaultFolderSeed: map[string]bool{},
		nodeMapPositions:  map[string]domain.NodeMapPosition{},
		logicMapPositions: map[string]domain.LogicGateMapPosition{},
		operations:        map[string]domain.Operation{},
		kanbanBoards:      map[string]domain.KanbanBoard{},
		kanbanColumns:     map[string][]domain.KanbanColumn{},
		kanbanCards:       map[string][]domain.KanbanCard{},
		users:             map[string]domain.User{},
		companies:         map[string]domain.Company{},
		memberships:       map[string]domain.CompanyMembership{},
		invitations:       map[string]domain.Invitation{},
		emailConnections:  map[string]domain.UserEmailConnection{},
	}
}

func key(companyID, id string) string {
	return companyID + ":" + id
}

func folderItemKey(companyID, itemType, itemID string) string {
	return companyID + ":" + itemType + ":" + itemID
}

func boardKey(companyID, boardID string) string {
	return companyID + ":" + boardID
}

func membershipKey(companyID, userID string) string {
	return companyID + ":" + userID
}
