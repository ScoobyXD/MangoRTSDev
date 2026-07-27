package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"time"
)

const (
	NodeV2DefaultPageLimit = 30
	NodeV2MaxPageLimit     = 100
	NodeV2MaxSyncPageLimit = 512
	NodeV2MaxUpdateBytes   = 8 * 1024 * 1024
)

type NodeV2Repository interface {
	GetNodeV2Availability(companyID, nodeID string) (NodeV2Availability, error)
	GetNodeV2Workspace(query NodeV2WorkspaceQuery) (NodeV2WorkspaceResult, error)
	ListNodeV2TextBoxes(query NodeV2TextBoxPageQuery) (NodeV2TextBoxPage, error)
	ListNodeV2Timeline(query NodeV2TimelineQuery) (NodeV2TimelinePage, error)
	CreateNodeV2TextBox(input NodeV2CreateTextBoxInput) (NodeV2TextBoxMutationResult, error)
	GetNodeV2TextBox(companyID, nodeID, textboxID string) (domain.NodeV2TextBox, error)
	SetNodeV2TextBoxArchived(input NodeV2ArchiveTextBoxInput) (domain.NodeV2TextBox, error)
	MoveNodeV2TextBox(input NodeV2TextBoxMoveInput) (domain.NodeV2TextBoxSummary, error)
	GetNodeV2TextBoxSync(query NodeV2SyncQuery) (NodeV2SyncPage, error)
	AppendNodeV2YjsUpdate(input NodeV2YjsUpdateInput) (domain.NodeV2YjsUpdate, error)
	CheckpointNodeV2TextBox(input NodeV2CheckpointInput) (domain.NodeV2TextBox, error)
	ListNodeV2Comments(query NodeV2CommentQuery) (NodeV2CommentPage, error)
	CreateNodeV2CommentThread(input NodeV2CreateCommentThreadInput) (domain.NodeV2CommentThread, error)
	ReplyNodeV2Comment(input NodeV2ReplyCommentInput) (domain.NodeV2Comment, error)
	ListNodeV2Attachments(query NodeV2AggregateQuery) (NodeV2AttachmentPage, error)
	SetNodeV2AttachmentLink(input NodeV2AttachmentLinkInput) (domain.NodeV2AttachmentLink, error)
	ListNodeV2EmailThreads(query NodeV2AggregateQuery) (NodeV2EmailPage, error)
	SetNodeV2EmailLink(input NodeV2EmailLinkInput) error
	ListNodeV2EmailMessages(query NodeV2EmailMessageQuery) (NodeV2EmailMessagePage, error)
}

type NodeV2Cursor struct {
	Version   int       `json:"v"`
	Kind      string    `json:"kind"`
	Timestamp time.Time `json:"timestamp"`
	ID        string    `json:"id"`
	Sequence  int64     `json:"sequence,omitempty"`
	Order     int64     `json:"order,omitempty"`
}

type NodeV2Availability struct {
	Active bool   `json:"active"`
	Reason string `json:"reason,omitempty"`
}

type NodeV2WorkspaceQuery struct {
	CompanyID      string
	NodeID         string
	TimelineLimit  int
	TimelineCursor *NodeV2Cursor
	AggregateLimit int
}

type NodeV2WorkspaceResult struct {
	Node                 domain.Node                       `json:"node"`
	Placement            domain.NodeV2PlacementSummary     `json:"placement"`
	GVICSummary          []domain.ResourceGVICAssignment   `json:"gvic_summary"`
	Counts               domain.NodeV2WorkspaceCounts      `json:"counts"`
	Timeline             NodeV2TimelinePage                `json:"timeline"`
	Textboxes            []domain.NodeV2TextBoxSummary     `json:"textboxes"`
	TextboxNextCursor    *NodeV2Cursor                     `json:"textbox_next_cursor,omitempty"`
	ArchivedTextboxes    []domain.NodeV2TextBoxSummary     `json:"archived_textboxes"`
	ArchivedNextCursor   *NodeV2Cursor                     `json:"archived_next_cursor,omitempty"`
	EmailThreadSummaries []domain.NodeV2EmailThreadSummary `json:"email_thread_summaries"`
	EmailNextCursor      *NodeV2Cursor                     `json:"email_next_cursor,omitempty"`
	AttachmentSummaries  []domain.NodeV2AttachmentLink     `json:"attachment_summaries"`
	AttachmentNextCursor *NodeV2Cursor                     `json:"attachment_next_cursor,omitempty"`
}

type NodeV2TextBoxPageQuery struct {
	CompanyID string
	NodeID    string
	Archived  bool
	Limit     int
	Cursor    *NodeV2Cursor
}

type NodeV2TextBoxPage struct {
	Items      []domain.NodeV2TextBoxSummary `json:"items"`
	NextCursor *NodeV2Cursor                 `json:"next_cursor,omitempty"`
}

type NodeV2TimelineQuery struct {
	CompanyID string
	NodeID    string
	Limit     int
	Cursor    *NodeV2Cursor
}

