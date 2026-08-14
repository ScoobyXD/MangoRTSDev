package domain

import (
	"strings"
	"time"
)

const (
	RoleDevAdmin       = "dev_admin"
	RoleCompanyAdmin   = "company_admin"
	RoleCompanyManager = "company_manager"
	RoleCompanyUser    = "company_user"
)

const (
	InvitationStatusPending  = "pending"
	InvitationStatusAccepted = "accepted"
	InvitationStatusRevoked  = "revoked"
)

func NormalizeRole(role string) string {
	switch strings.TrimSpace(role) {
	case RoleDevAdmin:
		return RoleDevAdmin
	case RoleCompanyAdmin, "owner", "admin":
		return RoleCompanyAdmin
	case RoleCompanyManager, "manager":
		return RoleCompanyManager
	case RoleCompanyUser, "member", "agent", "":
		return RoleCompanyUser
	default:
		return ""
	}
}

func CanManageCompany(role string) bool {
	role = NormalizeRole(role)
	return role == RoleDevAdmin || role == RoleCompanyAdmin || role == RoleCompanyManager
}

func CanBypassResourcePermissions(role string) bool {
	role = NormalizeRole(role)
	return role == RoleDevAdmin || role == RoleCompanyAdmin
}

func CanInviteCompanyRole(inviterRole, targetRole string) bool {
	inviterRole = NormalizeRole(inviterRole)
	targetRole = NormalizeRole(targetRole)
	switch inviterRole {
	case RoleDevAdmin, RoleCompanyAdmin:
		return targetRole == RoleCompanyAdmin || targetRole == RoleCompanyManager || targetRole == RoleCompanyUser
	case RoleCompanyManager:
		return targetRole == RoleCompanyManager || targetRole == RoleCompanyUser
	default:
		return false
	}
}

