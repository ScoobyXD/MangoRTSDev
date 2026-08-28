package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

const (
	entitiesTestCompanyID = "11111111-1111-1111-1111-111111111111"
	entitiesTestTypeID    = "22222222-2222-2222-2222-222222222222"
)

func TestMemoryEntitiesRejectInvalidOptionKeys(t *testing.T) {
	repo := NewMemoryRepo()
	entityType, err := repo.CreateEntityType(EntityTypeInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Name: "Delivery"})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"Open", "open state", "open-state", "_open", strings.Repeat("a", EntityNameMaxLength+1)} {
		config, err := json.Marshal(map[string]any{
			"options": []map[string]string{{"key": key, "label": "Open"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.CreateEntityFieldType(EntityFieldTypeInput{
			CompanyID: entityType.CompanyID, EntityTypeID: entityType.EntityTypeID,
			Name: "Invalid option", FieldType: EntityFieldTypeChoice, Config: config, ConfigSet: true,
		}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("option key %q error = %v, want ErrInvalid", key, err)
		}
	}
}

func TestMemoryEntitiesResolveAndSnapshotInheritedFieldTypes(t *testing.T) {
	repo := NewMemoryRepo()
	if _, err := repo.CreateEntityType(EntityTypeInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Name: "Delivery"}); err != nil {
		t.Fatalf("CreateEntityType: %v", err)
	}
	parent, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: entitiesTestCompanyID, EntityFolderID: "33333333-3333-3333-3333-333333333333", EntityTypeID: entitiesTestTypeID, Name: "Imports"})
	if err != nil {
		t.Fatalf("CreateEntityFolder parent: %v", err)
	}
	child, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: entitiesTestCompanyID, EntityFolderID: "44444444-4444-4444-4444-444444444444", EntityTypeID: entitiesTestTypeID, ParentEntityFolderID: &parent.EntityFolderID, Name: "Thailand"})
	if err != nil {
		t.Fatalf("CreateEntityFolder child: %v", err)
	}
	rootStatus, err := repo.CreateEntityFieldType(EntityFieldTypeInput{CompanyID: entitiesTestCompanyID, EntityFieldTypeID: "50000000-0000-0000-0000-000000000001", EntityTypeID: entitiesTestTypeID, Name: "Status", FieldType: EntityFieldTypeText, Position: 0, PositionSet: true})
	if err != nil {
		t.Fatalf("CreateEntityFieldType root status: %v", err)
	}
	createEntityFieldTypeForTest(t, repo, EntityFieldTypeInput{CompanyID: entitiesTestCompanyID, EntityFieldTypeID: "50000000-0000-0000-0000-000000000002", EntityTypeID: entitiesTestTypeID, Name: "Root only", FieldType: EntityFieldTypeBoolean, Position: 1, PositionSet: true})
	createEntityFieldTypeForTest(t, repo, EntityFieldTypeInput{CompanyID: entitiesTestCompanyID, EntityFieldTypeID: "50000000-0000-0000-0000-000000000003", EntityTypeID: entitiesTestTypeID, EntityFolderID: &parent.EntityFolderID, Name: "status", FieldType: EntityFieldTypeNumber, Position: 0, PositionSet: true})
	parentOnly := createEntityFieldTypeForTest(t, repo, EntityFieldTypeInput{CompanyID: entitiesTestCompanyID, EntityFieldTypeID: "50000000-0000-0000-0000-000000000004", EntityTypeID: entitiesTestTypeID, EntityFolderID: &parent.EntityFolderID, Name: "Parent only", FieldType: EntityFieldTypeDate, Position: 1, PositionSet: true})
	createEntityFieldTypeForTest(t, repo, EntityFieldTypeInput{CompanyID: entitiesTestCompanyID, EntityFieldTypeID: "50000000-0000-0000-0000-000000000005", EntityTypeID: entitiesTestTypeID, EntityFolderID: &child.EntityFolderID, Name: "ROOT ONLY", FieldType: EntityFieldTypeDate, Position: 0, PositionSet: true})
	createEntityFieldTypeForTest(t, repo, EntityFieldTypeInput{CompanyID: entitiesTestCompanyID, EntityFieldTypeID: "50000000-0000-0000-0000-000000000006", EntityTypeID: entitiesTestTypeID, EntityFolderID: &child.EntityFolderID, Name: "Child only", FieldType: EntityFieldTypeBoolean, Position: 1, PositionSet: true})

	entity, err := repo.CreateEntity(EntityInput{CompanyID: entitiesTestCompanyID, EntityID: "60000000-0000-0000-0000-000000000001", EntityTypeID: entitiesTestTypeID, EntityFolderID: &child.EntityFolderID, Name: "Thailand shipment"})
	if err != nil {
		t.Fatalf("CreateEntity: %v", err)
	}
	want := []struct{ name, fieldType string }{{"status", "number"}, {"ROOT ONLY", "date"}, {"Parent only", "date"}, {"Child only", "boolean"}}
	if len(entity.EntityFields) != len(want) {
		t.Fatalf("entity fields = %+v, want %d resolved fields", entity.EntityFields, len(want))
	}
	for index, expected := range want {
		field := entity.EntityFields[index]
		if field.Name != expected.name || field.FieldType != expected.fieldType || field.Position != index {
			t.Fatalf("entity field %d = %+v, want name=%q type=%q position=%d", index, field, expected.name, expected.fieldType, index)
		}
	}

	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{CompanyID: entitiesTestCompanyID, EntityFieldTypeID: rootStatus.EntityFieldTypeID, FieldType: EntityFieldTypeBoolean, FieldTypeSet: true}); err != nil {
		t.Fatalf("UpdateEntityFieldType: %v", err)
	}
	if err := repo.DeleteEntityFieldType(entitiesTestCompanyID, parentOnly.EntityFieldTypeID); err != nil {
		t.Fatalf("DeleteEntityFieldType: %v", err)
	}
	if _, err := repo.UpdateEntity(EntityInput{CompanyID: entitiesTestCompanyID, EntityID: entity.EntityID, EntityFolderID: nil, EntityFolderSet: true}); err != nil {
		t.Fatalf("move entity to root: %v", err)
	}
	after, err := repo.GetEntity(entitiesTestCompanyID, entity.EntityID)
	if err != nil {
		t.Fatalf("GetEntity: %v", err)
	}
	for index, expected := range want {
		if after.EntityFields[index].Name != expected.name || after.EntityFields[index].FieldType != expected.fieldType {
			t.Fatalf("existing field snapshot changed after template edits/move: %+v", after.EntityFields)
		}
	}
}

