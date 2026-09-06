package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPostgresProcessStepSOPMigrationPreservesRowsAndRecycle(t *testing.T) {
	db := openPostgresProcessMapTestDatabase(t)
	// Deliberately use another physical column order: the migration checks the
	// exact unordered column set, rather than rejecting a valid installation.
	const fixture = `
create table process_steps (
 logic_gate_id uuid not null, process_step_id uuid not null, company_id uuid not null,
 position integer not null, name text not null,
 updated_timestamp timestamptz not null default now(),created_timestamp timestamptz not null default now(),
 primary key(company_id,process_step_id));
create table logic_gate_textboxes (
 company_id uuid,logic_gate_id uuid,textbox_id text,body_json jsonb,deleted_timestamp timestamptz);
create table logic_gate_textboxes_history (
 company_id uuid,logic_gate_id uuid,textbox_id text,batch_id uuid,body_json jsonb,
 saved_by_user_id uuid,saved_timestamp timestamptz default now(),
 constraint logic_gate_textboxes_history_pkey primary key(company_id,logic_gate_id,batch_id,textbox_id));
create table recycle_bin_items (restore_payload jsonb not null);
create table schema_migrations (version text primary key);
insert into process_steps(logic_gate_id,process_step_id,company_id,position,name)
values('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000101',1000,'Review');
insert into logic_gate_textboxes_history(company_id,logic_gate_id,textbox_id,batch_id,body_json)
values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102','logic-gate-overview','00000000-0000-4000-8000-000000000104',
'{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}');
insert into recycle_bin_items(restore_payload)
select jsonb_build_object('marker','keep',
 'process_steps',(select jsonb_agg(to_jsonb(step)) from process_steps step),
 'logic_gate_textboxes_history',(select jsonb_agg(to_jsonb(history)) from logic_gate_textboxes_history history));`
	if _, err := db.Exec(fixture); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260905_process_step_sop_bodies.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("apply Step SOP migration: %v", err)
	}
	var liveName, liveFormat, historyType, savedName, savedFormat, savedHistoryType, marker string
	var liveRevision, savedRevision, migrations int
	if err := db.QueryRow(`select
 (select name from process_steps), (select body_json->>'format' from process_steps),
 (select revision from process_steps), (select resource_type from logic_gate_textboxes_history),
 restore_payload->'process_steps'->0->>'name',
 restore_payload->'process_steps'->0->'body_json'->>'format',
 (restore_payload->'process_steps'->0->>'revision')::integer,
 restore_payload->'logic_gate_textboxes_history'->0->>'resource_type',restore_payload->>'marker',
 (select count(*) from schema_migrations where version='20260905_process_step_sop_bodies.sql')
from recycle_bin_items`).Scan(&liveName, &liveFormat, &liveRevision, &historyType, &savedName, &savedFormat, &savedRevision, &savedHistoryType, &marker, &migrations); err != nil {
		t.Fatal(err)
	}
	if liveName != "Review" || savedName != liveName || liveFormat != MangoTiptapFormat || savedFormat != liveFormat || liveRevision != 0 || savedRevision != 0 || historyType != EntityTypeLogicGate || savedHistoryType != EntityTypeLogicGate || marker != "keep" || migrations != 1 {
		t.Fatalf("migration lost content or restore shape: live=%s/%s/%d history=%s recycle=%s/%s/%d/%s marker=%s ledger=%d", liveName, liveFormat, liveRevision, historyType, savedName, savedFormat, savedRevision, savedHistoryType, marker, migrations)
	}
	if _, err := db.Exec(`update process_steps set body_json='{}'::jsonb`); err == nil {
		t.Fatal("database accepted an invalid Step SOP envelope")
	}
	if _, err := db.Exec(string(migration)); err == nil || !strings.Contains(err.Error(), "STOP:") {
		t.Fatalf("repeated migration must stop before modifying rows: %v", err)
	}
}
