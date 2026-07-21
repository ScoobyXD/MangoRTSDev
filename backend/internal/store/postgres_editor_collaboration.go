package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type postgresEditorCollaborationDocument struct {
	Ref              EditorDocumentRef
	Revision         int64
	CanonicalHTML    string
	Deleted          bool
	UpdatedTimestamp time.Time
}

type postgresEditorCollaborationOperation struct {
	OperationID      string
	ClientID         string
	ActorUserID      string
	BaseRevision     int64
	Patch            EditorHTMLPatch
	EventID          string
	Revision         int64
	CommittedAt      time.Time
	RequiresSnapshot bool
	Tombstone        bool
}

func normalizePostgresEditorDocumentRef(ref EditorDocumentRef) (EditorDocumentRef, error) {
	ref, err := NormalizeEditorDocumentRef(ref)
	if err != nil {
		return EditorDocumentRef{}, err
	}
	ref.CompanyID = cleanUUIDText(ref.CompanyID)
	ref.ResourceID = cleanUUIDText(ref.ResourceID)
	ref.DocumentID = cleanUUIDText(ref.DocumentID)
	if ref.CompanyID == "" || ref.ResourceID == "" || ref.DocumentID == "" {
		return EditorDocumentRef{}, ErrInvalid
	}
	return ref, nil
}

func (r *PostgresRepo) GetEditorCollaborationSnapshot(ref EditorDocumentRef) (EditorCollaborationSnapshot, error) {
	ref, err := normalizePostgresEditorDocumentRef(ref)
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	defer tx.Rollback()
	if exists, queryErr := postgresEditorResourceExistsTx(ctx, tx, ref); queryErr != nil {
		return EditorCollaborationSnapshot{}, queryErr
	} else if !exists {
		return EditorCollaborationSnapshot{}, ErrNotFound
	}
	document, found, err := loadPostgresEditorCollaborationDocumentTx(ctx, tx, ref, false)
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	if !found {
		html, readErr := postgresInitialEditorDocumentHTMLTx(ctx, tx, ref)
		if readErr != nil {
			return EditorCollaborationSnapshot{}, readErr
		}
		document = postgresEditorCollaborationDocument{Ref: ref, CanonicalHTML: html, UpdatedTimestamp: time.Now().UTC()}
	}
	snapshot := postgresEditorCollaborationSnapshot(document)
	if err := tx.Commit(); err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	return snapshot, nil
}

