package main

import (
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func testEnv(values map[string]string) envLookup {
	return func(key string) string {
		return values[key]
	}
}

func TestParseDBConfigDefaultsAndRequiredEnv(t *testing.T) {
	if _, err := parseDBConfig(testEnv(nil), false); err == nil {
		t.Fatalf("expected missing env error")
	} else if !strings.Contains(err.Error(), "DB_HOST") || !strings.Contains(err.Error(), "DB_PASSWORD") {
		t.Fatalf("missing env error did not name required vars: %v", err)
	}

	cfg, err := parseDBConfig(testEnv(map[string]string{
		"DB_HOST":                    "host=db.example.com",
		"DB_PASSWORD":                "pa ss",
		"DB_CONNECT_TIMEOUT_SECONDS": "not-an-int",
	}), false)
	if err != nil {
		t.Fatalf("parseDBConfig returned error: %v", err)
	}

	if cfg.Host != "db.example.com" {
		t.Fatalf("Host = %q, want db.example.com", cfg.Host)
	}
	if cfg.Port != "5432" || cfg.User != "postgres" || cfg.Name != "postgres" || cfg.SSLMode != "require" {
		t.Fatalf("defaults not applied: %+v", cfg)
	}
	if cfg.Password != "pa ss" {
		t.Fatalf("Password = %q, want exact env value", cfg.Password)
	}
	if cfg.ConnectTimeoutSeconds != 5 {
		t.Fatalf("ConnectTimeoutSeconds = %d, want fallback 5", cfg.ConnectTimeoutSeconds)
	}
}

func TestParseDBConfigAuditAllowsPasswordFile(t *testing.T) {
	cfg, err := parseDBConfig(testEnv(map[string]string{
		"DB_HOST": "db.example.com",
		"DB_USER": "mangorts_readonly",
	}), true)
	if err != nil {
		t.Fatalf("password-file audit config: %v", err)
	}
	if cfg.Password != "" {
		t.Fatalf("audit password=%q, want omitted password", cfg.Password)
	}
	parsed, err := url.Parse(buildConnString(cfg))
	if err != nil {
		t.Fatal(err)
	}
	if _, present := parsed.User.Password(); present {
		t.Fatal("passwordless audit connection encoded an empty password")
	}
}

func TestParseCommandConfigDefaultsAndAnchors(t *testing.T) {
	cfg, err := parseCommandConfig(nil, testEnv(map[string]string{
		"DB_MIGRATION_START_AFTER": "20260701_previous.sql",
	}))
	if err != nil {
		t.Fatalf("parseCommandConfig returned error: %v", err)
	}
	if cfg.SchemaPath != defaultSchemaPath || cfg.MigrationsDir != defaultMigrationsDir || cfg.Mode != defaultMode || cfg.BaselineMigrations {
		t.Fatalf("defaults not applied: %+v", cfg)
	}
	if cfg.InventoryPath != defaultInventoryPath {
		t.Fatalf("InventoryPath = %q, want %q", cfg.InventoryPath, defaultInventoryPath)
	}
	if cfg.StartAfter != "20260701_previous.sql" {
		t.Fatalf("StartAfter = %q", cfg.StartAfter)
	}

	cfg, err = parseCommandConfig([]string{"-mode", "schema", "-baseline-migrations"}, testEnv(nil))
	if err != nil {
		t.Fatalf("parseCommandConfig baseline returned error: %v", err)
	}
	if !cfg.BaselineMigrations || cfg.Mode != "schema" {
		t.Fatalf("baseline config not applied: %+v", cfg)
	}

	cfg, err = parseCommandConfig([]string{"-mode", "schema", "-require-empty-database"}, testEnv(nil))
	if err != nil || !cfg.RequireEmptyDB {
		t.Fatalf("require-empty config=%+v err=%v", cfg, err)
	}
	if _, err := parseCommandConfig([]string{"-mode", "migrate", "-require-empty-database"}, testEnv(nil)); err == nil || !strings.Contains(err.Error(), "requires -mode schema") {
		t.Fatalf("expected require-empty mode error, got %v", err)
	}

	_, err = parseCommandConfig([]string{"-baseline-migrations"}, testEnv(nil))
	if err == nil || !strings.Contains(err.Error(), "requires -mode schema") {
		t.Fatalf("expected baseline mode error, got %v", err)
	}

	_, err = parseCommandConfig([]string{"-start-at", "a.sql", "-start-after", "b.sql"}, testEnv(nil))
	if err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("expected mutually exclusive error, got %v", err)
	}
	auditCfg, err := parseCommandConfig([]string{"-mode", "audit"}, testEnv(nil))
	if err != nil || auditCfg.Mode != "audit" {
		t.Fatalf("audit config=%+v err=%v", auditCfg, err)
	}
	if _, err := parseCommandConfig([]string{"-mode", "audit", "-start-at", "a.sql"}, testEnv(nil)); err == nil {
		t.Fatal("audit mode accepted a migration execution anchor")
	}
}

