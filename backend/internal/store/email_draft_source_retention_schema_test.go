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
	for _, forbidden := range []string{
		"references user_email_connections", "references shared_inboxes",
		"email_thread_id", "origin_node_id", "collaboration_id", "is_shared",
		"send_state", "send_claim", "send_idempotency", "sent_email_message_id", "sent_provider_message_id",
		"references nodes(company_id,node_id)", "references email_threads(company_id,email_thread_id)",
	} {
		if strings.Contains(draftTable, forbidden) {
			t.Fatalf("final Triage-only email_drafts retains obsolete contract %q", forbidden)
		}
	}
	for _, required := range []string{
		"references email_messages(company_id,email_message_id) on delete restrict",
		"source_email_message_id uuid",
		"created_by_user_id uuid",
		"deleted_timestamp timestamptz",
	} {
		if !strings.Contains(strings.Join(strings.Fields(draftTable), " "), strings.Join(strings.Fields(required), " ")) {
			t.Fatalf("final Triage-only email_drafts missing contract %q", required)
		}
	}
	runtime := strings.ToLower(string(runtimeRaw))
	for _, forbidden := range []string{"create table", "alter table", "drop table", "create trigger"} {
		if strings.Contains(runtime, forbidden) {
			t.Fatalf("draft request path contains schema DDL %q", forbidden)
		}
	}
}

func TestEmailDraftIdentityMigrationUsesDirectSharedFlag(t *testing.T) {
	raw, err := os.ReadFile("../../db/migrations/20260813_email_draft_identity.sql")
	if err != nil {
		t.Fatalf("read email draft identity migration: %v", err)
	}
	normalized := strings.Join(strings.Fields(strings.ToLower(string(raw))), " ")
	for _, required := range []string{
		"add column if not exists is_shared boolean",
		"alter column is_shared set not null",
		"drop column if exists collaboration_id",
		"not is_shared and email_thread_id is null",
		"is_shared and email_thread_id is not null",
	} {
		if !strings.Contains(normalized, strings.Join(strings.Fields(required), " ")) {
			t.Errorf("email draft identity migration missing %q", required)
		}
	}
	if strings.Contains(normalized, "attachment_relationships") {
		t.Error("email draft identity migration must not rewrite attachment relationships")
	}
}

func TestRemoveNodeEmailDraftsMigrationIsForwardOnlyAndPreservesTriageStorage(t *testing.T) {
	raw, err := os.ReadFile("../../db/migrations/20260816_remove_node_email_drafts.sql")
	if err != nil {
		t.Fatalf("read remove Node email drafts migration: %v", err)
	}
	normalized := strings.Join(strings.Fields(strings.ToLower(string(raw))), " ")
	for _, required := range []string{
		"create temporary table node_email_drafts_to_remove",
		"create temporary table node_email_draft_attachments_to_check",
		"column_name='origin_node_id'",
		"column_name='is_shared'",
		"column_name='collaboration_id'",
		"select distinct relationship.company_id,relationship.attachment_id",
		"relationship.resource_type='email_draft'",
		"set deleted_timestamp=coalesce(relationship.deleted_timestamp,now())",
		"update attachments attachment",
		"relationship.deleted_timestamp is null",
		"delete from email_drafts draft using node_email_drafts_to_remove removed",
		"drop column if exists email_thread_id cascade",
		"drop column if exists origin_node_id cascade",
		"drop column if exists is_shared cascade",
		"drop column if exists send_idempotency_key cascade",
		"create unique index idx_email_drafts_active_personal_message_personal_account",
		"create unique index idx_email_drafts_active_personal_message_shared_inbox",
		"commit;",
	} {
		if !strings.Contains(normalized, strings.Join(strings.Fields(required), " ")) {
			t.Errorf("remove Node email drafts migration missing %q", required)
		}
	}
	if strings.Contains(normalized, "attachment_relationships relationship set deleted_timestamp=coalesce(relationship.deleted_timestamp,now()),updated_timestamp") {
		t.Error("remove Node email drafts migration references nonexistent attachment relationship updated_timestamp")
	}
	if strings.Contains(normalized, "email_thread_id is not null") {
		t.Error("remove Node email drafts migration must preserve mailbox drafts that carry only a legacy thread ID")
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
		"set deleted_timestamp=now()",
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
		"update attachment_relationships relationship set deleted_timestamp=now(),updated_timestamp=now()",
	} {
		if strings.Contains(normalized, strings.Join(strings.Fields(forbidden), " ")) {
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
