package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	EditorCollaborationEventType                 = "editor.delta.committed"
	EditorCollaborationTombstoneEventType        = "editor.document.deleted"
	EditorCollaborationSnapshotRequiredEventType = "editor.snapshot.required"
	EditorCollaborationOperationMaxBytes         = 64 * 1024
	EditorCollaborationOperationMaxAtomCount     = 10000
	EditorCollaborationCompactOperationCount     = 128
	EditorCollaborationCompactDeltaBytes         = 512 * 1024
	editorCollaborationTextBlockPrefix           = "<!-- mango-node-text-block-v1 -->"
)

type EditorDocumentRef struct {
	CompanyID    string `json:"company_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	DocumentID   string `json:"document_id"`
}

type EditorCollaborationAtom struct {
	ID      string `json:"id"`
	AfterID string `json:"after_id,omitempty"`
	Value   string `json:"value"`
	Deleted bool   `json:"deleted,omitempty"`
}

type EditorCollaborationState struct {
	Atoms []EditorCollaborationAtom `json:"atoms"`
}

type EditorCollaborationDelta struct {
	Inserts   []EditorCollaborationAtom `json:"inserts,omitempty"`
	DeleteIDs []string                  `json:"delete_ids,omitempty"`
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

type EditorCollaborationCommit struct {
	OperationID  string                      `json:"operation_id"`
	EventID      string                      `json:"event_id"`
	Revision     int64                       `json:"revision"`
	CommittedAt  time.Time                   `json:"committed_at"`
	Deduplicated bool                        `json:"deduplicated,omitempty"`
	Snapshot     EditorCollaborationSnapshot `json:"snapshot"`
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
	if len(input.Delta.Inserts) == 0 && len(input.Delta.DeleteIDs) == 0 {
		return EditorCollaborationOperationInput{}, nil, ErrInvalid
	}
	if len(input.Delta.Inserts)+len(input.Delta.DeleteIDs) > EditorCollaborationOperationMaxAtomCount {
		return EditorCollaborationOperationInput{}, nil, ErrInvalid
	}
	for index := range input.Delta.Inserts {
		atom := &input.Delta.Inserts[index]
		atom.ID = strings.TrimSpace(atom.ID)
		atom.AfterID = strings.TrimSpace(atom.AfterID)
		atom.Deleted = false
		if atom.ID == "" || len(atom.ID) > 200 || len(atom.AfterID) > 200 || !utf8.ValidString(atom.Value) || utf8.RuneCountInString(atom.Value) != 1 {
			return EditorCollaborationOperationInput{}, nil, ErrInvalid
		}
	}
	for index := range input.Delta.DeleteIDs {
		input.Delta.DeleteIDs[index] = strings.TrimSpace(input.Delta.DeleteIDs[index])
		if input.Delta.DeleteIDs[index] == "" || len(input.Delta.DeleteIDs[index]) > 200 {
			return EditorCollaborationOperationInput{}, nil, ErrInvalid
		}
	}
	payload, err := json.Marshal(input.Delta)
	if err != nil || len(payload) > EditorCollaborationOperationMaxBytes || editorDeltaContainsSensitiveContent(input.Delta) {
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
	runes := []rune(html)
	atoms := make([]EditorCollaborationAtom, 0, len(runes))
	afterID := ""
	for index, value := range runes {
		id := fmt.Sprintf("0:%08x", index)
		atoms = append(atoms, EditorCollaborationAtom{ID: id, AfterID: afterID, Value: string(value)})
		afterID = id
	}
	return EditorCollaborationState{Atoms: atoms}
}

func CloneEditorCollaborationState(state EditorCollaborationState) EditorCollaborationState {
	return EditorCollaborationState{Atoms: append([]EditorCollaborationAtom(nil), state.Atoms...)}
}

func ApplyEditorCollaborationDelta(state EditorCollaborationState, delta EditorCollaborationDelta) (EditorCollaborationState, error) {
	next := CloneEditorCollaborationState(state)
	indexByID := make(map[string]int, len(next.Atoms)+len(delta.Inserts))
	for index, atom := range next.Atoms {
		if atom.ID == "" {
			return EditorCollaborationState{}, ErrInvalid
		}
		if _, duplicate := indexByID[atom.ID]; duplicate {
			return EditorCollaborationState{}, ErrInvalid
		}
		indexByID[atom.ID] = index
	}
	for _, atom := range delta.Inserts {
		if _, duplicate := indexByID[atom.ID]; duplicate {
			return EditorCollaborationState{}, ErrInvalid
		}
		if atom.AfterID != "" {
			if _, exists := indexByID[atom.AfterID]; !exists {
				return EditorCollaborationState{}, ErrVersionConflict
			}
		}
		indexByID[atom.ID] = len(next.Atoms)
		next.Atoms = append(next.Atoms, atom)
	}
	for _, id := range delta.DeleteIDs {
		index, exists := indexByID[id]
		if !exists {
			return EditorCollaborationState{}, ErrVersionConflict
		}
		next.Atoms[index].Deleted = true
	}
	return next, nil
}

func MaterializeEditorCollaborationState(state EditorCollaborationState) (string, error) {
	children := make(map[string][]EditorCollaborationAtom, len(state.Atoms))
	seen := make(map[string]struct{}, len(state.Atoms))
	for _, atom := range state.Atoms {
		if atom.ID == "" {
			return "", ErrInvalid
		}
		if _, duplicate := seen[atom.ID]; duplicate {
			return "", ErrInvalid
		}
		seen[atom.ID] = struct{}{}
		children[atom.AfterID] = append(children[atom.AfterID], atom)
	}
	for afterID, atoms := range children {
		if afterID != "" {
			if _, exists := seen[afterID]; !exists {
				return "", ErrInvalid
			}
		}
		slices.SortFunc(atoms, func(left, right EditorCollaborationAtom) int {
			return -strings.Compare(left.ID, right.ID)
		})
		children[afterID] = atoms
	}
	var builder strings.Builder
	visited := make(map[string]bool, len(state.Atoms))
	var visit func(string) error
	visit = func(afterID string) error {
		for _, atom := range children[afterID] {
			if visited[atom.ID] {
				return ErrInvalid
			}
			visited[atom.ID] = true
			if !atom.Deleted {
				builder.WriteString(atom.Value)
			}
			if err := visit(atom.ID); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(""); err != nil {
		return "", err
	}
	if len(visited) != len(state.Atoms) {
		return "", ErrInvalid
	}
	return builder.String(), nil
}

func EditorCollaborationSnapshotETag(revision int64, state EditorCollaborationState) string {
	payload, _ := json.Marshal(state)
	digest := sha256.Sum256(payload)
	return fmt.Sprintf("\"editor-%d-%s\"", revision, hex.EncodeToString(digest[:8]))
}

func editorDeltaContainsSensitiveContent(delta EditorCollaborationDelta) bool {
	var inserted strings.Builder
	for _, atom := range delta.Inserts {
		inserted.WriteString(atom.Value)
	}
	value := strings.ToLower(inserted.String())
	for _, forbidden := range []string{"data:image/", ";base64,", "x-amz-credential", "x-amz-signature", "awsaccesskeyid", "presigned_url", "secret_access_key"} {
		if strings.Contains(value, forbidden) {
			return true
		}
	}
	return false
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
