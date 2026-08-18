package store

import (
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

func postgresEmailRelationshipMutationError(err error, resourceType string) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch strings.TrimSpace(pgErr.ConstraintName) {
	case "idx_email_relationships_one_textbox_per_message_owner":
		return ErrEmailMessageTextboxConflict
	case "email_relationship_required_by_chat":
		return ErrEmailRelationshipRequiredByChat
	case "email_wide_relationship_required_by_textbox_work":
		if resourceType == EntityTypeProject {
			return ErrEmailRelationshipHasProjectWork
		}
		return ErrEmailRelationshipHasNodeWork
	case "email_textbox_relationship_requires_wide", "email_chat_requires_exact_textbox_relationship":
		if resourceType == EntityTypeProject {
			return ErrEmailMessageNotAttachedToProject
		}
		return ErrEmailMessageNotAttachedToNode
	case "email_relationship_project_document_forbidden", "project_document_chat_forbidden":
		return ErrInvalid
	}
	return err
}
