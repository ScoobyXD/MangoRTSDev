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

func TestMemoryDirectHuddleLogicGateCreationAndAttachmentRecycle(t *testing.T) {
	repo := NewMemoryRepo()
	company, err := repo.CreateCompany("Direct Huddle")
	if err != nil {
		t.Fatal(err)
	}
	const userID = "55555555-5555-4555-8555-555555555555"
	huddle, err := repo.CreateHuddleLogicGate(HuddleCreateInput{
		CompanyID: company.CompanyID, Name: "Weekly operations", ActorID: userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	permissionPolicy, err := repo.GetResourcePermissionPolicy(company.CompanyID, EntityTypeHuddleLogicGate, huddle.HuddleLogicGateID)
	if err != nil || permissionPolicy.PermissionMode != PolicyModeCustomized || permissionPolicy.DefaultAccess == nil || *permissionPolicy.DefaultAccess != EntityPermissionEdit {
		t.Fatalf("direct Huddle permission policy=%+v err=%v", permissionPolicy, err)
	}
	explorer, err := repo.ListHuddleExplorer(company.CompanyID)
	if err != nil || len(explorer.Items) != 1 || explorer.Items[0].ParentFolderID != nil || explorer.Items[0].ResourceID != huddle.HuddleLogicGateID {
		t.Fatalf("direct Huddle root placement=%+v err=%v", explorer, err)
	}
	attachmentID := NewUUIDv7String()
	if _, _, err := repo.CreateAttachmentWithResourceLink(AttachmentCreateInput{
		CompanyID: company.CompanyID, AttachmentID: attachmentID, OriginalFilename: "agenda.png", MimeType: "image/png",
		ByteSize: 1, SHA256: strings.Repeat("a", 64), StorageBucket: "huddle-attachment-bucket",
		StorageKey: "companies/" + company.CompanyID + "/attachments/" + attachmentID + "/original",
		SourceKind: AttachmentSourceUserUpload,
		ResourceLink: ResourceAttachmentInput{
			CompanyID: company.CompanyID, ResourceType: EntityTypeHuddleLogicGate, ResourceID: huddle.HuddleLogicGateID,
			RelationshipKind: AttachmentRelationshipInlineImage,
		},
	}); err != nil {
		t.Fatalf("create Huddle attachment: %v", err)
	}
	if err := repo.DeleteHuddleLogicGate(company.CompanyID, huddle.HuddleLogicGateID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetAttachment(company.CompanyID, attachmentID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("recycled Huddle attachment error=%v, want ErrNotFound", err)
	}
	recycleItems, err := repo.ListRecycleBinItems(company.CompanyID, userID)
	if err != nil || len(recycleItems) != 1 {
		t.Fatalf("Huddle recycle items=%+v err=%v", recycleItems, err)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, userID, []string{recycleItems[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	links, err := repo.ListResourceAttachments(company.CompanyID, EntityTypeHuddleLogicGate, huddle.HuddleLogicGateID)
	if err != nil || len(links) != 1 || links[0].AttachmentID != attachmentID {
		t.Fatalf("restored Huddle attachments=%+v err=%v", links, err)
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
	textbox, err := repo.CreateHuddleNodeTextbox(HuddleNodeTextboxCreateInput{
		CompanyID: companyID, HuddleNodeID: node.HuddleNodeID, Title: "Meeting notes",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertHuddleNodeTextboxChat(HuddleNodeTextboxChatInput{
		CompanyID: companyID, HuddleNodeID: node.HuddleNodeID, TextboxID: textbox.TextboxID,
		ChatID: "66666666-6666-4666-8666-666666666666", AuthorUserID: userID,
		AuthorDisplayName: "Owner", ActorUserID: userID, Message: "Follow up", EntityLinks: json.RawMessage(`[]`),
	}); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleLogicGate(companyID, gateID, userID); !errors.Is(err, ErrConflict) {
		t.Fatalf("delete gate with node error = %v, want conflict", err)
	}
	if err := repo.DeleteHuddleNode(companyID, node.HuddleNodeID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetHuddleNodeWorkspace(companyID, node.HuddleNodeID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted Huddle Node workspace error = %v, want ErrNotFound", err)
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
	workspace, err := repo.GetHuddleNodeWorkspace(companyID, node.HuddleNodeID)
	if err != nil || len(workspace.Textboxes) != 2 || workspace.Textboxes[1].TextboxID != textbox.TextboxID || len(workspace.Chats) != 1 || workspace.Chats[0].Message != "Follow up" {
		t.Fatalf("restored Huddle Node workspace = %+v, err=%v", workspace, err)
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

func TestMemoryHuddleLogicGateRelationshipsAndNodeSnapshots(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	userID := "22222222-2222-4222-8222-222222222222"
	huddleSource, err := repo.CreateLogicGate(companyID, "Daily Huddle")
	if err != nil {
		t.Fatal(err)
	}
	huddle, err := repo.ConvertLogicGateToHuddle(companyID, huddleSource.LogicGateID, userID)
	if err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Customer Health")
	if err != nil {
		t.Fatal(err)
	}
	kpi, err := repo.CreateKPI(HuddleCreateInput{CompanyID: companyID, OwnerID: logicGate.LogicGateID, Name: "Renewal rate"})
	if err != nil {
		t.Fatal(err)
	}
	link := HuddleLogicGateRelationshipInput{CompanyID: companyID, HuddleLogicGateID: huddle.HuddleLogicGateID, LogicGateID: logicGate.LogicGateID}
	if err := repo.CreateHuddleLogicGateRelationship(link); err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateHuddleLogicGateRelationship(link); err != nil {
		t.Fatalf("idempotent relationship create: %v", err)
	}
	cards, err := repo.ListHuddleLogicGateCards(companyID, huddle.HuddleLogicGateID)
	if err != nil || len(cards) != 1 || cards[0].LogicGateID != logicGate.LogicGateID || len(cards[0].KPIs) != 1 || cards[0].KPIs[0].KPIID != kpi.KPIID {
		t.Fatalf("Huddle Logic Gate cards = %+v, err=%v", cards, err)
	}
	linkedHuddles, err := repo.ListHuddleLogicGatesForLogicGate(companyID, logicGate.LogicGateID)
	if err != nil || len(linkedHuddles) != 1 || linkedHuddles[0].HuddleLogicGateID != huddle.HuddleLogicGateID {
		t.Fatalf("Logic Gate Huddle cards = %+v, err=%v", linkedHuddles, err)
	}

	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: companyID, OwnerID: huddle.HuddleLogicGateID, Name: "Monday", ActorID: userID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateKPI(HuddleCreateInput{CompanyID: companyID, OwnerID: logicGate.LogicGateID, Name: "New after snapshot"}); err != nil {
		t.Fatal(err)
	}
	nodeCards, err := repo.ListHuddleNodeLogicGateCards(companyID, node.HuddleNodeID)
	if err != nil || len(nodeCards) != 1 || len(nodeCards[0].KPIs) != 1 || nodeCards[0].KPIs[0].KPIID != kpi.KPIID {
		t.Fatalf("Huddle Node snapshot cards = %+v, err=%v", nodeCards, err)
	}
	if _, err := repo.UpdateKPI(HuddleUpdateInput{CompanyID: companyID, ResourceID: kpi.KPIID, Name: "Current renewal rate"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleLogicGateRelationship(link); err != nil {
		t.Fatal(err)
	}
	cards, err = repo.ListHuddleLogicGateCards(companyID, huddle.HuddleLogicGateID)
	if err != nil || len(cards) != 0 {
		t.Fatalf("live Huddle cards after unlink = %+v, err=%v", cards, err)
	}
	linkedHuddles, err = repo.ListHuddleLogicGatesForLogicGate(companyID, logicGate.LogicGateID)
	if err != nil || len(linkedHuddles) != 0 {
		t.Fatalf("Logic Gate Huddle cards after unlink = %+v, err=%v", linkedHuddles, err)
	}
	nodeCards, err = repo.ListHuddleNodeLogicGateCards(companyID, node.HuddleNodeID)
	if err != nil || len(nodeCards) != 1 || len(nodeCards[0].KPIs) != 1 || nodeCards[0].KPIs[0].Name != "Current renewal rate" {
		t.Fatalf("snapshot membership with current KPI data = %+v, err=%v", nodeCards, err)
	}

	otherCompanyID := "33333333-3333-4333-8333-333333333333"
	otherGate, err := repo.CreateLogicGate(otherCompanyID, "Other company")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateHuddleLogicGateRelationship(HuddleLogicGateRelationshipInput{CompanyID: companyID, HuddleLogicGateID: huddle.HuddleLogicGateID, LogicGateID: otherGate.LogicGateID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-company relationship error = %v, want ErrNotFound", err)
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

func TestHuddleRelationshipMigrationUsesOnlyTypedTables(t *testing.T) {
	body, err := os.ReadFile("../../db/migrations/20260811_zz_huddle_logic_gate_relationships.sql")
	if err != nil {
		t.Fatal(err)
	}
	sqlText := strings.ToLower(string(body))
	for _, required := range []string{
		"create table if not exists huddle_logic_gate_relationships",
		"primary key (company_id,huddle_logic_gate_id,logic_gate_id)",
		"create table if not exists huddle_node_logic_gate_relationships",
		"primary key (company_id,huddle_node_id,logic_gate_id)",
		"create table if not exists huddle_node_kpi_relationships",
		"primary key (company_id,huddle_node_id,logic_gate_id,kpi_id)",
		"alter table huddle_nodes drop column if exists body_json",
	} {
		if !strings.Contains(sqlText, required) {
			t.Fatalf("Huddle relationship migration missing %q", required)
		}
	}
	for _, forbidden := range []string{"resource_registry", "resource_type text", "relationship_id uuid"} {
		if strings.Contains(sqlText, forbidden) {
			t.Fatalf("Huddle relationship migration contains forbidden generic storage %q", forbidden)
		}
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
	checks := map[string][]string{
		"migration":        {"check (huddle_type = 'huddle_logic_gate')"},
		"canonical schema": {"constraint huddle_explorer_items_huddle_type_chk", "huddle_type = 'huddle_logic_gate'::text"},
	}
	for name, markers := range checks {
		body := strings.ToLower(string(migration))
		if name == "canonical schema" {
			body = normalizeCanonicalSchemaContract(string(schema))
		}
		for _, marker := range markers {
			if !strings.Contains(body, marker) {
				t.Fatalf("%s does not restrict Huddle Explorer items to Huddle Logic Gates", name)
			}
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
