package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Owner-specific Project and Logic Gate persistence replaces the legacy
// polymorphic current-document table only after that owner's rollout gate is active.
type postgresEditorDomainStorage struct {
	currentTable, operationsTable, versionsTable, ownerColumn string
}

func postgresEditorDomainStorageFor(ref EditorJSONDocumentRef) (postgresEditorDomainStorage, bool) {
	switch ref.ResourceType {
	case EntityTypeProject:
		return postgresEditorDomainStorage{"project_editor_documents", "project_editor_document_operations", "project_editor_document_versions", "project_id"}, true
	case EntityTypeLogicGate:
		return postgresEditorDomainStorage{"logic_gate_editor_documents", "logic_gate_editor_document_operations", "logic_gate_editor_document_versions", "logic_gate_id"}, true
	default:
		return postgresEditorDomainStorage{}, false
	}
}

func (r *PostgresRepo) postgresEditorDomainActive(ref EditorJSONDocumentRef) (bool, error) {
	if _, ok := postgresEditorDomainStorageFor(ref); !ok {
		return false, nil
	}
	var active bool
	err := r.db.QueryRow(`select exists(select 1 from editor_rollout_gates
		where company_id=$1::uuid and owner_type=$2 and rollout_state='active'
		  and expected_count=converted_count and failed_count=0 and shadow_mismatch_count=0
		  and validated_timestamp is not null)`, ref.CompanyID, ref.ResourceType).Scan(&active)
	return active, err
}

func requirePostgresEditorDomainActiveTx(ctx context.Context, tx *sql.Tx, ref EditorJSONDocumentRef, lock bool) error {
	var active bool
	lockClause := ""
	if lock {
		lockClause = " for share"
	}
	err := tx.QueryRowContext(ctx, `select exists(select 1 from editor_rollout_gates
		where company_id=$1::uuid and owner_type=$2 and rollout_state='active'
		  and expected_count=converted_count and failed_count=0 and shadow_mismatch_count=0
		  and validated_timestamp is not null`+lockClause+`)`, ref.CompanyID, ref.ResourceType).Scan(&active)
	if err == nil && !active {
		return ErrVersionConflict
	}
	return err
}

func postgresEditorDomainPlainText(raw json.RawMessage) string {
	var envelope map[string]any
	if json.Unmarshal(raw, &envelope) != nil {
		return ""
	}
	var result strings.Builder
	var visit func(any)
	visit = func(value any) {
		switch typed := value.(type) {
		case []any:
			for _, child := range typed {
				visit(child)
			}
		case map[string]any:
			nodeType, _ := typed["type"].(string)
			if nodeType == "text" {
				if text, ok := typed["text"].(string); ok {
					result.WriteString(text)
				}
			}
			if nodeType == "hardBreak" {
				result.WriteByte('\n')
			}
			visit(typed["content"])
			switch nodeType {
			case "paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock", "tableRow":
				result.WriteByte('\n')
			}
		}
	}
	visit(envelope["document"])
	return strings.TrimSpace(result.String())
}

