package store

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const obsoleteOperationalTablesFixtureSQL = `
create table public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
create table public.user_logic_gate_shortcuts (
  user_id uuid not null,
  company_id uuid not null,
  logic_gate_id uuid not null,
  position integer not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (user_id, company_id, logic_gate_id),
  foreign key (user_id) references public.users (user_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references public.logic_gates (company_id, logic_gate_id) on delete cascade
);
create index idx_user_logic_gate_shortcuts_user_company_position
  on public.user_logic_gate_shortcuts(user_id, company_id, position, logic_gate_id);
create table public.workspace_derived_domain_event_projection_checkpoints (
  company_id uuid primary key,
  checkpoint_timestamp timestamptz not null,
  checkpoint_event_id uuid not null,
  updated_timestamp timestamptz not null default now()
);
create table public.process_map_actual_size_layout_recovery_placements (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  placement_incarnation_token uuid not null,
  map_parent_folder_id uuid,
  before_grid_x integer not null,
  before_grid_y integer not null,
  before_grid_width integer not null,
  before_grid_height integer not null,
  before_revision bigint not null,
  before_created_timestamp timestamptz not null,
  before_updated_timestamp timestamptz not null,
  expected_grid_x integer not null,
  expected_grid_y integer not null,
  expected_grid_width integer not null,
  expected_grid_height integer not null,
  expected_revision bigint not null,
  expected_created_timestamp timestamptz not null,
  expected_updated_timestamp timestamptz not null,
  changed_by_migration boolean not null,
  constraint process_map_actual_size_layout_recovery_placements_pkey
    primary key (company_id, resource_type, resource_id)
);
create table public.process_map_actual_size_layout_recovery_runs (
  company_id uuid primary key,
  recovery_key text not null,
  format_version integer not null,
  status text not null,
  marker_event_id uuid not null,
  marker_sequence bigint not null,
  marker_created_timestamp timestamptz not null,
  placement_count bigint not null,
  changed_placement_count bigint not null,
  placement_checksum text not null,
  created_timestamp timestamptz not null,
  rollback_event_id uuid,
  rollback_sequence bigint,
  rolled_back_timestamp timestamptz,
  constraint pm_actual_size_recovery_runs_format_chk check (format_version = 1),
  constraint pm_actual_size_recovery_runs_status_chk check (status in ('applied','rolled_back')),
  constraint pm_actual_size_recovery_runs_counts_chk
    check (placement_count >= 0 and changed_placement_count >= 0 and changed_placement_count <= placement_count),
  constraint pm_actual_size_recovery_runs_rollback_state_chk
    check ((status = 'applied' and rollback_event_id is null and rollback_sequence is null and rolled_back_timestamp is null)
       or (status = 'rolled_back' and rollback_event_id is not null and rollback_sequence is not null and rolled_back_timestamp is not null))
);`

func prepareObsoleteOperationalTablesFixture(t *testing.T) *sql.DB {
	t.Helper()
	db, _ := openPostgresProcessMapIntegration(t)
	if _, err := db.Exec(obsoleteOperationalTablesFixtureSQL); err != nil {
		t.Fatalf("create obsolete operational table fixture: %v", err)
	}
	return db
}

