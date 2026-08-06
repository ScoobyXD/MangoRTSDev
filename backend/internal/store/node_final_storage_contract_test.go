package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readNodeFinalContractFile(t *testing.T, parts ...string) string {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(parts...))
	if err != nil {
		t.Fatal(err)
	}
	return strings.ToLower(string(body))
}

func TestNodeProductionSQLUsesOnlyFinalStorage(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		body := readNodeFinalContractFile(t, entry.Name())
		for _, legacy := range []string{
			"node_information", "node_projection_table", "node_projection_seen_snapshots",
			"node_content_changes", "node_content_change_seen", "node_textbox_seen_snapshots",
		} {
			for _, prefix := range []string{"from ", "join ", "into ", "update ", "delete from ", "on "} {
				if strings.Contains(body, prefix+legacy) {
					t.Errorf("%s contains legacy SQL %q", entry.Name(), prefix+legacy)
				}
			}
		}
	}
	final := readNodeFinalContractFile(t, "postgres_node_final_storage.go")
	for _, required := range []string{
		"from node_textboxes textbox", "from email_relationships relationship",
		"listpostgresnodetextboxchatprojections", "relationship.resource_textbox_id",
		"mangorts_user_can_access_resource", "from attachment_relationships link",
	} {
		if !strings.Contains(final, required) {
			t.Errorf("final Node storage missing %q", required)
		}
	}
	readiness := readNodeFinalContractFile(t, "postgres.go")
	for _, required := range []string{"node_textboxes", "node_textbox_chats", "node_textboxes_history", "textbox_id"} {
		if !strings.Contains(readiness, required) {
			t.Errorf("application readiness missing final Node contract %q", required)
		}
	}
	for _, retired := range []string{"node_content_changes", "node_content_change_seen", "node_textbox_seen_snapshots"} {
		if strings.Contains(readiness, retired) {
			t.Errorf("application readiness still requires retired Node unread storage %q", retired)
		}
	}
}

func TestNodeFinalSchemaAndRetiredObjectContract(t *testing.T) {
	schema := readNodeFinalContractFile(t, "..", "..", "db", "schema.sql")
	retired := []string{
		"communications_email_drafts", "communications_email_collaboration_participants",
		"communications_email_collaborations", "communications_email_node_attachments",
		"communications_email_nodes", "communications_node_email_threads",
		"communications_email_thread_download_jobs", "communications_email_messages",
		"communications_email_signatures", "communications_email_threads",
		"attachment_migration_items", "attachment_migration_runs", "attachment_variants",
		"resource_attachments", "attachment_upload_intents", "project_projection_table",
		"project_information", "logic_gate_projection_table", "logic_gate_information",
		"node_information", "node_projection_table", "node_projection_seen_snapshots",
		"node_content_changes", "node_content_change_seen", "node_textbox_seen_snapshots",
	}
	for _, table := range retired {
		if strings.Contains(schema, "create table if not exists "+table) {
			t.Errorf("canonical schema recreates retired table %s", table)
		}
	}
	for _, obsolete := range []string{"create type information_type", "v3_email_migration_runs", "v3_email_migration_items"} {
		if strings.Contains(schema, obsolete) {
			t.Errorf("canonical final schema retains obsolete migration contract %q", obsolete)
		}
	}
	for _, required := range []string{
		"create table if not exists node_textboxes", "create table if not exists node_textbox_chats",
		"create table if not exists node_textboxes_history", "textbox_id uuid not null",
		"references node_textboxes(company_id, node_id, textbox_id) on delete cascade",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("canonical schema missing %q", required)
		}
	}
}

func TestNodeUnreadHighlightRetirementSQLIsStrictAndDBeaverSafe(t *testing.T) {
	migration := readNodeFinalContractFile(t, "..", "..", "db", "migrations", "20260805_zzzzz_remove_node_unread_highlights.sql")
	for _, required := range []string{
		"server_version_num", "exact unordered column set drifted", "unexpected foreign key",
		"drop trigger trg_node_view_user_version_change_seen_mutation",
		"drop trigger trg_node_view_user_version_snapshots",
		"drop table public.node_content_change_seen;",
		"drop table public.node_textbox_seen_snapshots;",
		"drop constraint node_content_changes_textbox_fk;",
		"drop table public.node_content_changes;",
		"drop function public.mangorts_trg_bump_node_view_user_from_change_seen();",
		"drop function public.mangorts_trg_bump_node_view_user_from_snapshot();",
	} {
		if !strings.Contains(migration, required) {
			t.Errorf("Node unread-highlight retirement migration missing %q", required)
		}
	}
	for _, forbidden := range []string{"\\set", "\\i", "\\copy", "drop table if exists", " cascade", "ordinal_position", "update public.node_textboxes", "delete from public.node_textboxes"} {
		if strings.Contains(migration, forbidden) {
			t.Errorf("Node unread-highlight retirement migration contains forbidden %q", forbidden)
		}
	}

	preflight := readNodeFinalContractFile(t, "..", "..", "..", "scripts", "node_unread_highlights_retirement_preflight.sql")
	verification := readNodeFinalContractFile(t, "..", "..", "..", "scripts", "node_unread_highlights_retirement_verification.sql")
	for label, source := range map[string]string{"preflight": preflight, "verification": verification} {
		for _, required := range []string{"repeatable read read only", "server_version_num", "current_json_checksum", "history_json_checksum", "dormant_change_annotations", "rollback;"} {
			if !strings.Contains(source, required) {
				t.Errorf("Node unread-highlight %s missing %q", label, required)
			}
		}
		for _, forbidden := range []string{"\\set", "\\i", "\\copy", "ordinal_position"} {
			if strings.Contains(source, forbidden) {
				t.Errorf("Node unread-highlight %s contains forbidden %q", label, forbidden)
			}
		}
	}
}

