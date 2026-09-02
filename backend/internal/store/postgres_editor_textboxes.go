package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"time"
)

type postgresEditorTextboxStorage struct {
	table         string
	ownerColumn   string
	textboxColumn string
	textboxUUID   bool
	displayOrder  bool
}

func postgresEditorTextboxStorageFor(ref EditorJSONDocumentRef) (postgresEditorTextboxStorage, bool) {
	switch ref.ResourceType {
	case EntityTypeNode:
		return postgresEditorTextboxStorage{"node_textboxes", "node_id", "textbox_id", true, true}, true
	case EntityTypeProject:
		return postgresEditorTextboxStorage{"project_textboxes", "project_id", "textbox_id", false, true}, true
	case EntityTypeLogicGate:
		return postgresEditorTextboxStorage{"logic_gate_textboxes", "logic_gate_id", "textbox_id", false, false}, true
	case EntityTypeHuddleLogicGate:
		return postgresEditorTextboxStorage{"huddle_logic_gates", "huddle_logic_gate_id", "huddle_logic_gate_id", true, false}, true
	case EntityTypeHuddleNode:
		return postgresEditorTextboxStorage{"huddle_node_textboxes", "huddle_node_id", "textbox_id", true, true}, true
	case EntityTypeKPI:
		return postgresEditorTextboxStorage{"kpis", "kpi_id", "kpi_id", true, false}, true
	default:
		return postgresEditorTextboxStorage{}, false
	}
}

func postgresEditorTextboxIDExpression(storage postgresEditorTextboxStorage, parameter string) string {
	if storage.textboxUUID {
		return parameter + "::uuid"
	}
	return parameter
}

var mangoTiptapDefaultAttributes = func() map[string]map[string]any {
	// Keep this list aligned with createMangoTiptapExtensions. The frontend
	// reads these defaults directly from the active ProseMirror schema.
	defaults := map[string]map[string]any{
		"codeBlock":   {"language": nil},
		"heading":     {"level": float64(1), "textAlign": nil, "indentLevel": float64(0)},
		"paragraph":   {"textAlign": nil, "indentLevel": float64(0)},
		"orderedList": {"start": float64(1), "type": nil},
		"taskItem":    {"checked": false},
		"table":       {"style": nil},
		"tableCell":   {"colspan": float64(1), "rowspan": float64(1), "colwidth": nil, "align": nil, "backgroundColor": nil},
		"tableHeader": {"colspan": float64(1), "rowspan": float64(1), "colwidth": nil, "align": nil, "backgroundColor": nil},
		"mention":     {"userId": nil, "label": nil, "kind": "normal"},
		// entityType is required durable identity even when the schema defaults it to node.
		"mangoEntityLink": {"entityId": nil, "label": nil, "actionItem": false, "actionItemColor": nil},
		"highlight":       {"color": nil},
		"textStyle":       {"fontSize": nil, "color": nil},
		"link":            {"href": nil, "target": "_blank", "rel": "noopener noreferrer nofollow", "class": nil, "title": nil},
		"mangoAttachmentImage": {
			"attachmentId": "", "filename": "", "mimeType": "",
			"width": nil, "height": nil, "displayWidth": nil, "displayHeight": nil,
			"alignment": "left", "position": "break", "layout": "content",
			"alt": "", "title": "", "linkHref": "", "linkTarget": "", "linkRel": "", "linkTitle": "",
		},
	}
	for _, nodeType := range []string{
		"paragraph", "heading", "blockquote", "codeBlock", "horizontalRule",
		"bulletList", "orderedList", "listItem", "taskList", "taskItem", "table",
	} {
		if defaults[nodeType] == nil {
			defaults[nodeType] = map[string]any{}
		}
		defaults[nodeType]["blockId"] = nil
	}
	return defaults
}()

func compactMangoTiptapValue(value any) {
	switch current := value.(type) {
	case []any:
		for _, child := range current {
			compactMangoTiptapValue(child)
		}
	case map[string]any:
		for _, child := range current {
			compactMangoTiptapValue(child)
		}
		nodeType, _ := current["type"].(string)
		attrs, ok := current["attrs"].(map[string]any)
		if !ok {
			return
		}
		for name, defaultValue := range mangoTiptapDefaultAttributes[nodeType] {
			if value, ok := attrs[name]; ok && reflect.DeepEqual(value, defaultValue) {
				delete(attrs, name)
			}
		}
		if len(attrs) == 0 {
			delete(current, "attrs")
		}
	}
}

