package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
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

func TestV2PolicyFinalSchemaUsesCutoverStorage(t *testing.T) {
	schema := strings.Join(strings.Fields(normalizeCanonicalSchemaContract(
		readV2PolicyStep1File(t, "..", "..", "db", "schema.sql"),
	)), " ")
	for _, required := range []string{
		"create sequence resource_gvic_change_sequence",
		"create sequence resource_permission_change_sequence",
		"create table if not exists resource_gvic_settings",
		"create table if not exists resource_permission_settings",
		"create table if not exists resource_gvic_assignments",
		"create table if not exists resource_permissions",
		"create or replace function mangorts_v2_validate_policy_settings",
		"create or replace function mangorts_v2_validate_policy_edge",
		"create or replace function mangorts_v2_effective_gvic_assignments",
		"create trigger trg_resource_gvic_assignments_validate",
		"create trigger trg_resource_permissions_validate",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("canonical final V2 policy schema is missing %q", required)
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
		"company_user_group_closure",
	} {
		if strings.Contains(schema, "create table if not exists "+retired) {
			t.Errorf("canonical final V2 policy schema recreates retired table %s", retired)
		}
	}
	if strings.Contains(schema, "create or replace function mangorts_v2_step1_preflight_report") {
		t.Error("canonical final V2 policy schema recreates the retired Step 1 report")
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

func TestV2PolicyFinalSchemaDisposablePostgresReplay(t *testing.T) {
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
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("apply canonical final schema: %v", err)
	}
	assertV2PolicyFinalDatabaseObjects(t, db)
}

func assertV2PolicyFinalDatabaseObjects(t *testing.T, db *sql.DB) {
	t.Helper()
	var finalRACI, finalPermission, gvicSettings, permissionSettings bool
	var legacyRACI, legacyPermission, stagingRACI, stagingPermission bool
	if err := db.QueryRow(`select
  to_regclass('public.resource_gvic_assignments') is not null,
  to_regclass('public.resource_permissions') is not null,
  to_regclass('public.resource_gvic_settings') is not null,
  to_regclass('public.resource_permission_settings') is not null,
  to_regclass('public.resource_gvic_assignments_step2_legacy') is not null,
  to_regclass('public.resource_permissions_step2_legacy') is not null,
  to_regclass('public.resource_gvic_assignments_v2_staging') is not null,
  to_regclass('public.resource_permissions_v2_staging') is not null`).Scan(
		&finalRACI, &finalPermission, &gvicSettings, &permissionSettings,
		&legacyRACI, &legacyPermission, &stagingRACI, &stagingPermission,
	); err != nil {
		t.Fatal(err)
	}
	if !finalRACI || !finalPermission || !gvicSettings || !permissionSettings ||
		legacyRACI || legacyPermission || stagingRACI || stagingPermission {
		t.Fatalf("final V2 names final=%v/%v settings=%v/%v legacy=%v/%v staging=%v/%v",
			finalRACI, finalPermission, gvicSettings, permissionSettings,
			legacyRACI, legacyPermission, stagingRACI, stagingPermission)
	}
}
