package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

var (
	ErrNotFound                      = errors.New("not found")
	ErrInvalid                       = errors.New("invalid")
	ErrAlreadyExists                 = errors.New("already exists")
	ErrVersionConflict               = errors.New("version conflict")
	ErrEditorDocumentTooLarge        = errors.New("editor document too large")
	ErrEditorOwnerTextLimit          = errors.New("editor owner text limit exceeded")
	ErrSendInProgress                = errors.New("send in progress")
	ErrSendRecoveryExpired           = errors.New("send recovery window expired")
	ErrSendRecoverySourceChanged     = errors.New("send recovery source changed")
	ErrDirectProjectLogicGate        = errors.New("logic gates cannot be added directly to projects")
	ErrProjectNodeLogicGateRequired  = errors.New("project nodes must belong to a logic gate")
	ErrProjectNodeInAnotherProject   = errors.New("node already belongs to another project")
	ErrInvitationBadToken            = errors.New("invitation bad token")
	ErrInvitationExpired             = errors.New("invitation expired")
	ErrInvitationAlreadyAccepted     = errors.New("invitation already accepted")
	ErrInvitationReplaced            = errors.New("invitation replaced")
	ErrInvitationEmailMismatch       = errors.New("invitation email mismatch")
	ErrPrincipalNotInCompany         = errors.New("principal not in company")
	ErrRACIInherited                 = errors.New("RACI inherited")
	ErrRACIStorageUnavailable        = errors.New("RACI storage unavailable")
	ErrSharedInboxStorageUnavailable = errors.New("shared inbox storage unavailable")
	ErrEmailAccountUnavailable       = errors.New("email account unavailable")
	ErrUploadStateConflict           = errors.New("attachment upload state conflict")
	ErrUploadIntentExpired           = errors.New("attachment upload intent expired")
	ErrUploadPayloadConflict         = errors.New("attachment upload idempotency payload conflict")
	ErrAttachmentShared              = errors.New("attachment is linked to another resource")
	ErrProjectionRevisionRequired    = errors.New("projection revision required")
	ErrNoVerificationRecipients      = errors.New("no verification recipients")
)

type ProjectionRevisionConflictError struct {
	NodeCurrent      *domain.NodeProjection
	LogicGateCurrent *domain.LogicGateProjection
}

func (e *ProjectionRevisionConflictError) Error() string { return "projection revision conflict" }
func (e *ProjectionRevisionConflictError) Unwrap() error { return ErrVersionConflict }

type Repository interface {
	IdentityRepository
	AccountRepository
	EntityFieldRepository
	CommunicationsRepository
	AttachmentRepository
	WorkGraphRepository
	LogicGateRepository
	ProjectRepository
	RACIRepository
	EntityPermissionRepository
	V2PolicyRepository
	EffectiveAccessRepository
	ConsolidatedViewRepository
	SavedViewRepository
	UserPinRepository
	LogicGateWorkRepository
	WorkItemReadRepository
	CompanyExplorerRepository
	RecycleBinRepository
	WorkspaceEntityCommandRepository
	KanbanRepository
	ProjectManagementRepository
	NotificationRepository
	NodeTimelineRepository
	RealtimeOutboxRepository
	EditorJSONRepository
	DomainEventRepository
}

type EntityFieldRepository interface {
	ListEntityFields(companyID string) ([]domain.EntityField, error)
	CreateEntityField(input EntityFieldInput) (domain.EntityField, error)
	UpdateEntityField(input EntityFieldInput) (domain.EntityField, error)
	DeleteEntityField(companyID, fieldID, actorUserID string) error
	SetEntityFieldAssignments(input EntityFieldAssignmentInput) ([]domain.EntityField, error)
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
	ListUserMembershipsContext(ctx context.Context, userID string) ([]domain.CompanyMembership, error)
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
	GetCompanyEmailConnectionByGrantIDContext(ctx context.Context, grantID string) (domain.CompanyEmailConnection, error)
	GetUserEmailConnectionByGrantIDContext(ctx context.Context, grantID string) (domain.UserEmailConnection, error)
	GetEmailConnectionByIDContext(ctx context.Context, companyID, connectionID string) (domain.UserEmailConnection, error)
	ListDueEmailConnectionsContext(ctx context.Context, cutoff time.Time, afterConnectionID string, limit int) ([]domain.UserEmailConnection, error)
	UpsertUserEmailConnection(input UserEmailConnectionInput) (domain.UserEmailConnection, error)
	UpsertCompanyEmailConnection(input CompanyEmailConnectionInput) (domain.CompanyEmailConnection, error)
	UpdateCompanyEmailConnectionStatus(companyID, connectionID, status string) (domain.CompanyEmailConnection, error)
	UpdateUserEmailConnectionStatus(userID, accountEmail, status string) (domain.UserEmailConnection, error)
	UpdateCompanyEmailConnectionStatusContext(ctx context.Context, companyID, connectionID, status string) (domain.CompanyEmailConnection, error)
	UpdateUserEmailConnectionStatusContext(ctx context.Context, userID, accountEmail, status string) (domain.UserEmailConnection, error)
	UpdateEmailConnectionScanCheckpointContext(ctx context.Context, companyID, connectionID string, checkpoint time.Time) error
	UpdateEmailConnectionStatusByIDContext(ctx context.Context, companyID, connectionID, status string) error
	DeleteUserEmailConnection(userID string) error
}

