package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	EditorCollaborationEventType                 = "editor.delta.committed"
	EditorCollaborationTombstoneEventType        = "editor.document.deleted"
	EditorCollaborationSnapshotRequiredEventType = "editor.snapshot.required"
	EditorCollaborationOperationMaxBytes         = 64 * 1024
	EditorCollaborationDocumentMaxBytes          = 2 * 1024 * 1024
	editorCollaborationTextBlockPrefix           = "<!-- mango-node-text-block-v1 -->"
)

type EditorDocumentRef struct {
	CompanyID    string `json:"company_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	DocumentID   string `json:"document_id"`
}

// EditorHTMLPatch is a bounded edit to the canonical rich-HTML string. Offsets
// are UTF-8 byte offsets so browsers and Go use the same unambiguous positions.
// It is deliberately not a second rich-text document representation.
type EditorHTMLPatch struct {
	StartUTF8  int    `json:"start_utf8"`
	DeleteUTF8 int    `json:"delete_utf8"`
	Insert     string `json:"insert"`
}

type EditorCollaborationSnapshot struct {
	Document         EditorDocumentRef `json:"document"`
	Revision         int64             `json:"revision"`
	HTML             string            `json:"html"`
	ETag             string            `json:"etag"`
	Deleted          bool              `json:"deleted,omitempty"`
	UpdatedTimestamp time.Time         `json:"updated_timestamp"`
}

type EditorCollaborationOperationInput struct {
	Document     EditorDocumentRef `json:"document"`
	OperationID  string            `json:"operation_id"`
	ClientID     string            `json:"client_id"`
	ActorUserID  string            `json:"actor_user_id"`
	BaseRevision int64             `json:"base_revision"`
	Patch        EditorHTMLPatch   `json:"patch"`
}

type EditorCollaborationRevisionOperation struct {
	Revision    int64           `json:"revision"`
	OperationID string          `json:"operation_id"`
	ClientID    string          `json:"client_id"`
	Patch       EditorHTMLPatch `json:"patch"`
}

type EditorCollaborationCommit struct {
	OperationID          string                                 `json:"operation_id"`
	EventID              string                                 `json:"event_id"`
	Revision             int64                                  `json:"revision"`
	CommittedAt          time.Time                              `json:"committed_at"`
	Deduplicated         bool                                   `json:"deduplicated,omitempty"`
	Patch                EditorHTMLPatch                        `json:"patch"`
	ConcurrentOperations []EditorCollaborationRevisionOperation `json:"concurrent_operations,omitempty"`
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
	Document       EditorDocumentRef                        `json:"document"`
	Title          string                                   `json:"title"`
	Attachments    []EditorCollaborationAttachmentReference `json:"attachments"`
	EmailMessageID string                                   `json:"email_message_id"`
	EmailAccent    string                                   `json:"email_accent"`
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
	input.EmailMessageID = strings.TrimSpace(input.EmailMessageID)
	input.EmailAccent = strings.TrimSpace(input.EmailAccent)
	if len(input.Title) > 500 || len(input.Attachments) > 100 || len(input.EmailMessageID) > 500 || (input.EmailAccent != "" && !validEditorEmailAccent(input.EmailAccent)) {
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
	if err != nil || len(encoded) > EditorCollaborationOperationMaxBytes || editorBytesContainSensitiveContent(encoded) {
		return EditorCollaborationMetadataInput{}, ErrInvalid
	}
	return input, nil
}

func validEditorEmailAccent(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func editorProjectionInformationWithMetadata(input EditorCollaborationMetadataInput, document string) (string, error) {
	encoded, err := json.Marshal(map[string]any{"title": input.Title, "document": document, "attachments": input.Attachments, "email_message_id": input.EmailMessageID, "email_accent": input.EmailAccent})
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
	if err := ValidateEditorHTMLPatch(input.Patch, false); err != nil {
		return EditorCollaborationOperationInput{}, nil, err
	}
	payload, err := json.Marshal(input.Patch)
	if err != nil || len(payload) > EditorCollaborationOperationMaxBytes || editorBytesContainSensitiveContent(payload) {
		return EditorCollaborationOperationInput{}, nil, ErrInvalid
	}
	return input, payload, nil
}

func ValidateEditorHTMLPatch(patch EditorHTMLPatch, allowEmpty bool) error {
	if patch.StartUTF8 < 0 || patch.DeleteUTF8 < 0 || (!allowEmpty && patch.DeleteUTF8 == 0 && patch.Insert == "") || !utf8.ValidString(patch.Insert) {
		return ErrInvalid
	}
	return nil
}

func editorBytesContainSensitiveContent(value []byte) bool {
	lower := strings.ToLower(string(value))
	for _, forbidden := range []string{"data:image/", ";base64,", "x-amz-credential", "x-amz-signature", "awsaccesskeyid", "presigned_url", "secret_access_key"} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}

func ApplyEditorHTMLPatch(html string, patch EditorHTMLPatch) (string, error) {
	if err := ValidateEditorHTMLPatch(patch, true); err != nil {
		return "", err
	}
	value := []byte(html)
	end := patch.StartUTF8 + patch.DeleteUTF8
	if patch.StartUTF8 > len(value) || end < patch.StartUTF8 || end > len(value) {
		return "", ErrVersionConflict
	}
	if !utf8.Valid(value[:patch.StartUTF8]) || !utf8.Valid(value[:end]) {
		return "", ErrVersionConflict
	}
	next := make([]byte, 0, len(value)-patch.DeleteUTF8+len([]byte(patch.Insert)))
	next = append(next, value[:patch.StartUTF8]...)
	next = append(next, patch.Insert...)
	next = append(next, value[end:]...)
	if !utf8.Valid(next) {
		return "", ErrInvalid
	}
	return string(next), nil
}

// TransformEditorHTMLPatch moves an incoming HTML-text patch across an already
// accepted patch. Disjoint edits retain both users' work. Exact overlapping
// edits use server order; the product explicitly accepts that narrow edge risk.
func TransformEditorHTMLPatch(committed, incoming EditorHTMLPatch, incomingAfter bool) EditorHTMLPatch {
	aStart := committed.StartUTF8
	aEnd := committed.StartUTF8 + committed.DeleteUTF8
	aInsert := len([]byte(committed.Insert))
	bStart := incoming.StartUTF8
	bEnd := incoming.StartUTF8 + incoming.DeleteUTF8
	delta := aInsert - committed.DeleteUTF8
	if incoming.DeleteUTF8 == 0 {
		switch {
		case bStart < aStart:
			return incoming
		case bStart > aEnd:
			incoming.StartUTF8 += delta
		case bStart == aStart && committed.DeleteUTF8 == 0:
			if incomingAfter {
				incoming.StartUTF8 += aInsert
			}
		case bStart >= aEnd:
			incoming.StartUTF8 += delta
		default:
			incoming.StartUTF8 = aStart
			if incomingAfter {
				incoming.StartUTF8 += aInsert
			}
		}
		return incoming
	}
	if bEnd <= aStart {
		return incoming
	}
	if bStart >= aEnd {
		incoming.StartUTF8 += delta
		return incoming
	}
	newStart := bStart
	if bStart >= aStart {
		newStart = aStart + aInsert
	}
	newEnd := bEnd
	if bEnd >= aEnd {
		newEnd = bEnd + delta
	} else if bEnd > aStart {
		newEnd = aStart
	}
	if newEnd < newStart {
		newEnd = newStart
	}
	incoming.StartUTF8 = newStart
	incoming.DeleteUTF8 = newEnd - newStart
	return incoming
}

func EditorRealtimeScope(ref EditorDocumentRef) string {
	ref, err := NormalizeEditorDocumentRef(ref)
	if err != nil {
		return ""
	}
	return "editor:" + ref.ResourceType + ":" + ref.ResourceID + ":" + ref.DocumentID
}

func EditorCollaborationSnapshotETag(revision int64, html string) string {
	digest := sha256.Sum256([]byte(html))
	return fmt.Sprintf("\"editor-%d-%s\"", revision, hex.EncodeToString(digest[:8]))
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