func TestMemoryEntitiesFieldValuesUniquenessCyclesAndDeleteRules(t *testing.T) {
	repo := NewMemoryRepo()
	if _, err := repo.CreateEntityType(EntityTypeInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Name: "Action item"}); err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Name: "Parent"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, ParentEntityFolderID: &parent.EntityFolderID, Name: "Child"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateEntityFolder(EntityFolderInput{CompanyID: entitiesTestCompanyID, EntityFolderID: parent.EntityFolderID, ParentEntityFolderID: &child.EntityFolderID, ParentFolderSet: true}); !errors.Is(err, ErrConflict) {
		t.Fatalf("cycle update error = %v, want ErrConflict", err)
	}
	entity, err := repo.CreateEntity(EntityInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, EntityFolderID: &child.EntityFolderID, Name: "Call supplier"})
	if err != nil {
		t.Fatal(err)
	}
	field, err := repo.CreateEntityField(EntityFieldInput{CompanyID: entitiesTestCompanyID, EntityID: entity.EntityID, Name: "Due date", FieldType: EntityFieldTypeDate, Value: json.RawMessage(`"2026-08-28"`), ValueSet: true})
	if err != nil {
		t.Fatalf("CreateEntityField: %v", err)
	}
	if _, err := repo.CreateEntityField(EntityFieldInput{CompanyID: entitiesTestCompanyID, EntityID: entity.EntityID, Name: " due DATE ", FieldType: EntityFieldTypeText}); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("duplicate field error = %v, want ErrAlreadyExists", err)
	}
	if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: entitiesTestCompanyID, EntityID: entity.EntityID, EntityFieldID: field.EntityFieldID, FieldType: EntityFieldTypeBoolean, FieldTypeSet: true, Value: json.RawMessage(`true`), ValueSet: true}); err != nil {
		t.Fatalf("retype field: %v", err)
	}
	detail, _ := repo.GetEntity(entitiesTestCompanyID, entity.EntityID)
	if detail.EntityFields[0].FieldType != EntityFieldTypeBoolean || detail.EntityFields[0].Value != nil {
		t.Fatalf("retyped field = %+v, want boolean with cleared value", detail.EntityFields[0])
	}
	if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: entitiesTestCompanyID, EntityID: entity.EntityID, EntityFieldID: field.EntityFieldID, FieldType: EntityFieldTypeDate, FieldTypeSet: true}); err != nil {
		t.Fatal(err)
	}
	for _, invalidDate := range []json.RawMessage{json.RawMessage(`"2026-02-30"`), json.RawMessage(`"08/28/2026"`), json.RawMessage(`"0000-01-01"`)} {
		if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: entitiesTestCompanyID, EntityID: entity.EntityID, EntityFieldID: field.EntityFieldID, Value: invalidDate, ValueSet: true}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid date %s error = %v, want ErrInvalid", invalidDate, err)
		}
	}
	if err := repo.DeleteEntityFolder(entitiesTestCompanyID, parent.EntityFolderID); !errors.Is(err, ErrConflict) {
		t.Fatalf("delete parent error = %v, want ErrConflict", err)
	}
	if err := repo.DeleteEntityFolder(entitiesTestCompanyID, child.EntityFolderID); !errors.Is(err, ErrConflict) {
		t.Fatalf("delete occupied child error = %v, want ErrConflict", err)
	}
	if err := repo.DeleteEntityType(entitiesTestCompanyID, entitiesTestTypeID); !errors.Is(err, ErrConflict) {
		t.Fatalf("delete occupied type error = %v, want ErrConflict", err)
	}
	if err := repo.DeleteEntity(entitiesTestCompanyID, entity.EntityID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteEntityFolder(entitiesTestCompanyID, child.EntityFolderID); err != nil {
		t.Fatalf("delete empty child: %v", err)
	}
	if err := repo.DeleteEntityFolder(entitiesTestCompanyID, parent.EntityFolderID); err != nil {
		t.Fatalf("delete empty parent: %v", err)
	}
	if err := repo.DeleteEntityType(entitiesTestCompanyID, entitiesTestTypeID); err != nil {
		t.Fatalf("delete empty type: %v", err)
	}
}

