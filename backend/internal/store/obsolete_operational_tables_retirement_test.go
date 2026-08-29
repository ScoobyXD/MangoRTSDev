package store

import (
	"os"
	"strings"
	"testing"
)

func TestObsoleteOperationalTablesAreRetiredByTheMigration(t *testing.T) {
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
		drop := "drop table if exists public." + table + ";"
		if strings.Count(migration, drop) != 1 {
			t.Errorf("retirement migration must drop %s exactly once", table)
		}
	}
	if strings.Count(migration, "drop table if exists public.") != len(tables) {
		t.Errorf("retirement migration contains %d public table drops, want exactly %d", strings.Count(migration, "drop table if exists public."), len(tables))
	}
	for _, forbidden := range []string{
		" cascade",
		"schema_migrations",
		"retire_unused_operational_tables_preflight",
		"human-gated",
		"begin;",
		"commit;",
	} {
		if strings.Contains(migration, forbidden) {
			t.Errorf("retirement migration contains obsolete or unsafe text %q", forbidden)
		}
	}

	for _, path := range []string{
		"../../../scripts/retire_unused_operational_tables_preflight.sql",
		"../../../scripts/retire_unused_operational_tables.sql",
	} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("obsolete manual retirement script still exists at %s", path)
		}
	}
}
