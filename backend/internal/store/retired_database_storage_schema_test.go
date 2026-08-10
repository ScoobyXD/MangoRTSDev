package store

import (
	"os"
	"strings"
	"testing"
)

func TestRetiredDatabaseStorageIsAbsentFromCanonicalSchemaAndStrictlyDropped(t *testing.T) {
	schemaBytes, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	migrationBytes, err := os.ReadFile("../../db/migrations/20260802_retire_node_v2_and_legacy_editor.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := strings.ToLower(string(schemaBytes))
	migration := strings.ToLower(string(migrationBytes))
	retiredTables := []string{
		"workspace_editor_formats",
		"editor_rollout_gates",
		"editor_conversion_runs",
		"editor_conversion_items",
		"editor_shadow_comparisons",
		"editor_rollback_exports",
		"editor_migration_runs",
		"editor_document_migrations",
		"editor_collaboration_documents",
		"editor_collaboration_operations",
		"node_textbox_comment_threads",
		"node_textbox_comments",
		"node_textbox_comment_mentions",
		"node_textbox_attachment_links",
		"node_textbox_comment_attachment_links",
		"node_textbox_email_links",
		"node_movements",
		"node_timeline_items",
		"node_verification_requests",
		"node_verification_recipients",
		"node_verification_events",
	}
	if len(retiredTables) != 21 {
		t.Fatalf("retired table contract count=%d", len(retiredTables))
	}
	for _, table := range retiredTables {
		if strings.Contains(schema, "create table if not exists "+table) {
			t.Errorf("canonical schema creates retired table %s", table)
		}
		if !strings.Contains(migration, "drop table "+table+";") {
			t.Errorf("retirement migration does not strictly drop %s", table)
		}
	}
	if strings.Contains(migration, "if exists") {
		t.Error("retirement migration must expose drift instead of silently skipping missing objects")
	}
	for _, table := range []string{"logic_gate_information", "logic_gate_projection_table"} {
		if strings.Contains(schema, "create table if not exists "+table) {
			t.Errorf("canonical schema creates retired Logic Gate table %s", table)
		}
	}
	nodeRetirementBytes, err := os.ReadFile("../../db/migrations/20260805_retire_node_legacy_storage.sql")
	if err != nil {
		t.Fatal(err)
	}
	nodeRetirement := strings.ToLower(string(nodeRetirementBytes))
	for _, table := range []string{"node_information", "node_projection_table", "node_projection_seen_snapshots"} {
		if strings.Contains(schema, "create table if not exists "+table) {
			t.Errorf("canonical schema creates retired Node table %s", table)
		}
		if !strings.Contains(nodeRetirement, "drop table "+table+";") {
			t.Errorf("Node operator retirement does not strictly drop %s", table)
		}
	}
	nodeStart := strings.Index(schema, "create table if not exists node_textboxes (")
	if nodeStart < 0 {
		t.Fatal("canonical current node_textboxes block not found")
	}
	nodeEnd := strings.Index(schema[nodeStart:], "create table if not exists project_textboxes (")
	if nodeEnd < 0 {
		t.Fatal("canonical current node_textboxes block not found")
	}
	nodeBlock := schema[nodeStart : nodeStart+nodeEnd]
	for _, forbidden := range []string{
		"source_information_id",
		"document_schema_version",
		"document_json",
		"plain_text",
		"content_revision",
		"created_by_user_id",
		"updated_by_user_id",
		"creation_idempotency_key",
		"source_html_sha256",
		"target_json_sha256",
		"conversion_run_id",
		"email_accent",
		"color text not null",
	} {
		if strings.Contains(nodeBlock, forbidden) {
			t.Errorf("canonical node_textboxes retains obsolete column %s", forbidden)
		}
	}
	for _, required := range []string{
		"body_json jsonb not null",
		"color text,",
		"constraint node_textboxes_color_chk check",
		"revision bigint not null default 0",
		"display_order bigint not null default 0",
		"create table if not exists node_textboxes_history",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("canonical schema missing retained structure %q", required)
		}
	}
	metadataMigrationBytes, err := os.ReadFile("../../db/migrations/20260810_node_textbox_metadata.sql")
	if err != nil {
		t.Fatal(err)
	}
	metadataMigration := strings.ToLower(string(metadataMigrationBytes))
	for _, required := range []string{
		"add column if not exists title text not null default ''",
		"add column if not exists color text",
		"alter column color drop default",
		"alter column color drop not null",
		"set color = null",
		"relationship.resource_textbox_id = textbox.textbox_id::text",
	} {
		if !strings.Contains(metadataMigration, required) {
			t.Errorf("consolidated Node textbox metadata migration missing %q", required)
		}
	}
	migrationEntries, err := os.ReadDir("../../db/migrations")
	if err != nil {
		t.Fatal(err)
	}
	var nodeTextboxMetadataMigrations []string
	for _, entry := range migrationEntries {
		name := strings.ToLower(entry.Name())
		if !entry.IsDir() && strings.HasPrefix(name, "20260810") && strings.Contains(name, "node_textbox") && strings.HasSuffix(name, ".sql") {
			nodeTextboxMetadataMigrations = append(nodeTextboxMetadataMigrations, entry.Name())
		}
	}
	if len(nodeTextboxMetadataMigrations) != 1 || nodeTextboxMetadataMigrations[0] != "20260810_node_textbox_metadata.sql" {
		t.Fatalf("Node textbox metadata migrations=%v, want one consolidated migration", nodeTextboxMetadataMigrations)
	}
	operatorBytes, err := os.ReadFile("../../../scripts/repair_node_textbox_metadata_color.sql")
	if err != nil {
		t.Fatal(err)
	}
	operator := strings.ToLower(string(operatorBytes))
	for _, required := range []string{
		"server_version_num",
		"stop: this script supports postgresql 17.x only",
		"alter column color drop default",
		"set color = null",
		"delete from public.schema_migrations",
		"20260810_node_textbox_metadata.sql",
	} {
		if !strings.Contains(operator, required) {
			t.Errorf("Node textbox metadata operator script missing %q", required)
		}
	}
	for _, forbidden := range []string{"\\set", "\\i", "\\copy", "ordinal_position"} {
		if strings.Contains(operator, forbidden) {
			t.Errorf("Node textbox metadata operator script contains forbidden %q", forbidden)
		}
	}
}
