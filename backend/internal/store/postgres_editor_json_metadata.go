package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

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

func (r *PostgresRepo) UpdateEditorJSONMetadata(input EditorJSONMetadataInput) (EditorJSONMetadataCommit, error) {
	input, err := NormalizeEditorJSONMetadata(input)
	if err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	input.Document, err = normalizePostgresEditorDocumentRef(input.Document)
	if err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	if input.Document.ResourceType == EntityTypeNode {
		return EditorJSONMetadataCommit{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	defer tx.Rollback()
	if err := requirePostgresEditorJSONFormatTx(ctx, tx, input.Document.CompanyID); err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	if exists, queryErr := postgresEditorResourceExistsTx(ctx, tx, input.Document); queryErr != nil {
		return EditorJSONMetadataCommit{}, queryErr
	} else if !exists {
		return EditorJSONMetadataCommit{}, ErrNotFound
	}

	now := time.Now().UTC()
	var revision int64

	information, err := editorProjectionInformationWithJSONMetadata(input, "")
	if err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	switch input.Document.ResourceType {
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
		return EditorJSONMetadataCommit{}, ErrInvalid
	}
	if err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	return EditorJSONMetadataCommit{ProjectionRevision: revision, UpdatedTimestamp: now}, nil
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

func deletePostgresEditorProjectionTx(ctx context.Context, tx *sql.Tx, ref EditorDocumentRef, now time.Time) error {
	var err error
	switch ref.ResourceType {
	case EntityTypeNode:
		return nil
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
