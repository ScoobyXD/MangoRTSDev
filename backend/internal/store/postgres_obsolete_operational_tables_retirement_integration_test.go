package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

const obsoleteOperationalTablesFixtureSQL = `
create table public.user_logic_gate_shortcuts (id bigint primary key);
create table public.workspace_derived_domain_event_projection_checkpoints (id bigint primary key);
create table public.process_map_actual_size_layout_recovery_placements (id bigint primary key);
create table public.process_map_actual_size_layout_recovery_runs (id bigint primary key);
create table public.obsolete_operational_tables_unrelated (id bigint primary key);`

func prepareObsoleteOperationalTablesFixture(t *testing.T) *sql.DB {
	t.Helper()
	db, _ := openPostgresProcessMapIntegration(t)
	if _, err := db.Exec(obsoleteOperationalTablesFixtureSQL); err != nil {
		t.Fatalf("create obsolete operational table fixture: %v", err)
	}
	return db
}

func readObsoleteOperationalTablesMigration(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260828_zz_retire_unused_operational_tables.sql"))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func countObsoleteOperationalTables(t *testing.T, db *sql.DB) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`
select count(*)
from (values
  (to_regclass('public.user_logic_gate_shortcuts')),
  (to_regclass('public.workspace_derived_domain_event_projection_checkpoints')),
  (to_regclass('public.process_map_actual_size_layout_recovery_placements')),
  (to_regclass('public.process_map_actual_size_layout_recovery_runs'))
) target(relation)
where relation is not null`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestPostgresObsoleteOperationalTablesRetirementMigration(t *testing.T) {
	db := prepareObsoleteOperationalTablesFixture(t)
	migration := readObsoleteOperationalTablesMigration(t)

	for attempt := 1; attempt <= 2; attempt++ {
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(migration); err != nil {
			_ = tx.Rollback()
			t.Fatalf("run retirement migration attempt %d: %v", attempt, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit retirement migration attempt %d: %v", attempt, err)
		}
		if remaining := countObsoleteOperationalTables(t, db); remaining != 0 {
			t.Fatalf("retirement attempt %d left %d target tables", attempt, remaining)
		}
	}

	var unrelatedPresent bool
	if err := db.QueryRow(`select to_regclass('public.obsolete_operational_tables_unrelated') is not null`).Scan(&unrelatedPresent); err != nil {
		t.Fatal(err)
	}
	if !unrelatedPresent {
		t.Fatal("retirement removed an unrelated table")
	}
}