func (r *PostgresRepo) CommitEditorCollaborationOperation(input EditorCollaborationOperationInput) (EditorCollaborationCommit, error) {
	input, patchBytes, err := NormalizeEditorCollaborationOperation(input)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	input.Document, err = normalizePostgresEditorDocumentRef(input.Document)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	defer tx.Rollback()
	if exists, queryErr := postgresEditorResourceExistsTx(ctx, tx, input.Document); queryErr != nil {
		return EditorCollaborationCommit{}, queryErr
	} else if !exists {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	initialHTML, err := postgresInitialEditorDocumentHTMLTx(ctx, tx, input.Document)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_documents (
			company_id, resource_type, resource_id, document_id, revision,
			canonical_html, is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, 0, $5, false, now(), now())
		on conflict (company_id, resource_type, resource_id, document_id) do nothing`,
		input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID, input.Document.DocumentID, initialHTML,
	); err != nil {
		return EditorCollaborationCommit{}, err
	}
	document, _, err := loadPostgresEditorCollaborationDocumentTx(ctx, tx, input.Document, true)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if document.Deleted {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	if existing, found, loadErr := loadPostgresEditorOperationByIDTx(ctx, tx, input.Document, input.OperationID); loadErr != nil {
		return EditorCollaborationCommit{}, loadErr
	} else if found {
		concurrent, concurrentErr := loadPostgresConcurrentEditorOperationsTx(ctx, tx, input.Document, existing.BaseRevision, existing.Revision)
		if concurrentErr != nil {
			return EditorCollaborationCommit{}, concurrentErr
		}
		if err := tx.Commit(); err != nil {
			return EditorCollaborationCommit{}, err
		}
		return EditorCollaborationCommit{
			OperationID: existing.OperationID, EventID: existing.EventID, Revision: existing.Revision,
			CommittedAt: existing.CommittedAt, Deduplicated: true, Patch: existing.Patch,
			ConcurrentOperations: concurrent,
		}, nil
	}
	if input.BaseRevision > document.Revision {
		return EditorCollaborationCommit{}, ErrVersionConflict
	}
	var concurrent []EditorCollaborationRevisionOperation
	input.Patch, concurrent, err = transformPostgresEditorPatchTx(ctx, tx, document, input.BaseRevision, input.Patch)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	patchBytes, err = json.Marshal(input.Patch)
	if err != nil || len(patchBytes) > EditorCollaborationOperationMaxBytes {
		return EditorCollaborationCommit{}, ErrInvalid
	}
	html, err := ApplyEditorHTMLPatch(document.CanonicalHTML, input.Patch)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if len([]byte(html)) > EditorCollaborationDocumentMaxBytes {
		return EditorCollaborationCommit{}, ErrEditorDocumentTooLarge
	}

	now := time.Now().UTC()
	revision := document.Revision + 1
	eventID := newUUIDv7String()
	scope := EditorRealtimeScope(input.Document)
	payload, err := json.Marshal(map[string]any{
		"type": EditorCollaborationEventType, "event_id": eventID, "company_id": input.Document.CompanyID,
		"scope": scope, "resource_type": input.Document.ResourceType, "resource_id": input.Document.ResourceID,
		"document_id": input.Document.DocumentID, "resource_revision": revision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID, "patch": input.Patch,
	})
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_operations (
			company_id, resource_type, resource_id, document_id, revision,
			operation_id, client_id, actor_user_id, base_revision, patch,
			requires_snapshot, event_id, is_tombstone, committed_timestamp
		) values (
			$1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, nullif($8, '')::uuid,
			$9, $10::jsonb, false, $11::uuid, false, $12
		)`, input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID,
		input.Document.DocumentID, revision, input.OperationID, input.ClientID, input.ActorUserID,
		input.BaseRevision, patchBytes, eventID, now,
	); err != nil {
		return EditorCollaborationCommit{}, err
	}
	if err := insertRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{
		EventID: eventID, CompanyID: input.Document.CompanyID, Scope: scope, EventType: EditorCollaborationEventType,
		ResourceType: input.Document.ResourceType, ResourceID: input.Document.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: revision, Payload: payload,
	}); err != nil {
		return EditorCollaborationCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		update editor_collaboration_documents
		set revision=$5, canonical_html=$6, updated_timestamp=$7
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid`,
		input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID, input.Document.DocumentID,
		revision, html, now,
	); err != nil {
		return EditorCollaborationCommit{}, err
	}
	if err := materializePostgresEditorProjectionTx(ctx, tx, input.Document, html, revision, now); err != nil {
		return EditorCollaborationCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorCollaborationCommit{}, err
	}
	return EditorCollaborationCommit{
		OperationID: input.OperationID, EventID: eventID, Revision: revision, CommittedAt: now,
		Patch: input.Patch, PreviousHTML: document.CanonicalHTML, CommittedHTML: html, ConcurrentOperations: concurrent,
	}, nil
}

func replacePostgresEditorCollaborationSnapshotTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef, html, operationID, clientID, actorUserID string, now time.Time) error {
	ref, err := normalizePostgresEditorDocumentRef(ref)
	if err != nil {
		return err
	}
	document, found, err := loadPostgresEditorCollaborationDocumentTx(ctx, tx, ref, true)
	if err != nil {
		return err
	}
	if !found {
		initial, readErr := postgresInitialEditorDocumentHTMLTx(ctx, tx, ref)
		if readErr != nil {
			return readErr
		}
		document = postgresEditorCollaborationDocument{Ref: ref, CanonicalHTML: initial}
	}
	if len([]byte(html)) > EditorCollaborationDocumentMaxBytes {
		return ErrEditorDocumentTooLarge
	}
	if editorBytesContainSensitiveContent([]byte(html)) {
		return ErrInvalid
	}
	revision := document.Revision + 1
	eventID, scope := newUUIDv7String(), EditorRealtimeScope(ref)
	payload, err := json.Marshal(map[string]any{
		"type": EditorCollaborationSnapshotRequiredEventType, "event_id": eventID, "company_id": ref.CompanyID,
		"scope": scope, "resource_type": ref.ResourceType, "resource_id": ref.ResourceID,
		"document_id": ref.DocumentID, "resource_revision": revision, "committed_at": now,
		"operation_id": operationID, "client_id": clientID, "reason": "canonical_snapshot_replaced",
	})
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_documents (
			company_id, resource_type, resource_id, document_id, revision, canonical_html,
			is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, false, $7, $7)
		on conflict (company_id, resource_type, resource_id, document_id) do update set
			revision=excluded.revision, canonical_html=excluded.canonical_html,
			is_deleted=false, updated_timestamp=excluded.updated_timestamp`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, html, now,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_operations (
			company_id, resource_type, resource_id, document_id, revision, operation_id, client_id,
			actor_user_id, base_revision, patch, requires_snapshot, event_id, is_tombstone, committed_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, nullif($8, '')::uuid,
			$9, '{"start_utf8":0,"delete_utf8":0,"insert":""}'::jsonb, true, $10::uuid, false, $11)`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, operationID, clientID,
		actorUserID, document.Revision, eventID, now,
	); err != nil {
		return err
	}
	if err := insertRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{
		EventID: eventID, CompanyID: ref.CompanyID, Scope: scope, EventType: EditorCollaborationSnapshotRequiredEventType,
		ResourceType: ref.ResourceType, ResourceID: ref.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: revision, Payload: payload,
	}); err != nil {
		return err
	}
	return materializePostgresEditorProjectionTx(ctx, tx, ref, html, revision, now)
}

func tombstonePostgresEditorCollaborationDocumentTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef, operationID, clientID, actorUserID string, now time.Time) error {
	ref, err := normalizePostgresEditorDocumentRef(ref)
	if err != nil {
		return err
	}
	document, found, err := loadPostgresEditorCollaborationDocumentTx(ctx, tx, ref, true)
	if err != nil {
		return err
	}
	if !found {
		initial, readErr := postgresInitialEditorDocumentHTMLTx(ctx, tx, ref)
		if readErr != nil {
			return readErr
		}
		document = postgresEditorCollaborationDocument{Ref: ref, CanonicalHTML: initial}
	}
	if document.Deleted {
		return nil
	}
	revision := document.Revision + 1
	eventID, scope := newUUIDv7String(), EditorRealtimeScope(ref)
	payload, err := json.Marshal(map[string]any{
		"type": EditorCollaborationTombstoneEventType, "event_id": eventID, "company_id": ref.CompanyID,
		"scope": scope, "resource_type": ref.ResourceType, "resource_id": ref.ResourceID,
		"document_id": ref.DocumentID, "resource_revision": revision, "committed_at": now,
		"operation_id": operationID, "client_id": clientID,
	})
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_documents (
			company_id, resource_type, resource_id, document_id, revision, canonical_html,
			is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, true, $7, $7)
		on conflict (company_id, resource_type, resource_id, document_id) do update set
			revision=excluded.revision, is_deleted=true, updated_timestamp=excluded.updated_timestamp`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, document.CanonicalHTML, now,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_operations (
			company_id, resource_type, resource_id, document_id, revision, operation_id, client_id,
			actor_user_id, base_revision, patch, requires_snapshot, event_id, is_tombstone, committed_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, nullif($8, '')::uuid,
			$9, '{"start_utf8":0,"delete_utf8":0,"insert":""}'::jsonb, true, $10::uuid, true, $11)`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, operationID, clientID,
		actorUserID, document.Revision, eventID, now,
	); err != nil {
		return err
	}
	if err := insertRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{
		EventID: eventID, CompanyID: ref.CompanyID, Scope: scope, EventType: EditorCollaborationTombstoneEventType,
		ResourceType: ref.ResourceType, ResourceID: ref.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: revision, Payload: payload,
	}); err != nil {
		return err
	}
	return deletePostgresEditorProjectionTx(ctx, tx, ref, now)
}

func (r *PostgresRepo) UpdateEditorCollaborationMetadata(input EditorCollaborationMetadataInput) (EditorCollaborationMetadataCommit, error) {
	input, err := NormalizeEditorCollaborationMetadata(input)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	input.Document, err = normalizePostgresEditorDocumentRef(input.Document)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	defer tx.Rollback()
	if exists, queryErr := postgresEditorResourceExistsTx(ctx, tx, input.Document); queryErr != nil {
		return EditorCollaborationMetadataCommit{}, queryErr
	} else if !exists {
		return EditorCollaborationMetadataCommit{}, ErrNotFound
	}
	document, found, err := loadPostgresEditorCollaborationDocumentTx(ctx, tx, input.Document, true)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	html := ""
	if found {
		if document.Deleted {
			return EditorCollaborationMetadataCommit{}, ErrNotFound
		}
		html = document.CanonicalHTML
	} else {
		html, err = postgresInitialEditorDocumentHTMLTx(ctx, tx, input.Document)
		if err != nil {
			return EditorCollaborationMetadataCommit{}, err
		}
	}
	information, err := editorProjectionInformationWithMetadata(input, html)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	now := time.Now().UTC()
	var revision int64
	switch input.Document.ResourceType {
	case EntityTypeNode:
		err = tx.QueryRowContext(ctx, `
			insert into node_projection_table (company_id, node_id, information_id, type, information, is_deleted, revision, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, false, 1, $5, $5)
			on conflict (company_id, node_id, information_id) do update set
				information=excluded.information, is_deleted=false, revision=node_projection_table.revision+1, updated_timestamp=excluded.updated_timestamp
			returning revision`, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, information, now).Scan(&revision)
	case EntityTypeLogicGate:
		err = tx.QueryRowContext(ctx, `
			insert into logic_gate_projection_table (company_id, logic_gate_id, information_id, type, information, is_deleted, revision, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, false, 1, $5, $5)
			on conflict (company_id, logic_gate_id, information_id) do update set
				information=excluded.information, is_deleted=false, revision=logic_gate_projection_table.revision+1, updated_timestamp=excluded.updated_timestamp
			returning revision`, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, information, now).Scan(&revision)
	case EntityTypeProject:
		_, err = tx.ExecContext(ctx, `
			insert into project_projection_table (company_id, project_id, information_id, type, information, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, $5, $5)
			on conflict (company_id, project_id, information_id) do update set information=excluded.information, updated_timestamp=excluded.updated_timestamp`,
			input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, information, now)
		revision = 1
	default:
		return EditorCollaborationMetadataCommit{}, ErrInvalid
	}
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	return EditorCollaborationMetadataCommit{ProjectionRevision: revision, UpdatedTimestamp: now}, nil
}

func (r *PostgresRepo) UpdateEditorJSONMetadata(input EditorCollaborationMetadataInput) (EditorCollaborationMetadataCommit, error) {
	input, err := NormalizeEditorCollaborationMetadata(input)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	input.Document, err = normalizePostgresEditorDocumentRef(input.Document)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	defer tx.Rollback()
	if err := requirePostgresEditorJSONFormatTx(ctx, tx, input.Document.CompanyID); err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	if exists, queryErr := postgresEditorResourceExistsTx(ctx, tx, input.Document); queryErr != nil {
		return EditorCollaborationMetadataCommit{}, queryErr
	} else if !exists {
		return EditorCollaborationMetadataCommit{}, ErrNotFound
	}
	information, err := editorProjectionInformationWithMetadata(input, "")
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	now := time.Now().UTC()
	var revision int64
	switch input.Document.ResourceType {
	case EntityTypeNode:
		err = tx.QueryRowContext(ctx, `
			insert into node_projection_table (company_id, node_id, information_id, type, information, is_deleted, revision, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, false, 1, $5, $5)
			on conflict (company_id, node_id, information_id) do update set
				information=excluded.information, is_deleted=false, revision=node_projection_table.revision+1, updated_timestamp=excluded.updated_timestamp
			returning revision`, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, information, now).Scan(&revision)
	case EntityTypeLogicGate:
		err = tx.QueryRowContext(ctx, `
			insert into logic_gate_projection_table (company_id, logic_gate_id, information_id, type, information, is_deleted, revision, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, false, 1, $5, $5)
			on conflict (company_id, logic_gate_id, information_id) do update set
				information=excluded.information, is_deleted=false, revision=logic_gate_projection_table.revision+1, updated_timestamp=excluded.updated_timestamp
			returning revision`, input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, information, now).Scan(&revision)
	case EntityTypeProject:
		_, err = tx.ExecContext(ctx, `
			insert into project_projection_table (company_id, project_id, information_id, type, information, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, $5, $5)
			on conflict (company_id, project_id, information_id) do update set information=excluded.information, updated_timestamp=excluded.updated_timestamp`,
			input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, information, now)
		revision = 1
	default:
		return EditorCollaborationMetadataCommit{}, ErrInvalid
	}
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	return EditorCollaborationMetadataCommit{ProjectionRevision: revision, UpdatedTimestamp: now}, nil
}

func (r *PostgresRepo) DeleteEditorCollaborationDocument(input EditorCollaborationDeleteInput) (EditorCollaborationCommit, error) {
	ref, err := normalizePostgresEditorDocumentRef(input.Document)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	input.Document = ref
	input.OperationID = strings.TrimSpace(input.OperationID)
	input.ClientID = strings.TrimSpace(input.ClientID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.OperationID == "" || input.ClientID == "" || len(input.OperationID) > 160 || len(input.ClientID) > 160 {
		return EditorCollaborationCommit{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	defer tx.Rollback()
	if exists, queryErr := postgresEditorResourceExistsTx(ctx, tx, ref); queryErr != nil {
		return EditorCollaborationCommit{}, queryErr
	} else if !exists {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	initialHTML, err := postgresInitialEditorDocumentHTMLTx(ctx, tx, ref)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_documents (
			company_id, resource_type, resource_id, document_id, revision, canonical_html,
			is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, 0, $5, false, now(), now())
		on conflict (company_id, resource_type, resource_id, document_id) do nothing`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, initialHTML,
	); err != nil {
		return EditorCollaborationCommit{}, err
	}
	document, _, err := loadPostgresEditorCollaborationDocumentTx(ctx, tx, ref, true)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if existing, found, loadErr := loadPostgresEditorOperationByIDTx(ctx, tx, ref, input.OperationID); loadErr != nil {
		return EditorCollaborationCommit{}, loadErr
	} else if found {
		if err := tx.Commit(); err != nil {
			return EditorCollaborationCommit{}, err
		}
		return EditorCollaborationCommit{
			OperationID: existing.OperationID, EventID: existing.EventID, Revision: existing.Revision,
			CommittedAt: existing.CommittedAt, Deduplicated: true,
		}, nil
	}
	if document.Deleted {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	now := time.Now().UTC()
	if err := tombstonePostgresEditorCollaborationDocumentTx(ctx, tx, ref, input.OperationID, input.ClientID, input.ActorUserID, now); err != nil {
		return EditorCollaborationCommit{}, err
	}
	existing, _, err := loadPostgresEditorOperationByIDTx(ctx, tx, ref, input.OperationID)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorCollaborationCommit{}, err
	}
	return EditorCollaborationCommit{
		OperationID: input.OperationID, EventID: existing.EventID, Revision: existing.Revision, CommittedAt: now,
	}, nil
}

func postgresEditorResourceExistsTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef) (bool, error) {
	table, idColumn := "", ""
	switch ref.ResourceType {
	case EntityTypeNode:
		table, idColumn = "nodes", "node_id"
	case EntityTypeLogicGate:
		table, idColumn = "logic_gates", "logic_gate_id"
	case EntityTypeProject:
		table, idColumn = "projects", "project_id"
	default:
		return false, ErrInvalid
	}
	var exists bool
	err := tx.QueryRowContext(ctx, fmt.Sprintf(`select exists(select 1 from %s where company_id=$1::uuid and %s=$2::uuid)`, table, idColumn), ref.CompanyID, ref.ResourceID).Scan(&exists)
	return exists, err
}

func loadPostgresEditorCollaborationDocumentTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef, forUpdate bool) (postgresEditorCollaborationDocument, bool, error) {
	query := `select revision, canonical_html, is_deleted, updated_timestamp
		from editor_collaboration_documents
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid`
	if forUpdate {
		query += " for update"
	}
	var document postgresEditorCollaborationDocument
	err := tx.QueryRowContext(ctx, query, ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID).Scan(
		&document.Revision, &document.CanonicalHTML, &document.Deleted, &document.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return postgresEditorCollaborationDocument{}, false, nil
	}
	if err != nil {
		return postgresEditorCollaborationDocument{}, false, err
	}
	document.Ref, document.UpdatedTimestamp = ref, document.UpdatedTimestamp.UTC()
	return document, true, nil
}

func loadPostgresEditorOperationByIDTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef, operationID string) (postgresEditorCollaborationOperation, bool, error) {
	var item postgresEditorCollaborationOperation
	var actor sql.NullString
	var encoded []byte
	err := tx.QueryRowContext(ctx, `
		select operation_id, client_id, actor_user_id::text, base_revision, patch, event_id::text,
			revision, committed_timestamp, requires_snapshot, is_tombstone
		from editor_collaboration_operations
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid and operation_id=$5`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, operationID,
	).Scan(&item.OperationID, &item.ClientID, &actor, &item.BaseRevision, &encoded, &item.EventID,
		&item.Revision, &item.CommittedAt, &item.RequiresSnapshot, &item.Tombstone)
	if errors.Is(err, sql.ErrNoRows) {
		return postgresEditorCollaborationOperation{}, false, nil
	}
	if err != nil {
		return postgresEditorCollaborationOperation{}, false, err
	}
	if actor.Valid {
		item.ActorUserID = actor.String
	}
	item.CommittedAt = item.CommittedAt.UTC()
	if err := json.Unmarshal(encoded, &item.Patch); err != nil {
		return postgresEditorCollaborationOperation{}, false, err
	}
	return item, true, nil
}

func loadPostgresConcurrentEditorOperationsTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef, baseRevision, beforeRevision int64) ([]EditorCollaborationRevisionOperation, error) {
	rows, err := tx.QueryContext(ctx, `
		select revision, operation_id, client_id, patch
		from editor_collaboration_operations
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid
		  and revision > $5 and revision < $6 and not requires_snapshot and not is_tombstone
		order by revision`, ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, baseRevision, beforeRevision)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	operations := make([]EditorCollaborationRevisionOperation, 0)
	for rows.Next() {
		var operation EditorCollaborationRevisionOperation
		var encoded []byte
		if err := rows.Scan(&operation.Revision, &operation.OperationID, &operation.ClientID, &encoded); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(encoded, &operation.Patch); err != nil {
			return nil, err
		}
		operations = append(operations, operation)
	}
	return operations, rows.Err()
}

