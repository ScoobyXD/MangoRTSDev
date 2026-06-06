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
	ErrAssigneeNotInCompany          = errors.New("assignee not in company")
	ErrRaciStorageUnavailable        = errors.New("raci storage unavailable")
	ErrSharedInboxStorageUnavailable = errors.New("shared inbox storage unavailable")
	ErrEmailAccountUnavailable       = errors.New("email account unavailable")
)

type Repository interface {
	IdentityRepository
	CommunicationsRepository
	WorkGraphRepository
	LogicGateRepository
	EntityPermissionRepository
	EffectiveAccessRepository
	ConsolidatedViewRepository
	LogicGateWorkRepository
	WorkItemReadRepository
	CompanyExplorerRepository
	MapLayoutRepository
	WorkspaceEntityCommandRepository
	KanbanRepository
	NotificationRepository
	DomainEventRepository
	EventRepository
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
	DeleteCompanyUser(companyID, userID string) (DeleteCompanyUserResult, error)
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
	GetCompanyEmailConnectionByAccountEmail(companyID, accountEmail string) (domain.UserEmailConnection, error)
	GetUserEmailConnectionByGrantID(grantID string) (domain.UserEmailConnection, error)
	UpsertUserEmailConnection(input UserEmailConnectionInput) (domain.UserEmailConnection, error)
	UpdateUserEmailConnectionStatus(userID, status string) (domain.UserEmailConnection, error)
	DeleteUserEmailConnection(userID string) error
}

type CommunicationsRepository interface {
	ListCommunicationsTriageItems(userID string) ([]domain.CommunicationsTriageItem, error)
	UpsertCommunicationsTriageItem(userID string, message domain.EmailMessageSnapshot) (domain.CommunicationsTriageItem, error)
	DeleteCommunicationsTriageItem(userID, messageID string) error
	ConvertCommunicationsTriageItems(input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error)
	RevertCommunicationsTriageNode(input CommunicationsTriageRevertInput) (CommunicationsTriageRevertResult, error)
	ListCommunicationsEmailPlacements(userID, companyID string, messageIDs []string) ([]domain.CommunicationsEmailPlacement, error)
	ListUserLogicGateShortcuts(userID, companyID string) ([]domain.UserLogicGateShortcut, error)
	UpsertUserLogicGateShortcuts(userID, companyID string, logicGateIDs []string) ([]domain.UserLogicGateShortcut, error)
	DeleteUserLogicGateShortcut(userID, companyID, logicGateID string) error
}

type WorkGraphRepository interface {
	CreateNode(companyID, title string) (domain.Node, error)
	CreateNodeWithAssignee(companyID, title, assigneeUserID string) (domain.Node, error)
	CreateNodeWithAssigneeAndWorkspaceEvent(companyID, title, assigneeUserID string) (domain.Node, domain.DomainEvent, error)
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
	SetLogicGateRaciAssignments(input LogicGateRaciAssignmentUpdateInput) ([]domain.LogicGateRaciAssignment, error)
	AddLogicGateRaciAssignments(input LogicGateRaciAssignmentCommandInput) (LogicGateRaciAssignmentCommandResult, error)
	RemoveLogicGateRaciAssignments(input LogicGateRaciAssignmentCommandInput) (LogicGateRaciAssignmentCommandResult, error)
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

type LogicGateWorkRepository interface {
	GetLogicGateWork(companyID, logicGateID string) (domain.LogicGateWorkView, error)
}

type WorkItemReadRepository interface {
	ListResponsibleInboxNodes(query WorkItemInboxQuery) ([]domain.Node, error)
	ListResponsibleInboxNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error)
	ListACIInboxLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error)
	ListACIInboxLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error)
	ListMyNodes(query WorkItemInboxQuery) ([]domain.Node, error)
	ListMyNodesContext(ctx context.Context, query WorkItemInboxQuery) ([]domain.Node, error)
	ListMyLogicGates(query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error)
	ListMyLogicGatesContext(ctx context.Context, query WorkItemInboxQuery) ([]WorkItemLogicGateInboxItem, error)
	ListRacioMatrixProjectionRowsForUser(query WorkItemInboxQuery) ([]RacioMatrixProjectionRow, error)
	ListRacioMatrixProjectionRowsForResources(companyID string, nodeIDs, logicGateIDs []string) ([]RacioMatrixProjectionRow, error)
	ListRacioMatrixProjectionRowsForLogicGate(companyID, logicGateID string) ([]RacioMatrixProjectionRow, error)
	ListKanbanBoardProjectionRows(companyID, logicGateID string, query KanbanCardQuery) ([]KanbanBoardProjectionRow, error)
	ListKanbanBoardProjectionRowsForNode(companyID, nodeID string) ([]KanbanBoardProjectionRow, error)
	ListKanbanBoardProjectionRowsForLogicGate(companyID, logicGateID string) ([]KanbanBoardProjectionRow, error)
	CurrentProjectionSequence(companyID, projectionName, projectionScope string) (int64, error)
	NextProjectionSequence(companyID, projectionName, projectionScope string) (int64, error)
}

