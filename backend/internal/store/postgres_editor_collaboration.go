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
	Ref                   EditorDocumentRef
	Revision              int64
	SnapshotRevision      int64
	SnapshotState         EditorCollaborationState
	AccumulatedDeltaBytes int
	Deleted               bool
	UpdatedTimestamp      time.Time
}

type postgresEditorCollaborationOperation struct {
	OperationID  string
	ClientID     string
	ActorUserID  string
	BaseRevision int64
	Delta        EditorCollaborationDelta
	EventID      string
	Revision     int64
	CommittedAt  time.Time
	Tombstone    bool
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
	if exists, err := postgresEditorResourceExistsTx(ctx, tx, ref); err != nil {
		return EditorCollaborationSnapshot{}, err
	} else if !exists {
		return EditorCollaborationSnapshot{}, ErrNotFound
	}
	document, found, err := loadPostgresEditorCollaborationDocumentTx(ctx, tx, ref, false)
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	if !found {
		html, err := postgresInitialEditorDocumentHTMLTx(ctx, tx, ref)
		if err != nil {
			return EditorCollaborationSnapshot{}, err
		}
		state := NewEditorCollaborationState(html)
		now := time.Now().UTC()
		if err := tx.Commit(); err != nil {
			return EditorCollaborationSnapshot{}, err
		}
		return EditorCollaborationSnapshot{
			Document: ref, State: state, HTML: html, ETag: EditorCollaborationSnapshotETag(0, state), UpdatedTimestamp: now,
		}, nil
	}
	snapshot, err := postgresEditorCollaborationSnapshotTx(ctx, tx, document)
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	return snapshot, nil
}

