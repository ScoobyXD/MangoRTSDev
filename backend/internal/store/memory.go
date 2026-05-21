package store

import (
	"miraeopus/backend/internal/domain"
	"sync"
)

type MemoryRepo struct {
	mu                       sync.RWMutex
	nodes                    map[string]domain.Node
	nodeInfo                 map[string][]domain.NodeInformation
	nodeText                 map[string]map[string]domain.NodeProjection
	nodeRels                 map[string][]domain.NodeRelationship
	logicGates               map[string]domain.LogicGate
	logicGateInfo            map[string][]domain.LogicGateInformation
	logicGateText            map[string]map[string]domain.LogicGateProjection
	logicGateRels            map[string][]domain.LogicGateRelationship
	logicGateRaci            map[string][]domain.LogicGateRaciAssignment
	sharedInboxRaci          map[string][]domain.SharedInboxRaciAssignment
	folders                  map[string]domain.CompanyExplorerFolder
	folderItems              map[string]domain.CompanyExplorerFolderItem
	folderShares             map[string]domain.CompanyExplorerFolderShare
	defaultFolderSeed        map[string]bool
	nodeMapPositions         map[string]domain.NodeMapPosition
	logicMapPositions        map[string]domain.LogicGateMapPosition
	kanbanBoards             map[string]domain.KanbanBoard
	kanbanColumns            map[string][]domain.KanbanColumn
	kanbanCards              map[string][]domain.KanbanCard
	nodeLogicGateAssignments map[string]domain.NodeLogicGateAssignment
	workItemInboxEntries     map[string]memoryWorkItemInboxEntry
	users                    map[string]domain.User
	companies                map[string]domain.Company
	memberships              map[string]domain.CompanyMembership
	userGroups               map[string]domain.CompanyUserGroup
	userGroupMembers         map[string]domain.CompanyUserGroupMember
	entityPermissions        map[string]domain.EntityPermission
	invitations              map[string]domain.Invitation
	emailConnections         map[string]domain.UserEmailConnection
	triageItems              map[string]domain.CommunicationsTriageItem
	emailNodeLinks           map[string]communicationsEmailNodeLink
	logicGateShortcuts       map[string]domain.UserLogicGateShortcut
	domainEvents             map[string]domain.DomainEvent
	workspaceReadVersions    map[string]int64
	domainEventAppendErr     error
	notificationEvents       map[string]domain.NotificationEvent
	notifications            map[string]domain.Notification
}

func NewMemoryRepo() *MemoryRepo {
	return &MemoryRepo{
		nodes:                    map[string]domain.Node{},
		nodeInfo:                 map[string][]domain.NodeInformation{},
		nodeText:                 map[string]map[string]domain.NodeProjection{},
		nodeRels:                 map[string][]domain.NodeRelationship{},
		logicGates:               map[string]domain.LogicGate{},
		logicGateInfo:            map[string][]domain.LogicGateInformation{},
		logicGateText:            map[string]map[string]domain.LogicGateProjection{},
		logicGateRels:            map[string][]domain.LogicGateRelationship{},
		logicGateRaci:            map[string][]domain.LogicGateRaciAssignment{},
		sharedInboxRaci:          map[string][]domain.SharedInboxRaciAssignment{},
		folders:                  map[string]domain.CompanyExplorerFolder{},
		folderItems:              map[string]domain.CompanyExplorerFolderItem{},
		folderShares:             map[string]domain.CompanyExplorerFolderShare{},
		defaultFolderSeed:        map[string]bool{},
		nodeMapPositions:         map[string]domain.NodeMapPosition{},
		logicMapPositions:        map[string]domain.LogicGateMapPosition{},
		kanbanBoards:             map[string]domain.KanbanBoard{},
		kanbanColumns:            map[string][]domain.KanbanColumn{},
		kanbanCards:              map[string][]domain.KanbanCard{},
		nodeLogicGateAssignments: map[string]domain.NodeLogicGateAssignment{},
		workItemInboxEntries:     map[string]memoryWorkItemInboxEntry{},
		users:                    map[string]domain.User{},
		companies:                map[string]domain.Company{},
		memberships:              map[string]domain.CompanyMembership{},
		userGroups:               map[string]domain.CompanyUserGroup{},
		userGroupMembers:         map[string]domain.CompanyUserGroupMember{},
		entityPermissions:        map[string]domain.EntityPermission{},
		invitations:              map[string]domain.Invitation{},
		emailConnections:         map[string]domain.UserEmailConnection{},
		triageItems:              map[string]domain.CommunicationsTriageItem{},
		emailNodeLinks:           map[string]communicationsEmailNodeLink{},
		logicGateShortcuts:       map[string]domain.UserLogicGateShortcut{},
		domainEvents:             map[string]domain.DomainEvent{},
		workspaceReadVersions:    map[string]int64{},
		notificationEvents:       map[string]domain.NotificationEvent{},
		notifications:            map[string]domain.Notification{},
	}
}

func key(companyID, id string) string {
	return companyID + ":" + id
}

func folderItemKey(companyID, itemType, itemID string) string {
	return companyID + ":" + itemType + ":" + itemID
}

func folderShareKey(companyID, folderID, email string) string {
	return companyID + ":" + folderID + ":" + email
}

func boardKey(companyID, boardID string) string {
	return companyID + ":" + boardID
}

func nodeLogicGateAssignmentKey(companyID, nodeID string) string {
	return companyID + ":" + nodeID
}

func membershipKey(companyID, userID string) string {
	return companyID + ":" + userID
}

func userGroupKey(companyID, groupID string) string {
	return companyID + ":" + groupID
}

func userGroupMemberKey(companyID, groupID, userID string) string {
	return companyID + ":" + groupID + ":" + userID
}

func entityPermissionKey(companyID, entityType, entityID, subjectType, subjectID, permission string) string {
	return companyID + ":" + entityType + ":" + entityID + ":" + subjectType + ":" + subjectID + ":" + permission
}

func triageItemKey(userID, messageID string) string {
	return userID + ":" + messageID
}

func emailNodeLinkKey(companyID, boardID, cardID string) string {
	return companyID + ":" + boardID + ":" + cardID
}

func logicGateShortcutKey(userID, companyID, logicGateID string) string {
	return userID + ":" + companyID + ":" + logicGateID
}

func sharedInboxRaciKey(companyID, folderID string) string {
	return companyID + ":" + folderID
}

func workspaceReadVersionMemoryKey(companyID, scope, resourceKey string) string {
	return companyID + ":" + scope + ":" + resourceKey
}
