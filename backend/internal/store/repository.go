package store

import (
	"context"
	"errors"
	"math"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

var (
	ErrNotFound                      = errors.New("not found")
	ErrInvalid                       = errors.New("invalid")
	ErrAlreadyExists                 = errors.New("already exists")
	ErrPriorityRequired              = errors.New("priority required")
	ErrInvitationBadToken            = errors.New("invitation bad token")
	ErrInvitationExpired             = errors.New("invitation expired")
	ErrInvitationAlreadyAccepted     = errors.New("invitation already accepted")
	ErrInvitationReplaced            = errors.New("invitation replaced")
	ErrInvitationEmailMismatch       = errors.New("invitation email mismatch")
	ErrPrincipalNotInCompany         = errors.New("principal not in company")
	ErrGVICInherited                 = errors.New("GVIC inherited")
	ErrGVICStorageUnavailable        = errors.New("GVIC storage unavailable")
	ErrSharedInboxStorageUnavailable = errors.New("shared inbox storage unavailable")
	ErrEmailAccountUnavailable       = errors.New("email account unavailable")
)

type Repository interface {
	IdentityRepository
	AccountRepository
	CommunicationsRepository
	WorkGraphRepository
	LogicGateRepository
	ProjectRepository
	GVICRepository
	EntityPermissionRepository
	EffectiveAccessRepository
	ConsolidatedViewRepository
	SavedViewRepository
	UserPinRepository
	LogicGateWorkRepository
	WorkItemReadRepository
	CompanyExplorerRepository
	RecycleBinRepository
	MapLayoutRepository
	WorkspaceEntityCommandRepository
	KanbanRepository
	ProjectManagementRepository
	NotificationRepository
	DomainEventRepository
	EventRepository
}

type AccountRepository interface {
	ListAccounts(companyID string) ([]domain.Account, error)
	CreateAccount(input AccountInput) (AccountMutationResult, error)
	UpdateAccount(input AccountInput) (AccountMutationResult, error)
	DeleteAccount(companyID, accountID, actorUserID string) (AccountMutationResult, error)
	ListAccountFolders(companyID string) ([]domain.AccountFolder, error)
	CreateAccountFolder(input AccountFolderInput) (domain.AccountFolder, error)
	UpdateAccountFolder(input AccountFolderInput) (domain.AccountFolder, error)
	DeleteAccountFolder(companyID, folderID string) error
	SetNodeAccountAssignments(input NodeAccountAssignmentUpdateInput) (NodeAccountAssignmentUpdateResult, error)
	ListNodeAccountAssignments(companyID, nodeID string) ([]domain.NodeAccountAssignment, error)
}

type IdentityRepository interface {
	UpsertAuthUser(cognitoSubject, email, displayName string) (domain.User, error)
	GetAuthUser(cognitoSubject string) (domain.User, error)
	GetAuthUserByEmail(email string) (domain.User, error)
	ListUserMemberships(userID string) ([]domain.CompanyMembership, error)
	UserHasCompanyAccess(cognitoSubject, companyID string) (bool, error)
	AddCompanyMembership(cognitoSubject, companyID, role string) (domain.CompanyMembership, error)
	CreateCompany(name string) (domain.Company, error)
	ListCompanies(query string, limit int) ([]domain.Company, error)
	ListCompanyUsers(companyID string) ([]domain.CompanyUser, error)
	ListCompanyUserOnboarding(companyID string) ([]domain.CompanyUserOnboarding, error)
	ListMentionableCompanyUsers(companyID string) ([]domain.CompanyUser, error)
	GetCompanyUser(companyID, userID string) (domain.CompanyUser, error)
	DeleteCompanyUser(companyID, userID string, deleteIdentity bool) (DeleteCompanyUserResult, error)
	ListCompanyUserGroups(companyID string) ([]domain.CompanyUserGroup, error)
	CreateCompanyUserGroup(companyID, parentGroupID, name string) (domain.CompanyUserGroup, error)
	UpdateCompanyUserGroup(companyID, groupID string, parentGroupID *string, name string, position int) (domain.CompanyUserGroup, error)
	DeleteCompanyUserGroup(companyID, groupID string) error
	ListCompanyUserGroupMembers(companyID string) ([]domain.CompanyUserGroupMember, error)
	SetCompanyUserGroupMembers(companyID, groupID string, userIDs []string) ([]domain.CompanyUserGroupMember, error)
	CompleteExternalIdentityDeletion(cognitoSubject string) error
	CreateInvitation(input CreateInvitationInput) (domain.Invitation, error)
	UpdateInvitationDeliveryStatus(input InvitationDeliveryStatusInput) (domain.Invitation, error)
	ValidateInvitationToken(token string) (domain.Invitation, error)
	AcceptInvitation(token, cognitoSubject, email, displayName string) (domain.Invitation, error)
	GetUserEmailConnection(userID string) (domain.UserEmailConnection, error)
	ListUserEmailConnections(userID string) ([]domain.UserEmailConnection, error)
	GetCompanyEmailConnectionByAccountEmail(companyID, accountEmail string) (domain.CompanyEmailConnection, error)
	GetCompanyEmailConnectionByID(companyID, connectionID string) (domain.CompanyEmailConnection, error)
	GetCompanyEmailConnectionByGrantID(grantID string) (domain.CompanyEmailConnection, error)
	GetUserEmailConnectionByGrantID(grantID string) (domain.UserEmailConnection, error)
	UpsertUserEmailConnection(input UserEmailConnectionInput) (domain.UserEmailConnection, error)
	UpsertCompanyEmailConnection(input CompanyEmailConnectionInput) (domain.CompanyEmailConnection, error)
	UpdateCompanyEmailConnectionStatus(companyID, connectionID, status string) (domain.CompanyEmailConnection, error)
	UpdateUserEmailConnectionStatus(userID, accountEmail, status string) (domain.UserEmailConnection, error)
	DeleteUserEmailConnection(userID string) error
}

type CommunicationsRepository interface {
	ListCommunicationsTriageItems(userID string) ([]domain.CommunicationsTriageItem, error)
	UpsertCommunicationsTriageItem(userID string, message domain.EmailMessageSnapshot) (domain.CommunicationsTriageItem, error)
	DeleteCommunicationsTriageItem(userID, messageID string) error
	UpsertCommunicationsMessageReadStatus(input CommunicationsMessageReadStatusInput) (domain.CommunicationsMessageReadStatus, error)
	ListCommunicationsMessageReadStatuses(input CommunicationsMessageReadStatusListInput) ([]domain.CommunicationsMessageReadStatus, error)
	CreateCommunicationsArchiveJob(input CommunicationsArchiveJobInput) (CommunicationsArchiveJob, error)
	ClaimCommunicationsArchiveJobItems(limit int, processingLeaseTimeout time.Duration) ([]CommunicationsArchiveJobItem, error)
	MarkCommunicationsArchiveJobItemArchived(jobItemID string) error
	MarkCommunicationsArchiveJobItemFailed(jobItemID, lastError string, availableAt time.Time, final bool) error
	ListCommunicationsArchiveJobItems(jobID string) ([]CommunicationsArchiveJobItem, error)
	ConvertCommunicationsTriageItems(input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error)
	RevertCommunicationsTriageNode(input CommunicationsTriageRevertInput) (CommunicationsTriageRevertResult, error)
	TransferCommunicationsEmailNode(input CommunicationsEmailNodeTransferInput) (CommunicationsEmailNodeTransferResult, error)
	ListCommunicationsEmailPlacements(userID, companyID string, messageIDs []string) ([]domain.CommunicationsEmailPlacement, error)
	ListUserLogicGateShortcuts(userID, companyID string) ([]domain.UserLogicGateShortcut, error)
	UpsertUserLogicGateShortcuts(userID, companyID string, logicGateIDs []string) ([]domain.UserLogicGateShortcut, error)
	DeleteUserLogicGateShortcut(userID, companyID, logicGateID string) error
}

type WorkGraphRepository interface {
	CreateNode(companyID, title string) (domain.Node, error)
	CreateNodeWithWorkspaceEvent(companyID, title string) (domain.Node, domain.DomainEvent, error)
	UpdateNode(input UpdateNodeInput) (domain.Node, error)
	UpdateNodeAndWorkspaceEvent(input UpdateNodeInput) (domain.Node, domain.DomainEvent, error)
	UpdateNodeTitle(companyID, nodeID, title string) (domain.Node, error)
	ListNodes(companyID string) ([]domain.Node, error)
	ListVisibleNodes(companyID, userID string) ([]domain.Node, error)
	ListNodesInFolderSubtree(companyID, folderID string) ([]domain.Node, error)
	ListVisibleNodesInFolderSubtree(companyID, folderID, userID string) ([]domain.Node, error)
	ListNodeMapWindow(query NodeMapWindowQuery) (NodeMapWindowResult, error)
	ListNodeRelationships(companyID string) ([]domain.NodeRelationship, error)
	ListNodeRelationshipsInFolderSubtree(companyID, folderID string) ([]domain.NodeRelationship, error)
	DeleteNodeRelationship(companyID, relationshipID string) error
	DeleteNodeRelationshipAndWorkspaceEvent(companyID, relationshipID string) (domain.DomainEvent, error)
	GetNode(companyID, nodeID string) (domain.Node, error)
	DeleteNode(companyID, nodeID string) error
	DeleteNodeAndWorkspaceEvent(companyID, nodeID string) (domain.DomainEvent, error)
	GetNodeDetails(companyID, nodeID string) (domain.NodeDetails, error)
	GetNodeDetailsSummary(companyID, nodeID string) (domain.NodeDetails, error)
	AddNodeInformation(companyID, nodeID, infoType, information, informationID string) (domain.NodeInformation, error)
	AddNodeInformationWithActor(input NodeInformationInput) (domain.NodeInformation, error)
	ListNodeProjections(companyID, nodeID string) ([]domain.NodeProjection, error)
	DeleteNodeProjection(companyID, nodeID, informationID string) error
	DeleteNodeProjectionWithActor(input NodeProjectionDeleteInput) error
	ListUnseenNodeContentChanges(input NodeContentChangeListInput) ([]domain.NodeContentChange, error)
	MarkNodeContentChangeSeen(input NodeContentChangeSeenInput) (int, error)
	CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error)
	CreateNodeRelationshipAndWorkspaceEvent(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, domain.DomainEvent, error)
}

