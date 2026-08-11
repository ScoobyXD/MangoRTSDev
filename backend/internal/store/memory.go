package store

import (
	"miraeopus/backend/internal/domain"
	"sync"
)

type MemoryRepo struct {
	mu                             sync.RWMutex
	nodes                          map[string]domain.Node
	nodeInfo                       map[string][]domain.NodeInformation
	nodeText                       map[string]map[string]domain.NodeProjection
	nodeTimelineEvents             map[string]domain.NodeTimelineEvent
	nodeTimelineVerificationSeen   map[string]string
	nodeRels                       map[string][]domain.NodeRelationship
	accounts                       map[string]domain.Account
	accountFolders                 map[string]domain.AccountFolder
	nodeAccountAssignments         map[string]domain.NodeAccountAssignment
	logicGates                     map[string]domain.LogicGate
	huddleLogicGates               map[string]domain.HuddleLogicGate
	huddleNodes                    map[string]domain.HuddleNode
	kpis                           map[string]domain.KPI
	huddleExplorerFolders          map[string]domain.HuddleExplorerFolder
	huddleExplorerItems            map[string]domain.HuddleExplorerItem
	logicGateInfo                  map[string][]domain.LogicGateInformation
	logicGateText                  map[string]map[string]domain.LogicGateProjection
	logicGateRels                  map[string][]domain.LogicGateRelationship
	logicGateRACI                  map[string][]domain.LogicGateRACIAssignment
	gvicAssignments                map[string]domain.ResourceRACIAssignment
	gvicEffectiveAssignments       map[string]domain.ResourceRACIEffectiveAssignment
	gvicPolicyRevisions            map[string]int64
	gvicSubtreeApplications        []resourceRACISubtreeApplication
	gvicV2Settings                 map[string]memoryV2PolicySetting
	permissionV2Settings           map[string]memoryV2PolicySetting
	gvicV2Sequence                 int64
	permissionV2Sequence           int64
	policyV2Idempotency            map[string]bool
	projects                       map[string]domain.Project
	projectAccountAssignments      map[string]bool
	projectTeamAssignments         map[string]bool
	entityFields                   map[string]domain.EntityField
	entityFieldAssignments         map[string]bool
	projectInfo                    map[string][]domain.ProjectInformation
	projectText                    map[string]map[string]domain.ProjectProjection
	projectRelationships           map[string]domain.ProjectRelationship
	projectRelationshipProjection  map[string]domain.ProjectRelationshipProjection
	projectCriticalPathSteps       map[string]domain.ProjectCriticalPathStep
	sharedInboxRACI                map[string][]domain.SharedInboxRACIAssignment
	folders                        map[string]domain.CompanyExplorerFolder
	folderItems                    map[string]domain.CompanyExplorerFolderItem
	companyExplorerV2Entities      map[string]memoryCompanyExplorerV2Entity
	companyExplorerV2Edges         map[string]memoryCompanyExplorerV2Edge
	companyExplorerV2Subscriptions map[string]memoryCompanyExplorerV2Subscription
	folderShares                   map[string]domain.CompanyExplorerFolderShare
	defaultFolderSeed              map[string]bool
	kanbanBoards                   map[string]domain.KanbanBoard
	kanbanColumns                  map[string][]domain.KanbanColumn
	kanbanCards                    map[string][]domain.KanbanCard
	nodeLogicGateAssignments       map[string]domain.NodeLogicGateAssignment
	RACIMatrixProjectionRows       map[string]memoryRACIMatrixProjectionRow
	projectTimelineItems           map[string]memoryProjectManagementTimelineItem
	projectTimelineProjection      map[string]ProjectManagementTimelineProjectionRow
	users                          map[string]domain.User
	companies                      map[string]domain.Company
	memberships                    map[string]domain.CompanyMembership
	userGroups                     map[string]domain.CompanyUserGroup
	userGroupMembers               map[string]domain.CompanyUserGroupMember
	savedViews                     map[string]domain.SavedView
	userPinFolders                 map[string]domain.UserPinFolder
	userPins                       map[string]domain.UserPin
	entityPermissions              map[string]domain.EntityPermission
	effectiveAccess                map[string]domain.EffectiveResourceAccess
	resourcePolicySequence         int64
	resourcePermissionRevisions    map[string]int64
	resourcePermissionApplications []resourcePermissionSubtreeApplication
	invitations                    map[string]domain.Invitation
	emailConnections               map[string]domain.UserEmailConnection
	companyEmailConnections        map[string]domain.CompanyEmailConnection
	messageReadStatuses            map[string]domain.CommunicationsMessageReadStatus
	emailDrafts                    map[string]domain.CommunicationsEmailDraft
	emailSignatures                map[string]domain.CommunicationsEmailSignature
	triageItems                    map[string]domain.CommunicationsTriageItem
	attachments                    map[string]domain.Attachment
	attachmentVariants             map[string]domain.AttachmentVariant
	resourceAttachments            map[string]domain.ResourceAttachment
	attachmentUploadIntents        map[string]domain.AttachmentUploadIntent
	attachmentUploadRequestIDs     map[string]string
	attachmentUploadParts          map[string]map[int]domain.AttachmentUploadPart
	communicationsArchiveJobs      map[string]CommunicationsArchiveJob
	communicationsArchiveJobItems  map[string]CommunicationsArchiveJobItem
	emailNodeLinks                 map[string]communicationsEmailNodeLink
	emailThreads                   map[string]domain.CommunicationsEmailThread
	emailThreadScopeIDs            map[string]string
	emailIngestionJobs             map[string]CommunicationsEmailIngestionJob
	nodeEmailThreads               map[string]domain.CommunicationsNodeEmailThread
	emailCollaborations            map[string]domain.CommunicationsEmailCollaboration
	emailCollaborationParticipants map[string]domain.CommunicationsEmailCollaborationParticipant
	logicGateShortcuts             map[string]domain.UserLogicGateShortcut
	domainEvents                   map[string]domain.DomainEvent
	realtimeOutbox                 map[string]RealtimeOutboxEvent
	realtimeOutboxSequence         int64
	realtimeOutboxErr              error
	editorJSONDocuments            map[string]memoryEditorJSONDocument
	editorJSONOperations           map[string][]memoryEditorJSONOperation
	editorJSONVersions             map[string][]EditorJSONVersion
	effectiveAccessErr             error
	workspaceReadVersions          map[string]int64
	domainEventAppendErr           error
	notifications                  map[string]domain.Notification
	recycleBin                     map[string]memoryRecycleBinItem
}

