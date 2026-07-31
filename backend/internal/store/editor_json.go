package store

import (
	"encoding/json"
	"net/url"
	"strings"
	"time"
)

const (
	EditorFormatLegacyHTML             = "legacy_html"
	EditorFormatTiptapJSON             = "tiptap_json"
	EditorMigrationNotStarted          = "not_started"
	EditorMigrationConverting          = "converting"
	EditorMigrationValidated           = "validated"
	EditorMigrationReady               = "ready"
	MangoTiptapFormat                  = "mango-tiptap-json"
	MangoTiptapSchemaVersion           = 1
	EditorJSONSnapshotEventType        = "editor.snapshot.required"
	EditorJSONDeletedEventType         = "editor.document.deleted"
	EditorJSONOperationMaxIDSize       = 160
	EditorOwnerTextMaxBytes      int64 = 1 << 30
	EditorOwnerTextLimitMessage        = "Mango gives each Node, Project, and Logic Gate a 1 GB editor-text limit. This counts only text and text-box document data. Attachments are separate and do not count toward the 1 GB."
)

var emptyMangoTiptapDocument = json.RawMessage(
	`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`,
)

func EditorOwnerTextLimitExceeded(otherCurrentBytes, nextDocumentBytes int64) bool {
	if otherCurrentBytes < 0 || nextDocumentBytes < 0 {
		return true
	}
	return otherCurrentBytes > EditorOwnerTextMaxBytes-nextDocumentBytes
}

func mapEditorOwnerTextLimitError(err error) error {
	if err != nil && strings.Contains(err.Error(), "editor_owner_text_limit_exceeded") {
		return ErrEditorOwnerTextLimit
	}
	return err
}

type EditorDataFormatGate struct {
	CompanyID              string `json:"company_id"`
	EditorFormat           string `json:"editor_format"`
	MigrationState         string `json:"migration_state"`
	DocumentSchemaVersion  int    `json:"document_schema_version"`
	ExpectedDocumentCount  int64  `json:"expected_document_count"`
	ConvertedDocumentCount int64  `json:"converted_document_count"`
}

func DefaultEditorDataFormatGate(companyID string) EditorDataFormatGate {
	return EditorDataFormatGate{
		CompanyID: strings.TrimSpace(companyID), EditorFormat: EditorFormatLegacyHTML,
		MigrationState: EditorMigrationNotStarted, DocumentSchemaVersion: MangoTiptapSchemaVersion,
	}
}

func ValidateEditorDataFormatGate(gate EditorDataFormatGate) error {
	gate.CompanyID = strings.TrimSpace(gate.CompanyID)
	if gate.CompanyID == "" || gate.DocumentSchemaVersion != MangoTiptapSchemaVersion || gate.ExpectedDocumentCount < 0 || gate.ConvertedDocumentCount < 0 {
		return ErrInvalid
	}
	switch gate.EditorFormat {
	case EditorFormatLegacyHTML:
	case EditorFormatTiptapJSON:
		if gate.MigrationState != EditorMigrationReady || gate.ExpectedDocumentCount != gate.ConvertedDocumentCount {
			return ErrVersionConflict
		}
	default:
		return ErrInvalid
	}
	switch gate.MigrationState {
	case EditorMigrationNotStarted, EditorMigrationConverting, EditorMigrationValidated, EditorMigrationReady:
	default:
		return ErrInvalid
	}
	if gate.MigrationState == EditorMigrationReady && gate.ExpectedDocumentCount != gate.ConvertedDocumentCount {
		return ErrVersionConflict
	}
	return nil
}

