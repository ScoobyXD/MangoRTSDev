package httpapi

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestAttachmentDeletionCleanupFailureLogIncludesSafePreparedStatementCause(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:    "42601",
		Message: "cannot insert multiple commands into a prepared statement",
		Detail:  "private database row and provider payload must not appear",
	}
	logged := captureAttachmentDeletionCleanupLog(t, func() {
		logAttachmentDeletionCleanupFailure(
			"item_failed",
			"11111111-1111-1111-1111-111111111111",
			"019fcec9-fada-7001-9ba5-dfcea39eaa0f",
			"finalize_database",
			fmt.Errorf("finalize database cleanup: %w", pgErr),
		)
	})
	for _, required := range []string{
		"status=item_failed",
		"attachment_id=019fcec9-fada-7001-9ba5-dfcea39eaa0f",
		"stage=finalize_database",
		"error_category=invalid_sql_statement",
		"sqlstate=42601",
		`err="multiple commands are not allowed in one prepared statement"`,
	} {
		if !strings.Contains(logged, required) {
			t.Fatalf("safe cleanup log missing %q: %s", required, logged)
		}
	}
	if strings.Contains(logged, pgErr.Detail) {
		t.Fatalf("cleanup log leaked PostgreSQL detail: %s", logged)
	}
}

func TestAttachmentDeletionCleanupFailureLogDoesNotExposeProviderError(t *testing.T) {
	providerPayload := "provider response included a private signed URL and credential"
	logged := captureAttachmentDeletionCleanupLog(t, func() {
		logAttachmentDeletionCleanupFailure(
			"item_failed",
			"11111111-1111-1111-1111-111111111111",
			"019fcec9-fada-7001-9ba5-dfcea39eaa0f",
			"delete_storage_object",
			fmt.Errorf("delete attachment object: %w", errors.New(providerPayload)),
		)
	})
	if !strings.Contains(logged, "error_category=storage_error") ||
		!strings.Contains(logged, `err="attachment storage request failed"`) {
		t.Fatalf("cleanup log did not safely classify storage error: %s", logged)
	}
	if strings.Contains(logged, providerPayload) {
		t.Fatalf("cleanup log leaked provider payload: %s", logged)
	}
}

func captureAttachmentDeletionCleanupLog(t *testing.T, write func()) string {
	t.Helper()
	var logs bytes.Buffer
	previousWriter, previousFlags, previousPrefix := log.Writer(), log.Flags(), log.Prefix()
	log.SetOutput(&logs)
	log.SetFlags(0)
	log.SetPrefix("")
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
		log.SetPrefix(previousPrefix)
	})
	write()
	return logs.String()
}
