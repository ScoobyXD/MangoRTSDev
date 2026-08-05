package store

import (
	"os"
	"strings"
	"testing"
)

func readMapRemovalContractFile(t *testing.T, parts ...string) string {
	t.Helper()
	path := strings.Join(parts, string(os.PathSeparator))
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return strings.ToLower(string(data))
}

func TestCanonicalSchemaOmitsRetiredPositionStorageAndKeepsProtectedNodeContracts(t *testing.T) {
	schema := readMapRemovalContractFile(t, "..", "..", "db", "schema.sql")
	for _, retired := range []string{"create table if not exists node_map_positions", "create table if not exists logic_gate_map_positions", "idx_node_map_positions_company_updated", "idx_logic_gate_map_positions_company_updated"} {
		if strings.Contains(schema, retired) {
			t.Errorf("canonical schema still contains retired contract %q", retired)
		}
	}
	for _, protected := range []string{"node_relationships", "logic_gate_relationships", "node_textboxes_history", "logic_gate_textboxes_history", "node_content_changes", "node_content_change_seen", "node_textbox_seen_snapshots", "node_view_user_versions"} {
		if !strings.Contains(schema, "create table if not exists "+protected) {
			t.Errorf("canonical schema lost protected table %q", protected)
		}
	}
}

func TestMapRemovalForwardMigrationIsNonDestructive(t *testing.T) {
	migration := readMapRemovalContractFile(t, "..", "..", "db", "migrations", "20260805_zz_remove_map_runtime_contracts.sql")
	for _, required := range []string{"workspace_static_read_version_keys", "workspace_read_version_keys_for_domain_event", "workspace-snapshot:node_map", "workspace-snapshot:logic_gate_map", "map-layout:node", "map-layout:logic_gate"} {
		if !strings.Contains(migration, required) {
			t.Errorf("forward migration missing retired read-version contract %q", required)
		}
	}
	if strings.Contains(migration, "drop table") {
		t.Error("normal forward migration must not drop position tables")
	}
}

func TestMapPositionOperatorSQLIsDefaultDenyAndExact(t *testing.T) {
	preflight := readMapRemovalContractFile(t, "..", "..", "..", "scripts", "map_position_storage_retirement_preflight.sql")
	operator := readMapRemovalContractFile(t, "..", "..", "..", "scripts", "retire_map_position_storage.sql")
	for _, required := range []string{"begin transaction isolation level repeatable read read only", "server_version_num", "170000", "180000", "workspace_derived_domain_event_projection_checkpoints", "node_map_position_upsert", "logic_gate_map_position_upsert", "exact unordered column set drifted", "ready_for_separately_approved_map_position_retirement", "rollback;"} {
		if !strings.Contains(preflight, required) {
			t.Errorf("preflight missing %q", required)
		}
	}
	for _, required := range []string{"values (false,false,false,false,false,false)", "map_free_application_deployed", "old_writers_stopped", "operator_approved", "drop table public.node_map_positions;", "drop table public.logic_gate_map_positions;", "workspace_derived_domain_event_projection_checkpoints", "exact unordered column set drifted", "commit;"} {
		if !strings.Contains(operator, required) {
			t.Errorf("operator SQL missing %q", required)
		}
	}
	if strings.Contains(operator, "drop table public.node_map_positions cascade") || strings.Contains(operator, "drop table public.logic_gate_map_positions cascade") {
		t.Error("operator SQL must never use CASCADE")
	}
	if strings.Count(operator, "drop table public.") != 2 {
		t.Errorf("operator SQL must drop exactly two public tables, got %d", strings.Count(operator, "drop table public."))
	}
}