func TestNodeForwardMigrationAndOperatorAreStrictAndDBeaverSafe(t *testing.T) {
	preflight := readNodeFinalContractFile(t, "..", "..", "..", "scripts", "v3_node_final_runtime_preflight.sql")
	for _, required := range []string{
		"server_version_num", "postgresql 17.x only", "repeatable read read only",
		"node_information exact unordered column set drifted",
		"node_projection_table exact unordered column set drifted",
		"node_projection_seen_snapshots exact unordered column set drifted",
		"ready_for_paused_writer_final_delta", "active_legacy_textboxes_to_copy",
		"stale_seen_snapshots_to_remove", "seen_snapshots_to_migrate_after_copy",
	} {
		if !strings.Contains(preflight, required) {
			t.Errorf("Node final preflight missing %q", required)
		}
	}
	if strings.Contains(preflight, "ordinal_position") {
		t.Error("Node final preflight must not compare physical column order")
	}
	migration := readNodeFinalContractFile(t, "..", "..", "db", "migrations", "20260804_zzzzzz_node_final_storage_cutover.sql")
	for _, required := range []string{
		"server_version_num", "lock table node_projection_table in share mode",
		"lock table node_projection_seen_snapshots in share row exclusive mode",
		"lock table node_content_changes", "rename column information_id to textbox_id",
		"node_textbox_seen_snapshots", "seen-snapshot identity copy did not reconcile exactly",
		"textbox_revision", "node_content_changes_textbox_fk",
		"mangorts_node_projection_body", "mangorts_node_final_textbox_delta",
		"insert into node_textboxes", "stale_seen_snapshots_removed",
		"active_legacy_textboxes_copied", "delta_seen_snapshots_migrated",
		"total_legacy_seen_snapshots_migrated",
	} {
		if !strings.Contains(migration, required) {
			t.Errorf("forward migration missing %q", required)
		}
	}
	deleteStart := strings.Index(migration, "delete from node_projection_seen_snapshots seen")
	if deleteStart < 0 {
		t.Fatal("forward migration missing bounded stale seen-snapshot delete")
	}
	deleteEnd := strings.Index(migration[deleteStart:], "returning 1")
	if deleteEnd < 0 {
		t.Fatal("forward migration missing bounded stale seen-snapshot delete")
	}
	deleteClause := migration[deleteStart : deleteStart+deleteEnd]
	if strings.Count(deleteClause, "not exists(") < 4 ||
		!strings.Contains(deleteClause, "from node_projection_table") ||
		!strings.Contains(deleteClause, "from node_textboxes") ||
		!strings.Contains(deleteClause, "from node_information") ||
		!strings.Contains(deleteClause, "from node_content_changes") ||
		!strings.Contains(deleteClause, "from nodes parent") {
		t.Error("stale seen-snapshot delete must require a current Node plus no exact projection, final textbox, history, or content change")
	}
	if strings.Contains(migration, "update node_textboxes") {
		t.Error("writer-paused delta must not overwrite textboxes already present in final storage")
	}
	operator := readNodeFinalContractFile(t, "..", "..", "db", "migrations", "20260805_retire_node_legacy_storage.sql")
	for _, required := range []string{
		"copy_verified", "no_current_writer_verified", "smoke_and_recycle_verified",
		"soak_and_snapshot_confirmed", "operator_approved", "server_version_num",
		"exact unordered column set drifted", "a view still references legacy node storage",
		"a function still references legacy node storage", "drop table node_information;",
		"drop table node_projection_table;", "drop table node_projection_seen_snapshots;",
	} {
		if !strings.Contains(operator, required) {
			t.Errorf("Node operator retirement missing %q", required)
		}
	}
	for _, forbidden := range []string{"\\set", "\\i", "\\copy", "drop table if exists", "drop table node_information cascade", "drop table node_projection_table cascade", "ordinal_position"} {
		if strings.Contains(operator, forbidden) {
			t.Errorf("Node operator retirement contains forbidden %q", forbidden)
		}
	}
}

func TestNodeRecycleUsesFinalRowsAndRestoresAttachmentOwnershipLast(t *testing.T) {
	source := readNodeFinalContractFile(t, "postgres_recycle_bin.go")
	for _, required := range []string{
		`"node_textbox_chats"`, `"email_relationships"`, `"attachment_relationships"`,
		"set deleted_timestamp=restored.deleted_timestamp",
	} {
		if !strings.Contains(source, required) {
			t.Errorf("Node recycle contract missing %q", required)
		}
	}
	for _, retired := range []string{`"node_textbox_seen_snapshots"`, `"node_content_changes"`, `"node_content_change_seen"`} {
		if strings.Contains(source, retired) {
			t.Errorf("Node recycle contract still references retired unread storage %q", retired)
		}
	}
	order := []string{`"node_textboxes"`, `"node_textbox_chats"`, `"email_relationships"`, `"attachment_relationships"`}
	last := -1
	for _, value := range order {
		next := strings.Index(source[last+1:], value)
		if next < 0 {
			t.Fatalf("restore order missing %s", value)
		}
		last += next + 1
	}
}
