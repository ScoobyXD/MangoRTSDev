package store

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func openNodeUnreadRetirementPostgresIntegration(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("MANGORTS_NODE_UNREAD_RETIREMENT_POSTGRES_TEST") != "1" || os.Getenv("DB_NAME") != "mangorts_node_unread_retirement_test" {
		t.Skip("disposable PostgreSQL Node unread-highlight retirement database not configured")
	}
	host := strings.TrimSpace(os.Getenv("DB_HOST"))
	if host != "127.0.0.1" && !strings.EqualFold(host, "localhost") {
		t.Fatalf("refusing non-local disposable database host %q", host)
	}
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), os.Getenv("DB_SSLMODE"))
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = db.Close() })
	var version int
	if err := db.QueryRow(`select current_setting('server_version_num')::integer`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 190000 {
		t.Skipf("Node unread-highlight retirement integration requires PostgreSQL 17.x or 18.x, got %d", version)
	}
	return db
}

func TestPostgresNodeUnreadHighlightRetirementPreservesTextboxJSON(t *testing.T) {
	db := openNodeUnreadRetirementPostgresIntegration(t)
	if _, err := db.Exec(`drop schema public cascade; create schema public`); err != nil {
		t.Fatal(err)
	}
	fixture := `
create table users(user_id uuid primary key);
create table nodes(company_id uuid not null,node_id uuid not null,primary key(company_id,node_id));
create table node_textboxes(
  company_id uuid not null,node_id uuid not null,textbox_id uuid not null,body_json jsonb not null,
  revision bigint not null,display_order bigint not null,created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,deleted_timestamp timestamptz,
  primary key(company_id,node_id,textbox_id),foreign key(company_id,node_id) references nodes(company_id,node_id));
create table node_textboxes_history(
  company_id uuid not null,node_id uuid not null,textbox_id uuid not null,batch_id uuid not null,
  body_json jsonb not null,display_order bigint not null,saved_by_user_id uuid,saved_timestamp timestamptz not null,
  primary key(company_id,node_id,batch_id,textbox_id));
create table recycle_bin_items(restore_payload jsonb not null);
create table node_content_changes(
  company_id uuid not null,change_id uuid not null,node_id uuid not null,textbox_id uuid not null,
  change_type text not null,text text not null,start_offset integer not null,end_offset integer not null,
  actor_user_id uuid,actor_display_name text not null default '',created_timestamp timestamptz not null default now(),
  primary key(company_id,change_id),foreign key(company_id,node_id) references nodes(company_id,node_id),
  constraint node_content_changes_textbox_fk foreign key(company_id,node_id,textbox_id)
    references node_textboxes(company_id,node_id,textbox_id) on delete cascade);
create table node_content_change_seen(
  company_id uuid not null,change_id uuid not null,user_id uuid not null,seen_timestamp timestamptz not null default now(),
  primary key(company_id,change_id,user_id),
  foreign key(company_id,change_id) references node_content_changes(company_id,change_id) on delete cascade,
  foreign key(user_id) references users(user_id) on delete cascade);
create table node_textbox_seen_snapshots(
  company_id uuid not null,node_id uuid not null,textbox_id uuid not null,user_id uuid not null,
  body_json jsonb not null,textbox_revision bigint not null,textbox_updated_timestamp timestamptz not null,
  seen_timestamp timestamptz not null default now(),primary key(company_id,node_id,textbox_id,user_id),
  foreign key(company_id,node_id,textbox_id) references node_textboxes(company_id,node_id,textbox_id) on delete cascade,
  foreign key(user_id) references users(user_id) on delete cascade);
create index idx_node_content_changes_node_created on node_content_changes(company_id,node_id,created_timestamp,change_id);
create index idx_node_content_change_seen_user on node_content_change_seen(company_id,user_id,change_id);
create index idx_node_textbox_seen_snapshots_user on node_textbox_seen_snapshots(company_id,user_id,node_id,textbox_id);
create function mangorts_trg_bump_node_view_from_direct_node() returns trigger language plpgsql as $$
begin if tg_op='DELETE' then return old; end if; return new; end $$;
create function mangorts_trg_bump_node_view_user_from_change_seen() returns trigger language plpgsql as $$
begin if tg_op='DELETE' then return old; end if; return new; end $$;
create function mangorts_trg_bump_node_view_user_from_snapshot() returns trigger language plpgsql as $$
begin if tg_op='DELETE' then return old; end if; return new; end $$;
create trigger trg_node_view_version_content_changes after insert or update or delete on node_content_changes
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
create trigger trg_node_view_user_version_change_seen_mutation after insert or update on node_content_change_seen
for each row execute function mangorts_trg_bump_node_view_user_from_change_seen();
create trigger trg_node_view_user_version_change_seen_delete before delete on node_content_change_seen
for each row execute function mangorts_trg_bump_node_view_user_from_change_seen();
create trigger trg_node_view_user_version_snapshots after insert or update or delete on node_textbox_seen_snapshots
for each row execute function mangorts_trg_bump_node_view_user_from_snapshot();
insert into users values('00000000-0000-4000-8000-000000000701');
insert into nodes values('00000000-0000-4000-8000-000000000702','00000000-0000-4000-8000-000000000703');
insert into node_textboxes values(
  '00000000-0000-4000-8000-000000000702','00000000-0000-4000-8000-000000000703',
  '00000000-0000-4000-8000-000000000704',
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"dormant anchor"}]}]},"annotations":[{"id":"change-1","kind":"change","from":2,"to":9}]}',
  7,0,now(),now(),null);
insert into node_textboxes_history values(
  '00000000-0000-4000-8000-000000000702','00000000-0000-4000-8000-000000000703',
  '00000000-0000-4000-8000-000000000704','00000000-0000-4000-8000-000000000705',
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"history anchor"}]}]},"annotations":[{"id":"change-history","kind":"change","from":3,"to":10}]}',
  0,'00000000-0000-4000-8000-000000000701',now());
insert into node_content_changes values(
  '00000000-0000-4000-8000-000000000702','00000000-0000-4000-8000-000000000706',
  '00000000-0000-4000-8000-000000000703','00000000-0000-4000-8000-000000000704',
  'addition','old row',0,7,'00000000-0000-4000-8000-000000000701','Fixture',now());
insert into node_content_change_seen values(
  '00000000-0000-4000-8000-000000000702','00000000-0000-4000-8000-000000000706',
  '00000000-0000-4000-8000-000000000701',now());
insert into node_textbox_seen_snapshots
select company_id,node_id,textbox_id,'00000000-0000-4000-8000-000000000701',body_json,revision,updated_timestamp,now()
from node_textboxes;
insert into recycle_bin_items values(
  '{"node_content_changes":[],"node_textboxes":[{"body_json":{"annotations":[{"id":"recycle-change","kind":"change","from":1,"to":2}]}}],"node_textboxes_history":[{"body_json":{"annotations":[{"id":"recycle-history-change","kind":"change","from":2,"to":3}]}}]}');`
	if _, err := db.Exec(fixture); err != nil {
		t.Fatal(err)
	}

	var currentBefore, historyBefore string
	if err := db.QueryRow(`select body_json::text from node_textboxes`).Scan(&currentBefore); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select body_json::text from node_textboxes_history`).Scan(&historyBefore); err != nil {
		t.Fatal(err)
	}
	preflight := readNodeRetirementIntegrationSQL(t, "..", "..", "..", "scripts", "node_unread_highlights_retirement_preflight.sql")
	if _, err := db.Exec(preflight); err != nil {
		t.Fatalf("Node unread-highlight preflight: %v", err)
	}

	migration := readNodeRetirementIntegrationSQL(t, "..", "..", "db", "migrations", "20260805_zzzzz_remove_node_unread_highlights.sql")
	if _, err := db.Exec(`create view unexpected_unread_dependency as select company_id from node_content_changes`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(migration); err == nil {
		t.Fatal("retirement unexpectedly accepted a surviving view dependency")
	}
	_, _ = db.Exec(`rollback`)
	if _, err := db.Exec(`drop view unexpected_unread_dependency`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(migration); err != nil {
		t.Fatalf("Node unread-highlight retirement: %v", err)
	}

	for _, object := range []string{
		"node_content_changes", "node_content_change_seen", "node_textbox_seen_snapshots",
		"idx_node_content_changes_node_created", "idx_node_content_change_seen_user", "idx_node_textbox_seen_snapshots_user",
	} {
		var exists bool
		if err := db.QueryRow(`select to_regclass('public.'||$1) is not null`, object).Scan(&exists); err != nil || exists {
			t.Fatalf("retired object %s exists=%v err=%v", object, exists, err)
		}
	}
	var currentAfter, historyAfter string
	if err := db.QueryRow(`select body_json::text from node_textboxes`).Scan(&currentAfter); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select body_json::text from node_textboxes_history`).Scan(&historyAfter); err != nil {
		t.Fatal(err)
	}
	if currentAfter != currentBefore || historyAfter != historyBefore {
		t.Fatal("retirement changed current or history textbox JSON")
	}
	verification := readNodeRetirementIntegrationSQL(t, "..", "..", "..", "scripts", "node_unread_highlights_retirement_verification.sql")
	if _, err := db.Exec(verification); err != nil {
		t.Fatalf("Node unread-highlight verification: %v", err)
	}
	if _, err := db.Exec(migration); err == nil {
		t.Fatal("strict retirement rerun unexpectedly succeeded")
	}
	_, _ = db.Exec(`rollback`)
}