type CommunicationsRepository interface {
	UpsertCommunicationsTriageItem(userID string, message domain.EmailMessageSnapshot) (domain.CommunicationsTriageItem, error)
	UpsertCommunicationsMessageReadStatusContext(ctx context.Context, input CommunicationsMessageReadStatusInput) (domain.CommunicationsMessageReadStatus, error)
	ListCommunicationsMessageReadStatuses(input CommunicationsMessageReadStatusListInput) ([]domain.CommunicationsMessageReadStatus, error)
	CreateCommunicationsArchiveJobContext(ctx context.Context, input CommunicationsArchiveJobInput) (CommunicationsArchiveJob, error)
	GetCommunicationsArchiveJobContext(ctx context.Context, jobID string) (CommunicationsArchiveJob, error)
	GetCommunicationsArchiveJobItemContext(ctx context.Context, jobItemID string) (CommunicationsArchiveJobItem, error)
	StartCommunicationsArchiveJobItemAttemptContext(ctx context.Context, jobItemID string) (CommunicationsArchiveJobItem, bool, error)
	CompleteCommunicationsArchiveJobItemAttemptContext(ctx context.Context, jobItemID, attemptToken string, realtimeInputs []RealtimeOutboxInput) error
	FailCommunicationsArchiveJobItemAttemptContext(ctx context.Context, jobItemID, attemptToken, lastError string, realtimeInputs []RealtimeOutboxInput) error
	ParkCommunicationsArchiveJobItemAttemptContext(ctx context.Context, jobItemID, attemptToken, companyID, emailConnectionID, connectionStatus, lastError string, realtimeInputs []RealtimeOutboxInput) error
	ListCommunicationsArchiveJobItemsContext(ctx context.Context, jobID string) ([]CommunicationsArchiveJobItem, error)
	ConvertCommunicationsTriageItems(ctx context.Context, input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error)
	RevertCommunicationsTriageNode(input CommunicationsTriageRevertInput) (CommunicationsTriageRevertResult, error)
	TransferCommunicationsEmailNode(input CommunicationsEmailNodeTransferInput) (CommunicationsEmailNodeTransferResult, error)
	ListCommunicationsEmailPlacements(userID, companyID string, messageIDs []string) ([]domain.CommunicationsEmailPlacement, error)
	ListCommunicationsEmailPlacementsForConnection(userID, companyID, emailConnectionID string, messageIDs []string) ([]domain.CommunicationsEmailPlacement, error)
	UpsertCommunicationsEmailThread(input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error)
	UpsertCommunicationsEmailThreadContext(ctx context.Context, input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error)
	GetCommunicationsEmailThread(companyID, emailThreadID string) (domain.CommunicationsEmailThread, error)
	GetCommunicationsEmailThreadContext(ctx context.Context, companyID, emailThreadID string) (domain.CommunicationsEmailThread, error)
	ListCommunicationsEmailThreadsForAccount(input CommunicationsEmailAccountReadInput) ([]domain.CommunicationsEmailThread, error)
	ListCommunicationsEmailMessagesForAccount(input CommunicationsEmailAccountReadInput) ([]domain.CommunicationsEmailMessage, error)
	EnsureCommunicationsEmailIngestionJobContext(ctx context.Context, input CommunicationsEmailIngestionJobInput) (CommunicationsEmailIngestionJob, bool, error)
	GetCommunicationsEmailIngestionJobContext(ctx context.Context, jobID string) (CommunicationsEmailIngestionJob, error)
	MarkCommunicationsEmailIngestionJobSQSAcceptedContext(ctx context.Context, jobID string) error
	StartCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID string) (CommunicationsEmailIngestionJob, bool, error)
	CompleteCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID, attemptToken string, realtimeInputs []RealtimeOutboxInput) error
	FailCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID, attemptToken, lastError string, realtimeInputs []RealtimeOutboxInput) error
	ParkCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID, attemptToken, connectionStatus, lastError string, realtimeInputs []RealtimeOutboxInput) error
	ListCommunicationsEmailIngestionJobsForThreadContext(ctx context.Context, companyID, emailThreadID string) ([]CommunicationsEmailIngestionJob, error)
	CheckEmailSQSWorkerSchemaReadinessContext(ctx context.Context) error
	ListCommunicationsEmailThreadNodeIDs(companyID, emailThreadID string) ([]string, error)
	GetCommunicationsNodeEmailThread(companyID, nodeID, emailThreadID string) (domain.CommunicationsNodeEmailThread, error)
	ImportCommunicationsEmailIntoNode(input CommunicationsNodeEmailImportInput) (CommunicationsNodeEmailImportResult, error)
	EnsureCommunicationsEmailCollaboration(ctx context.Context, input CommunicationsEmailCollaborationEnsureInput) (CommunicationsEmailCollaborationEnsureResult, error)
	ListCommunicationsEmailCollaborations(input CommunicationsEmailCollaborationListInput) ([]domain.CommunicationsEmailCollaboration, error)
	GetCommunicationsEmailCollaboration(companyID, collaborationID, participantUserID string) (domain.CommunicationsEmailCollaboration, error)
	AddCommunicationsEmailCollaborationParticipants(input CommunicationsEmailCollaborationParticipantInput) (CommunicationsEmailCollaborationParticipantResult, error)
	AddCommunicationsEmailCollaborationParticipantsForNode(input CommunicationsEmailCollaborationNodeParticipantInput) (CommunicationsEmailCollaborationParticipantResult, error)
	AddEmailCollaborationNodeInformationWithActor(input NodeInformationInput) (CommunicationsEmailCollaborationInformationWriteResult, error)
	UpsertEmailCollaborationNodeProjectionWithActor(input NodeInformationInput) (CommunicationsEmailCollaborationProjectionWriteResult, error)
	ListCommunicationsEmailDrafts(input CommunicationsEmailDraftListInput) ([]domain.CommunicationsEmailDraft, error)
	GetCommunicationsEmailDraft(input CommunicationsEmailDraftGetInput) (domain.CommunicationsEmailDraft, error)
	UpsertCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error)
	SoftDeleteCommunicationsEmailDraft(input CommunicationsEmailDraftDeleteInput) error
	ClaimCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendClaimInput) (CommunicationsEmailDraftSendClaim, error)
	ReleaseCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendReleaseInput) error
	CompleteCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendCompleteInput) error
	GetCommunicationsEmailSignature(input CommunicationsEmailSignatureScopeInput) (domain.CommunicationsEmailSignature, error)
	UpsertCommunicationsEmailSignature(input CommunicationsEmailSignatureInput) (domain.CommunicationsEmailSignature, error)
	ListUserLogicGateShortcuts(userID, companyID string) ([]domain.UserLogicGateShortcut, error)
	UpsertUserLogicGateShortcuts(userID, companyID string, logicGateIDs []string) ([]domain.UserLogicGateShortcut, error)
	DeleteUserLogicGateShortcut(userID, companyID, logicGateID string) error
}

const (
	AttachmentSourceUserUpload           = "user_upload"
	AttachmentSourceEditorPaste          = "editor_paste"
	AttachmentSourceChatUpload           = "chat_upload"
	AttachmentSourceEmailIncoming        = "email_incoming"
	AttachmentSourceEmailOutgoing        = "email_outgoing"
	AttachmentSourceMigrationInlineImage = "migration_inline_image"

	AttachmentVariantOriginal          = "original"
	AttachmentVariantDisplay           = "display"
	AttachmentVariantThumbnail         = "thumbnail"
	AttachmentVariantGenerationVersion = 1

	AttachmentRelationshipInlineImage       = "inline_image"
	AttachmentRelationshipFileAttachment    = "file_attachment"
	AttachmentRelationshipChatAttachment    = "chat_attachment"
	AttachmentRelationshipEmailAttachment   = "email_attachment"
	AttachmentRelationshipEmailInline       = "email_inline_attachment"
	AttachmentRelationshipMigratedInlineImg = "migrated_inline_image"
)

