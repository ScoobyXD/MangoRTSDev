package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readV3EmailSQL(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", name))
	if err != nil {
		t.Fatal(err)
	}
	return strings.ToLower(strings.ReplaceAll(string(raw), "\r\n", "\n"))
}

func TestV3EmailExpansionIsAdditiveAndOperatorGated(t *testing.T) {
	step1 := readV3EmailSQL(t, "v3_email_step1_count.sql")
	step2 := readV3EmailSQL(t, "v3_email_step2_create_copy_verify.sql")
	expand := readV3EmailSQL(t, "v3_email_expand_component.sql")
	classify := readV3EmailSQL(t, "v3_email_copy_classify.sql")
	content := readV3EmailSQL(t, "v3_email_copy_content.sql")
	dependents := readV3EmailSQL(t, "v3_email_copy_dependents.sql")
	attachments := readV3EmailSQL(t, "v3_email_copy_attachments.sql")
	reconcile := readV3EmailSQL(t, "v3_email_copy_reconcile.sql")

	schemaRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	schema := strings.ToLower(string(schemaRaw))

	for _, sqlText := range []string{expand, schema} {
		for _, required := range []string{
			"create table if not exists email_threads",
			"create table if not exists email_messages",
			"create table if not exists email_relationships",
			"create table if not exists email_drafts",
			"create table if not exists email_signatures",
			"create table if not exists email_thread_download_jobs",
			"create table if not exists attachment_relationships",
			"email_account_type in ('personal_email_account','shared_email_account')",
			"references email_relationships(company_id,email_relationship_id) on delete set null",
			"attachment_relationship_id uuid not null",
		} {
			if !strings.Contains(strings.ReplaceAll(sqlText, " ", ""), strings.ReplaceAll(required, " ", "")) {
				t.Errorf("schema expansion is missing %q", required)
			}
		}
	}
	for _, forbidden := range []string{
		"drop table communications_", "drop table resource_attachments",
		"alter table communications_", "alter table resource_attachments",
	} {
		if strings.Contains(expand, forbidden) {
			t.Errorf("additive schema component contains legacy mutation %q", forbidden)
		}
	}

	if !strings.Contains(step1, "begin transaction isolation level repeatable read read only") {
		t.Error("Step 1 is not explicitly repeatable-read and read-only")
	}
	for _, forbidden := range []string{
		"insert into", "update ", "delete from", "create table", "alter table", "drop table",
	} {
		if strings.Contains(step1, forbidden) {
			t.Errorf("Step 1 contains write operation %q", forbidden)
		}
	}
	for _, required := range []string{
		"ready_to_copy", "relationships_without_one_account",
		"relationship_rows_to_consolidate", "expected_final_email_relationships",
		"stale_compose_source_links_to_omit", "attachment_relationships_to_copy",
	} {
		if !strings.Contains(step1, required) {
			t.Errorf("Step 1 is missing %q", required)
		}
	}

	if strings.Count(step2, "\nbegin;\n") != 1 || strings.Count(step2, "\ncommit;") != 1 {
		t.Error("Step 2 must have one outer transaction")
	}
	for _, include := range []string{
		"\\ir v3_email_expand_component.sql",
		"\\ir v3_email_copy_classify.sql",
		"\\ir v3_email_copy_content.sql",
		"\\ir v3_email_copy_dependents.sql",
		"\\ir v3_email_copy_attachments.sql",
		"\\ir v3_email_copy_reconcile.sql",
	} {
		if !strings.Contains(step2, include) {
			t.Errorf("Step 2 is missing %q", include)
		}
	}
	allCopy := classify + content + dependents + attachments + reconcile
	for _, forbidden := range []string{
		"delete from communications_", "update communications_", "delete from resource_attachments",
		"update resource_attachments", "delete from recycle_bin_items",
	} {
		if strings.Contains(allCopy, forbidden) {
			t.Errorf("copy phase mutates legacy data with %q", forbidden)
		}
	}
}

func TestV3EmailCopyEncodesApprovedBusinessRules(t *testing.T) {
	classify := readV3EmailSQL(t, "v3_email_copy_classify.sql")
	content := readV3EmailSQL(t, "v3_email_copy_content.sql")
	dependents := readV3EmailSQL(t, "v3_email_copy_dependents.sql")
	attachments := readV3EmailSQL(t, "v3_email_copy_attachments.sql")
	reconcile := readV3EmailSQL(t, "v3_email_copy_reconcile.sql")

	for _, required := range []string{
		"10 priority", "20,c.scope_type", "30,'shared'", "40,'personal'",
		"50,'personal'", "60,'personal'", "70,j.connection_scope",
		"approved 28 exact pairs", "soft-deleted compose draft", "v3_assert_columns",
	} {
		if !strings.Contains(classify, required) {
			t.Errorf("classifier is missing %q", required)
		}
	}
	for _, required := range []string{
		"v3-email-thread:", "v3-email-message:", "on conflict(company_id,email_thread_id)",
		"on conflict(company_id,email_message_id)", "v3_draft_accounts d where d.valid_source_snapshot",
	} {
		if !strings.Contains(content, required) {
			t.Errorf("content copy is missing %q", required)
		}
	}
	for _, required := range []string{
		"v3_relationship_source_map", "where relationship_rank=1",
		"on delete set null", "resolved_source_message_id",
	} {
		if !strings.Contains(dependents+readV3EmailSQL(t, "v3_email_expand_component.sql"), required) {
			t.Errorf("dependent copy is missing %q", required)
		}
	}
	for _, required := range []string{
		"pg_temp.v3_query_unescape", "'email_message'", "'email_draft'",
		"'email_signature'", "resource_type='attached_email'",
		"relationship_kind in('email_attachment','email_inline_attachment')",
		"not every legacy attachment relationship resolved exactly once",
	} {
		if !strings.Contains(attachments, required) {
			t.Errorf("attachment copy is missing %q", required)
		}
	}
	for _, required := range []string{
		"'consolidated_duplicate'", "'retained_without_source_link'",
		"v3 email thread final count mismatch", "ready_for_backend_cutover_review",
	} {
		if !strings.Contains(reconcile, required) {
			t.Errorf("reconciliation is missing %q", required)
		}
	}
}
