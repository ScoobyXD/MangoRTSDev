package store

import (
	"os"
	"strings"
	"testing"
)

func TestEmailDraftSourceRetentionSchemaContract(t *testing.T) {
	runtimeRaw, err := os.ReadFile("postgres_email_drafts.go")
	if err != nil {
		t.Fatalf("read postgres_email_drafts.go: %v", err)
	}
	schemaRaw, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("read schema.sql: %v", err)
	}
	draftTable := emailDraftCreateTableContract(t, strings.ToLower(string(schemaRaw)))
	for _, forbidden := range []string{"references user_email_connections", "references shared_inboxes"} {
		if strings.Contains(draftTable, forbidden) {
			t.Fatalf("final email_drafts retains account-connection foreign key %q", forbidden)
		}
	}
	for _, required := range []string{
		"references email_relationships(company_id,email_relationship_id) on delete set null",
		"references email_messages(company_id,email_message_id) on delete restrict",
		"deleted_timestamp timestamptz",
		"send_idempotency_key text",
		"sent_email_message_id uuid",
	} {
		if !strings.Contains(strings.Join(strings.Fields(draftTable), " "), strings.Join(strings.Fields(required), " ")) {
			t.Fatalf("final email_drafts missing retention/safe-send contract %q", required)
		}
	}
	runtime := strings.ToLower(string(runtimeRaw))
	for _, forbidden := range []string{"create table", "alter table", "drop table", "create trigger"} {
		if strings.Contains(runtime, forbidden) {
			t.Fatalf("draft request path contains schema DDL %q", forbidden)
		}
	}
}

func emailDraftCreateTableContract(t *testing.T, sqlText string) string {
	t.Helper()
	const startNeedle = "create table if not exists email_drafts ("
	start := strings.Index(sqlText, startNeedle)
	if start < 0 {
		t.Fatalf("missing %q", startNeedle)
	}
	rest := sqlText[start:]
	const endNeedle = "create index if not exists idx_email_drafts_personal_updated"
	end := strings.Index(rest, endNeedle)
	if end < 0 {
		t.Fatal("email_drafts table has no expected following index")
	}
	return rest[:end]
}