type NodeV2TimelinePage struct {
	Items      []domain.NodeV2TimelineItem `json:"items"`
	NextCursor *NodeV2Cursor               `json:"next_cursor,omitempty"`
}

type NodeV2CreateTextBoxInput struct {
	CompanyID      string
	NodeID         string
	ActorUserID    string
	IdempotencyKey string
}

type NodeV2TextBoxMutationResult struct {
	Textbox      domain.NodeV2TextBox      `json:"textbox"`
	TimelineItem domain.NodeV2TimelineItem `json:"timeline_item"`
	Events       []domain.DomainEvent      `json:"-"`
}

type NodeV2ArchiveTextBoxInput struct {
	CompanyID      string
	NodeID         string
	TextboxID      string
	ActorUserID    string
	Archived       bool
	IdempotencyKey string
}

type NodeV2TextBoxMoveInput struct {
	CompanyID      string
	NodeID         string
	ActorUserID    string
	TextboxID      string
	ReferenceID    string
	Placement      string
	IdempotencyKey string
}

type NodeV2SyncQuery struct {
	CompanyID         string
	NodeID            string
	TextboxID         string
	AfterSequence     int64
	Limit             int
	IncludeCheckpoint bool
}

type NodeV2SyncPage struct {
	Textbox      domain.NodeV2TextBox        `json:"textbox"`
	Checkpoint   *domain.NodeV2YjsCheckpoint `json:"checkpoint,omitempty"`
	Updates      []domain.NodeV2YjsUpdate    `json:"updates"`
	NextSequence int64                       `json:"next_sequence,omitempty"`
	HasMore      bool                        `json:"has_more"`
}

type NodeV2YjsUpdateInput struct {
	CompanyID          string
	NodeID             string
	TextboxID          string
	ActorUserID        string
	CollaborationEpoch string
	UpdateID           string
	UpdateSHA256       string
	ClientID           string
	Payload            []byte
}

type NodeV2CheckpointInput struct {
	CompanyID          string
	NodeID             string
	TextboxID          string
	ActorUserID        string
	CheckpointID       string
	CollaborationEpoch string
	ThroughSequence    int64
	CheckpointPayload  []byte
	StateVector        []byte
	DocumentJSON       json.RawMessage
	PlainText          string
	Reason             string
	Trusted            bool
}

type NodeV2CommentQuery struct {
	CompanyID string
	NodeID    string
	TextboxID string
	Limit     int
	Cursor    *NodeV2Cursor
}

type NodeV2CommentPage struct {
	Threads    []domain.NodeV2CommentThread `json:"threads"`
	NextCursor *NodeV2Cursor                `json:"next_cursor,omitempty"`
}

type NodeV2MentionInput struct {
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
}

type NodeV2CreateCommentThreadInput struct {
	CompanyID        string
	NodeID           string
	TextboxID        string
	ActorUserID      string
	IdempotencyKey   string
	BodyText         string
	SelectedQuote    string
	AnchorBeforeText string
	AnchorAfterText  string
	AnchorStatus     string
	AnchorStart      []byte
	AnchorEnd        []byte
	Mentions         []NodeV2MentionInput
}

type NodeV2ReplyCommentInput struct {
	CompanyID       string
	NodeID          string
	TextboxID       string
	ThreadID        string
	ActorUserID     string
	IdempotencyKey  string
	ParentCommentID string
	BodyText        string
	Mentions        []NodeV2MentionInput
}

type NodeV2AggregateQuery struct {
	CompanyID string
	NodeID    string
	Limit     int
	Cursor    *NodeV2Cursor
}

type NodeV2AttachmentPage struct {
	Items      []domain.NodeV2AttachmentLink `json:"items"`
	NextCursor *NodeV2Cursor                 `json:"next_cursor,omitempty"`
}

type NodeV2AttachmentLinkInput struct {
	CompanyID        string
	NodeID           string
	TextboxID        string
	AttachmentID     string
	RelationshipKind string
	ActorUserID      string
	Deleted          bool
	IdempotencyKey   string
}

type NodeV2EmailPage struct {
	Items      []domain.NodeV2EmailThreadSummary `json:"items"`
	NextCursor *NodeV2Cursor                     `json:"next_cursor,omitempty"`
}

type NodeV2EmailLinkInput struct {
	CompanyID      string
	NodeID         string
	TextboxID      string
	EmailThreadID  string
	EmailMessageID string
	ActorUserID    string
	Deleted        bool
	IdempotencyKey string
}

type NodeV2EmailMessageQuery struct {
	CompanyID     string
	NodeID        string
	EmailThreadID string
	Limit         int
	Cursor        *NodeV2Cursor
	IncludeBody   bool
}

type NodeV2EmailMessagePage struct {
	Items      []domain.NodeV2EmailMessageSummary `json:"items"`
	NextCursor *NodeV2Cursor                      `json:"next_cursor,omitempty"`
}