type CompanyExplorerRepository interface {
	CreateCompanyExplorerFolder(companyID, parentFolderID, folderKind, name string) (domain.CompanyExplorerFolder, error)
	ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error)
	ListVisibleCompanyExplorerFolders(companyID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error)
	ListCompanyExplorerFolderSubtree(companyID, folderID, folderKind string) ([]domain.CompanyExplorerFolder, error)
	ListVisibleCompanyExplorerFolderSubtree(companyID, folderID, folderKind, userID string) ([]domain.CompanyExplorerFolder, error)
	MoveCompanyExplorerFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error)
	RenameCompanyExplorerFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error)
	DeleteCompanyExplorerFolder(companyID, folderID string) error
	DeleteCompanyExplorerTargets(companyID string, targets []CompanyExplorerDeleteTargetInput) (CompanyExplorerDeleteResult, error)
	SetCommunicationsSharedInboxAccountEmail(companyID, folderID, accountEmail string) (domain.CompanyExplorerFolder, error)
	SetCommunicationsSharedInboxRaciAssignments(input SharedInboxRaciAssignmentUpdateInput) ([]domain.SharedInboxRaciAssignment, error)
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
	ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType string) ([]domain.CompanyExplorerFolderItem, error)
	ListVisibleCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType, userID string) ([]domain.CompanyExplorerFolderItem, error)
	RemoveCompanyExplorerFolderItem(companyID, itemType, itemID string) error
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
	CreateRacioMatrixNode(input RacioMatrixNodeCreateInput) (RacioMatrixNodeCreateResult, error)
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
	CompanyID string
	UserID    string
	Limit     int
}

type WorkItemLogicGateInboxItem struct {
	CompanyID        string                           `json:"company_id"`
	LogicGateID      string                           `json:"logic_gate_id"`
	Header           string                           `json:"header"`
	Roles            []string                         `json:"roles"`
	RaciAssignments  []domain.LogicGateRaciAssignment `json:"raci_assignments,omitempty"`
	CreatedTimestamp time.Time                        `json:"created_timestamp"`
}

type ProjectionRow struct {
	CompanyID                  string    `json:"company_id"`
	UserID                     string    `json:"user_id,omitempty"`
	ResourceType               string    `json:"resource_type,omitempty"`
	ResourceID                 string    `json:"resource_id,omitempty"`
	LogicGateID                *string   `json:"logic_gate_id,omitempty"`
	DisplayTitle               string    `json:"display_title,omitempty"`
	Status                     *string   `json:"status,omitempty"`
	StatusColor                *string   `json:"status_color,omitempty"`
	DueDate                    *string   `json:"due_date,omitempty"`
	Priority                   *int      `json:"priority,omitempty"`
	AssigneeUserID             *string   `json:"assignee_user_id,omitempty"`
	AssigneeDisplayName        *string   `json:"assignee_display_name,omitempty"`
	AssigneeEmail              *string   `json:"assignee_email,omitempty"`
	ResourceCreatedTimestamp   time.Time `json:"resource_created_timestamp,omitempty"`
	CreatedTimestamp           time.Time `json:"created_timestamp,omitempty"`
	UpdatedTimestamp           time.Time `json:"updated_timestamp,omitempty"`
	BoardID                    string    `json:"board_id,omitempty"`
	CardID                     string    `json:"card_id,omitempty"`
	ColumnID                   string    `json:"column_id,omitempty"`
	NodeID                     string    `json:"node_id,omitempty"`
	NodeTitle                  string    `json:"node_title,omitempty"`
	DescriptionSnapshot        string    `json:"description_snapshot,omitempty"`
	IsIssue                    bool      `json:"is_issue,omitempty"`
	Position                   int       `json:"position,omitempty"`
	NodeCreatedTimestamp       time.Time `json:"node_created_timestamp,omitempty"`
	NodeUpdatedTimestamp       time.Time `json:"node_updated_timestamp,omitempty"`
	AssignmentID               string    `json:"assignment_id,omitempty"`
	AssignmentCreatedTimestamp time.Time `json:"assignment_created_timestamp,omitempty"`
	AssignmentUpdatedTimestamp time.Time `json:"assignment_updated_timestamp,omitempty"`
	ProjectionUpdatedTimestamp time.Time `json:"projection_updated_timestamp,omitempty"`
}

