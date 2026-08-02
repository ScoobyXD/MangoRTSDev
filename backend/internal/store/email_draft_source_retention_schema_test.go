package store

import (
	"os"
	"strings"
	"testing"
)

func TestEmailDraftSourceRetentionSchemaContract(t *testing.T) {
	schemaRaw, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("read schema.sql: %v", err)
	}
	migrationRaw, err := os.ReadFile("../../db/migrations/20260802_zz_v3_database_table_cutover.sql")
	if err != nil {
		t.Fatalf("read V3 migration: %v", err)
	}
	runtimeRaw, err := os.ReadFile("postgres_email_drafts.go")
	if err != nil {
		t.Fatalf("read postgres_email_drafts.go: %v", err)
	}

	schema := strings.ToLower(string(schemaRaw))
	draftTable := emailDraftCreateTableContract(t, schema)
	for _, required := range []string{
		"email_relationship_id uuid",
		"source_email_message_id uuid",
		"mailbox_scope_type text not null",
		"foreign key (company_id, email_relationship_id)",
		"references email_relationships(company_id, email_relationship_id)",
		"send_claim_token text not null",
		"send_idempotency_key text not null",
		"sent_email_message_id uuid",
	} {
		if !strings.Contains(draftTable, required) {
			t.Fatalf("canonical email_drafts missing %q", required)
		}
	}
	for _, forbidden := range []string{"collaboration_id", "is_shared", "source_message_id text"} {
		if strings.Contains(draftTable, forbidden) {
			t.Fatalf("canonical email_drafts retained %q", forbidden)
		}
	}

	migration := strings.ToLower(strings.Join(strings.Fields(string(migrationRaw)), " "))
	for _, required := range []string{
		"create table email_drafts",
		"email_relationship_id uuid",
		"source_email_message_id uuid",
		"drop table communications_email_drafts",
		"insert into email_drafts(",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("V3 migration missing draft cutover %q", required)
		}
	}

	runtime := strings.ToLower(string(runtimeRaw))
	for _, required := range []string{"email_relationship_id", "source_email_message_id", "from email_drafts"} {
		if !strings.Contains(runtime, required) {
			t.Fatalf("runtime draft store missing %q", required)
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
		t.Fatalf("email_drafts table has no expected following index")
	}
	return rest[:end]
}
