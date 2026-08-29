package store

import (
	"os"
	"strings"
	"testing"
)

func TestObsoleteOperationalTablesAreStrictlyRetired(t *testing.T) {
	read := func(path string) string {
		t.Helper()
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return strings.ToLower(string(raw))
	}

	schema := read("../../db/schema.sql")
	migration := read("../../db/migrations/20260828_zz_retire_unused_operational_tables.sql")
	preflight := read("../../../scripts/retire_unused_operational_tables_preflight.sql")
	operator := read("../../../scripts/retire_unused_operational_tables.sql")
	tables := []string{
		"user_logic_gate_shortcuts",
		"workspace_derived_domain_event_projection_checkpoints",
		"process_map_actual_size_layout_recovery_placements",
		"process_map_actual_size_layout_recovery_runs",
	}

	for _, table := range tables {
		if strings.Contains(schema, "create table public."+table) {
			t.Errorf("canonical schema still creates retired table %s", table)
		}
		strictDrop := "drop table public." + table + ";"
		if strings.Contains(migration, strictDrop) || strings.Contains(preflight, strictDrop) {
			t.Errorf("a non-destructive retirement path drops %s", table)
		}
		if strings.Count(operator, strictDrop) != 1 {
			t.Errorf("operator script must strictly drop %s exactly once", table)
		}
	}

	if strings.Contains(migration, "drop table") {
		t.Error("human-gated migration sentinel contains destructive DDL")
	}
	if strings.Contains(preflight, "drop table") {
		t.Error("read-only preflight contains destructive DDL")
	}
	if strings.Count(operator, "drop table public.") != len(tables) {
		t.Errorf("operator contains %d strict public table drops, want exactly %d", strings.Count(operator, "drop table public."), len(tables))
	}
	for _, required := range []string{
		"human-gated retirement sentinel",
		"retire_unused_operational_tables_preflight.sql",
		"retire_unused_operational_tables.sql",
		"this migration never drops tables",
	} {
		if !strings.Contains(migration, required) {
			t.Errorf("migration sentinel missing %q", required)
		}
	}

	for label, sql := range map[string]string{"migration": migration, "preflight": preflight, "operator": operator} {
		for _, forbidden := range []string{"drop table if exists", "drop table public.user_logic_gate_shortcuts cascade", "\\set", "\\i", "\\copy", "ordinal_position"} {
			if strings.Contains(sql, forbidden) {
				t.Errorf("%s contains forbidden %q", label, forbidden)
			}
		}
	}

	for _, required := range []string{
		"values (false,false,false,false,false)",
		"read_only_preflight_confirmed",
		"shortcut_free_application_deployed",
		"old_application_instances_stopped",
		"restorable_snapshot_confirmed",
		"pg_advisory_xact_lock(4855156563379734401)",
		"mangorts_unused_table_expected_columns",
		"mangorts_unused_table_expected_constraints",
		"select * from mangorts_unused_table_expected_columns except select * from actual",
		"select * from actual except select * from mangorts_unused_table_expected_columns",
		"exact index count drifted",
		"shortcut ordering index identity drifted",
		"workspace_derived_projection_requested",
		"insert into public.schema_migrations(version)",
		"20260828_zz_retire_unused_operational_tables.sql",
		"commit;",
	} {
		if !strings.Contains(operator, required) {
			t.Errorf("operator script missing %q", required)
		}
	}

	for _, required := range []string{
		"begin transaction isolation level repeatable read read only",
		"not current_setting('transaction_read_only')::boolean",
		"also_in_raci_tabs",
		"relevant_events_beyond_checkpoint",
		"pg_get_constraintdef",
		"pg_get_indexdef",
		"rollback;",
	} {
		if !strings.Contains(preflight, required) {
			t.Errorf("read-only preflight missing %q", required)
		}
	}
}
