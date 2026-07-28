package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	EditorFormatLegacyHTML       = "legacy_html"
	EditorFormatTiptapJSON       = "tiptap_json"
	EditorMigrationNotStarted    = "not_started"
	EditorMigrationConverting    = "converting"
	EditorMigrationValidated     = "validated"
	EditorMigrationReady         = "ready"
	MangoTiptapFormat            = "mango-tiptap-json"
	MangoTiptapSchemaVersion     = 1
	EditorJSONSnapshotEventType  = "editor.snapshot.required"
	EditorJSONDeletedEventType   = "editor.document.deleted"
	EditorJSONOperationMaxIDSize = 160
)

var emptyMangoTiptapDocument = json.RawMessage(
	`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`,
)

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
	Document         EditorJSONDocumentRef  `json:"document_ref"`
	Revision         int64                  `json:"revision"`
	SchemaVersion    int                    `json:"schema_version"`
	JSONDocument     json.RawMessage        `json:"document"`
	Annotations      []EditorJSONAnnotation `json:"annotations"`
	Deleted          bool                   `json:"deleted,omitempty"`
	UpdatedTimestamp time.Time              `json:"updated_timestamp"`
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
	canonical, err := ValidateMangoTiptapJSON(input.JSONDocument)
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

var editorJSONNodeAttrs = map[string]map[string]bool{
	"doc": {}, "paragraph": {"blockId": true, "textAlign": true, "indentLevel": true},
	"heading":    {"blockId": true, "level": true, "textAlign": true, "indentLevel": true},
	"blockquote": {"blockId": true}, "codeBlock": {"blockId": true, "language": true},
	"horizontalRule": {"blockId": true}, "text": {}, "hardBreak": {},
	"bulletList": {"blockId": true}, "orderedList": {"blockId": true, "start": true},
	"listItem": {"blockId": true}, "taskList": {"blockId": true}, "taskItem": {"blockId": true, "checked": true},
	"table": {"blockId": true, "style": true}, "tableRow": {},
	"tableHeader":     {"colspan": true, "rowspan": true, "colwidth": true, "align": true, "backgroundColor": true},
	"tableCell":       {"colspan": true, "rowspan": true, "colwidth": true, "align": true, "backgroundColor": true},
	"mention":         {"userId": true, "label": true, "kind": true},
	"mangoEntityLink": {"entityType": true, "entityId": true, "label": true},
	"mangoAttachmentImage": {
		"attachmentId": true, "filename": true, "mimeType": true, "width": true, "height": true,
		"displayWidth": true, "displayHeight": true, "alignment": true, "position": true,
		"layout": true, "alt": true, "title": true,
	},
}

var editorJSONMarkAttrs = map[string]map[string]bool{
	"bold": {}, "italic": {}, "underline": {}, "strike": {}, "code": {},
	"textStyle": {"fontSize": true, "color": true}, "highlight": {"color": true},
	"link": {"href": true, "target": true, "rel": true, "class": true, "title": true},
}