func TestBuildConnStringEscapesConnectionValues(t *testing.T) {
	connString := buildConnString(dbConfig{
		Host:                  "db.example.com",
		Port:                  "5432",
		User:                  "mango user",
		Password:              "p@ss word/with:chars'",
		Name:                  "mango db",
		SSLMode:               "require",
		ConnectTimeoutSeconds: 9,
	})

	parsed, err := url.Parse(connString)
	if err != nil {
		t.Fatalf("url.Parse: %v", err)
	}
	password, ok := parsed.User.Password()
	if !ok {
		t.Fatalf("password missing from connection string")
	}
	if got, want := parsed.User.Username(), "mango user"; got != want {
		t.Fatalf("username = %q, want %q", got, want)
	}
	if password != "p@ss word/with:chars'" {
		t.Fatalf("password = %q", password)
	}
	if got, want := strings.TrimPrefix(parsed.Path, "/"), "mango db"; got != want {
		t.Fatalf("dbname path = %q, want %q", got, want)
	}
	if parsed.Query().Get("sslmode") != "require" || parsed.Query().Get("connect_timeout") != "9" {
		t.Fatalf("query params not preserved: %s", parsed.RawQuery)
	}
}

func TestListMigrationFilesFiltersAndSortsSQLFiles(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "20260702_second.sql"))
	writeTestFile(t, filepath.Join(dir, "notes.txt"))
	writeTestFile(t, filepath.Join(dir, "20260701_first.sql"))
	if err := os.Mkdir(filepath.Join(dir, "20260703_dir.sql"), 0o755); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}

	files, err := listMigrationFiles(dir)
	if err != nil {
		t.Fatalf("listMigrationFiles: %v", err)
	}
	got := migrationNames(files)
	want := []string{"20260701_first.sql", "20260702_second.sql"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("migration names = %#v, want %#v", got, want)
	}
}

func TestClassifyMigrationLedger(t *testing.T) {
	files := []migrationFile{{Name: "a.sql"}, {Name: "b.sql"}}
	audit := classifyMigrationLedger(files, map[string]bool{"a.sql": true, "orphan.sql": true})
	if !reflect.DeepEqual(audit.MissingFromLedger, []string{"b.sql"}) {
		t.Fatalf("missing=%v", audit.MissingFromLedger)
	}
	if !reflect.DeepEqual(audit.UnknownToRepo, []string{"orphan.sql"}) {
		t.Fatalf("unknown=%v", audit.UnknownToRepo)
	}
}