func transformPostgresEditorPatchTx(ctx context.Context, tx *sql.Tx, document postgresEditorCollaborationDocument, baseRevision int64, input EditorHTMLPatch) (EditorHTMLPatch, []EditorCollaborationRevisionOperation, error) {
	rows, err := tx.QueryContext(ctx, `
		select revision, operation_id, client_id, patch, requires_snapshot, is_tombstone
		from editor_collaboration_operations
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid
		  and revision > $5 and revision <= $6
		order by revision`, document.Ref.CompanyID, document.Ref.ResourceType, document.Ref.ResourceID,
		document.Ref.DocumentID, baseRevision, document.Revision)
	if err != nil {
		return EditorHTMLPatch{}, nil, err
	}
	defer rows.Close()
	transformed := input
	concurrent := make([]EditorCollaborationRevisionOperation, 0)
	for rows.Next() {
		var operation EditorCollaborationRevisionOperation
		var encoded []byte
		var requiresSnapshot, tombstone bool
		if err := rows.Scan(&operation.Revision, &operation.OperationID, &operation.ClientID, &encoded, &requiresSnapshot, &tombstone); err != nil {
			return EditorHTMLPatch{}, nil, err
		}
		if requiresSnapshot || tombstone {
			return EditorHTMLPatch{}, nil, ErrVersionConflict
		}
		if err := json.Unmarshal(encoded, &operation.Patch); err != nil {
			return EditorHTMLPatch{}, nil, err
		}
		concurrent = append(concurrent, operation)
		transformed = TransformEditorHTMLPatch(operation.Patch, transformed, true)
	}
	return transformed, concurrent, rows.Err()
}

