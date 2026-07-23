package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectRelationshipSchemaAllowsLogicGateInManyProjects(t *testing.T) {
	paths := map[string]string{
		"schema":    filepath.Join("..", "..", "db", "schema.sql"),
		"migration": filepath.Join("..", "..", "db", "migrations", "20260723_project_logic_gates_many_projects.sql"),
	}
	for name, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		sql := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
		for _, required := range []string{
			"create unique index if not exists idx_project_relationships_one_project_per_node",
			"on project_relationships(company_id, resource_id)",
			"where resource_type='node'",
		} {
			if !strings.Contains(sql, required) {
				t.Fatalf("%s missing node-only project uniqueness rule %q", name, required)
			}
		}
		if name == "schema" && strings.Contains(sql, "idx_project_relationships_one_project_per_resource") {
			t.Fatal("canonical schema still limits Logic Gates to one Project")
		}
		if name == "migration" && !strings.Contains(sql, "drop index if exists idx_project_relationships_one_project_per_resource") {
			t.Fatal("forward migration does not remove the old all-resource uniqueness rule")
		}
	}

	postgresRaw, err := os.ReadFile("postgres_projects.go")
	if err != nil {
		t.Fatalf("read postgres_projects.go: %v", err)
	}
	postgres := strings.ToLower(strings.Join(strings.Fields(string(postgresRaw)), " "))
	for _, required := range []string{
		"on conflict (company_id, resource_id) where resource_type='node'",
		"on conflict (company_id, project_id, resource_type, resource_id)",
	} {
		if !strings.Contains(postgres, required) {
			t.Fatalf("PostgreSQL relationship upsert missing %q", required)
		}
	}
}