func TestSchemaInventoryDigestIgnoresObjectOrderAndDefaultExclusions(t *testing.T) {
	expected := []byte(`[
  {"object_kind":"column","object_identity":"public.widgets.alpha","definition":{"column":"alpha","data_type":"text","not_null":true,"ordinal_position":1}},
  {"object_kind":"column","object_identity":"public.widgets.beta","definition":{"column":"beta","data_type":"integer","not_null":false,"ordinal_position":2}},
  {"object_kind":"grant","object_identity":"relation:public.widgets:PUBLIC:SELECT","definition":{"privilege_type":"SELECT"}},
  {"object_kind":"table","object_identity":"public.schema_migrations","definition":{"name":"schema_migrations"}}
]`)
	reordered := []byte(`[
  {"definition":{"not_null":false,"data_type":"integer","column":"beta","ordinal_position":1},"object_identity":"public.widgets.beta","object_kind":"column"},
  {"definition":{"not_null":true,"column":"alpha","data_type":"text","ordinal_position":2},"object_identity":"public.widgets.alpha","object_kind":"column"}
]`)

	expectedCount, expectedDigest, err := schemaInventoryDigest(expected)
	if err != nil {
		t.Fatalf("schemaInventoryDigest expected: %v", err)
	}
	reorderedCount, reorderedDigest, err := schemaInventoryDigest(reordered)
	if err != nil {
		t.Fatalf("schemaInventoryDigest reordered: %v", err)
	}
	if expectedCount != 2 || reorderedCount != 2 {
		t.Fatalf("compared counts = %d and %d, want 2 and 2", expectedCount, reorderedCount)
	}
	if expectedDigest != reorderedDigest {
		t.Fatalf("reordered inventory digest = %s, want %s", reorderedDigest, expectedDigest)
	}
	if expectedDigest != "8e204427be93f462587cec286a2d73c0e21bece1957fdec2a6960e824185c5c2" {
		t.Fatalf("inventory digest = %s, does not match the shared Python/Go contract", expectedDigest)
	}
}

func TestSchemaInventoryDigestNormalizesFunctionLineEndings(t *testing.T) {
	crlf := []byte(`[
  {"object_kind":"function","object_identity":"public.touch_widget()","definition":{"name":"touch_widget","definition":"CREATE FUNCTION public.touch_widget()\r\n RETURNS trigger\rAS $$\r\nBEGIN\r\nEND;\r\n$$;\r\n"}}
]`)
	lf := []byte(`[
  {"object_kind":"function","object_identity":"public.touch_widget()","definition":{"name":"touch_widget","definition":"CREATE FUNCTION public.touch_widget()\n RETURNS trigger\nAS $$\nBEGIN\nEND;\n$$;\n"}}
]`)

	crlfCount, crlfDigest, err := schemaInventoryDigest(crlf)
	if err != nil {
		t.Fatalf("schemaInventoryDigest CRLF: %v", err)
	}
	lfCount, lfDigest, err := schemaInventoryDigest(lf)
	if err != nil {
		t.Fatalf("schemaInventoryDigest LF: %v", err)
	}
	if crlfCount != 1 || lfCount != 1 {
		t.Fatalf("compared counts = %d and %d, want 1 and 1", crlfCount, lfCount)
	}
	if crlfDigest != lfDigest {
		t.Fatalf("function inventory digests differ: CRLF=%s LF=%s", crlfDigest, lfDigest)
	}
}

func TestSchemaInventoryDigestRejectsMissingAndExtraColumns(t *testing.T) {
	base := []byte(`[
  {"object_kind":"column","object_identity":"public.widgets.alpha","definition":{"column":"alpha","data_type":"text"}},
  {"object_kind":"column","object_identity":"public.widgets.beta","definition":{"column":"beta","data_type":"integer"}}
]`)
	missing := []byte(`[
  {"object_kind":"column","object_identity":"public.widgets.alpha","definition":{"column":"alpha","data_type":"text"}}
]`)
	extra := []byte(`[
  {"object_kind":"column","object_identity":"public.widgets.alpha","definition":{"column":"alpha","data_type":"text"}},
  {"object_kind":"column","object_identity":"public.widgets.beta","definition":{"column":"beta","data_type":"integer"}},
  {"object_kind":"column","object_identity":"public.widgets.gamma","definition":{"column":"gamma","data_type":"boolean"}}
]`)

	baseCount, baseDigest, err := schemaInventoryDigest(base)
	if err != nil {
		t.Fatal(err)
	}
	missingCount, missingDigest, err := schemaInventoryDigest(missing)
	if err != nil {
		t.Fatal(err)
	}
	extraCount, extraDigest, err := schemaInventoryDigest(extra)
	if err != nil {
		t.Fatal(err)
	}
	if baseCount != 2 || missingCount != 1 || extraCount != 3 {
		t.Fatalf("counts = base:%d missing:%d extra:%d", baseCount, missingCount, extraCount)
	}
	if baseDigest == missingDigest || baseDigest == extraDigest {
		t.Fatalf("missing or extra column did not change digest: base=%s missing=%s extra=%s", baseDigest, missingDigest, extraDigest)
	}
}