func ValidateMangoTiptapJSON(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || editorBytesContainSensitiveContent(raw) {
		return nil, ErrInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var envelope map[string]any
	if err := decoder.Decode(&envelope); err != nil {
		return nil, ErrInvalid
	}
	if len(envelope) != 3 || envelope["format"] != MangoTiptapFormat {
		return nil, ErrInvalid
	}
	version, ok := envelope["schema_version"].(json.Number)
	if !ok || version.String() != "1" {
		return nil, ErrInvalid
	}
	for key := range envelope {
		if key != "format" && key != "schema_version" && key != "document" {
			return nil, ErrInvalid
		}
	}
	count := 0
	document, ok := envelope["document"].(map[string]any)
	if !ok || document["type"] != "doc" {
		return nil, ErrInvalid
	}
	if err := validateEditorJSONNode(envelope["document"], "document", 0, &count); err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(envelope)
	if err != nil {
		return nil, ErrInvalid
	}
	return canonical, nil
}

func validateEditorJSONNode(value any, path string, depth int, count *int) error {
	if depth > 100 {
		return fmt.Errorf("%w: %s nested too deeply", ErrInvalid, path)
	}
	node, ok := value.(map[string]any)
	if !ok {
		return fmt.Errorf("%w: %s must be an object", ErrInvalid, path)
	}
	*count = *count + 1
	if *count > 100000 {
		return fmt.Errorf("%w: too many nodes", ErrInvalid)
	}
	nodeType, ok := node["type"].(string)
	allowedAttrs, known := editorJSONNodeAttrs[nodeType]
	if !ok || !known {
		return fmt.Errorf("%w: unknown node at %s", ErrInvalid, path)
	}
	for key := range node {
		if key != "type" && key != "attrs" && key != "content" && key != "text" && key != "marks" {
			return fmt.Errorf("%w: unsupported node property", ErrInvalid)
		}
	}
	attrs, err := validateEditorJSONAttributes(nodeType, node["attrs"], allowedAttrs)
	if err != nil {
		return err
	}
	if nodeType == "mention" {
		if userID, ok := attrs["userId"].(string); !ok || strings.TrimSpace(userID) == "" {
			return fmt.Errorf("%w: mention userId required", ErrInvalid)
		}
		kind, ok := attrs["kind"].(string)
		if !ok || (kind != "normal" && kind != "urgent") {
			return fmt.Errorf("%w: mention kind required", ErrInvalid)
		}
	}
	if nodeType == "mangoEntityLink" {
		entityType, typeOK := attrs["entityType"].(string)
		entityID, idOK := attrs["entityId"].(string)
		label, labelOK := attrs["label"].(string)
		if !typeOK || (entityType != EntityTypeNode && entityType != EntityTypeLogicGate && entityType != EntityTypeProject) {
			return fmt.Errorf("%w: entity link type required", ErrInvalid)
		}
		if !idOK || strings.TrimSpace(entityID) == "" || len(entityID) > 160 {
			return fmt.Errorf("%w: entity link id required", ErrInvalid)
		}
		if !labelOK || strings.TrimSpace(label) == "" || len(label) > 500 {
			return fmt.Errorf("%w: entity link label required", ErrInvalid)
		}
	}
	if nodeType == "mangoAttachmentImage" {
		attachmentID, ok := attrs["attachmentId"].(string)
		if !ok || strings.TrimSpace(attachmentID) == "" {
			return fmt.Errorf("%w: image attachmentId required", ErrInvalid)
		}
		for _, item := range attrs {
			if text, ok := item.(string); ok && (strings.HasPrefix(strings.ToLower(text), "blob:") || strings.HasPrefix(strings.ToLower(text), "data:")) {
				return fmt.Errorf("%w: transient image URL", ErrInvalid)
			}
		}
	}
	if nodeType == "text" {
		if _, ok := node["text"].(string); !ok {
			return fmt.Errorf("%w: text required", ErrInvalid)
		}
	} else if _, exists := node["text"]; exists {
		return fmt.Errorf("%w: text on non-text node", ErrInvalid)
	}
	if marksValue, exists := node["marks"]; exists {
		if nodeType != "text" && nodeType != "mention" {
			return fmt.Errorf("%w: marks on non-inline node", ErrInvalid)
		}
		marks, ok := marksValue.([]any)
		if !ok {
			return fmt.Errorf("%w: invalid marks", ErrInvalid)
		}
		for _, markValue := range marks {
			mark, ok := markValue.(map[string]any)
			if !ok {
				return fmt.Errorf("%w: invalid mark", ErrInvalid)
			}
			markType, ok := mark["type"].(string)
			allowed, known := editorJSONMarkAttrs[markType]
			if !ok || !known || len(mark) > 2 {
				return fmt.Errorf("%w: unknown mark", ErrInvalid)
			}
			markAttrs, attrErr := validateEditorJSONAttributes(markType, mark["attrs"], allowed)
			if attrErr != nil {
				return attrErr
			}
			if markType == "link" {
				href, ok := markAttrs["href"].(string)
				if !ok || !safeEditorJSONLink(href) {
					return fmt.Errorf("%w: unsafe link", ErrInvalid)
				}
			}
		}
	}
	contentValue, exists := node["content"]
	if !exists {
		if nodeType == "doc" {
			return fmt.Errorf("%w: doc content required", ErrInvalid)
		}
		return nil
	}
	content, ok := contentValue.([]any)
	if !ok {
		return fmt.Errorf("%w: invalid content", ErrInvalid)
	}
	if editorJSONAtomNode(nodeType) {
		return fmt.Errorf("%w: content on atom node", ErrInvalid)
	}
	if editorJSONNonEmptyContainer(nodeType) && len(content) == 0 {
		return fmt.Errorf("%w: empty container", ErrInvalid)
	}
	for index, child := range content {
		childObject, childOK := child.(map[string]any)
		childType, typeOK := childObject["type"].(string)
		if !childOK || !typeOK || !editorJSONChildAllowed(nodeType, childType, index) {
			return fmt.Errorf("%w: invalid %s child in %s", ErrInvalid, childType, nodeType)
		}
		if err := validateEditorJSONNode(child, fmt.Sprintf("%s.content[%d]", path, index), depth+1, count); err != nil {
			return err
		}
	}
	return nil
}

func editorJSONAtomNode(nodeType string) bool {
	switch nodeType {
	case "text", "hardBreak", "horizontalRule", "mention", "mangoEntityLink", "mangoAttachmentImage":
		return true
	default:
		return false
	}
}

func editorJSONNonEmptyContainer(nodeType string) bool {
	switch nodeType {
	case "doc", "blockquote", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "tableRow", "tableCell", "tableHeader":
		return true
	default:
		return false
	}
}

func editorJSONBlockNode(nodeType string) bool {
	switch nodeType {
	case "paragraph", "heading", "blockquote", "codeBlock", "horizontalRule", "bulletList", "orderedList", "taskList", "table", "mangoAttachmentImage":
		return true
	default:
		return false
	}
}

func editorJSONChildAllowed(parentType, childType string, index int) bool {
	switch parentType {
	case "paragraph", "heading":
		return childType == "text" || childType == "hardBreak" || childType == "mention" || childType == "mangoEntityLink"
	case "codeBlock":
		return childType == "text"
	case "doc", "blockquote", "tableCell", "tableHeader":
		return editorJSONBlockNode(childType)
	case "bulletList", "orderedList":
		return childType == "listItem"
	case "taskList":
		return childType == "taskItem"
	case "listItem", "taskItem":
		return editorJSONBlockNode(childType) && (index > 0 || childType == "paragraph")
	case "table":
		return childType == "tableRow"
	case "tableRow":
		return childType == "tableCell" || childType == "tableHeader"
	default:
		return false
	}
}

func editorJSONPositiveInteger(value any, maximum int64) bool {
	number, ok := value.(json.Number)
	if !ok {
		return false
	}
	parsed, err := number.Int64()
	return err == nil && parsed > 0 && parsed <= maximum
}

func editorJSONSafeColor(value any) bool {
	text, ok := value.(string)
	if !ok || len(text) != 7 || text[0] != '#' {
		return false
	}
	for _, char := range text[1:] {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func validateEditorJSONAttributes(kind string, value any, allowed map[string]bool) (map[string]any, error) {
	if value == nil {
		return map[string]any{}, nil
	}
	attrs, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: invalid attributes", ErrInvalid)
	}
	for name, item := range attrs {
		if !allowed[name] {
			return nil, fmt.Errorf("%w: unknown attribute", ErrInvalid)
		}
		switch item.(type) {
		case nil, string, bool, json.Number:
		case []any:
			for _, member := range item.([]any) {
				if _, ok := member.(json.Number); !ok {
					return nil, fmt.Errorf("%w: invalid attribute array", ErrInvalid)
				}
			}
		default:
			return nil, fmt.Errorf("%w: invalid attribute value", ErrInvalid)
		}
	}
	if blockID, exists := attrs["blockId"]; exists && blockID != nil {
		text, ok := blockID.(string)
		if !ok || strings.TrimSpace(text) == "" || len(text) > 160 {
			return nil, fmt.Errorf("%w: invalid blockId", ErrInvalid)
		}
	}
	if indent, exists := attrs["indentLevel"]; exists && indent != nil {
		number, ok := indent.(json.Number)
		parsed, err := number.Int64()
		if !ok || err != nil || parsed < 0 || parsed > 12 {
			return nil, fmt.Errorf("%w: invalid indentLevel", ErrInvalid)
		}
	}
	if alignment, exists := attrs["textAlign"]; exists && alignment != nil {
		text, ok := alignment.(string)
		if !ok || (text != "left" && text != "center" && text != "right") {
			return nil, fmt.Errorf("%w: invalid text alignment", ErrInvalid)
		}
	}
	if kind == "heading" && !editorJSONPositiveInteger(attrs["level"], 6) {
		return nil, fmt.Errorf("%w: invalid heading level", ErrInvalid)
	}
	if kind == "orderedList" {
		if start, exists := attrs["start"]; exists && start != nil && !editorJSONPositiveInteger(start, 100000) {
			return nil, fmt.Errorf("%w: invalid ordered list start", ErrInvalid)
		}
	}
	if kind == "taskItem" {
		if checked, exists := attrs["checked"]; exists && checked != nil {
			if _, ok := checked.(bool); !ok {
				return nil, fmt.Errorf("%w: invalid task state", ErrInvalid)
			}
		}
	}
	if kind == "table" {
		if style, exists := attrs["style"]; exists && style != nil {
			text, ok := style.(string)
			if !ok || (text != "auto" && text != "fixed") {
				return nil, fmt.Errorf("%w: invalid table layout", ErrInvalid)
			}
		}
	}
	if kind == "tableCell" || kind == "tableHeader" {
		for _, name := range []string{"colspan", "rowspan"} {
			if item, exists := attrs[name]; exists && item != nil && !editorJSONPositiveInteger(item, 1000) {
				return nil, fmt.Errorf("%w: invalid table span", ErrInvalid)
			}
		}
		if widths, exists := attrs["colwidth"]; exists && widths != nil {
			items, ok := widths.([]any)
			if !ok || len(items) == 0 {
				return nil, fmt.Errorf("%w: invalid table width", ErrInvalid)
			}
			for _, item := range items {
				if !editorJSONPositiveInteger(item, 100000) {
					return nil, fmt.Errorf("%w: invalid table width", ErrInvalid)
				}
			}
		}
		if align, exists := attrs["align"]; exists && align != nil {
			text, ok := align.(string)
			if !ok || (text != "left" && text != "center" && text != "right") {
				return nil, fmt.Errorf("%w: invalid table alignment", ErrInvalid)
			}
		}
		if color, exists := attrs["backgroundColor"]; exists && color != nil && !editorJSONSafeColor(color) {
			return nil, fmt.Errorf("%w: invalid table color", ErrInvalid)
		}
	}
	if kind == "textStyle" {
		if fontSize, exists := attrs["fontSize"]; exists && fontSize != nil {
			text, ok := fontSize.(string)
			parsed, err := strconv.Atoi(strings.TrimSuffix(text, "px"))
			if !ok || !strings.HasSuffix(text, "px") || err != nil || parsed < 10 || parsed > 28 {
				return nil, fmt.Errorf("%w: invalid font size", ErrInvalid)
			}
		}
		if color, exists := attrs["color"]; exists && color != nil && !editorJSONSafeColor(color) {
			return nil, fmt.Errorf("%w: invalid text color", ErrInvalid)
		}
	}
	if kind == "highlight" {
		if color, exists := attrs["color"]; exists && color != nil && !editorJSONSafeColor(color) {
			return nil, fmt.Errorf("%w: invalid highlight color", ErrInvalid)
		}
	}
	if kind == "mangoAttachmentImage" {
		mimeType, ok := attrs["mimeType"].(string)
		if !ok || (mimeType != "image/jpeg" && mimeType != "image/png" && mimeType != "image/gif" && mimeType != "image/webp") {
			return nil, fmt.Errorf("%w: invalid image MIME type", ErrInvalid)
		}
		for _, name := range []string{"width", "height", "displayWidth", "displayHeight"} {
			if item, exists := attrs[name]; exists && item != nil && !editorJSONPositiveInteger(item, 100000) {
				return nil, fmt.Errorf("%w: invalid image dimension", ErrInvalid)
			}
		}
		for name, allowedValues := range map[string]map[string]bool{
			"alignment": {"left": true, "center": true, "right": true},
			"position":  {"inline": true, "break": true},
			"layout":    {"content": true, "wide": true},
		} {
			if item, exists := attrs[name]; exists && item != nil {
				text, ok := item.(string)
				if !ok || !allowedValues[text] {
					return nil, fmt.Errorf("%w: invalid image layout", ErrInvalid)
				}
			}
		}
	}
	return attrs, nil
}

func safeEditorJSONLink(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") ||
		strings.HasPrefix(value, "mailto:") || strings.HasPrefix(value, "tel:") ||
		strings.HasPrefix(value, "/") || strings.HasPrefix(value, "#")
}

func EditorJSONRealtimeScope(ref EditorJSONDocumentRef) string {
	return "editor-json:" + url.QueryEscape(ref.ResourceType) + ":" + url.QueryEscape(ref.ResourceID) + ":" + url.QueryEscape(ref.DocumentID)
}
