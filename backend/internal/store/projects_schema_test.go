package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectSchemaUsesAssignmentTables(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	schema := normalizeCanonicalSchemaContract(string(raw))
	projectsBlock := sqlBlockAfter(t, schema, "create table if not exists projects (")
	if strings.Contains(projectsBlock, "account_id") {
		t.Fatalf("projects table still contains account_id:\n%s", projectsBlock)
	}
	if strings.Contains(projectsBlock, "team_id") {
		t.Fatalf("projects table still contains team_id:\n%s", projectsBlock)
	}
	for _, want := range []string{
		"create table if not exists project_account_assignments",
		"primary key (company_id, project_id, account_id)",
		"create table if not exists project_team_assignments",
		"primary key (company_id, project_id, team_id)",
	} {
		if !strings.Contains(schema, want) {
			t.Fatalf("schema missing %q", want)
		}
	}
}

func TestProjectScalarDropMigrationBackfillsBeforeDrop(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260612_z_drop_project_scalar_assignments.sql"))
	if err != nil {
		t.Fatalf("read project scalar drop migration: %v", err)
	}
	migration := string(raw)
	requiredOrder := []string{
		"lock table projects in access exclusive mode",
		"insert into project_account_assignments",
		"insert into project_team_assignments",
		"drop index if exists idx_projects_account",
		"drop column if exists account_id",
		"drop column if exists team_id",
	}
	last := -1
	for _, marker := range requiredOrder {
		index := strings.Index(migration, marker)
		if index == -1 {
			t.Fatalf("migration missing %q", marker)
		}
		if index <= last {
			t.Fatalf("migration marker %q appears out of order", marker)
		}
		last = index
	}
}

func sqlBlockAfter(t *testing.T, sql string, marker string) string {
	t.Helper()
	start := strings.Index(sql, marker)
	if start == -1 {
		t.Fatalf("SQL missing marker %q", marker)
	}
	rest := sql[start:]
	end := strings.Index(rest, "\n);")
	if end == -1 {
		t.Fatalf("SQL block after %q is not terminated", marker)
	}
	return rest[:end]
}