func TestExistingApplicationSchemaObjectsAllowsOnlyFreshDatabaseDefaults(t *testing.T) {
	defaults := []schemaInventoryItem{
		{ObjectKind: "schema", ObjectIdentity: "public"},
		{ObjectKind: "extension", ObjectIdentity: "plpgsql"},
		{ObjectKind: "grant", ObjectIdentity: "schema:public:PUBLIC:USAGE"},
	}
	if got := existingApplicationSchemaObjects(defaults); len(got) != 0 {
		t.Fatalf("fresh database defaults counted as application objects: %v", got)
	}

	existing := append(defaults,
		schemaInventoryItem{ObjectKind: "table", ObjectIdentity: "public.business_records"},
		schemaInventoryItem{ObjectKind: "table", ObjectIdentity: "public.schema_migrations"},
		schemaInventoryItem{ObjectKind: "schema", ObjectIdentity: "private_app"},
	)
	want := []string{
		"schema:private_app",
		"table:public.business_records",
		"table:public.schema_migrations",
	}
	if got := existingApplicationSchemaObjects(existing); !reflect.DeepEqual(got, want) {
		t.Fatalf("existing objects = %v, want %v", got, want)
	}
}

func TestSchemaInventoryQueryDoesNotIncludePhysicalColumnOrder(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema_inventory.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(string(raw)), "ordinal_position") {
		t.Fatal("schema inventory must not include physical column order")
	}
	if !strings.Contains(string(raw), "replace(pg_get_functiondef(proc.oid), E'\\r\\n', E'\\n')") {
		t.Fatal("schema inventory must normalize function definition line endings")
	}
}

