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
	if _, err := parseDBConfig(testEnv(nil)); err == nil {
		t.Fatalf("expected missing env error")
	} else if !strings.Contains(err.Error(), "DB_HOST") || !strings.Contains(err.Error(), "DB_PASSWORD") {
		t.Fatalf("missing env error did not name required vars: %v", err)
	}

	cfg, err := parseDBConfig(testEnv(map[string]string{
		"DB_HOST":                    "host=db.example.com",
		"DB_PASSWORD":                "pa ss",
		"DB_CONNECT_TIMEOUT_SECONDS": "not-an-int",
	}))
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

func TestParseCommandConfigDefaultsAndAnchors(t *testing.T) {
	cfg, err := parseCommandConfig(nil, testEnv(map[string]string{
		"DB_MIGRATION_START_AFTER": "20260701_previous.sql",
	}))
	if err != nil {
		t.Fatalf("parseCommandConfig returned error: %v", err)
	}
	if cfg.SchemaPath != defaultSchemaPath || cfg.MigrationsDir != defaultMigrationsDir || cfg.Mode != defaultMode {
		t.Fatalf("defaults not applied: %+v", cfg)
	}
	if cfg.StartAfter != "20260701_previous.sql" {
		t.Fatalf("StartAfter = %q", cfg.StartAfter)
	}

	_, err = parseCommandConfig([]string{"-start-at", "a.sql", "-start-after", "b.sql"}, testEnv(nil))
	if err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("expected mutually exclusive error, got %v", err)
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