func getPostgresEditorDomainSnapshot(r *PostgresRepo, ref EditorJSONDocumentRef) (EditorJSONSnapshot, error) {
	storage, ok := postgresEditorDomainStorageFor(ref)
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
	if err := requirePostgresEditorDomainActiveTx(ctx, tx, ref, false); err != nil {
		return EditorJSONSnapshot{}, err
	}
	snapshot := EditorJSONSnapshot{Document: ref, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: append(json.RawMessage(nil), emptyMangoTiptapDocument...), UpdatedTimestamp: time.Now().UTC()}
	var raw, annotationsRaw []byte
	query := fmt.Sprintf(`select revision,document_schema_version,collaboration_epoch::text,document_json,canonical_annotations,is_deleted,updated_timestamp
		from %s where company_id=$1::uuid and %s=$2::uuid and document_id=$3`, storage.currentTable, storage.ownerColumn)
	err = tx.QueryRowContext(ctx, query, ref.CompanyID, ref.ResourceID, ref.DocumentID).Scan(&snapshot.Revision, &snapshot.SchemaVersion, &snapshot.CollaborationEpoch, &raw, &annotationsRaw, &snapshot.Deleted, &snapshot.UpdatedTimestamp)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return EditorJSONSnapshot{}, err
	}
	if err == nil {
		snapshot.JSONDocument, err = ValidateMangoTiptapJSON(raw)
		if err != nil {
			return EditorJSONSnapshot{}, err
		}
		snapshot.Annotations, err = decodePostgresEditorJSONAnnotations(annotationsRaw)
		if err != nil {
			return EditorJSONSnapshot{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONSnapshot{}, err
	}
	return snapshot, nil
}

func ensurePostgresEditorDomainCollaborationDocument(r *PostgresRepo, ref EditorJSONDocumentRef) (EditorJSONSnapshot, error) {
	storage, ok := postgresEditorDomainStorageFor(ref)
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
	if err := requirePostgresEditorDomainActiveTx(ctx, tx, ref, true); err != nil {
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
	query := fmt.Sprintf(`insert into %s(
		company_id,%s,document_id,document_schema_version,revision,document_json,plain_text,canonical_annotations,is_deleted,
		created_timestamp,updated_timestamp
	) values($1::uuid,$2::uuid,$3,1,0,$4::jsonb,'','[]'::jsonb,false,clock_timestamp(),clock_timestamp())
	  on conflict(company_id,%s,document_id) do nothing`, storage.currentTable, storage.ownerColumn, storage.ownerColumn)
	if _, err := tx.ExecContext(ctx, query, ref.CompanyID, ref.ResourceID, ref.DocumentID, emptyMangoTiptapDocument); err != nil {
		return EditorJSONSnapshot{}, mapEditorOwnerTextLimitError(err)
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONSnapshot{}, err
	}
	return getPostgresEditorDomainSnapshot(r, ref)
}

func loadPostgresEditorDomainOperationTx(ctx context.Context, tx *sql.Tx, storage postgresEditorDomainStorage, ref EditorJSONDocumentRef, operationID string) (postgresEditorJSONOperation, bool, error) {
	var item postgresEditorJSONOperation
	var raw, annotationsRaw []byte
	query := fmt.Sprintf(`select operation_id,client_id,base_revision,revision,document_schema_version,
		document_json,canonical_annotations,event_id::text,committed_timestamp,is_delete
		from %s where company_id=$1::uuid and %s=$2::uuid and document_id=$3 and operation_id=$4`, storage.operationsTable, storage.ownerColumn)
	err := tx.QueryRowContext(ctx, query, ref.CompanyID, ref.ResourceID, ref.DocumentID, operationID).Scan(&item.OperationID, &item.ClientID, &item.BaseRevision, &item.Revision, &item.SchemaVersion, &raw, &annotationsRaw, &item.EventID, &item.CommittedAt, &item.Deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return postgresEditorJSONOperation{}, false, nil
	}
	if err != nil {
		return postgresEditorJSONOperation{}, false, err
	}
	item.JSONDocument, err = ValidateMangoTiptapJSON(raw)
	if err != nil {
		return postgresEditorJSONOperation{}, false, err
	}
	item.Annotations, err = decodePostgresEditorJSONAnnotations(annotationsRaw)
	return item, true, err
}

func commitPostgresEditorDomainDocument(r *PostgresRepo, input EditorJSONCommitInput) (EditorJSONCommit, error) {
	storage, ok := postgresEditorDomainStorageFor(input.Document)
	if !ok {
		return EditorJSONCommit{}, ErrInvalid
	}
	annotationsRaw, err := json.Marshal(input.Annotations)
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
	if err := requirePostgresEditorDomainActiveTx(ctx, tx, input.Document, true); err != nil {
		return EditorJSONCommit{}, err
	}
	insertCurrent := fmt.Sprintf(`insert into %s(company_id,%s,document_id,document_schema_version,revision,document_json,plain_text,canonical_annotations,is_deleted,created_timestamp,updated_timestamp)
		values($1::uuid,$2::uuid,$3,1,0,$4::jsonb,'','[]'::jsonb,false,now(),now()) on conflict(company_id,%s,document_id) do nothing`, storage.currentTable, storage.ownerColumn, storage.ownerColumn)
	if _, err := tx.ExecContext(ctx, insertCurrent, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, emptyMangoTiptapDocument); err != nil {
		return EditorJSONCommit{}, mapEditorOwnerTextLimitError(err)
	}
	var revision int64
	var deleted bool
	lockCurrent := fmt.Sprintf(`select revision,is_deleted from %s where company_id=$1::uuid and %s=$2::uuid and document_id=$3 for update`, storage.currentTable, storage.ownerColumn)
	if err := tx.QueryRowContext(ctx, lockCurrent, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID).Scan(&revision, &deleted); err != nil {
		return EditorJSONCommit{}, err
	}
	if existing, found, loadErr := loadPostgresEditorDomainOperationTx(ctx, tx, storage, input.Document, input.OperationID); loadErr != nil {
		return EditorJSONCommit{}, loadErr
	} else if found {
		if existing.Deleted || existing.ClientID != input.ClientID || existing.BaseRevision != input.BaseRevision || !bytes.Equal(existing.JSONDocument, input.JSONDocument) || !editorJSONAnnotationsEqual(existing.Annotations, input.Annotations) {
			return EditorJSONCommit{}, ErrInvalid
		}
		if err := tx.Commit(); err != nil {
			return EditorJSONCommit{}, err
		}
		return EditorJSONCommit{OperationID: existing.OperationID, EventID: existing.EventID, Revision: existing.Revision, SchemaVersion: existing.SchemaVersion, JSONDocument: existing.JSONDocument, Annotations: append([]EditorJSONAnnotation(nil), existing.Annotations...), CommittedAt: existing.CommittedAt, Deduplicated: true}, nil
	}
	if deleted {
		return EditorJSONCommit{}, ErrNotFound
	}
	if input.BaseRevision != revision {
		return EditorJSONCommit{}, ErrVersionConflict
	}
	now, nextRevision, eventID := time.Now().UTC(), revision+1, newUUIDv7String()
	scope := EditorJSONRealtimeScope(input.Document)
	payload, err := json.Marshal(map[string]any{
		"type": EditorJSONSnapshotEventType, "event_id": eventID, "company_id": input.Document.CompanyID,
		"scope": scope, "resource_type": input.Document.ResourceType, "resource_id": input.Document.ResourceID,
		"document_id": input.Document.DocumentID, "resource_revision": nextRevision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID, "reason": "tiptap_json_committed",
	})
	if err != nil {
		return EditorJSONCommit{}, err
	}
	insertOperation := fmt.Sprintf(`insert into %s(company_id,%s,document_id,revision,operation_id,client_id,actor_user_id,base_revision,document_schema_version,document_json,canonical_annotations,event_id,is_delete,committed_timestamp)
		values($1::uuid,$2::uuid,$3,$4,$5,$6,nullif($7,'')::uuid,$8,1,$9::jsonb,$10::jsonb,$11::uuid,false,$12)`, storage.operationsTable, storage.ownerColumn)
	if _, err := tx.ExecContext(ctx, insertOperation, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, nextRevision, input.OperationID, input.ClientID, input.ActorUserID, input.BaseRevision, input.JSONDocument, annotationsRaw, eventID, now); err != nil {
		return EditorJSONCommit{}, err
	}
	insertVersion := fmt.Sprintf(`insert into %s(company_id,%s,document_id,revision,document_schema_version,document_json,canonical_annotations,operation_id,actor_user_id,is_deleted,created_timestamp)
		values($1::uuid,$2::uuid,$3,$4,1,$5::jsonb,$6::jsonb,$7,nullif($8,'')::uuid,false,$9)`, storage.versionsTable, storage.ownerColumn)
	if _, err := tx.ExecContext(ctx, insertVersion, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, nextRevision, input.JSONDocument, annotationsRaw, input.OperationID, input.ActorUserID, now); err != nil {
		return EditorJSONCommit{}, err
	}
	updateCurrent := fmt.Sprintf(`update %s set revision=$4,document_schema_version=1,document_json=$5::jsonb,plain_text=$6,canonical_annotations=$7::jsonb,is_deleted=false,updated_timestamp=$8
		where company_id=$1::uuid and %s=$2::uuid and document_id=$3`, storage.currentTable, storage.ownerColumn)
	if _, err := tx.ExecContext(ctx, updateCurrent, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, nextRevision, input.JSONDocument, postgresEditorDomainPlainText(input.JSONDocument), annotationsRaw, now); err != nil {
		return EditorJSONCommit{}, mapEditorOwnerTextLimitError(err)
	}
	if err := insertRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{EventID: eventID, CompanyID: input.Document.CompanyID, Scope: scope, EventType: EditorJSONSnapshotEventType, ResourceType: input.Document.ResourceType, ResourceID: input.Document.ResourceID, Permission: EntityPermissionEdit, ResourceRevision: nextRevision, Payload: payload}); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONCommit{}, err
	}
	return EditorJSONCommit{OperationID: input.OperationID, EventID: eventID, Revision: nextRevision, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: append(json.RawMessage(nil), input.JSONDocument...), Annotations: append([]EditorJSONAnnotation(nil), input.Annotations...), CommittedAt: now}, nil
}

