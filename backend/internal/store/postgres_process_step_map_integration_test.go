package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPostgresProcessStepMapLifecycle(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Step map integration")
	if err != nil {
		t.Fatal(err)
	}
	assertProcessStepMapLifecycle(t, repo, company.CompanyID)
}

func TestPostgresProcessStepMapEventFailureIsAtomic(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Atomic Step map")
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Process")
	if err != nil {
		t.Fatal(err)
	}
	installRealtimeOutboxFailureTrigger(t, db)
	forceRealtimeOutboxEvent(t, db, ProcessWorkChangedEventType, true)
	if _, err := repo.PutProcessStepMap(ProcessStepMapPutInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID}); err == nil {
		t.Fatal("save succeeded despite failed outbox")
	}
	layout, err := repo.GetProcessStepMap(company.CompanyID, gate.LogicGateID)
	if err != nil || layout.Revision != 0 {
		t.Fatalf("failed save leaked layout: %+v %v", layout, err)
	}
}

func TestPostgresProcessStepMapMigration(t *testing.T) {
	db := openPostgresProcessMapTestDatabase(t)
	// Minimal preexisting authority: migration must add presentation without
	// rewriting the actual Process, Step or relationship identities.
	_, err := db.Exec(`
create table logic_gates(company_id uuid not null,logic_gate_id uuid not null,primary key(company_id,logic_gate_id));
create table process_steps(company_id uuid not null,process_step_id uuid not null,logic_gate_id uuid not null,primary key(company_id,process_step_id));
create table resource_operational_relationships(company_id uuid not null,resource_operational_relationship_id uuid not null,source_resource_type text not null,source_resource_id uuid not null,target_resource_type text not null,target_resource_id uuid not null,primary key(company_id,resource_operational_relationship_id));
insert into logic_gates values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
insert into process_steps values('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
insert into process_steps values('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001');
insert into resource_operational_relationships values('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','process_step','30000000-0000-4000-8000-000000000001','process_step','30000000-0000-4000-8000-000000000002');`)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260904_process_step_map_layouts.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(migration)); err != nil {
		t.Fatalf("migration: %v", err)
	}
	if countPostgresRows(t, db, `select count(*) from logic_gates`) != 1 || countPostgresRows(t, db, `select count(*) from process_steps`) != 2 || countPostgresRows(t, db, `select count(*) from resource_operational_relationships`) != 1 {
		t.Fatal("migration rewrote authored records")
	}
	var firstRevision, nextRevision int64
	var snapshot []byte
	err = db.QueryRow(`insert into process_step_map_layouts(company_id,logic_gate_id,steps,routes) values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','[{"process_step_id":"30000000-0000-4000-8000-000000000001","x":1,"y":2,"width":200,"height":100}]','[{"resource_operational_relationship_id":"40000000-0000-4000-8000-000000000001","points":[{"x":10,"y":20}]}]') returning revision,to_jsonb(process_step_map_layouts)`).Scan(&firstRevision, &snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`delete from resource_operational_relationships`); err != nil {
		t.Fatal(err)
	}
	var steps, routes json.RawMessage
	if err = db.QueryRow(`select revision,steps,routes from process_step_map_layouts`).Scan(&nextRevision, &steps, &routes); err != nil || nextRevision <= firstRevision || string(routes) != "[]" {
		t.Fatalf("direct edge delete left route: %s %v", routes, err)
	}
	if _, err = db.Exec(`delete from process_steps`); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`select steps from process_step_map_layouts`).Scan(&steps); err != nil || string(steps) != "[]" {
		t.Fatalf("direct Step delete left rectangle: %s %v", steps, err)
	}
	if _, err = db.Exec(`delete from logic_gates`); err != nil {
		t.Fatal(err)
	}
	if countPostgresRows(t, db, `select count(*) from process_step_map_layouts`) != 0 {
		t.Fatal("deleted Process retained layout")
	}
	// A restored presentation row cannot retain its old concurrency revision.
	if _, err = db.Exec(`
insert into logic_gates values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
insert into process_steps values('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001');
insert into resource_operational_relationships values('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','process_step','30000000-0000-4000-8000-000000000001','process_step','30000000-0000-4000-8000-000000000002');`); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`insert into process_step_map_layouts select * from jsonb_populate_record(null::process_step_map_layouts,$1::jsonb) returning revision`, string(snapshot)).Scan(&nextRevision); err != nil || nextRevision <= firstRevision {
		t.Fatalf("restore reused old revision: %d %v", nextRevision, err)
	}
}
