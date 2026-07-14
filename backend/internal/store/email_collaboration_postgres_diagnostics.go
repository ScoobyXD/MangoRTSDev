package store

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// emailCollaborationEnsureStageError keeps the actionable database stage on an
// internal error without exposing message content, provider ids, or SQL
// parameters to callers. Unwrap deliberately preserves errors.Is/errors.As for
// the existing domain sentinels and PostgreSQL diagnostics.
type emailCollaborationEnsureStageError struct {
	stage string
	err   error
}

func (e *emailCollaborationEnsureStageError) Error() string {
	return "email collaboration ensure failed at " + e.stage
}

func (e *emailCollaborationEnsureStageError) Unwrap() error {
	return e.err
}

func wrapEmailCollaborationEnsureStage(stage string, err error) error {
	if err == nil {
		return nil
	}
	return &emailCollaborationEnsureStageError{stage: stage, err: err}
}

// EmailCollaborationEnsureErrorStage returns a fixed, non-sensitive operation
// label for a staged Postgres collaboration-creation failure.
func EmailCollaborationEnsureErrorStage(err error) string {
	var staged *emailCollaborationEnsureStageError
	if errors.As(err, &staged) {
		return staged.stage
	}
	return ""
}

// EmailCollaborationEnsureErrorSQLState returns only the PostgreSQL SQLSTATE;
// it never returns Detail, Hint, constraint row data, or SQL parameters.
func EmailCollaborationEnsureErrorSQLState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

// EmailCollaborationEnsureErrorCategory is safe for logs. It intentionally
// avoids pgErr.Detail and the raw error string because either can contain a
// serialized email snapshot or a failing row.
func EmailCollaborationEnsureErrorCategory(err error) string {
	switch EmailCollaborationEnsureErrorSQLState(err) {
	case "42P01":
		return "undefined_table"
	case "42703":
		return "undefined_column"
	case "42704":
		return "undefined_object"
	case "42883":
		return "undefined_function"
	case "42501":
		return "insufficient_privilege"
	case "42804":
		return "datatype_mismatch"
	case "42P10":
		return "missing_unique_constraint"
	case "23514":
		return "check_constraint_drift"
	case "22P02":
		return "invalid_schema_value"
	case "":
		return "store_error"
	default:
		return "postgres_error"
	}
}

// IsEmailCollaborationStorageNotReady identifies physical schema, ownership,
// and check-constraint drift that deployment/migration repair can resolve.
// Domain validation and ordinary data conflicts remain on their existing paths.
func IsEmailCollaborationStorageNotReady(err error) bool {
	switch EmailCollaborationEnsureErrorSQLState(err) {
	case "42P01", // undefined_table
		"42703", // undefined_column
		"42704", // undefined_object (including a missing enum/type)
		"42883", // undefined_function
		"42501", // insufficient_privilege
		"42804", // datatype_mismatch caused by physical schema drift
		"42P10", // invalid_column_reference / missing ON CONFLICT constraint
		"23514": // check_violation against a drifted constraint
		return true
	case "22P02":
		stage := EmailCollaborationEnsureErrorStage(err)
		return stage == "insert_attached_email_history" || stage == "insert_attached_email_projection"
	default:
		return false
	}
}
