package domain

import (
	"encoding/json"
	"time"
)

const (
	NodeV2TimelineTextboxCreated    = "textbox_created"
	NodeV2TimelineNodeMoved         = "node_moved"
	NodeV2TimelineVerificationStamp = "verification_stamp"
)

type NodeV2TextBox struct {
	CompanyID                   string          `json:"company_id"`
	NodeID                      string          `json:"node_id"`
	TextboxID                   string          `json:"textbox_id"`
	DocumentJSON                json.RawMessage `json:"document_json"`
	PlainText                   string          `json:"plain_text"`
	DocumentSchemaVersion       int             `json:"document_schema_version"`
	ContentRevision             int64           `json:"content_revision"`
	CollaborationEpoch          string          `json:"collaboration_epoch"`
	LatestUpdateSequence        int64           `json:"latest_update_sequence"`
	MaterializedThroughSequence int64           `json:"materialized_through_sequence"`
	DisplayOrder                int64           `json:"display_order"`
	CreatedByUserID             string          `json:"created_by_user_id,omitempty"`
	UpdatedByUserID             string          `json:"updated_by_user_id,omitempty"`
	CreatedTimestamp            time.Time       `json:"created_timestamp"`
	UpdatedTimestamp            time.Time       `json:"updated_timestamp"`
	DeletedTimestamp            *time.Time      `json:"deleted_timestamp,omitempty"`
	CommentCount                int             `json:"comment_count"`
	AttachmentCount             int             `json:"attachment_count"`
	EmailLinkCount              int             `json:"email_link_count"`
}

type NodeV2TimelineItem struct {
	TimelineItemID      string          `json:"timeline_item_id"`
	CompanyID           string          `json:"company_id"`
	NodeID              string          `json:"node_id"`
	TimelineSequence    int64           `json:"timeline_sequence"`
	ItemType            string          `json:"item_type"`
	OccurredAt          time.Time       `json:"occurred_at"`
	RecordedAt          time.Time       `json:"recorded_at"`
	ActorUserID         string          `json:"actor_user_id,omitempty"`
	TextboxID           string          `json:"textbox_id,omitempty"`
	MovementID          string          `json:"movement_id,omitempty"`
	VerificationEventID string          `json:"verification_event_id,omitempty"`
	SummaryJSON         json.RawMessage `json:"summary_json"`
}

type NodeV2YjsUpdate struct {
	UpdateSequence     int64     `json:"update_sequence"`
	UpdateID           string    `json:"update_id"`
	UpdateSHA256       string    `json:"update_sha256"`
	CollaborationEpoch string    `json:"collaboration_epoch"`
	ClientID           string    `json:"client_id"`
	PayloadBase64      string    `json:"payload_base64"`
	ReceivedTimestamp  time.Time `json:"received_timestamp"`
}

type NodeV2YjsCheckpoint struct {
	CheckpointID       string    `json:"checkpoint_id"`
	CollaborationEpoch string    `json:"collaboration_epoch"`
	ThroughSequence    int64     `json:"through_update_sequence"`
	PayloadBase64      string    `json:"payload_base64"`
	StateVectorBase64  string    `json:"state_vector_base64"`
	CreatedTimestamp   time.Time `json:"created_timestamp"`
}

type NodeV2CommentMention struct {
	PrincipalType        string `json:"principal_type"`
	PrincipalID          string `json:"principal_id"`
	PrincipalDisplayName string `json:"principal_display_name"`
}

type NodeV2Comment struct {
	CommentID         string                 `json:"comment_id"`
	ThreadID          string                 `json:"thread_id"`
	ParentCommentID   string                 `json:"parent_comment_id,omitempty"`
	AuthorUserID      string                 `json:"author_user_id,omitempty"`
	AuthorDisplayName string                 `json:"author_display_name"`
	BodyText          string                 `json:"body_text"`
	Mentions          []NodeV2CommentMention `json:"mentions"`
	CreatedTimestamp  time.Time              `json:"created_timestamp"`
	EditedTimestamp   *time.Time             `json:"edited_timestamp,omitempty"`
	DeletedTimestamp  *time.Time             `json:"deleted_timestamp,omitempty"`
}

type NodeV2CommentThread struct {
	ThreadID             string          `json:"thread_id"`
	TextboxID            string          `json:"textbox_id"`
	SelectedQuote        string          `json:"selected_quote"`
	AnchorBeforeText     string          `json:"anchor_before_text"`
	AnchorAfterText      string          `json:"anchor_after_text"`
	AnchorFormat         string          `json:"anchor_format"`
	AnchorStatus         string          `json:"anchor_status"`
	AnchorStartBase64    string          `json:"anchor_start_base64,omitempty"`
	AnchorEndBase64      string          `json:"anchor_end_base64,omitempty"`
	CreatedByUserID      string          `json:"created_by_user_id,omitempty"`
	CreatedByDisplayName string          `json:"created_by_display_name"`
	CreatedTimestamp     time.Time       `json:"created_timestamp"`
	ResolvedTimestamp    *time.Time      `json:"resolved_timestamp,omitempty"`
	Comments             []NodeV2Comment `json:"comments"`
}

type NodeV2AttachmentLink struct {
	AttachmentLinkID string     `json:"attachment_link_id"`
	TextboxID        string     `json:"textbox_id"`
	RelationshipKind string     `json:"relationship_kind"`
	CreatedTimestamp time.Time  `json:"created_timestamp"`
	DeletedTimestamp *time.Time `json:"deleted_timestamp,omitempty"`
	Attachment       Attachment `json:"attachment"`
}

type NodeV2EmailThreadSummary struct {
	EmailThreadID         string    `json:"email_thread_id"`
	AccountEmail          string    `json:"account_email"`
	Subject               string    `json:"subject"`
	Snippet               string    `json:"snippet"`
	LatestMessageAt       int64     `json:"latest_message_at"`
	MessageCount          int       `json:"message_count"`
	HydrationStatus       string    `json:"hydration_status"`
	HistoryComplete       bool      `json:"history_complete"`
	LinkedTextboxIDs      []string  `json:"linked_textbox_ids"`
	LinkedMessageIDs      []string  `json:"linked_message_ids"`
	NodeAttachedTimestamp time.Time `json:"node_attached_timestamp"`
}

type NodeV2EmailMessageSummary struct {
	EmailMessageID    string                    `json:"email_message_id"`
	EmailThreadID     string                    `json:"email_thread_id"`
	ProviderMessageID string                    `json:"provider_message_id"`
	MessageOrder      int                       `json:"message_order"`
	Subject           string                    `json:"subject"`
	Snippet           string                    `json:"snippet"`
	Date              int64                     `json:"date"`
	From              []EmailAddressSnapshot    `json:"from"`
	To                []EmailAddressSnapshot    `json:"to"`
	Cc                []EmailAddressSnapshot    `json:"cc"`
	Bcc               []EmailAddressSnapshot    `json:"bcc"`
	BodyHTML          string                    `json:"body_html,omitempty"`
	Attachments       []EmailAttachmentSnapshot `json:"attachments,omitempty"`
}

type NodeV2WorkspaceCounts struct {
	Textboxes         int `json:"textboxes"`
	ArchivedTextboxes int `json:"archived_textboxes"`
	Comments          int `json:"comments"`
	EmailThreads      int `json:"email_threads"`
	Attachments       int `json:"attachments"`
}
