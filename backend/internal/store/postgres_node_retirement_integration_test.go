package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func openNodeRetirementPostgresIntegration(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("MANGORTS_NODE_RETIREMENT_POSTGRES_TEST") != "1" || os.Getenv("DB_NAME") != "mangorts_node_retirement_test" {
		t.Skip("disposable PostgreSQL 17 Node retirement database not configured")
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
	if version < 170000 || version >= 180000 {
		t.Skipf("Node retirement integration requires PostgreSQL 17.x, got %d", version)
	}
	return db
}

func readNodeRetirementIntegrationSQL(t *testing.T, parts ...string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(parts...))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestPostgresNodeFinalCutoverAndRetirementRefusalRollbackAndRerun(t *testing.T) {
	db := openNodeRetirementPostgresIntegration(t)
	if _, err := db.Exec(`drop schema public cascade; create schema public`); err != nil {
		t.Fatal(err)
	}
	fixture := `
create type information_type as enum ('Text box','Text block chat','Attached email');
create table users(user_id uuid primary key);
create table nodes(company_id uuid not null,node_id uuid not null,primary key(company_id,node_id));
create table node_information(
  company_id uuid not null,information_id uuid not null,node_id uuid not null,type information_type not null,
  information text not null,save_batch_id uuid,save_kind text not null,saved_by_user_id uuid,
  saved_by_display_name text not null,source_information_id uuid,created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,primary key(company_id,information_id));
create table node_projection_table(
  company_id uuid not null,node_id uuid not null,information_id uuid not null,type information_type not null,
  information text not null,is_deleted boolean not null,revision bigint not null,created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,primary key(company_id,node_id,information_id));
create table node_projection_seen_snapshots(
  company_id uuid not null,node_id uuid not null,information_id uuid not null,user_id uuid not null,
  information text not null,projection_updated_timestamp timestamptz not null,seen_timestamp timestamptz not null,
  primary key(company_id,node_id,information_id,user_id));
create table node_textboxes(
  company_id uuid not null,node_id uuid not null,textbox_id uuid not null,body_json jsonb not null,
  revision bigint not null,display_order bigint not null,created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,deleted_timestamp timestamptz,
  primary key(company_id,node_id,textbox_id));
create table node_textbox_chats(
  company_id uuid not null,chat_id uuid not null,node_id uuid not null,textbox_id uuid not null,
  deleted_timestamp timestamptz,primary key(company_id,chat_id));
create table node_textboxes_history(
  company_id uuid not null,node_id uuid not null,textbox_id uuid not null,batch_id uuid not null,
  body_json jsonb not null,display_order bigint not null,saved_by_user_id uuid,saved_timestamp timestamptz not null);
create table node_content_changes(
  company_id uuid not null,change_id uuid not null,node_id uuid not null,information_id uuid not null,
  change_type text not null,text text not null,start_offset integer not null,end_offset integer not null,
  actor_user_id uuid,actor_display_name text not null,created_timestamp timestamptz not null,
  primary key(company_id,change_id));
create table email_relationships(
  company_id uuid not null,email_relationship_id uuid not null,email_thread_id uuid not null,
  email_message_id uuid not null,resource_type text not null,resource_id uuid not null,
  resource_textbox_id text,created_timestamp timestamptz not null);
create table recycle_bin_items(
  company_id uuid not null,recycle_bin_item_id uuid not null,object_kind text not null,object_id uuid not null,
  object_label text not null,object_folder_kind text not null,restore_payload jsonb not null,
  deleted_by_user_id uuid,deleted_timestamp timestamptz not null,
  primary key(company_id,recycle_bin_item_id));
create table schema_migrations(version text primary key);
create function mangorts_trg_bump_node_view_user_from_snapshot() returns trigger language plpgsql as $$
begin if tg_op='DELETE' then return old; end if; return new; end $$;
create function mangorts_trg_bump_node_view_from_direct_node() returns trigger language plpgsql as $$
begin if tg_op='DELETE' then return old; end if; return new; end $$;
insert into users values
  ('00000000-0000-4000-8000-000000000601'),
  ('00000000-0000-4000-8000-000000000606');
insert into nodes values('00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000603');
insert into node_textboxes values(
  '00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000603',
  '00000000-0000-4000-8000-000000000604',
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[]},"annotations":[]}',
  7,0,now(),now(),null);
insert into node_projection_table values(
  '00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000603',
  '00000000-0000-4000-8000-000000000604','Text box',
  '<!-- mango-node-text-block-v1 -->{"document":"{\"type\":\"doc\",\"content\":[]}"}',
  false,7,now(),now());
insert into node_projection_table values(
  '00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000603',
  '00000000-0000-4000-8000-000000000607','Text box',
  '<!-- mango-node-text-block-v1 -->{"document":"{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"late writer delta\"}]}]}"}',
  false,1,now(),now());
insert into node_projection_seen_snapshots
select company_id,node_id,information_id,'00000000-0000-4000-8000-000000000601',information,
  updated_timestamp,updated_timestamp from node_projection_table;
insert into node_projection_seen_snapshots
select company_id,node_id,information_id,'00000000-0000-4000-8000-000000000606',information,
  updated_timestamp,updated_timestamp from node_projection_table
where information_id='00000000-0000-4000-8000-000000000607';
insert into node_projection_seen_snapshots values
  ('00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000603',
   '00000000-0000-4000-8000-000000000608','00000000-0000-4000-8000-000000000601',
   'stale baseline',now(),now()),
  ('00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000603',
   '00000000-0000-4000-8000-000000000608','00000000-0000-4000-8000-000000000606',
   'stale baseline',now(),now());
insert into node_textboxes_history values(
  '00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000603',
  '00000000-0000-4000-8000-000000000604','00000000-0000-4000-8000-000000000609',
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[]},"annotations":[]}',
  0,'00000000-0000-4000-8000-000000000601',now());
insert into recycle_bin_items values(
  '00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000610',
  'node','00000000-0000-4000-8000-000000000603','Recycled fixture','recycle_bin',
  '{"marker":"preserve","node_textboxes":[{"body_json":{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[]},"annotations":[]},"revision":11}],"node_textboxes_history":[{"body_json":{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[]},"annotations":[]},"saved_by_user_id":"00000000-0000-4000-8000-000000000601"}],"node_textbox_seen_snapshots":[{"body_json":{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[]},"annotations":[]},"textbox_revision":11}]}',
  null,now());
insert into node_content_changes values(
  '00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000605',
  '00000000-0000-4000-8000-000000000603','00000000-0000-4000-8000-000000000604',
  'addition','hello',0,5,null,'Fixture',now());`
	if _, err := db.Exec(fixture); err != nil {
		t.Fatal(err)
	}

	forward := readNodeRetirementIntegrationSQL(t, "..", "..", "db", "migrations", "20260804_zzzzzz_node_final_storage_cutover.sql")
	if _, err := db.Exec(forward); err != nil {
		t.Fatalf("forward Node cutover: %v", err)
	}

	repair := readNodeRetirementIntegrationSQL(t, "..", "..", "db", "migrations", "20260805_zzzd_repair_empty_node_textbox_documents.sql")
	if _, err := db.Exec(repair); err != nil {
		t.Fatalf("empty Node document repair: %v", err)
	}
	if _, err := db.Exec(repair); err != nil {
		t.Fatalf("idempotent empty Node document repair: %v", err)
	}

	var currentInvalid, historyInvalid, seenInvalid, recycledInvalid int
	if err := db.QueryRow(`select
  (select count(*) from node_textboxes where body_json->'document'->'content'='[]'::jsonb),
  (select count(*) from node_textboxes_history where body_json->'document'->'content'='[]'::jsonb),
  (select count(*) from node_textbox_seen_snapshots where body_json->'document'->'content'='[]'::jsonb),
  (select count(*)
   from recycle_bin_items item
   cross join lateral (values ('node_textboxes'),('node_textboxes_history'),('node_textbox_seen_snapshots')) expected(payload_key)
   cross join lateral jsonb_array_elements(item.restore_payload->expected.payload_key) saved(row_value)
   where saved.row_value->'body_json'->'document'->'content'='[]'::jsonb)`).Scan(
		&currentInvalid, &historyInvalid, &seenInvalid, &recycledInvalid,
	); err != nil {
		t.Fatal(err)
	}
	if currentInvalid != 0 || historyInvalid != 0 || seenInvalid != 0 || recycledInvalid != 0 {
		t.Fatalf("invalid empty documents remain current=%d history=%d seen=%d recycled=%d",
			currentInvalid, historyInvalid, seenInvalid, recycledInvalid)
	}

	var currentRevision, savedDisplayOrder int64
	var savedByUserID, recycleMarker string
	if err := db.QueryRow(`select
  (select revision from node_textboxes where textbox_id='00000000-0000-4000-8000-000000000604'),
  (select display_order from node_textboxes_history where batch_id='00000000-0000-4000-8000-000000000609'),
  (select saved_by_user_id::text from node_textboxes_history where batch_id='00000000-0000-4000-8000-000000000609'),
  (select restore_payload->>'marker' from recycle_bin_items where recycle_bin_item_id='00000000-0000-4000-8000-000000000610')`).Scan(
		&currentRevision, &savedDisplayOrder, &savedByUserID, &recycleMarker,
	); err != nil {
		t.Fatal(err)
	}
	if currentRevision != 7 || savedDisplayOrder != 0 ||
		savedByUserID != "00000000-0000-4000-8000-000000000601" || recycleMarker != "preserve" {
		t.Fatalf("repair changed metadata revision=%d order=%d saved_by=%s marker=%s",
			currentRevision, savedDisplayOrder, savedByUserID, recycleMarker)
	}

	var snapshotRevision int64
	if err := db.QueryRow(`select textbox_revision from node_textbox_seen_snapshots
where textbox_id='00000000-0000-4000-8000-000000000604'`).Scan(&snapshotRevision); err != nil {
		t.Fatal(err)
	}
	if snapshotRevision != 7 {
		t.Fatalf("migrated seen revision=%d, want 7", snapshotRevision)
	}
	var copiedBody string
	var copiedRevision int64
	if err := db.QueryRow(`select body_json::text,revision
from node_textboxes
where company_id='00000000-0000-4000-8000-000000000602'
  and node_id='00000000-0000-4000-8000-000000000603'
  and textbox_id='00000000-0000-4000-8000-000000000607'`).Scan(&copiedBody, &copiedRevision); err != nil {
		t.Fatal(err)
	}
	if copiedRevision != 1 || !strings.Contains(copiedBody, "late writer delta") {
		t.Fatalf("copied writer delta revision=%d body=%s", copiedRevision, copiedBody)
	}
	var staleLegacyRows, copiedLegacySeenRows, copiedFinalSeenRows, copiedProjectionRows int
	var copiedMinSeenRevision, copiedMaxSeenRevision int64
	if err := db.QueryRow(`select
  (select count(*) from node_projection_seen_snapshots
    where information_id='00000000-0000-4000-8000-000000000608'),
  (select count(*) from node_projection_seen_snapshots
    where information_id='00000000-0000-4000-8000-000000000607'),
  (select count(*) from node_textbox_seen_snapshots
    where textbox_id='00000000-0000-4000-8000-000000000607'),
  (select min(textbox_revision) from node_textbox_seen_snapshots
    where textbox_id='00000000-0000-4000-8000-000000000607'),
  (select max(textbox_revision) from node_textbox_seen_snapshots
    where textbox_id='00000000-0000-4000-8000-000000000607'),
  (select count(*) from node_projection_table
    where information_id='00000000-0000-4000-8000-000000000607')`).Scan(
		&staleLegacyRows, &copiedLegacySeenRows, &copiedFinalSeenRows,
		&copiedMinSeenRevision, &copiedMaxSeenRevision, &copiedProjectionRows,
	); err != nil {
		t.Fatal(err)
	}
	if staleLegacyRows != 0 {
		t.Fatalf("stale legacy seen rows=%d, want 0", staleLegacyRows)
	}
	if copiedLegacySeenRows != 2 || copiedFinalSeenRows != 2 ||
		copiedMinSeenRevision != 1 || copiedMaxSeenRevision != 1 || copiedProjectionRows != 1 {
		t.Fatalf(
			"real delta preservation legacy seen=%d final seen=%d revisions=%d..%d projection rows=%d",
			copiedLegacySeenRows, copiedFinalSeenRows, copiedMinSeenRevision, copiedMaxSeenRevision, copiedProjectionRows,
		)
	}
	var finalColumn, oldColumn bool
	if err := db.QueryRow(`select
  exists(select 1 from pg_attribute where attrelid='node_content_changes'::regclass and attname='textbox_id' and not attisdropped),
  exists(select 1 from pg_attribute where attrelid='node_content_changes'::regclass and attname='information_id' and not attisdropped)`).Scan(&finalColumn, &oldColumn); err != nil {
		t.Fatal(err)
	}
	if !finalColumn || oldColumn {
		t.Fatalf("content-change columns textbox=%v information=%v", finalColumn, oldColumn)
	}
	if _, err := db.Exec(forward); err == nil {
		t.Fatal("forward migration rerun unexpectedly succeeded")
	}

	operator := readNodeRetirementIntegrationSQL(t, "..", "..", "db", "migrations", "20260805_retire_node_legacy_storage.sql")
	approved := strings.Replace(operator, "values(false,false,false,false,false)", "values(true,true,true,true,true)", 1)
	if approved == operator {
		t.Fatal("could not enable disposable retirement approvals")
	}
	if _, err := db.Exec(`alter table node_information add column unexpected_drift text`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(approved); err == nil {
		t.Fatal("retirement unexpectedly accepted legacy column drift")
	}
	if _, err := db.Exec(`alter table node_information drop column unexpected_drift`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`create view surviving_node_dependency as select company_id from node_information`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(approved); err == nil {
		t.Fatal("retirement unexpectedly accepted a surviving view dependency")
	}
	for _, table := range []string{"node_information", "node_projection_table", "node_projection_seen_snapshots"} {
		var exists bool
		if err := db.QueryRow(`select to_regclass('public.'||$1) is not null`, table).Scan(&exists); err != nil || !exists {
			t.Fatalf("rollback lost %s exists=%v err=%v", table, exists, err)
		}
	}
	if _, err := db.Exec(`drop view surviving_node_dependency`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(approved); err != nil {
		t.Fatalf("approved Node retirement: %v", err)
	}
	for _, table := range []string{"node_information", "node_projection_table", "node_projection_seen_snapshots"} {
		var exists bool
		if err := db.QueryRow(`select to_regclass('public.'||$1) is not null`, table).Scan(&exists); err != nil || exists {
			t.Fatalf("retirement table %s exists=%v err=%v", table, exists, err)
		}
	}
	if _, err := db.Exec(approved); err == nil {
		t.Fatal("strict retirement rerun unexpectedly succeeded")
	}
}