func readObsoleteOperationalTablesSQL(t *testing.T, path ...string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(path...))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func runRetirementOperator(t *testing.T, db *sql.DB, sqlText string) error {
	t.Helper()
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, err = conn.ExecContext(context.Background(), sqlText)
	if err != nil {
		_, _ = conn.ExecContext(context.Background(), "rollback")
	}
	return err
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

func retirementSentinelRecorded(t *testing.T, db *sql.DB) bool {
	t.Helper()
	var recorded bool
	if err := db.QueryRow(`select exists(select 1 from public.schema_migrations where version='20260828_zz_retire_unused_operational_tables.sql')`).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	return recorded
}

func TestPostgresObsoleteOperationalTablesRetirementIsHumanGatedAndExact(t *testing.T) {
	operator := readObsoleteOperationalTablesSQL(t, "..", "..", "..", "scripts", "retire_unused_operational_tables.sql")
	preflight := readObsoleteOperationalTablesSQL(t, "..", "..", "..", "scripts", "retire_unused_operational_tables_preflight.sql")
	approved := strings.Replace(operator, "values (false,false,false,false,false);", "values (true,true,true,true,true);", 1)
	if approved == operator {
		t.Fatal("operator approval marker not found")
	}

	t.Run("default approvals refuse without writes", func(t *testing.T) {
		db := prepareObsoleteOperationalTablesFixture(t)
		err := runRetirementOperator(t, db, operator)
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "five retirement approvals") {
			t.Fatalf("default operator error = %v, want approval refusal", err)
		}
		var present bool
		if err := db.QueryRow(`select to_regclass('public.user_logic_gate_shortcuts') is not null`).Scan(&present); err != nil || !present {
			t.Fatalf("default refusal changed shortcut table: present=%t err=%v", present, err)
		}
	})

	t.Run("read-only preflight executes without writes", func(t *testing.T) {
		db := prepareObsoleteOperationalTablesFixture(t)
		if _, err := db.Exec(preflight); err != nil {
			t.Fatalf("run read-only preflight: %v", err)
		}
		if remaining := countObsoleteOperationalTables(t, db); remaining != 4 {
			t.Fatalf("preflight left %d target tables, want all 4", remaining)
		}
		if retirementSentinelRecorded(t, db) {
			t.Fatal("read-only preflight recorded the retirement sentinel")
		}
	})

	t.Run("schema drift refuses without writes", func(t *testing.T) {
		db := prepareObsoleteOperationalTablesFixture(t)
		if _, err := db.Exec(`alter table public.user_logic_gate_shortcuts add column unexpected text`); err != nil {
			t.Fatal(err)
		}
		err := runRetirementOperator(t, db, approved)
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "column/type/nullability/default set drifted") {
			t.Fatalf("drifted operator error = %v, want exact-schema refusal", err)
		}
		var present bool
		if err := db.QueryRow(`select to_regclass('public.user_logic_gate_shortcuts') is not null`).Scan(&present); err != nil || !present {
			t.Fatalf("schema refusal changed shortcut table: present=%t err=%v", present, err)
		}
	})

	t.Run("pending derived event refuses without writes", func(t *testing.T) {
		db := prepareObsoleteOperationalTablesFixture(t)
		const companyID = "a1000000-0000-4000-8000-000000000001"
		if _, err := db.Exec(`
insert into public.companies(company_id,name)
values ($1::uuid,'Retirement pending event fixture');
insert into public.domain_events(
  event_id,company_id,stream_type,stream_id,sequence,event_type,payload
) values (
  'a1000000-0000-7000-8000-000000000002'::uuid,
  $1::uuid,'workspace',$1,1,'logic_gate_map_position_upsert_requested','{}'::jsonb
)`, companyID); err != nil {
			t.Fatal(err)
		}
		err := runRetirementOperator(t, db, approved)
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "historical derived-projection task") {
			t.Fatalf("pending-event operator error = %v, want pending-event refusal", err)
		}
		if remaining := countObsoleteOperationalTables(t, db); remaining != 4 {
			t.Fatalf("pending-event refusal left %d target tables, want all 4", remaining)
		}
		if retirementSentinelRecorded(t, db) {
			t.Fatal("pending-event refusal recorded the retirement sentinel")
		}
	})

	t.Run("migration advisory lock serializes retirement", func(t *testing.T) {
		db := prepareObsoleteOperationalTablesFixture(t)
		lockConn, err := db.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer lockConn.Close()
		if _, err := lockConn.ExecContext(context.Background(), `select pg_advisory_lock(4855156563379734401)`); err != nil {
			t.Fatal(err)
		}
		defer func() {
			_, _ = lockConn.ExecContext(context.Background(), `select pg_advisory_unlock(4855156563379734401)`)
		}()

		shortTimeout := strings.Replace(approved, "set local lock_timeout = '10s';", "set local lock_timeout = '100ms';", 1)
		if shortTimeout == approved {
			t.Fatal("operator lock timeout marker not found")
		}
		err = runRetirementOperator(t, db, shortTimeout)
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "lock timeout") {
			t.Fatalf("contended operator error = %v, want advisory lock timeout", err)
		}
		if remaining := countObsoleteOperationalTables(t, db); remaining != 4 {
			t.Fatalf("lock refusal left %d target tables, want all 4", remaining)
		}
		if retirementSentinelRecorded(t, db) {
			t.Fatal("lock refusal recorded the retirement sentinel")
		}
	})

	t.Run("approved exact retirement is atomic", func(t *testing.T) {
		db := prepareObsoleteOperationalTablesFixture(t)
		if err := runRetirementOperator(t, db, approved); err != nil {
			t.Fatalf("run approved retirement: %v", err)
		}
		remaining := countObsoleteOperationalTables(t, db)
		if remaining != 0 {
			t.Fatalf("retirement left %d target tables", remaining)
		}
		if !retirementSentinelRecorded(t, db) {
			t.Fatal("retirement did not record the migration sentinel")
		}
	})
}

func TestPostgresObsoleteOperationalTablesMigrationIsOnlyASentinel(t *testing.T) {
	db := prepareObsoleteOperationalTablesFixture(t)
	migration := readObsoleteOperationalTablesSQL(t, "..", "..", "db", "migrations", "20260828_zz_retire_unused_operational_tables.sql")
	if _, err := db.Exec(migration); err == nil || !strings.Contains(strings.ToLower(err.Error()), "human-gated retirement is required") {
		t.Fatalf("sentinel error = %v, want human-gated refusal", err)
	}
	present := countObsoleteOperationalTables(t, db)
	if present != 4 {
		t.Fatalf("sentinel left %d target tables, want all 4", present)
	}
}
