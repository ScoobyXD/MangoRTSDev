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
	migrationRaw, err := os.ReadFile("../../db/migrations/20260713_email_thread_collaboration.sql")
	if err != nil {
		t.Fatalf("read email collaboration migration: %v", err)
	}

	for name, raw := range map[string][]byte{
		"runtime schema":   runtimeRaw,
		"canonical schema": schemaRaw,
	} {
		draftTable := emailDraftCreateTableContract(t, strings.ToLower(string(raw)))
		for _, forbidden := range []string{
			"references user_email_connections",
			"references shared_inboxes",
		} {
			if strings.Contains(draftTable, forbidden) {
				t.Fatalf("%s retains unconditional draft source foreign key %q", name, forbidden)
			}
		}
	}

	for name, raw := range map[string][]byte{
		"runtime schema":          runtimeRaw,
		"canonical schema":        schemaRaw,
		"collaboration migration": migrationRaw,
	} {
		sqlText := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
		for _, required := range []string{
			"confrelid in ('user_email_connections'::regclass, 'shared_inboxes'::regclass)",
			"alter table communications_email_drafts drop constraint %i",
			"create or replace function mangorts_cleanup_private_personal_email_drafts()",
			"where not is_shared and personal_user_id = old.user_id and personal_account_email = old.account_email",
			"before delete on user_email_connections",
			"create or replace function mangorts_cleanup_private_shared_email_drafts()",
			"where not is_shared and company_id = old.company_id and shared_inbox_id = old.shared_inbox_id",
			"before delete on shared_inboxes",
		} {
			if !strings.Contains(sqlText, required) {
				t.Fatalf("%s missing email draft source-retention contract %q", name, required)
			}
		}
	}
}

func emailDraftCreateTableContract(t *testing.T, sqlText string) string {
	t.Helper()
	const startNeedle = "create table if not exists communications_email_drafts ("
	start := strings.Index(sqlText, startNeedle)
	if start < 0 {
		t.Fatalf("missing %q", startNeedle)
	}
	rest := sqlText[start:]
	const endNeedle = "create index if not exists idx_communications_email_drafts_personal_updated"
	end := strings.Index(rest, endNeedle)
	if end < 0 {
		t.Fatalf("communications_email_drafts table has no expected following index")
	}
	return rest[:end]
}