type AttachmentRepository interface {
	attachmentcleanup.Repository
	GetEmailAttachmentResourceAccess(input EmailAttachmentResourceAccessInput) (EmailAttachmentResourceAccess, error)
	CreateAttachmentWithResourceLink(input AttachmentCreateInput) (domain.Attachment, domain.ResourceAttachment, error)
	CreateAttachmentWithResourceLinkContext(ctx context.Context, input AttachmentCreateInput) (domain.Attachment, domain.ResourceAttachment, error)
	GetAttachment(companyID, attachmentID string) (domain.Attachment, error)
	AttachmentExistsContext(ctx context.Context, companyID, attachmentID string) (bool, error)
	GetAttachmentVariant(ctx context.Context, companyID, attachmentID, variantType string) (domain.AttachmentVariant, error)
	ReadAttachmentContent(ctx context.Context, companyID, attachmentID, variantType string) (AttachmentContentRead, error)
	UpsertAttachmentVariants(ctx context.Context, companyID string, inputs []AttachmentVariantInput) ([]domain.AttachmentVariant, error)
	ListAttachmentResourceLinks(companyID, attachmentID string) ([]domain.ResourceAttachment, error)
	ListResourceAttachments(companyID, resourceType, resourceID string) ([]domain.ResourceAttachment, error)
	LinkResourceAttachment(input ResourceAttachmentInput) (domain.ResourceAttachment, error)
	LinkResourceAttachmentContext(ctx context.Context, input ResourceAttachmentInput) (domain.ResourceAttachment, error)
	SoftDeleteResourceAttachment(input ResourceAttachmentDeleteInput) error
	PreparePermanentAttachmentDeletion(ctx context.Context, companyID, attachmentID, resourceType, resourceID string) (AttachmentDeletionPlan, error)
	GetAttachmentUploadIntentByClientRequest(companyID, actorUserID, clientRequestID string) (domain.AttachmentUploadIntent, error)
	CreateAttachmentUploadIntent(input AttachmentUploadIntentCreateInput) (domain.AttachmentUploadIntent, bool, error)
	GetAttachmentUploadIntent(companyID, actorUserID, uploadIntentID string) (domain.AttachmentUploadIntent, error)
	UpsertAttachmentUploadParts(input AttachmentUploadPartsInput) ([]domain.AttachmentUploadPart, error)
	ReplaceAttachmentUploadObservedParts(input AttachmentUploadObservedPartsInput) ([]domain.AttachmentUploadPart, error)
	ListAttachmentUploadParts(companyID, actorUserID, uploadIntentID string) ([]domain.AttachmentUploadPart, error)
	BeginAttachmentUploadCompletion(input AttachmentUploadTransitionInput) (domain.AttachmentUploadIntent, bool, error)
	ReopenAttachmentUploadIntent(input AttachmentUploadTransitionInput, failureCode string) (domain.AttachmentUploadIntent, error)
	FailAttachmentUploadIntent(input AttachmentUploadTransitionInput, failureCode string) (domain.AttachmentUploadIntent, error)
	FinalizeAttachmentUpload(input AttachmentUploadFinalizeInput) (domain.Attachment, domain.ResourceAttachment, error)
	AbortAttachmentUploadIntent(input AttachmentUploadTransitionInput) (domain.AttachmentUploadIntent, error)
	ListExpiredAttachmentUploadIntents(now time.Time, limit int) ([]domain.AttachmentUploadIntent, error)
	ExpireAttachmentUploadIntent(uploadIntentID string, now time.Time) (domain.AttachmentUploadIntent, error)
}

type EmailAttachmentResourceAccessInput struct {
	CompanyID    string
	UserID       string
	ResourceType string
	ResourceID   string
	AccessLevel  string
}

type EmailAttachmentResourceAccess struct {
	Allowed   bool
	SendState string
}
type AttachmentDeletionPlan struct {
	Objects []attachmentcleanup.ObjectRef
}

type AttachmentCreateInput struct {
	CompanyID                string
	AttachmentID             string
	UploadedByUserID         string
	OriginalFilename         string
	MimeType                 string
	ByteSize                 int64
	SHA256                   string
	SHA256VerificationMethod string
	StorageChecksumAlgorithm string
	StorageChecksumValue     string
	StorageChecksumType      string
	StorageBucket            string
	StorageKey               string
	OriginalWidth            *int
	OriginalHeight           *int
	SourceKind               string
	SourceProvider           string
	ResourceLink             ResourceAttachmentInput
	CreatedTimestamp         time.Time
}

type AttachmentUploadIntentCreateInput struct {
	UploadIntentID    string
	CompanyID         string
	ActorUserID       string
	ClientRequestID   string
	AttachmentID      string
	OriginalFilename  string
	MimeType          string
	SizeBytes         int64
	SHA256            string
	ResourceType      string
	ResourceID        string
	InformationID     string
	MessageID         string
	EditorSurface     string
	RelationshipKind  string
	SourceKind        string
	SourceProvider    string
	OriginalWidth     *int
	OriginalHeight    *int
	StorageBucket     string
	StorageKey        string
	MultipartUploadID string
	Strategy          string
	PartSizeBytes     int64
	PartCount         int
	ExpiresTimestamp  time.Time
	CreatedTimestamp  time.Time
}

type AttachmentUploadPartsInput struct {
	CompanyID      string
	ActorUserID    string
	UploadIntentID string
	Parts          []domain.AttachmentUploadPart
	Now            time.Time
}

type AttachmentUploadObservedPartsInput struct {
	CompanyID      string
	ActorUserID    string
	UploadIntentID string
	Parts          []domain.AttachmentUploadPart
	Now            time.Time
}

type AttachmentUploadTransitionInput struct {
	CompanyID      string
	ActorUserID    string
	UploadIntentID string
	Now            time.Time
}

type AttachmentUploadFinalizeInput struct {
	CompanyID                string
	ActorUserID              string
	UploadIntentID           string
	SHA256VerificationMethod string
	StorageChecksumAlgorithm string
	StorageChecksumValue     string
	StorageChecksumType      string
	Now                      time.Time
}

type AttachmentVariantInput struct {
	AttachmentID      string
	VariantType       string
	MimeType          string
	ByteSize          int64
	SHA256            *string
	GenerationVersion *int
	Width             *int
	Height            *int
	StorageBucket     string
	StorageKey        string
	CreatedTimestamp  time.Time
}

// AttachmentContentRead is the minimal repository result needed to authorize
// and serve one attachment object. Storage coordinates remain server-only.
// The repository resolves a missing display/thumbnail request to the original
// in the same read, so the content handler never reloads full attachment
// metadata, variants, and links separately.
type AttachmentContentRead struct {
	CompanyID                string
	AttachmentID             string
	OriginalFilename         string
	OriginalMimeType         string
	OriginalSHA256           string
	OriginalByteSize         int64
	OriginalStorageBucket    string
	OriginalStorageKey       string
	OriginalCreatedTimestamp time.Time
	OriginalUpdatedTimestamp time.Time
	RequestedVariant         string
	ServedVariant            string
	MimeType                 string
	ByteSize                 int64
	SHA256                   string
	GenerationVersion        int
	Width                    *int
	Height                   *int
	StorageBucket            string
	StorageKey               string
	CreatedTimestamp         time.Time
	UpdatedTimestamp         time.Time
	ResourceLinks            []domain.ResourceAttachment
}

type ResourceAttachmentInput struct {
	ResourceAttachmentID string
	CompanyID            string
	ResourceType         string
	ResourceID           string
	AttachmentID         string
	InformationID        string
	MessageID            string
	EditorSurface        string
	RelationshipKind     string
	CreatedByUserID      string
	CreatedTimestamp     time.Time
}

type ResourceAttachmentDeleteInput struct {
	CompanyID    string
	ResourceType string
	ResourceID   string
	AttachmentID string
}

func NormalizeAttachmentSourceKind(sourceKind string) string {
	switch strings.TrimSpace(sourceKind) {
	case "", AttachmentSourceUserUpload:
		return AttachmentSourceUserUpload
	case AttachmentSourceEditorPaste:
		return AttachmentSourceEditorPaste
	case AttachmentSourceChatUpload:
		return AttachmentSourceChatUpload
	case AttachmentSourceEmailIncoming:
		return AttachmentSourceEmailIncoming
	case AttachmentSourceEmailOutgoing:
		return AttachmentSourceEmailOutgoing
	case AttachmentSourceMigrationInlineImage:
		return AttachmentSourceMigrationInlineImage
	default:
		return ""
	}
}