type LogicGateRepository interface {
	CreateLogicGate(companyID, header string) (domain.LogicGate, error)
	UpdateLogicGateHeader(companyID, logicGateID, header string) (domain.LogicGate, error)
	ListLogicGates(companyID string) ([]domain.LogicGate, error)
	ListVisibleLogicGates(companyID, userID string) ([]domain.LogicGate, error)
	ListLogicGatesInFolderSubtree(companyID, folderID string) ([]domain.LogicGate, error)
	ListVisibleLogicGatesInFolderSubtree(companyID, folderID, userID string) ([]domain.LogicGate, error)
	ListLogicGateMapWindow(query LogicGateMapWindowQuery) (LogicGateMapWindowResult, error)
	QueryLogicGates(companyID string, query LogicGateQuery) ([]domain.LogicGate, error)
	QueryVisibleLogicGates(companyID, userID string, query LogicGateQuery) ([]domain.LogicGate, error)
	SetLogicGateGVICAssignments(input LogicGateGVICAssignmentUpdateInput) ([]domain.LogicGateGVICAssignment, error)
	AddLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error)
	RemoveLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error)
	ListLogicGateRelationships(companyID string) ([]domain.LogicGateRelationship, error)
	ListLogicGateRelationshipsInFolderSubtree(companyID, folderID string) ([]domain.LogicGateRelationship, error)
	DeleteLogicGateRelationship(companyID, relationshipID string) error
	GetLogicGate(companyID, logicGateID string) (domain.LogicGate, error)
	DeleteLogicGate(companyID, logicGateID string) error
	GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error)
	AddLogicGateInformation(companyID, logicGateID, infoType, information, informationID string) (domain.LogicGateInformation, error)
	ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error)
	DeleteLogicGateProjection(companyID, logicGateID, informationID string) error
	CreateLogicGateRelationship(companyID, logicGateIDA, logicGateIDB, aPosition, bPosition string) (domain.LogicGateRelationship, error)
}

type ProjectRepository interface {
	CreateProject(input ProjectInput) (ProjectMutationResult, error)
	UpdateProject(input ProjectInput) (ProjectMutationResult, error)
	DeleteProject(companyID, projectID, actorUserID string) (ProjectMutationResult, error)
	GetProject(companyID, projectID string) (domain.Project, error)
	ListProjects(companyID, viewerUserID string) ([]domain.Project, error)
	GetProjectView(companyID, projectID, viewerUserID string) (domain.ProjectView, error)
	AddProjectInformation(input ProjectInformationInput) (domain.ProjectInformation, error)
	ListProjectProjections(companyID, projectID string) ([]domain.ProjectProjection, error)
	DeleteProjectProjection(input ProjectProjectionDeleteInput) error
	ListProjectCriticalPathSteps(companyID, projectID, viewerUserID string) ([]domain.ProjectCriticalPathStep, error)
	UpsertProjectCriticalPathStep(input ProjectCriticalPathStepInput) (domain.ProjectCriticalPathStep, error)
	DeleteProjectCriticalPathStep(input ProjectCriticalPathStepDeleteInput) error
	UpsertProjectRelationship(input ProjectRelationshipInput) (ProjectRelationshipMutationResult, error)
	DeleteProjectRelationship(input ProjectRelationshipDeleteInput) (ProjectRelationshipMutationResult, error)
	CreateNodeAssociatedWithProject(input ProjectScopedNodeCreateInput) (ProjectScopedNodeCreateResult, error)
	CreateLogicGateAssociatedWithProject(input ProjectScopedLogicGateCreateInput) (ProjectScopedLogicGateCreateResult, error)
	ListProjectRelationshipProjections(companyID, projectID string) ([]domain.ProjectRelationshipProjection, error)
	ListProjectRelationshipProjectionsForViewer(companyID, projectID, viewerUserID string) ([]domain.ProjectRelationshipProjection, error)
	ListProjectRelationshipsForResource(companyID, resourceType, resourceID, viewerUserID string) ([]domain.ProjectRelationshipProjection, error)
}

type GVICRepository interface {
	ListResourceGVICAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICAssignment, error)
	SetResourceGVICAssignments(input ResourceGVICAssignmentUpdateInput) (ResourceGVICAssignmentMutationResult, error)
	AddResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error)
	RemoveResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error)
	ListResourceGVICEffectiveAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICEffectiveAssignment, error)
}

type EntityPermissionRepository interface {
	ListEntityPermissions(companyID, entityType, entityID string) ([]domain.EntityPermission, error)
	SetEntityPermissions(input EntityPermissionUpdateInput) ([]domain.EntityPermission, error)
	ListAccessibleEntityIDs(companyID, entityType, userID, accessLevel string, entityIDs []string) (map[string]bool, error)
	UserCanViewEntity(companyID, entityType, entityID, userID string) (bool, error)
	UserCanAccessEntity(companyID, entityType, entityID, userID, accessLevel string) (bool, error)
}

type EffectiveAccessRepository interface {
	UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel string) (bool, error)
	ListEffectiveResourceIDsForUser(companyID, userID, resourceType, accessLevel string, resourceIDs []string) (map[string]bool, error)
	ListEffectiveUsersForResource(companyID, resourceType, resourceID, accessLevel string) ([]string, error)
	ListEffectiveUsersForWorkspaceEvent(event domain.DomainEvent) ([]string, error)
}

type ConsolidatedViewRepository interface {
	GetNodeView(input NodeViewInput) (domain.NodeView, error)
	GetLogicGateView(companyID, logicGateID string) (domain.LogicGateView, error)
}

type SavedViewRepository interface {
	ListSavedViews(input SavedViewListInput) ([]domain.SavedView, error)
	GetSavedView(companyID, savedViewID string) (domain.SavedView, error)
	UpsertSavedView(input SavedViewInput) (domain.SavedView, error)
	DeleteSavedView(input SavedViewDeleteInput) error
}

const (
	SavedViewSurfaceMyWork          = "my_work"
	SavedViewSurfaceUpdates         = "updates"
	SavedViewSurfaceLogicGateKanban = "logic_gate_kanban"

	SavedViewPrincipalUser  = "user"
	SavedViewPrincipalGroup = "group"
)

type SavedViewListInput struct {
	CompanyID    string
	ViewerUserID string
	Surface      string
}

type SavedViewInput struct {
	CompanyID   string
	SavedViewID string
	Surface     string
	Principal   string
	PrincipalID string
	Name        string
	Groupings   []domain.SavedViewGrouping
	Settings    domain.SavedViewSettings
	Position    int
}

type SavedViewDeleteInput struct {
	CompanyID   string
	SavedViewID string
}

type UserPinRepository interface {
	ListUserPins(input UserPinListInput) ([]domain.UserPin, error)
	UpsertUserPin(input UserPinInput) (domain.UserPin, error)
	DeleteUserPin(input UserPinDeleteInput) error
	ReorderUserPins(input UserPinReorderInput) error
}

type UserPinListInput struct {
	CompanyID string
	UserID    string
}

type UserPinInput struct {
	CompanyID    string
	PinID        string
	UserID       string
	ResourceType string
	ResourceID   string
	Name         string
	Position     int
}

type UserPinDeleteInput struct {
	CompanyID string
	UserID    string
	PinID     string
}

type UserPinReorderInput struct {
	CompanyID string
	UserID    string
	PinIDs    []string
}

type LogicGateWorkRepository interface {
	GetLogicGateWork(companyID, logicGateID string) (domain.LogicGateWorkView, error)
}

type WorkItemReadRepository interface {
	ListGeneratedInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error)
	ListGeneratedInboxNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error)
	ListACIInboxLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error)
	ListACIInboxLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error)
	ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error)
	ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error)
	ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error)
	ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error)
	ListMyWorkMatrixRows(query WorkItemInboxQuery) ([]GVICMatrixProjectionRow, error)
	ListMyWorkMatrix(query WorkItemInboxQuery) (MyWorkMatrixResponse, error)
	ListGVICMatrixProjectionRowsForUser(query WorkItemInboxQuery) ([]GVICMatrixProjectionRow, error)
	ListGVICMatrixProjectionRowsForResources(companyID string, nodeIDs, logicGateIDs []string) ([]GVICMatrixProjectionRow, error)
	ListGVICMatrixProjectionRowsForLogicGate(companyID, logicGateID string) ([]GVICMatrixProjectionRow, error)
	ListKanbanBoardProjectionRows(companyID, logicGateID string, query KanbanCardQuery) ([]KanbanBoardProjectionRow, error)
	ListKanbanBoardProjectionRowsForNode(companyID, nodeID string) ([]KanbanBoardProjectionRow, error)
	ListKanbanBoardProjectionRowsForLogicGate(companyID, logicGateID string) ([]KanbanBoardProjectionRow, error)
	CurrentProjectionSequence(companyID, projectionName, projectionScope string) (int64, error)
	NextProjectionSequence(companyID, projectionName, projectionScope string) (int64, error)
}

type ProjectManagementRepository interface {
	ListProjectManagementTimelineProjectionRows(query ProjectManagementTimelineQuery) ([]ProjectManagementTimelineProjectionRow, error)
	ListProjectManagementTimelineProjectionRowsForNode(companyID, nodeID string) ([]ProjectManagementTimelineProjectionRow, error)
	ListProjectManagementTimelineProjectionRowsForLogicGate(companyID, logicGateID string) ([]ProjectManagementTimelineProjectionRow, error)
	GetProjectManagementTimelineItemOwner(companyID, itemID string) (string, error)
	UpsertProjectManagementTimelineItem(input ProjectManagementTimelineItemInput) (ProjectManagementTimelineMutationResult, error)
	UpdateProjectManagementTimelineItem(input ProjectManagementTimelineItemUpdateInput) (ProjectManagementTimelineMutationResult, error)
	DeleteProjectManagementTimelineItem(input ProjectManagementTimelineItemDeleteInput) (ProjectManagementTimelineMutationResult, error)
}

