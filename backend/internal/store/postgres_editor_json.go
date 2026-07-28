package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

func normalizePostgresEditorJSONRef(ref EditorJSONDocumentRef) (EditorJSONDocumentRef, error) {
	ref, err := NormalizeEditorJSONDocumentRef(ref)
	if err != nil {
		return EditorJSONDocumentRef{}, err
	}
	ref.CompanyID = cleanUUIDText(ref.CompanyID)
	if ref.CompanyID == "" {
		return EditorJSONDocumentRef{}, ErrInvalid
	}
	return ref, nil
}

func (r *PostgresRepo) GetEditorDataFormat(companyID string) (EditorDataFormatGate, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return EditorDataFormatGate{}, ErrInvalid
	}
	gate := DefaultEditorDataFormatGate(companyID)
	err := r.db.QueryRow(`
		select editor_format, migration_state, document_schema_version,
		       expected_document_count, converted_document_count
		from workspace_editor_formats
		where company_id=$1::uuid`, companyID,
	).Scan(&gate.EditorFormat, &gate.MigrationState, &gate.DocumentSchemaVersion, &gate.ExpectedDocumentCount, &gate.ConvertedDocumentCount)
	if errors.Is(err, sql.ErrNoRows) {
		return gate, nil
	}
	if err != nil {
		return EditorDataFormatGate{}, err
	}
	if err := ValidateEditorDataFormatGate(gate); err != nil {
		return EditorDataFormatGate{}, err
	}
	return gate, nil
}

func requirePostgresEditorJSONFormatTx(ctx context.Context, tx *sql.Tx, companyID string) error {
	var format, state string
	var schemaVersion int
	var expected, converted int64
	err := tx.QueryRowContext(ctx, `
		select editor_format, migration_state, document_schema_version,
		       expected_document_count, converted_document_count
		from workspace_editor_formats
		where company_id=$1::uuid`, companyID,
	).Scan(&format, &state, &schemaVersion, &expected, &converted)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrVersionConflict
	}
	if err != nil {
		return err
	}
	if format != EditorFormatTiptapJSON || state != EditorMigrationReady ||
		schemaVersion != MangoTiptapSchemaVersion || expected != converted {
		return ErrVersionConflict
	}
	return nil
}

func (r *PostgresRepo) GetEditorJSONSnapshot(ref EditorJSONDocumentRef) (EditorJSONSnapshot, error) {
	ref, err := normalizePostgresEditorJSONRef(ref)
	if err != nil {
		return EditorJSONSnapshot{}, err
	}
	if active, activeErr := r.postgresEditorDomainActive(ref); activeErr != nil {
		return EditorJSONSnapshot{}, activeErr
	} else if active {
		return getPostgresEditorDomainSnapshot(r, ref)
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
	snapshot := EditorJSONSnapshot{Document: ref, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: append(json.RawMessage(nil), emptyMangoTiptapDocument...), UpdatedTimestamp: time.Now().UTC()}
	var raw, annotationRaw []byte
	err = tx.QueryRowContext(ctx, `
		select revision, document_schema_version, canonical_document, canonical_annotations, is_deleted, updated_timestamp
		from editor_json_documents
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3 and document_id=$4`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID,
	).Scan(&snapshot.Revision, &snapshot.SchemaVersion, &raw, &annotationRaw, &snapshot.Deleted, &snapshot.UpdatedTimestamp)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return EditorJSONSnapshot{}, err
	}
	if err == nil {
		canonical, validateErr := ValidateMangoTiptapJSON(raw)
		if validateErr != nil {
			return EditorJSONSnapshot{}, validateErr
		}
		snapshot.JSONDocument = canonical
		annotations, annotationErr := decodePostgresEditorJSONAnnotations(annotationRaw)
		if annotationErr != nil {
			return EditorJSONSnapshot{}, annotationErr
		}
		snapshot.Annotations = annotations
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONSnapshot{}, err
	}
	return snapshot, nil
}

type postgresEditorJSONOperation struct {
	OperationID   string
	ClientID      string
	BaseRevision  int64
	Revision      int64
	SchemaVersion int
	JSONDocument  json.RawMessage
	Annotations   []EditorJSONAnnotation
	EventID       string
	CommittedAt   time.Time
	Deleted       bool
}