func compactMangoTiptapRawValue(raw json.RawMessage) (json.RawMessage, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, ErrInvalid
	}
	compactMangoTiptapValue(value)
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func compactMangoTiptapJSON(document json.RawMessage) (json.RawMessage, error) {
	canonical, err := ValidateMangoTiptapJSON(document)
	if err != nil {
		return nil, err
	}
	compact, err := compactMangoTiptapRawValue(canonical)
	if err != nil {
		return nil, err
	}
	return ValidateMangoTiptapJSON(compact)
}

func encodeEditorTextboxBody(document json.RawMessage, annotations []EditorJSONAnnotation) (json.RawMessage, error) {
	canonical, err := compactMangoTiptapJSON(document)
	if err != nil {
		return nil, err
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(canonical, &body); err != nil {
		return nil, ErrInvalid
	}
	annotationJSON, err := json.Marshal(annotations)
	if err != nil {
		return nil, err
	}
	body["annotations"] = annotationJSON
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func decodeEditorTextboxBody(body json.RawMessage) (json.RawMessage, []EditorJSONAnnotation, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, nil, ErrInvalid
	}
	annotationJSON := envelope["annotations"]
	delete(envelope, "annotations")
	documentJSON, err := json.Marshal(envelope)
	if err != nil {
		return nil, nil, err
	}
	document, err := compactMangoTiptapJSON(documentJSON)
	if err != nil {
		return nil, nil, err
	}
	annotations, err := decodePostgresEditorJSONAnnotations(annotationJSON)
	if err != nil {
		return nil, nil, err
	}
	return document, annotations, nil
}

func emptyEditorTextboxBody() json.RawMessage {
	body, err := encodeEditorTextboxBody(emptyMangoTiptapDocument, []EditorJSONAnnotation{})
	if err != nil {
		panic(err)
	}
	return body
}

func getPostgresEditorTextboxSnapshot(r *PostgresRepo, ref EditorJSONDocumentRef) (EditorJSONSnapshot, error) {
	storage, ok := postgresEditorTextboxStorageFor(ref)
	if !ok {
		return EditorJSONSnapshot{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return EditorJSONSnapshot{}, err
	}
	defer tx.Rollback()
	if err := requirePostgresEditorJSONFormatTx(ctx, tx, ref.CompanyID); err != nil {
		return EditorJSONSnapshot{}, err
	}
	snapshot := EditorJSONSnapshot{
		Document: ref, SchemaVersion: MangoTiptapSchemaVersion,
		JSONDocument: append(json.RawMessage(nil), emptyMangoTiptapDocument...),
		Annotations:  []EditorJSONAnnotation{}, UpdatedTimestamp: time.Now().UTC(),
	}
	query := fmt.Sprintf(`select revision,body_json,deleted_timestamp is not null,updated_timestamp
		from %s where company_id=$1::uuid and %s=$2::uuid and %s=%s`,
		storage.table, storage.ownerColumn, storage.textboxColumn, postgresEditorTextboxIDExpression(storage, "$3"))
	var body []byte
	err = tx.QueryRowContext(ctx, query, ref.CompanyID, ref.ResourceID, ref.DocumentID).
		Scan(&snapshot.Revision, &body, &snapshot.Deleted, &snapshot.UpdatedTimestamp)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return EditorJSONSnapshot{}, err
	}
	if err == nil {
		snapshot.JSONDocument, snapshot.Annotations, err = decodeEditorTextboxBody(body)
		if err != nil {
			return EditorJSONSnapshot{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONSnapshot{}, err
	}
	return snapshot, nil
}

func insertEmptyPostgresEditorTextboxTx(ctx context.Context, tx *sql.Tx, storage postgresEditorTextboxStorage, ref EditorJSONDocumentRef) error {
	body := emptyEditorTextboxBody()
	if ref.ResourceType == EntityTypeHuddleLogicGate || ref.ResourceType == EntityTypeKPI {
		if ref.DocumentID != ref.ResourceID {
			return ErrInvalid
		}
		return nil
	}
	if ref.ResourceType == EntityTypeNode {
		_, err := tx.ExecContext(ctx, `insert into node_textboxes(company_id,node_id,textbox_id,body_json,revision,display_order,created_timestamp,updated_timestamp)
		values($1::uuid,$2::uuid,$3::uuid,$4::jsonb,0,
			coalesce((select max(display_order)+1 from node_textboxes where company_id=$1::uuid and node_id=$2::uuid),0),
			statement_timestamp(),statement_timestamp()) on conflict(company_id,node_id,textbox_id) do nothing`,
			ref.CompanyID, ref.ResourceID, ref.DocumentID, body)
		return mapEditorOwnerTextLimitError(err)
	}
	if storage.displayOrder {
		query := fmt.Sprintf(`insert into %s(company_id,%s,%s,body_json,revision,display_order,created_timestamp,updated_timestamp)
			values($1::uuid,$2::uuid,%s,$4::jsonb,0,
			coalesce((select max(display_order)+1 from %s where company_id=$1::uuid and %s=$2::uuid),0),
			statement_timestamp(),statement_timestamp()) on conflict(company_id,%s,%s) do nothing`,
			storage.table, storage.ownerColumn, storage.textboxColumn,
			postgresEditorTextboxIDExpression(storage, "$3"), storage.table, storage.ownerColumn,
			storage.ownerColumn, storage.textboxColumn)
		_, err := tx.ExecContext(ctx, query, ref.CompanyID, ref.ResourceID, ref.DocumentID, body)
		return mapEditorOwnerTextLimitError(err)
	}
	query := fmt.Sprintf(`insert into %s(company_id,%s,%s,body_json,revision,created_timestamp,updated_timestamp)
		values($1::uuid,$2::uuid,%s,$4::jsonb,0,statement_timestamp(),statement_timestamp())
		on conflict(company_id,%s,%s) do nothing`, storage.table, storage.ownerColumn,
		storage.textboxColumn, postgresEditorTextboxIDExpression(storage, "$3"), storage.ownerColumn, storage.textboxColumn)
	_, err := tx.ExecContext(ctx, query, ref.CompanyID, ref.ResourceID, ref.DocumentID, body)
	return mapEditorOwnerTextLimitError(err)
}

func ensurePostgresEditorTextboxDocument(r *PostgresRepo, ref EditorJSONDocumentRef) (EditorJSONSnapshot, error) {
	storage, ok := postgresEditorTextboxStorageFor(ref)
	if !ok {
		return EditorJSONSnapshot{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorJSONSnapshot{}, err
	}
	defer tx.Rollback()
	if err := requirePostgresEditorJSONFormatTx(ctx, tx, ref.CompanyID); err != nil {
		return EditorJSONSnapshot{}, err
	}
	exists, err := postgresEditorResourceExistsTx(ctx, tx, EditorDocumentRef{
		CompanyID: ref.CompanyID, ResourceType: ref.ResourceType, ResourceID: ref.ResourceID, DocumentID: ref.DocumentID,
	})
	if err != nil {
		return EditorJSONSnapshot{}, err
	}
	if !exists {
		return EditorJSONSnapshot{}, ErrNotFound
	}
	if err := insertEmptyPostgresEditorTextboxTx(ctx, tx, storage, ref); err != nil {
		return EditorJSONSnapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONSnapshot{}, err
	}
	return getPostgresEditorTextboxSnapshot(r, ref)
}

type mangoTiptapMergeEnvelope struct {
	Format        string                   `json:"format"`
	SchemaVersion int                      `json:"schema_version"`
	Document      mangoTiptapMergeDocument `json:"document"`
}

type mangoTiptapMergeDocument struct {
	Type    string            `json:"type"`
	Content []json.RawMessage `json:"content,omitempty"`
}

func mangoTiptapBlockID(raw json.RawMessage) string {
	var block struct {
		Attrs map[string]any `json:"attrs"`
	}
	if json.Unmarshal(raw, &block) != nil || block.Attrs == nil {
		return ""
	}
	id, _ := block.Attrs["blockId"].(string)
	return id
}

func cloneMangoTiptapBlockWithFreshID(raw json.RawMessage) json.RawMessage {
	var block map[string]any
	if json.Unmarshal(raw, &block) != nil {
		return append(json.RawMessage(nil), raw...)
	}
	attrs, _ := block["attrs"].(map[string]any)
	if attrs == nil {
		attrs = map[string]any{}
		block["attrs"] = attrs
	}
	attrs["blockId"] = newUUIDv7String()
	encoded, err := json.Marshal(block)
	if err != nil {
		return append(json.RawMessage(nil), raw...)
	}
	return encoded
}

func editorJSONValuesEqual(left, right json.RawMessage) bool {
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	compactMangoTiptapValue(leftValue)
	compactMangoTiptapValue(rightValue)
	return reflect.DeepEqual(leftValue, rightValue)
}

func mangoTiptapBlockContentKey(raw json.RawMessage) string {
	var block map[string]any
	if json.Unmarshal(raw, &block) != nil {
		return string(raw)
	}
	compactMangoTiptapValue(block)
	attrs, _ := block["attrs"].(map[string]any)
	if attrs != nil {
		delete(attrs, "blockId")
		if len(attrs) == 0 {
			delete(block, "attrs")
		}
	}
	encoded, err := json.Marshal(block)
	if err != nil {
		return string(raw)
	}
	return string(encoded)
}

// mergeMangoTiptapDocuments keeps the server block when a block ID conflicts,
// then appends a fresh-ID copy of the user's block. A missing local block is
// treated as a conflicted deletion, so the server block is kept.
func mergeMangoTiptapDocuments(server, local json.RawMessage) (json.RawMessage, error) {
	var serverEnvelope, localEnvelope mangoTiptapMergeEnvelope
	if json.Unmarshal(server, &serverEnvelope) != nil || json.Unmarshal(local, &localEnvelope) != nil {
		return nil, ErrInvalid
	}
	result := serverEnvelope
	serverByID := make(map[string]json.RawMessage, len(serverEnvelope.Document.Content))
	serverContent := make(map[string]struct{}, len(serverEnvelope.Document.Content))
	for _, block := range serverEnvelope.Document.Content {
		if id := mangoTiptapBlockID(block); id != "" {
			serverByID[id] = block
		}
		serverContent[mangoTiptapBlockContentKey(block)] = struct{}{}
	}
	for _, localBlock := range localEnvelope.Document.Content {
		id := mangoTiptapBlockID(localBlock)
		if id == "" {
			contentKey := mangoTiptapBlockContentKey(localBlock)
			if _, exists := serverContent[contentKey]; !exists {
				result.Document.Content = append(result.Document.Content, localBlock)
				serverContent[contentKey] = struct{}{}
			}
			continue
		}
		serverBlock, exists := serverByID[id]
		if !exists {
			result.Document.Content = append(result.Document.Content, localBlock)
			continue
		}
		if !editorJSONValuesEqual(serverBlock, localBlock) {
			if _, alreadyPresent := serverContent[mangoTiptapBlockContentKey(localBlock)]; alreadyPresent {
				continue
			}
			serverContent[mangoTiptapBlockContentKey(localBlock)] = struct{}{}
			result.Document.Content = append(result.Document.Content, cloneMangoTiptapBlockWithFreshID(localBlock))
		}
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	return compactMangoTiptapJSON(encoded)
}

func updatePostgresEditorTextboxTx(ctx context.Context, tx *sql.Tx, storage postgresEditorTextboxStorage, ref EditorJSONDocumentRef, body json.RawMessage, revision int64, now time.Time) error {
	if ref.ResourceType == EntityTypeNode {
		_, err := tx.ExecContext(ctx, `update node_textboxes
			set body_json=$4::jsonb,revision=$5,deleted_timestamp=null,updated_timestamp=$6
			where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
			ref.CompanyID, ref.ResourceID, ref.DocumentID, body, revision, now)
		return mapEditorOwnerTextLimitError(err)
	}
	query := fmt.Sprintf(`update %s set body_json=$4::jsonb,revision=$5,deleted_timestamp=null,updated_timestamp=$6
		where company_id=$1::uuid and %s=$2::uuid and %s=%s`, storage.table, storage.ownerColumn,
		storage.textboxColumn, postgresEditorTextboxIDExpression(storage, "$3"))
	_, err := tx.ExecContext(ctx, query, ref.CompanyID, ref.ResourceID, ref.DocumentID, body, revision, now)
	return mapEditorOwnerTextLimitError(err)
}

func commitPostgresEditorTextboxDocument(r *PostgresRepo, input EditorJSONCommitInput) (EditorJSONCommit, error) {
	storage, ok := postgresEditorTextboxStorageFor(input.Document)
	if !ok {
		return EditorJSONCommit{}, ErrInvalid
	}
	requestedBody, err := encodeEditorTextboxBody(input.JSONDocument, input.Annotations)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	defer tx.Rollback()
	if err := requirePostgresEditorJSONFormatTx(ctx, tx, input.Document.CompanyID); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := lockPostgresHuddleActionItemRelationshipsTx(ctx, tx, input.Document); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := insertEmptyPostgresEditorTextboxTx(ctx, tx, storage, input.Document); err != nil {
		return EditorJSONCommit{}, err
	}
	query := fmt.Sprintf(`select revision,body_json,deleted_timestamp is not null,
		greatest(clock_timestamp(),created_timestamp) from %s
		where company_id=$1::uuid and %s=$2::uuid and %s=%s for update`, storage.table,
		storage.ownerColumn, storage.textboxColumn, postgresEditorTextboxIDExpression(storage, "$3"))
	var revision int64
	var currentBody []byte
	var deleted bool
	var now time.Time
	if err := tx.QueryRowContext(ctx, query, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID).
		Scan(&revision, &currentBody, &deleted, &now); err != nil {
		return EditorJSONCommit{}, err
	}
	if deleted && input.BaseRevision != revision {
		return EditorJSONCommit{}, ErrNotFound
	}
	currentDocument, currentAnnotations, err := decodeEditorTextboxBody(currentBody)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	if input.BaseRevision != revision && editorJSONValuesEqual(currentBody, requestedBody) {
		if err := tx.Commit(); err != nil {
			return EditorJSONCommit{}, err
		}
		return EditorJSONCommit{OperationID: input.OperationID, Revision: revision,
			SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: currentDocument,
			Annotations: currentAnnotations, CommittedAt: now, Deduplicated: true}, nil
	}
	merged := input.BaseRevision != revision
	nextDocument, nextAnnotations := input.JSONDocument, input.Annotations
	if merged {
		nextDocument, err = mergeMangoTiptapDocuments(currentDocument, input.JSONDocument)
		if err != nil {
			return EditorJSONCommit{}, err
		}
		// Existing annotations remain safe. Local absolute offsets cannot be copied
		// after blocks are duplicated without pointing at the wrong text.
		nextAnnotations = currentAnnotations
	}
	nextBody, err := encodeEditorTextboxBody(nextDocument, nextAnnotations)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	nextRevision, eventID := revision+1, newUUIDv7String()
	if err := updatePostgresEditorTextboxTx(ctx, tx, storage, input.Document, nextBody, nextRevision, now); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := r.syncPostgresHuddleActionItemRelationshipsTx(ctx, tx, input.Document); err != nil {
		return EditorJSONCommit{}, err
	}
	reason := "tiptap_json_committed"
	if merged {
		reason = "tiptap_json_conflict_merged"
	}
	scope := EditorJSONRealtimeScope(input.Document)
	payload, err := json.Marshal(map[string]any{
		"type": EditorJSONSnapshotEventType, "event_id": eventID, "company_id": input.Document.CompanyID,
		"scope": scope, "resource_type": input.Document.ResourceType, "resource_id": input.Document.ResourceID,
		"document_id": input.Document.DocumentID, "resource_revision": nextRevision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID, "reason": reason,
	})
	if err != nil {
		return EditorJSONCommit{}, err
	}
	if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{
		EventID: eventID, CompanyID: input.Document.CompanyID, Scope: scope,
		EventType: EditorJSONSnapshotEventType, ResourceType: input.Document.ResourceType,
		ResourceID: input.Document.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: nextRevision, Payload: payload,
	}); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONCommit{}, err
	}
	return EditorJSONCommit{OperationID: input.OperationID, EventID: eventID, Revision: nextRevision,
		SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: nextDocument,
		Annotations: nextAnnotations, CommittedAt: now}, nil
}

func deletePostgresEditorTextboxDocument(r *PostgresRepo, input EditorJSONDeleteInput) (EditorJSONCommit, error) {
	storage, ok := postgresEditorTextboxStorageFor(input.Document)
	if !ok {
		return EditorJSONCommit{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	defer tx.Rollback()
	if err := requirePostgresEditorJSONFormatTx(ctx, tx, input.Document.CompanyID); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := lockPostgresHuddleActionItemRelationshipsTx(ctx, tx, input.Document); err != nil {
		return EditorJSONCommit{}, err
	}
	query := fmt.Sprintf(`select revision,body_json,deleted_timestamp is not null,
		greatest(clock_timestamp(),created_timestamp) from %s
		where company_id=$1::uuid and %s=$2::uuid and %s=%s for update`, storage.table,
		storage.ownerColumn, storage.textboxColumn, postgresEditorTextboxIDExpression(storage, "$3"))
	var revision int64
	var body []byte
	var deleted bool
	var now time.Time
	if err := tx.QueryRowContext(ctx, query, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID).
		Scan(&revision, &body, &deleted, &now); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return EditorJSONCommit{}, ErrNotFound
		}
		return EditorJSONCommit{}, err
	}
	document, annotations, err := decodeEditorTextboxBody(body)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	if deleted {
		if err := tx.Commit(); err != nil {
			return EditorJSONCommit{}, err
		}
		return EditorJSONCommit{OperationID: input.OperationID, Revision: revision,
			SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
			Annotations: annotations, CommittedAt: now, Deduplicated: true}, nil
	}
	if input.BaseRevision != revision {
		return EditorJSONCommit{}, ErrVersionConflict
	}
	nextRevision, eventID := revision+1, newUUIDv7String()
	update := fmt.Sprintf(`update %s set revision=$4,deleted_timestamp=$5,updated_timestamp=$5
		where company_id=$1::uuid and %s=$2::uuid and %s=%s`, storage.table, storage.ownerColumn,
		storage.textboxColumn, postgresEditorTextboxIDExpression(storage, "$3"))
	if _, err := tx.ExecContext(ctx, update, input.Document.CompanyID, input.Document.ResourceID,
		input.Document.DocumentID, nextRevision, now); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := r.syncPostgresHuddleActionItemRelationshipsTx(ctx, tx, input.Document); err != nil {
		return EditorJSONCommit{}, err
	}
	if input.Document.ResourceType == EntityTypeNode {
		if err := retireNodeTextboxAttachmentRelationshipsTx(ctx, tx, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID); err != nil {
			return EditorJSONCommit{}, err
		}
		if _, err := tx.ExecContext(ctx, `delete from node_textbox_chats
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
			input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID); err != nil {
			return EditorJSONCommit{}, err
		}
		if _, err := tx.ExecContext(ctx, `delete from email_relationships
where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid and resource_textbox_id=$3::text`,
			input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID); err != nil {
			return EditorJSONCommit{}, err
		}
	}
	if input.Document.ResourceType == EntityTypeProject {
		if err := retireProjectTextboxAttachmentRelationshipsTx(ctx, tx, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID); err != nil {
			return EditorJSONCommit{}, err
		}
		if _, err := tx.ExecContext(ctx, `delete from project_textbox_chats
where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3`,
			input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID); err != nil {
			return EditorJSONCommit{}, err
		}
		if _, err := tx.ExecContext(ctx, `delete from email_relationships
where company_id=$1::uuid and resource_type='project' and resource_id=$2::uuid and resource_textbox_id=$3`,
			input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID); err != nil {
			return EditorJSONCommit{}, err
		}
	}
	if input.Document.ResourceType == EntityTypeNode || input.Document.ResourceType == EntityTypeProject || input.Document.ResourceType == EntityTypeLogicGate || input.Document.ResourceType == EntityTypeHuddleNode {
		if err := deletePostgresEditorProjectionTx(ctx, tx, EditorDocumentRef{
			CompanyID: input.Document.CompanyID, ResourceType: input.Document.ResourceType,
			ResourceID: input.Document.ResourceID, DocumentID: input.Document.DocumentID,
		}, now); err != nil {
			return EditorJSONCommit{}, err
		}
	}
	scope := EditorJSONRealtimeScope(input.Document)
	payload, _ := json.Marshal(map[string]any{
		"type": EditorJSONDeletedEventType, "event_id": eventID, "company_id": input.Document.CompanyID,
		"scope": scope, "resource_type": input.Document.ResourceType, "resource_id": input.Document.ResourceID,
		"document_id": input.Document.DocumentID, "resource_revision": nextRevision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID,
	})
	if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{
		EventID: eventID, CompanyID: input.Document.CompanyID, Scope: scope,
		EventType: EditorJSONDeletedEventType, ResourceType: input.Document.ResourceType,
		ResourceID: input.Document.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: nextRevision, Payload: payload,
	}); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONCommit{}, err
	}
	return EditorJSONCommit{OperationID: input.OperationID, EventID: eventID, Revision: nextRevision,
		SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
		Annotations: annotations, CommittedAt: now}, nil
}