type CompanyExplorerRepository interface {
	CreateCompanyExplorerFolder(companyID, parentFolderID, folderKind, name string) (domain.CompanyExplorerFolder, error)
	ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error)
	ListVisibleCompanyExplorerFolders(companyID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error)
	ListCompanyExplorerV2RootRows(query CompanyExplorerV2RowsQuery) (CompanyExplorerV2Rows, error)
	ListCompanyExplorerV2ChildRows(query CompanyExplorerV2RowsQuery) (CompanyExplorerV2Rows, error)
	SearchCompanyExplorer(query CompanyExplorerSearchQuery) (CompanyExplorerSearchResults, error)
	GetCompanyExplorerV2Entity(companyID, entityID, permissionUserID string) (CompanyExplorerV2Row, error)
	GetCompanyExplorerV2FolderDefaultAccess(companyID, entityID string) (string, error)
	CreateCompanyExplorerV2Folder(input CompanyExplorerV2FolderInput) (CompanyExplorerV2Row, error)
	UpdateCompanyExplorerV2Folder(input CompanyExplorerV2FolderUpdateInput) (CompanyExplorerV2Row, error)
	UpsertCompanyExplorerV2Edge(input CompanyExplorerV2EdgeInput) (CompanyExplorerV2Row, error)
	MoveCompanyExplorerV2Edge(input CompanyExplorerV2MoveEdgeInput) (CompanyExplorerV2Row, error)
	DeleteCompanyExplorerV2Edge(companyID, edgeID string) error
	DeleteCompanyExplorerV2Edges(companyID string, edgeIDs []string) error
	DeleteCompanyExplorerV2Folder(companyID, entityID string) error
	UpsertCompanyExplorerV2Subscription(input CompanyExplorerV2SubscriptionInput) (CompanyExplorerV2Subscription, error)
	DeleteCompanyExplorerV2Subscription(companyID, subscriptionID, actorUserID string) error
	ListCompanyExplorerRootRows(query CompanyExplorerLazyRowsQuery) (CompanyExplorerLazyRows, error)
	ListCompanyExplorerFolderChildRows(query CompanyExplorerLazyRowsQuery) (CompanyExplorerLazyRows, error)
	ListCompanyExplorerLogicGateChildRows(query CompanyExplorerLazyRowsQuery) (CompanyExplorerLazyRows, error)
	ListCompanyExplorerFolderSubtree(companyID, folderID, folderKind string) ([]domain.CompanyExplorerFolder, error)
	ListVisibleCompanyExplorerFolderSubtree(companyID, folderID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error)
	MoveCompanyExplorerFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error)
	SetCompanyExplorerFolderScope(companyID, folderID, scopeType, scopeID string) (domain.CompanyExplorerFolder, error)
	RenameCompanyExplorerFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error)
	DeleteCompanyExplorerFolder(companyID, folderID string) error
	DeleteCompanyExplorerTargets(companyID string, targets []CompanyExplorerDeleteTargetInput, deletedByUserID string) (CompanyExplorerDeleteResult, error)
	CreateCommunicationsSharedInboxFolder(companyID, parentFolderID, name, accountEmail string) (domain.CompanyExplorerFolder, error)
	ListCommunicationsSharedInboxFolders(companyID string) ([]domain.CompanyExplorerFolder, error)
	ListVisibleCommunicationsSharedInboxFolders(companyID, userID string) ([]domain.CompanyExplorerFolder, error)
	GetCommunicationsSharedInboxFolder(companyID, folderID string) (domain.CompanyExplorerFolder, error)
	MoveCommunicationsSharedInboxFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error)
	RenameCommunicationsSharedInboxFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error)
	DeleteCommunicationsSharedInboxFolder(companyID, folderID string) error
	RemoveCommunicationsSharedInboxFolder(companyID, folderID string) error
	SetCommunicationsSharedInboxAccountEmail(companyID, folderID, accountEmail string) (domain.CompanyExplorerFolder, error)
	SetCommunicationsSharedInboxGVICAssignments(input SharedInboxGVICAssignmentUpdateInput) ([]domain.SharedInboxGVICAssignment, error)
	ListCompanyExplorerFolderShares(companyID, folderID string) ([]domain.CompanyExplorerFolderShare, error)
	UpsertCompanyExplorerFolderShare(input CompanyExplorerFolderShareInput) (domain.CompanyExplorerFolderShare, error)
	DeleteCompanyExplorerFolderShare(companyID, folderID, email string) error
	AssignCompanyExplorerFolderItem(companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, []string, error)
	AssignCompanyExplorerFolderItems(companyID string, assignments []CompanyExplorerFolderItemAssignmentInput) ([]domain.CompanyExplorerFolderItem, []CompanyExplorerRelationshipDeleteResult, error)
	ListCompanyExplorerFolderItems(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error)
	ListVisibleCompanyExplorerFolderItems(companyID, folderID, itemType, userID string) ([]domain.CompanyExplorerFolderItem, error)
	ListCompanyExplorerNodeSummaries(companyID string) ([]domain.Node, error)
	ListVisibleCompanyExplorerNodeSummaries(companyID, userID string) ([]domain.Node, error)
	ListCompanyExplorerNodeSummariesInFolderSubtree(companyID, folderID string) ([]domain.Node, error)
	ListVisibleCompanyExplorerNodeSummariesInFolderSubtree(companyID, folderID, userID string) ([]domain.Node, error)
	ListCompanyExplorerLogicGateSummaries(companyID string) ([]domain.LogicGate, error)
	ListVisibleCompanyExplorerLogicGateSummaries(companyID, userID string) ([]domain.LogicGate, error)
	ListCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, folderID string) ([]domain.LogicGate, error)
	ListVisibleCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, folderID, userID string) ([]domain.LogicGate, error)
	ListCompanyExplorerProjectSummaries(companyID string) ([]domain.Project, error)
	ListVisibleCompanyExplorerProjectSummaries(companyID, userID string) ([]domain.Project, error)
	ListCompanyExplorerProjectSummariesInFolderSubtree(companyID, folderID string) ([]domain.Project, error)
	ListVisibleCompanyExplorerProjectSummariesInFolderSubtree(companyID, folderID, userID string) ([]domain.Project, error)
	ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error)
	ListVisibleCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType, userID string) ([]domain.CompanyExplorerFolderItem, error)
	RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error
}

const (
	CompanyExplorerLazyScopeMe   = "me"
	CompanyExplorerLazyScopeTeam = "team"
	CompanyExplorerLazyScopeAll  = "all"
)

type CompanyExplorerLazyRowsQuery struct {
	CompanyID        string
	Scope            string
	ScopeUserID      string
	PermissionUserID string
	ParentID         string
}

type CompanyExplorerLazyRows struct {
	Folders     []domain.CompanyExplorerFolder     `json:"folders"`
	FolderItems []domain.CompanyExplorerFolderItem `json:"folder_items"`
	Nodes       []domain.Node                      `json:"nodes"`
	LogicGates  []domain.LogicGate                 `json:"logic_gates"`
	Projects    []domain.Project                   `json:"projects"`
}

const (
	CompanyExplorerV2EntityCompany   = "company"
	CompanyExplorerV2EntityUserGroup = "user_group"
	CompanyExplorerV2EntityUser      = "user"
	CompanyExplorerV2EntityFolder    = "folder"
	CompanyExplorerV2EntityProject   = EntityTypeProject
	CompanyExplorerV2EntityLogicGate = EntityTypeLogicGate
	CompanyExplorerV2EntityNode      = EntityTypeNode
)

type CompanyExplorerV2RowsQuery struct {
	CompanyID        string
	View             string
	ScopeUserID      string
	PermissionUserID string
	ParentEntityID   string
}

type CompanyExplorerV2Rows struct {
	Rows []CompanyExplorerV2Row `json:"rows"`
}

type CompanyExplorerLocationSegment struct {
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id"`
	ResourceID string `json:"resource_id,omitempty"`
	Name       string `json:"name"`
}

type CompanyExplorerSearchQuery struct {
	CompanyID        string
	Query            string
	PermissionUserID string
	Limit            int
}

type CompanyExplorerSearchResult struct {
	CompanyID              string                           `json:"company_id"`
	ResourceType           string                           `json:"resource_type"`
	ResourceID             string                           `json:"resource_id"`
	EntityID               string                           `json:"entity_id"`
	DisplayName            string                           `json:"display_name"`
	MatchReason            string                           `json:"match_reason"`
	LocationPath           []CompanyExplorerLocationSegment `json:"location_path"`
	ProtectedDefaultFolder bool                             `json:"protected_default_folder,omitempty"`
	HasChildren            bool                             `json:"has_children"`
	CreatedTimestamp       time.Time                        `json:"created_timestamp"`
	UpdatedTimestamp       time.Time                        `json:"updated_timestamp"`
}

type CompanyExplorerSearchResults struct {
	Results []CompanyExplorerSearchResult `json:"results"`
}
type CompanyExplorerV2Row struct {
	CompanyID          string            `json:"company_id"`
	EntityID           string            `json:"entity_id"`
	EntityType         string            `json:"entity_type"`
	ResourceID         string            `json:"resource_id,omitempty"`
	Name               string            `json:"name"`
	ParentEntityID     string            `json:"parent_entity_id,omitempty"`
	EdgeID             string            `json:"edge_id,omitempty"`
	Position           int               `json:"position"`
	HasChildren        bool              `json:"has_children"`
	EffectiveAccess    string            `json:"effective_access,omitempty"`
	HasPermissionRules bool              `json:"has_permission_rules,omitempty"`
	NativeContext      map[string]string `json:"native_context,omitempty"`
	CreatedTimestamp   time.Time         `json:"created_timestamp"`
	UpdatedTimestamp   time.Time         `json:"updated_timestamp"`
}

type CompanyExplorerV2FolderInput struct {
	CompanyID        string
	ParentEntityID   string
	Name             string
	Position         int
	DefaultAccess    string
	ActorUserID      string
	PermissionUserID string
}

type CompanyExplorerV2FolderUpdateInput struct {
	CompanyID        string
	EntityID         string
	Name             string
	ActorUserID      string
	PermissionUserID string
}

type CompanyExplorerV2EdgeInput struct {
	CompanyID        string
	ParentEntityID   string
	ChildEntityID    string
	ChildEntityType  string
	ChildResourceID  string
	Position         int
	ActorUserID      string
	PermissionUserID string
}

type CompanyExplorerV2MoveEdgeInput struct {
	CompanyID        string
	EdgeID           string
	ParentEntityID   string
	Position         int
	ActorUserID      string
	PermissionUserID string
}

const (
	CompanyExplorerV2SubscriptionOwnerUser = "user"
	CompanyExplorerV2SubscriptionOwnerTeam = "team"
)

