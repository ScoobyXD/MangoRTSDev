package store

import (
	"os"
	"strings"
	"testing"
)

const (
	nodeV2FoundationBegin = "-- NODE_V2_PHASE1_FOUNDATION_BEGIN"
	nodeV2FoundationEnd   = "-- NODE_V2_PHASE1_FOUNDATION_END"
)

func nodeV2FoundationBlock(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	text := string(body)
	start := strings.Index(text, nodeV2FoundationBegin)
	end := strings.Index(text, nodeV2FoundationEnd)
	if start < 0 || end < start {
		t.Fatalf("%s is missing the Node v2 foundation markers", path)
	}
	end += len(nodeV2FoundationEnd)
	lines := strings.Split(strings.ReplaceAll(text[start:end], "\r\n", "\n"), "\n")
	normalized := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "begin;" || trimmed == "commit;" {
			continue
		}
		normalized = append(normalized, strings.TrimRight(line, " \t"))
	}
	return strings.TrimSpace(strings.Join(normalized, "\n"))
}

func TestNodeV2FoundationMigrationMatchesCanonicalSchema(t *testing.T) {
	migration := nodeV2FoundationBlock(t, "../../db/migrations/20260726_node_v2_phase1_foundation.sql")
	canonical := nodeV2FoundationBlock(t, "../../db/schema.sql")
	if migration != canonical {
		t.Fatal("Node v2 foundation migration and canonical schema blocks differ")
	}
}

func TestNodeV2FoundationOwnershipAndSafetyContract(t *testing.T) {
	sqlText := strings.ToLower(nodeV2FoundationBlock(t, "../../db/migrations/20260726_node_v2_phase1_foundation.sql"))
	for _, table := range []string{
		"node_textboxes",
		"node_textbox_yjs_updates",
		"node_textbox_yjs_checkpoints",
		"node_textbox_comment_threads",
		"node_textbox_comments",
		"node_textbox_comment_mentions",
		"node_textbox_attachment_links",
		"node_textbox_comment_attachment_links",
		"node_textbox_email_links",
		"node_movements",
		"node_verification_requests",
		"node_verification_recipients",
		"node_verification_events",
		"node_timeline_items",
		"editor_migration_runs",
		"editor_document_migrations",
	} {
		if !strings.Contains(sqlText, "create table if not exists "+table) {
			t.Errorf("foundation missing table %s", table)
		}
	}

	for _, required := range []string{
		"foreign key (company_id, node_id, textbox_id)",
		"references node_textboxes(company_id, node_id, textbox_id)",
		"item_type in ('textbox_created', 'node_moved', 'verification_stamp')",
		"update_payload bytea not null",
		"checkpoint_payload bytea not null",
		"retain_until timestamptz",
		"source_checksum_sha256",
		"backup_verified_timestamp",
		"mode <> 'backfill'",
		"source_information_id is null or source_information_id = textbox_id",
		"references communications_node_email_threads(company_id, node_id, email_thread_id)",
		"references attachments(company_id, attachment_id) on delete restrict",
	} {
		if !strings.Contains(sqlText, required) {
			t.Errorf("foundation missing invariant %q", required)
		}
	}

	for _, forbidden := range []string{
		"drop table",
		"delete from",
		"update workspace_editor_formats",
		"insert into workspace_editor_formats",
		"pg_column_size(document_json)",
		"canonical_html text",
		"rich_html_body",
	} {
		if strings.Contains(sqlText, forbidden) {
			t.Errorf("foundation contains forbidden cutover/destructive/content contract %q", forbidden)
		}
	}
}
