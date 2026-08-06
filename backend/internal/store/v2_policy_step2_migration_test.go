package store

import (
	"database/sql"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

const (
	v2PolicyStep2SchemaBegin = "-- BEGIN V2 GVIC AND PERMISSIONS STEP 2 CUTOVER SCHEMA"
	v2PolicyStep2SchemaEnd   = "-- END V2 GVIC AND PERMISSIONS STEP 2 CUTOVER SCHEMA"
	v2PolicyStep2Migration   = "20260805_zzzc_v2_gvic_permissions_step2_cutover.sql"
)

func TestV2PolicyStep2SchemaAndOperatorContract(t *testing.T) {
	schema := readV2PolicyStep1File(t, "..", "..", "db", "schema.sql")
	migration := readV2PolicyStep1File(t, "..", "..", "db", "migrations", v2PolicyStep2Migration)
	start := strings.Index(schema, v2PolicyStep2SchemaBegin)
	end := strings.Index(schema, v2PolicyStep2SchemaEnd)
	if start < 0 || end <= start {
		t.Fatal("canonical schema is missing the marked V2 policy Step 2 block")
	}
	if strings.TrimSpace(schema[start+len(v2PolicyStep2SchemaBegin):end]) != strings.TrimSpace(migration) {
		t.Fatal("canonical V2 policy Step 2 block drifted from the cutover migration")
	}
	lower := strings.ToLower(migration)
	for _, required := range []string{
		"begin;",
		"alter table resource_gvic_assignments rename to resource_gvic_assignments_step2_legacy",
		"alter table resource_permissions rename to resource_permissions_step2_legacy",
		"alter table resource_gvic_assignments_v2_staging rename to resource_gvic_assignments",
		"alter table resource_permissions_v2_staging rename to resource_permissions",
		"mangorts_v2_effective_gvic_assignments",
		"mangorts_user_can_access_resource",
		"mangorts_v2_materialize_detached_policy",
		"mangorts_v2_group_deleted_cleanup",
		"commit;",
	} {
		if !strings.Contains(lower, required) {
			t.Errorf("Step 2 cutover is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"drop table resource_gvic_assignments_step2_legacy",
		"drop table resource_permissions_step2_legacy",
		"\\set", "\\i", "\\copy", "\\echo", ":variable",
	} {
		if strings.Contains(lower, forbidden) {
			t.Errorf("Step 2 cutover contains forbidden %q", forbidden)
		}
	}
	for _, path := range [][]string{
		{"..", "..", "..", "scripts", "v2_gvic_permissions_step2_preflight.sql"},
		{"..", "..", "..", "scripts", "v2_gvic_permissions_step2_readiness.sql"},
	} {
		operatorSQL := strings.ToLower(readV2PolicyStep1File(t, path...))
		for _, required := range []string{"begin transaction read only", "current_setting('server_version_num')", "rollback;"} {
			if !strings.Contains(operatorSQL, required) {
				t.Errorf("operator SQL %s is missing %q", path[len(path)-1], required)
			}
		}
		for _, forbidden := range []string{"\\set", "\\i", "\\copy", "\\echo", ":variable", "ordinal_position"} {
			if strings.Contains(operatorSQL, forbidden) {
				t.Errorf("operator SQL %s contains forbidden %q", path[len(path)-1], forbidden)
			}
		}
	}
}

func TestV2PolicyStep2DisposablePostgresCutoverBehaviorAndFreshSchema(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_V2_POLICY_STEP2_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set MANGORTS_V2_POLICY_STEP2_TEST_DATABASE_URL to a disposable local PostgreSQL 17 or 18 database")
	}
	if os.Getenv("MANGORTS_V2_POLICY_STEP2_TEST_RESET_ACK") != "DROP_DISPOSABLE_SCHEMA" {
		t.Fatal("set MANGORTS_V2_POLICY_STEP2_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA for the guarded disposable test")
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
	if version < 170000 || version >= 190000 || !strings.HasPrefix(databaseName, "mangorts_v2_policy_step2_test") {
		t.Fatalf("refusing PostgreSQL version/database %d/%q", version, databaseName)
	}

	reset := func() {
		t.Helper()
		if _, err := db.Exec("drop schema public cascade; create schema public"); err != nil {
			t.Fatalf("reset disposable schema: %v", err)
		}
	}
	reset()
	schema := readV2PolicyStep1File(t, "..", "..", "db", "schema.sql")
	legacySchema := removeV2PolicyStep2SchemaBlock(t, removeV2PolicyStep1SchemaBlock(t, schema))
	if _, err := db.Exec(legacySchema); err != nil {
		t.Fatalf("apply legacy schema: %v", err)
	}
	for _, name := range v2PolicyStep1MigrationFiles {
		if _, err := db.Exec(readV2PolicyStep1File(t, "..", "..", "db", "migrations", name)); err != nil {
			t.Fatalf("apply Step 1 %s: %v", name, err)
		}
	}
	if _, err := db.Exec(v2PolicyStep1FixtureSQL); err != nil {
		t.Fatalf("seed converted fixture: %v", err)
	}
	if _, err := db.Exec(readV2PolicyStep1File(t, "..", "..", "..", "scripts", "v2_gvic_permissions_step1_copy_reconcile.sql")); err != nil {
		t.Fatalf("copy Step 1 fixture: %v", err)
	}
	if _, err := db.Exec(readV2PolicyStep1File(t, "..", "..", "db", "migrations", v2PolicyStep2Migration)); err != nil {
		t.Fatalf("apply Step 2 cutover: %v", err)
	}
	assertV2PolicyStep2CutoverNames(t, db)
	setupSQL, remainingSQL, ok := strings.Cut(v2PolicyStep2BehaviorSQL, "-- STEP2_COMMIT_BEFORE_DETACH")
	if !ok {
		t.Fatal("missing Step 2 behavior transaction boundary")
	}
	if _, err := db.Exec(setupSQL); err != nil {
		t.Fatalf("prepare Step 2 behavior: %v", err)
	}
	if _, err := db.Exec(remainingSQL); err != nil {
		t.Fatalf("exercise Step 2 behavior: %v", err)
	}

	var role, sourceType, sourceID string
	if err := db.QueryRow(`select role,source_resource_type,source_resource_id::text
from mangorts_v2_effective_gvic_assignments(
  '00000000-0000-4000-8000-000000000101','node','00000000-0000-4000-8000-000000000112'
) where user_id='00000000-0000-4000-8000-000000000103'`).Scan(&role, &sourceType, &sourceID); err != nil {
		t.Fatal(err)
	}
	if role != "verified" || sourceType != EntityTypeNode || sourceID != "00000000-0000-4000-8000-000000000112" {
		t.Fatalf("detached materialized effective GVIC=%s/%s/%s", role, sourceType, sourceID)
	}
	var nodeMode, permissionMode string
	var nodeParent, permissionParent int64
	if err := db.QueryRow(`select g.assignment_mode,g.parent_link_sequence,p.permission_mode,p.parent_link_sequence
from resource_gvic_settings g join resource_permission_settings p using(company_id,resource_type,resource_id)
where g.company_id='00000000-0000-4000-8000-000000000101' and g.resource_type='node' and g.resource_id='00000000-0000-4000-8000-000000000112'`).Scan(&nodeMode, &nodeParent, &permissionMode, &permissionParent); err != nil {
		t.Fatal(err)
	}
	if nodeMode != PolicyModeCustomized || permissionMode != PolicyModeCustomized || nodeParent != 0 || permissionParent != 0 {
		t.Fatalf("detached node settings=%s/%d %s/%d", nodeMode, nodeParent, permissionMode, permissionParent)
	}
	var canEdit bool
	if err := db.QueryRow(`select mangorts_user_can_access_resource(
  '00000000-0000-4000-8000-000000000101','node','00000000-0000-4000-8000-000000000112',
  '00000000-0000-4000-8000-000000000102','edit')`).Scan(&canEdit); err != nil || !canEdit {
		t.Fatalf("detached node effective edit=%v err=%v", canEdit, err)
	}
	var groupEdges int
	if err := db.QueryRow(`select count(*) from resource_gvic_assignments where principal_id='00000000-0000-4000-8000-000000000130'`).Scan(&groupEdges); err != nil || groupEdges != 0 {
		t.Fatalf("deleted group GVIC edges=%d err=%v", groupEdges, err)
	}

	reset()
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("apply fresh canonical Step 2 schema: %v", err)
	}
	assertV2PolicyStep2CutoverNames(t, db)
}

func removeV2PolicyStep2SchemaBlock(t *testing.T, schema string) string {
	t.Helper()
	start := strings.Index(schema, v2PolicyStep2SchemaBegin)
	end := strings.Index(schema, v2PolicyStep2SchemaEnd)
	if start < 0 || end <= start {
		t.Fatal("canonical schema is missing V2 policy Step 2 markers")
	}
	return schema[:start] + schema[end+len(v2PolicyStep2SchemaEnd):]
}

func assertV2PolicyStep2CutoverNames(t *testing.T, db interface {
	QueryRow(query string, args ...any) *sql.Row
}) {
	t.Helper()
	var finalGVIC, finalPermission, legacyGVIC, legacyPermission, stagingGVIC, stagingPermission bool
	if err := db.QueryRow(`select
  to_regclass('public.resource_gvic_assignments') is not null,
  to_regclass('public.resource_permissions') is not null,
  to_regclass('public.resource_gvic_assignments_step2_legacy') is not null,
  to_regclass('public.resource_permissions_step2_legacy') is not null,
  to_regclass('public.resource_gvic_assignments_v2_staging') is not null,
  to_regclass('public.resource_permissions_v2_staging') is not null`).Scan(
		&finalGVIC, &finalPermission, &legacyGVIC, &legacyPermission, &stagingGVIC, &stagingPermission,
	); err != nil {
		t.Fatal(err)
	}
	if !finalGVIC || !finalPermission || !legacyGVIC || !legacyPermission || stagingGVIC || stagingPermission {
		t.Fatalf("cutover names final=%v/%v legacy=%v/%v staging=%v/%v", finalGVIC, finalPermission, legacyGVIC, legacyPermission, stagingGVIC, stagingPermission)
	}
}

const v2PolicyStep2BehaviorSQL = `
update resource_gvic_settings set assignment_mode='customized',customized_sequence=nextval('resource_gvic_change_sequence'),descendant_reset_sequence=0
where company_id='00000000-0000-4000-8000-000000000101' and resource_type='company_explorer_folder' and resource_id='00000000-0000-4000-8000-000000000108';
delete from resource_gvic_assignments where company_id='00000000-0000-4000-8000-000000000101';
insert into resource_gvic_assignments(company_id,resource_type,resource_id,role,principal_type,principal_id)
values('00000000-0000-4000-8000-000000000101','company_explorer_folder','00000000-0000-4000-8000-000000000108','consulted','user','00000000-0000-4000-8000-000000000102');
update resource_gvic_settings set assignment_mode='inherited',customized_sequence=null where company_id='00000000-0000-4000-8000-000000000101' and resource_type='company_explorer_folder' and resource_id='00000000-0000-4000-8000-000000000109';
update resource_gvic_settings set assignment_mode='customized',customized_sequence=nextval('resource_gvic_change_sequence') where company_id='00000000-0000-4000-8000-000000000101' and resource_type='logic_gate' and resource_id='00000000-0000-4000-8000-000000000111';
insert into resource_gvic_assignments(company_id,resource_type,resource_id,role,principal_type,principal_id)
values('00000000-0000-4000-8000-000000000101','logic_gate','00000000-0000-4000-8000-000000000111','verified','user','00000000-0000-4000-8000-000000000103');
update resource_gvic_settings set assignment_mode='inherited',customized_sequence=null where company_id='00000000-0000-4000-8000-000000000101' and resource_type='node' and resource_id='00000000-0000-4000-8000-000000000112';

update resource_permission_settings set permission_mode='customized',default_access='no_access',customized_sequence=nextval('resource_permission_change_sequence'),descendant_reset_sequence=0
where company_id='00000000-0000-4000-8000-000000000101' and resource_type='company_explorer_folder' and resource_id='00000000-0000-4000-8000-000000000108';
delete from resource_permissions where company_id='00000000-0000-4000-8000-000000000101';
insert into resource_permissions(company_id,resource_type,resource_id,subject_type,subject_id,access_level)
values('00000000-0000-4000-8000-000000000101','company_explorer_folder','00000000-0000-4000-8000-000000000108','user','00000000-0000-4000-8000-000000000102','edit');
update resource_permission_settings set permission_mode='inherited',default_access=null,customized_sequence=null where company_id='00000000-0000-4000-8000-000000000101' and resource_type in ('company_explorer_folder','logic_gate','node') and resource_id in ('00000000-0000-4000-8000-000000000109','00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000112');

update resource_gvic_settings set descendant_reset_sequence=nextval('resource_gvic_change_sequence') where company_id='00000000-0000-4000-8000-000000000101' and resource_type='company_explorer_folder' and resource_id='00000000-0000-4000-8000-000000000108';
insert into company_explorer_folders(company_id,folder_id,parent_folder_id,name) values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000120','00000000-0000-4000-8000-000000000108','Moved-after-reset');
update company_explorer_items set parent_folder_id='00000000-0000-4000-8000-000000000120' where company_id='00000000-0000-4000-8000-000000000101' and target_type='logic_gate' and target_id='00000000-0000-4000-8000-000000000111';

-- STEP2_COMMIT_BEFORE_DETACH
delete from node_logic_gate_assignments where company_id='00000000-0000-4000-8000-000000000101' and node_id='00000000-0000-4000-8000-000000000112';

insert into company_user_groups(company_id,group_id,name) values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000130','Step 2 live group');
insert into company_user_group_members(company_id,group_id,user_id) values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000130','00000000-0000-4000-8000-000000000102');
update resource_gvic_settings set assignment_mode='customized',customized_sequence=nextval('resource_gvic_change_sequence') where company_id='00000000-0000-4000-8000-000000000101' and resource_type='project' and resource_id='00000000-0000-4000-8000-000000000113';
insert into resource_gvic_assignments(company_id,resource_type,resource_id,role,principal_type,principal_id) values('00000000-0000-4000-8000-000000000101','project','00000000-0000-4000-8000-000000000113','informed','group','00000000-0000-4000-8000-000000000130');
delete from company_user_groups where company_id='00000000-0000-4000-8000-000000000101' and group_id='00000000-0000-4000-8000-000000000130';
`
