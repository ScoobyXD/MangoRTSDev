package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
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
	return getPostgresEditorTextboxSnapshot(r, ref)
}

func (r *PostgresRepo) EnsureEditorJSONCollaborationDocument(ref EditorJSONDocumentRef) (EditorJSONSnapshot, error) {
	ref, err := normalizePostgresEditorJSONRef(ref)
	if err != nil {
		return EditorJSONSnapshot{}, err
	}
	if ref.ResourceType != EntityTypeProject && ref.ResourceType != EntityTypeLogicGate {
		return EditorJSONSnapshot{}, ErrInvalid
	}
	return ensurePostgresEditorTextboxDocument(r, ref)
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

func (r *PostgresRepo) CommitEditorJSONDocument(input EditorJSONCommitInput) (EditorJSONCommit, error) {
	input, err := NormalizeEditorJSONCommit(input)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	input.Document, err = normalizePostgresEditorJSONRef(input.Document)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	return commitPostgresEditorTextboxDocument(r, input)
}

func (r *PostgresRepo) DeleteEditorJSONDocument(input EditorJSONDeleteInput) (EditorJSONCommit, error) {
	ref, err := normalizePostgresEditorJSONRef(input.Document)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	input.Document = ref
	input.OperationID = strings.TrimSpace(input.OperationID)
	input.ClientID = strings.TrimSpace(input.ClientID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.OperationID == "" || input.ClientID == "" || input.BaseRevision < 0 {
		return EditorJSONCommit{}, ErrInvalid
	}
	return deletePostgresEditorTextboxDocument(r, input)
}

func (r *PostgresRepo) ListEditorJSONVersions(ref EditorJSONDocumentRef, _ int) ([]EditorJSONVersion, error) {
	if _, err := normalizePostgresEditorJSONRef(ref); err != nil {
		return nil, err
	}
	return []EditorJSONVersion{}, nil
}
