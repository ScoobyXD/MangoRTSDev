package store

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestNodeEmailRelationshipMutationErrorTranslatesTheChatProtectionTrigger(t *testing.T) {
	err := nodeEmailRelationshipMutationError(&pgconn.PgError{
		Code:           "23503",
		ConstraintName: "email_relationship_required_by_chat",
	})
	if !errors.Is(err, ErrEmailRelationshipRequiredByChat) {
		t.Fatalf("translated error=%v", err)
	}

	other := &pgconn.PgError{Code: "23503", Message: "another foreign key failure"}
	if got := nodeEmailRelationshipMutationError(other); got != other {
		t.Fatalf("unrelated database error was replaced: %v", got)
	}
}

func TestPostgresEmailRelationshipMutationErrorUsesStableProjectConstraints(t *testing.T) {
	tests := []struct {
		constraint string
		want       error
	}{
		{"idx_email_relationships_one_textbox_per_message_owner", ErrEmailMessageTextboxConflict},
		{"email_relationship_required_by_chat", ErrEmailRelationshipRequiredByChat},
		{"email_wide_relationship_required_by_textbox_work", ErrEmailRelationshipHasProjectWork},
		{"email_textbox_relationship_requires_wide", ErrEmailMessageNotAttachedToProject},
		{"email_chat_requires_exact_textbox_relationship", ErrEmailMessageNotAttachedToProject},
	}
	for _, test := range tests {
		err := postgresEmailRelationshipMutationError(&pgconn.PgError{Code: "23503", ConstraintName: test.constraint}, EntityTypeProject)
		if !errors.Is(err, test.want) {
			t.Errorf("constraint %s translated to %v, want %v", test.constraint, err, test.want)
		}
	}
}