func NormalizeAttachmentVariantType(variantType string) string {
	switch strings.TrimSpace(variantType) {
	case "", AttachmentVariantOriginal:
		return AttachmentVariantOriginal
	case AttachmentVariantDisplay:
		return AttachmentVariantDisplay
	case AttachmentVariantThumbnail:
		return AttachmentVariantThumbnail
	default:
		return ""
	}
}

func NormalizeAttachmentRelationshipKind(relationshipKind string) string {
	switch strings.TrimSpace(relationshipKind) {
	case "", AttachmentRelationshipFileAttachment:
		return AttachmentRelationshipFileAttachment
	case AttachmentRelationshipInlineImage:
		return AttachmentRelationshipInlineImage
	case AttachmentRelationshipChatAttachment:
		return AttachmentRelationshipChatAttachment
	case AttachmentRelationshipEmailAttachment:
		return AttachmentRelationshipEmailAttachment
	case AttachmentRelationshipEmailInline:
		return AttachmentRelationshipEmailInline
	case AttachmentRelationshipMigratedInlineImg:
		return AttachmentRelationshipMigratedInlineImg
	default:
		return ""
	}
}

func NormalizeAttachmentResourceType(resourceType string) string {
	switch strings.TrimSpace(resourceType) {
	case "node":
		return "node"
	case "logic_gate", "logic-gate":
		return "logic_gate"
	case "project":
		return "project"
	case "node_chat_message", "node-chat-message":
		return "node_chat_message"
	case "logic_gate_chat_message", "logic-gate-chat-message":
		return "logic_gate_chat_message"
	case "project_chat_message", "project-chat-message":
		return "project_chat_message"
	case "email_message", "email-message":
		return "email_message"
	case "email_draft", "email-draft":
		return "email_draft"
	case "email_signature", "email-signature":
		return "email_signature"
	case "shared_inbox", "shared-inbox":
		return "shared_inbox"
	case "company_explorer_folder", "company-explorer-folder":
		return "company_explorer_folder"
	case "shared_inbox_folder", "shared-inbox-folder":
		return "shared_inbox_folder"
	default:
		return ""
	}
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
	UpsertNodeProjectionWithActor(input NodeInformationInput) (domain.NodeProjection, error)
	DeleteNodeProjection(companyID, nodeID, informationID string) error
	DeleteNodeProjectionWithActor(input NodeProjectionDeleteInput) error
	CreateNodeEditorSaveVersion(input EditorSaveVersionInput) (domain.EditorSaveVersion, error)
	ListNodeEditorSaveVersions(companyID, nodeID string) ([]domain.EditorSaveVersion, error)
	RestoreNodeEditorSaveVersion(input EditorSaveVersionRestoreInput) (domain.EditorSaveVersion, error)
	CurrentNodeViewVersion(companyID, nodeID, userID string) (NodeViewVersion, error)
	CreateNodeRelationship(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, error)
	CreateNodeRelationshipAndWorkspaceEvent(companyID, nodeIDA, nodeIDB, aPosition, bPosition string) (domain.NodeRelationship, domain.DomainEvent, error)
}

type LogicGateRepository interface {
	CreateLogicGate(companyID, header string) (domain.LogicGate, error)
	CreateLogicGateWithWorkspaceEvent(companyID, header string) (domain.LogicGate, domain.DomainEvent, error)
	UpdateLogicGateHeader(companyID, logicGateID, header string) (domain.LogicGate, error)
	UpdateLogicGateHeaderWithWorkspaceEvent(companyID, logicGateID, header string) (domain.LogicGate, domain.DomainEvent, error)
	ListLogicGates(companyID string) ([]domain.LogicGate, error)
	ListVisibleLogicGates(companyID, userID string) ([]domain.LogicGate, error)
	ListLogicGatesInFolderSubtree(companyID, folderID string) ([]domain.LogicGate, error)
	ListVisibleLogicGatesInFolderSubtree(companyID, folderID, userID string) ([]domain.LogicGate, error)
	QueryLogicGates(companyID string, query LogicGateQuery) ([]domain.LogicGate, error)
	QueryVisibleLogicGates(companyID, userID string, query LogicGateQuery) ([]domain.LogicGate, error)
	SetLogicGateRACIAssignments(input LogicGateRACIAssignmentUpdateInput) ([]domain.LogicGateRACIAssignment, error)
	AddLogicGateRACIAssignments(input LogicGateRACIAssignmentCommandInput) (LogicGateRACIAssignmentCommandResult, error)
	RemoveLogicGateRACIAssignments(input LogicGateRACIAssignmentCommandInput) (LogicGateRACIAssignmentCommandResult, error)
	ListLogicGateRelationships(companyID string) ([]domain.LogicGateRelationship, error)
	ListLogicGateRelationshipsInFolderSubtree(companyID, folderID string) ([]domain.LogicGateRelationship, error)
	DeleteLogicGateRelationship(companyID, relationshipID string) error
	GetLogicGate(companyID, logicGateID string) (domain.LogicGate, error)
	DeleteLogicGate(companyID, logicGateID string) error
	GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error)
	AddLogicGateInformation(companyID, logicGateID, infoType, information, informationID string) (domain.LogicGateInformation, error)
	ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error)
	UpsertLogicGateProjection(input LogicGateProjectionInput) (domain.LogicGateProjection, error)
	DeleteLogicGateProjection(input LogicGateProjectionDeleteInput) error
	CreateLogicGateEditorSaveVersion(input EditorSaveVersionInput) (domain.EditorSaveVersion, error)
	ListLogicGateEditorSaveVersions(companyID, logicGateID string) ([]domain.EditorSaveVersion, error)
	RestoreLogicGateEditorSaveVersion(input EditorSaveVersionRestoreInput) (domain.EditorSaveVersion, error)
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

type RACIRepository interface {
	ListResourceRACIAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceRACIAssignment, error)
	SetResourceRACIAssignments(input ResourceRACIAssignmentUpdateInput) (ResourceRACIAssignmentMutationResult, error)
	AddResourceRACIAssignments(input ResourceRACIAssignmentCommandInput) (ResourceRACIAssignmentMutationResult, error)
	RemoveResourceRACIAssignments(input ResourceRACIAssignmentCommandInput) (ResourceRACIAssignmentMutationResult, error)
	ListResourceRACIEffectiveAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceRACIEffectiveAssignment, error)
}

type EntityPermissionRepository interface {
	ListEntityPermissions(companyID, entityType, entityID string) ([]domain.EntityPermission, error)
	SetEntityPermissions(input EntityPermissionUpdateInput) ([]domain.EntityPermission, error)
	ListAccessibleEntityIDs(companyID, entityType, userID, accessLevel string, entityIDs []string) (map[string]bool, error)
	UserCanAccessEntity(companyID, entityType, entityID, userID, accessLevel string) (bool, error)
}