type RacioMatrixProjectionRow = ProjectionRow

type KanbanBoardProjectionRow = ProjectionRow

const (
	ProjectionNameRacioMatrix = "racio_matrix"
	ProjectionNameKanbanBoard = "kanban_board"

	ProjectionDeltaOperationUpsert = "upsert"
	ProjectionDeltaOperationDelete = "delete"
	ProjectionDeltaOperationPatch  = "patch"
)

type ProjectionRowKey struct {
	UserID       string `json:"user_id,omitempty"`
	ResourceType string `json:"resource_type,omitempty"`
	ResourceID   string `json:"resource_id,omitempty"`
	BoardID      string `json:"board_id,omitempty"`
	LogicGateID  string `json:"logic_gate_id,omitempty"`
	NodeID       string `json:"node_id,omitempty"`
	CardID       string `json:"card_id,omitempty"`
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
	EntityTypeNode               = "node"
	EntityTypeLogicGate          = "logic_gate"
	EntityTypeSharedTriageFolder = "shared_triage_folder"

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
	if query.Limit <= 0 || query.Limit > WorkItemInboxMaxLimit {
		query.Limit = WorkItemInboxDefaultLimit
	}
	return query
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
	CreatorLogicGateRaciRole string
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

type RacioMatrixNodeCreateInput struct {
	CompanyID                string
	NodeID                   string
	Title                    string
	LogicGateID              string
	CreateLogicGateHeader    string
	CreatorLogicGateRaciRole string
	MutationOrigin           string
	Status                   string
	ColumnID                 string
	DescriptionSnapshot      string
	Position                 int
	Priority                 *int
	PrioritySet              bool
	IsIssue                  bool
	IsIssueSet               bool
	AssigneePolicy           string
	ActorUserID              string
	IdempotencyKey           string
	TimingRecorder           TimingRecorder
}

type RacioMatrixNodeCreateResult struct {
	Node                domain.Node                        `json:"node"`
	LogicGate           *domain.LogicGate                  `json:"logic_gate,omitempty"`
	Assignment          *domain.NodeLogicGateAssignment    `json:"assignment,omitempty"`
	Card                *domain.KanbanCard                 `json:"card,omitempty"`
	FolderItems         []domain.CompanyExplorerFolderItem `json:"folder_items,omitempty"`
	RacioProjectionRows []RacioMatrixProjectionRow         `json:"racio_projection_rows,omitempty"`
	ProjectionDeltas    []ProjectionDelta                  `json:"-"`
	Events              []domain.DomainEvent               `json:"-"`
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

type SharedInboxRaciAssignmentInput struct {
	Role        string `json:"role"`
	SubjectType string `json:"subject_type"`
	SubjectID   string `json:"subject_id"`
	UserID      string `json:"user_id"`
}

type SharedInboxRaciAssignmentUpdateInput struct {
	CompanyID   string
	FolderID    string
	Assignments []SharedInboxRaciAssignmentInput
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

const (
	CommunicationsEmailConversionTargetExistingLogicGate = "existing_logic_gate"
	CommunicationsEmailConversionTargetNewLogicGate      = "new_logic_gate"
	CommunicationsEmailConversionTargetExistingNode      = "existing_node"
)

type CommunicationsTriageConversionTarget struct {
	Mode        string `json:"mode"`
	LogicGateID string `json:"logic_gate_id,omitempty"`
	NodeID      string `json:"node_id,omitempty"`
	Header      string `json:"header,omitempty"`
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
	Target            CommunicationsTriageConversionTarget      `json:"target"`
	LogicGate         domain.LogicGate                          `json:"logic_gate"`
	CreatedLogicGate  bool                                      `json:"created_logic_gate,omitempty"`
	Board             domain.KanbanBoard                        `json:"board"`
	Cards             []domain.KanbanCard                       `json:"cards"`
	Nodes             []domain.Node                             `json:"nodes"`
	Assignments       []domain.NodeLogicGateAssignment          `json:"assignments,omitempty"`
	EmailPlacements   []domain.CommunicationsEmailPlacement     `json:"email_placements,omitempty"`
	EmailProvenance   []CommunicationsEmailConversionProvenance `json:"email_provenance,omitempty"`
	FolderItems       []domain.CompanyExplorerFolderItem        `json:"folder_items,omitempty"`
	DeletedMessageIDs []string                                  `json:"deleted_message_ids"`
	Events            []domain.DomainEvent                      `json:"-"`
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

const KanbanDefaultBacklogColor = "#8b5cf6"
const KanbanDefaultPendingColor = "#808080"
const KanbanDefaultInProgressColor = "#ff9500"
const KanbanDefaultVerifyColor = "#00aaff"
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

const LogicGateAssignmentAssigneePolicyFirstResponsible = "first_responsible"

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
	AssigneePolicy      string
	ActorUserID         string
	IdempotencyKey      string
	TimingRecorder      TimingRecorder
}

type LogicGateNodeAssignmentMoveInput struct {
	CompanyID         string
	LogicGateID       string
	FromLogicGateID   string
	NodeID            string
	Status            string
	ColumnID          string
	MutationOrigin    string
	Position          int
	Priority          *int
	PrioritySet       bool
	AssigneePolicy    string
	AssigneePolicySet bool
	ActorUserID       string
	IdempotencyKey    string
	TimingRecorder    TimingRecorder
}

type LogicGateNodeAssignmentRemoveInput struct {
	CompanyID           string
	LogicGateID         string
	NodeID              string
	FallbackStatus      *string
	FallbackStatusColor *string
	ActorUserID         string
	IdempotencyKey      string
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
	Card                domain.KanbanCard              `json:"card"`
	Node                domain.Node                    `json:"node"`
	Assignment          domain.NodeLogicGateAssignment `json:"-"`
	RacioProjectionRows []RacioMatrixProjectionRow     `json:"racio_projection_rows,omitempty"`
	ProjectionDeltas    []ProjectionDelta              `json:"-"`
	Events              []domain.DomainEvent           `json:"-"`
}

type LogicGateNodeAssignmentRemoveResult struct {
	Card                domain.KanbanCard              `json:"card"`
	Node                domain.Node                    `json:"node"`
	Assignment          domain.NodeLogicGateAssignment `json:"-"`
	RacioProjectionRows []RacioMatrixProjectionRow     `json:"racio_projection_rows,omitempty"`
	ProjectionDeltas    []ProjectionDelta              `json:"-"`
	Events              []domain.DomainEvent           `json:"-"`
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
	UserID         string
	CompanyID      string
	NotificationID string
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
	CompanyID         string
	NodeID            string
	Title             string
	TitleSet          bool
	Status            *string
	StatusSet         bool
	StatusColor       *string
	StatusColorSet    bool
	DueDate           *string
	DueDateSet        bool
	Priority          *int
	PrioritySet       bool
	AssigneeUserID    *string
	AssigneeUserIDSet bool
	ActorUserID       string
	ActorDisplayName  string
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

type LogicGateRaciAssignmentInput struct {
	Role   string `json:"role"`
	UserID string `json:"user_id"`
}

type LogicGateRaciAssignmentUpdateInput struct {
	CompanyID   string
	LogicGateID string
	Assignments []LogicGateRaciAssignmentInput
}

const (
	LogicGateRaciCommandAdd    = "add"
	LogicGateRaciCommandRemove = "remove"
)

type LogicGateRaciAssignmentCommandInput struct {
	CompanyID      string
	LogicGateID    string
	Assignments    []LogicGateRaciAssignmentInput
	ActorUserID    string
	IdempotencyKey string
}

type LogicGateRaciAssignmentCommandResult struct {
	CompanyID         string                           `json:"company_id"`
	LogicGateID       string                           `json:"logic_gate_id"`
	Operation         string                           `json:"operation"`
	Changed           bool                             `json:"changed"`
	RaciAssignments   []domain.LogicGateRaciAssignment `json:"raci_assignments"`
	BeforeAssignments []domain.LogicGateRaciAssignment `json:"-"`
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
	GrantID      string
	Status       string
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

func NormalizeLogicGateRaciRole(role string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case domain.LogicGateRaciRoleResponsible:
		return domain.LogicGateRaciRoleResponsible, true
	case domain.LogicGateRaciRoleAccountable:
		return domain.LogicGateRaciRoleAccountable, true
	case domain.LogicGateRaciRoleConsulted:
		return domain.LogicGateRaciRoleConsulted, true
	case domain.LogicGateRaciRoleInformed:
		return domain.LogicGateRaciRoleInformed, true
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
	case EntityTypeSharedTriageFolder, "communications_folder", "shared_inbox_folder":
		return EntityTypeSharedTriageFolder, true
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
