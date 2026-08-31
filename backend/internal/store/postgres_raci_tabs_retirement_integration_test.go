package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPostgresRetiredRACITabsMigrationDropsProjectionWithoutTouchingGVIC(t *testing.T) {
	db, _ := openPostgresProcessMapIntegration(t)
	legacyMigration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260810_zzzz_raci_tabs.sql"))
	if err != nil {
		t.Fatal(err)
	}
	targetedMigration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260811_zz_targeted_raci_tabs.sql"))
	if err != nil {
		t.Fatal(err)
	}
	retirementMigration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260831_z_retire_raci_tabs.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct {
		name string
		sql  []byte
	}{
		{name: "legacy RACI Tabs schema", sql: legacyMigration},
		{name: "targeted RACI Tabs functions", sql: targetedMigration},
	} {
		if _, err := db.Exec(string(fixture.sql)); err != nil {
			t.Fatalf("apply %s: %v", fixture.name, err)
		}
	}

	const (
		companyID   = "10000000-0000-4000-8000-000000000001"
		userID      = "20000000-0000-4000-8000-000000000001"
		logicGateID = "40000000-0000-4000-8000-000000000001"
	)
	if _, err := db.Exec(`
insert into companies(company_id,name)
values('10000000-0000-4000-8000-000000000001','RACI retirement contract');
insert into users(user_id,cognito_subject,email,display_name)
values('20000000-0000-4000-8000-000000000001','raci-retirement-user','raci-retirement@example.com','RACI User');
insert into company_memberships(company_id,user_id,role)
values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','company_user');
insert into logic_gates(company_id,logic_gate_id,header,created_timestamp)
values('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Retained Process',now())`); err != nil {
		t.Fatalf("insert canonical GVIC fixture: %v", err)
	}
	if _, err := db.Exec(`
insert into resource_gvic_assignments(
  company_id,resource_type,resource_id,role,principal_type,principal_id
) values($1::uuid,'logic_gate',$2::uuid,'consulted','user',$3::uuid)`, companyID, logicGateID, userID); err != nil {
		t.Fatalf("insert canonical RACI assignment: %v", err)
	}
	var projectedRows, legacyTriggerCount int
	if err := db.QueryRow(`select count(*) from raci_tabs_items`).Scan(&projectedRows); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from pg_trigger where not tgisinternal and tgname like 'trg_zz_raci_tabs_%'`).Scan(&legacyTriggerCount); err != nil {
		t.Fatal(err)
	}
	if projectedRows != 1 || legacyTriggerCount != 8 {
		t.Fatalf("legacy RACI Tabs fixture rows/triggers = %d/%d, want 1/8", projectedRows, legacyTriggerCount)
	}

	for attempt := 1; attempt <= 2; attempt++ {
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(string(retirementMigration)); err != nil {
			_ = tx.Rollback()
			t.Fatalf("apply RACI Tabs retirement attempt %d: %v", attempt, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit RACI Tabs retirement attempt %d: %v", attempt, err)
		}
	}

	for _, tableName := range []string{"raci_tabs_items", "raci_tabs_folders"} {
		var exists bool
		if err := db.QueryRow(`select to_regclass('public.' || $1) is not null`, tableName).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Errorf("retired table %s still exists", tableName)
		}
	}
	for _, signature := range []string{
		"public.mangorts_raci_tabs_explorer_folder_changed()",
		"public.mangorts_raci_tabs_explorer_item_changed()",
		"public.mangorts_raci_tabs_group_changed()",
		"public.mangorts_raci_tabs_group_member_changed()",
		"public.mangorts_raci_tabs_logic_gate_changed()",
		"public.mangorts_raci_tabs_membership_added()",
		"public.mangorts_raci_tabs_policy_changed()",
		"public.mangorts_sync_raci_tabs_group_ancestors(uuid,uuid[])",
		"public.mangorts_sync_raci_tabs_policy_resource(uuid,text,uuid)",
		"public.mangorts_sync_raci_tabs_explorer_subtree(uuid,uuid)",
		"public.mangorts_sync_raci_tabs_logic_gate(uuid,uuid)",
	} {
		var exists bool
		if err := db.QueryRow(`select to_regprocedure($1) is not null`, signature).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Errorf("retired function %s still exists", signature)
		}
	}
	if err := db.QueryRow(`select count(*) from pg_trigger where not tgisinternal and tgname like 'trg_zz_raci_tabs_%'`).Scan(&legacyTriggerCount); err != nil {
		t.Fatal(err)
	}
	if legacyTriggerCount != 0 {
		t.Errorf("retired RACI Tabs triggers remaining = %d", legacyTriggerCount)
	}

	var settingsTable, assignmentsTable, effectiveFunction bool
	if err := db.QueryRow(`
select
  to_regclass('public.resource_gvic_settings') is not null,
  to_regclass('public.resource_gvic_assignments') is not null,
  to_regprocedure('public.mangorts_v2_effective_gvic_assignments(uuid,text,uuid)') is not null`).Scan(
		&settingsTable, &assignmentsTable, &effectiveFunction,
	); err != nil {
		t.Fatal(err)
	}
	if !settingsTable || !assignmentsTable || !effectiveFunction {
		t.Fatalf("canonical GVIC objects survived = settings:%t assignments:%t effective:%t", settingsTable, assignmentsTable, effectiveFunction)
	}
	var canonicalTriggerCount, directRows, effectiveRows int
	if err := db.QueryRow(`
select count(*)
from pg_trigger trigger_row
join pg_class table_row on table_row.oid=trigger_row.tgrelid
where table_row.oid='public.resource_gvic_assignments'::regclass
  and not trigger_row.tgisinternal
  and trigger_row.tgname in ('trg_logic_gate_work_version_gvic','trg_resource_gvic_assignments_validate')`).Scan(&canonicalTriggerCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
select
  (select count(*) from resource_gvic_assignments
   where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid
     and principal_type='user' and principal_id=$3::uuid),
  (select count(*) from mangorts_v2_effective_gvic_assignments($1::uuid,'logic_gate',$2::uuid)
   where user_id=$3::uuid and role='consulted')`, companyID, logicGateID, userID).Scan(&directRows, &effectiveRows); err != nil {
		t.Fatal(err)
	}
	if canonicalTriggerCount != 2 || directRows != 1 || effectiveRows != 1 {
		t.Fatalf("canonical GVIC triggers/direct/effective = %d/%d/%d, want 2/1/1", canonicalTriggerCount, directRows, effectiveRows)
	}
	if _, err := db.Exec(`
update resource_gvic_assignments set role='responsible'
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid
  and principal_type='user' and principal_id=$3::uuid`, companyID, logicGateID, userID); err != nil {
		t.Fatalf("update canonical RACI assignment after retirement: %v", err)
	}
	var effectiveRole string
	if err := db.QueryRow(`
select role from mangorts_v2_effective_gvic_assignments($1::uuid,'logic_gate',$2::uuid)
where user_id=$3::uuid`, companyID, logicGateID, userID).Scan(&effectiveRole); err != nil {
		t.Fatal(err)
	}
	if effectiveRole != "responsible" {
		t.Fatalf("canonical effective RACI role after retirement = %q, want responsible", effectiveRole)
	}
}