func TestMemoryEntitiesStableBoundedPaging(t *testing.T) {
	repo := NewMemoryRepo()
	if _, err := repo.CreateEntityType(EntityTypeInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Name: "Part"}); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 55; index++ {
		if _, err := repo.CreateEntity(EntityInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Name: "Part", Position: index, PositionSet: true}); err != nil {
			t.Fatalf("CreateEntity %d: %v", index, err)
		}
	}
	first, err := repo.ListEntities(context.Background(), EntityListQuery{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Limit: 50})
	if err != nil || len(first) != 50 {
		t.Fatalf("first page len=%d err=%v, want 50", len(first), err)
	}
	second, err := repo.ListEntities(context.Background(), EntityListQuery{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Limit: 50, Offset: 50})
	if err != nil || len(second) != 5 {
		t.Fatalf("second page len=%d err=%v, want 5", len(second), err)
	}
	if first[49].Position != 49 || second[0].Position != 50 {
		t.Fatalf("paging boundary = %d/%d, want 49/50", first[49].Position, second[0].Position)
	}
	allForType, err := repo.ListEntities(context.Background(), EntityListQuery{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, AllForType: true})
	if err != nil || len(allForType) != 55 {
		t.Fatalf("exact Entity Type manager list len=%d err=%v, want 55 in one request", len(allForType), err)
	}
}