func decodePostgresEditorJSONAnnotations(raw []byte) ([]EditorJSONAnnotation, error) {
	if len(raw) == 0 {
		return []EditorJSONAnnotation{}, nil
	}
	var annotations []EditorJSONAnnotation
	if err := json.Unmarshal(raw, &annotations); err != nil {
		return nil, ErrInvalid
	}
	return NormalizeEditorJSONAnnotations(annotations)
}

func loadPostgresEditorJSONOperationTx(ctx context.Context, tx *sql.Tx, ref EditorJSONDocumentRef, operationID string) (postgresEditorJSONOperation, bool, error) {
	var item postgresEditorJSONOperation
	var raw, annotationRaw []byte
	err := tx.QueryRowContext(ctx, `
		select operation_id, client_id, base_revision, revision, document_schema_version,
		       canonical_document, canonical_annotations, event_id::text, committed_timestamp, is_delete
		from editor_json_operations
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3 and document_id=$4 and operation_id=$5`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, operationID,
	).Scan(&item.OperationID, &item.ClientID, &item.BaseRevision, &item.Revision, &item.SchemaVersion,
		&raw, &annotationRaw, &item.EventID, &item.CommittedAt, &item.Deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return postgresEditorJSONOperation{}, false, nil
	}
	if err != nil {
		return postgresEditorJSONOperation{}, false, err
	}
	canonical, err := ValidateMangoTiptapJSON(raw)
	if err != nil {
		return postgresEditorJSONOperation{}, false, err
	}
	item.JSONDocument = canonical
	item.Annotations, err = decodePostgresEditorJSONAnnotations(annotationRaw)
	if err != nil {
		return postgresEditorJSONOperation{}, false, err
	}
	return item, true, nil
}

