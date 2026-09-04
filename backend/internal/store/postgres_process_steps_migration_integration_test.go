package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// This fixture describes only the pre-cutover tables the migration changes.
// Runtime behavior is separately tested against the complete canonical schema.
const processStepsLegacyFixture = `
create table logic_gates(company_id uuid not null,logic_gate_id uuid not null,primary key(company_id,logic_gate_id));
create table nodes(company_id uuid not null,node_id uuid not null,name text not null,status text,
 due_date date,priority smallint,completion_transition_timestamp timestamptz,
 created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),
 primary key(company_id,node_id));
create table node_logic_gate_assignments(
 company_id uuid not null,assignment_id uuid not null,node_id uuid not null,logic_gate_id uuid not null,
 status_key text not null,column_id text not null,is_issue boolean not null default false,position integer not null,
 compatibility_board_id text not null,compatibility_card_id uuid not null,
 requested_by_user_id uuid,placed_by_user_id uuid,version bigint not null default 1,
 created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),
 primary key(company_id,assignment_id),unique(company_id,node_id));
create unique index idx_node_logic_gate_assignments_compat_card on node_logic_gate_assignments(company_id,compatibility_board_id,compatibility_card_id);
create index idx_node_logic_gate_assignments_logic_gate_position on node_logic_gate_assignments(company_id,logic_gate_id,column_id,position);
create table kanban_board_projection(company_id uuid,node_id uuid,status text);
create table recycle_bin_items(company_id uuid,recycle_bin_item_id uuid,restore_payload jsonb);
create table company_explorer_folders(company_id uuid,folder_id uuid,primary key(company_id,folder_id));
create table resource_operational_relationships(
 company_id uuid not null,resource_operational_relationship_id uuid not null,
 source_resource_type text not null,source_resource_id uuid not null,target_resource_type text not null,target_resource_id uuid not null,
 created_timestamp timestamptz not null default now(),primary key(company_id,resource_operational_relationship_id),
 unique(company_id,source_resource_type,source_resource_id,target_resource_type,target_resource_id),
 constraint resource_operational_relationships_source_type_chk check(source_resource_type in ('company_explorer_folder','logic_gate')),
 constraint resource_operational_relationships_target_type_chk check(target_resource_type in ('company_explorer_folder','logic_gate')));
create function trg_validate_resource_operational_relationship() returns trigger language plpgsql as $$begin return new; end$$;
create trigger trg_validate_resource_operational_relationship before insert or update on resource_operational_relationships
 for each row execute function trg_validate_resource_operational_relationship();
create table process_map_traces(company_id uuid,resource_operational_relationship_id uuid,route_points jsonb,
 foreign key(company_id,resource_operational_relationship_id) references resource_operational_relationships on delete cascade);
create function mangorts_bump_logic_gate_work_version(uuid,uuid) returns void language plpgsql as $$begin return; end$$;
create function mangorts_bump_logic_gate_work_versions_for_node(uuid,uuid) returns void language plpgsql as $$begin return; end$$;
create function mangorts_bump_logic_gate_work_versions_for_folder(uuid,uuid) returns void language plpgsql as $$begin return; end$$;
create function mangorts_trg_bump_logic_gate_work_from_gate_row() returns trigger language plpgsql as $$begin return null; end$$;
create function mangorts_trg_bump_logic_gate_work_from_node() returns trigger language plpgsql as $$begin return null; end$$;
create trigger trg_logic_gate_work_version_nodes after update of name,due_date,priority on nodes
 for each row execute function mangorts_trg_bump_logic_gate_work_from_node();
create table resource_permission_settings(company_id uuid,resource_type text,resource_id uuid);
create table resource_gvic_settings(company_id uuid,resource_type text,resource_id uuid);
create table resource_gvic_assignments(resource_type text not null,
 constraint resource_gvic_assignments_resource_type_chk check(resource_type in
 ('node','logic_gate','project','shared_triage_folder','shared_inbox','huddle_logic_gate','huddle_node')));
create table accounts(company_id uuid not null,account_id uuid not null,name text not null,folder_id uuid,position integer not null default 0,
 created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),primary key(company_id,account_id));
create table node_account_assignments(company_id uuid not null,node_id uuid not null,account_id uuid not null,
 primary key(company_id,node_id,account_id));
insert into logic_gates values
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003');
insert into nodes(company_id,node_id,name,status,due_date,priority,completion_transition_timestamp) values
 ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Live issue','Issue','2026-09-10',2,null),
 ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','Finished work','Done',null,null,'2026-08-30T12:00:00Z');
insert into node_logic_gate_assignments(company_id,assignment_id,node_id,logic_gate_id,status_key,column_id,is_issue,position,compatibility_board_id,compatibility_card_id)
 values
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','review','review',true,1000,'logic-gate:old','50000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','done','done',false,2000,'logic-gate:old','50000000-0000-4000-8000-000000000002');
insert into recycle_bin_items select '10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
 jsonb_build_object('nodes',(select jsonb_agg(to_jsonb(n)) from nodes n),
 'node_logic_gate_assignments',(select jsonb_agg(to_jsonb(a)) from node_logic_gate_assignments a),
 'kanban_board_projection','[]'::jsonb,'unrelated',jsonb_build_array(jsonb_build_object('content','keep me')));
`