func TestEntitiesRejectMalformedOptionalAndFilterIDs(t *testing.T) {
	blank := "  "
	if _, err := normalizeOptionalEntityID(&blank); !errors.Is(err, ErrInvalid) {
		t.Fatalf("blank optional Entity ID error = %v, want ErrInvalid", err)
	}
	repo := NewMemoryRepo()
	if _, err := repo.ListEntities(context.Background(), EntityListQuery{
		CompanyID:    entitiesTestCompanyID,
		EntityTypeID: "not-a-uuid",
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid Entity Type filter error = %v, want ErrInvalid", err)
	}
	root := ""
	invalidManagerQueries := []EntityListQuery{
		{CompanyID: entitiesTestCompanyID, AllForType: true},
		{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Query: "delivery", AllForType: true},
		{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, EntityFolderID: &root, AllForType: true},
		{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Limit: 1, AllForType: true},
		{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Offset: 1, AllForType: true},
	}
	for index, query := range invalidManagerQueries {
		if _, err := repo.ListEntities(context.Background(), query); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid exact Entity Type manager query %d error = %v, want ErrInvalid", index, err)
		}
	}
}

func TestMemoryEntitiesListHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewMemoryRepo().ListEntities(ctx, EntityListQuery{CompanyID: entitiesTestCompanyID}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled Entity list error = %v, want context.Canceled", err)
	}
}

func TestMemoryEntitiesRejectCorruptFolderCycleWithoutPartialEntity(t *testing.T) {
	repo := NewMemoryRepo()
	if _, err := repo.CreateEntityType(EntityTypeInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Name: "Delivery"}); err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Name: "Parent"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, ParentEntityFolderID: &parent.EntityFolderID, Name: "Child"})
	if err != nil {
		t.Fatal(err)
	}
	repo.mu.Lock()
	corruptParent := repo.entityFolders[key(entitiesTestCompanyID, parent.EntityFolderID)]
	corruptParent.ParentEntityFolderID = &child.EntityFolderID
	repo.entityFolders[key(entitiesTestCompanyID, parent.EntityFolderID)] = corruptParent
	repo.mu.Unlock()

	entityID := "60000000-0000-0000-0000-000000000099"
	if _, err := repo.CreateEntity(EntityInput{CompanyID: entitiesTestCompanyID, EntityID: entityID, EntityTypeID: entitiesTestTypeID, EntityFolderID: &child.EntityFolderID, Name: "Must fail"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("create under cyclic ancestry error = %v, want ErrConflict", err)
	}
	if _, exists := repo.entities[key(entitiesTestCompanyID, entityID)]; exists {
		t.Fatal("failed cyclic Entity creation left a partial Entity behind")
	}
}

