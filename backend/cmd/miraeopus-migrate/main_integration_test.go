package main

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func openMigrationRunnerIntegrationDatabase(t *testing.T) *sql.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_MIGRATION_RUNNER_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set MANGORTS_MIGRATION_RUNNER_TEST_DATABASE_URL to a disposable local PostgreSQL 17 or 18 database")
	}
	if os.Getenv("MANGORTS_MIGRATION_RUNNER_TEST_RESET_ACK") != "DROP_DISPOSABLE_SCHEMA" {
		t.Fatal("set MANGORTS_MIGRATION_RUNNER_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA for the guarded disposable test")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	privateHostAck := strings.TrimSpace(os.Getenv("MANGORTS_MIGRATION_RUNNER_TEST_PRIVATE_HOST_ACK"))
	hostIP := net.ParseIP(config.Host)
	isLoopback := config.Host == "127.0.0.1" || strings.EqualFold(config.Host, "localhost")
	isAcknowledgedPrivateHost := privateHostAck != "" && config.Host == privateHostAck && hostIP != nil && hostIP.IsPrivate()
	if !isLoopback && !isAcknowledgedPrivateHost {
		t.Fatalf("refusing non-local disposable database host %q", config.Host)
	}
	config.RuntimeParams["client_encoding"] = "UTF8"
	config.RuntimeParams["application_name"] = "mangorts_migration_runner_test"
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = db.Close() })

	var version int
	var databaseName string
	if err := db.QueryRow(`select current_setting('server_version_num')::integer,current_database()`).Scan(&version, &databaseName); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 190000 || !strings.HasPrefix(databaseName, "mangorts_process_map_test") {
		t.Fatalf("refusing PostgreSQL version/database %d/%q", version, databaseName)
	}
	return db
}

func resetMigrationRunnerIntegrationDatabase(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec("drop schema public cascade; create schema public"); err != nil {
		t.Fatalf("reset disposable schema: %v", err)
	}
}

