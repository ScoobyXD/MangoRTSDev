package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

const (
	v2PolicyStep1SchemaBegin = "-- BEGIN V2 GVIC AND PERMISSIONS STEP 1 PHASE-APPROPRIATE SCHEMA"
	v2PolicyStep1SchemaEnd   = "-- END V2 GVIC AND PERMISSIONS STEP 1 PHASE-APPROPRIATE SCHEMA"
)

var v2PolicyStep1MigrationFiles = []string{
	"20260805_zzz_v2_gvic_permissions_step1.sql",
	"20260805_zzza_v2_gvic_permissions_step1_resolvers.sql",
	"20260805_zzzb_v2_gvic_permissions_step1_preflight_report.sql",
}

func readV2PolicyStep1File(t *testing.T, parts ...string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(parts...))
	if err != nil {
		t.Fatal(err)
	}
	return strings.ReplaceAll(string(raw), "\r\n", "\n")
}

func TestV2PolicyStep1CanonicalSchemaMatchesAdditiveMigrations(t *testing.T) {
	schema := readV2PolicyStep1File(t, "..", "..", "db", "schema.sql")
	start := strings.Index(schema, v2PolicyStep1SchemaBegin)
	end := strings.Index(schema, v2PolicyStep1SchemaEnd)
	if start < 0 || end <= start {
		t.Fatal("canonical schema is missing the marked V2 policy Step 1 block")
	}
	actual := strings.TrimSpace(schema[start+len(v2PolicyStep1SchemaBegin) : end])
	parts := make([]string, 0, len(v2PolicyStep1MigrationFiles))
	for _, name := range v2PolicyStep1MigrationFiles {
		parts = append(parts, strings.TrimSpace(readV2PolicyStep1File(t, "..", "..", "db", "migrations", name)))
	}
	expected := strings.Join(parts, "\n\n")
	if actual != expected {
		t.Fatal("canonical V2 policy Step 1 schema block drifted from the additive migrations")
	}
}

func TestV2PolicyStep1StorageAndOperatorContract(t *testing.T) {
	core := strings.ToLower(readV2PolicyStep1File(t, "..", "..", "db", "migrations", v2PolicyStep1MigrationFiles[0]))
	resolvers := strings.ToLower(readV2PolicyStep1File(t, "..", "..", "db", "migrations", v2PolicyStep1MigrationFiles[1]))
	report := strings.ToLower(readV2PolicyStep1File(t, "..", "..", "db", "migrations", v2PolicyStep1MigrationFiles[2]))
	preflight := strings.ToLower(readV2PolicyStep1File(t, "..", "..", "..", "scripts", "v2_gvic_permissions_step1_preflight.sql"))
	copySQL := strings.ToLower(readV2PolicyStep1File(t, "..", "..", "..", "scripts", "v2_gvic_permissions_step1_copy_reconcile.sql"))

	for _, required := range []string{
		"create sequence if not exists resource_gvic_change_sequence",
		"create sequence if not exists resource_permission_change_sequence",
		"create table if not exists resource_gvic_settings",
		"create table if not exists resource_permission_settings",
		"create table if not exists resource_gvic_assignments_v2_staging",
		"create table if not exists resource_permissions_v2_staging",
		"mangorts_v2_validate_policy_settings",
		"mangorts_v2_validate_policy_edge",
		"exact unordered",
	} {
		if !strings.Contains(core+preflight, required) {
			t.Errorf("V2 policy Step 1 storage/preflight is missing %q", required)
		}
	}
	for _, required := range []string{
		"latest_snapshot_application",
		"app.policy_sequence > cutoff.policy_sequence",
		"app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application),0)",
		"shared_triage_folder",
		"shared_inbox_folder",
	} {
		if !strings.Contains(resolvers, required) {
			t.Errorf("V2 policy Step 1 resolver is missing %q", required)
		}
	}
	for _, required := range []string{
		"effective_disagreements",
		"projection_disagreements",
		"source_dispositions",
		"invalid_principals",
		"invalid_gvic_shape",
	} {
		if !strings.Contains(report, required) {
			t.Errorf("V2 policy Step 1 report is missing %q", required)
		}
	}
	for _, required := range []string{
		"begin transaction read only",
		"current_setting('server_version_num')",
		"transaction_read_only",
		"'final','v2_gvic_permissions_step1_preflight'",
	} {
		if !strings.Contains(preflight, required) {
			t.Errorf("V2 policy Step 1 preflight is missing %q", required)
		}
	}
	for _, forbidden := range []string{"\\set", "\\i", "\\copy", "\\echo", ":variable"} {
		if strings.Contains(preflight, forbidden) || strings.Contains(copySQL, forbidden) {
			t.Errorf("DBeaver operator SQL contains psql-only marker %q", forbidden)
		}
	}
	for _, required := range []string{
		"transaction isolation level repeatable read",
		"assignment_mode='customized'",
		"permission_mode='customized'",
		"descendant_reset_sequence=0",
		"setval('resource_gvic_change_sequence'",
		"setval('resource_permission_change_sequence'",
		"v2_policy_step1_gvic_edge_reconciliation_failed",
		"v2_policy_step1_permission_edge_reconciliation_failed",
	} {
		if !strings.Contains(copySQL, required) {
			t.Errorf("V2 policy Step 1 copy is missing %q", required)
		}
	}
	for _, legacy := range []string{
		"resource_gvic_assignments", "resource_gvic_effective_assignments",
		"resource_gvic_policy_revisions", "resource_gvic_subtree_applications",
		"resource_permissions", "resource_permission_policy_revisions",
		"resource_permission_subtree_applications", "gvic_matrix_projection_table",
	} {
		for _, verb := range []string{"drop table", "alter table", "delete from", "update", "insert into"} {
			destructive := regexp.MustCompile(`(?m)\b` + regexp.QuoteMeta(verb) + `\s+` + regexp.QuoteMeta(legacy) + `(?:\s|\(|;)`)
			if destructive.MatchString(core + resolvers + report + copySQL) {
				t.Errorf("Step 1 mutates or retires legacy storage with %s %s", verb, legacy)
			}
		}
	}
}