func TestEntitiesSchemaReplacesLegacyEntityFields(t *testing.T) {
	schema, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260827_entities.sql"))
	if err != nil {
		t.Fatal(err)
	}
	normalizedSchema := strings.ToLower(string(schema))
	for _, table := range []string{"entity_types", "entity_folders", "entity_field_types", "entities", "entity_fields"} {
		if !strings.Contains(normalizedSchema, "create table public."+table) {
			t.Fatalf("canonical schema missing %s", table)
		}
	}
	if strings.Contains(normalizedSchema, "create table public.entity_field_assignments") {
		t.Fatal("canonical schema still contains the legacy Entity Field Assignments table")
	}
	for _, fragment := range []string{"entity_field_id uuid not null", "entity_id uuid not null", "value_jsonb jsonb", "jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text"} {
		if !strings.Contains(normalizedSchema, fragment) {
			t.Fatalf("canonical Entities schema missing %q", fragment)
		}
	}
	normalizedMigration := strings.ToLower(string(migration))
	for _, fragment := range []string{"drop table entity_field_assignments", "drop table entity_fields", "idx_entity_fields_entity_name_unique", `"annotations":[]`, "jsonb_typeof(body_json->'annotations') = 'array'"} {
		if !strings.Contains(normalizedMigration, fragment) {
			t.Fatalf("entities migration missing %q", fragment)
		}
	}
	if strings.Contains(normalizedMigration, "drop table if exists entity_field") {
		t.Fatal("Entities cutover must fail when the required legacy tables are missing")
	}
	if !strings.Contains(normalizedMigration, "on entities using gin (lower(name) gin_trgm_ops)") {
		t.Fatal("Entities migration missing the pg_trgm index used by substring name search")
	}
	if !strings.Contains(normalizedSchema, "create index idx_entities_name_trgm on public.entities using gin (lower((name)::text) public.gin_trgm_ops)") {
		t.Fatal("canonical schema missing the pg_trgm index used by substring Entity name search")
	}
	if strings.Contains(normalizedMigration, "idx_entities_company_name_search") || strings.Contains(normalizedSchema, "idx_entities_company_name_search") {
		t.Fatal("Entities schema still contains the obsolete B-tree substring search index")
	}
}

func TestPostgresEntitiesUseSetBasedFolderAncestryAndLiveTemplateLinks(t *testing.T) {
	raw, err := os.ReadFile("postgres_entities.go")
	if err != nil {
		t.Fatal(err)
	}
	source := strings.ToLower(string(raw))
	for _, fragment := range []string{
		"with recursive ancestry as",
		"parent.entity_folder_id=any(ancestry.path)",
		"entity_folder_id::text=any($3::text[])",
		"entity_field_type_id",
		"coalesce(field_type.config_jsonb, '{}'::jsonb)",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("PostgreSQL Entities store missing set-based contract %q", fragment)
		}
	}
}

func TestCanonicalSchemaKeepsPostgresRecordLoopVariables(t *testing.T) {
	schema, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	normalizedSchema := strings.ToLower(string(schema))
	if strings.Count(normalizedSchema, "v_resource record;") < 2 {
		t.Fatal("canonical schema must declare both RACI resource loop variables with PostgreSQL's record pseudo-type")
	}
	if !strings.Contains(normalizedSchema, "v_gate record;") {
		t.Fatal("canonical schema must declare the RACI gate loop variable with PostgreSQL's record pseudo-type")
	}
	for _, invalid := range []string{"v_resource entity;", "v_gate entity;"} {
		if strings.Contains(normalizedSchema, invalid) {
			t.Fatalf("canonical schema contains invalid PL/pgSQL declaration %q", invalid)
		}
	}
}

