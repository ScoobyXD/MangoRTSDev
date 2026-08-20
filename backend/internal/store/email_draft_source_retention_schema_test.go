package store

import (
	"os"
	"strings"
	"testing"
)

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