func TestPostgresProcessStepsMigrationPreservesExistingWork(t *testing.T) {
	db := openPostgresProcessMapTestDatabase(t)
	if _, err := db.Exec(processStepsLegacyFixture); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260903_process_steps.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("Process Steps migration: %v", err)
	}
	var status, name, due string
	var issue, unassigned bool
	var priority int
	if err := db.QueryRow(`select n.status,n.name,n.due_date::text,n.priority,a.is_issue,a.process_step_id is null
 from nodes n join node_logic_gate_assignments a using(company_id,node_id)
 where n.node_id='30000000-0000-4000-8000-000000000001'`).Scan(&status, &name, &due, &priority, &issue, &unassigned); err != nil {
		t.Fatal(err)
	}
	if status != "Review" || name != "Live issue" || due != "2026-09-10" || priority != 2 || !issue || !unassigned {
		t.Fatalf("existing Node changed: status=%s name=%s due=%s priority=%d issue=%t unassigned=%t", status, name, due, priority, issue, unassigned)
	}
	var completed bool
	if err := db.QueryRow(`select status='Done' and completion_transition_timestamp='2026-08-30T12:00:00Z'::timestamptz
 from nodes where node_id='30000000-0000-4000-8000-000000000002'`).Scan(&completed); err != nil || !completed {
		t.Fatalf("completed work was changed: %t, %v", completed, err)
	}
	var retired bool
	if err := db.QueryRow(`select to_regclass('kanban_board_projection') is null and not exists(
 select 1 from information_schema.columns where table_schema='public' and table_name='node_logic_gate_assignments'
 and column_name in ('status_key','column_id','compatibility_board_id','compatibility_card_id'))`).Scan(&retired); err != nil || !retired {
		t.Fatalf("old storage remains: %t, %v", retired, err)
	}
	var payloadJSON []byte
	if err := db.QueryRow(`select restore_payload from recycle_bin_items`).Scan(&payloadJSON); err != nil {
		t.Fatal(err)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		t.Fatal(err)
	}
	if _, exists := payload["kanban_board_projection"]; exists {
		t.Fatal("recycle payload retains retired projection")
	}
	var savedNodes []struct {
		NodeID string `json:"node_id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(payload["nodes"], &savedNodes); err != nil {
		t.Fatal(err)
	}
	for _, node := range savedNodes {
		if node.NodeID == "30000000-0000-4000-8000-000000000001" && node.Status != "Review" {
			t.Fatalf("saved Node status = %s", node.Status)
		}
	}
	var snapshots []map[string]json.RawMessage
	if err := json.Unmarshal(payload["node_logic_gate_assignments"], &snapshots); err != nil {
		t.Fatal(err)
	}
	for _, snapshot := range snapshots {
		for _, field := range []string{"status_key", "column_id", "compatibility_board_id", "compatibility_card_id"} {
			if _, exists := snapshot[field]; exists {
				t.Fatalf("saved assignment retained %s", field)
			}
		}
		if string(snapshot["process_step_id"]) != "null" {
			t.Fatal("migration guessed a saved step assignment")
		}
	}
	var unrelated []map[string]string
	if err := json.Unmarshal(payload["unrelated"], &unrelated); err != nil || len(unrelated) != 1 || unrelated[0]["content"] != "keep me" {
		t.Fatalf("unrelated saved content changed: %v, %v", unrelated, err)
	}

	if _, err := db.Exec(`insert into process_steps(company_id,process_step_id,logic_gate_id,name,position) values
 ('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Prepare',1000),
 ('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Review',2000),
 ('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','Other Process',1000)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`update node_logic_gate_assignments set process_step_id='70000000-0000-4000-8000-000000000003'
 where node_id='30000000-0000-4000-8000-000000000001'`); err == nil {
		t.Fatal("cross-Process Node step assignment was accepted")
	}
	const insertEdge = `insert into resource_operational_relationships(company_id,resource_operational_relationship_id,source_resource_type,source_resource_id,target_resource_type,target_resource_id)
 values('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','process_step','70000000-0000-4000-8000-000000000001','process_step',$1::uuid)`
	if _, err := db.Exec(insertEdge, "70000000-0000-4000-8000-000000000003"); err == nil {
		t.Fatal("cross-Process step connection was accepted")
	}
	if _, err := db.Exec(insertEdge, "70000000-0000-4000-8000-000000000001"); err == nil {
		t.Fatal("self connection was accepted")
	}
	if _, err := db.Exec(insertEdge, "70000000-0000-4000-8000-000000000002"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into process_map_traces values('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','[]')`); err == nil {
		t.Fatal("step connection acquired company-map geometry")
	}
	if _, err := db.Exec(`update node_logic_gate_assignments set process_step_id='70000000-0000-4000-8000-000000000001';
 delete from process_steps where process_step_id='70000000-0000-4000-8000-000000000001'`); err != nil {
		t.Fatal(err)
	}
	var nodeCount, assignmentCount, edgeCount, assignedStepCount int
	if err := db.QueryRow(`select (select count(*) from nodes),(select count(*) from node_logic_gate_assignments),
 (select count(*) from resource_operational_relationships),(select count(*) from node_logic_gate_assignments where process_step_id is not null)`).Scan(&nodeCount, &assignmentCount, &edgeCount, &assignedStepCount); err != nil {
		t.Fatal(err)
	}
	if nodeCount != 2 || assignmentCount != 2 || edgeCount != 0 || assignedStepCount != 0 {
		t.Fatalf("step cleanup deleted work or retained edges: Nodes=%d assignments=%d edges=%d assigned=%d", nodeCount, assignmentCount, edgeCount, assignedStepCount)
	}
}

func TestPostgresProcessStepsEmergencyRollbackRestoresLegacySchema(t *testing.T) {
	db := openPostgresProcessMapTestDatabase(t)
	if _, err := db.Exec(`drop schema if exists mangorts_process_steps_rollback_20260903 cascade;` + processStepsLegacyFixture); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260903_process_steps.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("Process Steps migration: %v", err)
	}
	if _, err := db.Exec(`
create table schema_migrations(version text primary key,applied_at timestamptz not null default now());
insert into schema_migrations(version) values('20260902_previous.sql'),('20260903_process_steps.sql');
insert into process_steps(company_id,process_step_id,logic_gate_id,name,position) values
 ('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Prepare',1000),
 ('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Review',2000);
update node_logic_gate_assignments set process_step_id='70000000-0000-4000-8000-000000000001'
 where assignment_id='40000000-0000-4000-8000-000000000001';
insert into resource_operational_relationships(
 company_id,resource_operational_relationship_id,source_resource_type,source_resource_id,target_resource_type,target_resource_id
) values(
 '10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',
 'process_step','70000000-0000-4000-8000-000000000001','process_step','70000000-0000-4000-8000-000000000002'
);`); err != nil {
		t.Fatal(err)
	}
	rollback, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "process_steps_emergency_rollback.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(rollback)); err != nil {
		t.Fatalf("Process Steps emergency rollback: %v", err)
	}

	var restored bool
	if err := db.QueryRow(`select
 to_regclass('public.process_steps') is null
 and to_regclass('public.kanban_board_projection') is not null
 and exists(select 1 from information_schema.columns where table_schema='public' and table_name='node_logic_gate_assignments' and column_name='status_key')
 and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='node_logic_gate_assignments' and column_name='process_step_id')`).Scan(&restored); err != nil || !restored {
		t.Fatalf("legacy table shape was not restored: restored=%t err=%v", restored, err)
	}
	var statusKey, columnID, boardID, cardID string
	if err := db.QueryRow(`select status_key,column_id,compatibility_board_id,compatibility_card_id::text
 from node_logic_gate_assignments where assignment_id='40000000-0000-4000-8000-000000000001'`).Scan(
		&statusKey, &columnID, &boardID, &cardID,
	); err != nil {
		t.Fatal(err)
	}
	if statusKey != "review" || columnID != "review" || boardID != "logic-gate:20000000-0000-4000-8000-000000000001" || cardID != "40000000-0000-4000-8000-000000000001" {
		t.Fatalf("assignment was not reconstructed safely: status=%s column=%s board=%s card=%s", statusKey, columnID, boardID, cardID)
	}
	var projectionCount, liveEdgeCount, olderLedgerCount, exactLedgerCount int
	if err := db.QueryRow(`select
 (select count(*) from kanban_board_projection),
 (select count(*) from resource_operational_relationships where source_resource_type='process_step' or target_resource_type='process_step'),
 (select count(*) from schema_migrations where version='20260902_previous.sql'),
 (select count(*) from schema_migrations where version='20260903_process_steps.sql')`).Scan(
		&projectionCount, &liveEdgeCount, &olderLedgerCount, &exactLedgerCount,
	); err != nil {
		t.Fatal(err)
	}
	if projectionCount != 2 || liveEdgeCount != 0 || olderLedgerCount != 1 || exactLedgerCount != 0 {
		t.Fatalf("rollback live state mismatch: projection=%d edges=%d older-ledger=%d process-steps-ledger=%d", projectionCount, liveEdgeCount, olderLedgerCount, exactLedgerCount)
	}
	var archivedSteps, archivedPlacements, archivedEdges, archivedPayloads, archivedLedger int
	if err := db.QueryRow(`select
 (select count(*) from mangorts_process_steps_rollback_20260903.process_steps),
 (select count(*) from mangorts_process_steps_rollback_20260903.node_step_placements),
 (select count(*) from mangorts_process_steps_rollback_20260903.step_relationships),
 (select count(*) from mangorts_process_steps_rollback_20260903.recycle_payloads),
 (select count(*) from mangorts_process_steps_rollback_20260903.schema_migration_ledger)`).Scan(
		&archivedSteps, &archivedPlacements, &archivedEdges, &archivedPayloads, &archivedLedger,
	); err != nil {
		t.Fatal(err)
	}
	if archivedSteps != 2 || archivedPlacements != 1 || archivedEdges != 1 || archivedPayloads != 1 || archivedLedger != 1 {
		t.Fatalf("rollback archive mismatch: steps=%d placements=%d edges=%d payloads=%d ledger=%d", archivedSteps, archivedPlacements, archivedEdges, archivedPayloads, archivedLedger)
	}
}

func TestPostgresProcessStepsEmergencyRollbackRejectsLaterMigration(t *testing.T) {
	db := openPostgresProcessMapTestDatabase(t)
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`drop schema if exists mangorts_process_steps_rollback_20260903 cascade;` + processStepsLegacyFixture); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260903_process_steps.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("Process Steps migration: %v", err)
	}
	if _, err := db.Exec(`create table schema_migrations(version text primary key,applied_at timestamptz not null default now());
 insert into schema_migrations(version) values('20260903_process_steps.sql'),('20260904_future.sql')`); err != nil {
		t.Fatal(err)
	}
	rollback, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "process_steps_emergency_rollback.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(rollback)); err == nil || !strings.Contains(err.Error(), "a later database migration is recorded") {
		t.Fatalf("rollback did not reject a later migration: %v", err)
	}
	if _, err := db.Exec("rollback"); err != nil {
		t.Fatal(err)
	}
	var unchanged bool
	if err := db.QueryRow(`select to_regclass('public.process_steps') is not null
 and to_regnamespace('mangorts_process_steps_rollback_20260903') is null
 and exists(select 1 from schema_migrations where version='20260903_process_steps.sql')`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatalf("rejected rollback changed the cutover schema: unchanged=%t err=%v", unchanged, err)
	}
}

func TestPostgresProcessStepsMigrationRejectsUnknownRecycledStatus(t *testing.T) {
	db := openPostgresProcessMapTestDatabase(t)
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(processStepsLegacyFixture); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`update recycle_bin_items set restore_payload=jsonb_set(restore_payload,
 '{node_logic_gate_assignments,0,status_key}', '"Waiting on customer"')`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260903_process_steps.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err == nil {
		t.Fatal("migration discarded an unsupported recycled status")
	}
	if _, err := db.Exec("rollback"); err != nil {
		t.Fatal(err)
	}
	var unchanged bool
	if err := db.QueryRow(`select to_regclass('kanban_board_projection') is not null
 and to_regclass('process_steps') is null
 and (select status='Issue' from nodes where node_id='30000000-0000-4000-8000-000000000001')
 and (select restore_payload#>>'{node_logic_gate_assignments,0,status_key}'='Waiting on customer' from recycle_bin_items)`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatalf("rejected migration changed existing work: unchanged=%t, err=%v", unchanged, err)
	}
}
