package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMemoryEntityFieldsProjectAssignments(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "74111111-1111-4111-8111-111111111111"
	projectID := "74222222-2222-4222-8222-222222222222"
	fieldID := "74333333-3333-4333-8333-333333333333"
	secondFieldID := "74444444-4444-4444-8444-444444444444"
	repo.EnsureCompany(companyID, "Entity Fields Co")

	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID,
		ProjectID: projectID,
		Name:      "Field-aware project",
		Status:    ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	field, err := repo.CreateEntityField(EntityFieldInput{
		CompanyID: companyID,
		FieldID:   fieldID,
		Name:      "FX",
	})
	if err != nil {
		t.Fatalf("CreateEntityField: %v", err)
	}
	if field.Color != EntityFieldDefaultColor || field.Position != 0 {
		t.Fatalf("created field = %+v, want default color and first position", field)
	}
	if _, err := repo.CreateEntityField(EntityFieldInput{
		CompanyID: companyID,
		FieldID:   "74555555-5555-4555-8555-555555555555",
		Name:      " fx ",
	}); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("duplicate CreateEntityField error = %v, want ErrAlreadyExists", err)
	}
	secondField, err := repo.CreateEntityField(EntityFieldInput{
		CompanyID: companyID,
		FieldID:   secondFieldID,
		Name:      "AX",
		Color:     "#0ea5e9",
	})
	if err != nil {
		t.Fatalf("CreateEntityField second: %v", err)
	}
	if secondField.Position != 1 {
		t.Fatalf("second field position = %d, want 1", secondField.Position)
	}

	assigned, err := repo.SetEntityFieldAssignments(EntityFieldAssignmentInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeProject,
		ResourceID:   projectResult.Project.ProjectID,
		FieldIDs:     []string{secondFieldID, fieldID, fieldID},
	})
	if err != nil {
		t.Fatalf("SetEntityFieldAssignments: %v", err)
	}
	if len(assigned) != 2 || assigned[0].FieldID != fieldID || assigned[1].FieldID != secondFieldID {
		t.Fatalf("assigned fields = %+v, want position order FX, AX", assigned)
	}

	project, err := repo.GetProject(companyID, projectID)
	if err != nil {
		t.Fatalf("GetProject: %v", err)
	}
	if len(project.Fields) != 2 || project.Fields[0].Name != "FX" || project.Fields[1].Name != "AX" {
		t.Fatalf("project fields = %+v, want FX and AX", project.Fields)
	}
	fields, err := repo.ListEntityFields(companyID)
	if err != nil {
		t.Fatalf("ListEntityFields: %v", err)
	}
	if len(fields) != 2 || fields[0].AssignmentCount != 1 || fields[1].AssignmentCount != 1 {
		t.Fatalf("listed fields = %+v, want one assignment each", fields)
	}

	if err := repo.DeleteEntityField(companyID, fieldID, "actor"); err != nil {
		t.Fatalf("DeleteEntityField: %v", err)
	}
	project, err = repo.GetProject(companyID, projectID)
	if err != nil {
		t.Fatalf("GetProject after delete: %v", err)
	}
	if len(project.Fields) != 1 || project.Fields[0].FieldID != secondFieldID {
		t.Fatalf("project fields after delete = %+v, want only AX", project.Fields)
	}
}

func TestNormalizeEntityFieldInputRejectsInvalidValues(t *testing.T) {
	companyID := "74666666-6666-4666-8666-666666666666"
	for _, input := range []EntityFieldInput{
		{CompanyID: companyID, Name: ""},
		{CompanyID: companyID, Name: strings.Repeat("x", EntityFieldMaxNameLen+1)},
		{CompanyID: companyID, Name: "FX", Color: "indigo"},
	} {
		if _, err := NormalizeEntityFieldInput(input, false); !errors.Is(err, ErrInvalid) {
			t.Fatalf("NormalizeEntityFieldInput(%+v) error = %v, want ErrInvalid", input, err)
		}
	}
}

func TestEntityFieldsSchemaAndMigrationMatch(t *testing.T) {
	schemaRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	migrationRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260721_entity_fields.sql"))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	for name, sql := range map[string]string{"schema": string(schemaRaw), "migration": string(migrationRaw)} {
		for _, marker := range []string{
			"create table if not exists entity_fields",
			"idx_entity_fields_company_name_unique",
			"create table if not exists entity_field_assignments",
			"entity_field_assignments_target_chk",
			"resource_id uuid generated always as",
			"foreign key (company_id, field_id) references entity_fields",
			"foreign key (company_id, project_id) references projects",
			"foreign key (company_id, node_id) references nodes",
			"foreign key (company_id, logic_gate_id) references logic_gates",
		} {
			if !strings.Contains(sql, marker) {
				t.Fatalf("%s missing %q", name, marker)
			}
		}
	}
}
