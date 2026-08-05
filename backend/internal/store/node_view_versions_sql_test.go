package store

import (
	"os"
	"strings"
	"testing"
)

func TestNodeViewFastPathSQLCoversCanonicalDependencies(t *testing.T) {
	migrationBytes, err := os.ReadFile("../../db/migrations/20260712_node_view_fast_path.sql")
	if err != nil {
		t.Fatalf("ReadFile migration: %v", err)
	}
	migration := strings.ToLower(string(migrationBytes))
	for _, required := range []string{
		"create table if not exists node_view_versions",
		"create table if not exists node_view_user_versions",
		"trg_node_view_version_projection",
		"trg_node_view_version_relationships",
		"trg_node_view_version_logic_gate_assignments",
		"trg_node_view_version_account_assignments",
		"trg_node_view_version_accounts_update",
		"trg_node_view_user_version_change_seen_mutation",
		"trg_node_view_user_version_snapshots",
		"trg_node_view_version_gvic_assignments",
		"trg_node_view_version_permissions",
		"trg_node_view_version_permission_revisions",
		"trg_node_view_version_permission_applications",
		"trg_node_view_version_explorer_items",
		"trg_node_view_version_explorer_folder_update",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("node-view migration missing %q", required)
		}
	}
}

func TestNodeViewVersionAndAnchorQueriesStayOffRealtimeSequences(t *testing.T) {
	sourceBytes, err := os.ReadFile("postgres_node_view_versions.go")
	if err != nil {
		t.Fatalf("ReadFile postgres node view source: %v", err)
	}
	source := strings.ToLower(string(sourceBytes))
	for _, required := range []string{
		"from nodes node",
		"left join node_view_versions shared",
		"left join node_view_user_versions actor",
		"select set_config('mangorts.node_view_anchor_clean', '1', true)",
		"insert into node_textbox_seen_snapshots as snapshot",
		"textbox.updated_timestamp",
		"not exists (",
		"from node_content_changes change",
		"from node_content_change_seen seen_change",
		"on conflict (company_id, node_id, textbox_id, user_id)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("node-view repository source missing %q", required)
		}
	}
	for _, forbidden := range []string{"event_rows", "currenteventrowsequence", "editorsequence"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("node-view repository source depends on forbidden realtime state %q", forbidden)
		}
	}

	viewSourceBytes, err := os.ReadFile("consolidated_views.go")
	if err != nil {
		t.Fatalf("ReadFile consolidated view source: %v", err)
	}
	if strings.Contains(strings.ToLower(string(viewSourceBytes)), "marknodecontentchangeseen") {
		t.Fatal("canonical node view still writes seen state")
	}
}
