package store

import (
	"context"
	"database/sql"
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
	switch input.Document.ResourceType {
	case EntityTypeNode:
		textboxRef := EditorJSONDocumentRef{
			CompanyID: input.Document.CompanyID, ResourceType: input.Document.ResourceType,
			ResourceID: input.Document.ResourceID, DocumentID: input.Document.DocumentID,
		}
		storage, ok := postgresEditorTextboxStorageFor(textboxRef)
		if !ok {
			return EditorJSONMetadataCommit{}, ErrInvalid
		}
		if err = insertEmptyPostgresEditorTextboxTx(ctx, tx, storage, textboxRef); err != nil {
			return EditorJSONMetadataCommit{}, err
		}
		err = tx.QueryRowContext(ctx, `
			update node_textboxes
			set title=$4,email_accent=$5,revision=revision+1,
			    updated_timestamp=greatest(clock_timestamp(),created_timestamp)
			where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
			  and deleted_timestamp is null
			returning revision,updated_timestamp`,
			input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID,
			input.Title, input.EmailAccent).Scan(&revision, &now)
	case EntityTypeLogicGate:
		textboxRef := EditorJSONDocumentRef{
			CompanyID: input.Document.CompanyID, ResourceType: input.Document.ResourceType,
			ResourceID: input.Document.ResourceID, DocumentID: input.Document.DocumentID,
		}
		storage, ok := postgresEditorTextboxStorageFor(textboxRef)
		if !ok {
			return EditorJSONMetadataCommit{}, ErrInvalid
		}
		if err = insertEmptyPostgresEditorTextboxTx(ctx, tx, storage, textboxRef); err != nil {
			return EditorJSONMetadataCommit{}, err
		}
		err = tx.QueryRowContext(ctx, `
			update logic_gate_textboxes
			set title=$4,email_message_id=$5,email_accent=$6,
			    metadata_revision=metadata_revision+1,
			    updated_timestamp=greatest(clock_timestamp(),created_timestamp)
			where company_id=$1::uuid and logic_gate_id=$2::uuid and textbox_id=$3
			  and deleted_timestamp is null
			returning metadata_revision,updated_timestamp`,
			input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID,
			input.Title, input.EmailMessageID, input.EmailAccent).Scan(&revision, &now)
	case EntityTypeProject:
		textboxRef := EditorJSONDocumentRef{
			CompanyID:    input.Document.CompanyID,
			ResourceType: input.Document.ResourceType,
			ResourceID:   input.Document.ResourceID,
			DocumentID:   input.Document.DocumentID,
		}
		storage, ok := postgresEditorTextboxStorageFor(textboxRef)
		if !ok {
			return EditorJSONMetadataCommit{}, ErrInvalid
		}
		if err = insertEmptyPostgresEditorTextboxTx(ctx, tx, storage, textboxRef); err != nil {
			return EditorJSONMetadataCommit{}, err
		}
		err = tx.QueryRowContext(ctx, `
			update project_textboxes
			set title=$4,email_message_id=$5,email_accent=$6,
			    metadata_revision=metadata_revision+1,
			    updated_timestamp=greatest(clock_timestamp(),created_timestamp)
			where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3
			  and deleted_timestamp is null
			returning metadata_revision,updated_timestamp`,
			input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID,
			input.Title, input.EmailMessageID, input.EmailAccent).Scan(&revision, &now)
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
		// Node textboxes have no separate metadata row.
		err = nil
	case EntityTypeLogicGate:
		// Logic Gate textbox metadata is retired with the final textbox row.
		err = nil
	case EntityTypeProject:
		// Project textbox metadata lives on project_textboxes and is retired with the textbox row.
		err = nil
	default:
		return ErrInvalid
	}
	return err
}
