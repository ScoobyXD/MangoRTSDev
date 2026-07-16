package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	EditorCollaborationEventType                 = "editor.delta.committed"
	EditorCollaborationTombstoneEventType        = "editor.document.deleted"
	EditorCollaborationSnapshotRequiredEventType = "editor.snapshot.required"
	EditorCollaborationOperationMaxBytes         = 64 * 1024
	EditorCollaborationOperationMaxOpCount       = 10000
	EditorCollaborationDocumentMaxBytes          = 2 * 1024 * 1024
	EditorCollaborationCompactOperationCount     = 128
	EditorCollaborationCompactDeltaBytes         = 512 * 1024
	editorCollaborationTextBlockPrefix           = "<!-- mango-node-text-block-v1 -->"
	editorCollaborationRichTextPrefix            = "<!-- mango-editor-html-v1 -->"
)

type EditorDocumentRef struct {
	CompanyID    string `json:"company_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	DocumentID   string `json:"document_id"`
}

type EditorCollaborationOp struct {
	Insert     any            `json:"insert,omitempty"`
	Retain     int            `json:"retain,omitempty"`
	Delete     int            `json:"delete,omitempty"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

type EditorCollaborationState struct {
	Ops []EditorCollaborationOp `json:"ops"`
}

type EditorCollaborationDelta struct {
	Ops []EditorCollaborationOp `json:"ops"`
}

type EditorCollaborationSnapshot struct {
	Document         EditorDocumentRef        `json:"document"`
	Revision         int64                    `json:"revision"`
	SnapshotRevision int64                    `json:"snapshot_revision"`
	State            EditorCollaborationState `json:"state"`
	HTML             string                   `json:"html"`
	ETag             string                   `json:"etag"`
	Deleted          bool                     `json:"deleted,omitempty"`
	ReplayCount      int                      `json:"replay_count"`
	UpdatedTimestamp time.Time                `json:"updated_timestamp"`
}

type EditorCollaborationOperationInput struct {
	Document     EditorDocumentRef        `json:"document"`
	OperationID  string                   `json:"operation_id"`
	ClientID     string                   `json:"client_id"`
	ActorUserID  string                   `json:"actor_user_id"`
	BaseRevision int64                    `json:"base_revision"`
	Delta        EditorCollaborationDelta `json:"delta"`
}

type EditorCollaborationRevisionOperation struct {
	Revision int64                    `json:"revision"`
	Delta    EditorCollaborationDelta `json:"delta"`
}

type EditorCollaborationCommit struct {
	OperationID          string                                 `json:"operation_id"`
	EventID              string                                 `json:"event_id"`
	Revision             int64                                  `json:"revision"`
	CommittedAt          time.Time                              `json:"committed_at"`
	Deduplicated         bool                                   `json:"deduplicated,omitempty"`
	Delta                EditorCollaborationDelta               `json:"delta"`
	ConcurrentOperations []EditorCollaborationRevisionOperation `json:"concurrent_operations,omitempty"`
	Snapshot             EditorCollaborationSnapshot            `json:"snapshot"`
}

type EditorCollaborationDeleteInput struct {
	Document    EditorDocumentRef
	OperationID string
	ClientID    string
	ActorUserID string
}

type EditorCollaborationAttachmentReference struct {
	ID           string `json:"id"`
	AttachmentID string `json:"attachment_id"`
	Name         string `json:"name"`
	Filename     string `json:"filename"`
	Type         string `json:"type"`
	MIMEType     string `json:"mime_type"`
	Size         int64  `json:"size"`
	ByteSize     int64  `json:"byte_size"`
}

type EditorCollaborationMetadataInput struct {
	Document    EditorDocumentRef                        `json:"document"`
	Title       string                                   `json:"title"`
	Attachments []EditorCollaborationAttachmentReference `json:"attachments"`
}

type EditorCollaborationMetadataCommit struct {
	ProjectionRevision int64     `json:"projection_revision"`
	UpdatedTimestamp   time.Time `json:"updated_timestamp"`
}

func NormalizeEditorCollaborationMetadata(input EditorCollaborationMetadataInput) (EditorCollaborationMetadataInput, error) {
	ref, err := NormalizeEditorDocumentRef(input.Document)
	if err != nil {
		return EditorCollaborationMetadataInput{}, err
	}
	input.Document = ref
	input.Title = strings.TrimSpace(input.Title)
	if len(input.Title) > 500 || len(input.Attachments) > 100 {
		return EditorCollaborationMetadataInput{}, ErrInvalid
	}
	for index := range input.Attachments {
		item := &input.Attachments[index]
		item.ID = strings.TrimSpace(item.ID)
		item.AttachmentID = strings.TrimSpace(item.AttachmentID)
		item.Name = strings.TrimSpace(item.Name)
		item.Filename = strings.TrimSpace(item.Filename)
		item.Type = strings.TrimSpace(item.Type)
		item.MIMEType = strings.TrimSpace(item.MIMEType)
		if item.AttachmentID == "" {
			item.AttachmentID = item.ID
		}
		if item.ID == "" {
			item.ID = item.AttachmentID
		}
		if item.Filename == "" {
			item.Filename = item.Name
		}
		if item.Name == "" {
			item.Name = item.Filename
		}
		if item.MIMEType == "" {
			item.MIMEType = item.Type
		}
		if item.Type == "" {
			item.Type = item.MIMEType
		}
		if item.ByteSize == 0 {
			item.ByteSize = item.Size
		}
		if item.Size == 0 {
			item.Size = item.ByteSize
		}
		if item.ID == "" || item.AttachmentID == "" || item.Name == "" || len(item.ID) > 160 || len(item.AttachmentID) > 160 || len(item.Name) > 500 || len(item.Type) > 200 || item.Size < 0 || item.ByteSize < 0 || item.Size != item.ByteSize {
			return EditorCollaborationMetadataInput{}, ErrInvalid
		}
	}
	encoded, err := json.Marshal(input.Attachments)
	if err != nil || len(encoded) > EditorCollaborationOperationMaxBytes {
		return EditorCollaborationMetadataInput{}, ErrInvalid
	}
	lower := strings.ToLower(string(encoded))
	for _, forbidden := range []string{"data:image/", ";base64,", "x-amz-credential", "x-amz-signature", "presigned_url", "secret_access_key"} {
		if strings.Contains(lower, forbidden) {
			return EditorCollaborationMetadataInput{}, ErrInvalid
		}
	}
	return input, nil
}

func editorProjectionInformationWithMetadata(input EditorCollaborationMetadataInput, document string) (string, error) {
	encoded, err := json.Marshal(map[string]any{
		"title": input.Title, "document": document, "attachments": input.Attachments,
	})
	if err != nil {
		return "", err
	}
	return editorCollaborationTextBlockPrefix + string(encoded), nil
}
func NormalizeEditorDocumentRef(ref EditorDocumentRef) (EditorDocumentRef, error) {
	ref.CompanyID = strings.TrimSpace(ref.CompanyID)
	ref.ResourceType = strings.TrimSpace(ref.ResourceType)
	ref.ResourceID = strings.TrimSpace(ref.ResourceID)
	ref.DocumentID = strings.TrimSpace(ref.DocumentID)
	if ref.CompanyID == "" || ref.ResourceID == "" || ref.DocumentID == "" {
		return EditorDocumentRef{}, ErrInvalid
	}
	switch ref.ResourceType {
	case EntityTypeNode, EntityTypeLogicGate, EntityTypeProject:
	default:
		return EditorDocumentRef{}, ErrInvalid
	}
	return ref, nil
}

func NormalizeEditorCollaborationOperation(input EditorCollaborationOperationInput) (EditorCollaborationOperationInput, []byte, error) {
	ref, err := NormalizeEditorDocumentRef(input.Document)
	if err != nil {
		return EditorCollaborationOperationInput{}, nil, err
	}
	input.Document = ref
	input.OperationID = strings.TrimSpace(input.OperationID)
	input.ClientID = strings.TrimSpace(input.ClientID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.OperationID == "" || len(input.OperationID) > 160 || input.ClientID == "" || len(input.ClientID) > 160 || input.BaseRevision < 0 {
		return EditorCollaborationOperationInput{}, nil, ErrInvalid
	}
	if err := ValidateEditorCollaborationDelta(input.Delta); err != nil {
		return EditorCollaborationOperationInput{}, nil, err
	}
	payload, err := json.Marshal(input.Delta)
	if err != nil || len(payload) > EditorCollaborationOperationMaxBytes || editorBytesContainSensitiveContent(payload) {
		return EditorCollaborationOperationInput{}, nil, ErrInvalid
	}
	return input, payload, nil
}

func EditorRealtimeScope(ref EditorDocumentRef) string {
	ref, err := NormalizeEditorDocumentRef(ref)
	if err != nil {
		return ""
	}
	return "editor:" + ref.ResourceType + ":" + ref.ResourceID + ":" + ref.DocumentID
}

func NewEditorCollaborationState(html string) EditorCollaborationState {
	state, err := EditorCollaborationStateFromHTML(html)
	if err != nil {
		return EditorCollaborationState{Ops: []EditorCollaborationOp{}}
	}
	return state
}

func CloneEditorCollaborationState(state EditorCollaborationState) EditorCollaborationState {
	next := EditorCollaborationState{Ops: make([]EditorCollaborationOp, len(state.Ops))}
	for index, operation := range state.Ops {
		next.Ops[index] = cloneEditorOp(operation)
	}
	return next
}

func ApplyEditorCollaborationDelta(state EditorCollaborationState, delta EditorCollaborationDelta) (EditorCollaborationState, error) {
	return ApplyStructuredEditorOperation(state, delta)
}

func MaterializeEditorCollaborationState(state EditorCollaborationState) (string, error) {
	html, err := MaterializeStructuredEditorState(state)
	if err != nil {
		return "", err
	}
	if html == "" {
		return "", nil
	}
	return editorCollaborationRichTextPrefix + html, nil
}

func EditorCollaborationSnapshotETag(revision int64, state EditorCollaborationState) string {
	payload, _ := json.Marshal(state)
	digest := sha256.Sum256(payload)
	return fmt.Sprintf("\"editor-%d-%s\"", revision, hex.EncodeToString(digest[:8]))
}

func editorDeltaContainsSensitiveContent(delta EditorCollaborationDelta) bool {
	encoded, _ := json.Marshal(delta)
	return editorBytesContainSensitiveContent(encoded)
}

func editorDocumentHTMLFromProjectionInformation(information string) string {
	if !strings.HasPrefix(information, editorCollaborationTextBlockPrefix) {
		return information
	}
	var payload map[string]any
	if json.Unmarshal([]byte(strings.TrimPrefix(information, editorCollaborationTextBlockPrefix)), &payload) != nil {
		return ""
	}
	document, _ := payload["document"].(string)
	return document
}

func editorProjectionInformationWithDocument(information, document string) string {
	if !strings.HasPrefix(information, editorCollaborationTextBlockPrefix) {
		return document
	}
	var payload map[string]any
	if json.Unmarshal([]byte(strings.TrimPrefix(information, editorCollaborationTextBlockPrefix)), &payload) != nil {
		return document
	}
	payload["document"] = document
	encoded, err := json.Marshal(payload)
	if err != nil {
		return document
	}
	return editorCollaborationTextBlockPrefix + string(encoded)
}
