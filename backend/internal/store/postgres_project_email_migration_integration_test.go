package store

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const projectEmailMigrationLegacyFixture = `
create table project_textboxes(
  company_id uuid not null,
  project_id uuid not null,
  textbox_id text not null,
  email_message_id text not null default '',
  email_accent text not null default '',
  created_timestamp timestamptz not null,
  deleted_timestamp timestamptz
);
create table project_textbox_chats(
  company_id uuid not null,
  project_id uuid not null,
  textbox_id text not null,
  selection_source text not null,
  selection_email_message_id uuid,
  created_timestamp timestamptz not null,
  deleted_timestamp timestamptz
);
create table node_textboxes(
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  deleted_timestamp timestamptz
);
create table node_textbox_chats(
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  selection_source text not null,
  selection_email_message_id uuid,
  deleted_timestamp timestamptz
);
create table email_messages(
  company_id uuid not null,
  email_message_id uuid not null,
  email_thread_id uuid not null
);
create table email_relationships(
  company_id uuid not null,
  email_relationship_id uuid not null,
  email_thread_id uuid not null,
  email_message_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  resource_textbox_id text,
  created_timestamp timestamptz not null
);`

func openProjectEmailMigrationSchema(t *testing.T, db *sql.DB) (*sql.Conn, string) {
	t.Helper()
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	schemaName := "project_email_migration_" + strings.ReplaceAll(newUUIDv7String(), "-", "")
	if _, err := conn.ExecContext(ctx, "create schema "+schemaName); err != nil {
		_ = conn.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = conn.ExecContext(ctx, "rollback")
		_, _ = conn.ExecContext(ctx, "set search_path to pg_catalog")
		_, _ = conn.ExecContext(ctx, "drop schema "+schemaName+" cascade")
		_ = conn.Close()
	})
	if _, err := conn.ExecContext(ctx, "set search_path to "+schemaName+",pg_catalog"); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.ExecContext(ctx, projectEmailMigrationLegacyFixture); err != nil {
		t.Fatalf("create legacy Project email fixture: %v", err)
	}
	return conn, schemaName
}

func readProjectEmailParityMigration(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260818_project_email_textbox_parity.sql"))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestPostgresProjectEmailParityMigrationBackfillsAndDropsLegacyColumns(t *testing.T) {
	db, _ := openRealtimePostgresIntegration(t)
	conn, schemaName := openProjectEmailMigrationSchema(t, db)
	ctx := context.Background()
	companyID := "00000000-0000-4000-8000-000000000701"
	projectID := "00000000-0000-4000-8000-000000000702"
	textboxID := "00000000-0000-4000-8000-000000000703"
	threadID := "00000000-0000-4000-8000-000000000704"
	messageID := "00000000-0000-4000-8000-000000000705"
	if _, err := conn.ExecContext(ctx, `insert into email_messages values($1::uuid,$2::uuid,$3::uuid)`,
		companyID, messageID, threadID); err != nil {
		t.Fatalf("seed legacy Project email message: %v", err)
	}
	if _, err := conn.ExecContext(ctx, `insert into project_textboxes
values($1::uuid,$2::uuid,$3,$4,'#14b8a6',clock_timestamp(),null)`,
		companyID, projectID, textboxID, messageID); err != nil {
		t.Fatalf("seed legacy Project email fixture: %v", err)
	}
	if _, err := conn.ExecContext(ctx, readProjectEmailParityMigration(t)); err != nil {
		t.Fatalf("apply Project email parity migration: %v", err)
	}

	var color string
	if err := conn.QueryRowContext(ctx, `select color from project_textboxes
where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3`, companyID, projectID, textboxID).Scan(&color); err != nil {
		t.Fatal(err)
	}
	if color != "#14B8A6" {
		t.Fatalf("migrated Project textbox color=%q", color)
	}
	var wideCount, exactCount int
	if err := conn.QueryRowContext(ctx, `select
  count(*) filter(where resource_textbox_id is null),
  count(*) filter(where resource_textbox_id=$3)
from email_relationships
where company_id=$1::uuid and resource_type='project' and resource_id=$2::uuid`,
		companyID, projectID, textboxID).Scan(&wideCount, &exactCount); err != nil {
		t.Fatal(err)
	}
	if wideCount != 1 || exactCount != 1 {
		t.Fatalf("migrated Project relationships wide=%d exact=%d", wideCount, exactCount)
	}
	var legacyColumnCount, colorColumnCount int
	if err := conn.QueryRowContext(ctx, `select
  count(*) filter(where column_name in ('email_message_id','email_accent')),
  count(*) filter(where column_name='color')
from information_schema.columns
where table_schema=$1 and table_name='project_textboxes'`, schemaName).
		Scan(&legacyColumnCount, &colorColumnCount); err != nil {
		t.Fatal(err)
	}
	if legacyColumnCount != 0 || colorColumnCount != 1 {
		t.Fatalf("migrated Project textbox columns legacy=%d color=%d", legacyColumnCount, colorColumnCount)
	}
}

func TestPostgresProjectEmailParityMigrationRefusesDeletedLegacyIdentityAndRollsBack(t *testing.T) {
	db, _ := openRealtimePostgresIntegration(t)
	conn, schemaName := openProjectEmailMigrationSchema(t, db)
	ctx := context.Background()
	if _, err := conn.ExecContext(ctx, `
insert into email_messages values(
  '00000000-0000-4000-8000-000000000711',
  '00000000-0000-4000-8000-000000000712',
  '00000000-0000-4000-8000-000000000713');
insert into project_textboxes values(
  '00000000-0000-4000-8000-000000000711',
  '00000000-0000-4000-8000-000000000714',
  '00000000-0000-4000-8000-000000000715',
  '00000000-0000-4000-8000-000000000712','#0EA5E9',clock_timestamp(),clock_timestamp());`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.ExecContext(ctx, readProjectEmailParityMigration(t)); err == nil ||
		!strings.Contains(strings.ToLower(err.Error()), "deleted project textboxes retain legacy email identity") {
		t.Fatalf("deleted legacy Project textbox migration err=%v", err)
	}
	if _, err := conn.ExecContext(ctx, "rollback"); err != nil {
		t.Fatal(err)
	}
	var legacyColumnCount, colorColumnCount int
	if err := conn.QueryRowContext(ctx, `select
  count(*) filter(where column_name in ('email_message_id','email_accent')),
  count(*) filter(where column_name='color')
from information_schema.columns
where table_schema=$1 and table_name='project_textboxes'`, schemaName).
		Scan(&legacyColumnCount, &colorColumnCount); err != nil {
		t.Fatal(err)
	}
	if legacyColumnCount != 2 || colorColumnCount != 0 {
		t.Fatalf("refused migration did not roll back columns legacy=%d color=%d", legacyColumnCount, colorColumnCount)
	}
}