func TestV2PolicyStep1DisposablePostgresFirstRunRerunDriftAndRollback(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_V2_POLICY_STEP1_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set MANGORTS_V2_POLICY_STEP1_TEST_DATABASE_URL to a disposable local PostgreSQL 17 or 18 database")
	}
	if os.Getenv("MANGORTS_V2_POLICY_STEP1_TEST_RESET_ACK") != "DROP_DISPOSABLE_SCHEMA" {
		t.Fatal("set MANGORTS_V2_POLICY_STEP1_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA for the guarded disposable test")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.Host != "127.0.0.1" && !strings.EqualFold(config.Host, "localhost") {
		t.Fatalf("refusing non-local disposable database host %q", config.Host)
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	defer db.Close()

	var version int
	var databaseName string
	if err := db.QueryRow(`select current_setting('server_version_num')::integer,current_database()`).Scan(&version, &databaseName); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 190000 {
		t.Fatalf("PostgreSQL version=%d, want 17.x or 18.x", version)
	}
	if !strings.HasPrefix(databaseName, "mangorts_v2_policy_step1_test") {
		t.Fatalf("refusing non-disposable database %q", databaseName)
	}
	if _, err := db.Exec("drop schema public cascade; create schema public"); err != nil {
		t.Fatalf("reset disposable schema: %v", err)
	}

	schema := readV2PolicyStep1File(t, "..", "..", "db", "schema.sql")
	legacySchema := removeV2PolicyStep1SchemaBlock(t, schema)
	if _, err := db.Exec(legacySchema); err != nil {
		t.Fatalf("apply legacy canonical schema: %v", err)
	}
	for run := 1; run <= 2; run++ {
		for _, name := range v2PolicyStep1MigrationFiles {
			if _, err := db.Exec(readV2PolicyStep1File(t, "..", "..", "db", "migrations", name)); err != nil {
				t.Fatalf("Step 1 expansion run %d file %s: %v", run, name, err)
			}
		}
	}
	if _, err := db.Exec(v2PolicyStep1FixtureSQL); err != nil {
		t.Fatalf("seed V2 policy Step 1 fixture: %v", err)
	}

	preflight := readV2PolicyStep1File(t, "..", "..", "..", "scripts", "v2_gvic_permissions_step1_preflight.sql")
	if status := queryV2PolicyStep1PreflightFinal(t, db, preflight); status != "READY" {
		t.Fatalf("first preflight status=%s, want READY", status)
	}
	copySQL := readV2PolicyStep1File(t, "..", "..", "..", "scripts", "v2_gvic_permissions_step1_copy_reconcile.sql")
	if _, err := db.Exec(copySQL); err != nil {
		t.Fatalf("first V2 policy Step 1 copy: %v", err)
	}
	assertV2PolicyStep1CopiedFixture(t, db, "edit")
	if _, err := db.Exec(copySQL); err != nil {
		t.Fatalf("identical V2 policy Step 1 rerun: %v", err)
	}
	assertV2PolicyStep1CopiedFixture(t, db, "edit")

	if _, err := db.Exec(`alter table resource_permissions_v2_staging add column unexpected_drift text`); err != nil {
		t.Fatal(err)
	}
	if status := queryV2PolicyStep1PreflightFinal(t, db, preflight); status != "STOP" {
		t.Fatalf("drifted preflight status=%s, want STOP", status)
	}
	if _, err := db.Exec(readV2PolicyStep1File(t, "..", "..", "db", "migrations", v2PolicyStep1MigrationFiles[0])); err == nil {
		t.Fatal("additive migration accepted destination column drift")
	}
	if _, err := db.Exec(`alter table resource_permissions_v2_staging drop column unexpected_drift`); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Exec(v2PolicyStep1RollbackTriggerSQL); err != nil {
		t.Fatalf("install disposable rollback trigger: %v", err)
	}
	if _, err := db.Exec(`
update resource_permissions set access_level='no_access'
where company_id='00000000-0000-4000-8000-000000000101'
  and resource_type='logic_gate'
  and resource_id='00000000-0000-4000-8000-000000000111'
  and subject_type='user'
  and subject_id='00000000-0000-4000-8000-000000000102'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(copySQL); err == nil {
		t.Fatal("forced reconciliation mismatch unexpectedly committed")
	}
	if _, err := db.Exec("rollback"); err != nil {
		t.Fatalf("rollback expected failed copy transaction: %v", err)
	}
	assertV2PolicyStep1CopiedFixture(t, db, "edit")
	if _, err := db.Exec(`drop trigger v2_step1_force_permission_drift on resource_permissions_v2_staging; drop function v2_step1_force_permission_drift()`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(copySQL); err != nil {
		t.Fatalf("reconcile after removing forced mismatch: %v", err)
	}
	assertV2PolicyStep1CopiedFixture(t, db, "no_access")

	for _, legacy := range []string{
		"resource_gvic_assignments", "resource_gvic_effective_assignments", "resource_gvic_policy_revisions",
		"resource_gvic_subtree_applications", "resource_permissions", "resource_permission_policy_revisions",
		"resource_permission_subtree_applications", "gvic_matrix_projection_table",
	} {
		var exists bool
		if err := db.QueryRow(`select to_regclass('public.'||$1) is not null`, legacy).Scan(&exists); err != nil || !exists {
			t.Fatalf("Step 1 lost legacy table %s exists=%v err=%v", legacy, exists, err)
		}
	}
}

func removeV2PolicyStep1SchemaBlock(t *testing.T, schema string) string {
	t.Helper()
	start := strings.Index(schema, v2PolicyStep1SchemaBegin)
	end := strings.Index(schema, v2PolicyStep1SchemaEnd)
	if start < 0 || end <= start {
		t.Fatal("canonical schema is missing V2 policy Step 1 markers")
	}
	return schema[:start] + schema[end+len(v2PolicyStep1SchemaEnd):]
}

func queryV2PolicyStep1PreflightFinal(t *testing.T, db *sql.DB, script string) string {
	t.Helper()
	query := strings.TrimSpace(script)
	query = strings.TrimSpace(strings.TrimPrefix(query, "-- V2 RACI and permissions Step 1 read-only preflight.\n-- Run in DBeaver after the additive Step 1 migrations. The last row is READY or STOP."))
	query = strings.TrimSpace(strings.TrimPrefix(query, "begin transaction read only;"))
	query = strings.TrimSpace(strings.TrimSuffix(query, "commit;"))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	finalStatus := ""
	for rows.Next() {
		var section, identity, status string
		var details json.RawMessage
		if err := rows.Scan(&section, &identity, &status, &details); err != nil {
			t.Fatal(err)
		}
		if section == "FINAL" && identity == "v2_gvic_permissions_step1_preflight" {
			finalStatus = status
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if finalStatus == "" {
		t.Fatal("preflight returned no FINAL row")
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return finalStatus
}

func assertV2PolicyStep1CopiedFixture(t *testing.T, db *sql.DB, gateAccess string) {
	t.Helper()
	var resources, gvicSettings, permissionSettings, gvicEdges, permissionEdges int
	if err := db.QueryRow(`select
  (select count(*) from nodes)+(select count(*) from logic_gates)+(select count(*) from projects)+
    (select count(*) from company_explorer_folders)+(select count(*) from shared_inbox_folders)+(select count(*) from shared_inboxes),
  (select count(*) from resource_gvic_settings),
  (select count(*) from resource_permission_settings),
  (select count(*) from resource_gvic_assignments_v2_staging),
  (select count(*) from resource_permissions_v2_staging)`).Scan(
		&resources, &gvicSettings, &permissionSettings, &gvicEdges, &permissionEdges,
	); err != nil {
		t.Fatal(err)
	}
	if resources != 7 || gvicSettings != 7 || permissionSettings != 7 || gvicEdges != 3 || permissionEdges != 3 {
		t.Fatalf("copy counts resources/gvic-settings/permission-settings/gvic-edges/permission-edges=%d/%d/%d/%d/%d",
			resources, gvicSettings, permissionSettings, gvicEdges, permissionEdges)
	}
	var modeRows, resetRows, normalizedAliases int
	if err := db.QueryRow(`select
  (select count(*) from resource_gvic_settings where assignment_mode='customized')+
    (select count(*) from resource_permission_settings where permission_mode='customized'),
  (select count(*) from resource_gvic_settings where descendant_reset_sequence=0)+
    (select count(*) from resource_permission_settings where descendant_reset_sequence=0),
  (select count(*) from resource_gvic_assignments_v2_staging where resource_type='shared_inbox_folder')`).Scan(
		&modeRows, &resetRows, &normalizedAliases,
	); err != nil {
		t.Fatal(err)
	}
	if modeRows != 14 || resetRows != 14 || normalizedAliases != 1 {
		t.Fatalf("baseline modes/resets/aliases=%d/%d/%d", modeRows, resetRows, normalizedAliases)
	}
	var actualGateAccess string
	if err := db.QueryRow(`select access_level from resource_permissions_v2_staging
where company_id='00000000-0000-4000-8000-000000000101'
  and resource_type='logic_gate' and resource_id='00000000-0000-4000-8000-000000000111'
  and subject_type='user' and subject_id='00000000-0000-4000-8000-000000000102'`).Scan(&actualGateAccess); err != nil {
		t.Fatal(err)
	}
	if actualGateAccess != gateAccess {
		t.Fatalf("gate staged access=%q, want %q", actualGateAccess, gateAccess)
	}
	var nodeRole, nodePrincipalType string
	if err := db.QueryRow(`select role,principal_type from resource_gvic_assignments_v2_staging
where company_id='00000000-0000-4000-8000-000000000101'
  and resource_type='node' and resource_id='00000000-0000-4000-8000-000000000112'`).Scan(&nodeRole, &nodePrincipalType); err != nil {
		t.Fatal(err)
	}
	if nodeRole != "informed" || nodePrincipalType != "group" {
		t.Fatalf("latest-snapshot node RACI=%s/%s, want informed/group", nodeRole, nodePrincipalType)
	}
}

const v2PolicyStep1RollbackTriggerSQL = `
create function v2_step1_force_permission_drift() returns trigger language plpgsql as $$
begin
  if new.resource_type='logic_gate'
     and new.resource_id='00000000-0000-4000-8000-000000000111'
     and new.subject_type='user'
     and new.subject_id='00000000-0000-4000-8000-000000000102' then
    new.access_level := 'edit';
  end if;
  return new;
end;
$$;
create trigger v2_step1_force_permission_drift
before insert or update on resource_permissions_v2_staging
for each row execute function v2_step1_force_permission_drift();`

const v2PolicyStep1FixtureSQL = `
insert into companies(company_id,name) values('00000000-0000-4000-8000-000000000101','V2 policy fixture');
insert into users(user_id,cognito_subject,email,display_name) values
  ('00000000-0000-4000-8000-000000000102','v2-user-1','v2-user-1@example.com','V2 User One'),
  ('00000000-0000-4000-8000-000000000103','v2-user-2','v2-user-2@example.com','V2 User Two');
insert into company_memberships(company_id,user_id,role) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102','company_user'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000103','company_user');
insert into company_user_groups(company_id,group_id,name) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000104','Fixture group');
insert into company_user_group_members(company_id,group_id,user_id) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000103');
insert into company_user_group_closure(company_id,ancestor_group_id,descendant_group_id,depth) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000104',0);

insert into company_explorer_folders(company_id,folder_id,parent_folder_id,name,default_access) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000108',null,'Root','no_access'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000109','00000000-0000-4000-8000-000000000108','Child','edit');
insert into logic_gates(company_id,logic_gate_id,header,default_access,created_timestamp) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000111','Gate','edit',now());
insert into nodes(company_id,node_id,name,priority,default_access,created_timestamp) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000112','Node',1,'no_access',now());
insert into projects(company_id,project_id,name,default_access) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000113','Project','edit');
insert into company_explorer_items(company_id,item_id,parent_folder_id,target_type,target_id) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000109','logic_gate','00000000-0000-4000-8000-000000000111'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000115','00000000-0000-4000-8000-000000000108','project','00000000-0000-4000-8000-000000000113');
insert into node_logic_gate_assignments(
  assignment_id,company_id,node_id,logic_gate_id,status_key,column_id,position,
  compatibility_board_id,compatibility_card_id
) values(
  '00000000-0000-4000-8000-000000000116','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000112','00000000-0000-4000-8000-000000000111',
  'todo','todo',0,'logic-gate:00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000117'
);
insert into shared_inbox_folders(company_id,folder_id,name,default_access) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000118','Shared root','edit');
insert into shared_inboxes(company_id,shared_inbox_id,parent_folder_id,name,account_email,default_access) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000119','00000000-0000-4000-8000-000000000118','Inbox','fixture@example.com','edit');