type EffectiveAccessRepository interface {
	UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel string) (bool, error)
	ListEffectiveResourceIDsForUser(companyID, userID, resourceType, accessLevel string, resourceIDs []string) (map[string]bool, error)
	ListEffectiveUsersForResource(companyID, resourceType, resourceID, accessLevel string) ([]string, error)
	ResolveEffectiveUsersForResource(ctx context.Context, companyID, resourceType, resourceID, accessLevel string, candidateUserIDs []string) (bool, []string, error)
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
	ListUserPinTree(input UserPinListInput) (domain.UserPinTree, error)
	UpsertUserPin(input UserPinInput) (domain.UserPin, error)
	DeleteUserPin(input UserPinDeleteInput) error
	CreateUserPinFolder(input UserPinFolderCreateInput) (domain.UserPinFolder, error)
	RenameUserPinFolder(input UserPinFolderRenameInput) (domain.UserPinFolder, error)
	DeleteUserPinFolder(input UserPinFolderDeleteInput) error
	ApplyUserPinLayout(input UserPinLayoutInput) error
	GroupUserPins(input UserPinGroupInput) (UserPinGroupResult, error)
}

type UserPinListInput struct {
	CompanyID string
	UserID    string
}

type UserPinInput struct {
	CompanyID       string
	PinID           string
	UserID          string
	ResourceType    string
	ResourceID      string
	Name            string
	ParentFolderID  string
	ParentFolderSet bool
	Position        int
}

type UserPinDeleteInput struct {
	CompanyID string
	UserID    string
	PinID     string
}

type UserPinFolderCreateInput struct {
	CompanyID      string
	UserID         string
	FolderID       string
	ParentFolderID string
	Name           string
	Position       int
}

type UserPinFolderRenameInput struct {
	CompanyID string
	UserID    string
	FolderID  string
	Name      string
}

type UserPinFolderDeleteInput struct {
	CompanyID string
	UserID    string
	FolderID  string
}

type UserPinLayoutEntry struct {
	EntryType      string
	EntryID        string
	ParentFolderID string
	Position       int
}

type UserPinLayoutInput struct {
	CompanyID string
	UserID    string
	Entries   []UserPinLayoutEntry
}

type UserPinGroupInput struct {
	CompanyID    string
	UserID       string
	FolderID     string
	DraggedPinID string
	TargetPinID  string
	Name         string
}

type UserPinGroupResult struct {
	Folder domain.UserPinFolder
	Tree   domain.UserPinTree
}

type LogicGateWorkRepository interface {
	GetLogicGateWork(companyID, logicGateID string) (domain.LogicGateWorkView, error)
	LogicGateWorkAccessFlags(companyID, userID, logicGateID string) (domain.EffectiveAccessFlags, error)
	CurrentLogicGateWorkVersion(companyID, logicGateID string) (int64, error)
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
	ListMyWorkMatrixRows(query WorkItemInboxQuery) ([]RACIMatrixProjectionRow, error)
	ListMyWorkMatrix(query WorkItemInboxQuery) (MyWorkMatrixResponse, error)
	ListRACIMatrixProjectionRowsForUser(query WorkItemInboxQuery) ([]RACIMatrixProjectionRow, error)
	ListRACIMatrixProjectionRowsForResources(companyID string, nodeIDs, logicGateIDs []string) ([]RACIMatrixProjectionRow, error)
	ListRACIMatrixProjectionRowsForLogicGate(companyID, logicGateID string) ([]RACIMatrixProjectionRow, error)
	ListKanbanBoardProjectionRows(companyID, logicGateID string, query KanbanCardQuery) ([]KanbanBoardProjectionRow, error)
	ListKanbanBoardProjectionRowsForNode(companyID, nodeID string) ([]KanbanBoardProjectionRow, error)
	ListKanbanBoardProjectionRowsForLogicGate(companyID, logicGateID string) ([]KanbanBoardProjectionRow, error)
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
	ListCommunicationsSharedInboxFoldersContext(ctx context.Context, companyID string) ([]domain.CompanyExplorerFolder, error)
	ListVisibleCommunicationsSharedInboxFolders(companyID, userID string) ([]domain.CompanyExplorerFolder, error)
	GetCommunicationsSharedInboxFolder(companyID, folderID string) (domain.CompanyExplorerFolder, error)
	MoveCommunicationsSharedInboxFolder(companyID, folderID string, parentFolderID *string, position int) (domain.CompanyExplorerFolder, error)
	RenameCommunicationsSharedInboxFolder(companyID, folderID, name string) (domain.CompanyExplorerFolder, error)
	DeleteCommunicationsSharedInboxFolder(companyID, folderID string) error
	RemoveCommunicationsSharedInboxFolder(companyID, folderID string) error
	SetCommunicationsSharedInboxAccountEmail(companyID, folderID, accountEmail string) (domain.CompanyExplorerFolder, error)
	SetCommunicationsSharedInboxRACIAssignments(input SharedInboxRACIAssignmentUpdateInput) ([]domain.SharedInboxRACIAssignment, error)
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
	Context             context.Context
	CompanyID           string
	Query               string
	PermissionUserID    string
	Limit               int
	ResourceTypes       []string
	EditorEntityRanking bool
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

type WorkspaceEntityCommandRepository interface {
	CreateWorkspaceEntityBatch(input WorkspaceEntityBatchInput) (WorkspaceEntityBatchResult, error)
	CreateRACIMatrixNode(input RACIMatrixNodeCreateInput) (RACIMatrixNodeCreateResult, error)
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
	CreateNotifications(input CreateNotificationsInput) ([]domain.Notification, error)
	ListNotifications(input NotificationListInput) ([]domain.Notification, error)
	ListUpdateRootGroups(input UpdatesQuery) ([]UpdatesNestedGroup, error)
	ListUpdateBranch(input UpdatesQuery) (UpdatesNestedGroup, error)
	GetSeenUpdatesRange(input UpdatesQuery) (UpdatesSeenRange, error)
	GetNotificationSummary(input NotificationSummaryInput) (domain.NotificationSummary, error)
	CountUnreadNotifications(userID, companyID string) (int, error)
	MarkNotificationRead(userID, notificationID string, read bool) (domain.Notification, error)
	MarkNotificationsRead(input NotificationMarkReadInput) (int, error)
	MarkAllNotificationsRead(userID, companyID string) (int, error)
	DeleteNotifications(input NotificationDeleteInput) ([]domain.Notification, error)
	DeleteExpiredNotifications(olderThan time.Time, limit int) ([]domain.Notification, error)
}

type NodeTimelineRepository interface {
	ListNodeTimelineEvents(companyID, nodeID string) ([]domain.NodeTimelineEvent, error)
	CreateNodeVerificationRequest(input NodeVerificationRequestInput) (NodeTimelineMutationResult, error)
	CompleteNodeVerificationRequest(input NodeVerificationCompletionInput) (domain.NodeTimelineEvent, error)
}

type DomainEventRepository interface {
	AppendDomainEvent(input DomainEventInput) (domain.DomainEvent, error)
	AppendDomainEvents(inputs []DomainEventInput) ([]domain.DomainEvent, error)
	ListDomainEventsAfter(query DomainEventReplayQuery) ([]domain.DomainEvent, error)
	ListDomainEventsForNotificationProjection(query DomainEventNotificationProjectionQuery) ([]domain.DomainEvent, error)
	LatestDomainEventForNotificationProjection(companyID string) (NotificationDomainEventCheckpoint, bool, error)
	CurrentDomainEventSequence(query DomainEventStreamQuery) (int64, error)
	DomainEventExistsByIdempotencyKey(companyID, idempotencyKey string) (bool, error)
	CurrentWorkspaceReadVersion(query WorkspaceReadVersionQuery) (int64, bool, error)
}

type RealtimeOutboxRepository interface {
	EnqueueRealtimeOutbox(ctx context.Context, input RealtimeOutboxInput) (RealtimeOutboxEvent, error)
	ClaimRealtimeOutbox(ctx context.Context, query RealtimeOutboxClaimQuery) ([]RealtimeOutboxEvent, error)
	MarkRealtimeOutboxPublished(ctx context.Context, eventID, claimToken string) error
	MarkRealtimeOutboxFailed(ctx context.Context, eventID, claimToken, category string) error
	ListPublishedRealtimeOutboxAfter(ctx context.Context, sequence int64, limit int) ([]RealtimeOutboxEvent, error)
	CurrentPublishedRealtimeOutboxSequence(ctx context.Context) (int64, error)
}

type EditorJSONRepository interface {
	GetEditorDataFormat(companyID string) (EditorDataFormatGate, error)
	GetEditorJSONSnapshot(ref EditorJSONDocumentRef) (EditorJSONSnapshot, error)
	EnsureEditorJSONCollaborationDocument(ref EditorJSONDocumentRef) (EditorJSONSnapshot, error)
	CommitEditorJSONDocument(input EditorJSONCommitInput) (EditorJSONCommit, error)
	DeleteEditorJSONDocument(input EditorJSONDeleteInput) (EditorJSONCommit, error)
	ListEditorJSONVersions(ref EditorJSONDocumentRef, limit int) ([]EditorJSONVersion, error)
	UpdateEditorJSONMetadata(input EditorJSONMetadataInput) (EditorJSONMetadataCommit, error)
}

type DeleteCompanyUserResult struct {
	User                   domain.CompanyUser `json:"user"`
	DeleteExternalIdentity bool               `json:"delete_external_identity"`
}

const WorkspaceEntityBatchMaxItems = 200

const WorkspaceEntityBatchMaxRelationships = 500

const CompanyExplorerFolderItemBatchMaxItems = 200

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
	RACIAssignments  []domain.LogicGateRACIAssignment `json:"gvic_assignments,omitempty"`
	CreatedTimestamp time.Time                        `json:"created_timestamp"`
}

