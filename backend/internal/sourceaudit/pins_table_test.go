package sourceaudit

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPinsUseCanonicalTableName(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", ".."))

	schema := readRepoFile(t, repoRoot, "backend/db/schema.sql")
	assertContains(t, schema, "create table if not exists pins (", "schema must create pins table")
	assertNotContains(t, schema, "user_pins", "schema must not create or reference user_pins")

	store := readRepoFile(t, repoRoot, "backend/internal/store/postgres_user_pins.go")
	assertContains(t, store, "from pins", "Postgres pin list reads must use pins table")
	assertContains(t, store, "insert into pins", "Postgres pin create must use pins table")
	assertContains(t, store, "delete from pins", "Postgres pin delete must use pins table")
	assertContains(t, store, "update pins", "Postgres pin reorder must use pins table")
	assertNotContains(t, store, "user_pins", "Postgres pin store must not reference user_pins")

	migration := readRepoFile(t, repoRoot, "backend/db/migrations/20260624_pins.sql")
	assertContains(t, migration, "drop table if exists user_pins;", "migration must remove stale user_pins table")
	assertContains(t, migration, "drop table if exists pins;", "migration must remove failed pins table shape")
	assertContains(t, migration, "create table pins (", "migration must recreate canonical pins table")
	if count := strings.Count(migration, "user_pins"); count != 1 {
		t.Fatalf("migration should mention user_pins only for the drop statement, got %d references", count)
	}
}

func readRepoFile(t *testing.T, repoRoot, rel string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(raw)
}

func assertContains(t *testing.T, text, needle, message string) {
	t.Helper()
	if !strings.Contains(text, needle) {
		t.Fatalf("%s; missing %q", message, needle)
	}
}

func assertNotContains(t *testing.T, text, needle, message string) {
	t.Helper()
	if strings.Contains(text, needle) {
		t.Fatalf("%s; found %q", message, needle)
	}
}