insert into resource_gvic_assignments(company_id,resource_type,resource_id,role,principal_type,principal_id) values
  ('00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111','generated','user','00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000101','node','00000000-0000-4000-8000-000000000112','consulted','user','00000000-0000-4000-8000-000000000103'),
  ('00000000-0000-4000-8000-000000000101','shared_triage_folder','00000000-0000-4000-8000-000000000118','informed','user','00000000-0000-4000-8000-000000000102');
insert into resource_gvic_policy_revisions(company_id,resource_type,resource_id,policy_sequence) values
  ('00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111',10),
  ('00000000-0000-4000-8000-000000000101','node','00000000-0000-4000-8000-000000000112',5);
insert into resource_gvic_subtree_applications(
  policy_sequence,company_id,ancestor_resource_type,ancestor_resource_id,role,principal_type,principal_id,deleted,snapshot
) values
  (20,'00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111',null,null,null,false,true),
  (20,'00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111','informed','group','00000000-0000-4000-8000-000000000104',false,false);
insert into resource_gvic_effective_assignments(
  company_id,resource_type,resource_id,role,user_id,source_resource_type,source_resource_id,
  source_principal_type,source_principal_id,inheritance_type
) values
  ('00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111','generated','00000000-0000-4000-8000-000000000102','logic_gate','00000000-0000-4000-8000-000000000111','user','00000000-0000-4000-8000-000000000102','direct'),
  ('00000000-0000-4000-8000-000000000101','node','00000000-0000-4000-8000-000000000112','informed','00000000-0000-4000-8000-000000000103','node','00000000-0000-4000-8000-000000000112','group','00000000-0000-4000-8000-000000000104','direct'),
  ('00000000-0000-4000-8000-000000000101','shared_triage_folder','00000000-0000-4000-8000-000000000118','informed','00000000-0000-4000-8000-000000000102','shared_triage_folder','00000000-0000-4000-8000-000000000118','user','00000000-0000-4000-8000-000000000102','direct');