func writeMigrationRunnerTestSQL(t *testing.T, dir, name, sql string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(sql), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestMigrationRunnerPostgresAtomicityAndSupersession(t *testing.T) {
	db := openMigrationRunnerIntegrationDatabase(t)

	assertLedgerFailureRollsBack := func(t *testing.T, migrationName, migrationSQL, probeTable string) {
		t.Helper()
		resetMigrationRunnerIntegrationDatabase(t, db)
		if _, err := db.Exec(`
create table schema_migrations(version text primary key,applied_at timestamptz not null default now());
create function reject_migration_ledger() returns trigger language plpgsql as $$
begin
  raise exception 'forced ledger failure';
end
$$;
create trigger reject_migration_ledger before insert on schema_migrations
for each row execute function reject_migration_ledger()`); err != nil {
			t.Fatal(err)
		}
		path := writeMigrationRunnerTestSQL(t, t.TempDir(), migrationName, migrationSQL)
		conn, err := db.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		err = execSQLFileInTransaction(context.Background(), conn, path, nil, func(tx *sql.Tx) error {
			_, err := tx.Exec(`insert into schema_migrations(version) values ($1)`, migrationName)
			return err
		})
		if err == nil || !strings.Contains(err.Error(), "forced ledger failure") {
			t.Fatalf("migration error = %v", err)
		}
		var tableExists bool
		var ledgerRows int
		if err := db.QueryRow(`select to_regclass($1) is not null`, "public."+probeTable).Scan(&tableExists); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow(`select count(*) from schema_migrations`).Scan(&ledgerRows); err != nil {
			t.Fatal(err)
		}
		if tableExists || ledgerRows != 0 {
			t.Fatalf("failed migration left table=%t ledger_rows=%d", tableExists, ledgerRows)
		}
	}

	t.Run("transaction wrapped migration and ledger failure roll back together", func(t *testing.T) {
		assertLedgerFailureRollsBack(t, "wrapped.sql", "BEGIN;\ncreate table atomic_probe(id bigint);\nCOMMIT;\n", "atomic_probe")
	})

	t.Run("comment separated transaction controls and ledger failure roll back together", func(t *testing.T) {
		assertLedgerFailureRollsBack(t, "comment-wrapped.sql", `BEGIN/* transaction boundary */TRANSACTION;
create table comment_atomic_probe(id bigint);
COMMIT/* transaction boundary */WORK;
`, "comment_atomic_probe")
	})

	t.Run("standard string backslash and ledger failure roll back together", func(t *testing.T) {
		assertLedgerFailureRollsBack(t, "backslash-wrapped.sql", `BEGIN;
select '\' as one_backslash;
create table backslash_atomic_probe(id bigint);
COMMIT;
`, "backslash_atomic_probe")
	})

	t.Run("interruption after body rolls back migration", func(t *testing.T) {
		resetMigrationRunnerIntegrationDatabase(t, db)
		if _, err := db.Exec(schemaMigrationsTableSQL); err != nil {
			t.Fatal(err)
		}
		path := writeMigrationRunnerTestSQL(t, t.TempDir(), "interrupted.sql", "create table interrupted_probe(id bigint);\n")
		conn, err := db.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		forced := errors.New("forced interruption")
		if err := execSQLFileInTransaction(context.Background(), conn, path, nil, func(*sql.Tx) error { return forced }); !errors.Is(err, forced) {
			t.Fatalf("interrupted migration error = %v", err)
		}
		var tableExists bool
		if err := db.QueryRow(`select to_regclass('public.interrupted_probe') is not null`).Scan(&tableExists); err != nil {
			t.Fatal(err)
		}
		if tableExists {
			t.Fatal("interrupted migration committed its body")
		}
	})

	t.Run("actual-size layout runs through the managed transaction", func(t *testing.T) {
		resetMigrationRunnerIntegrationDatabase(t, db)
		if _, err := db.Exec(`
create table schema_migrations(version text primary key,applied_at timestamptz not null default now());
create table company_explorer_folders(
  company_id uuid not null,folder_id uuid not null,parent_folder_id uuid,
  position integer not null,created_timestamp timestamptz not null,
  primary key(company_id,folder_id)
);
create table company_explorer_items(
  company_id uuid not null,item_id uuid not null,target_type text not null,target_id uuid not null,
  parent_folder_id uuid,position integer not null,created_timestamp timestamptz not null,
  primary key(company_id,item_id)
);
create table logic_gates(company_id uuid not null,logic_gate_id uuid not null,primary key(company_id,logic_gate_id));
create table process_map_placements(
  company_id uuid not null,resource_type text not null,resource_id uuid not null,map_parent_folder_id uuid,
  grid_x integer not null,grid_y integer not null,grid_width integer not null,grid_height integer not null,
  revision bigint not null,updated_timestamp timestamptz not null,
  primary key(company_id,resource_type,resource_id)
);
create table domain_events(
  event_id uuid primary key,company_id uuid not null,stream_type text not null,stream_id text not null,
  sequence bigint not null,event_type text not null,actor_user_id uuid,idempotency_key text,payload jsonb not null,
  created_timestamp timestamptz not null
);
insert into company_explorer_folders(company_id,folder_id,parent_folder_id,position,created_timestamp) values
  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222221',null,1000,now()),
  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222221',1000,now());
insert into logic_gates(company_id,logic_gate_id) values
  ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333331'),
  ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333332');
insert into company_explorer_items(company_id,item_id,target_type,target_id,parent_folder_id,position,created_timestamp) values
  ('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444441','logic_gate','33333333-3333-4333-8333-333333333331','22222222-2222-4222-8222-222222222221',2000,now()),
  ('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444442','logic_gate','33333333-3333-4333-8333-333333333332','22222222-2222-4222-8222-222222222221',3000,now());
insert into process_map_placements(company_id,resource_type,resource_id,map_parent_folder_id,grid_x,grid_y,grid_width,grid_height,revision,updated_timestamp) values
  ('11111111-1111-4111-8111-111111111111','company_explorer_folder','22222222-2222-4222-8222-222222222221',null,-80,-60,40,30,1,now()),
  ('11111111-1111-4111-8111-111111111111','company_explorer_folder','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222221',-70,-50,37,29,1,now()),
  ('11111111-1111-4111-8111-111111111111','logic_gate','33333333-3333-4333-8333-333333333331','22222222-2222-4222-8222-222222222221',-20,-30,23,9,1,now()),
  ('11111111-1111-4111-8111-111111111111','logic_gate','33333333-3333-4333-8333-333333333332','22222222-2222-4222-8222-222222222221',10,-10,11,17,1,now())`); err != nil {
			t.Fatal(err)
		}
		conn, err := db.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		migrationPath := filepath.Join("..", "..", "db", "migrations", processMapActualSizeLayoutMigration)
		if err := execSQLFileInTransaction(context.Background(), conn, migrationPath, nil, func(tx *sql.Tx) error {
			_, err := tx.Exec(`insert into schema_migrations(version) values ($1)`, processMapActualSizeLayoutMigration)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		var processOneWidth, processOneHeight, processTwoWidth, processTwoHeight int
		var leafWidth, leafHeight int
		if err := db.QueryRow(`
select one.grid_width,one.grid_height,two.grid_width,two.grid_height,leaf.grid_width,leaf.grid_height
from process_map_placements one
join process_map_placements two on two.company_id=one.company_id and two.resource_id='33333333-3333-4333-8333-333333333332'::uuid
join process_map_placements leaf on leaf.company_id=one.company_id and leaf.resource_id='22222222-2222-4222-8222-222222222222'::uuid
where one.resource_id='33333333-3333-4333-8333-333333333331'::uuid`).Scan(
			&processOneWidth, &processOneHeight, &processTwoWidth, &processTwoHeight, &leafWidth, &leafHeight,
		); err != nil {
			t.Fatal(err)
		}
		if processOneWidth != 23 || processOneHeight != 9 || processTwoWidth != 11 || processTwoHeight != 17 || leafWidth != 37 || leafHeight != 29 {
			t.Fatalf("preserved dimensions Process1=%dx%d Process2=%dx%d leaf=%dx%d", processOneWidth, processOneHeight, processTwoWidth, processTwoHeight, leafWidth, leafHeight)
		}
		var ledgerRows int
		if err := db.QueryRow(`select count(*) from schema_migrations`).Scan(&ledgerRows); err != nil {
			t.Fatal(err)
		}
		if ledgerRows != 4 {
			t.Fatalf("actual-size layout ledger rows = %d, want 4", ledgerRows)
		}
	})

	t.Run("corrected layout migration records and skips obsolete files", func(t *testing.T) {
		resetMigrationRunnerIntegrationDatabase(t, db)
		dir := t.TempDir()
		obsoleteNames := []string{
			"20260826_zzzz_process_map_tidy_initial_layout.sql",
			"20260826_zzzzz_process_map_rectangular_layout.sql",
			"20260826_zzzzzz_process_map_square_layout.sql",
		}
		var supersededValues []string
		for index, name := range obsoleteNames {
			supersededValues = append(supersededValues, "('"+name+"')")
			writeMigrationRunnerTestSQL(t, dir, name, "create table obsolete_probe_"+string(rune('a'+index))+"(id bigint);\n")
		}
		writeMigrationRunnerTestSQL(t, dir, processMapActualSizeLayoutMigration, `BEGIN;
create table corrected_probe(id bigint);
insert into schema_migrations(version) values `+strings.Join(supersededValues, ",")+`;
COMMIT;
`)

		conn, err := db.Conn(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		if err := runMigrateMode(context.Background(), conn, commandConfig{MigrationsDir: dir}); err != nil {
			t.Fatal(err)
		}
		var corrected bool
		var obsoleteTables int
		if err := db.QueryRow(`select to_regclass('public.corrected_probe') is not null`).Scan(&corrected); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow(`select count(*) from pg_class where relname like 'obsolete_probe_%'`).Scan(&obsoleteTables); err != nil {
			t.Fatal(err)
		}
		var ledgerRows int
		if err := db.QueryRow(`select count(*) from schema_migrations`).Scan(&ledgerRows); err != nil {
			t.Fatal(err)
		}
		if !corrected || obsoleteTables != 0 || ledgerRows != 4 {
			t.Fatalf("corrected=%t obsolete_tables=%d ledger_rows=%d", corrected, obsoleteTables, ledgerRows)
		}
	})
}
