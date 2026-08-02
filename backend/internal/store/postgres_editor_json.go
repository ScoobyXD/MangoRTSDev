package store

import (
	"context"
	"database/sql"
	"encoding/json"
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
	return DefaultEditorDataFormatGate(companyID), nil
}

func requirePostgresEditorJSONFormatTx(_ context.Context, _ *sql.Tx, companyID string) error {
	if cleanUUIDText(companyID) == "" {
		return ErrInvalid
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