type EditorJSONDocumentRef struct {
	CompanyID    string `json:"company_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	DocumentID   string `json:"document_id"`
}

func NormalizeEditorJSONDocumentRef(ref EditorJSONDocumentRef) (EditorJSONDocumentRef, error) {
	ref.CompanyID = strings.TrimSpace(ref.CompanyID)
	ref.ResourceType = strings.TrimSpace(ref.ResourceType)
	ref.ResourceID = strings.TrimSpace(ref.ResourceID)
	ref.DocumentID = strings.TrimSpace(ref.DocumentID)
	if ref.CompanyID == "" || ref.ResourceID == "" || ref.DocumentID == "" || len(ref.ResourceID) > 500 || len(ref.DocumentID) > 500 {
		return EditorJSONDocumentRef{}, ErrInvalid
	}
	switch ref.ResourceType {
	case EntityTypeNode, EntityTypeProject, EntityTypeLogicGate:
	default:
		return EditorJSONDocumentRef{}, ErrInvalid
	}
	return ref, nil
}

type EditorJSONSnapshot struct {
	Document           EditorJSONDocumentRef  `json:"document_ref"`
	Revision           int64                  `json:"revision"`
	SchemaVersion      int                    `json:"schema_version"`
	CollaborationEpoch string                 `json:"collaboration_epoch,omitempty"`
	JSONDocument       json.RawMessage        `json:"document"`
	Annotations        []EditorJSONAnnotation `json:"annotations"`
	Deleted            bool                   `json:"deleted,omitempty"`
	UpdatedTimestamp   time.Time              `json:"updated_timestamp"`
}

type EditorJSONAnnotation struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	From int    `json:"from"`
	To   int    `json:"to"`
}

type EditorJSONCommitInput struct {
	Document      EditorJSONDocumentRef
	OperationID   string
	ClientID      string
	ActorUserID   string
	BaseRevision  int64
	SchemaVersion int
	JSONDocument  json.RawMessage
	Annotations   []EditorJSONAnnotation
}

type EditorJSONCommit struct {
	OperationID   string                 `json:"operation_id"`
	EventID       string                 `json:"event_id"`
	Revision      int64                  `json:"revision"`
	SchemaVersion int                    `json:"schema_version"`
	JSONDocument  json.RawMessage        `json:"document"`
	Annotations   []EditorJSONAnnotation `json:"annotations"`
	CommittedAt   time.Time              `json:"committed_at"`
	Deduplicated  bool                   `json:"deduplicated,omitempty"`
}

type EditorJSONDeleteInput struct {
	Document     EditorJSONDocumentRef
	OperationID  string
	ClientID     string
	ActorUserID  string
	BaseRevision int64
}

type EditorJSONVersion struct {
	Revision      int64                  `json:"revision"`
	SchemaVersion int                    `json:"schema_version"`
	JSONDocument  json.RawMessage        `json:"document"`
	Annotations   []EditorJSONAnnotation `json:"annotations"`
	OperationID   string                 `json:"operation_id"`
	ActorUserID   string                 `json:"actor_user_id,omitempty"`
	CreatedAt     time.Time              `json:"created_timestamp"`
	Deleted       bool                   `json:"deleted,omitempty"`
}

func NormalizeEditorJSONCommit(input EditorJSONCommitInput) (EditorJSONCommitInput, error) {
	ref, err := NormalizeEditorJSONDocumentRef(input.Document)
	if err != nil {
		return EditorJSONCommitInput{}, err
	}
	input.Document = ref
	input.OperationID = strings.TrimSpace(input.OperationID)
	input.ClientID = strings.TrimSpace(input.ClientID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.OperationID == "" || input.ClientID == "" || len(input.OperationID) > EditorJSONOperationMaxIDSize ||
		len(input.ClientID) > EditorJSONOperationMaxIDSize || input.BaseRevision < 0 || input.SchemaVersion != MangoTiptapSchemaVersion {
		return EditorJSONCommitInput{}, ErrInvalid
	}
	canonical, err := validateMangoTiptapJSONForCommit(input.JSONDocument)
	if err != nil {
		return EditorJSONCommitInput{}, err
	}
	input.JSONDocument = canonical
	annotations, err := NormalizeEditorJSONAnnotations(input.Annotations)
	if err != nil {
		return EditorJSONCommitInput{}, err
	}
	input.Annotations = annotations
	return input, nil
}

func NormalizeEditorJSONAnnotations(input []EditorJSONAnnotation) ([]EditorJSONAnnotation, error) {
	if len(input) > 10000 {
		return nil, ErrInvalid
	}
	result := make([]EditorJSONAnnotation, 0, len(input))
	seen := make(map[string]struct{}, len(input))
	for _, annotation := range input {
		annotation.ID = strings.TrimSpace(annotation.ID)
		annotation.Kind = strings.TrimSpace(annotation.Kind)
		if annotation.ID == "" || len(annotation.ID) > 500 || annotation.From < 0 || annotation.To <= annotation.From {
			return nil, ErrInvalid
		}
		switch annotation.Kind {
		case "comment", "change", "chat", "email-selection":
		default:
			return nil, ErrInvalid
		}
		key := annotation.Kind + "\x00" + annotation.ID
		if _, exists := seen[key]; exists {
			return nil, ErrInvalid
		}
		seen[key] = struct{}{}
		result = append(result, annotation)
	}
	return result, nil
}

func EditorJSONRealtimeScope(ref EditorJSONDocumentRef) string {
	return "editor-json:" + url.QueryEscape(ref.ResourceType) + ":" + url.QueryEscape(ref.ResourceID) + ":" + url.QueryEscape(ref.DocumentID)
}
