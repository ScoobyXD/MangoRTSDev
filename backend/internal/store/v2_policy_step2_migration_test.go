package store

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

const (
	v2PolicyStep2Migration = "20260805_zzzc_v2_gvic_permissions_step2_cutover.sql"
	raciRoleMigration      = "20260806_zzz_raci_roles.sql"
)

func TestV2PolicyStep2SchemaAndOperatorContract(t *testing.T) {
	schema := strings.Join(strings.Fields(normalizeCanonicalSchemaContract(
		readV2PolicyStep1File(t, "..", "..", "db", "schema.sql"),
	)), " ")
	migration := readV2PolicyStep1File(t, "..", "..", "db", "migrations", v2PolicyStep2Migration)
	retiredPreflightGuard := regexp.MustCompile(`(?ms)\n\s*if exists\s*\(\s*select 1 from mangorts_v2_step1_preflight_report\(\)\s*where section='FINAL' and status<>'READY'\s*\)\s*then\s*raise exception 'v2_policy_step2_step1_preflight_stop';\s*end if;`)
	if !retiredPreflightGuard.MatchString(migration) {
		t.Fatal("historical Step 2 migration is missing its original preflight guard")
	}
	for _, required := range []string{
		"create table if not exists resource_gvic_assignments",
		"create table if not exists resource_permissions",
		"create table if not exists resource_gvic_settings",
		"create table if not exists resource_permission_settings",
		"create or replace function mangorts_v2_effective_gvic_assignments",
		"create or replace function mangorts_v2_materialize_detached_policy",
		"create or replace function mangorts_v2_group_deleted_cleanup",
		"create or replace function mangorts_user_can_access_resource",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("canonical final Step 2 schema is missing %q", required)
		}
	}
	for _, retired := range []string{
		"resource_gvic_assignments_v2_staging",
		"resource_permissions_v2_staging",
		"resource_gvic_assignments_step2_legacy",
		"resource_permissions_step2_legacy",
		"resource_gvic_effective_assignments",
		"resource_gvic_policy_revisions",
		"resource_gvic_subtree_applications",
		"resource_permission_policy_revisions",
		"resource_permission_subtree_applications",
		"gvic_matrix_projection_table",
	} {
		if strings.Contains(schema, "create table if not exists "+retired) {
			t.Errorf("canonical final Step 2 schema recreates retired table %s", retired)
		}
	}
	if strings.Contains(schema, "create or replace function mangorts_v2_step1_preflight_report") {
		t.Fatal("canonical schema still calls the retired Step 1 preflight report")
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

func TestRACIRoleMigrationAndSchemaContract(t *testing.T) {
	schema := strings.Join(strings.Fields(normalizeCanonicalSchemaContract(
		readV2PolicyStep1File(t, "..", "..", "db", "schema.sql"),
	)), " ")
	migration := readV2PolicyStep1File(t, "..", "..", "db", "migrations", raciRoleMigration)
	for _, required := range []string{
		"constraint resource_gvic_assignments_raci_role_chk",
		"'responsible'::text",
		"'accountable'::text",
		"'consulted'::text",
		"'informed'::text",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("canonical final RACI schema is missing %q", required)
		}
	}
	lower := strings.ToLower(migration)
	if strings.Contains(lower, "gvic_matrix_projection_table") {
		t.Fatal("RACI migration must not depend on the retired GVIC matrix projection table")
	}
	if strings.Contains(lower, "set event_type") || strings.Contains(lower, "where event_type") {
		t.Fatal("RACI migration must use notifications.notification_type, not a nonexistent event_type column")
	}
	for _, required := range []string{
		"when 'generated' then 'responsible'",
		"when 'verified' then 'accountable'",
		"when 'verifier' then 'accountable'",
		"check (role in ('responsible', 'accountable', 'consulted', 'informed'))",
		"drop constraint if exists resource_gvic_assignments_v2_staging_user_only_role_chk",
		"drop index if exists idx_resource_gvic_assignments_v2_one_generated",
		"when 'responsible' then 1 when 'accountable' then 2 when 'consulted' then 3",
		"update recycle_bin_items",
		"set surface='aci_inbox' where surface='cvi_inbox'",
		"set notification_type = case notification_type",
		"where notification_type in ('cvi_inbox.changed', 'cvi_inbox.rcvi_updated')",
		"when 'cvi_inbox.changed' then 'aci_inbox.changed'",
		"when 'cvi_inbox.rcvi_updated' then 'aci_inbox.raci_updated'",
	} {
		if !strings.Contains(lower, required) {
			t.Errorf("RACI migration is missing %q", required)
		}
	}
}
func TestV2PolicyFinalSchemaDisposablePostgresBehavior(t *testing.T) {
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
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("apply canonical final schema: %v", err)
	}
	assertV2PolicyFinalDatabaseObjects(t, db)

	repo := NewPostgresRepo(db)
	company, err := repo.CreateCompany("V2 final policy test")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("v2-final-policy-user", "v2-final-policy@example.test", "V2 Final Policy User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("v2-final-policy-user", company.CompanyID, "company_admin"); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "V2 final policy gate")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into resource_gvic_assignments(
  company_id,resource_type,resource_id,role,principal_type,principal_id
) values($1::uuid,'logic_gate',$2::uuid,'responsible','user',$3::uuid)`, company.CompanyID, gate.LogicGateID, user.UserID); err != nil {
		t.Fatalf("insert final Responsible assignment: %v", err)
	}
	var role string
	if err := db.QueryRow(`select role from mangorts_v2_effective_gvic_assignments(
  $1::uuid,'logic_gate',$2::uuid
) where user_id=$3::uuid`, company.CompanyID, gate.LogicGateID, user.UserID).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "responsible" {
		t.Fatalf("effective final RACI role=%q, want responsible", role)
	}
	if _, err := db.Exec(`insert into resource_gvic_assignments(
  company_id,resource_type,resource_id,role,principal_type,principal_id
) values($1::uuid,'logic_gate',$2::uuid,'generated','user',$3::uuid)`, company.CompanyID, gate.LogicGateID, user.UserID); err == nil {
		t.Fatal("canonical final schema accepted retired generated role")
	}
}