insert into gvic_matrix_projection_table(
  company_id,projection_row_id,user_id,node_name,gvic_assignment,priority,logic_gate_id,logic_gate_name,node_id
) values(
  '00000000-0000-4000-8000-000000000101','fixture-node-informer','00000000-0000-4000-8000-000000000103',
  'Node','informed',1,'00000000-0000-4000-8000-000000000111','Gate','00000000-0000-4000-8000-000000000112'
);

insert into resource_permissions(company_id,resource_type,resource_id,subject_type,subject_id,user_id,access_level) values
  ('00000000-0000-4000-8000-000000000101','company_explorer_folder','00000000-0000-4000-8000-000000000108','group','00000000-0000-4000-8000-000000000104',null,'no_access'),
  ('00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111','user','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000102','edit'),
  ('00000000-0000-4000-8000-000000000101','node','00000000-0000-4000-8000-000000000112','user','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000102','no_access');
insert into resource_permission_policy_revisions(company_id,resource_type,resource_id,policy_sequence) values
  ('00000000-0000-4000-8000-000000000101','company_explorer_folder','00000000-0000-4000-8000-000000000108',7),
  ('00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111',8),
  ('00000000-0000-4000-8000-000000000101','node','00000000-0000-4000-8000-000000000112',5);
insert into resource_permission_subtree_applications(
  policy_sequence,company_id,ancestor_resource_type,ancestor_resource_id,rule_key,subject_type,subject_id,access_level,deleted
) values
  (30,'00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111','__snapshot__',null,null,null,false),
  (30,'00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111','__default__',null,null,'edit',false),
  (30,'00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111','user:00000000-0000-4000-8000-000000000103','user','00000000-0000-4000-8000-000000000103','edit',false);
`