func deletePostgresEditorDomainDocument(r *PostgresRepo, input EditorJSONDeleteInput) (EditorJSONCommit, error) {
	storage, ok := postgresEditorDomainStorageFor(input.Document)
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
	if err := requirePostgresEditorDomainActiveTx(ctx, tx, input.Document, true); err != nil {
		return EditorJSONCommit{}, err
	}
	if operation, exists, loadErr := loadPostgresEditorDomainOperationTx(ctx, tx, storage, input.Document, input.OperationID); loadErr != nil {
		return EditorJSONCommit{}, loadErr
	} else if exists {
		if !operation.Deleted || operation.ClientID != input.ClientID || operation.BaseRevision != input.BaseRevision {
			return EditorJSONCommit{}, ErrInvalid
		}
		if err := tx.Commit(); err != nil {
			return EditorJSONCommit{}, err
		}
		return EditorJSONCommit{OperationID: operation.OperationID, EventID: operation.EventID, Revision: operation.Revision, SchemaVersion: operation.SchemaVersion, JSONDocument: append(json.RawMessage(nil), operation.JSONDocument...), Annotations: append([]EditorJSONAnnotation(nil), operation.Annotations...), CommittedAt: operation.CommittedAt, Deduplicated: true}, nil
	}
	var revision int64
	var raw, annotationsRaw []byte
	var deleted bool
	lockCurrent := fmt.Sprintf(`select revision,document_json,canonical_annotations,is_deleted from %s where company_id=$1::uuid and %s=$2::uuid and document_id=$3 for update`, storage.currentTable, storage.ownerColumn)
	if err := tx.QueryRowContext(ctx, lockCurrent, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID).Scan(&revision, &raw, &annotationsRaw, &deleted); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return EditorJSONCommit{}, ErrNotFound
		}
		return EditorJSONCommit{}, err
	}
	annotations, err := decodePostgresEditorJSONAnnotations(annotationsRaw)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	if deleted {
		return EditorJSONCommit{}, ErrNotFound
	}
	if revision != input.BaseRevision {
		return EditorJSONCommit{}, ErrVersionConflict
	}
	now, nextRevision, eventID := time.Now().UTC(), revision+1, newUUIDv7String()
	scope := EditorJSONRealtimeScope(input.Document)
	payload, _ := json.Marshal(map[string]any{
		"type": EditorJSONDeletedEventType, "event_id": eventID, "company_id": input.Document.CompanyID,
		"scope": scope, "resource_type": input.Document.ResourceType, "resource_id": input.Document.ResourceID,
		"document_id": input.Document.DocumentID, "resource_revision": nextRevision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID,
	})
	insertOperation := fmt.Sprintf(`insert into %s(company_id,%s,document_id,revision,operation_id,client_id,actor_user_id,base_revision,document_schema_version,document_json,canonical_annotations,event_id,is_delete,committed_timestamp)
		values($1::uuid,$2::uuid,$3,$4,$5,$6,nullif($7,'')::uuid,$8,1,$9::jsonb,$10::jsonb,$11::uuid,true,$12)`, storage.operationsTable, storage.ownerColumn)
	if _, err := tx.ExecContext(ctx, insertOperation, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, nextRevision, input.OperationID, input.ClientID, input.ActorUserID, input.BaseRevision, raw, annotationsRaw, eventID, now); err != nil {
		return EditorJSONCommit{}, err
	}
	insertVersion := fmt.Sprintf(`insert into %s(company_id,%s,document_id,revision,document_schema_version,document_json,canonical_annotations,operation_id,actor_user_id,is_deleted,created_timestamp)
		values($1::uuid,$2::uuid,$3,$4,1,$5::jsonb,$6::jsonb,$7,nullif($8,'')::uuid,true,$9)`, storage.versionsTable, storage.ownerColumn)
	if _, err := tx.ExecContext(ctx, insertVersion, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, nextRevision, raw, annotationsRaw, input.OperationID, input.ActorUserID, now); err != nil {
		return EditorJSONCommit{}, err
	}
	updateCurrent := fmt.Sprintf(`update %s set revision=$4,is_deleted=true,collaboration_epoch=gen_random_uuid(),latest_update_sequence=0,materialized_through_sequence=0,updated_timestamp=$5 where company_id=$1::uuid and %s=$2::uuid and document_id=$3`, storage.currentTable, storage.ownerColumn)
	if _, err := tx.ExecContext(ctx, updateCurrent, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, nextRevision, now); err != nil {
		return EditorJSONCommit{}, err
	}

	if err := insertRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{EventID: eventID, CompanyID: input.Document.CompanyID, Scope: scope, EventType: EditorJSONDeletedEventType, ResourceType: input.Document.ResourceType, ResourceID: input.Document.ResourceID, Permission: EntityPermissionEdit, ResourceRevision: nextRevision, Payload: payload}); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONCommit{}, err
	}
	return EditorJSONCommit{OperationID: input.OperationID, EventID: eventID, Revision: nextRevision, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: append(json.RawMessage(nil), raw...), Annotations: annotations, CommittedAt: now}, nil
}