func (r *PostgresRepo) CommitEditorCollaborationOperation(input EditorCollaborationOperationInput) (EditorCollaborationCommit, error) {
	input, deltaBytes, err := NormalizeEditorCollaborationOperation(input)
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
	if exists, err := postgresEditorResourceExistsTx(ctx, tx, input.Document); err != nil {
		return EditorCollaborationCommit{}, err
	} else if !exists {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	initialHTML, err := postgresInitialEditorDocumentHTMLTx(ctx, tx, input.Document)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	initialState, err := json.Marshal(NewEditorCollaborationState(initialHTML))
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_documents (
			company_id, resource_type, resource_id, document_id, revision,
			snapshot_revision, snapshot_state, accumulated_delta_bytes,
			is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, 0, 0, $5::jsonb, 0, false, now(), now())
		on conflict (company_id, resource_type, resource_id, document_id) do nothing`,
		input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID, input.Document.DocumentID, initialState,
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
	if existing, found, err := loadPostgresEditorOperationByIDTx(ctx, tx, input.Document, input.OperationID); err != nil {
		return EditorCollaborationCommit{}, err
	} else if found {
		snapshot, snapshotErr := postgresEditorCollaborationSnapshotTx(ctx, tx, document)
		if snapshotErr != nil {
			return EditorCollaborationCommit{}, snapshotErr
		}
		if err := tx.Commit(); err != nil {
			return EditorCollaborationCommit{}, err
		}
		return EditorCollaborationCommit{
			OperationID: existing.OperationID, EventID: existing.EventID, Revision: existing.Revision,
			CommittedAt: existing.CommittedAt, Deduplicated: true, Snapshot: snapshot,
		}, nil
	}

	state, _, err := reconstructPostgresEditorStateTx(ctx, tx, document)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	state, err = ApplyEditorCollaborationDelta(state, input.Delta)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	html, err := MaterializeEditorCollaborationState(state)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	now := time.Now().UTC()
	revision := document.Revision + 1
	eventID := newUUIDv7String()
	scope := EditorRealtimeScope(input.Document)
	payload, err := json.Marshal(map[string]any{
		"type": EditorCollaborationEventType, "event_id": eventID, "company_id": input.Document.CompanyID,
		"scope": scope, "resource_type": input.Document.ResourceType, "resource_id": input.Document.ResourceID,
		"document_id": input.Document.DocumentID, "resource_revision": revision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID, "delta": input.Delta,
	})
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	encodedDelta, err := json.Marshal(input.Delta)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_operations (
			company_id, resource_type, resource_id, document_id, revision,
			operation_id, client_id, actor_user_id, base_revision, delta,
			event_id, is_tombstone, committed_timestamp
		) values (
			$1::uuid, $2, $3::uuid, $4::uuid, $5,
			$6, $7, nullif($8, '')::uuid, $9, $10::jsonb,
			$11::uuid, false, $12
		)`, input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID,
		input.Document.DocumentID, revision, input.OperationID, input.ClientID, input.ActorUserID,
		input.BaseRevision, encodedDelta, eventID, now,
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

	accumulated := document.AccumulatedDeltaBytes + len(deltaBytes)
	shouldCompact := revision-document.SnapshotRevision >= EditorCollaborationCompactOperationCount || accumulated >= EditorCollaborationCompactDeltaBytes
	snapshotRevision := document.SnapshotRevision
	snapshotState := document.SnapshotState
	if shouldCompact {
		snapshotRevision, snapshotState, accumulated = revision, state, 0
	}
	encodedSnapshot, err := json.Marshal(snapshotState)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		update editor_collaboration_documents
		set revision=$5, snapshot_revision=$6, snapshot_state=$7::jsonb,
			accumulated_delta_bytes=$8, updated_timestamp=$9
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid`,
		input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID, input.Document.DocumentID,
		revision, snapshotRevision, encodedSnapshot, accumulated, now,
	); err != nil {
		return EditorCollaborationCommit{}, err
	}
	if document.Revision == 0 || shouldCompact {
		if err := materializePostgresEditorProjectionTx(ctx, tx, input.Document, html, revision, now); err != nil {
			return EditorCollaborationCommit{}, err
		}
	}
	document.Revision, document.SnapshotRevision = revision, snapshotRevision
	document.SnapshotState, document.AccumulatedDeltaBytes, document.UpdatedTimestamp = snapshotState, accumulated, now
	snapshot, err := postgresEditorCollaborationSnapshotTx(ctx, tx, document)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorCollaborationCommit{}, err
	}
	return EditorCollaborationCommit{
		OperationID: input.OperationID, EventID: eventID, Revision: revision, CommittedAt: now, Snapshot: snapshot,
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
	current := NewEditorCollaborationState("")
	if found {
		current, _, err = reconstructPostgresEditorStateTx(ctx, tx, document)
		if err != nil {
			return err
		}
	} else {
		initial, err := postgresInitialEditorDocumentHTMLTx(ctx, tx, ref)
		if err != nil {
			return err
		}
		current = NewEditorCollaborationState(initial)
		document = postgresEditorCollaborationDocument{Ref: ref, SnapshotState: current}
	}
	eventID := newUUIDv7String()
	replacementState := EditorCollaborationState{}
	for _, atom := range current.Atoms {
		if !atom.Deleted {
			atom.Deleted = true
			replacementState.Atoms = append(replacementState.Atoms, atom)
		}
	}
	afterID := ""
	for index, value := range []rune(html) {
		id := fmt.Sprintf("restore:%s:%08x", eventID, index)
		replacementState.Atoms = append(replacementState.Atoms, EditorCollaborationAtom{ID: id, AfterID: afterID, Value: string(value)})
		afterID = id
	}
	if materialized, err := MaterializeEditorCollaborationState(replacementState); err != nil || materialized != html {
		return ErrInvalid
	}
	encodedSnapshot, err := json.Marshal(replacementState)
	if err != nil {
		return err
	}
	revision := document.Revision + 1
	scope := EditorRealtimeScope(ref)
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
			company_id, resource_type, resource_id, document_id, revision, snapshot_revision,
			snapshot_state, accumulated_delta_bytes, is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $5, $6::jsonb, 0, false, $7, $7)
		on conflict (company_id, resource_type, resource_id, document_id) do update set
			revision=excluded.revision, snapshot_revision=excluded.snapshot_revision,
			snapshot_state=excluded.snapshot_state, accumulated_delta_bytes=0, is_deleted=false, updated_timestamp=excluded.updated_timestamp`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, encodedSnapshot, now); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_operations (
			company_id, resource_type, resource_id, document_id, revision, operation_id, client_id,
			actor_user_id, base_revision, delta, event_id, is_tombstone, committed_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, nullif($8, '')::uuid, $9, '{}'::jsonb, $10::uuid, false, $11)`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, operationID, clientID,
		actorUserID, document.Revision, eventID, now); err != nil {
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
		initial, err := postgresInitialEditorDocumentHTMLTx(ctx, tx, ref)
		if err != nil {
			return err
		}
		document = postgresEditorCollaborationDocument{Ref: ref, SnapshotState: NewEditorCollaborationState(initial)}
	}
	if document.Deleted {
		return nil
	}
	revision := document.Revision + 1
	encodedSnapshot, err := json.Marshal(document.SnapshotState)
	if err != nil {
		return err
	}
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
			company_id, resource_type, resource_id, document_id, revision, snapshot_revision,
			snapshot_state, accumulated_delta_bytes, is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, $5, 0, $6::jsonb, 0, true, $7, $7)
		on conflict (company_id, resource_type, resource_id, document_id) do update set
			revision=excluded.revision, is_deleted=true, updated_timestamp=excluded.updated_timestamp`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, encodedSnapshot, now); err != nil {
		return err
	}
	emptyDelta := []byte(`{}`)
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_operations (
			company_id, resource_type, resource_id, document_id, revision, operation_id, client_id,
			actor_user_id, base_revision, delta, event_id, is_tombstone, committed_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, nullif($8, '')::uuid, $9, $10::jsonb, $11::uuid, true, $12)`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, operationID, clientID,
		actorUserID, document.Revision, emptyDelta, eventID, now); err != nil {
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
	if exists, err := postgresEditorResourceExistsTx(ctx, tx, input.Document); err != nil {
		return EditorCollaborationMetadataCommit{}, err
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
		snapshot, err := postgresEditorCollaborationSnapshotTx(ctx, tx, document)
		if err != nil {
			return EditorCollaborationMetadataCommit{}, err
		}
		html = snapshot.HTML
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
func (r *PostgresRepo) DeleteEditorCollaborationDocument(input EditorCollaborationDeleteInput) (EditorCollaborationCommit, error) {
	ref, err := normalizePostgresEditorDocumentRef(input.Document)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	input.Document = ref
	input.OperationID, input.ClientID, input.ActorUserID = strings.TrimSpace(input.OperationID), strings.TrimSpace(input.ClientID), strings.TrimSpace(input.ActorUserID)
	if input.OperationID == "" || input.ClientID == "" || len(input.OperationID) > 160 || len(input.ClientID) > 160 {
		return EditorCollaborationCommit{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	defer tx.Rollback()
	if exists, err := postgresEditorResourceExistsTx(ctx, tx, ref); err != nil {
		return EditorCollaborationCommit{}, err
	} else if !exists {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	initialHTML, err := postgresInitialEditorDocumentHTMLTx(ctx, tx, ref)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	initialState, _ := json.Marshal(NewEditorCollaborationState(initialHTML))
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_documents (
			company_id, resource_type, resource_id, document_id, revision,
			snapshot_revision, snapshot_state, accumulated_delta_bytes,
			is_deleted, created_timestamp, updated_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, 0, 0, $5::jsonb, 0, false, now(), now())
		on conflict (company_id, resource_type, resource_id, document_id) do nothing`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, initialState,
	); err != nil {
		return EditorCollaborationCommit{}, err
	}
	document, _, err := loadPostgresEditorCollaborationDocumentTx(ctx, tx, ref, true)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if existing, found, err := loadPostgresEditorOperationByIDTx(ctx, tx, ref, input.OperationID); err != nil {
		return EditorCollaborationCommit{}, err
	} else if found {
		snapshot, snapshotErr := postgresEditorCollaborationSnapshotTx(ctx, tx, document)
		if snapshotErr != nil {
			return EditorCollaborationCommit{}, snapshotErr
		}
		if err := tx.Commit(); err != nil {
			return EditorCollaborationCommit{}, err
		}
		return EditorCollaborationCommit{OperationID: existing.OperationID, EventID: existing.EventID, Revision: existing.Revision, CommittedAt: existing.CommittedAt, Deduplicated: true, Snapshot: snapshot}, nil
	}
	now, revision, eventID, scope := time.Now().UTC(), document.Revision+1, newUUIDv7String(), EditorRealtimeScope(ref)
	payload, _ := json.Marshal(map[string]any{
		"type": EditorCollaborationTombstoneEventType, "event_id": eventID, "company_id": ref.CompanyID,
		"scope": scope, "resource_type": ref.ResourceType, "resource_id": ref.ResourceID,
		"document_id": ref.DocumentID, "resource_revision": revision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID,
	})
	if _, err := tx.ExecContext(ctx, `
		insert into editor_collaboration_operations (
			company_id, resource_type, resource_id, document_id, revision,
			operation_id, client_id, actor_user_id, base_revision, delta,
			event_id, is_tombstone, committed_timestamp
		) values ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, nullif($8, '')::uuid, $9, '{}'::jsonb, $10::uuid, true, $11)`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, input.OperationID,
		input.ClientID, input.ActorUserID, document.Revision, eventID, now,
	); err != nil {
		return EditorCollaborationCommit{}, err
	}
	if err := insertRealtimeOutboxTx(ctx, tx, RealtimeOutboxInput{
		EventID: eventID, CompanyID: ref.CompanyID, Scope: scope, EventType: EditorCollaborationTombstoneEventType,
		ResourceType: ref.ResourceType, ResourceID: ref.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: revision, Payload: payload,
	}); err != nil {
		return EditorCollaborationCommit{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		update editor_collaboration_documents
		set revision=$5, is_deleted=true, updated_timestamp=$6
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, revision, now,
	); err != nil {
		return EditorCollaborationCommit{}, err
	}
	if err := deletePostgresEditorProjectionTx(ctx, tx, ref, now); err != nil {
		return EditorCollaborationCommit{}, err
	}
	document.Revision, document.Deleted, document.UpdatedTimestamp = revision, true, now
	snapshot, err := postgresEditorCollaborationSnapshotTx(ctx, tx, document)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorCollaborationCommit{}, err
	}
	return EditorCollaborationCommit{OperationID: input.OperationID, EventID: eventID, Revision: revision, CommittedAt: now, Snapshot: snapshot}, nil
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
	query := `select revision, snapshot_revision, snapshot_state, accumulated_delta_bytes, is_deleted, updated_timestamp
		from editor_collaboration_documents
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid`
	if forUpdate {
		query += " for update"
	}
	var document postgresEditorCollaborationDocument
	var state []byte
	err := tx.QueryRowContext(ctx, query, ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID).Scan(
		&document.Revision, &document.SnapshotRevision, &state, &document.AccumulatedDeltaBytes, &document.Deleted, &document.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return postgresEditorCollaborationDocument{}, false, nil
	}
	if err != nil {
		return postgresEditorCollaborationDocument{}, false, err
	}
	if err := json.Unmarshal(state, &document.SnapshotState); err != nil {
		return postgresEditorCollaborationDocument{}, false, err
	}
	document.Ref, document.UpdatedTimestamp = ref, document.UpdatedTimestamp.UTC()
	return document, true, nil
}

func loadPostgresEditorOperationByIDTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef, operationID string) (postgresEditorCollaborationOperation, bool, error) {
	var item postgresEditorCollaborationOperation
	var actor sql.NullString
	err := tx.QueryRowContext(ctx, `
		select operation_id, client_id, actor_user_id::text, base_revision, event_id::text,
			revision, committed_timestamp, is_tombstone
		from editor_collaboration_operations
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid and operation_id=$5`,
		ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, operationID,
	).Scan(&item.OperationID, &item.ClientID, &actor, &item.BaseRevision, &item.EventID, &item.Revision, &item.CommittedAt, &item.Tombstone)
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
	return item, true, nil
}

func reconstructPostgresEditorStateTx(ctx context.Context, tx *sql.Tx, document postgresEditorCollaborationDocument) (EditorCollaborationState, int, error) {
	state := CloneEditorCollaborationState(document.SnapshotState)
	rows, err := tx.QueryContext(ctx, `
		select delta
		from editor_collaboration_operations
		where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid
		  and revision > $5 and revision <= $6 and is_tombstone=false
		order by revision`, document.Ref.CompanyID, document.Ref.ResourceType, document.Ref.ResourceID,
		document.Ref.DocumentID, document.SnapshotRevision, document.Revision)
	if err != nil {
		return EditorCollaborationState{}, 0, err
	}
	defer rows.Close()
	replayCount := 0
	for rows.Next() {
		var encoded []byte
		if err := rows.Scan(&encoded); err != nil {
			return EditorCollaborationState{}, 0, err
		}
		var delta EditorCollaborationDelta
		if err := json.Unmarshal(encoded, &delta); err != nil {
			return EditorCollaborationState{}, 0, err
		}
		state, err = ApplyEditorCollaborationDelta(state, delta)
		if err != nil {
			return EditorCollaborationState{}, 0, err
		}
		replayCount++
	}
	return state, replayCount, rows.Err()
}

