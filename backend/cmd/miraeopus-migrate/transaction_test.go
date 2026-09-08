package main

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
)

type migrationAuditTestDB struct{ migrationTestDB }

func (db *migrationAuditTestDB) Connect(context.Context) (driver.Conn, error) { return db, nil }
func (db *migrationAuditTestDB) BeginTx(_ context.Context, opts driver.TxOptions) (driver.Tx, error) {
	if !opts.ReadOnly || opts.Isolation != driver.IsolationLevel(sql.LevelRepeatableRead) {
		return nil, errors.New("audit must use read-only repeatable-read")
	}
	return db, nil
}
func (*migrationAuditTestDB) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return nil, errors.New("audit attempted SQL execution")
}
func (*migrationAuditTestDB) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.HasPrefix(query, "select current_user,"):
		return &auditIdentityRows{}, nil
	case query == "inventory query":
		return &migrationTestRows{values: []driver.Value{"[]"}}, nil
	default:
		return nil, errors.New("unexpected audit query: " + query)
	}
}

type auditIdentityRows struct{ read bool }

func (*auditIdentityRows) Columns() []string {
	return []string{"user", "version", "version_num", "read_only", "ledger_exists", "tables"}
}
func (*auditIdentityRows) Close() error { return nil }
func (rows *auditIdentityRows) Next(dest []driver.Value) error {
	if rows.read {
		return io.EOF
	}
	rows.read = true
	copy(dest, []driver.Value{"test_reader", "17.7", int64(170007), true, false, int64(1)})
	return nil
}

func TestMigrationPlanAuditNeverCreatesMissingLedger(t *testing.T) {
	dir := t.TempDir()
	cfg := commandConfig{Mode: "plan", MigrationsDir: t.TempDir(),
		SchemaPath:    writeMigrationRunnerTestSQL(t, dir, "schema.sql", "schema snapshot"),
		InventoryPath: writeMigrationRunnerTestSQL(t, dir, "inventory.sql", "inventory query")}
	state := &migrationAuditTestDB{}
	db := sql.OpenDB(state)
	defer db.Close()
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var output bytes.Buffer
	err = runAuditMode(context.Background(), conn, cfg, &output)
	if err == nil || !strings.Contains(output.String(), `"ledger_exists":false`) || !strings.Contains(output.String(), `"ready":false`) {
		t.Fatalf("audit error=%v output=%s", err, output.String())
	}
	if state.rollbacks != 1 || len(state.committed) != 0 {
		t.Fatalf("audit changed database state: %+v", state)
	}
}

// The driver keeps transaction changes isolated until Commit. These tests run
// the real runner without a live database, including its per-file ledger write.
type migrationTestDB struct {
	applied    map[string]bool
	committed  []string
	pending    []string
	version    string
	failBody   string
	failLedger string
	rollbacks  int
}

func (db *migrationTestDB) Connect(context.Context) (driver.Conn, error) { return db, nil }
func (db *migrationTestDB) Driver() driver.Driver                        { return migrationTestDriver{} }
func (db *migrationTestDB) Close() error                                 { return nil }
func (db *migrationTestDB) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepared statement")
}
func (db *migrationTestDB) Begin() (driver.Tx, error) {
	db.pending = nil
	db.version = ""
	return db, nil
}
func (db *migrationTestDB) Commit() error {
	db.committed = append(db.committed, db.pending...)
	db.applied[db.version] = true
	db.pending = nil
	return nil
}
func (db *migrationTestDB) Rollback() error {
	db.pending = nil
	db.version = ""
	db.rollbacks++
	return nil
}
func (db *migrationTestDB) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	switch {
	case query == schemaMigrationsTableSQL:
	case strings.HasPrefix(query, "insert into schema_migrations"):
		version := args[0].Value.(string)
		if version == db.failLedger {
			return nil, errors.New("forced ledger failure")
		}
		db.version = version
	default:
		db.pending = append(db.pending, query)
		if query == db.failBody {
			return nil, errors.New("forced script failure after its first change")
		}
	}
	return driver.RowsAffected(1), nil
}
func (db *migrationTestDB) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	rows := &migrationTestRows{}
	switch {
	case query == "select version from schema_migrations":
		for version := range db.applied {
			rows.values = append(rows.values, version)
		}
	case strings.HasPrefix(query, "select exists(select 1 from schema_migrations"):
		rows.values = append(rows.values, db.applied[args[0].Value.(string)])
	default:
		return nil, errors.New("unexpected query: " + query)
	}
	return rows, nil
}

type migrationTestDriver struct{}

func (migrationTestDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("use test connector")
}

type migrationTestRows struct{ values []driver.Value }

func (*migrationTestRows) Columns() []string { return []string{"value"} }
func (*migrationTestRows) Close() error      { return nil }
func (rows *migrationTestRows) Next(dest []driver.Value) error {
	if len(rows.values) == 0 {
		return io.EOF
	}
	dest[0], rows.values = rows.values[0], rows.values[1:]
	return nil
}

func TestMigrationFailurePreservesOnlyEarlierCommittedFiles(t *testing.T) {
	for _, failure := range []string{"script", "ledger"} {
		t.Run(failure, func(t *testing.T) {
			dir := t.TempDir()
			writeMigrationRunnerTestSQL(t, dir, "a.sql", "first change")
			writeMigrationRunnerTestSQL(t, dir, "b.sql", "second change")
			writeMigrationRunnerTestSQL(t, dir, "c.sql", "third change")
			state := &migrationTestDB{applied: map[string]bool{}}
			if failure == "script" {
				state.failBody = "second change"
			} else {
				state.failLedger = "b.sql"
			}
			db := sql.OpenDB(state)
			defer db.Close()
			conn, err := db.Conn(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			err = runMigrateMode(context.Background(), conn, commandConfig{MigrationsDir: dir})
			if err == nil || !strings.Contains(err.Error(), "apply migration b.sql") {
				t.Fatalf("migration failure=%v", err)
			}
			if !reflect.DeepEqual(state.applied, map[string]bool{"a.sql": true}) || !reflect.DeepEqual(state.committed, []string{"first change"}) || state.rollbacks != 1 {
				t.Fatalf("partial failure state=%+v", state)
			}
			files, err := listMigrationFiles(dir)
			if err != nil {
				t.Fatal(err)
			}
			plan, err := buildMigrationPlan(files, state.applied, true, 170007, []byte("[]"))
			if err != nil || len(plan.Pending) != 2 || plan.Pending[0].Version != "b.sql" {
				t.Fatalf("partial failure plan=%+v error=%v", plan, err)
			}
			state.failBody, state.failLedger = "", ""
			if err := runMigrateMode(context.Background(), conn, commandConfig{MigrationsDir: dir}); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(state.committed, []string{"first change", "second change", "third change"}) {
				t.Fatalf("resuming replayed already committed work: %v", state.committed)
			}
			if err := runMigrateMode(context.Background(), conn, commandConfig{MigrationsDir: dir}); err != nil || len(state.committed) != 3 {
				t.Fatalf("already applied run changed database: state=%+v error=%v", state, err)
			}
		})
	}
}