func listPostgresEditorDomainVersions(r *PostgresRepo, ref EditorJSONDocumentRef, limit int) ([]EditorJSONVersion, error) {
	storage, ok := postgresEditorDomainStorageFor(ref)
	if !ok {
		return nil, ErrInvalid
	}
	query := fmt.Sprintf(`select revision,document_schema_version,document_json,canonical_annotations,operation_id,
		coalesce(actor_user_id::text,''),created_timestamp,is_deleted from %s
		where company_id=$1::uuid and %s=$2::uuid and document_id=$3 order by revision desc limit $4`, storage.versionsTable, storage.ownerColumn)
	rows, err := r.db.Query(query, ref.CompanyID, ref.ResourceID, ref.DocumentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]EditorJSONVersion, 0)
	for rows.Next() {
		var item EditorJSONVersion
		var raw, annotationsRaw []byte
		if err := rows.Scan(&item.Revision, &item.SchemaVersion, &raw, &annotationsRaw, &item.OperationID, &item.ActorUserID, &item.CreatedAt, &item.Deleted); err != nil {
			return nil, err
		}
		item.JSONDocument, err = ValidateMangoTiptapJSON(raw)
		if err != nil {
			return nil, err
		}
		item.Annotations, err = decodePostgresEditorJSONAnnotations(annotationsRaw)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
