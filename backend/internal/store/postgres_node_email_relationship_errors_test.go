package store

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestNodeEmailRelationshipMutationErrorTranslatesTheChatProtectionTrigger(t *testing.T) {
	err := nodeEmailRelationshipMutationError(&pgconn.PgError{
		Code:    "23503",
		Message: "email relationship is required by an active Node chat",
	})
	if !errors.Is(err, ErrEmailRelationshipRequiredByChat) {
		t.Fatalf("translated error=%v", err)
	}

	other := &pgconn.PgError{Code: "23503", Message: "another foreign key failure"}
	if got := nodeEmailRelationshipMutationError(other); got != other {
		t.Fatalf("unrelated database error was replaced: %v", got)
	}
}