func TestEntitySchemaReadinessUsesExactUnorderedColumnSets(t *testing.T) {
	expected := map[string][]string{
		"entity_types":       {"company_id", "entity_type_id", "name", "system_key", "created_timestamp", "updated_timestamp"},
		"entity_folders":     {"company_id", "entity_folder_id", "entity_type_id", "parent_entity_folder_id", "name", "position", "created_timestamp", "updated_timestamp"},
		"entity_field_types": {"company_id", "entity_field_type_id", "entity_type_id", "entity_folder_id", "name", "field_type", "system_key", "config_jsonb", "position", "created_timestamp", "updated_timestamp"},
		"entities":           {"company_id", "entity_id", "entity_type_id", "entity_folder_id", "name", "position", "body_json", "revision", "created_by_user_id", "created_timestamp", "updated_timestamp"},
		"entity_fields":      {"company_id", "entity_field_id", "entity_id", "entity_field_type_id", "name", "field_type", "value_jsonb", "position", "created_timestamp", "updated_timestamp"},
	}
	if len(exactEntityTableColumnContracts) != len(expected) {
		t.Fatalf("Entity exact column contract count = %d, want %d", len(exactEntityTableColumnContracts), len(expected))
	}
	for _, contract := range exactEntityTableColumnContracts {
		want, exists := expected[contract.table]
		if !exists {
			t.Fatalf("unexpected Entity exact column contract for %q", contract.table)
		}
		assertExactUnorderedColumns(t, contract.table, contract.columns, want)

		reversed := append([]string(nil), want...)
		for left, right := 0, len(reversed)-1; left < right; left, right = left+1, right-1 {
			reversed[left], reversed[right] = reversed[right], reversed[left]
		}
		if !matchesExactUnorderedColumns(reversed, contract.columns) {
			t.Fatalf("%s rejected the same exact columns in a different physical order", contract.table)
		}
		if matchesExactUnorderedColumns(want[:len(want)-1], contract.columns) {
			t.Fatalf("%s accepted a missing column", contract.table)
		}
		if matchesExactUnorderedColumns(append(append([]string(nil), want...), "unexpected_legacy_column"), contract.columns) {
			t.Fatalf("%s accepted an extra column", contract.table)
		}
	}

	hybridEntityFields := append(append([]string(nil), expected["entity_fields"]...), "field_id", "color")
	if matchesExactUnorderedColumns(hybridEntityFields, expected["entity_fields"]) {
		t.Fatal("Entity schema readiness accepted legacy Entity Field columns beside the new Entity Fields contract")
	}
}

func TestActionItemSchemaReadinessRequiresEntityRelationshipAndHuddleWorkspaceTables(t *testing.T) {
	required := map[string]bool{
		"entity_relationships":      false,
		"huddle_node_textboxes":     false,
		"huddle_node_textbox_chats": false,
	}
	for _, table := range requiredApplicationTables {
		if _, ok := required[table]; ok {
			required[table] = true
		}
	}
	for table, found := range required {
		if !found {
			t.Fatalf("application schema readiness does not require %s", table)
		}
	}
}

func TestEditorJSONAcceptsEntityEntityLink(t *testing.T) {
	raw := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mangoEntityLink","attrs":{"entityType":"entity","entityId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","label":"Thailand shipment"}}]}]}}`)
	if _, err := ValidateMangoTiptapJSON(raw); err != nil {
		t.Fatalf("ValidateMangoTiptapJSON entity link: %v", err)
	}
	if entityType, ok := NormalizeEntityType("entity"); ok || entityType != "" {
		t.Fatalf("NormalizeEntityType(entity) = %q, %v; entities must not enter relationship paths", entityType, ok)
	}
}

func TestEntityBodyUsesFullEditorEnvelope(t *testing.T) {
	raw := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`)
	normalized, err := normalizeEntityInput(EntityInput{
		CompanyID: entitiesTestCompanyID, EntityTypeID: entitiesTestTypeID, Name: "Delivery", BodyJSON: raw, BodySet: true,
	}, false)
	if err != nil {
		t.Fatalf("normalize Entity body: %v", err)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(normalized.BodyJSON, &envelope); err != nil {
		t.Fatalf("decode normalized Entity body: %v", err)
	}
	if string(envelope["annotations"]) != "[]" {
		t.Fatalf("normalized Entity body annotations = %s, want []", envelope["annotations"])
	}
}

func createEntityFieldTypeForTest(t *testing.T, repo *MemoryRepo, input EntityFieldTypeInput) domain.EntityFieldType {
	t.Helper()
	item, err := repo.CreateEntityFieldType(input)
	if err != nil {
		t.Fatalf("CreateEntityFieldType(%q): %v", input.Name, err)
	}
	return item
}
