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
		"references email_threads(company_id,email_thread_id) on delete cascade",
		"references nodes(company_id,node_id) on delete cascade",
		"references email_messages(company_id,email_message_id) on delete restrict",
		"deleted_timestamp timestamptz",
		"send_idempotency_key text",
		"sent_email_message_id uuid",
		"origin_node_id uuid",
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

func TestEmailDraftScopeMigrationRemovesOnlyAmbiguousLegacyDrafts(t *testing.T) {
	raw, err := os.ReadFile("../../db/migrations/20260811_zzz_email_draft_scope.sql")
	if err != nil {
		t.Fatalf("read email draft scope migration: %v", err)
	}
	migration := strings.ToLower(string(raw))
	normalized := strings.Join(strings.Fields(migration), " ")
	for _, required := range []string{
		"begin;",
		"update attachment_relationships relationship",
		"relationship.resource_type='email_draft'",
		"draft.email_thread_id is null and draft.created_by_user_id is null",
		"draft.email_thread_id is not null and (draft.origin_node_id is null or draft.source_email_message_id is null)",
		"delete from email_drafts where (email_thread_id is null and created_by_user_id is null) or (email_thread_id is not null and (origin_node_id is null or source_email_message_id is null))",
		"drop constraint if exists email_drafts_origin_node_fkey",
		"references nodes(company_id,node_id) on delete cascade",
		"commit;",
	} {
		if !strings.Contains(normalized, strings.Join(strings.Fields(required), " ")) {
			t.Errorf("email draft scope migration missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"email draft migration stopped: personal draft owner is ambiguous",
		"email draft migration stopped: shared draft node or source message is ambiguous",
	} {
		if strings.Contains(migration, forbidden) {
			t.Errorf("email draft scope migration retains obsolete blocking path %q", forbidden)
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