func NewMemoryRepo() *MemoryRepo {
	return &MemoryRepo{
		nodes:                          map[string]domain.Node{},
		nodeInfo:                       map[string][]domain.NodeInformation{},
		nodeText:                       map[string]map[string]domain.NodeProjection{},
		nodeTimelineEvents:             map[string]domain.NodeTimelineEvent{},
		nodeTimelineVerificationSeen:   map[string]string{},
		nodeRels:                       map[string][]domain.NodeRelationship{},
		accounts:                       map[string]domain.Account{},
		accountFolders:                 map[string]domain.AccountFolder{},
		nodeAccountAssignments:         map[string]domain.NodeAccountAssignment{},
		logicGates:                     map[string]domain.LogicGate{},
		huddleLogicGates:               map[string]domain.HuddleLogicGate{},
		huddleNodes:                    map[string]domain.HuddleNode{},
		kpis:                           map[string]domain.KPI{},
		huddleExplorerFolders:          map[string]domain.HuddleExplorerFolder{},
		huddleExplorerItems:            map[string]domain.HuddleExplorerItem{},
		logicGateInfo:                  map[string][]domain.LogicGateInformation{},
		logicGateText:                  map[string]map[string]domain.LogicGateProjection{},
		logicGateRels:                  map[string][]domain.LogicGateRelationship{},
		logicGateRACI:                  map[string][]domain.LogicGateRACIAssignment{},
		gvicAssignments:                map[string]domain.ResourceRACIAssignment{},
		gvicEffectiveAssignments:       map[string]domain.ResourceRACIEffectiveAssignment{},
		gvicPolicyRevisions:            map[string]int64{},
		gvicSubtreeApplications:        []resourceRACISubtreeApplication{},
		gvicV2Settings:                 map[string]memoryV2PolicySetting{},
		permissionV2Settings:           map[string]memoryV2PolicySetting{},
		policyV2Idempotency:            map[string]bool{},
		projects:                       map[string]domain.Project{},
		projectAccountAssignments:      map[string]bool{},
		projectTeamAssignments:         map[string]bool{},
		entityFields:                   map[string]domain.EntityField{},
		entityFieldAssignments:         map[string]bool{},
		projectInfo:                    map[string][]domain.ProjectInformation{},
		projectText:                    map[string]map[string]domain.ProjectProjection{},
		projectRelationships:           map[string]domain.ProjectRelationship{},
		projectRelationshipProjection:  map[string]domain.ProjectRelationshipProjection{},
		projectCriticalPathSteps:       map[string]domain.ProjectCriticalPathStep{},
		sharedInboxRACI:                map[string][]domain.SharedInboxRACIAssignment{},
		folders:                        map[string]domain.CompanyExplorerFolder{},
		folderItems:                    map[string]domain.CompanyExplorerFolderItem{},
		companyExplorerV2Entities:      map[string]memoryCompanyExplorerV2Entity{},
		companyExplorerV2Edges:         map[string]memoryCompanyExplorerV2Edge{},
		companyExplorerV2Subscriptions: map[string]memoryCompanyExplorerV2Subscription{},
		folderShares:                   map[string]domain.CompanyExplorerFolderShare{},
		defaultFolderSeed:              map[string]bool{},
		kanbanBoards:                   map[string]domain.KanbanBoard{},
		kanbanColumns:                  map[string][]domain.KanbanColumn{},
		kanbanCards:                    map[string][]domain.KanbanCard{},
		nodeLogicGateAssignments:       map[string]domain.NodeLogicGateAssignment{},
		RACIMatrixProjectionRows:       map[string]memoryRACIMatrixProjectionRow{},
		projectTimelineItems:           map[string]memoryProjectManagementTimelineItem{},
		projectTimelineProjection:      map[string]ProjectManagementTimelineProjectionRow{},
		users:                          map[string]domain.User{},
		companies:                      map[string]domain.Company{},
		memberships:                    map[string]domain.CompanyMembership{},
		userGroups:                     map[string]domain.CompanyUserGroup{},
		userGroupMembers:               map[string]domain.CompanyUserGroupMember{},
		savedViews:                     map[string]domain.SavedView{},
		userPinFolders:                 map[string]domain.UserPinFolder{},
		userPins:                       map[string]domain.UserPin{},
		entityPermissions:              map[string]domain.EntityPermission{},
		effectiveAccess:                map[string]domain.EffectiveResourceAccess{},
		resourcePermissionRevisions:    map[string]int64{},
		resourcePermissionApplications: []resourcePermissionSubtreeApplication{},
		invitations:                    map[string]domain.Invitation{},
		emailConnections:               map[string]domain.UserEmailConnection{},
		companyEmailConnections:        map[string]domain.CompanyEmailConnection{},
		messageReadStatuses:            map[string]domain.CommunicationsMessageReadStatus{},
		emailDrafts:                    map[string]domain.CommunicationsEmailDraft{},
		emailSignatures:                map[string]domain.CommunicationsEmailSignature{},
		triageItems:                    map[string]domain.CommunicationsTriageItem{},
		attachments:                    map[string]domain.Attachment{},
		attachmentVariants:             map[string]domain.AttachmentVariant{},
		resourceAttachments:            map[string]domain.ResourceAttachment{},
		attachmentUploadIntents:        map[string]domain.AttachmentUploadIntent{},
		attachmentUploadRequestIDs:     map[string]string{},
		attachmentUploadParts:          map[string]map[int]domain.AttachmentUploadPart{},
		communicationsArchiveJobs:      map[string]CommunicationsArchiveJob{},
		communicationsArchiveJobItems:  map[string]CommunicationsArchiveJobItem{},
		emailNodeLinks:                 map[string]communicationsEmailNodeLink{},
		emailThreads:                   map[string]domain.CommunicationsEmailThread{},
		emailThreadScopeIDs:            map[string]string{},
		emailIngestionJobs:             map[string]CommunicationsEmailIngestionJob{},
		nodeEmailThreads:               map[string]domain.CommunicationsNodeEmailThread{},
		emailCollaborations:            map[string]domain.CommunicationsEmailCollaboration{},
		emailCollaborationParticipants: map[string]domain.CommunicationsEmailCollaborationParticipant{},
		logicGateShortcuts:             map[string]domain.UserLogicGateShortcut{},
		domainEvents:                   map[string]domain.DomainEvent{},
		realtimeOutbox:                 map[string]RealtimeOutboxEvent{},
		editorJSONDocuments:            map[string]memoryEditorJSONDocument{},
		editorJSONOperations:           map[string][]memoryEditorJSONOperation{},
		editorJSONVersions:             map[string][]EditorJSONVersion{},
		workspaceReadVersions:          map[string]int64{},
		notifications:                  map[string]domain.Notification{},
		recycleBin:                     map[string]memoryRecycleBinItem{},
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
	return companyID + ":" + entityType + ":" + entityID + ":" + subjectType + ":" + subjectID
}

func effectiveAccessKey(companyID, userID, resourceType, resourceID, sourceType, sourceID string) string {
	return companyID + ":" + userID + ":" + resourceType + ":" + resourceID
}

func triageItemKey(userID, messageID string) string {
	return userID + ":" + messageID
}

func emailNodeLinkKey(companyID, boardID, cardID string) string {
	return companyID + ":" + boardID + ":" + cardID
}

func emailNodeAttachmentLinkKey(companyID, userID, messageID, nodeID string) string {
	return companyID + ":" + userID + ":" + messageID + ":" + nodeID
}

func emailCollaborationParticipantKey(companyID, collaborationID, userID string) string {
	return companyID + ":" + collaborationID + ":" + userID
}

func logicGateShortcutKey(userID, companyID, logicGateID string) string {
	return userID + ":" + companyID + ":" + logicGateID
}

func sharedInboxRACIKey(companyID, folderID string) string {
	return companyID + ":" + folderID
}

func workspaceReadVersionMemoryKey(companyID, scope, resourceKey string) string {
	return companyID + ":" + scope + ":" + resourceKey
}
