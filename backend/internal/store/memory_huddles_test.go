package store

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMemoryLogicGateConversionReturnsEveryBlocker(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	gateID := "22222222-2222-4222-8222-222222222222"
	now := time.Now().UTC()
	repo.logicGates[key(companyID, gateID)] = domain.LogicGate{CompanyID: companyID, LogicGateID: gateID, Header: "Daily Huddle", CreatedTimestamp: now}
	repo.kpis[key(companyID, "33333333-3333-4333-8333-333333333333")] = domain.KPI{CompanyID: companyID, KPIID: "33333333-3333-4333-8333-333333333333", LogicGateID: gateID, Name: "Lead time"}
	repo.nodeLogicGateAssignments[key(companyID, "44444444-4444-4444-8444-444444444444")] = domain.NodeLogicGateAssignment{CompanyID: companyID, AssignmentID: "44444444-4444-4444-8444-444444444444", LogicGateID: gateID}
	ref := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gateID, DocumentID: gateID}
	repo.editorJSONDocuments[editorJSONMemoryKey(ref)] = memoryEditorJSONDocument{Ref: ref, JSONDocument: json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"work"}]}]}}`)}

	_, err := repo.ConvertLogicGateToHuddle(companyID, gateID, "")
	var blocked *LogicGateConversionBlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("ConvertLogicGateToHuddle error = %v, want blocker error", err)
	}
	if !blocked.Blockers.Editor || !blocked.Blockers.KanbanWork || !blocked.Blockers.KPIs {
		t.Fatalf("blockers = %+v, want all blockers", blocked.Blockers)
	}
	if _, ok := repo.logicGates[key(companyID, gateID)]; !ok {
		t.Fatal("blocked conversion removed the Logic Gate")
	}
}

func TestMemoryHuddleLifecycleKeepsTypedIdentityAndRecycleRestore(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	gateID := "22222222-2222-4222-8222-222222222222"
	userID := "55555555-5555-4555-8555-555555555555"
	repo.logicGates[key(companyID, gateID)] = domain.LogicGate{CompanyID: companyID, LogicGateID: gateID, Header: "Daily Huddle", CreatedTimestamp: time.Now().UTC()}
	repo.ensureV2PolicySettingsLocked(companyID, EntityTypeLogicGate, gateID)
	repo.replaceMemoryRACIEdgesLocked(companyID, EntityTypeLogicGate, gateID, []domain.ResourceRACIAssignment{{Role: domain.RACIRoleResponsible, PrincipalType: "user", PrincipalID: userID}})
	repo.replaceMemoryPermissionEdgesLocked(companyID, EntityTypeLogicGate, gateID, []domain.EntityPermission{{SubjectType: EntityPermissionSubjectUser, SubjectID: userID, AccessLevel: EntityPermissionEdit}})
	permissionSetting := repo.permissionV2Settings[resourcePolicyKey(companyID, EntityTypeLogicGate, gateID)]
	permissionSetting.DefaultAccess = EntityPermissionNoAccess
	repo.permissionV2Settings[resourcePolicyKey(companyID, EntityTypeLogicGate, gateID)] = permissionSetting

	huddle, err := repo.ConvertLogicGateToHuddle(companyID, gateID, userID)
	if err != nil {
		t.Fatal(err)
	}
	if huddle.HuddleLogicGateID != gateID {
		t.Fatalf("huddle ID = %s, want %s", huddle.HuddleLogicGateID, gateID)
	}
	raciPolicy, err := repo.GetResourceRACIPolicy(companyID, EntityTypeHuddleLogicGate, gateID)
	if err != nil || raciPolicy.AssignmentMode != PolicyModeCustomized || len(raciPolicy.RACIAssignments) != 1 || raciPolicy.RACIAssignments[0].PrincipalID != userID {
		t.Fatalf("converted RACI policy = %+v, err=%v", raciPolicy, err)
	}
	permissionPolicy, err := repo.GetResourcePermissionPolicy(companyID, EntityTypeHuddleLogicGate, gateID)
	if err != nil || permissionPolicy.PermissionMode != PolicyModeCustomized || permissionPolicy.DefaultAccess == nil || *permissionPolicy.DefaultAccess != EntityPermissionNoAccess || len(permissionPolicy.Permissions) != 1 {
		t.Fatalf("converted permission policy = %+v, err=%v", permissionPolicy, err)
	}
	tree, err := repo.ListHuddleExplorer(companyID)
	if err != nil || len(tree.Items) != 1 || tree.Items[0].ResourceType != EntityTypeHuddleLogicGate || tree.Items[0].ResourceID != gateID {
		t.Fatalf("Huddle Explorer = %+v, err=%v", tree, err)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: companyID, OwnerID: gateID, Name: "Monday", ActorID: userID})
	if err != nil {
		t.Fatal(err)
	}
	tree, err = repo.ListHuddleExplorer(companyID)
	if err != nil || len(tree.Items) != 1 || tree.Items[0].ResourceType != EntityTypeHuddleLogicGate {
		t.Fatalf("Huddle Node creation changed Explorer placements: %+v, err=%v", tree, err)
	}
	repo.replaceMemoryRACIEdgesLocked(companyID, EntityTypeHuddleNode, node.HuddleNodeID, []domain.ResourceRACIAssignment{{Role: domain.RACIRoleAccountable, PrincipalType: "user", PrincipalID: userID}})
	if err := repo.DeleteHuddleLogicGate(companyID, gateID, userID); !errors.Is(err, ErrConflict) {
		t.Fatalf("delete gate with node error = %v, want conflict", err)
	}
	if err := repo.DeleteHuddleNode(companyID, node.HuddleNodeID, userID); err != nil {
		t.Fatal(err)
	}
	deleted, err := repo.ListRecycleBinItems(companyID, userID)
	if err != nil || len(deleted) != 1 || deleted[0].ObjectKind != "huddle_node" {
		t.Fatalf("recycle items = %+v, err=%v", deleted, err)
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, userID, []string{deleted[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	if restored, err := repo.GetHuddleNode(companyID, node.HuddleNodeID); err != nil || restored.HuddleLogicGateID != gateID {
		t.Fatalf("restored node = %+v, err=%v", restored, err)
	}
	tree, err = repo.ListHuddleExplorer(companyID)
	if err != nil || len(tree.Items) != 1 || tree.Items[0].ResourceType != EntityTypeHuddleLogicGate {
		t.Fatalf("Huddle Node restore changed Explorer placements: %+v, err=%v", tree, err)
	}
	restoredPolicy, err := repo.GetResourceRACIPolicy(companyID, EntityTypeHuddleNode, node.HuddleNodeID)
	if err != nil || len(restoredPolicy.RACIAssignments) != 1 || restoredPolicy.RACIAssignments[0].Role != domain.RACIRoleAccountable {
		t.Fatalf("restored Huddle Node RACI = %+v, err=%v", restoredPolicy, err)
	}
}

func TestHuddleMigrationUsesExactExplorerColumns(t *testing.T) {
	body, err := os.ReadFile("../../db/migrations/20260811_huddles_kpis.sql")
	if err != nil {
		t.Fatal(err)
	}
	sqlText := strings.ToLower(string(body))
	for _, required := range []string{"huddle_explorer_item_id uuid not null", "resource_huddle_resource_id uuid not null", "huddle_type text not null", "created_date timestamptz", "updated_date timestamptz"} {
		if !strings.Contains(sqlText, required) {
			t.Fatalf("Huddle Explorer migration missing %q", required)
		}
	}
	for _, forbidden := range []string{"created_by_user_id", "\n  item_id uuid not null,", "\n  resource_type text not null,", "\n  resource_id uuid not null,"} {
		if strings.Contains(sqlText, forbidden) {
			t.Fatalf("Huddle Explorer migration contains obsolete column declaration %q", forbidden)
		}
	}
}

func TestCanonicalHuddleSchemaHasNoPatchMarker(t *testing.T) {
	body, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "\n+-- Bare-bones Huddles and KPIs") {
		t.Fatal("canonical Huddle schema contains a leading patch marker and is not executable SQL")
	}
}

func TestHuddleExplorerStoresOnlyHuddleLogicGates(t *testing.T) {
	migration, err := os.ReadFile("../../db/migrations/20260811_z_huddle_explorer_logic_gates_only.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	storeSource, err := os.ReadFile("postgres_huddles.go")
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"migration": strings.ToLower(string(migration)), "canonical schema": strings.ToLower(string(schema))} {
		if !strings.Contains(body, "check (huddle_type = 'huddle_logic_gate')") {
			t.Fatalf("%s does not restrict Huddle Explorer items to Huddle Logic Gates", name)
		}
	}
	migrationSQL := strings.ToLower(string(migration))
	for _, required := range []string{
		"delete from huddle_explorer_items",
		"where huddle_type = 'huddle_node'",
		"item.object_kind = 'huddle_node'",
		"item.restore_payload - 'huddle_explorer_items'",
	} {
		if !strings.Contains(migrationSQL, required) {
			t.Fatalf("Huddle Explorer migration missing %q", required)
		}
	}
	if strings.Contains(strings.ToLower(string(storeSource)), "values($1::uuid,$2::uuid,'huddle_node',$3::uuid)") {
		t.Fatal("PostgreSQL Huddle Node creation still inserts a Huddle Explorer item")
	}
}