func TestRepositorySchemaFingerprintIsDeterministicAcrossLineEndings(t *testing.T) {
	root := t.TempDir()
	schemaPath := filepath.Join(root, "schema.sql")
	inventoryPath := filepath.Join(root, "schema_inventory.sql")
	migrationsDir := filepath.Join(root, "migrations")
	if err := os.Mkdir(migrationsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(schemaPath, []byte("create table widgets(id uuid);\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inventoryPath, []byte("select 'inventory';\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(migrationsDir, "20260801_widgets.sql"), []byte("alter table widgets add column name text;\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	first, err := repositorySchemaFingerprint(schemaPath, inventoryPath, migrationsDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(schemaPath, []byte("create table widgets(id uuid);\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inventoryPath, []byte("select 'inventory';\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(migrationsDir, "20260801_widgets.sql"), []byte("alter table widgets add column name text;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := repositorySchemaFingerprint(schemaPath, inventoryPath, migrationsDir)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("line-ending-only change altered fingerprint: %s != %s", first, second)
	}
	if err := os.WriteFile(schemaPath, []byte("create table widgets(id uuid, active boolean);\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	changed, err := repositorySchemaFingerprint(schemaPath, inventoryPath, migrationsDir)
	if err != nil {
		t.Fatal(err)
	}
	if changed == first {
		t.Fatal("schema content change did not alter repository fingerprint")
	}
}

func TestSelectPendingMigrationsSkipsAppliedAndHonorsAnchors(t *testing.T) {
	files := []migrationFile{
		{Name: "20260701_first.sql"},
		{Name: "20260702_second.sql"},
		{Name: "20260703_third.sql"},
	}
	applied := map[string]bool{"20260702_second.sql": true}

	pending, err := selectPendingMigrations(files, applied, "", "")
	if err != nil {
		t.Fatalf("selectPendingMigrations: %v", err)
	}
	if got, want := migrationNames(pending), []string{"20260701_first.sql", "20260703_third.sql"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pending = %#v, want %#v", got, want)
	}

	pending, err = selectPendingMigrations(files, applied, "20260702_second.sql", "")
	if err != nil {
		t.Fatalf("selectPendingMigrations start-at: %v", err)
	}
	if got, want := migrationNames(pending), []string{"20260703_third.sql"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("start-at pending = %#v, want %#v", got, want)
	}

	pending, err = selectPendingMigrations(files, applied, "", "20260701_first.sql")
	if err != nil {
		t.Fatalf("selectPendingMigrations start-after: %v", err)
	}
	if got, want := migrationNames(pending), []string{"20260703_third.sql"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("start-after pending = %#v, want %#v", got, want)
	}

	if _, err := selectPendingMigrations(files, applied, "missing.sql", ""); err == nil {
		t.Fatalf("expected missing start-at error")
	}
	if _, err := selectPendingMigrations(files, applied, "a.sql", "b.sql"); err == nil {
		t.Fatalf("expected mutually exclusive anchor error")
	}
}

func TestSQLForManagedTransactionRemovesOnlyOuterEnvelope(t *testing.T) {
	raw := `-- preflight
/*
BEGIN;
COMMIT;
*/
select 'BEGIN; COMMIT;' as quoted_control;
do $$
begin
  perform 'COMMIT;';
  /* BEGIN; */
  perform 1;
end
$$;

BEGIN;
create table widgets(id bigint);
COMMIT;

select 'complete';`

	got, err := sqlForManagedTransaction(raw)
	if err != nil {
		t.Fatalf("sqlForManagedTransaction: %v", err)
	}
	if controls, err := topLevelTransactionControls(got); err != nil || len(controls) != 0 {
		t.Fatalf("managed SQL retained top-level transaction control %+v, err=%v:\n%s", controls, err, got)
	}
	for _, want := range []string{"/*\nBEGIN;\nCOMMIT;\n*/", "'BEGIN; COMMIT;'", "do $$", "begin\n  perform 'COMMIT;'", "create table widgets", "select 'complete'"} {
		if !strings.Contains(got, want) {
			t.Fatalf("managed SQL lost %q:\n%s", want, got)
		}
	}

	plain := "create table plain_widget(id bigint);\n"
	if got, err := sqlForManagedTransaction(plain); err != nil || got != plain {
		t.Fatalf("plain SQL = %q, err=%v", got, err)
	}
}

func TestSQLForManagedTransactionRecognizesCommentSeparatedControlsAndStandardStrings(t *testing.T) {
	for name, raw := range map[string]string{
		"comment separated controls": `BEGIN/* transaction boundary */TRANSACTION;
create table comment_probe(id bigint);
COMMIT/* transaction boundary */WORK;
`,
		"standard string backslash": `BEGIN;
select '\' as one_backslash;
create table backslash_probe(id bigint);
COMMIT;
`,
	} {
		t.Run(name, func(t *testing.T) {
			got, err := sqlForManagedTransaction(raw)
			if err != nil {
				t.Fatalf("sqlForManagedTransaction: %v", err)
			}
			if controls, err := topLevelTransactionControls(got); err != nil || len(controls) != 0 {
				t.Fatalf("managed SQL retained top-level transaction control %+v, err=%v:\n%s", controls, err, got)
			}
		})
	}
}

func TestSQLForManagedTransactionRejectsUnsafeControl(t *testing.T) {
	for name, raw := range map[string]string{
		"missing commit": "begin;\nselect 1;\n",
		"commit first":   "commit;\nselect 1;\nbegin;\n",
		"rollback":       "begin;\nselect 1;\nrollback;\n",
		"abort":          "begin;\nselect 1;\nabort;\n",
		"savepoint":      "begin;\nsavepoint nested;\ncommit;\n",
		"release":        "begin;\nrelease savepoint nested;\ncommit;\n",
		"rollback to":    "begin;\nrollback to savepoint nested;\ncommit;\n",
		"prepared":       "begin;\nprepare transaction 'nested';\ncommit;\n",
		"multiple":       "begin;\nbegin;\nselect 1;\ncommit;\n",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := sqlForManagedTransaction(raw); err == nil {
				t.Fatal("expected unsafe transaction control error")
			}
		})
	}
	if got, err := sqlForManagedTransaction("begin;\nselect 1;\nend transaction;\n"); err != nil || strings.Contains(strings.ToLower(got), "end transaction") {
		t.Fatalf("END TRANSACTION envelope = %q, err=%v", got, err)
	}
}

func TestRepositoryMigrationsUseSupportedTransactionEnvelopes(t *testing.T) {
	entries, err := os.ReadDir(filepath.Join("..", "..", "db", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".sql") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := sqlForManagedTransaction(string(raw)); err != nil {
			t.Errorf("%s: %v", entry.Name(), err)
		}
	}
}

func TestValidateProcessMapLayoutMigrationAnchor(t *testing.T) {
	files := []migrationFile{
		{Name: processMapActualSizeLayoutMigration},
		{Name: "20260826_zzzz_process_map_tidy_initial_layout.sql"},
		{Name: "20260826_zzzzz_process_map_rectangular_layout.sql"},
		{Name: "20260826_zzzzzz_process_map_square_layout.sql"},
	}

	if err := validateProcessMapLayoutMigrationAnchor(files, files, map[string]bool{}); err != nil {
		t.Fatalf("full ordered run rejected: %v", err)
	}
	if err := validateProcessMapLayoutMigrationAnchor(files, files[1:], map[string]bool{}); err == nil || !strings.Contains(err.Error(), processMapActualSizeLayoutMigration) {
		t.Fatalf("unsafe anchored run error = %v", err)
	}
	if err := validateProcessMapLayoutMigrationAnchor(files, files[1:], map[string]bool{processMapActualSizeLayoutMigration: true}); err == nil || !strings.Contains(err.Error(), "supersession ledger row is missing") {
		t.Fatalf("inconsistent supersession ledger error = %v", err)
	}
	pendingAfterObsolete, err := selectPendingMigrations(files, map[string]bool{}, "", files[len(files)-1].Name)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateProcessMapLayoutMigrationAnchor(files, pendingAfterObsolete, map[string]bool{}); err == nil || !strings.Contains(err.Error(), "omits unrecorded") {
		t.Fatalf("anchor after obsolete migrations error = %v", err)
	}
	if err := validateProcessMapLayoutMigrationAnchor(files, pendingAfterObsolete, map[string]bool{processMapActualSizeLayoutMigration: true}); err != nil {
		t.Fatalf("anchor after obsolete migrations rejected a recorded correction: %v", err)
	}
	later := append(append([]migrationFile{}, files...), migrationFile{Name: "20260827_later.sql"})
	pendingAtLater, err := selectPendingMigrations(later, map[string]bool{}, later[len(later)-1].Name, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := validateProcessMapLayoutMigrationAnchor(later, pendingAtLater, map[string]bool{}); err == nil || !strings.Contains(err.Error(), "omits unrecorded") {
		t.Fatalf("start-at later migration error = %v", err)
	}
}

func TestMigrationScriptsDelegateToCanonicalRunner(t *testing.T) {
	for _, name := range []string{"apply_db_migrations.ps1", "apply_db_migrations.sh"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", name))
		if err != nil {
			t.Fatal(err)
		}
		source := strings.ToLower(string(raw))
		if !strings.Contains(source, "./cmd/miraeopus-migrate") {
			t.Errorf("%s does not invoke the canonical runner", name)
		}
		if strings.Contains(source, "schema_migrations") || strings.Contains(source, "psql") {
			t.Errorf("%s still contains a duplicate SQL/ledger pipeline", name)
		}
	}
	if _, err := os.Stat(filepath.Join("..", "..", "..", "scripts", "apply_notifications_schema.ps1")); !os.IsNotExist(err) {
		t.Fatalf("obsolete notification migration runner still exists or could not be checked: %v", err)
	}
}

func writeTestFile(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("select 1;\n"), 0o644); err != nil {
		t.Fatalf("WriteFile %s: %v", path, err)
	}
}

func migrationNames(files []migrationFile) []string {
	names := make([]string, len(files))
	for i, file := range files {
		names[i] = file.Name
	}
	return names
}