type User struct {
	UserID           string    `json:"user_id"`
	CognitoSubject   string    `json:"cognito_subject"`
	Email            string    `json:"email"`
	DisplayName      string    `json:"display_name"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type Company struct {
	CompanyID        string    `json:"company_id"`
	Name             string    `json:"name"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type AccountFolder struct {
	CompanyID        string    `json:"company_id"`
	FolderID         string    `json:"folder_id"`
	ParentFolderID   *string   `json:"parent_folder_id,omitempty"`
	Name             string    `json:"name"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type Account struct {
	CompanyID        string    `json:"company_id"`
	AccountID        string    `json:"account_id"`
	Name             string    `json:"name"`
	FolderID         *string   `json:"folder_id,omitempty"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

// EntityField is a company-scoped label that can be attached to Projects,
// Nodes, and Logic Gates. AssignmentCount is populated by list reads so the
// management surface can explain whether a field is in use before deletion.
type EntityField struct {
	CompanyID        string    `json:"company_id"`
	FieldID          string    `json:"field_id"`
	Name             string    `json:"name"`
	Color            string    `json:"color"`
	Position         int       `json:"position"`
	AssignmentCount  int       `json:"assignment_count,omitempty"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type CompanyMembership struct {
	CompanyID        string    `json:"company_id"`
	CompanyName      string    `json:"company_name,omitempty"`
	UserID           string    `json:"user_id"`
	Role             string    `json:"role"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type CompanyUser struct {
	CompanyID        string    `json:"company_id"`
	UserID           string    `json:"user_id"`
	CognitoSubject   string    `json:"cognito_subject"`
	Email            string    `json:"email"`
	DisplayName      string    `json:"display_name"`
	Role             string    `json:"role"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type CompanyUserOnboarding struct {
	CompanyID                    string     `json:"company_id"`
	Email                        string     `json:"email"`
	Role                         string     `json:"role"`
	UserID                       string     `json:"user_id,omitempty"`
	DisplayName                  string     `json:"display_name,omitempty"`
	InvitationID                 string     `json:"invitation_id,omitempty"`
	InvitationStatus             string     `json:"invitation_status"`
	CognitoStatus                string     `json:"cognito_status"`
	InviteEmailStatus            string     `json:"invite_email_status"`
	InviteEmailError             string     `json:"invite_email_error,omitempty"`
	InviteEmailSentTimestamp     *time.Time `json:"invite_email_sent_timestamp,omitempty"`
	InviteAccepted               bool       `json:"invite_accepted"`
	GoogleConnectionStatus       string     `json:"google_connection_status"`
	GoogleConnectionAccountEmail string     `json:"google_connection_account_email,omitempty"`
	CreatedTimestamp             time.Time  `json:"created_timestamp"`
	UpdatedTimestamp             time.Time  `json:"updated_timestamp"`
}

type CompanyUserGroup struct {
	CompanyID        string    `json:"company_id"`
	GroupID          string    `json:"group_id"`
	ParentGroupID    *string   `json:"parent_group_id,omitempty"`
	Name             string    `json:"name"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type CompanyUserGroupMember struct {
	CompanyID        string    `json:"company_id"`
	GroupID          string    `json:"group_id"`
	UserID           string    `json:"user_id"`
	UserDisplayName  string    `json:"user_display_name,omitempty"`
	UserEmail        string    `json:"user_email,omitempty"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type SavedViewGrouping struct {
	Field     string `json:"field"`
	Direction string `json:"direction"`
}

type SavedViewSettings struct {
	DateAddedSortDirection string `json:"date_added_sort_direction,omitempty"`
	DateAddedSortEnabled   *bool  `json:"date_added_sort_enabled,omitempty"`
}

type SavedView struct {
	CompanyID        string              `json:"company_id"`
	SavedViewID      string              `json:"saved_view_id"`
	Surface          string              `json:"surface"`
	Principal        string              `json:"principal"`
	PrincipalID      string              `json:"principal_id"`
	Name             string              `json:"name"`
	Groupings        []SavedViewGrouping `json:"groupings"`
	Settings         SavedViewSettings   `json:"settings"`
	Position         int                 `json:"position"`
	CreatedTimestamp time.Time           `json:"created_timestamp"`
	UpdatedTimestamp time.Time           `json:"updated_timestamp"`
}

type UserPin struct {
	CompanyID        string    `json:"company_id"`
	PinID            string    `json:"pin_id"`
	UserID           string    `json:"user_id"`
	ParentFolderID   *string   `json:"parent_folder_id"`
	ResourceType     string    `json:"resource_type"`
	ResourceID       string    `json:"resource_id"`
	Name             string    `json:"name"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type UserPinFolder struct {
	CompanyID        string    `json:"company_id"`
	FolderID         string    `json:"folder_id"`
	UserID           string    `json:"user_id"`
	ParentFolderID   *string   `json:"parent_folder_id"`
	Name             string    `json:"name"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type UserPinTree struct {
	PinFolders []UserPinFolder `json:"pin_folders"`
	UserPins   []UserPin       `json:"user_pins"`
}

type RACITabStatusCounts struct {
	Request    int `json:"request"`
	Pending    int `json:"pending"`
	InProgress int `json:"in_progress"`
	Review     int `json:"review"`
}

type RACITabItem struct {
	CompanyID        string              `json:"company_id"`
	UserID           string              `json:"user_id"`
	Role             string              `json:"role"`
	LogicGateID      string              `json:"logic_gate_id"`
	FolderID         *string             `json:"folder_id"`
	Name             string              `json:"name"`
	Position         int                 `json:"position"`
	CreatedTimestamp time.Time           `json:"created_timestamp"`
	UpdatedTimestamp time.Time           `json:"updated_timestamp"`
	StatusCounts     RACITabStatusCounts `json:"status_counts"`
}

type RACITabFolder struct {
	CompanyID        string              `json:"company_id"`
	FolderID         string              `json:"folder_id"`
	UserID           string              `json:"user_id"`
	Role             string              `json:"role"`
	ParentFolderID   *string             `json:"parent_folder_id"`
	Name             string              `json:"name"`
	Position         int                 `json:"position"`
	CreatedTimestamp time.Time           `json:"created_timestamp"`
	UpdatedTimestamp time.Time           `json:"updated_timestamp"`
	HasChildren      bool                `json:"has_children"`
	StatusCounts     RACITabStatusCounts `json:"status_counts"`
}

type RACITabRow struct {
	RowKind string         `json:"row_kind"`
	Folder  *RACITabFolder `json:"folder,omitempty"`
	Item    *RACITabItem   `json:"item,omitempty"`
}

type RACITabPage struct {
	Role           string              `json:"role"`
	ParentFolderID *string             `json:"parent_folder_id"`
	Rows           []RACITabRow        `json:"rows"`
	StatusCounts   RACITabStatusCounts `json:"status_counts"`
	NextCursor     string              `json:"next_cursor,omitempty"`
}

type EntityPermission struct {
	CompanyID        string    `json:"company_id"`
	EntityType       string    `json:"entity_type"`
	EntityID         string    `json:"entity_id"`
	SubjectType      string    `json:"subject_type"`
	SubjectID        string    `json:"subject_id"`
	SubjectName      string    `json:"subject_name,omitempty"`
	SubjectEmail     string    `json:"subject_email,omitempty"`
	Permission       string    `json:"permission"`
	AccessLevel      string    `json:"access_level,omitempty"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type ResourceAccessPolicy struct {
	CompanyID        string             `json:"company_id"`
	ResourceType     string             `json:"resource_type"`
	ResourceID       string             `json:"resource_id"`
	DefaultAccess    string             `json:"default_access"`
	Overrides        []EntityPermission `json:"overrides"`
	CreatedTimestamp time.Time          `json:"created_timestamp,omitempty"`
	UpdatedTimestamp time.Time          `json:"updated_timestamp,omitempty"`
}

type EffectiveResourceAccess struct {
	CompanyID        string    `json:"company_id"`
	UserID           string    `json:"user_id"`
	ResourceType     string    `json:"resource_type"`
	ResourceID       string    `json:"resource_id"`
	AccessLevel      string    `json:"access_level"`
	SourceType       string    `json:"source_type"`
	SourceID         string    `json:"source_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type Attachment struct {
	CompanyID        string `json:"company_id"`
	AttachmentID     string `json:"attachment_id"`
	UploadedByUserID string `json:"uploaded_by_user_id,omitempty"`
	OriginalFilename string `json:"original_filename"`
	MimeType         string `json:"mime_type"`
	ByteSize         int64  `json:"byte_size"`
	SHA256           string `json:"sha256"`
	// ChecksumVerificationMethod records how SHA256 was verified without
	// changing its meaning: SHA256 is always the lowercase hexadecimal digest
	// of the raw file bytes.
	SHA256VerificationMethod string               `json:"sha256_verification_method,omitempty"`
	StorageChecksumAlgorithm string               `json:"storage_checksum_algorithm,omitempty"`
	StorageChecksumValue     string               `json:"storage_checksum_value,omitempty"`
	StorageChecksumType      string               `json:"storage_checksum_type,omitempty"`
	StorageBucket            string               `json:"-"`
	StorageKey               string               `json:"-"`
	OriginalWidth            *int                 `json:"original_width,omitempty"`
	OriginalHeight           *int                 `json:"original_height,omitempty"`
	SourceKind               string               `json:"source_kind"`
	SourceProvider           string               `json:"source_provider,omitempty"`
	CreatedTimestamp         time.Time            `json:"created_timestamp"`
	DeletedTimestamp         *time.Time           `json:"deleted_timestamp,omitempty"`
	Variants                 []AttachmentVariant  `json:"variants,omitempty"`
	ResourceLinks            []ResourceAttachment `json:"resource_links,omitempty"`
}

const (
	AttachmentUploadStatusPending    = "pending"
	AttachmentUploadStatusUploading  = "uploading"
	AttachmentUploadStatusCompleting = "completing"
	AttachmentUploadStatusCompleted  = "completed"
	AttachmentUploadStatusFailed     = "failed"
	AttachmentUploadStatusAborted    = "aborted"
	AttachmentUploadStatusExpired    = "expired"

	AttachmentUploadStrategySingle    = "single"
	AttachmentUploadStrategyMultipart = "multipart"
)

// AttachmentUploadIntent is the durable server-owned record for a direct
// browser upload. Storage coordinates are deliberately omitted from JSON so
// callers can never learn or choose object keys or multipart upload IDs.
type AttachmentUploadIntent struct {
	UploadIntentID           string     `json:"uploadIntentId"`
	CompanyID                string     `json:"-"`
	ActorUserID              string     `json:"-"`
	ClientRequestID          string     `json:"-"`
	AttachmentID             string     `json:"attachmentId"`
	ResourceAttachmentID     string     `json:"-"`
	OriginalFilename         string     `json:"filename"`
	MimeType                 string     `json:"contentType"`
	SizeBytes                int64      `json:"sizeBytes"`
	SHA256                   string     `json:"sha256"`
	SHA256VerificationMethod string     `json:"sha256VerificationMethod,omitempty"`
	StorageChecksumAlgorithm string     `json:"-"`
	StorageChecksumValue     string     `json:"-"`
	StorageChecksumType      string     `json:"-"`
	ResourceType             string     `json:"-"`
	ResourceID               string     `json:"-"`
	InformationID            string     `json:"-"`
	MessageID                string     `json:"-"`
	EditorSurface            string     `json:"-"`
	RelationshipKind         string     `json:"-"`
	SourceKind               string     `json:"-"`
	SourceProvider           string     `json:"-"`
	OriginalWidth            *int       `json:"-"`
	OriginalHeight           *int       `json:"-"`
	StorageBucket            string     `json:"-"`
	StorageKey               string     `json:"-"`
	MultipartUploadID        string     `json:"-"`
	Strategy                 string     `json:"strategy"`
	PartSizeBytes            int64      `json:"partSizeBytes,omitempty"`
	PartCount                int        `json:"partCount,omitempty"`
	Status                   string     `json:"status"`
	FailureCode              string     `json:"failureCode,omitempty"`
	Version                  int64      `json:"-"`
	CreatedTimestamp         time.Time  `json:"createdAt"`
	UpdatedTimestamp         time.Time  `json:"updatedAt"`
	ExpiresTimestamp         time.Time  `json:"expiresAt"`
	CompletedTimestamp       *time.Time `json:"completedAt,omitempty"`
}

// AttachmentUploadPart persists both the checksum the browser committed to
// before signing and the S3-observed result used during reconciliation.
type AttachmentUploadPart struct {
	UploadIntentID      string     `json:"-"`
	PartNumber          int        `json:"partNumber"`
	ExpectedSizeBytes   int64      `json:"expectedSizeBytes,omitempty"`
	ObservedSizeBytes   int64      `json:"sizeBytes,omitempty"`
	ChecksumAlgorithm   string     `json:"checksumAlgorithm,omitempty"`
	ExpectedChecksum    string     `json:"checksum,omitempty"`
	ETag                string     `json:"eTag,omitempty"`
	S3Checksum          string     `json:"s3Checksum,omitempty"`
	CreatedTimestamp    time.Time  `json:"-"`
	UpdatedTimestamp    time.Time  `json:"-"`
	SigningAttemptCount int        `json:"-"`
	LastSignedTimestamp *time.Time `json:"-"`
	UploadedTimestamp   *time.Time `json:"uploadedAt,omitempty"`
}

type AttachmentVariant struct {
	AttachmentID      string    `json:"attachment_id"`
	VariantType       string    `json:"variant_type"`
	MimeType          string    `json:"mime_type"`
	ByteSize          int64     `json:"byte_size"`
	SHA256            *string   `json:"sha256,omitempty"`
	GenerationVersion *int      `json:"generation_version,omitempty"`
	Width             *int      `json:"width,omitempty"`
	Height            *int      `json:"height,omitempty"`
	StorageBucket     string    `json:"-"`
	StorageKey        string    `json:"-"`
	CreatedTimestamp  time.Time `json:"created_timestamp"`
	UpdatedTimestamp  time.Time `json:"updated_timestamp"`
}

type ResourceAttachment struct {
	ResourceAttachmentID string      `json:"resource_attachment_id"`
	CompanyID            string      `json:"company_id"`
	ResourceType         string      `json:"resource_type"`
	ResourceID           string      `json:"resource_id"`
	AttachmentID         string      `json:"attachment_id"`
	InformationID        string      `json:"information_id,omitempty"`
	MessageID            string      `json:"message_id,omitempty"`
	EditorSurface        string      `json:"editor_surface,omitempty"`
	RelationshipKind     string      `json:"relationship_kind"`
	CreatedByUserID      string      `json:"created_by_user_id,omitempty"`
	CreatedTimestamp     time.Time   `json:"created_timestamp"`
	DeletedTimestamp     *time.Time  `json:"deleted_timestamp,omitempty"`
	Attachment           *Attachment `json:"attachment,omitempty"`
}

type Invitation struct {
	InvitationID       string     `json:"invitation_id"`
	CompanyID          string     `json:"company_id"`
	CompanyName        string     `json:"company_name,omitempty"`
	Email              string     `json:"email"`
	Role               string     `json:"role"`
	Status             string     `json:"status"`
	Token              string     `json:"token,omitempty"`
	CognitoStatus      string     `json:"cognito_status,omitempty"`
	CognitoError       string     `json:"cognito_error,omitempty"`
	InviteEmailStatus  string     `json:"invite_email_status,omitempty"`
	InviteEmailError   string     `json:"invite_email_error,omitempty"`
	InvitedByUserID    string     `json:"invited_by_user_id"`
	AcceptedByUserID   *string    `json:"accepted_by_user_id,omitempty"`
	ExpiresTimestamp   time.Time  `json:"expires_timestamp"`
	AcceptedTimestamp  *time.Time `json:"accepted_timestamp,omitempty"`
	EmailSentTimestamp *time.Time `json:"invite_email_sent_timestamp,omitempty"`
	CreatedTimestamp   time.Time  `json:"created_timestamp"`
	UpdatedTimestamp   time.Time  `json:"updated_timestamp"`
}

type UserEmailConnection struct {
	EmailConnectionID        string    `json:"email_connection_id,omitempty"`
	UserID                   string    `json:"user_id"`
	Provider                 string    `json:"provider"`
	AccountEmail             string    `json:"account_email"`
	Scope                    string    `json:"scope,omitempty"`
	CompanyID                string    `json:"company_id,omitempty"`
	CompanyEmailConnectionID string    `json:"company_email_connection_id,omitempty"`
	GrantID                  string    `json:"-"`
	Status                   string    `json:"status"`
	IngestionStartedAt       time.Time `json:"ingestion_started_at,omitempty"`
	LastSuccessfulScanAt     time.Time `json:"last_successful_scan_at,omitempty"`
	CreatedTimestamp         time.Time `json:"created_timestamp"`
	UpdatedTimestamp         time.Time `json:"updated_timestamp"`
}

type CompanyEmailConnection struct {
	EmailConnectionID        string    `json:"email_connection_id,omitempty"`
	CompanyEmailConnectionID string    `json:"company_email_connection_id"`
	CompanyID                string    `json:"company_id"`
	Provider                 string    `json:"provider"`
	AccountEmail             string    `json:"account_email"`
	GrantID                  string    `json:"-"`
	Status                   string    `json:"status"`
	ConnectedByUserID        string    `json:"connected_by_user_id,omitempty"`
	IngestionStartedAt       time.Time `json:"ingestion_started_at,omitempty"`
	LastSuccessfulScanAt     time.Time `json:"last_successful_scan_at,omitempty"`
	CreatedTimestamp         time.Time `json:"created_timestamp"`
	UpdatedTimestamp         time.Time `json:"updated_timestamp"`
}

type EmailAddressSnapshot struct {
	Name  string `json:"name,omitempty"`
	Email string `json:"email"`
}

// EmailAttachmentSnapshot is durable attachment metadata. Provider bytes live
// in Mango's private attachment object storage; temporary provider/download
// URLs and raw bytes must never be copied into email rows or Node JSON.
type EmailAttachmentSnapshot struct {
	ID                 string `json:"id,omitempty"`
	AttachmentID       string `json:"attachment_id,omitempty"`
	Filename           string `json:"filename"`
	ContentType        string `json:"content_type,omitempty"`
	ContentID          string `json:"content_id,omitempty"`
	ContentDisposition string `json:"content_disposition,omitempty"`
	IsInline           bool   `json:"is_inline,omitempty"`
	Size               int64  `json:"size,omitempty"`
}

type EmailMessageSnapshot struct {
	EmailMessageID   string                    `json:"email_message_id,omitempty"`
	EmailThreadID    string                    `json:"email_thread_id,omitempty"`
	MessageOrder     *int                      `json:"message_order,omitempty"`
	ID               string                    `json:"id"`
	ThreadID         string                    `json:"thread_id,omitempty"`
	Subject          string                    `json:"subject"`
	Snippet          string                    `json:"snippet,omitempty"`
	Body             string                    `json:"body,omitempty"`
	Date             int64                     `json:"date,omitempty"`
	Unread           bool                      `json:"unread"`
	Starred          bool                      `json:"starred"`
	From             []EmailAddressSnapshot    `json:"from,omitempty"`
	To               []EmailAddressSnapshot    `json:"to,omitempty"`
	Cc               []EmailAddressSnapshot    `json:"cc,omitempty"`
	Bcc              []EmailAddressSnapshot    `json:"bcc,omitempty"`
	ReplyTo          []EmailAddressSnapshot    `json:"reply_to,omitempty"`
	Attachments      []EmailAttachmentSnapshot `json:"attachments,omitempty"`
	Folders          []string                  `json:"folders,omitempty"`
	FolderIDs        []string                  `json:"folder_ids,omitempty"`
	DownloadComplete bool                      `json:"download_complete"`
}

// CommunicationsEmailThread is Mango's provider-independent, durable copy of
// an imported mailbox thread. EmailThreadID and each message's Mango ID remain
// stable while provider identifiers are retained only for mailbox-scoped
// deduplication and refreshes.
type CommunicationsEmailThread struct {
	CompanyID             string                       `json:"company_id"`
	EmailThreadID         string                       `json:"email_thread_id"`
	EmailConnectionID     string                       `json:"email_connection_id"`
	ScopeType             string                       `json:"scope_type"`
	PersonalUserID        string                       `json:"personal_user_id,omitempty"`
	PersonalAccountEmail  string                       `json:"personal_account_email,omitempty"`
	SharedInboxID         string                       `json:"shared_inbox_id,omitempty"`
	AccountEmail          string                       `json:"account_email"`
	Provider              string                       `json:"provider"`
	ProviderThreadID      string                       `json:"provider_thread_id,omitempty"`
	RootProviderMessageID string                       `json:"root_provider_message_id"`
	DownloadStatus        string                       `json:"download_status"`
	HistoryComplete       bool                         `json:"history_complete"`
	FetchedAt             *time.Time                   `json:"fetched_at,omitempty"`
	LastDownloadError     string                       `json:"last_download_error,omitempty"`
	CreatedTimestamp      time.Time                    `json:"created_timestamp"`
	UpdatedTimestamp      time.Time                    `json:"updated_timestamp"`
	Messages              []CommunicationsEmailMessage `json:"messages"`
}

type CommunicationsEmailMessage struct {
	CompanyID         string               `json:"company_id"`
	EmailMessageID    string               `json:"email_message_id"`
	EmailThreadID     string               `json:"email_thread_id"`
	ProviderMessageID string               `json:"provider_message_id"`
	ProviderThreadID  string               `json:"provider_thread_id,omitempty"`
	MessageOrder      int                  `json:"message_order"`
	Message           EmailMessageSnapshot `json:"message"`
	CreatedTimestamp  time.Time            `json:"created_timestamp"`
	UpdatedTimestamp  time.Time            `json:"updated_timestamp"`
}

type CommunicationsNodeEmailThread struct {
	CompanyID         string                    `json:"company_id"`
	NodeID            string                    `json:"node_id"`
	InformationID     string                    `json:"information_id"`
	EmailThreadID     string                    `json:"email_thread_id"`
	SelectedMessageID string                    `json:"selected_message_id"`
	CreatedByUserID   string                    `json:"created_by_user_id,omitempty"`
	CreatedTimestamp  time.Time                 `json:"created_timestamp"`
	Thread            CommunicationsEmailThread `json:"thread"`
}

type CommunicationsProjectEmailThread struct {
	CompanyID         string                    `json:"company_id"`
	ProjectID         string                    `json:"project_id"`
	InformationID     string                    `json:"information_id"`
	EmailThreadID     string                    `json:"email_thread_id"`
	SelectedMessageID string                    `json:"selected_message_id"`
	CreatedTimestamp  time.Time                 `json:"created_timestamp"`
	Thread            CommunicationsEmailThread `json:"thread"`
}

type CommunicationsMessageReadStatus struct {
	ScopeType                string                            `json:"-"`
	ScopeID                  string                            `json:"-"`
	UserID                   string                            `json:"-"`
	PersonalAccountEmail     string                            `json:"-"`
	CompanyID                string                            `json:"-"`
	CompanyEmailConnectionID string                            `json:"-"`
	SharedInboxID            string                            `json:"-"`
	MessageID                string                            `json:"message_id,omitempty"`
	ThreadID                 string                            `json:"thread_id,omitempty"`
	Status                   string                            `json:"status"`
	SignalCount              int                               `json:"signal_count,omitempty"`
	FirstSignalTimestamp     time.Time                         `json:"first_signal_timestamp"`
	LastSignalTimestamp      time.Time                         `json:"last_signal_timestamp"`
	Signals                  []CommunicationsMessageReadSignal `json:"signals,omitempty"`
	CreatedTimestamp         time.Time                         `json:"created_timestamp,omitempty"`
	UpdatedTimestamp         time.Time                         `json:"updated_timestamp,omitempty"`
}

type CommunicationsMessageReadSignal struct {
	Timestamp time.Time `json:"timestamp"`
}

type CommunicationsEmailDraft struct {
	CompanyID                string     `json:"company_id"`
	DraftID                  string     `json:"draft_id"`
	ScopeType                string     `json:"scope_type"`
	PersonalUserID           string     `json:"personal_user_id,omitempty"`
	PersonalAccountEmail     string     `json:"personal_account_email,omitempty"`
	SharedInboxID            string     `json:"shared_inbox_id,omitempty"`
	CollaborationID          string     `json:"collaboration_id,omitempty"`
	EmailThreadID            string     `json:"email_thread_id,omitempty"`
	OriginNodeID             string     `json:"origin_node_id,omitempty"`
	IsShared                 bool       `json:"is_shared,omitempty"`
	Revision                 int64      `json:"revision,omitempty"`
	SendState                string     `json:"send_state,omitempty"`
	SendClaimToken           string     `json:"-"`
	SendIdempotencyKey       string     `json:"-"`
	SendIdempotencyGrantID   string     `json:"-"`
	SendIdempotencyTimestamp *time.Time `json:"-"`
	SendClaimedRevision      int64      `json:"-"`
	SendClaimedTimestamp     *time.Time `json:"-"`
	SentMessageID            string     `json:"sent_message_id,omitempty"`
	CreatedByUserID          string     `json:"created_by_user_id,omitempty"`
	UpdatedByUserID          string     `json:"updated_by_user_id,omitempty"`
	Kind                     string     `json:"kind"`
	SourceMessageID          string     `json:"source_message_id,omitempty"`
	AccountEmail             string     `json:"account_email,omitempty"`
	ToRecipients             string     `json:"to_recipients"`
	CcRecipients             string     `json:"cc_recipients"`
	BccRecipients            string     `json:"bcc_recipients"`
	Subject                  string     `json:"subject"`
	BodyEditorHTML           string     `json:"body_editor_html"`
	ReplyToMessageJSON       string     `json:"-"`
	ScheduledSendTimestamp   *time.Time `json:"scheduled_send_timestamp,omitempty"`
	CreatedTimestamp         time.Time  `json:"created_timestamp"`
	UpdatedTimestamp         time.Time  `json:"updated_timestamp"`
	DeletedTimestamp         *time.Time `json:"deleted_timestamp,omitempty"`
}

type CommunicationsEmailSignature struct {
	CompanyID            string    `json:"company_id"`
	SignatureID          string    `json:"signature_id"`
	ScopeType            string    `json:"scope_type"`
	PersonalUserID       string    `json:"personal_user_id,omitempty"`
	PersonalAccountEmail string    `json:"personal_account_email,omitempty"`
	SharedInboxID        string    `json:"shared_inbox_id,omitempty"`
	Name                 string    `json:"name"`
	BodyEditorHTML       string    `json:"body_editor_html"`
	IsDefault            bool      `json:"is_default"`
	CreatedByUserID      string    `json:"created_by_user_id,omitempty"`
	UpdatedByUserID      string    `json:"updated_by_user_id,omitempty"`
	CreatedTimestamp     time.Time `json:"created_timestamp"`
	UpdatedTimestamp     time.Time `json:"updated_timestamp"`
}

type CommunicationsTriageItem struct {
	UserID           string               `json:"user_id"`
	MessageID        string               `json:"message_id"`
	Message          EmailMessageSnapshot `json:"message"`
	CreatedTimestamp time.Time            `json:"created_timestamp"`
	UpdatedTimestamp time.Time            `json:"updated_timestamp"`
}

type CommunicationsEmailPlacement struct {
	CompanyID        string    `json:"company_id"`
	UserID           string    `json:"user_id"`
	MessageID        string    `json:"message_id"`
	NodeID           string    `json:"node_id"`
	BoardID          string    `json:"board_id"`
	CardID           string    `json:"card_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

// CommunicationsEmailCollaboration is the durable bridge between an email
// provider thread and the standalone Mango node that owns its shared chat.
// Message is a provider-independent snapshot so permanent participants can
// render the shared card without access to the source mailbox credentials.
type CommunicationsEmailCollaboration struct {
	CompanyID                  string                                        `json:"company_id"`
	CollaborationID            string                                        `json:"collaboration_id"`
	NodeID                     string                                        `json:"node_id"`
	AttachedEmailInformationID string                                        `json:"attached_email_information_id"`
	ScopeType                  string                                        `json:"scope_type"`
	PersonalUserID             string                                        `json:"personal_user_id,omitempty"`
	PersonalAccountEmail       string                                        `json:"personal_account_email,omitempty"`
	SharedInboxID              string                                        `json:"shared_inbox_id,omitempty"`
	AccountEmail               string                                        `json:"account_email"`
	Provider                   string                                        `json:"provider"`
	ProviderThreadID           string                                        `json:"provider_thread_id,omitempty"`
	EmailThreadID              string                                        `json:"email_thread_id,omitempty"`
	RootMessageID              string                                        `json:"root_message_id"`
	LatestMessageID            string                                        `json:"latest_message_id"`
	Message                    EmailMessageSnapshot                          `json:"message"`
	CreatedByUserID            string                                        `json:"created_by_user_id,omitempty"`
	CreatedTimestamp           time.Time                                     `json:"created_timestamp"`
	UpdatedTimestamp           time.Time                                     `json:"updated_timestamp"`
	Participants               []CommunicationsEmailCollaborationParticipant `json:"participants,omitempty"`
}

// CommunicationsEmailThreadChatGroup is one exact Node textbox in an email
// thread and the chats owned by that textbox. Thread chat is a read view over
// canonical email relationships and Node textbox chats; it owns no data.
type CommunicationsEmailThreadChatGroup struct {
	NodeID              string                                       `json:"node_id"`
	NodeName            string                                       `json:"node_name"`
	TextboxID           string                                       `json:"textbox_id"`
	TextboxTitle        string                                       `json:"textbox_title"`
	TextboxDisplayOrder int64                                        `json:"textbox_display_order"`
	EmailThreadID       string                                       `json:"email_thread_id"`
	LinkedMessages      []CommunicationsEmailThreadChatLinkedMessage `json:"linked_messages"`
	Chats               []NodeProjection                             `json:"chats"`
}

type CommunicationsEmailThreadChatLinkedMessage struct {
	EmailMessageID    string    `json:"email_message_id"`
	ProviderMessageID string    `json:"provider_message_id"`
	MessageTimestamp  time.Time `json:"message_timestamp"`
}

type CommunicationsEmailThreadTextboxLink struct {
	NodeID            string `json:"node_id"`
	TextboxID         string `json:"textbox_id"`
	EmailMessageID    string `json:"email_message_id"`
	ProviderMessageID string `json:"provider_message_id"`
}

type CommunicationsEmailThreadChatView struct {
	Groups       []CommunicationsEmailThreadChatGroup   `json:"groups"`
	TextboxLinks []CommunicationsEmailThreadTextboxLink `json:"textbox_links"`
}

type CommunicationsEmailCollaborationParticipant struct {
	CompanyID        string    `json:"company_id"`
	CollaborationID  string    `json:"collaboration_id"`
	UserID           string    `json:"user_id"`
	AddedByUserID    string    `json:"added_by_user_id,omitempty"`
	AddedViaType     string    `json:"added_via_type"`
	AddedViaID       string    `json:"added_via_id,omitempty"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type UserLogicGateShortcut struct {
	UserID           string    `json:"user_id"`
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type Node struct {
	CompanyID        string    `json:"company_id"`
	NodeID           string    `json:"node_id"`
	Title            string    `json:"name"`
	DefaultAccess    string    `json:"default_access"`
	Status           *string   `json:"status"`
	DueDate          *string   `json:"due_date"`
	Priority         *int      `json:"priority"`
	LogicGateIDs     []string  `json:"logic_gate_ids,omitempty"`
	Accounts         []Account `json:"accounts,omitempty"`
	EffectiveAccess  string    `json:"effective_access_level,omitempty"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type NodeRelationship struct {
	CompanyID          string    `json:"company_id"`
	NodeRelationshipID string    `json:"node_relationship_id"`
	NodeIDA            string    `json:"node_id_a"`
	NodeIDB            string    `json:"node_id_b"`
	APosition          string    `json:"a_position"`
	BPosition          string    `json:"b_position"`
	CreatedTimestamp   time.Time `json:"created_timestamp"`
}

type NodeInformation struct {
	CompanyID           string    `json:"company_id"`
	InformationID       string    `json:"information_id"`
	NodeID              string    `json:"node_id"`
	Type                string    `json:"type"`
	Information         string    `json:"information"`
	SaveBatchID         string    `json:"save_batch_id,omitempty"`
	SaveKind            string    `json:"save_kind,omitempty"`
	SavedByUserID       string    `json:"saved_by_user_id,omitempty"`
	SavedByDisplayName  string    `json:"saved_by_display_name,omitempty"`
	SourceInformationID string    `json:"source_information_id,omitempty"`
	CreatedTimestamp    time.Time `json:"created_timestamp"`
	UpdatedTimestamp    time.Time `json:"updated_timestamp"`
}

type NodeProjection struct {
	CompanyID        string    `json:"company_id"`
	NodeID           string    `json:"node_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	IsDeleted        bool      `json:"is_deleted"`
	InformationID    string    `json:"information_id"`
	Revision         int64     `json:"revision"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

const (
	NodeTimelineEventLogicGateTransfer   = "logic_gate_transfer"
	NodeTimelineEventProjectAssignment   = "project_assignment"
	NodeTimelineEventVerificationRequest = "verification_request"
)

type NodeTimelineVerificationRecipient struct {
	CompanyID          string     `json:"company_id"`
	NodeID             string     `json:"node_id"`
	EventID            string     `json:"event_id"`
	UserID             string     `json:"user_id"`
	UserDisplayName    string     `json:"user_display_name"`
	CompletedTimestamp *time.Time `json:"completed_timestamp,omitempty"`
	CreatedTimestamp   time.Time  `json:"created_timestamp"`
}

type NodeTimelineEvent struct {
	EventID                string                              `json:"event_id"`
	CompanyID              string                              `json:"company_id"`
	NodeID                 string                              `json:"node_id"`
	Type                   string                              `json:"type"`
	ActorUserID            string                              `json:"actor_user_id,omitempty"`
	ActorDisplayName       string                              `json:"actor_display_name"`
	FromLogicGateID        string                              `json:"from_logic_gate_id,omitempty"`
	FromLogicGateName      string                              `json:"from_logic_gate_name,omitempty"`
	ToLogicGateID          string                              `json:"to_logic_gate_id,omitempty"`
	ToLogicGateName        string                              `json:"to_logic_gate_name,omitempty"`
	ProjectID              string                              `json:"project_id,omitempty"`
	ProjectName            string                              `json:"project_name,omitempty"`
	IdempotencyKey         string                              `json:"-"`
	VerificationRecipients []NodeTimelineVerificationRecipient `json:"verification_recipients"`
	CreatedTimestamp       time.Time                           `json:"created_timestamp"`
}

type NodeDetails struct {
	Node               Node               `json:"node"`
	Information        []NodeInformation  `json:"information"`
	Relationships      []NodeRelationship `json:"relationships"`
	InformationCount   int                `json:"information_count"`
	RelationshipsCount int                `json:"relationships_count"`
}

type EffectiveAccessFlags struct {
	CanEdit bool `json:"can_edit"`
}

type NodeView struct {
	CompanyID            string                    `json:"company_id"`
	NodeID               string                    `json:"node_id"`
	Node                 Node                      `json:"node"`
	Information          []NodeInformation         `json:"information"`
	Projections          []NodeProjection          `json:"projections"`
	Relationships        []NodeRelationship        `json:"relationships"`
	LogicGateAssignments []NodeLogicGateAssignment `json:"logic_gate_assignments"`
	RACIAssignments      []ResourceRACIAssignment  `json:"gvic_assignments"`
	TimelineEvents       []NodeTimelineEvent       `json:"timeline_events"`
	TimelineEventCount   int                       `json:"timeline_event_count"`
	InformationCount     int                       `json:"information_count"`
	ProjectionCount      int                       `json:"projection_count"`
	RelationshipsCount   int                       `json:"relationships_count"`
	AssignmentCount      int                       `json:"assignment_count"`
	EffectiveAccessFlags
}

type LogicGate struct {
	CompanyID        string                    `json:"company_id"`
	LogicGateID      string                    `json:"logic_gate_id"`
	Header           string                    `json:"header"`
	DefaultAccess    string                    `json:"default_access"`
	RACIAssignments  []LogicGateRACIAssignment `json:"gvic_assignments,omitempty"`
	EffectiveAccess  string                    `json:"effective_access_level,omitempty"`
	CreatedTimestamp time.Time                 `json:"created_timestamp"`
}

type HuddleLogicGate struct {
	CompanyID         string    `json:"company_id"`
	HuddleLogicGateID string    `json:"huddle_logic_gate_id"`
	Header            string    `json:"header"`
	CreatedTimestamp  time.Time `json:"created_timestamp"`
	UpdatedTimestamp  time.Time `json:"updated_timestamp"`
}

type HuddleNode struct {
	CompanyID         string    `json:"company_id"`
	HuddleNodeID      string    `json:"huddle_node_id"`
	HuddleLogicGateID string    `json:"huddle_logic_gate_id"`
	Name              string    `json:"name"`
	CreatedTimestamp  time.Time `json:"created_timestamp"`
	UpdatedTimestamp  time.Time `json:"updated_timestamp"`
}

type KPI struct {
	CompanyID        string    `json:"company_id"`
	KPIID            string    `json:"kpi_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Name             string    `json:"name"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type HuddleLogicGateRelationship struct {
	CompanyID         string    `json:"company_id"`
	HuddleLogicGateID string    `json:"huddle_logic_gate_id"`
	LogicGateID       string    `json:"logic_gate_id"`
	CreatedTimestamp  time.Time `json:"created_timestamp"`
}

type HuddleNodeLogicGateRelationship struct {
	CompanyID        string    `json:"company_id"`
	HuddleNodeID     string    `json:"huddle_node_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type HuddleNodeKPIRelationship struct {
	CompanyID        string    `json:"company_id"`
	HuddleNodeID     string    `json:"huddle_node_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	KPIID            string    `json:"kpi_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type HuddleLogicGateCard struct {
	CompanyID   string `json:"company_id"`
	LogicGateID string `json:"logic_gate_id"`
	Header      string `json:"header"`
	KPIs        []KPI  `json:"kpis"`
}

type HuddleExplorerFolder struct {
	CompanyID        string    `json:"company_id"`
	FolderID         string    `json:"folder_id"`
	ParentFolderID   *string   `json:"parent_folder_id"`
	Name             string    `json:"name"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type HuddleExplorerItem struct {
	CompanyID        string    `json:"company_id"`
	ItemID           string    `json:"item_id"`
	ParentFolderID   *string   `json:"parent_folder_id"`
	ResourceType     string    `json:"resource_type"`
	ResourceID       string    `json:"resource_id"`
	Name             string    `json:"name"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type HuddleExplorer struct {
	Folders []HuddleExplorerFolder `json:"folders"`
	Items   []HuddleExplorerItem   `json:"items"`
}

const (
	RACIRoleResponsible = "responsible"
	RACIRoleAccountable = "accountable"
	RACIRoleConsulted   = "consulted"
	RACIRoleInformed    = "informed"
)

type ResourceRACIAssignment struct {
	CompanyID          string    `json:"company_id"`
	ResourceType       string    `json:"resource_type"`
	ResourceID         string    `json:"resource_id"`
	Role               string    `json:"role"`
	PrincipalType      string    `json:"principal_type"`
	PrincipalID        string    `json:"principal_id"`
	PrincipalName      string    `json:"principal_name,omitempty"`
	UserID             string    `json:"user_id,omitempty"`
	UserDisplayName    string    `json:"user_display_name,omitempty"`
	UserEmail          string    `json:"user_email,omitempty"`
	SourceResourceType string    `json:"source_resource_type,omitempty"`
	SourceResourceID   string    `json:"source_resource_id,omitempty"`
	InheritanceType    string    `json:"inheritance_type,omitempty"`
	Inherited          bool      `json:"inherited,omitempty"`
	ReadOnly           bool      `json:"read_only,omitempty"`
	CreatedTimestamp   time.Time `json:"created_timestamp"`
	UpdatedTimestamp   time.Time `json:"updated_timestamp"`
}

type ResourceRACIEffectiveAssignment struct {
	CompanyID           string    `json:"company_id"`
	ResourceType        string    `json:"resource_type"`
	ResourceID          string    `json:"resource_id"`
	Role                string    `json:"role"`
	UserID              string    `json:"user_id"`
	SourceResourceType  string    `json:"source_resource_type"`
	SourceResourceID    string    `json:"source_resource_id"`
	SourcePrincipalType string    `json:"source_principal_type"`
	SourcePrincipalID   string    `json:"source_principal_id"`
	InheritanceType     string    `json:"inheritance_type"`
	UserDisplayName     string    `json:"user_display_name,omitempty"`
	UserEmail           string    `json:"user_email,omitempty"`
	UpdatedTimestamp    time.Time `json:"updated_timestamp"`
}

type LogicGateRACIAssignment struct {
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Role             string    `json:"role"`
	PrincipalType    string    `json:"principal_type,omitempty"`
	PrincipalID      string    `json:"principal_id,omitempty"`
	PrincipalName    string    `json:"principal_name,omitempty"`
	UserID           string    `json:"user_id"`
	UserDisplayName  string    `json:"user_display_name,omitempty"`
	UserEmail        string    `json:"user_email,omitempty"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type LogicGateRelationship struct {
	CompanyID               string    `json:"company_id"`
	LogicGateRelationshipID string    `json:"logic_gate_relationship_id"`
	LogicGateIDA            string    `json:"logic_gate_id_a"`
	LogicGateIDB            string    `json:"logic_gate_id_b"`
	APosition               string    `json:"a_position"`
	BPosition               string    `json:"b_position"`
	CreatedTimestamp        time.Time `json:"created_timestamp"`
}

type LogicGateInformation struct {
	CompanyID           string    `json:"company_id"`
	InformationID       string    `json:"information_id"`
	LogicGateID         string    `json:"logic_gate_id"`
	Type                string    `json:"type"`
	Information         string    `json:"information"`
	SaveBatchID         string    `json:"save_batch_id,omitempty"`
	SaveKind            string    `json:"save_kind,omitempty"`
	SavedByUserID       string    `json:"saved_by_user_id,omitempty"`
	SavedByDisplayName  string    `json:"saved_by_display_name,omitempty"`
	SourceInformationID string    `json:"source_information_id,omitempty"`
	CreatedTimestamp    time.Time `json:"created_timestamp"`
	UpdatedTimestamp    time.Time `json:"updated_timestamp"`
}

type LogicGateProjection struct {
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	IsDeleted        bool      `json:"is_deleted"`
	InformationID    string    `json:"information_id"`
	Revision         int64     `json:"revision"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type LogicGateDetails struct {
	LogicGate     LogicGate               `json:"logic_gate"`
	Information   []LogicGateInformation  `json:"information"`
	Relationships []LogicGateRelationship `json:"relationships"`
}

type EditorSaveVersionItem struct {
	InformationID       string    `json:"information_id"`
	SourceInformationID string    `json:"source_information_id"`
	Type                string    `json:"type"`
	Information         string    `json:"information"`
	CreatedTimestamp    time.Time `json:"created_timestamp"`
	UpdatedTimestamp    time.Time `json:"updated_timestamp"`
}

type EditorSaveVersion struct {
	CompanyID          string                  `json:"company_id"`
	ResourceType       string                  `json:"resource_type"`
	ResourceID         string                  `json:"resource_id"`
	SaveID             string                  `json:"save_id"`
	SaveKind           string                  `json:"save_kind"`
	SavedByUserID      string                  `json:"saved_by_user_id,omitempty"`
	SavedByDisplayName string                  `json:"saved_by_display_name,omitempty"`
	CreatedTimestamp   time.Time               `json:"created_timestamp"`
	UpdatedTimestamp   time.Time               `json:"updated_timestamp"`
	ItemCount          int                     `json:"item_count"`
	Items              []EditorSaveVersionItem `json:"items,omitempty"`
}

type LogicGateView struct {
	CompanyID           string                    `json:"company_id"`
	LogicGateID         string                    `json:"logic_gate_id"`
	LogicGate           LogicGate                 `json:"logic_gate"`
	Information         []LogicGateInformation    `json:"information"`
	Projections         []LogicGateProjection     `json:"projections"`
	RACIAssignments     []LogicGateRACIAssignment `json:"gvic_assignments"`
	Relationships       []LogicGateRelationship   `json:"relationships"`
	Work                LogicGateWorkView         `json:"work"`
	InformationCount    int                       `json:"information_count"`
	ProjectionCount     int                       `json:"projection_count"`
	RACIAssignmentCount int                       `json:"gvic_assignment_count"`
	RelationshipsCount  int                       `json:"relationships_count"`
	AssignmentCount     int                       `json:"assignment_count"`
	NodeCount           int                       `json:"node_count"`
	EffectiveAccessFlags
}

type Project struct {
	CompanyID        string             `json:"company_id"`
	ProjectID        string             `json:"project_id"`
	Name             string             `json:"name"`
	Status           string             `json:"status"`
	Health           string             `json:"health"`
	DefaultAccess    string             `json:"default_access"`
	Accounts         []Account          `json:"accounts,omitempty"`
	Teams            []CompanyUserGroup `json:"teams,omitempty"`
	Fields           []EntityField      `json:"fields,omitempty"`
	EffectiveAccess  string             `json:"effective_access_level,omitempty"`
	CreatedTimestamp time.Time          `json:"created_timestamp"`
	UpdatedTimestamp time.Time          `json:"updated_timestamp"`
}

type ProjectCriticalPathStep struct {
	CompanyID        string    `json:"company_id"`
	ProjectID        string    `json:"project_id"`
	StepID           string    `json:"step_id"`
	Name             string    `json:"name"`
	RelationshipID   *string   `json:"relationship_id,omitempty"`
	ResourceType     string    `json:"resource_type,omitempty"`
	ResourceID       string    `json:"resource_id,omitempty"`
	LogicGateID      *string   `json:"logic_gate_id,omitempty"`
	NodeID           *string   `json:"node_id,omitempty"`
	DisplayTitle     string    `json:"display_title,omitempty"`
	Status           *string   `json:"status,omitempty"`
	DueDate          *string   `json:"due_date,omitempty"`
	OwnerType        string    `json:"owner_type,omitempty"`
	OwnerID          *string   `json:"owner_id,omitempty"`
	OwnerLabel       string    `json:"owner_label,omitempty"`
	Position         int       `json:"position"`
	IsCurrent        bool      `json:"is_current"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type ProjectInformation struct {
	CompanyID        string    `json:"company_id"`
	InformationID    string    `json:"information_id"`
	ProjectID        string    `json:"project_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type ProjectProjection struct {
	CompanyID        string    `json:"company_id"`
	ProjectID        string    `json:"project_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	InformationID    string    `json:"information_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type ProjectRelationship struct {
	CompanyID        string    `json:"company_id"`
	RelationshipID   string    `json:"relationship_id"`
	ProjectID        string    `json:"project_id"`
	ResourceType     string    `json:"resource_type"`
	ResourceID       string    `json:"resource_id"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type ProjectRelationshipProjection struct {
	CompanyID                    string    `json:"company_id"`
	ProjectID                    string    `json:"project_id"`
	ProjectName                  string    `json:"project_name"`
	RelationshipID               string    `json:"relationship_id"`
	ResourceType                 string    `json:"resource_type"`
	ResourceID                   string    `json:"resource_id"`
	LogicGateID                  *string   `json:"logic_gate_id,omitempty"`
	NodeID                       *string   `json:"node_id,omitempty"`
	AssignmentID                 *string   `json:"assignment_id,omitempty"`
	DisplayTitle                 string    `json:"display_title"`
	Status                       *string   `json:"status,omitempty"`
	CreatedFromEmail             bool      `json:"created_from_email,omitempty"`
	Position                     int       `json:"position"`
	ResourceCreatedTimestamp     time.Time `json:"resource_created_timestamp"`
	RelationshipCreatedTimestamp time.Time `json:"relationship_created_timestamp"`
	RelationshipUpdatedTimestamp time.Time `json:"relationship_updated_timestamp"`
	ProjectionUpdatedTimestamp   time.Time `json:"projection_updated_timestamp"`
}

type ProjectView struct {
	CompanyID         string                          `json:"company_id"`
	ProjectID         string                          `json:"project_id"`
	Project           Project                         `json:"project"`
	Information       []ProjectInformation            `json:"information"`
	Projections       []ProjectProjection             `json:"projections"`
	Relationships     []ProjectRelationshipProjection `json:"relationships"`
	CriticalPath      []ProjectCriticalPathStep       `json:"critical_path"`
	InformationCount  int                             `json:"information_count"`
	ProjectionCount   int                             `json:"projection_count"`
	RelationshipCount int                             `json:"relationship_count"`
	CriticalPathCount int                             `json:"critical_path_count"`
	EffectiveAccessFlags
}

// LogicGateWorkHeader is the Kanban-specific Logic Gate metadata needed by the
// Arena. RequestOwnerUserID is derived from the Responsible user assignment; the
// full RACI collection belongs to the Logic Gate details APIs.
type LogicGateWorkHeader struct {
	LogicGateID        string `json:"logic_gate_id"`
	Header             string `json:"header"`
	DefaultAccess      string `json:"default_access"`
	RequestOwnerUserID string `json:"request_owner_user_id,omitempty"`
}

// LogicGateWorkCard is the non-redundant card row returned by the Logic Gate
// Arena. Company, board, and Logic Gate IDs are supplied once instead of being
// repeated on every card.
type LogicGateWorkCard struct {
	CardID                     string    `json:"card_id"`
	ColumnID                   string    `json:"column_id"`
	NodeID                     string    `json:"node_id"`
	NodeTitle                  string    `json:"node_title"`
	RequestedByUserID          string    `json:"requested_by_user_id,omitempty"`
	PlacedByUserID             string    `json:"placed_by_user_id,omitempty"`
	IsIssue                    bool      `json:"is_issue"`
	Position                   int       `json:"position"`
	DueDate                    *string   `json:"due_date,omitempty"`
	Priority                   *int      `json:"priority,omitempty"`
	CreatedFromEmail           bool      `json:"created_from_email,omitempty"`
	HasProject                 bool      `json:"has_project,omitempty"`
	ProjectionUpdatedTimestamp time.Time `json:"projection_updated_timestamp,omitempty"`
	CreatedTimestamp           time.Time `json:"created_timestamp"`
	Accounts                   []Account `json:"accounts,omitempty"`
}

type LogicGateWorkView struct {
	LogicGate   LogicGateWorkHeader  `json:"logic_gate"`
	Permissions EffectiveAccessFlags `json:"permissions"`
	Board       KanbanBoard          `json:"board"`
	Columns     []KanbanColumn       `json:"columns"`
	Cards       []LogicGateWorkCard  `json:"cards"`
}

type CompanyExplorerFolder struct {
	CompanyID                string                      `json:"company_id"`
	FolderID                 string                      `json:"folder_id"`
	SharedInboxID            string                      `json:"shared_inbox_id,omitempty"`
	ParentFolderID           *string                     `json:"parent_folder_id,omitempty"`
	FolderKind               string                      `json:"folder_kind"`
	EntryType                string                      `json:"entry_type,omitempty"`
	SystemKey                *string                     `json:"system_key,omitempty"`
	Name                     string                      `json:"name"`
	DefaultAccess            string                      `json:"default_access,omitempty"`
	AccountEmail             *string                     `json:"account_email,omitempty"`
	CompanyEmailConnectionID string                      `json:"company_email_connection_id,omitempty"`
	ScopeType                string                      `json:"scope_type,omitempty"`
	ScopeID                  *string                     `json:"scope_id,omitempty"`
	Position                 int                         `json:"position"`
	RACIAssignments          []SharedInboxRACIAssignment `json:"gvic_assignments,omitempty"`
	AccessGrants             []EntityPermission          `json:"access_grants,omitempty"`
	EffectiveAccess          string                      `json:"effective_access_level,omitempty"`
	CreatedTimestamp         time.Time                   `json:"created_timestamp"`
	UpdatedTimestamp         time.Time                   `json:"updated_timestamp"`
}

type SharedInboxRACIAssignment struct {
	CompanyID        string    `json:"company_id"`
	FolderID         string    `json:"folder_id"`
	SharedInboxID    string    `json:"shared_inbox_id,omitempty"`
	Role             string    `json:"role"`
	PrincipalType    string    `json:"principal_type,omitempty"`
	PrincipalID      string    `json:"principal_id,omitempty"`
	PrincipalName    string    `json:"principal_name,omitempty"`
	UserID           string    `json:"user_id"`
	UserDisplayName  string    `json:"user_display_name,omitempty"`
	UserEmail        string    `json:"user_email,omitempty"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type CompanyExplorerFolderItem struct {
	CompanyID        string    `json:"company_id"`
	FolderID         string    `json:"folder_id"`
	ItemType         string    `json:"item_type"`
	ItemID           string    `json:"item_id"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type CompanyExplorerFolderShare struct {
	CompanyID        string    `json:"company_id"`
	FolderID         string    `json:"folder_id"`
	Email            string    `json:"email"`
	UserID           *string   `json:"user_id,omitempty"`
	Status           string    `json:"status"`
	InvitedByUserID  string    `json:"invited_by_user_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type RecycleBinContainedItem struct {
	Kind       string `json:"kind"`
	ID         string `json:"id"`
	Label      string `json:"label"`
	FolderKind string `json:"folder_kind,omitempty"`
}

type RecycleBinItem struct {
	CompanyID        string                    `json:"company_id"`
	RecycleBinItemID string                    `json:"recycle_bin_item_id"`
	ObjectKind       string                    `json:"object_kind"`
	ObjectID         string                    `json:"object_id"`
	ObjectLabel      string                    `json:"object_label"`
	ObjectFolderKind string                    `json:"object_folder_kind,omitempty"`
	ContainedItems   []RecycleBinContainedItem `json:"contained_items,omitempty"`
	DeletedByUserID  string                    `json:"deleted_by_user_id,omitempty"`
	DeletedTimestamp time.Time                 `json:"deleted_timestamp"`
}

type KanbanBoard struct {
	CompanyID        string    `json:"company_id"`
	BoardID          string    `json:"board_id"`
	LogicGateID      *string   `json:"logic_gate_id"`
	Title            string    `json:"title"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type KanbanColumn struct {
	CompanyID        string    `json:"company_id"`
	BoardID          string    `json:"board_id"`
	ColumnID         string    `json:"column_id"`
	Title            string    `json:"title"`
	Position         int       `json:"position"`
	WidthPx          int       `json:"width_px"`
	HeightPx         int       `json:"height_px"`
	ItemColor        string    `json:"item_color"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type KanbanCard struct {
	CompanyID                  string    `json:"company_id"`
	BoardID                    string    `json:"board_id"`
	CardID                     string    `json:"card_id"`
	ColumnID                   string    `json:"column_id"`
	NodeID                     string    `json:"node_id"`
	LogicGateID                *string   `json:"logic_gate_id"`
	RequestedByUserID          string    `json:"requested_by_user_id,omitempty"`
	PlacedByUserID             string    `json:"placed_by_user_id,omitempty"`
	NodeTitle                  string    `json:"node_title"`
	DescriptionSnapshot        string    `json:"description_snapshot"`
	IsIssue                    bool      `json:"is_issue"`
	Position                   int       `json:"position"`
	DueDate                    *string   `json:"due_date,omitempty"`
	Priority                   *int      `json:"priority,omitempty"`
	CreatedFromEmail           bool      `json:"created_from_email,omitempty"`
	HasProject                 bool      `json:"has_project,omitempty"`
	ProjectionUpdatedTimestamp time.Time `json:"projection_updated_timestamp,omitempty"`
	CreatedTimestamp           time.Time `json:"created_timestamp"`
	UpdatedTimestamp           time.Time `json:"updated_timestamp"`
	Accounts                   []Account `json:"accounts,omitempty"`
}

type NodeLogicGateAssignment struct {
	AssignmentID         string    `json:"assignment_id"`
	CompanyID            string    `json:"company_id"`
	NodeID               string    `json:"node_id"`
	LogicGateID          string    `json:"logic_gate_id"`
	StatusKey            string    `json:"status_key"`
	ColumnID             string    `json:"column_id"`
	IsIssue              bool      `json:"is_issue"`
	Position             int       `json:"position"`
	CompatibilityBoardID string    `json:"compatibility_board_id"`
	CompatibilityCardID  string    `json:"compatibility_card_id"`
	RequestedByUserID    string    `json:"requested_by_user_id,omitempty"`
	PlacedByUserID       string    `json:"placed_by_user_id,omitempty"`
	Version              int64     `json:"version"`
	CreatedTimestamp     time.Time `json:"created_timestamp"`
	UpdatedTimestamp     time.Time `json:"updated_timestamp"`
}

type NodeAccountAssignment struct {
	CompanyID        string    `json:"company_id"`
	NodeID           string    `json:"node_id"`
	AccountID        string    `json:"account_id"`
	AccountName      string    `json:"account_name,omitempty"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

const (
	NotificationEventLogicGateRACIUpdated      = "logic_gate.gvic_updated"
	NotificationEventNodeAssigned              = "node.assigned"
	NotificationEventNodeVerificationRequested = "node.verification_requested"
	NotificationEventNodeFieldsChanged         = "node.fields_changed"
	NotificationEventNodeCommentCreated        = "node.comment_created"
	NotificationEventMentionCreated            = "mention.created"
	NotificationEventUrgentMentionCreated      = "mention.urgent_created"
	NotificationEventACIInboxChanged           = "aci_inbox.changed"
	NotificationEventACIInboxRACIUpdated       = "aci_inbox.RACI_updated"
)

const (
	NotificationSurfaceRInbox       = "r_inbox"
	NotificationSurfaceACIInbox     = "aci_inbox"
	NotificationSurfaceMyTriage     = "my_triage"
	NotificationSurfaceSharedTriage = "shared_triage"
)

const (
	NotificationRoleOther = "other"
)

type DomainEvent struct {
	EventID          string         `json:"event_id"`
	CompanyID        string         `json:"company_id"`
	StreamType       string         `json:"stream_type"`
	StreamID         string         `json:"stream_id"`
	Sequence         int64          `json:"sequence"`
	Type             string         `json:"type"`
	ActorUserID      *string        `json:"actor_user_id,omitempty"`
	IdempotencyKey   string         `json:"idempotency_key,omitempty"`
	Payload          map[string]any `json:"payload,omitempty"`
	CreatedTimestamp time.Time      `json:"created_timestamp"`
}

type Notification struct {
	NotificationID   string     `json:"notification_id"`
	CompanyID        string     `json:"company_id,omitempty"`
	RecipientUserID  string     `json:"recipient_user_id"`
	ActorUserID      *string    `json:"actor_user_id,omitempty"`
	Type             string     `json:"type"`
	SourceEventID    string     `json:"source_event_id"`
	EntityType       string     `json:"entity_type"`
	EntityID         string     `json:"entity_id"`
	Title            string     `json:"title"`
	BodyPreview      string     `json:"body_preview,omitempty"`
	Surface          string     `json:"surface,omitempty"`
	Role             string     `json:"role,omitempty"`
	LogicGateID      string     `json:"logic_gate_id,omitempty"`
	NodeID           string     `json:"node_id,omitempty"`
	InformationID    string     `json:"information_id,omitempty"`
	Priority         *int       `json:"priority,omitempty"`
	ReadTimestamp    *time.Time `json:"read_timestamp,omitempty"`
	CreatedTimestamp time.Time  `json:"created_timestamp"`
}

type NotificationRoleCount struct {
	Surface string `json:"surface,omitempty"`
	Role    string `json:"role,omitempty"`
	Count   int    `json:"count"`
}

type NotificationTypeCount struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
}

type NotificationLogicGateCount struct {
	LogicGateID string `json:"logic_gate_id"`
	NodeID      string `json:"node_id,omitempty"`
	Role        string `json:"role"`
	Count       int    `json:"count"`
}

type NotificationSummary struct {
	CompanyID        string                       `json:"company_id,omitempty"`
	TotalUnread      int                          `json:"total_unread"`
	RoleCounts       []NotificationRoleCount      `json:"role_counts"`
	TypeCounts       []NotificationTypeCount      `json:"type_counts"`
	LogicGateCounts  []NotificationLogicGateCount `json:"logic_gate_counts"`
	UpdatedTimestamp time.Time                    `json:"updated_timestamp"`
}