type MyWorkMatrixResponse struct {
	CompanyID string                    `json:"company_id"`
	UserID    string                    `json:"user_id"`
	Rows      []RACIMatrixProjectionRow `json:"rows"`
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
	RACIAssignment               string           `json:"gvic_assignment,omitempty"`
	ResponsibleUserIDs           []string         `json:"responsible_user_ids,omitempty"`
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
	CreatedFromEmail             bool             `json:"created_from_email,omitempty"`
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

type RACIMatrixProjectionRow = ProjectionRow

type RACIEffectiveAssignmentProjectionRow = ProjectionRow

type KanbanBoardProjectionRow = ProjectionRow

type ProjectManagementTimelineProjectionRow = ProjectionRow

type ProjectRelationshipProjectionRow = ProjectionRow

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
	Item          *ProjectManagementTimelineProjectionRow `json:"item,omitempty"`
	DeletedItemID string                                  `json:"deleted_item_id,omitempty"`
	UserID        string                                  `json:"user_id,omitempty"`
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

type EntityFieldInput struct {
	CompanyID   string
	FieldID     string
	Name        string
	Color       string
	Position    int
	PositionSet bool
	ActorUserID string
}

type EntityFieldAssignmentInput struct {
	CompanyID    string
	ResourceType string
	ResourceID   string
	FieldIDs     []string
	ActorUserID  string
}

type ResourceRACIAssignmentInput struct {
	Role          string `json:"role"`
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
}

type ResourceRACIAssignmentUpdateInput struct {
	CompanyID          string
	ResourceType       string
	ResourceID         string
	Assignments        []ResourceRACIAssignmentInput
	ActorUserID        string
	IdempotencyKey     string
	ApplyToDescendants bool
}

type ResourceRACIAssignmentCommandInput struct {
	CompanyID          string
	ResourceType       string
	ResourceID         string
	Assignments        []ResourceRACIAssignmentInput
	ActorUserID        string
	IdempotencyKey     string
	ApplyToDescendants bool
}

type ResourceRACIAssignmentMutationResult struct {
	CompanyID            string                                   `json:"company_id"`
	ResourceType         string                                   `json:"resource_type"`
	ResourceID           string                                   `json:"resource_id"`
	Operation            string                                   `json:"operation,omitempty"`
	Changed              bool                                     `json:"changed"`
	RACIAssignments      []domain.ResourceRACIAssignment          `json:"gvic_assignments"`
	EffectiveAssignments []domain.ResourceRACIEffectiveAssignment `json:"effective_assignments,omitempty"`
	Events               []domain.DomainEvent                     `json:"-"`
}

type ProjectMutationResult struct {
	Project    *domain.Project                   `json:"project,omitempty"`
	DeletedID  string                            `json:"deleted_project_id,omitempty"`
	FolderItem *domain.CompanyExplorerFolderItem `json:"folder_item,omitempty"`
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
	Relationship          *domain.ProjectRelationshipProjection  `json:"relationship,omitempty"`
	ImplicitRelationships []domain.ProjectRelationshipProjection `json:"implicit_relationships,omitempty"`
	DeletedRelationshipID string                                 `json:"deleted_relationship_id,omitempty"`
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
	Node                  domain.Node                            `json:"node"`
	Relationship          *domain.ProjectRelationshipProjection  `json:"relationship,omitempty"`
	ImplicitRelationships []domain.ProjectRelationshipProjection `json:"implicit_relationships,omitempty"`
	Information           *domain.NodeInformation                `json:"information,omitempty"`
	Assignment            *domain.NodeLogicGateAssignment        `json:"assignment,omitempty"`
	Card                  *domain.KanbanCard                     `json:"card,omitempty"`
	Events                []domain.DomainEvent                   `json:"-"`
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
	LogicGate    domain.LogicGate                      `json:"logic_gate"`
	Relationship *domain.ProjectRelationshipProjection `json:"relationship,omitempty"`
	Information  *domain.LogicGateInformation          `json:"information,omitempty"`
	Events       []domain.DomainEvent                  `json:"-"`
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
	Account          *domain.Account `json:"account,omitempty"`
	DeletedAccountID string          `json:"deleted_account_id,omitempty"`
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
	Node        domain.Node                    `json:"node"`
	Assignments []domain.NodeAccountAssignment `json:"assignments"`
	Events      []domain.DomainEvent           `json:"-"`
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
	EntityPermissionEdit     = "edit"

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
	CreatorLogicGateRACIRole string
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
	CompanyID              string                                        `json:"company_id"`
	EntityKind             string                                        `json:"entity_kind"`
	EntityMappings         []WorkspaceEntityBatchEntityMapping           `json:"entity_mappings"`
	Nodes                  []domain.Node                                 `json:"nodes,omitempty"`
	LogicGates             []domain.LogicGate                            `json:"logic_gates,omitempty"`
	Relationships          []domain.NodeRelationship                     `json:"relationships,omitempty"`
	LogicGateRelationships []domain.LogicGateRelationship                `json:"logic_gate_relationships,omitempty"`
	FolderItems            []domain.CompanyExplorerFolderItem            `json:"folder_items,omitempty"`
	DeferredFolderItems    []DeferredCompanyExplorerFolderItemAssignment `json:"-"`
}

type RACIMatrixNodeCreateInput struct {
	CompanyID                string
	NodeID                   string
	Title                    string
	LogicGateID              string
	CreateLogicGateHeader    string
	CreatorLogicGateRACIRole string
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

type RACIMatrixNodeCreateResult struct {
	Node                     domain.Node                        `json:"node"`
	LogicGate                *domain.LogicGate                  `json:"logic_gate,omitempty"`
	Assignment               *domain.NodeLogicGateAssignment    `json:"assignment,omitempty"`
	Card                     *domain.KanbanCard                 `json:"card,omitempty"`
	FolderItems              []domain.CompanyExplorerFolderItem `json:"folder_items,omitempty"`
	RACIMatrixProjectionRows []RACIMatrixProjectionRow          `json:"gvic_projection_rows,omitempty"`
	Events                   []domain.DomainEvent               `json:"-"`
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

type SharedInboxRACIAssignmentInput struct {
	Role          string `json:"role"`
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
	UserID        string `json:"user_id"`
}

type SharedInboxRACIAssignmentUpdateInput struct {
	CompanyID   string
	FolderID    string
	Assignments []SharedInboxRACIAssignmentInput
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
	Events  []domain.DomainEvent           `json:"-"`
}

type CompanyExplorerRelationshipDeleteResult struct {
	ItemType        string   `json:"item_type"`
	ItemID          string   `json:"item_id"`
	RelationshipIDs []string `json:"relationship_ids"`
}

type RecycleBinRestoreResult struct {
	Items   []domain.RecycleBinItem        `json:"items"`
	Targets []CompanyExplorerDeletedTarget `json:"targets"`
	Events  []domain.DomainEvent           `json:"-"`
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
	PersonalAccountEmail     string
	CompanyID                string
	CompanyEmailConnectionID string
	SharedInboxID            string
	MessageID                string
	ThreadID                 string
	Status                   string
	SignalTimestamp          time.Time
	SignalTimestamps         []time.Time
	SignalCount              int
}

type CommunicationsMessageReadStatusListInput struct {
	ScopeType                string
	UserID                   string
	PersonalAccountEmail     string
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
	SharedInboxID      string
	AccountEmail       string
	ActorUserID        string
	PermissionUserID   string
	IdempotencyKey     string
	MessageIDs         []string
	Target             CommunicationsTriageConversionTarget
	LogicGateID        string
	NodeID             string
	NewLogicGateHeader string
	EmailThreads       []CommunicationsEmailThreadUpsertInput
	LinkedTextBlock    *NodeInformationInput
	InitialChat        *NodeInformationInput
	Status             string
	ColumnID           string
	Priority           *int
	PrioritySet        bool
}

type CommunicationsTriageConversionResult struct {
	Target                      CommunicationsTriageConversionTarget      `json:"target"`
	LogicGate                   domain.LogicGate                          `json:"logic_gate"`
	CreatedLogicGate            bool                                      `json:"created_logic_gate,omitempty"`
	Board                       domain.KanbanBoard                        `json:"board"`
	Cards                       []domain.KanbanCard                       `json:"cards"`
	Nodes                       []domain.Node                             `json:"nodes"`
	Assignments                 []domain.NodeLogicGateAssignment          `json:"assignments,omitempty"`
	EmailPlacements             []domain.CommunicationsEmailPlacement     `json:"email_placements,omitempty"`
	EmailProvenance             []CommunicationsEmailConversionProvenance `json:"email_provenance,omitempty"`
	FolderItems                 []domain.CompanyExplorerFolderItem        `json:"folder_items,omitempty"`
	ExplorerV2Rows              []CompanyExplorerV2Row                    `json:"explorer_v2_rows,omitempty"`
	AttachedEmailInformationIDs []string                                  `json:"attached_email_information_ids,omitempty"`
	EmailThreadIDs              []string                                  `json:"email_thread_ids,omitempty"`
	EmailMessageIDs             []string                                  `json:"email_message_ids,omitempty"`
	LinkedTextBlockID           string                                    `json:"linked_text_block_id,omitempty"`
	InitialChatID               string                                    `json:"initial_chat_id,omitempty"`
	ProjectRelationships        []domain.ProjectRelationshipProjection    `json:"project_relationships,omitempty"`
	DeletedMessageIDs           []string                                  `json:"deleted_message_ids"`
	UnstarredMessageIDs         []string                                  `json:"unstarred_message_ids,omitempty"`
	Events                      []domain.DomainEvent                      `json:"-"`
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
	Events        []domain.DomainEvent            `json:"-"`
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
	Events         []domain.DomainEvent                `json:"-"`
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
	RACIMatrixProjectionRows []RACIMatrixProjectionRow      `json:"gvic_projection_rows,omitempty"`
	Events                   []domain.DomainEvent           `json:"-"`
}

type LogicGateNodeAssignmentRemoveResult struct {
	Card                     domain.KanbanCard              `json:"card"`
	Node                     domain.Node                    `json:"node"`
	Assignment               domain.NodeLogicGateAssignment `json:"-"`
	RACIMatrixProjectionRows []RACIMatrixProjectionRow      `json:"gvic_projection_rows,omitempty"`
	Events                   []domain.DomainEvent           `json:"-"`
}

type NodeVerificationRequestInput struct {
	CompanyID      string
	NodeID         string
	ActorUserID    string
	IdempotencyKey string
}

type NodeVerificationCompletionInput struct {
	CompanyID string
	NodeID    string
	EventID   string
	UserID    string
}

type NodeTimelineMutationResult struct {
	TimelineEvent domain.NodeTimelineEvent `json:"timeline_event"`
	Events        []domain.DomainEvent     `json:"-"`
}

const NodeVerificationRequestedWorkspaceEventType = "node.verification_requested"

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
	Priority        *int
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

const UpdatesSeenMaxWindow = 90 * 24 * time.Hour

type UpdatesQuery struct {
	UserID      string
	CompanyID   string
	Filter      string
	RootID      string
	SeenOnly    bool
	CreatedFrom time.Time
	CreatedTo   time.Time
}

type UpdatesSeenRange struct {
	OldestCreatedTimestamp *time.Time `json:"oldest_created_timestamp,omitempty"`
	NewestCreatedTimestamp *time.Time `json:"newest_created_timestamp,omitempty"`
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
	RealtimeMode     string
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
	CompanyID           string
	NodeID              string
	Type                string
	Information         string
	InformationID       string
	ActorUserID         string
	ActorDisplayName    string
	SaveBatchID         string
	SaveKind            string
	SourceInformationID string
	ExpectedRevision    *int64
}

type LogicGateProjectionInput struct {
	CompanyID        string
	LogicGateID      string
	Type             string
	Information      string
	InformationID    string
	ActorUserID      string
	ActorDisplayName string
	ExpectedRevision *int64
}

type EditorSaveVersionInput struct {
	CompanyID        string
	ResourceID       string
	SaveKind         string
	ActorUserID      string
	ActorDisplayName string
}

type EditorSaveVersionRestoreInput struct {
	CompanyID        string
	ResourceID       string
	SaveID           string
	ActorUserID      string
	ActorDisplayName string
}

type NodeProjectionDeleteInput struct {
	CompanyID        string
	NodeID           string
	InformationID    string
	ActorUserID      string
	ActorDisplayName string
	ExpectedRevision *int64
}

type LogicGateProjectionDeleteInput struct {
	CompanyID        string
	LogicGateID      string
	InformationID    string
	ExpectedRevision *int64
}

type NodeViewVersion struct {
	Shared int64
	User   int64
}

type NodeViewInput struct {
	CompanyID string
	NodeID    string
	UserID    string
}

type LogicGateRACIAssignmentInput struct {
	Role          string `json:"role"`
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
	UserID        string `json:"user_id"`
}

type LogicGateRACIAssignmentUpdateInput struct {
	CompanyID   string
	LogicGateID string
	Assignments []LogicGateRACIAssignmentInput
}

const (
	LogicGateRACICommandAdd    = "add"
	LogicGateRACICommandRemove = "remove"
)

type LogicGateRACIAssignmentCommandInput struct {
	CompanyID      string
	LogicGateID    string
	Assignments    []LogicGateRACIAssignmentInput
	ActorUserID    string
	IdempotencyKey string
}

type LogicGateRACIAssignmentCommandResult struct {
	CompanyID         string                           `json:"company_id"`
	LogicGateID       string                           `json:"logic_gate_id"`
	Operation         string                           `json:"operation"`
	Changed           bool                             `json:"changed"`
	RACIAssignments   []domain.LogicGateRACIAssignment `json:"gvic_assignments"`
	BeforeAssignments []domain.LogicGateRACIAssignment `json:"-"`
	Events            []domain.DomainEvent             `json:"-"`
}

type EntityPermissionInput struct {
	SubjectType string `json:"subject_type"`
	SubjectID   string `json:"subject_id"`
	Permission  string `json:"permission"`
	AccessLevel string `json:"access_level"`
}

type EntityPermissionUpdateInput struct {
	CompanyID          string
	EntityType         string
	EntityID           string
	DefaultAccess      string
	DefaultAccessSet   bool
	OverrideUserIDs    []string
	Permissions        []EntityPermissionInput
	ActorUserID        string
	ApplyToDescendants bool
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
	CompanyID    string
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

type CommunicationsEmailDraftListInput struct {
	CompanyID            string
	PersonalUserID       string
	PersonalAccountEmail string
	SharedInboxID        string
	ParticipantUserID    string
}

type CommunicationsEmailDraftGetInput struct {
	CompanyID            string
	DraftID              string
	PersonalUserID       string
	PersonalAccountEmail string
	SharedInboxID        string
	ParticipantUserID    string
}

type CommunicationsEmailDraftInput struct {
	CompanyID              string
	DraftID                string
	PersonalUserID         string
	PersonalAccountEmail   string
	SharedInboxID          string
	CreatedByUserID        string
	ParticipantUserID      string
	CollaborationID        string
	IsShared               bool
	ExpectedRevision       int64
	UpdatedByUserID        string
	Kind                   string
	SourceMessageID        string
	AccountEmail           string
	ToRecipients           string
	CcRecipients           string
	BccRecipients          string
	Subject                string
	BodyEditorHTML         string
	ReplyToMessageJSON     string
	ScheduledSendTimestamp *time.Time
}

type CommunicationsEmailDraftDeleteInput struct {
	CompanyID            string
	DraftID              string
	PersonalUserID       string
	PersonalAccountEmail string
	SharedInboxID        string
	UpdatedByUserID      string
	ParticipantUserID    string
	ExpectedRevision     int64
	// Now is an internal clock override used by deterministic recovery tests.
	Now time.Time
}
type VersionConflictError struct {
	CurrentRevision int64
}

func (e *VersionConflictError) Error() string { return ErrVersionConflict.Error() }
func (e *VersionConflictError) Unwrap() error { return ErrVersionConflict }

type CommunicationsEmailDraftSendClaimInput struct {
	CompanyID         string
	DraftID           string
	CollaborationID   string
	ParticipantUserID string
	ExpectedRevision  int64
	ProviderGrantID   string
	// Now is an internal clock override used by deterministic repository and
	// handler tests. Production callers leave it zero.
	Now time.Time
}

type CommunicationsEmailDraftSendClaim struct {
	Draft          domain.CommunicationsEmailDraft
	ClaimToken     string
	IdempotencyKey string
	// Recovered is true when this claim took over an expired repository lease
	// for a send whose provider outcome is still uncertain. Callers must not
	// release such a claim merely because a pre-provider retry check fails.
	Recovered bool
}

type CommunicationsEmailDraftSendReleaseInput struct {
	CompanyID  string
	DraftID    string
	ClaimToken string
}

// CommunicationsEmailDraftSendCompleteInput commits the two durable effects of
// a successful provider send together: advance the collaboration snapshot and
// tombstone the claimed shared draft. Implementations must be atomic.
type CommunicationsEmailDraftSendCompleteInput struct {
	CompanyID       string
	DraftID         string
	CollaborationID string
	ClaimToken      string
	UpdatedByUserID string
	Message         domain.EmailMessageSnapshot
}

type CommunicationsEmailSignatureScopeInput struct {
	CompanyID            string
	PersonalUserID       string
	PersonalAccountEmail string
	SharedInboxID        string
}

type CommunicationsEmailSignatureInput struct {
	CompanyID            string
	SignatureID          string
	PersonalUserID       string
	PersonalAccountEmail string
	SharedInboxID        string
	Name                 string
	BodyEditorHTML       string
	IsDefault            bool
	CreatedByUserID      string
	UpdatedByUserID      string
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

func NormalizeRACIRole(role string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case domain.RACIRoleResponsible:
		return domain.RACIRoleResponsible, true
	case domain.RACIRoleConsulted:
		return domain.RACIRoleConsulted, true
	case domain.RACIRoleAccountable:
		return domain.RACIRoleAccountable, true
	case domain.RACIRoleInformed:
		return domain.RACIRoleInformed, true
	default:
		return "", false
	}
}

func NormalizeRACIResourceType(resourceType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(resourceType)) {
	case EntityTypeNode:
		return EntityTypeNode, true
	case EntityTypeLogicGate:
		return EntityTypeLogicGate, true
	case EntityTypeProject:
		return EntityTypeProject, true
	case EntityTypeCompanyExplorerFolder:
		return EntityTypeCompanyExplorerFolder, true
	case EntityTypeSharedInboxFolder:
		return EntityTypeSharedInboxFolder, true
	case EntityTypeSharedInbox:
		return EntityTypeSharedInbox, true
	default:
		return "", false
	}
}

func NormalizeRACIPrincipalType(principalType string) (string, bool) {
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
	case EntityTypeSharedInboxFolder:
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
	case EntityPermissionNoAccess:
		return EntityPermissionNoAccess, true
	case EntityPermissionEdit:
		return EntityPermissionEdit, true
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
	case EntityPermissionEdit:
		return 1
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
