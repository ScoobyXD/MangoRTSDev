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
	logicGateRetirementBytes, err := os.ReadFile("../../db/operator_migrations/20260805_retire_logic_gate_legacy_storage.sql")
	if err != nil {
		t.Fatal(err)
	}
	logicGateRetirement := strings.ToLower(string(logicGateRetirementBytes))
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
		if !strings.Contains(logicGateRetirement, "drop table "+table+";") {
			t.Errorf("Logic Gate operator retirement does not strictly drop %s", table)
		}
	}
	nodeRetirementBytes, err := os.ReadFile("../../db/operator_migrations/20260805_retire_node_legacy_storage.sql")
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
	if strings.Contains(logicGateRetirement, "drop table if exists") || strings.Contains(logicGateRetirement, "drop table logic_gate_information cascade") {
		t.Error("Logic Gate retirement must refuse drift and must not use CASCADE")
	}
	for _, gate := range []string{"copy_verified", "no_current_writer_verified", "smoke_and_recycle_verified", "soak_and_snapshot_confirmed", "operator_approved"} {
		if !strings.Contains(logicGateRetirement, gate) {
			t.Errorf("Logic Gate retirement missing operator gate %q", gate)
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
	} {
		if strings.Contains(nodeBlock, forbidden) {
			t.Errorf("canonical node_textboxes retains obsolete column %s", forbidden)
		}
	}
	for _, required := range []string{
		"body_json jsonb not null",
		"revision bigint not null default 0",
		"display_order bigint not null default 0",
		"create table if not exists node_textbox_seen_snapshots",
		"create table if not exists node_textboxes_history",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("canonical schema missing retained structure %q", required)
		}
	}
}
