package store

import (
	"strings"
	"testing"
)

const processMapNestedCapacityMigration = "20260902_process_map_nested_layout_capacity.sql"

func TestProcessMapNestedCapacityMigrationKeepsIntegerStorageAndOnlyChangesConstraint(t *testing.T) {
	migration := strings.ToLower(readProcessMapMigrationTestFile(t, "..", "..", "db", "migrations", processMapNestedCapacityMigration))
	for _, forbidden := range []string{"\nupdate ", "\ninsert ", "\ndelete ", "\ntruncate ", "alter column", "\\set", "\\i "} {
		if strings.Contains(migration, forbidden) {
			t.Fatalf("capacity-only migration contains %q", forbidden)
		}
	}
	if !strings.Contains(migration, "server_number < 170000 or server_number >= 190000") ||
		!strings.Contains(migration, "raise notice") || !strings.Contains(migration, "stop:") {
		t.Fatal("capacity migration must report the server version and stop outside PostgreSQL 17.x/18.x")
	}
	canonical := readProcessMapMigrationTestFile(t, "..", "..", "db", "schema.sql")
	for _, column := range []string{"grid_x", "grid_y", "grid_width", "grid_height"} {
		if !strings.Contains(canonical, column+" integer") {
			t.Fatalf("canonical Process Map geometry lost integer column %s", column)
		}
	}
	for name, source := range map[string]string{"migration": migration, "canonical schema": canonical} {
		compact := strings.Join(strings.Fields(source), "")
		for _, bound := range []string{"grid_width<=250000000", "grid_height<=250000000"} {
			if !strings.Contains(compact, bound) {
				t.Fatalf("%s is missing %s", name, bound)
			}
		}
	}
}

func TestPostgresProcessMapNestedCapacityMigrationPreservesSavedRowsAndWorldBounds(t *testing.T) {
	db := openPostgresProcessMapTestDatabase(t)
	canonical := readProcessMapMigrationTestFile(t, "..", "..", "db", "schema.sql")
	start := strings.Index(canonical, "CREATE TABLE public.process_map_placements (")
	if start < 0 {
		t.Fatal("canonical placement table is missing")
	}
	end := strings.Index(canonical[start:], "\n);")
	if end < 0 {
		t.Fatal("canonical placement table is incomplete")
	}
	// Reproduce the previous cap on the otherwise-current table. This fixture
	// isolates the constraint migration from unrelated source-resource triggers.
	previousTable := strings.ReplaceAll(canonical[start:start+end+3], "250000000", "1000000")
	if _, err := db.Exec(previousTable + `
insert into public.process_map_placements (
  company_id,resource_type,resource_id,grid_x,grid_y,grid_width,grid_height,
  revision,created_timestamp,updated_timestamp
) values (
  '10000000-0000-4000-8000-000000000001','company_explorer_folder',
  '20000000-0000-4000-8000-000000000001',-250,75,900,600,7,
  '2026-09-01T12:00:00Z','2026-09-01T13:00:00Z'
);
create table public.process_map_traces (
  route_points jsonb not null, revision bigint not null,
  updated_timestamp timestamptz not null
);
insert into public.process_map_traces values (
  '[{"x":-100,"y":100},{"x":100,"y":100}]',5,'2026-09-01T13:00:00Z'
);`); err != nil {
		t.Fatal(err)
	}
	readSavedRows := func() string {
		t.Helper()
		var saved string
		if err := db.QueryRow(`select jsonb_build_object(
  'placements',(select jsonb_agg(to_jsonb(placement)) from public.process_map_placements placement),
  'traces',(select jsonb_agg(to_jsonb(trace)) from public.process_map_traces trace)
)::text`).Scan(&saved); err != nil {
			t.Fatal(err)
		}
		return saved
	}
	migration := readProcessMapMigrationTestFile(t, "..", "..", "db", "migrations", processMapNestedCapacityMigration)
	before := readSavedRows()
	if _, err := db.Exec(migration); err != nil {
		t.Fatal(err)
	}
	if after := readSavedRows(); after != before {
		t.Fatalf("capacity migration changed saved placements or traces:\nbefore=%s\nafter=%s", before, after)
	}
	var integerColumns int
	if err := db.QueryRow(`select count(*) from pg_attribute
where attrelid='public.process_map_placements'::regclass and not attisdropped
  and attname in ('grid_x','grid_y','grid_width','grid_height')
  and atttypid='integer'::regtype`).Scan(&integerColumns); err != nil || integerColumns != 4 {
		t.Fatalf("integer geometry column count=%d err=%v", integerColumns, err)
	}
	for _, size := range [][2]int{{234881024, 134217728}, {250000000, 250000000}} {
		if _, err := db.Exec(`update public.process_map_placements
set grid_x=-1000000000,grid_y=750000000,grid_width=$1,grid_height=$2`, size[0], size[1]); err != nil {
			t.Fatalf("valid enlarged geometry %v: %v", size, err)
		}
	}
	before = readSavedRows()
	if _, err := db.Exec(migration); err != nil {
		t.Fatalf("rerun capacity migration: %v", err)
	}
	if after := readSavedRows(); after != before {
		t.Fatal("rerunning the capacity migration changed enlarged manual geometry or traces")
	}
	for _, assignment := range []string{
		"grid_width=250000001", "grid_height=250000001",
		"grid_width=0", "grid_height=0",
		"grid_x=-1000000001", "grid_y=-1000000001",
		"grid_x=750000001", "grid_y=750000001",
	} {
		if _, err := db.Exec("update public.process_map_placements set " + assignment); err == nil {
			t.Fatalf("invalid geometry accepted: %s", assignment)
		}
	}
	if after := readSavedRows(); after != before {
		t.Fatal("a rejected geometry update changed saved rows")
	}
}
