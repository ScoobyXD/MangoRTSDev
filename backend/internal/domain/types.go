package domain

import (
	"strings"
	"time"
)

const (
	RoleDevAdmin     = "dev_admin"
	RoleCompanyAdmin = "company_admin"
	RoleCompanyUser  = "company_user"
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
	case RoleCompanyUser, "member", "agent", "":
		return RoleCompanyUser
	default:
		return ""
	}
}

func CanManageCompany(role string) bool {
	role = NormalizeRole(role)
	return role == RoleDevAdmin || role == RoleCompanyAdmin
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

type Invitation struct {
	InvitationID      string     `json:"invitation_id"`
	CompanyID         string     `json:"company_id"`
	CompanyName       string     `json:"company_name,omitempty"`
	Email             string     `json:"email"`
	Role              string     `json:"role"`
	Status            string     `json:"status"`
	Token             string     `json:"token,omitempty"`
	InvitedByUserID   string     `json:"invited_by_user_id"`
	AcceptedByUserID  *string    `json:"accepted_by_user_id,omitempty"`
	ExpiresTimestamp  time.Time  `json:"expires_timestamp"`
	AcceptedTimestamp *time.Time `json:"accepted_timestamp,omitempty"`
	CreatedTimestamp  time.Time  `json:"created_timestamp"`
	UpdatedTimestamp  time.Time  `json:"updated_timestamp"`
}

type UserEmailConnection struct {
	UserID           string    `json:"user_id"`
	Provider         string    `json:"provider"`
	AccountEmail     string    `json:"account_email"`
	GrantID          string    `json:"-"`
	Status           string    `json:"status"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type EmailAddressSnapshot struct {
	Name  string `json:"name,omitempty"`
	Email string `json:"email"`
}

type EmailMessageSnapshot struct {
	ID        string                 `json:"id"`
	ThreadID  string                 `json:"thread_id,omitempty"`
	Subject   string                 `json:"subject"`
	Snippet   string                 `json:"snippet,omitempty"`
	Body      string                 `json:"body,omitempty"`
	Date      int64                  `json:"date,omitempty"`
	Unread    bool                   `json:"unread"`
	Starred   bool                   `json:"starred"`
	From      []EmailAddressSnapshot `json:"from,omitempty"`
	To        []EmailAddressSnapshot `json:"to,omitempty"`
	Cc        []EmailAddressSnapshot `json:"cc,omitempty"`
	Bcc       []EmailAddressSnapshot `json:"bcc,omitempty"`
	ReplyTo   []EmailAddressSnapshot `json:"reply_to,omitempty"`
	Folders   []string               `json:"folders,omitempty"`
	FolderIDs []string               `json:"folder_ids,omitempty"`
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

type UserLogicGateShortcut struct {
	UserID           string    `json:"user_id"`
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type Node struct {
	CompanyID string `json:"company_id"`
	NodeID    string `json:"node_id"`
	// Title is the canonical public API field name for node text labels.
	Title            string    `json:"title"`
	Status           *string   `json:"status"`
	StatusColor      *string   `json:"status_color"`
	DueDate          *string   `json:"due_date"`
	Priority         *int      `json:"priority"`
	AssigneeUserID   *string   `json:"assignee_user_id"`
	AssigneeName     *string   `json:"assignee_name,omitempty"`
	AssigneeEmail    *string   `json:"assignee_email,omitempty"`
	LogicGateIDs     []string  `json:"logic_gate_ids,omitempty"`
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
	CompanyID        string    `json:"company_id"`
	InformationID    string    `json:"information_id"`
	NodeID           string    `json:"node_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type NodeProjection struct {
	CompanyID        string    `json:"company_id"`
	NodeID           string    `json:"node_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	InformationID    string    `json:"information_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type NodeContentChange struct {
	CompanyID        string    `json:"company_id"`
	ChangeID         string    `json:"change_id"`
	NodeID           string    `json:"node_id"`
	InformationID    string    `json:"information_id"`
	ChangeType       string    `json:"change_type"`
	Text             string    `json:"text"`
	StartOffset      int       `json:"start_offset"`
	EndOffset        int       `json:"end_offset"`
	ActorUserID      string    `json:"actor_user_id,omitempty"`
	ActorDisplayName string    `json:"actor_display_name"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type NodeDetails struct {
	Node               Node               `json:"node"`
	Information        []NodeInformation  `json:"information"`
	Relationships      []NodeRelationship `json:"relationships"`
	InformationCount   int                `json:"information_count"`
	RelationshipsCount int                `json:"relationships_count"`
}

type EffectiveAccessFlags struct {
	CanView  bool `json:"can_view"`
	CanEdit  bool `json:"can_edit"`
	CanAdmin bool `json:"can_admin"`
}

type NodeView struct {
	CompanyID            string                    `json:"company_id"`
	NodeID               string                    `json:"node_id"`
	Node                 Node                      `json:"node"`
	Information          []NodeInformation         `json:"information"`
	Projections          []NodeProjection          `json:"projections"`
	Relationships        []NodeRelationship        `json:"relationships"`
	LogicGateAssignments []NodeLogicGateAssignment `json:"logic_gate_assignments"`
	ContentChanges       []NodeContentChange       `json:"content_changes"`
	InformationCount     int                       `json:"information_count"`
	ProjectionCount      int                       `json:"projection_count"`
	RelationshipsCount   int                       `json:"relationships_count"`
	AssignmentCount      int                       `json:"assignment_count"`
	ContentChangeCount   int                       `json:"content_change_count"`
	EffectiveAccessFlags
}

type LogicGate struct {
	CompanyID        string                    `json:"company_id"`
	LogicGateID      string                    `json:"logic_gate_id"`
	Header           string                    `json:"header"`
	RaciAssignments  []LogicGateRaciAssignment `json:"raci_assignments"`
	EffectiveAccess  string                    `json:"effective_access_level,omitempty"`
	CreatedTimestamp time.Time                 `json:"created_timestamp"`
}

const (
	LogicGateRaciRoleResponsible = "responsible"
	LogicGateRaciRoleAccountable = "accountable"
	LogicGateRaciRoleConsulted   = "consulted"
	LogicGateRaciRoleInformed    = "informed"
)

type LogicGateRaciAssignment struct {
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Role             string    `json:"role"`
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
	CompanyID        string    `json:"company_id"`
	InformationID    string    `json:"information_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type LogicGateProjection struct {
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	InformationID    string    `json:"information_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type LogicGateDetails struct {
	LogicGate     LogicGate               `json:"logic_gate"`
	Information   []LogicGateInformation  `json:"information"`
	Relationships []LogicGateRelationship `json:"relationships"`
}

type LogicGateView struct {
	CompanyID           string                    `json:"company_id"`
	LogicGateID         string                    `json:"logic_gate_id"`
	LogicGate           LogicGate                 `json:"logic_gate"`
	Information         []LogicGateInformation    `json:"information"`
	Projections         []LogicGateProjection     `json:"projections"`
	RaciAssignments     []LogicGateRaciAssignment `json:"raci_assignments"`
	Relationships       []LogicGateRelationship   `json:"relationships"`
	Work                LogicGateWorkView         `json:"work"`
	InformationCount    int                       `json:"information_count"`
	ProjectionCount     int                       `json:"projection_count"`
	RaciAssignmentCount int                       `json:"raci_assignment_count"`
	RelationshipsCount  int                       `json:"relationships_count"`
	AssignmentCount     int                       `json:"assignment_count"`
	NodeCount           int                       `json:"node_count"`
	EffectiveAccessFlags
}

type LogicGateArenaView struct {
	LogicGate  LogicGate      `json:"logic_gate"`
	Board      KanbanBoard    `json:"board"`
	Columns    []KanbanColumn `json:"columns"`
	Cards      []KanbanCard   `json:"cards"`
	CardsLimit int            `json:"cards_limit"`
}

type LogicGateWorkView struct {
	CompanyID   string                    `json:"company_id"`
	LogicGateID string                    `json:"logic_gate_id"`
	LogicGate   LogicGate                 `json:"logic_gate"`
	Statuses    []LogicGateWorkStatus     `json:"statuses"`
	Assignments []LogicGateWorkAssignment `json:"assignments"`
	Nodes       []Node                    `json:"nodes"`
	Board       KanbanBoard               `json:"board"`
	Columns     []KanbanColumn            `json:"columns"`
	Cards       []KanbanCard              `json:"cards"`
	CardsLimit  int                       `json:"cards_limit"`
}

type LogicGateWorkStatus struct {
	StatusKey   string                    `json:"status_key"`
	Title       string                    `json:"title"`
	Position    int                       `json:"position"`
	Assignments []LogicGateWorkAssignment `json:"assignments"`
}

type LogicGateWorkAssignment struct {
	Assignment NodeLogicGateAssignment `json:"assignment"`
	Node       Node                    `json:"node"`
	Card       KanbanCard              `json:"card"`
}

type CompanyExplorerFolder struct {
	CompanyID        string                      `json:"company_id"`
	FolderID         string                      `json:"folder_id"`
	ParentFolderID   *string                     `json:"parent_folder_id,omitempty"`
	FolderKind       string                      `json:"folder_kind"`
	SystemKey        *string                     `json:"system_key,omitempty"`
	Name             string                      `json:"name"`
	AccountEmail     *string                     `json:"account_email,omitempty"`
	Position         int                         `json:"position"`
	RaciAssignments  []SharedInboxRaciAssignment `json:"raci_assignments,omitempty"`
	AccessGrants     []EntityPermission          `json:"access_grants,omitempty"`
	EffectiveAccess  string                      `json:"effective_access_level,omitempty"`
	CreatedTimestamp time.Time                   `json:"created_timestamp"`
	UpdatedTimestamp time.Time                   `json:"updated_timestamp"`
}

type SharedInboxRaciAssignment struct {
	CompanyID        string    `json:"company_id"`
	FolderID         string    `json:"folder_id"`
	Role             string    `json:"role"`
	SubjectType      string    `json:"subject_type,omitempty"`
	SubjectID        string    `json:"subject_id,omitempty"`
	SubjectName      string    `json:"subject_name,omitempty"`
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

type NodeMapPosition struct {
	CompanyID        string    `json:"company_id"`
	NodeID           string    `json:"node_id"`
	X                float64   `json:"x"`
	Y                float64   `json:"y"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type LogicGateMapPosition struct {
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	X                float64   `json:"x"`
	Y                float64   `json:"y"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
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
	CompanyID           string    `json:"company_id"`
	BoardID             string    `json:"board_id"`
	CardID              string    `json:"card_id"`
	ColumnID            string    `json:"column_id"`
	NodeID              string    `json:"node_id"`
	LogicGateID         *string   `json:"logic_gate_id"`
	NodeTitle           string    `json:"node_title"`
	DescriptionSnapshot string    `json:"description_snapshot"`
	IsIssue             bool      `json:"is_issue"`
	Position            int       `json:"position"`
	CreatedTimestamp    time.Time `json:"created_timestamp"`
	UpdatedTimestamp    time.Time `json:"updated_timestamp"`
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
	Version              int64     `json:"version"`
	CreatedTimestamp     time.Time `json:"created_timestamp"`
	UpdatedTimestamp     time.Time `json:"updated_timestamp"`
}

const (
	NotificationEventLogicGateRaciUpdated = "logic_gate.raci_updated"
	NotificationEventNodeAssigned         = "node.assigned"
	NotificationEventNodeFieldsChanged    = "node.fields_changed"
	NotificationEventNodeCommentCreated   = "node.comment_created"
	NotificationEventMentionCreated       = "mention.created"
	NotificationEventACIInboxChanged      = "aci_inbox.changed"
	NotificationEventACIInboxRaciUpdated  = "aci_inbox.raci_updated"
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
	EventID            string         `json:"event_id"`
	CompanyID          string         `json:"company_id"`
	StreamType         string         `json:"stream_type"`
	StreamID           string         `json:"stream_id"`
	Sequence           int64          `json:"sequence"`
	Type               string         `json:"type"`
	ActorUserID        *string        `json:"actor_user_id,omitempty"`
	IdempotencyKey     string         `json:"idempotency_key,omitempty"`
	Payload            map[string]any `json:"payload,omitempty"`
	PublishedTimestamp *time.Time     `json:"published_timestamp,omitempty"`
	CreatedTimestamp   time.Time      `json:"created_timestamp"`
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