type CompanyExplorerV2Subscription struct {
	CompanyID        string    `json:"company_id"`
	SubscriptionID   string    `json:"subscription_id"`
	OwnerType        string    `json:"owner_type"`
	OwnerID          string    `json:"owner_id"`
	AnchorEntityID   string    `json:"anchor_entity_id"`
	Position         int       `json:"position"`
	CreatedByUserID  string    `json:"created_by_user_id,omitempty"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type CompanyExplorerV2SubscriptionInput struct {
	CompanyID        string
	OwnerType        string
	OwnerID          string
	AnchorEntityID   string
	Position         int
	ActorUserID      string
	PermissionUserID string
}

type MapLayoutRepository interface {
	ListNodeMapPositions(companyID string) ([]domain.NodeMapPosition, error)
	ListNodeMapPositionsInFolderSubtree(companyID, folderID string) ([]domain.NodeMapPosition, error)
	ListNodeMapPositionsWindow(query NodeMapWindowQuery) ([]domain.NodeMapPosition, error)
	UpsertNodeMapPositions(companyID string, positions []domain.NodeMapPosition) ([]domain.NodeMapPosition, error)
	ListLogicGateMapPositions(companyID string) ([]domain.LogicGateMapPosition, error)
	ListLogicGateMapPositionsInFolderSubtree(companyID, folderID string) ([]domain.LogicGateMapPosition, error)
	ListLogicGateMapPositionsWindow(query LogicGateMapWindowQuery) ([]domain.LogicGateMapPosition, error)
	UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error)
}

type WorkspaceEntityCommandRepository interface {
	CreateWorkspaceEntityBatch(input WorkspaceEntityBatchInput) (WorkspaceEntityBatchResult, error)
	CreateGVICMatrixNode(input GVICMatrixNodeCreateInput) (GVICMatrixNodeCreateResult, error)
}

type KanbanRepository interface {
	ListKanbanBoards(companyID string, query KanbanBoardQuery) ([]domain.KanbanBoard, error)
	EnsureLogicGateKanbanBoard(companyID, logicGateID, title string) (domain.KanbanBoard, error)
	CreateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error)
	CreateKanbanBoardWithWorkspaceEvent(companyID, boardID, title string, position int) (KanbanBoardWorkspaceEventResult, error)
	UpdateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error)
	UpdateKanbanBoardWithWorkspaceEvent(companyID, boardID, title string, position int) (KanbanBoardWorkspaceEventResult, error)
	DeleteKanbanBoard(companyID, boardID string) error
	DeleteKanbanBoardWithWorkspaceEvent(companyID, boardID string) (KanbanWorkspaceEventResult, error)
	ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error)
	CreateKanbanColumn(companyID, boardID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error)
	CreateKanbanColumnWithWorkspaceEvent(companyID, boardID, title string, position int, widthPx int, heightPx int, itemColor string) (KanbanColumnWorkspaceEventResult, error)
	UpdateKanbanColumn(companyID, boardID, columnID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error)
	UpdateKanbanColumnWithWorkspaceEvent(companyID, boardID, columnID, title string, position int, widthPx int, heightPx int, itemColor string) (KanbanColumnWorkspaceEventResult, error)
	DeleteKanbanColumn(companyID, boardID, columnID string) error
	DeleteKanbanColumnWithWorkspaceEvent(companyID, boardID, columnID string) (KanbanWorkspaceEventResult, error)
	ListKanbanCards(companyID, boardID string, query KanbanCardQuery) ([]domain.KanbanCard, error)
	GetKanbanCard(companyID, boardID, cardID string) (domain.KanbanCard, error)
	UpsertKanbanCard(input KanbanCardMutationInput) (domain.KanbanCard, error)
	UpsertKanbanCardWithWorkspaceEvent(input KanbanCardMutationInput) (KanbanCardWorkspaceEventResult, error)
	MoveKanbanCard(input KanbanCardMoveInput) (domain.KanbanCard, error)
	MoveKanbanCardWithWorkspaceEvent(input KanbanCardMoveInput) (KanbanCardWorkspaceEventResult, error)
	ListNodeLogicGateAssignments(companyID, nodeID string) ([]domain.NodeLogicGateAssignment, error)
	AssignNodeToLogicGateStatus(input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error)
	MoveLogicGateNodeAssignment(input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error)
	RemoveLogicGateNodeAssignment(input LogicGateNodeAssignmentRemoveInput) (LogicGateNodeAssignmentRemoveResult, error)
	SetLogicGateNodeAssignmentIssue(input LogicGateNodeAssignmentIssueInput) (LogicGateNodeAssignmentResult, error)
	DeleteKanbanCard(companyID, boardID, cardID string) error
	DeleteKanbanCardWithWorkspaceEvent(companyID, boardID, cardID string) (KanbanCardWorkspaceEventResult, error)
}

type NotificationRepository interface {
	GetNotificationDomainEventCheckpoint(companyID string) (NotificationDomainEventCheckpoint, bool, error)
	SaveNotificationDomainEventCheckpoint(checkpoint NotificationDomainEventCheckpoint) error
	CreateNotifications(input CreateNotificationsInput) ([]domain.Notification, error)
	ListNotifications(input NotificationListInput) ([]domain.Notification, error)
	ListUpdateRootGroups(input UpdatesQuery) ([]UpdatesNestedGroup, error)
	ListUpdateBranch(input UpdatesQuery) (UpdatesNestedGroup, error)
	GetNotificationSummary(input NotificationSummaryInput) (domain.NotificationSummary, error)
	CountUnreadNotifications(userID, companyID string) (int, error)
	MarkNotificationRead(userID, notificationID string, read bool) (domain.Notification, error)
	MarkNotificationsRead(input NotificationMarkReadInput) (int, error)
	MarkAllNotificationsRead(userID, companyID string) (int, error)
	DeleteNotifications(input NotificationDeleteInput) ([]domain.Notification, error)
	DeleteExpiredNotifications(olderThan time.Time, limit int) ([]domain.Notification, error)
}

type DomainEventRepository interface {
	AppendDomainEvent(input DomainEventInput) (domain.DomainEvent, error)
	AppendDomainEvents(inputs []DomainEventInput) ([]domain.DomainEvent, error)
	ListPendingDomainEvents(limit int) ([]domain.DomainEvent, error)
	ListDomainEventsAfter(query DomainEventReplayQuery) ([]domain.DomainEvent, error)
	ListDomainEventsForNotificationProjection(query DomainEventNotificationProjectionQuery) ([]domain.DomainEvent, error)
	LatestDomainEventForNotificationProjection(companyID string) (NotificationDomainEventCheckpoint, bool, error)
	CurrentDomainEventSequence(query DomainEventStreamQuery) (int64, error)
	CurrentWorkspaceReadVersion(query WorkspaceReadVersionQuery) (int64, bool, error)
	MarkDomainEventPublished(companyID, eventID string) error
}

type EventRepository interface {
	AppendEventRow(input EventRowInput) (EventRow, error)
	AppendEventRows(inputs []EventRowInput) ([]EventRow, error)
	ListEventRows(companyID string, limit int) ([]EventRow, error)
	CurrentEventRowSequence(companyID, sequenceScope string) (int64, error)
	ClaimAvailableEventRows(limit int, processingLeaseTimeout time.Duration) ([]EventRow, error)
	MarkEventRowProcessed(companyID, eventID string) error
	MarkEventRowFailed(companyID, eventID, lastError string, availableAt time.Time) error
}

type DeleteCompanyUserResult struct {
	User                   domain.CompanyUser `json:"user"`
	DeleteExternalIdentity bool               `json:"delete_external_identity"`
}

const WorkspaceEntityBatchMaxItems = 200

const WorkspaceEntityBatchMaxRelationships = 500

const CompanyExplorerFolderItemBatchMaxItems = 200

const NodeMapWindowDefaultLimit = 500

const NodeMapWindowMaxLimit = 1000

const LogicGateMapWindowDefaultLimit = 500

const LogicGateMapWindowMaxLimit = 1000

const LogicGateSearchDefaultLimit = 12

const LogicGateSearchMaxLimit = 50

const WorkItemInboxDefaultLimit = 100

const WorkItemInboxMaxLimit = 500

type LogicGateQuery struct {
	Search         string
	AssignedUserID string
	Limit          int
}

type WorkItemInboxQuery struct {
	CompanyID    string
	UserID       string
	ViewerUserID string
	Limit        int
}

type WorkItemLogicGateInboxItem struct {
	CompanyID        string                           `json:"company_id"`
	LogicGateID      string                           `json:"logic_gate_id"`
	Header           string                           `json:"header"`
	Roles            []string                         `json:"roles"`
	GVICAssignments  []domain.LogicGateGVICAssignment `json:"gvic_assignments,omitempty"`
	CreatedTimestamp time.Time                        `json:"created_timestamp"`
}

type MyWorkMatrixResponse struct {
	CompanyID string                    `json:"company_id"`
	UserID    string                    `json:"user_id"`
	Rows      []GVICMatrixProjectionRow `json:"rows"`
}
type ProjectionRow struct {
	CompanyID                    string           `json:"company_id"`
	ProjectionRowID              string           `json:"projection_row_id,omitempty"`
	ItemID                       string           `json:"item_id,omitempty"`
	UserID                       string           `json:"user_id,omitempty"`
	NodeName                     string           `json:"node_name,omitempty"`
	ProjectID                    string           `json:"project_id,omitempty"`
	ProjectName                  string           `json:"project_name,omitempty"`
	RelationshipID               string           `json:"relationship_id,omitempty"`
	ResourceType                 string           `json:"resource_type,omitempty"`
	ResourceID                   string           `json:"resource_id,omitempty"`
	GVICAssignment               string           `json:"gvic_assignment,omitempty"`
	ParentResourceType           string           `json:"parent_resource_type,omitempty"`
	ParentResourceID             string           `json:"parent_resource_id,omitempty"`
	NodeLeafID                   string           `json:"node_leaf_id,omitempty"`
	Depth                        int              `json:"depth,omitempty"`
	SortOrder                    int              `json:"sort_order,omitempty"`
	IsContainerRow               bool             `json:"is_container_row,omitempty"`
	Role                         string           `json:"role,omitempty"`
	PrincipalType                string           `json:"principal_type,omitempty"`
	PrincipalID                  string           `json:"principal_id,omitempty"`
	SourceResourceType           string           `json:"source_resource_type,omitempty"`
	SourceResourceID             string           `json:"source_resource_id,omitempty"`
	SourcePrincipalType          string           `json:"source_principal_type,omitempty"`
	SourcePrincipalID            string           `json:"source_principal_id,omitempty"`
	InheritanceType              string           `json:"inheritance_type,omitempty"`
	LogicGateID                  *string          `json:"logic_gate_id,omitempty"`
	RequestedByUserID            string           `json:"requested_by_user_id,omitempty"`
	PlacedByUserID               string           `json:"placed_by_user_id,omitempty"`
	LogicGateName                string           `json:"logic_gate_name,omitempty"`
	DisplayTitle                 string           `json:"display_title,omitempty"`
	Status                       *string          `json:"status,omitempty"`
	DueDate                      *string          `json:"due_date,omitempty"`
	Priority                     *int             `json:"priority,omitempty"`
	ResourceCreatedTimestamp     time.Time        `json:"resource_created_timestamp,omitempty"`
	RelationshipCreatedTimestamp time.Time        `json:"relationship_created_timestamp,omitempty"`
	RelationshipUpdatedTimestamp time.Time        `json:"relationship_updated_timestamp,omitempty"`
	CreatedTimestamp             time.Time        `json:"created_timestamp,omitempty"`
	UpdatedTimestamp             time.Time        `json:"updated_timestamp,omitempty"`
	BoardID                      string           `json:"board_id,omitempty"`
	CardID                       string           `json:"card_id,omitempty"`
	ColumnID                     string           `json:"column_id,omitempty"`
	NodeID                       string           `json:"node_id,omitempty"`
	StartDate                    string           `json:"start_date,omitempty"`
	EndDate                      string           `json:"end_date,omitempty"`
	DurationDays                 int              `json:"duration_days,omitempty"`
	NodeTitle                    string           `json:"node_title,omitempty"`
	DescriptionSnapshot          string           `json:"description_snapshot,omitempty"`
	IsIssue                      bool             `json:"is_issue,omitempty"`
	Position                     int              `json:"position,omitempty"`
	NodeCreatedTimestamp         time.Time        `json:"node_created_timestamp,omitempty"`
	NodeUpdatedTimestamp         time.Time        `json:"node_updated_timestamp,omitempty"`
	AssignmentID                 string           `json:"assignment_id,omitempty"`
	AssignmentCreatedTimestamp   time.Time        `json:"assignment_created_timestamp,omitempty"`
	AssignmentUpdatedTimestamp   time.Time        `json:"assignment_updated_timestamp,omitempty"`
	ProjectionUpdatedTimestamp   time.Time        `json:"projection_updated_timestamp,omitempty"`
	Accounts                     []domain.Account `json:"accounts,omitempty"`
}

type GVICMatrixProjectionRow = ProjectionRow

type GVICEffectiveAssignmentProjectionRow = ProjectionRow

type KanbanBoardProjectionRow = ProjectionRow

type ProjectManagementTimelineProjectionRow = ProjectionRow

type ProjectRelationshipProjectionRow = ProjectionRow

const (
	ProjectionNameGVICEffectiveAssignments  = "gvic_effective_assignments"
	ProjectionNameGVICMatrix                = "gvic_matrix"
	ProjectionNameKanbanBoard               = "kanban_board"
	ProjectionNameProjectManagementTimeline = "project_management_timeline"
	ProjectionNameProjectRelationship       = "project_relationship"

	ProjectionDeltaOperationUpsert = "upsert"
	ProjectionDeltaOperationDelete = "delete"
	ProjectionDeltaOperationPatch  = "patch"
)

type ProjectionRowKey struct {
	ProjectionRowID     string `json:"projection_row_id,omitempty"`
	ItemID              string `json:"item_id,omitempty"`
	UserID              string `json:"user_id,omitempty"`
	ProjectID           string `json:"project_id,omitempty"`
	RelationshipID      string `json:"relationship_id,omitempty"`
	ResourceType        string `json:"resource_type,omitempty"`
	ResourceID          string `json:"resource_id,omitempty"`
	GVICAssignment      string `json:"gvic_assignment,omitempty"`
	ParentResourceType  string `json:"parent_resource_type,omitempty"`
	ParentResourceID    string `json:"parent_resource_id,omitempty"`
	NodeLeafID          string `json:"node_leaf_id,omitempty"`
	Depth               int    `json:"depth,omitempty"`
	SortOrder           int    `json:"sort_order,omitempty"`
	IsContainerRow      bool   `json:"is_container_row,omitempty"`
	Role                string `json:"role,omitempty"`
	SourceResourceType  string `json:"source_resource_type,omitempty"`
	SourceResourceID    string `json:"source_resource_id,omitempty"`
	SourcePrincipalType string `json:"source_principal_type,omitempty"`
	SourcePrincipalID   string `json:"source_principal_id,omitempty"`
	InheritanceType     string `json:"inheritance_type,omitempty"`
	BoardID             string `json:"board_id,omitempty"`
	LogicGateID         string `json:"logic_gate_id,omitempty"`
	NodeID              string `json:"node_id,omitempty"`
	AssignmentID        string `json:"assignment_id,omitempty"`
	CardID              string `json:"card_id,omitempty"`
}

const ProjectManagementTimelineDefaultLimit = 500
const ProjectManagementTimelineMaxLimit = 1000
const ProjectManagementTimelineMaxDurationDays = 90

type ProjectManagementTimelineQuery struct {
	CompanyID    string
	UserID       string
	ViewerUserID string
	Limit        int
}

type ProjectManagementTimelineItemInput struct {
	CompanyID    string
	UserID       string
	ViewerUserID string
	ActorUserID  string
	ItemID       string
	EntityType   string
	EntityID     string
	StartDate    string
	DurationDays int
	Position     int
}

type ProjectManagementTimelineItemUpdateInput struct {
	CompanyID    string
	ViewerUserID string
	ActorUserID  string
	ItemID       string
	StartDate    string
	DurationDays int
	Position     int
}

type ProjectManagementTimelineItemDeleteInput struct {
	CompanyID    string
	ViewerUserID string
	ActorUserID  string
	ItemID       string
}

type ProjectManagementTimelineMutationResult struct {
	Item             *ProjectManagementTimelineProjectionRow `json:"item,omitempty"`
	DeletedItemID    string                                  `json:"deleted_item_id,omitempty"`
	UserID           string                                  `json:"user_id,omitempty"`
	ProjectionDeltas []ProjectionDelta                       `json:"-"`
}

type ProjectInput struct {
	CompanyID                       string
	ProjectID                       string
	Name                            string
	Status                          string
	Health                          string
	AccountIDs                      []string
	AccountIDsSet                   bool
	TeamIDs                         []string
	TeamIDsSet                      bool
	ActorUserID                     string
	CompanyExplorerDefaultPlacement bool
}

type ResourceGVICAssignmentInput struct {
	Role          string `json:"role"`
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
}

type ResourceGVICAssignmentUpdateInput struct {
	CompanyID      string
	ResourceType   string
	ResourceID     string
	Assignments    []ResourceGVICAssignmentInput
	ActorUserID    string
	IdempotencyKey string
}

type ResourceGVICAssignmentCommandInput struct {
	CompanyID      string
	ResourceType   string
	ResourceID     string
	Assignments    []ResourceGVICAssignmentInput
	ActorUserID    string
	IdempotencyKey string
}

type ResourceGVICAssignmentMutationResult struct {
	CompanyID            string                                   `json:"company_id"`
	ResourceType         string                                   `json:"resource_type"`
	ResourceID           string                                   `json:"resource_id"`
	Operation            string                                   `json:"operation,omitempty"`
	Changed              bool                                     `json:"changed"`
	GVICAssignments      []domain.ResourceGVICAssignment          `json:"gvic_assignments"`
	EffectiveAssignments []domain.ResourceGVICEffectiveAssignment `json:"effective_assignments,omitempty"`
	ProjectionDeltas     []ProjectionDelta                        `json:"-"`
	Events               []domain.DomainEvent                     `json:"-"`
}

type ProjectMutationResult struct {
	Project          *domain.Project                   `json:"project,omitempty"`
	DeletedID        string                            `json:"deleted_project_id,omitempty"`
	FolderItem       *domain.CompanyExplorerFolderItem `json:"folder_item,omitempty"`
	ProjectionDeltas []ProjectionDelta                 `json:"-"`
}

type ProjectInformationInput struct {
	CompanyID     string
	ProjectID     string
	InformationID string
	Type          string
	Information   string
	ActorUserID   string
}

type ProjectProjectionDeleteInput struct {
	CompanyID     string
	ProjectID     string
	InformationID string
	ActorUserID   string
}

type ProjectCriticalPathStepInput struct {
	CompanyID      string
	ProjectID      string
	StepID         string
	Name           string
	RelationshipID string
	DueDate        string
	OwnerType      string
	OwnerID        string
	Position       int
	IsCurrent      bool
	ActorUserID    string
}

type ProjectCriticalPathStepDeleteInput struct {
	CompanyID   string
	ProjectID   string
	StepID      string
	ActorUserID string
}

type ProjectRelationshipInput struct {
	CompanyID      string
	ProjectID      string
	RelationshipID string
	ResourceType   string
	ResourceID     string
	Position       int
	ActorUserID    string
}

type ProjectRelationshipDeleteInput struct {
	CompanyID      string
	ProjectID      string
	RelationshipID string
	ActorUserID    string
}

type ProjectRelationshipMutationResult struct {
	Relationship          *domain.ProjectRelationshipProjection `json:"relationship,omitempty"`
	DeletedRelationshipID string                                `json:"deleted_relationship_id,omitempty"`
}

type ProjectScopedInitialInformationInput struct {
	Type          string
	Information   string
	InformationID string
}

type ProjectScopedNodeCreateInput struct {
	CompanyID          string
	ProjectID          string
	NodeID             string
	Title              string
	Position           int
	InitialInformation *ProjectScopedInitialInformationInput
	InitialAssignment  *ProjectScopedNodeLogicGateAssignmentInput
	ActorUserID        string
	ActorDisplayName   string
	IdempotencyKey     string
}

type ProjectScopedNodeLogicGateAssignmentInput struct {
	LogicGateID string
	Status      string
	ColumnID    string
	Position    int
	Priority    *int
	IsIssue     *bool
}

type ProjectScopedNodeCreateResult struct {
	Node             domain.Node                           `json:"node"`
	Relationship     *domain.ProjectRelationshipProjection `json:"relationship,omitempty"`
	Information      *domain.NodeInformation               `json:"information,omitempty"`
	Assignment       *domain.NodeLogicGateAssignment       `json:"assignment,omitempty"`
	Card             *domain.KanbanCard                    `json:"card,omitempty"`
	Events           []domain.DomainEvent                  `json:"-"`
	ProjectionDeltas []ProjectionDelta                     `json:"-"`
}

type ProjectScopedLogicGateCreateInput struct {
	CompanyID          string
	ProjectID          string
	LogicGateID        string
	Header             string
	Position           int
	InitialInformation *ProjectScopedInitialInformationInput
	ActorUserID        string
	IdempotencyKey     string
}

type ProjectScopedLogicGateCreateResult struct {
	LogicGate        domain.LogicGate                      `json:"logic_gate"`
	Relationship     *domain.ProjectRelationshipProjection `json:"relationship,omitempty"`
	Information      *domain.LogicGateInformation          `json:"information,omitempty"`
	Events           []domain.DomainEvent                  `json:"-"`
	ProjectionDeltas []ProjectionDelta                     `json:"-"`
}

type AccountInput struct {
	CompanyID   string
	AccountID   string
	Name        string
	FolderID    *string
	FolderIDSet bool
	Position    int
	PositionSet bool
	ActorUserID string
}

type AccountMutationResult struct {
	Account          *domain.Account   `json:"account,omitempty"`
	DeletedAccountID string            `json:"deleted_account_id,omitempty"`
	ProjectionDeltas []ProjectionDelta `json:"-"`
}

type AccountFolderInput struct {
	CompanyID         string
	FolderID          string
	ParentFolderID    *string
	ParentFolderIDSet bool
	Name              string
	Position          int
	PositionSet       bool
}

type NodeAccountAssignmentUpdateInput struct {
	CompanyID   string
	NodeID      string
	AccountIDs  []string
	ActorUserID string
}

type NodeAccountAssignmentUpdateResult struct {
	Node             domain.Node                    `json:"node"`
	Assignments      []domain.NodeAccountAssignment `json:"assignments"`
	ProjectionDeltas []ProjectionDelta              `json:"-"`
	Events           []domain.DomainEvent           `json:"-"`
}

type ProjectionDelta struct {
	CompanyID          string           `json:"company_id"`
	Projection         string           `json:"projection"`
	ProjectionSequence int64            `json:"projection_sequence,omitempty"`
	Operation          string           `json:"operation"`
	RowKey             ProjectionRowKey `json:"row_key"`
	Row                *ProjectionRow   `json:"row,omitempty"`
	Patch              map[string]any   `json:"patch,omitempty"`
	ProjectedTimestamp time.Time        `json:"projected_timestamp"`
}

const CommunicationsTriageBatchMaxItems = 50
const UserLogicGateShortcutBatchMaxItems = 200

const (
	EntityTypeNode                  = "node"
	EntityTypeLogicGate             = "logic_gate"
	EntityTypeProject               = "project"
	EntityTypeCompanyExplorerFolder = "company_explorer_folder"
	EntityTypeSharedTriageFolder    = "shared_triage_folder"
	EntityTypeSharedInboxFolder     = "shared_inbox_folder"
	EntityTypeSharedInbox           = "shared_inbox"

	EntityPermissionNoAccess = "no_access"
	EntityPermissionView     = "view"
	EntityPermissionEdit     = "edit"
	EntityPermissionAdmin    = "admin"

	ResourceDefaultAccessEdit     = EntityPermissionEdit
	ResourceDefaultAccessNoAccess = EntityPermissionNoAccess

	EntityPermissionSubjectUser  = "user"
	EntityPermissionSubjectGroup = "group"

	EntityPermissionMaxAssignments = 1000
)

func NormalizeWorkItemInboxQuery(query WorkItemInboxQuery) WorkItemInboxQuery {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.UserID = strings.TrimSpace(query.UserID)
	query.ViewerUserID = strings.TrimSpace(query.ViewerUserID)
	if query.ViewerUserID == "" {
		query.ViewerUserID = query.UserID
	}
	if query.Limit <= 0 || query.Limit > WorkItemInboxMaxLimit {
		query.Limit = WorkItemInboxDefaultLimit
	}
	return query
}

func NormalizeProjectManagementTimelineQuery(query ProjectManagementTimelineQuery) ProjectManagementTimelineQuery {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.UserID = strings.TrimSpace(query.UserID)
	query.ViewerUserID = strings.TrimSpace(query.ViewerUserID)
	if query.ViewerUserID == "" {
		query.ViewerUserID = query.UserID
	}
	if query.Limit <= 0 || query.Limit > ProjectManagementTimelineMaxLimit {
		query.Limit = ProjectManagementTimelineDefaultLimit
	}
	return query
}

func NormalizeProjectManagementTimelineItemInput(input ProjectManagementTimelineItemInput) (ProjectManagementTimelineItemInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.UserID = strings.TrimSpace(input.UserID)
	input.ViewerUserID = strings.TrimSpace(input.ViewerUserID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.ItemID = strings.TrimSpace(input.ItemID)
	input.EntityID = strings.TrimSpace(input.EntityID)
	input.StartDate = strings.TrimSpace(input.StartDate)
	if input.ViewerUserID == "" {
		input.ViewerUserID = input.UserID
	}
	entityType, ok := NormalizeEntityType(input.EntityType)
	if !ok || (entityType != EntityTypeNode && entityType != EntityTypeLogicGate) {
		return ProjectManagementTimelineItemInput{}, ErrInvalid
	}
	input.EntityType = entityType
	input.DurationDays = NormalizeProjectManagementDurationDays(input.DurationDays)
	if input.CompanyID == "" || input.UserID == "" || input.EntityID == "" || input.StartDate == "" {
		return ProjectManagementTimelineItemInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeProjectManagementTimelineItemUpdateInput(input ProjectManagementTimelineItemUpdateInput) (ProjectManagementTimelineItemUpdateInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ViewerUserID = strings.TrimSpace(input.ViewerUserID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.ItemID = strings.TrimSpace(input.ItemID)
	input.StartDate = strings.TrimSpace(input.StartDate)
	input.DurationDays = NormalizeProjectManagementDurationDays(input.DurationDays)
	if input.CompanyID == "" || input.ItemID == "" || input.StartDate == "" {
		return ProjectManagementTimelineItemUpdateInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeProjectManagementTimelineItemDeleteInput(input ProjectManagementTimelineItemDeleteInput) (ProjectManagementTimelineItemDeleteInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ViewerUserID = strings.TrimSpace(input.ViewerUserID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.ItemID = strings.TrimSpace(input.ItemID)
	if input.CompanyID == "" || input.ItemID == "" {
		return ProjectManagementTimelineItemDeleteInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeProjectManagementDurationDays(durationDays int) int {
	if durationDays <= 0 {
		return 1
	}
	if durationDays > ProjectManagementTimelineMaxDurationDays {
		return ProjectManagementTimelineMaxDurationDays
	}
	return durationDays
}

type WorkspaceEntityBatchItemInput struct {
	ClientID string
	Title    string
	X        float64
	Y        float64
	Position int
}

type WorkspaceEntityBatchRelationshipInput struct {
	EntityIDA string
	EntityIDB string
	ClientIDA string
	ClientIDB string
	APosition string
	BPosition string
}

type WorkspaceEntityBatchInput struct {
	CompanyID                string
	EntityKind               string
	FolderID                 string
	MutationOrigin           string
	CreatorUserID            string
	CreatorLogicGateGVICRole string
	Items                    []WorkspaceEntityBatchItemInput
	Relationships            []WorkspaceEntityBatchRelationshipInput
	TimingRecorder           TimingRecorder
}

type WorkspaceEntityBatchEntityMapping struct {
	ClientID string `json:"client_id"`
	EntityID string `json:"entity_id"`
}

type DeferredCompanyExplorerFolderItemAssignment struct {
	FolderID        string
	SystemFolderKey string
	ItemType        string
	ItemID          string
	Position        int
}

type WorkspaceEntityBatchResult struct {
	CompanyID                     string                                        `json:"company_id"`
	EntityKind                    string                                        `json:"entity_kind"`
	EntityMappings                []WorkspaceEntityBatchEntityMapping           `json:"entity_mappings"`
	Nodes                         []domain.Node                                 `json:"nodes,omitempty"`
	LogicGates                    []domain.LogicGate                            `json:"logic_gates,omitempty"`
	Relationships                 []domain.NodeRelationship                     `json:"relationships,omitempty"`
	LogicGateRelationships        []domain.LogicGateRelationship                `json:"logic_gate_relationships,omitempty"`
	FolderItems                   []domain.CompanyExplorerFolderItem            `json:"folder_items,omitempty"`
	NodeMapPositions              []domain.NodeMapPosition                      `json:"node_map_positions,omitempty"`
	LogicGateMapPositions         []domain.LogicGateMapPosition                 `json:"logic_gate_map_positions,omitempty"`
	DeferredFolderItems           []DeferredCompanyExplorerFolderItemAssignment `json:"-"`
	DeferredNodeMapPositions      []domain.NodeMapPosition                      `json:"-"`
	DeferredLogicGateMapPositions []domain.LogicGateMapPosition                 `json:"-"`
}

type GVICMatrixNodeCreateInput struct {
	CompanyID                string
	NodeID                   string
	Title                    string
	LogicGateID              string
	CreateLogicGateHeader    string
	CreatorLogicGateGVICRole string
	MutationOrigin           string
	Status                   string
	ColumnID                 string
	DescriptionSnapshot      string
	Position                 int
	Priority                 *int
	PrioritySet              bool
	IsIssue                  bool
	IsIssueSet               bool
	ActorUserID              string
	IdempotencyKey           string
	TimingRecorder           TimingRecorder
}

type GVICMatrixNodeCreateResult struct {
	Node                     domain.Node                        `json:"node"`
	LogicGate                *domain.LogicGate                  `json:"logic_gate,omitempty"`
	Assignment               *domain.NodeLogicGateAssignment    `json:"assignment,omitempty"`
	Card                     *domain.KanbanCard                 `json:"card,omitempty"`
	FolderItems              []domain.CompanyExplorerFolderItem `json:"folder_items,omitempty"`
	GVICMatrixProjectionRows []GVICMatrixProjectionRow          `json:"gvic_projection_rows,omitempty"`
	ProjectionDeltas         []ProjectionDelta                  `json:"-"`
	Events                   []domain.DomainEvent               `json:"-"`
}
type NodeMapWindowBounds struct {
	MinX float64 `json:"min_x"`
	MinY float64 `json:"min_y"`
	MaxX float64 `json:"max_x"`
	MaxY float64 `json:"max_y"`
}

type NodeMapWindowQuery struct {
	CompanyID string
	FolderID  string
	Window    NodeMapWindowBounds
	Limit     int
}

type NodeMapWindowResult struct {
	CompanyID        string                             `json:"company_id"`
	FolderID         string                             `json:"folder_id"`
	Window           NodeMapWindowBounds                `json:"window"`
	Limit            int                                `json:"nodes_limit"`
	Nodes            []domain.Node                      `json:"nodes"`
	Relationships    []domain.NodeRelationship          `json:"relationships"`
	Folders          []domain.CompanyExplorerFolder     `json:"folders"`
	FolderItems      []domain.CompanyExplorerFolderItem `json:"folder_items"`
	NodeMapPositions []domain.NodeMapPosition           `json:"node_map_positions"`
}

func NormalizeNodeMapWindowQuery(query NodeMapWindowQuery) (NodeMapWindowQuery, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.FolderID = strings.TrimSpace(query.FolderID)
	if query.CompanyID == "" || query.FolderID == "" {
		return NodeMapWindowQuery{}, ErrInvalid
	}
	for _, value := range []float64{query.Window.MinX, query.Window.MinY, query.Window.MaxX, query.Window.MaxY} {
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return NodeMapWindowQuery{}, ErrInvalid
		}
	}
	if query.Window.MinX > query.Window.MaxX || query.Window.MinY > query.Window.MaxY {
		return NodeMapWindowQuery{}, ErrInvalid
	}
	if query.Limit <= 0 {
		query.Limit = NodeMapWindowDefaultLimit
	}
	if query.Limit > NodeMapWindowMaxLimit {
		query.Limit = NodeMapWindowMaxLimit
	}
	return query, nil
}

type LogicGateMapWindowQuery struct {
	CompanyID string
	FolderID  string
	Window    NodeMapWindowBounds
	Limit     int
}

type LogicGateMapWindowResult struct {
	CompanyID             string                             `json:"company_id"`
	FolderID              string                             `json:"folder_id"`
	Window                NodeMapWindowBounds                `json:"window"`
	Limit                 int                                `json:"logic_gates_limit"`
	LogicGates            []domain.LogicGate                 `json:"logic_gates"`
	Relationships         []domain.LogicGateRelationship     `json:"logic_gate_relationships"`
	Folders               []domain.CompanyExplorerFolder     `json:"folders"`
	FolderItems           []domain.CompanyExplorerFolderItem `json:"folder_items"`
	LogicGateMapPositions []domain.LogicGateMapPosition      `json:"logic_gate_map_positions"`
}

func NormalizeLogicGateMapWindowQuery(query LogicGateMapWindowQuery) (LogicGateMapWindowQuery, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.FolderID = strings.TrimSpace(query.FolderID)
	if query.CompanyID == "" || query.FolderID == "" {
		return LogicGateMapWindowQuery{}, ErrInvalid
	}
	for _, value := range []float64{query.Window.MinX, query.Window.MinY, query.Window.MaxX, query.Window.MaxY} {
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return LogicGateMapWindowQuery{}, ErrInvalid
		}
	}
	if query.Window.MinX > query.Window.MaxX || query.Window.MinY > query.Window.MaxY {
		return LogicGateMapWindowQuery{}, ErrInvalid
	}
	if query.Limit <= 0 {
		query.Limit = LogicGateMapWindowDefaultLimit
	}
	if query.Limit > LogicGateMapWindowMaxLimit {
		query.Limit = LogicGateMapWindowMaxLimit
	}
	return query, nil
}

type CompanyExplorerFolderItemAssignmentInput struct {
	FolderID string `json:"folder_id"`
	ItemType string `json:"item_type"`
	ItemID   string `json:"item_id"`
	Position int    `json:"position,omitempty"`
}

type CompanyExplorerFolderShareInput struct {
	CompanyID       string
	FolderID        string
	Email           string
	UserID          string
	InvitedByUserID string
}

type SharedInboxGVICAssignmentInput struct {
	Role          string `json:"role"`
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
	UserID        string `json:"user_id"`
}

type SharedInboxGVICAssignmentUpdateInput struct {
	CompanyID   string
	FolderID    string
	Assignments []SharedInboxGVICAssignmentInput
}

type CompanyExplorerDeleteTargetInput struct {
	Kind       string `json:"kind"`
	ID         string `json:"id"`
	FolderKind string `json:"folder_kind,omitempty"`
}

type CompanyExplorerDeletedTarget struct {
	Kind       string `json:"kind"`
	ID         string `json:"id"`
	FolderKind string `json:"folder_kind,omitempty"`
}

type CompanyExplorerDeleteResult struct {
	Targets []CompanyExplorerDeletedTarget `json:"targets"`
}

type CompanyExplorerRelationshipDeleteResult struct {
	ItemType        string   `json:"item_type"`
	ItemID          string   `json:"item_id"`
	RelationshipIDs []string `json:"relationship_ids"`
}

type RecycleBinRestoreResult struct {
	Items   []domain.RecycleBinItem        `json:"items"`
	Targets []CompanyExplorerDeletedTarget `json:"targets"`
}

type RecycleBinRepository interface {
	ListRecycleBinItems(companyID, deletedByUserID string) ([]domain.RecycleBinItem, error)
	RestoreRecycleBinItems(companyID, deletedByUserID string, itemIDs []string) (RecycleBinRestoreResult, error)
	PermanentlyDeleteRecycleBinItems(companyID, deletedByUserID string, itemIDs []string) error
}

const (
	CommunicationsEmailConversionTargetExistingLogicGate = "existing_logic_gate"
	CommunicationsEmailConversionTargetNewLogicGate      = "new_logic_gate"
	CommunicationsEmailConversionTargetExistingNode      = "existing_node"
	CommunicationsEmailConversionTargetFolder            = "folder"
	CommunicationsEmailConversionTargetProject           = "project"
)

type CommunicationsTriageConversionTarget struct {
	Mode           string `json:"mode"`
	LogicGateID    string `json:"logic_gate_id,omitempty"`
	NodeID         string `json:"node_id,omitempty"`
	FolderID       string `json:"folder_id,omitempty"`
	ProjectID      string `json:"project_id,omitempty"`
	ParentEntityID string `json:"parent_entity_id,omitempty"`
	Header         string `json:"header,omitempty"`
	Position       int    `json:"position,omitempty"`
}

type CommunicationsMessageReadStatusInput struct {
	ScopeType                string
	UserID                   string
	CompanyID                string
	CompanyEmailConnectionID string
	SharedInboxID            string
	MessageID                string
	ThreadID                 string
	Status                   string
	SignalTimestamp          time.Time
	SignalCount              int
}

type CommunicationsMessageReadStatusListInput struct {
	ScopeType                string
	UserID                   string
	CompanyID                string
	CompanyEmailConnectionID string
	MessageIDs               []string
}

type CommunicationsEmailConversionProvenance struct {
	CompanyID   string `json:"company_id"`
	UserID      string `json:"user_id"`
	MessageID   string `json:"message_id"`
	ThreadID    string `json:"thread_id,omitempty"`
	NodeID      string `json:"node_id"`
	BoardID     string `json:"board_id"`
	CardID      string `json:"card_id"`
	LogicGateID string `json:"logic_gate_id"`
}

type CommunicationsTriageConversionInput struct {
	UserID             string
	CompanyID          string
	ActorUserID        string
	PermissionUserID   string
	IdempotencyKey     string
	MessageIDs         []string
	Target             CommunicationsTriageConversionTarget
	LogicGateID        string
	NodeID             string
	NewLogicGateHeader string
	Status             string
	ColumnID           string
	Priority           *int
	PrioritySet        bool
}

type CommunicationsTriageConversionResult struct {
	Target               CommunicationsTriageConversionTarget      `json:"target"`
	LogicGate            domain.LogicGate                          `json:"logic_gate"`
	CreatedLogicGate     bool                                      `json:"created_logic_gate,omitempty"`
	Board                domain.KanbanBoard                        `json:"board"`
	Cards                []domain.KanbanCard                       `json:"cards"`
	Nodes                []domain.Node                             `json:"nodes"`
	Assignments          []domain.NodeLogicGateAssignment          `json:"assignments,omitempty"`
	EmailPlacements      []domain.CommunicationsEmailPlacement     `json:"email_placements,omitempty"`
	EmailProvenance      []CommunicationsEmailConversionProvenance `json:"email_provenance,omitempty"`
	FolderItems          []domain.CompanyExplorerFolderItem        `json:"folder_items,omitempty"`
	ExplorerV2Rows       []CompanyExplorerV2Row                    `json:"explorer_v2_rows,omitempty"`
	ProjectRelationships []domain.ProjectRelationshipProjection    `json:"project_relationships,omitempty"`
	DeletedMessageIDs    []string                                  `json:"deleted_message_ids"`
	Events               []domain.DomainEvent                      `json:"-"`
	ProjectionDeltas     []ProjectionDelta                         `json:"-"`
}

type CommunicationsTriageRevertInput struct {
	UserID    string
	CompanyID string
	BoardID   string
	CardID    string
}

type CommunicationsTriageRevertResult struct {
	TriageItem    domain.CommunicationsTriageItem `json:"triage_item"`
	DeletedNodeID string                          `json:"deleted_node_id"`
	DeletedCardID string                          `json:"deleted_card_id"`
	BoardID       string                          `json:"board_id"`
}

type CommunicationsEmailNodeTransferInput struct {
	UserID         string
	CompanyID      string
	SourceBoardID  string
	SourceCardID   string
	TargetBoardID  string
	TargetCardID   string
	ActorUserID    string
	IdempotencyKey string
}

type CommunicationsEmailNodeTransferResult struct {
	EmailPlacement domain.CommunicationsEmailPlacement `json:"email_placement"`
	DeletedNodeID  string                              `json:"deleted_node_id"`
	DeletedCardID  string                              `json:"deleted_card_id"`
	SourceBoardID  string                              `json:"source_board_id"`
	TargetNodeID   string                              `json:"target_node_id"`
	TargetBoardID  string                              `json:"target_board_id"`
	TargetCardID   string                              `json:"target_card_id"`
}

const KanbanMaxCardsLimit = 500

const KanbanMaxBoardsLimit = 200

const DefaultCompanyListLimit = 100
const CompanyListMaxLimit = 200

func NormalizeCompanyListLimit(limit int) int {
	if limit <= 0 {
		return DefaultCompanyListLimit
	}
	if limit > CompanyListMaxLimit {
		return CompanyListMaxLimit
	}
	return limit
}

const KanbanDefaultRequestedColor = "#facc15"
const KanbanDefaultBacklogColor = "#8b5cf6"
const KanbanDefaultPendingColor = "#808080"
const KanbanDefaultInProgressColor = "#ff9500"
const KanbanDefaultReviewColor = "#00aaff"
const KanbanDefaultDoneColor = "#39ff14"

type KanbanBoardQuery struct {
	AfterPosition int
	Limit         int
	LogicGateID   string
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
	IsIssue             bool
	IsIssueSet          bool
	RequestedByUserID   string
	PlacedByUserID      string
	CardID              string
}

type KanbanCardMoveInput struct {
	CompanyID string
	BoardID   string
	CardID    string
	ColumnID  string
	Position  int
	IsIssue   *bool
}

type LogicGateNodeAssignmentInput struct {
	CompanyID           string
	LogicGateID         string
	NodeID              string
	Status              string
	ColumnID            string
	MutationOrigin      string
	NodeTitle           string
	CreateNodeTitle     string
	DescriptionSnapshot string
	Position            int
	Priority            *int
	PrioritySet         bool
	IsIssue             bool
	IsIssueSet          bool
	ActorUserID         string
	IdempotencyKey      string
	TimingRecorder      TimingRecorder
}

type LogicGateNodeAssignmentMoveInput struct {
	CompanyID       string
	LogicGateID     string
	FromLogicGateID string
	NodeID          string
	Status          string
	ColumnID        string
	MutationOrigin  string
	Position        int
	Priority        *int
	PrioritySet     bool
	ActorUserID     string
	IdempotencyKey  string
	TimingRecorder  TimingRecorder
}

type LogicGateNodeAssignmentRemoveInput struct {
	CompanyID      string
	LogicGateID    string
	NodeID         string
	FallbackStatus *string
	ActorUserID    string
	IdempotencyKey string
}

type LogicGateNodeAssignmentIssueInput struct {
	CompanyID      string
	LogicGateID    string
	NodeID         string
	IsIssue        bool
	ActorUserID    string
	IdempotencyKey string
}

type LogicGateNodeAssignmentResult struct {
	Card                     domain.KanbanCard              `json:"card"`
	Node                     domain.Node                    `json:"node"`
	Assignment               domain.NodeLogicGateAssignment `json:"-"`
	GVICMatrixProjectionRows []GVICMatrixProjectionRow      `json:"gvic_projection_rows,omitempty"`
	ProjectionDeltas         []ProjectionDelta              `json:"-"`
	Events                   []domain.DomainEvent           `json:"-"`
}

type LogicGateNodeAssignmentRemoveResult struct {
	Card                     domain.KanbanCard              `json:"card"`
	Node                     domain.Node                    `json:"node"`
	Assignment               domain.NodeLogicGateAssignment `json:"-"`
	GVICMatrixProjectionRows []GVICMatrixProjectionRow      `json:"gvic_projection_rows,omitempty"`
	ProjectionDeltas         []ProjectionDelta              `json:"-"`
	Events                   []domain.DomainEvent           `json:"-"`
}

type KanbanWorkspaceEventResult struct {
	Events []domain.DomainEvent `json:"-"`
}

type KanbanBoardWorkspaceEventResult struct {
	Board  domain.KanbanBoard   `json:"board"`
	Events []domain.DomainEvent `json:"-"`
}

type KanbanColumnWorkspaceEventResult struct {
	Column domain.KanbanColumn  `json:"column"`
	Events []domain.DomainEvent `json:"-"`
}

type KanbanCardWorkspaceEventResult struct {
	Card        domain.KanbanCard    `json:"card"`
	DerivedNode *domain.Node         `json:"-"`
	Events      []domain.DomainEvent `json:"-"`
}

const NotificationListMaxLimit = 100
const NotificationCleanupMaxLimit = 1000

const DefaultNotificationRetentionDuration = 30 * 24 * time.Hour

type NotificationCreateInput struct {
	CompanyID       string
	RecipientUserID string
	ActorUserID     string
	Type            string
	SourceEventID   string
	EntityType      string
	EntityID        string
	Title           string
	BodyPreview     string
	Surface         string
	Role            string
	LogicGateID     string
	NodeID          string
	InformationID   string
}

type CreateNotificationsInput struct {
	Notifications  []NotificationCreateInput
	TimingRecorder TimingRecorder
}

type NotificationListInput struct {
	UserID           string
	CompanyID        string
	NotificationType string
	UnreadOnly       bool
	Limit            int
}

type UpdatesQuery struct {
	UserID    string
	CompanyID string
	Filter    string
	RootID    string
}

type UpdatesNestedGroup struct {
	ID            string                `json:"id"`
	Key           string                `json:"key"`
	Field         string                `json:"field"`
	Label         string                `json:"label"`
	ResourceType  string                `json:"resource_type,omitempty"`
	ResourceID    string                `json:"resource_id,omitempty"`
	Depth         int                   `json:"depth"`
	Groups        []UpdatesNestedGroup  `json:"groups"`
	Notifications []domain.Notification `json:"notifications,omitempty"`
}

type NotificationMarkReadInput struct {
	UserID           string
	CompanyID        string
	NotificationType string
	Surface          string
	Role             string
	LogicGateID      string
	NodeID           string
}

type NotificationDeleteInput struct {
	UserID           string
	CompanyID        string
	NotificationID   string
	NotificationType string
	Surface          string
	Role             string
	LogicGateID      string
	NodeID           string
}

type NotificationSummaryInput struct {
	UserID    string
	CompanyID string
}

type NotificationDomainEventCheckpoint struct {
	CompanyID        string
	CreatedTimestamp time.Time
	EventID          string
}

type DomainEventNotificationProjectionQuery struct {
	CompanyID             string
	AfterCreatedTimestamp time.Time
	AfterEventID          string
	Limit                 int
}

func NormalizeNotificationListLimit(limit int) int {
	if limit <= 0 || limit > NotificationListMaxLimit {
		return 50
	}
	return limit
}

func NormalizeNotificationCleanupLimit(limit int) int {
	if limit <= 0 || limit > NotificationCleanupMaxLimit {
		return 500
	}
	return limit
}

func NormalizeNotificationRetentionDuration(retention time.Duration) time.Duration {
	if retention <= 0 {
		return DefaultNotificationRetentionDuration
	}
	return retention
}

type UpdateNodeInput struct {
	CompanyID        string
	NodeID           string
	Title            string
	TitleSet         bool
	Status           *string
	StatusSet        bool
	DueDate          *string
	DueDateSet       bool
	Priority         *int
	PrioritySet      bool
	ActorUserID      string
	ActorDisplayName string
}

type NodeInformationInput struct {
	CompanyID        string
	NodeID           string
	Type             string
	Information      string
	InformationID    string
	ActorUserID      string
	ActorDisplayName string
}

type NodeProjectionDeleteInput struct {
	CompanyID        string
	NodeID           string
	InformationID    string
	ActorUserID      string
	ActorDisplayName string
}

type NodeContentChangeListInput struct {
	CompanyID string
	NodeID    string
	UserID    string
}

type NodeContentChangeSeenInput struct {
	CompanyID string
	NodeID    string
	ChangeID  string
	UserID    string
}

type NodeViewInput struct {
	CompanyID string
	NodeID    string
	UserID    string
}

type LogicGateGVICAssignmentInput struct {
	Role          string `json:"role"`
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
	UserID        string `json:"user_id"`
}

type LogicGateGVICAssignmentUpdateInput struct {
	CompanyID   string
	LogicGateID string
	Assignments []LogicGateGVICAssignmentInput
}

const (
	LogicGateGVICCommandAdd    = "add"
	LogicGateGVICCommandRemove = "remove"
)

type LogicGateGVICAssignmentCommandInput struct {
	CompanyID      string
	LogicGateID    string
	Assignments    []LogicGateGVICAssignmentInput
	ActorUserID    string
	IdempotencyKey string
}

type LogicGateGVICAssignmentCommandResult struct {
	CompanyID         string                           `json:"company_id"`
	LogicGateID       string                           `json:"logic_gate_id"`
	Operation         string                           `json:"operation"`
	Changed           bool                             `json:"changed"`
	GVICAssignments   []domain.LogicGateGVICAssignment `json:"gvic_assignments"`
	BeforeAssignments []domain.LogicGateGVICAssignment `json:"-"`
	ProjectionDeltas  []ProjectionDelta                `json:"-"`
	Events            []domain.DomainEvent             `json:"-"`
}

type EntityPermissionInput struct {
	SubjectType string `json:"subject_type"`
	SubjectID   string `json:"subject_id"`
	Permission  string `json:"permission"`
	AccessLevel string `json:"access_level"`
}

type EntityPermissionUpdateInput struct {
	CompanyID        string
	EntityType       string
	EntityID         string
	DefaultAccess    string
	DefaultAccessSet bool
	OverrideUserIDs  []string
	Permissions      []EntityPermissionInput
	ActorUserID      string
}

type CreateInvitationInput struct {
	CompanyID       string
	Email           string
	Role            string
	InvitedByUserID string
	ExpiresIn       time.Duration
}

type InvitationDeliveryStatusInput struct {
	InvitationID      string
	CognitoStatus     string
	CognitoError      string
	InviteEmailStatus string
	InviteEmailError  string
}

type UserEmailConnectionInput struct {
	UserID       string
	Provider     string
	AccountEmail string
	Scope        string
	GrantID      string
	Status       string
}

type CompanyEmailConnectionInput struct {
	CompanyEmailConnectionID string
	CompanyID                string
	Provider                 string
	AccountEmail             string
	GrantID                  string
	Status                   string
	ConnectedByUserID        string
}

func NormalizeKanbanBoardQuery(query KanbanBoardQuery) KanbanBoardQuery {
	query.LogicGateID = strings.TrimSpace(query.LogicGateID)
	if query.AfterPosition < 0 {
		query.AfterPosition = 0
	}
	if query.Limit <= 0 || query.Limit > KanbanMaxBoardsLimit {
		query.Limit = 100
	}
	return query
}

func NormalizeGVICRole(role string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case domain.GVICRoleGenerated:
		return domain.GVICRoleGenerated, true
	case domain.GVICRoleVerified:
		return domain.GVICRoleVerified, true
	case domain.GVICRoleConsulted:
		return domain.GVICRoleConsulted, true
	case domain.GVICRoleInformed:
		return domain.GVICRoleInformed, true
	default:
		return "", false
	}
}

func GVICRoleAccessLevel(role string) (string, bool) {
	role, ok := NormalizeGVICRole(role)
	if !ok {
		return "", false
	}
	switch role {
	case domain.GVICRoleGenerated, domain.GVICRoleVerified:
		return EntityPermissionEdit, true
	case domain.GVICRoleConsulted, domain.GVICRoleInformed:
		return EntityPermissionView, true
	default:
		return "", false
	}
}

func NormalizeGVICResourceType(resourceType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(resourceType)) {
	case EntityTypeNode:
		return EntityTypeNode, true
	case EntityTypeLogicGate:
		return EntityTypeLogicGate, true
	case EntityTypeProject:
		return EntityTypeProject, true
	case EntityTypeSharedTriageFolder:
		return EntityTypeSharedTriageFolder, true
	case EntityTypeSharedInbox:
		return EntityTypeSharedInbox, true
	default:
		return "", false
	}
}

func NormalizeGVICPrincipalType(principalType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(principalType)) {
	case EntityPermissionSubjectUser:
		return EntityPermissionSubjectUser, true
	case EntityPermissionSubjectGroup:
		return EntityPermissionSubjectGroup, true
	default:
		return "", false
	}
}

func NormalizeEntityType(entityType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(entityType)) {
	case EntityTypeNode:
		return EntityTypeNode, true
	case EntityTypeLogicGate:
		return EntityTypeLogicGate, true
	case EntityTypeProject:
		return EntityTypeProject, true
	case EntityTypeCompanyExplorerFolder, "folder", "company_folder":
		return EntityTypeCompanyExplorerFolder, true
	case EntityTypeSharedInboxFolder, EntityTypeSharedTriageFolder, "communications_folder":
		return EntityTypeSharedInboxFolder, true
	case EntityTypeSharedInbox:
		return EntityTypeSharedInbox, true
	default:
		return "", false
	}
}

func NormalizeEntityPermissionSubjectType(subjectType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(subjectType)) {
	case EntityPermissionSubjectUser:
		return EntityPermissionSubjectUser, true
	case EntityPermissionSubjectGroup:
		return EntityPermissionSubjectGroup, true
	default:
		return "", false
	}
}

func NormalizeEntityPermission(permission string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(permission)) {
	case "", EntityPermissionView:
		return EntityPermissionView, true
	case EntityPermissionNoAccess:
		return EntityPermissionNoAccess, true
	case EntityPermissionEdit:
		return EntityPermissionEdit, true
	case EntityPermissionAdmin, "manage":
		return EntityPermissionAdmin, true
	default:
		return "", false
	}
}

func NormalizeResourceDefaultAccess(access string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(access)) {
	case "", ResourceDefaultAccessEdit:
		return ResourceDefaultAccessEdit, true
	case ResourceDefaultAccessNoAccess:
		return ResourceDefaultAccessNoAccess, true
	default:
		return "", false
	}
}

func OppositeResourceDefaultAccess(access string) string {
	access, ok := NormalizeResourceDefaultAccess(access)
	if !ok || access == ResourceDefaultAccessEdit {
		return ResourceDefaultAccessNoAccess
	}
	return ResourceDefaultAccessEdit
}

func EntityPermissionRank(permission string) int {
	if strings.TrimSpace(permission) == "" {
		return 0
	}
	permission, ok := NormalizeEntityPermission(permission)
	if !ok {
		return 0
	}
	switch permission {
	case EntityPermissionNoAccess:
		return 0
	case EntityPermissionView:
		return 1
	case EntityPermissionEdit:
		return 2
	case EntityPermissionAdmin:
		return 3
	default:
		return 0
	}
}

func EntityPermissionSatisfies(grant, required string) bool {
	return EntityPermissionRank(grant) >= EntityPermissionRank(required) && EntityPermissionRank(required) > 0
}

func LogicGateKanbanBoardID(logicGateID string) string {
	return "logic-gate:" + strings.TrimSpace(logicGateID)
}

func IsLogicGateKanbanBoardID(boardID string) bool {
	return strings.HasPrefix(strings.TrimSpace(boardID), "logic-gate:")
}

func LogicGateIDFromKanbanBoardID(boardID string) string {
	boardID = strings.TrimSpace(boardID)
	if !IsLogicGateKanbanBoardID(boardID) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(boardID, "logic-gate:"))
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
	if widthPx > 2000 {
		return 2000
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
	if heightPx > 10000 {
		return 10000
	}
	return heightPx
}

func normalizeKanbanColumnItemColor(itemColor string) string {
	itemColor = strings.TrimSpace(itemColor)
	if len(itemColor) != 7 || itemColor[0] != '#' {
		return "#fbb152"
	}
	for _, char := range itemColor[1:] {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F') {
			continue
		}
		return "#fbb152"
	}
	return itemColor
}