func postgresEditorCollaborationSnapshot(document postgresEditorCollaborationDocument) EditorCollaborationSnapshot {
	return EditorCollaborationSnapshot{
		Document: document.Ref, Revision: document.Revision, HTML: document.CanonicalHTML,
		ETag:    EditorCollaborationSnapshotETag(document.Revision, document.CanonicalHTML),
		Deleted: document.Deleted, UpdatedTimestamp: document.UpdatedTimestamp,
	}
}

func postgresInitialEditorDocumentHTMLTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef) (string, error) {
	query := ""
	switch ref.ResourceType {
	case EntityTypeNode:
		query = `select information from node_projection_table where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid and is_deleted=false`
	case EntityTypeLogicGate:
		query = `select information from logic_gate_projection_table where company_id=$1::uuid and logic_gate_id=$2::uuid and information_id=$3::uuid and is_deleted=false`
	case EntityTypeProject:
		query = `select information from project_projection_table where company_id=$1::uuid and project_id=$2::uuid and information_id=$3::uuid`
	default:
		return "", ErrInvalid
	}
	var information string
	err := tx.QueryRowContext(ctx, query, ref.CompanyID, ref.ResourceID, ref.DocumentID).Scan(&information)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return editorDocumentHTMLFromProjectionInformation(information), nil
}

func postgresCurrentEditorProjectionInformationTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef) (string, error) {
	query := ""
	switch ref.ResourceType {
	case EntityTypeNode:
		query = `select information from node_projection_table where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid`
	case EntityTypeLogicGate:
		query = `select information from logic_gate_projection_table where company_id=$1::uuid and logic_gate_id=$2::uuid and information_id=$3::uuid`
	case EntityTypeProject:
		query = `select information from project_projection_table where company_id=$1::uuid and project_id=$2::uuid and information_id=$3::uuid`
	default:
		return "", ErrInvalid
	}
	var information string
	err := tx.QueryRowContext(ctx, query, ref.CompanyID, ref.ResourceID, ref.DocumentID).Scan(&information)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return information, err
}

func materializePostgresEditorProjectionTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef, html string, revision int64, now time.Time) error {
	current, err := postgresCurrentEditorProjectionInformationTx(ctx, tx, ref)
	if err != nil {
		return err
	}
	information := editorProjectionInformationWithDocument(current, html)
	if strings.TrimSpace(information) == "" {
		information = "<p><br></p>"
	}
	switch ref.ResourceType {
	case EntityTypeNode:
		_, err = tx.ExecContext(ctx, `
			insert into node_projection_table (company_id, node_id, information_id, type, information, is_deleted, revision, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, false, greatest($5, 1), $6, $6)
			on conflict (company_id, node_id, information_id) do update set information=excluded.information,
				is_deleted=false, revision=greatest(node_projection_table.revision+1, excluded.revision), updated_timestamp=excluded.updated_timestamp`,
			ref.CompanyID, ref.ResourceID, ref.DocumentID, information, revision, now)
	case EntityTypeLogicGate:
		_, err = tx.ExecContext(ctx, `
			insert into logic_gate_projection_table (company_id, logic_gate_id, information_id, type, information, is_deleted, revision, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, false, greatest($5, 1), $6, $6)
			on conflict (company_id, logic_gate_id, information_id) do update set information=excluded.information,
				is_deleted=false, revision=greatest(logic_gate_projection_table.revision+1, excluded.revision), updated_timestamp=excluded.updated_timestamp`,
			ref.CompanyID, ref.ResourceID, ref.DocumentID, information, revision, now)
	case EntityTypeProject:
		_, err = tx.ExecContext(ctx, `
			insert into project_projection_table (company_id, project_id, information_id, type, information, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, $5, $5)
			on conflict (company_id, project_id, information_id) do update set information=excluded.information, updated_timestamp=excluded.updated_timestamp`,
			ref.CompanyID, ref.ResourceID, ref.DocumentID, information, now)
	default:
		return ErrInvalid
	}
	return err
}

func deletePostgresEditorProjectionTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef, now time.Time) error {
	var err error
	switch ref.ResourceType {
	case EntityTypeNode:
		_, err = tx.ExecContext(ctx, `update node_projection_table set is_deleted=true, revision=revision+1, updated_timestamp=$4 where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid`, ref.CompanyID, ref.ResourceID, ref.DocumentID, now)
	case EntityTypeLogicGate:
		_, err = tx.ExecContext(ctx, `update logic_gate_projection_table set is_deleted=true, revision=revision+1, updated_timestamp=$4 where company_id=$1::uuid and logic_gate_id=$2::uuid and information_id=$3::uuid`, ref.CompanyID, ref.ResourceID, ref.DocumentID, now)
	case EntityTypeProject:
		_, err = tx.ExecContext(ctx, `delete from project_projection_table where company_id=$1::uuid and project_id=$2::uuid and information_id=$3::uuid`, ref.CompanyID, ref.ResourceID, ref.DocumentID)
	default:
		return ErrInvalid
	}
	return err
}

func insertRealtimeOutboxTx(ctx context.Context, tx *sql.Tx, input RealtimeOutboxInput) error {
	input, err := normalizeRealtimeOutboxInput(input)
	if err != nil {
		return err
	}
	if input.EventID == "" {
		input.EventID = newUUIDv7String()
	}
	allowed, err := json.Marshal(input.AllowedUserIDs)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		insert into realtime_outbox (
			event_id, company_id, scope, event_type, resource_type, resource_id,
			permission, resource_revision, payload, allowed_user_ids, audience_restricted
		) values ($1::uuid, $2::uuid, $3, $4, nullif($5, ''), nullif($6, ''), nullif($7, ''), $8, $9::jsonb, $10::jsonb, $11)
		on conflict (event_id) do nothing`, input.EventID, input.CompanyID, input.Scope, input.EventType,
		input.ResourceType, input.ResourceID, input.Permission, input.ResourceRevision, []byte(input.Payload), allowed, input.AudienceRestricted)
	return err
}