func postgresEditorCollaborationSnapshotTx(ctx context.Context, tx *sql.Tx, document postgresEditorCollaborationDocument) (EditorCollaborationSnapshot, error) {
	state, replayCount, err := reconstructPostgresEditorStateTx(ctx, tx, document)
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	html, err := MaterializeEditorCollaborationState(state)
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	return EditorCollaborationSnapshot{
		Document: document.Ref, Revision: document.Revision, SnapshotRevision: document.SnapshotRevision,
		State: state, HTML: html, ETag: EditorCollaborationSnapshotETag(document.Revision, state),
		Deleted: document.Deleted, ReplayCount: replayCount, UpdatedTimestamp: document.UpdatedTimestamp,
	}, nil
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
			on conflict (company_id, node_id, information_id) do update set
				information=excluded.information, is_deleted=false,
				revision=greatest(node_projection_table.revision+1, excluded.revision), updated_timestamp=excluded.updated_timestamp`,
			ref.CompanyID, ref.ResourceID, ref.DocumentID, information, revision, now)
	case EntityTypeLogicGate:
		_, err = tx.ExecContext(ctx, `
			insert into logic_gate_projection_table (company_id, logic_gate_id, information_id, type, information, is_deleted, revision, created_timestamp, updated_timestamp)
			values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, false, greatest($5, 1), $6, $6)
			on conflict (company_id, logic_gate_id, information_id) do update set
				information=excluded.information, is_deleted=false,
				revision=greatest(logic_gate_projection_table.revision+1, excluded.revision), updated_timestamp=excluded.updated_timestamp`,
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