func (r *PostgresRepo) CommitEditorJSONDocument(input EditorJSONCommitInput) (EditorJSONCommit, error) {
	input, err := NormalizeEditorJSONCommit(input)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	input.Document, err = normalizePostgresEditorJSONRef(input.Document)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	if active, activeErr := r.postgresEditorDomainActive(input.Document); activeErr != nil {
		return EditorJSONCommit{}, activeErr
	} else if active {
		return commitPostgresEditorDomainDocument(r, input)
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
	if _, err := tx.ExecContext(ctx, `
		insert into editor_json_documents (
			company_id, resource_type, resource_id, document_id, document_schema_version,
			revision, canonical_document, is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3, $4, 1, 0, $5::jsonb, false, now(), now())
		on conflict (company_id, resource_type, resource_id, document_id) do nothing`,
		input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID,
		input.Document.DocumentID, emptyMangoTiptapDocument,
	); err != nil {
		return EditorJSONCommit{}, mapEditorOwnerTextLimitError(err)
	}
	var revision int64
	var deleted bool
	if err := tx.QueryRowContext(ctx, `
		select revision, is_deleted
		from editor_json_documents
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3 and document_id=$4
		for update`, input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID, input.Document.DocumentID,
	).Scan(&revision, &deleted); err != nil {
		return EditorJSONCommit{}, err
	}
	if existing, found, loadErr := loadPostgresEditorJSONOperationTx(ctx, tx, input.Document, input.OperationID); loadErr != nil {
		return EditorJSONCommit{}, loadErr
	} else if found {
		if existing.Deleted || existing.ClientID != input.ClientID || existing.BaseRevision != input.BaseRevision || !bytes.Equal(existing.JSONDocument, input.JSONDocument) || !editorJSONAnnotationsEqual(existing.Annotations, input.Annotations) {
			return EditorJSONCommit{}, ErrInvalid
		}
		if err := tx.Commit(); err != nil {
			return EditorJSONCommit{}, err
		}
		return EditorJSONCommit{
			OperationID: existing.OperationID, EventID: existing.EventID, Revision: existing.Revision,
			SchemaVersion: existing.SchemaVersion, JSONDocument: existing.JSONDocument,
			Annotations: append([]EditorJSONAnnotation(nil), existing.Annotations...),
			CommittedAt: existing.CommittedAt, Deduplicated: true,
		}, nil
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
	if _, err := tx.ExecContext(ctx, `
		insert into editor_json_operations (
			company_id, resource_type, resource_id, document_id, revision, operation_id,
			client_id, actor_user_id, base_revision, document_schema_version,
			canonical_document, canonical_annotations, event_id, is_delete, committed_timestamp
		) values ($1::uuid,$2,$3,$4,$5,$6,$7,nullif($8,'')::uuid,$9,1,$10::jsonb,$11::jsonb,$12::uuid,false,$13)`,
		input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID, input.Document.DocumentID,
		nextRevision, input.OperationID, input.ClientID, input.ActorUserID, input.BaseRevision,
		input.JSONDocument, annotationsRaw, eventID, now,
	); err != nil {
		return EditorJSONCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_json_versions (
			company_id, resource_type, resource_id, document_id, revision, document_schema_version,
			canonical_document, canonical_annotations, operation_id, actor_user_id, is_deleted, created_timestamp
		) values ($1::uuid,$2,$3,$4,$5,1,$6::jsonb,$7::jsonb,$8,nullif($9,'')::uuid,false,$10)`,
		input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID, input.Document.DocumentID,
		nextRevision, input.JSONDocument, annotationsRaw, input.OperationID, input.ActorUserID, now,
	); err != nil {
		return EditorJSONCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		update editor_json_documents
		set revision=$5, document_schema_version=1, canonical_document=$6::jsonb,
		    canonical_annotations=$7::jsonb, is_deleted=false, updated_timestamp=$8
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3 and document_id=$4`,
		input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID,
		input.Document.DocumentID, nextRevision, input.JSONDocument, annotationsRaw, now,
	); err != nil {
		return EditorJSONCommit{}, mapEditorOwnerTextLimitError(err)
	}
	if err := insertRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{
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
	return EditorJSONCommit{
		OperationID: input.OperationID, EventID: eventID, Revision: nextRevision,
		SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: append(json.RawMessage(nil), input.JSONDocument...),
		Annotations: append([]EditorJSONAnnotation(nil), input.Annotations...), CommittedAt: now,
	}, nil
}

func (r *PostgresRepo) DeleteEditorJSONDocument(input EditorJSONDeleteInput) (EditorJSONCommit, error) {
	ref, err := normalizePostgresEditorJSONRef(input.Document)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	input.Document = ref
	input.OperationID, input.ClientID, input.ActorUserID = strings.TrimSpace(input.OperationID), strings.TrimSpace(input.ClientID), strings.TrimSpace(input.ActorUserID)
	if input.OperationID == "" || input.ClientID == "" || input.BaseRevision < 0 {
		return EditorJSONCommit{}, ErrInvalid
	}
	if active, activeErr := r.postgresEditorDomainActive(input.Document); activeErr != nil {
		return EditorJSONCommit{}, activeErr
	} else if active {
		return deletePostgresEditorDomainDocument(r, input)
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	defer tx.Rollback()
	if err := requirePostgresEditorJSONFormatTx(ctx, tx, ref.CompanyID); err != nil {
		return EditorJSONCommit{}, err
	}
	if operation, exists, loadErr := loadPostgresEditorJSONOperationTx(ctx, tx, ref, input.OperationID); loadErr != nil {
		return EditorJSONCommit{}, loadErr
	} else if exists {
		if !operation.Deleted || operation.ClientID != input.ClientID || operation.BaseRevision != input.BaseRevision {
			return EditorJSONCommit{}, ErrInvalid
		}
		return EditorJSONCommit{
			OperationID: operation.OperationID, EventID: operation.EventID, Revision: operation.Revision,
			SchemaVersion: operation.SchemaVersion, JSONDocument: append(json.RawMessage(nil), operation.JSONDocument...),
			Annotations: append([]EditorJSONAnnotation(nil), operation.Annotations...),
			CommittedAt: operation.CommittedAt, Deduplicated: true,
		}, nil
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_json_documents (
			company_id, resource_type, resource_id, document_id, document_schema_version,
			revision, canonical_document, is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3, $4, 1, 0, $5::jsonb, false, now(), now())
		on conflict (company_id, resource_type, resource_id, document_id) do nothing`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, emptyMangoTiptapDocument,
	); err != nil {
		return EditorJSONCommit{}, mapEditorOwnerTextLimitError(err)
	}
	var revision int64
	var raw, annotationRaw []byte
	var deleted bool
	if err := tx.QueryRowContext(ctx, `
		select revision, canonical_document, canonical_annotations, is_deleted from editor_json_documents
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3 and document_id=$4 for update`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID,
	).Scan(&revision, &raw, &annotationRaw, &deleted); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return EditorJSONCommit{}, ErrNotFound
		}
		return EditorJSONCommit{}, err
	}
	annotations, err := decodePostgresEditorJSONAnnotations(annotationRaw)
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
	payload, _ := json.Marshal(map[string]any{
		"type": EditorJSONDeletedEventType, "event_id": eventID, "company_id": ref.CompanyID,
		"scope": EditorJSONRealtimeScope(ref), "resource_type": ref.ResourceType, "resource_id": ref.ResourceID,
		"document_id": ref.DocumentID, "resource_revision": nextRevision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID,
	})
	if _, err := tx.ExecContext(ctx, `
		insert into editor_json_operations (
			company_id,resource_type,resource_id,document_id,revision,operation_id,client_id,
			actor_user_id,base_revision,document_schema_version,canonical_document,canonical_annotations,event_id,is_delete,committed_timestamp
		) values ($1::uuid,$2,$3,$4,$5,$6,$7,nullif($8,'')::uuid,$9,1,$10::jsonb,$11::jsonb,$12::uuid,true,$13)`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, nextRevision, input.OperationID,
		input.ClientID, input.ActorUserID, input.BaseRevision, raw, annotationRaw, eventID, now,
	); err != nil {
		return EditorJSONCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_json_versions (
			company_id,resource_type,resource_id,document_id,revision,document_schema_version,
			canonical_document,canonical_annotations,operation_id,actor_user_id,is_deleted,created_timestamp
		) values ($1::uuid,$2,$3,$4,$5,1,$6::jsonb,$7::jsonb,$8,nullif($9,'')::uuid,true,$10)`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, nextRevision, raw, annotationRaw,
		input.OperationID, input.ActorUserID, now,
	); err != nil {
		return EditorJSONCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		update editor_json_documents set revision=$5,is_deleted=true,updated_timestamp=$6
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3 and document_id=$4`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, nextRevision, now,
	); err != nil {
		return EditorJSONCommit{}, err
	}
	if ref.ResourceType == EntityTypeNode || ref.ResourceType == EntityTypeProject || ref.ResourceType == EntityTypeLogicGate {
		if err := deletePostgresEditorProjectionTx(ctx, tx, EditorDocumentRef{
			CompanyID: ref.CompanyID, ResourceType: ref.ResourceType,
			ResourceID: ref.ResourceID, DocumentID: ref.DocumentID,
		}, now); err != nil {
			return EditorJSONCommit{}, err
		}
	}
	if err := insertRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{
		EventID: eventID, CompanyID: ref.CompanyID, Scope: EditorJSONRealtimeScope(ref),
		EventType: EditorJSONDeletedEventType, ResourceType: ref.ResourceType, ResourceID: ref.ResourceID,
		Permission: EntityPermissionEdit, ResourceRevision: nextRevision, Payload: payload,
	}); err != nil {
		return EditorJSONCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONCommit{}, err
	}
	return EditorJSONCommit{
		OperationID: input.OperationID, EventID: eventID, Revision: nextRevision,
		SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: append(json.RawMessage(nil), raw...),
		Annotations: annotations, CommittedAt: now,
	}, nil
}

func (r *PostgresRepo) ListEditorJSONVersions(ref EditorJSONDocumentRef, limit int) ([]EditorJSONVersion, error) {
	ref, err := normalizePostgresEditorJSONRef(ref)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if active, activeErr := r.postgresEditorDomainActive(ref); activeErr != nil {
		return nil, activeErr
	} else if active {
		return listPostgresEditorDomainVersions(r, ref, limit)
	}
	rows, err := r.db.Query(`
		select revision,document_schema_version,canonical_document,canonical_annotations,operation_id,
		       coalesce(actor_user_id::text,''),created_timestamp,is_deleted
		from editor_json_versions
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3 and document_id=$4
		order by revision desc limit $5`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]EditorJSONVersion, 0)
	for rows.Next() {
		var item EditorJSONVersion
		var raw, annotationRaw []byte
		if err := rows.Scan(&item.Revision, &item.SchemaVersion, &raw, &annotationRaw, &item.OperationID, &item.ActorUserID, &item.CreatedAt, &item.Deleted); err != nil {
			return nil, err
		}
		item.JSONDocument, err = ValidateMangoTiptapJSON(raw)
		if err != nil {
			return nil, err
		}
		item.Annotations, err = decodePostgresEditorJSONAnnotations(annotationRaw)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
