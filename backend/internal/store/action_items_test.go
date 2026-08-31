package store

import (
	"bytes"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

type huddleRollupTestRepository interface {
	GetHuddleNode(companyID, huddleNodeID string) (domain.HuddleNode, error)
	ListHuddleLogicGateActionItems(companyID, huddleLogicGateID string) ([]domain.Entity, error)
}

func listHuddleNodeOwnerRollupForTest(repo huddleRollupTestRepository, companyID, huddleNodeID string) ([]domain.Entity, error) {
	node, err := repo.GetHuddleNode(companyID, huddleNodeID)
	if err != nil {
		return nil, err
	}
	return repo.ListHuddleLogicGateActionItems(companyID, node.HuddleLogicGateID)
}

func TestEntityRelationshipMigrationUsesExactHuddleNodesWithoutCompatibilityBackfill(t *testing.T) {
	historical, err := os.ReadFile("../../db/migrations/20260828_action_items.sql")
	if err != nil {
		t.Fatal(err)
	}
	normalizedHistorical := strings.ToLower(strings.Join(strings.Fields(string(historical)), " "))
	if !strings.Contains(normalizedHistorical, "create table action_item_huddle_relationships") || strings.Contains(normalizedHistorical, "create table entity_relationships") {
		t.Fatal("historical Action Item migration was rewritten instead of followed by a forward migration")
	}

	for _, path := range []string{"../../db/migrations/20260828_entity_relationships.sql", "../../db/schema.sql"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
		if strings.Contains(normalized, "create table action_item_huddle_relationships") || strings.Contains(normalized, "create table public.action_item_huddle_relationships") {
			t.Fatalf("%s recreates the retired Action Item Huddle table", path)
		}
		tableStart := strings.Index(normalized, "create table entity_relationships (")
		if tableStart < 0 {
			tableStart = strings.Index(normalized, "create table public.entity_relationships (")
		}
		if tableStart < 0 {
			t.Fatalf("%s is missing entity_relationships", path)
		}
		tableDefinition := normalized[tableStart:]
		if tableEnd := strings.Index(tableDefinition, ");"); tableEnd >= 0 {
			tableDefinition = tableDefinition[:tableEnd]
		} else {
			t.Fatalf("%s entity_relationships table definition is incomplete", path)
		}
		for _, required := range []string{"company_id", "entity_id", "resource_type", "resource_id", "huddle_node"} {
			if !strings.Contains(tableDefinition, required) {
				t.Fatalf("%s entity_relationships missing %q", path, required)
			}
		}
		if strings.Contains(tableDefinition, "entity_type_id") {
			t.Fatalf("%s entity_relationships must derive Entity Type from the exact Entity", path)
		}
	}
	migration, err := os.ReadFile("../../db/migrations/20260828_entity_relationships.sql")
	if err != nil {
		t.Fatal(err)
	}
	normalizedMigration := strings.ToLower(strings.Join(strings.Fields(string(migration)), " "))
	if !strings.Contains(normalizedMigration, "drop table action_item_huddle_relationships") {
		t.Fatal("forward migration does not remove the retired Action Item Huddle table")
	}
	for _, forbidden := range []string{"insert into entity_relationships", "update entity_relationships"} {
		if strings.Contains(normalizedMigration, forbidden) {
			t.Fatalf("clean-database relationship migration retains compatibility DML %q", forbidden)
		}
	}
}

func TestEntityRelationshipForwardMigrationAddsExactHuddleLogicGateEndpoints(t *testing.T) {
	migration, err := os.ReadFile("../../db/migrations/20260828_zz_huddle_logic_gate_action_item_relationships.sql")
	if err != nil {
		t.Fatal(err)
	}
	normalizedMigration := strings.ToLower(strings.Join(strings.Fields(string(migration)), " "))
	for _, required := range []string{
		"drop constraint entity_relationships_huddle_node_fkey",
		"check (resource_type in ('huddle_node','huddle_logic_gate'))",
		"before insert or update on entity_relationships",
		"from huddle_nodes",
		"from huddle_logic_gates",
		"trg_delete_huddle_node_entity_relationships",
		"trg_delete_huddle_logic_gate_entity_relationships",
		"insert into entity_relationships",
		"entity_type.system_key='action_item'",
	} {
		if !strings.Contains(normalizedMigration, required) {
			t.Fatalf("forward migration missing %q", required)
		}
	}
	for _, forbidden := range []string{"resource registry", "surrogate", "compatibility"} {
		if strings.Contains(normalizedMigration, forbidden) {
			t.Fatalf("forward migration contains forbidden generic or compatibility path %q", forbidden)
		}
	}

	canonical, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	normalizedCanonical := strings.ToLower(strings.Join(strings.Fields(string(canonical)), " "))
	for _, required := range []string{
		"resource_type = any (array['huddle_node'::text, 'huddle_logic_gate'::text])",
		"before insert or update on public.entity_relationships",
		"new.resource_type='huddle_logic_gate'",
		"trg_delete_huddle_node_entity_relationships after delete on public.huddle_nodes",
		"trg_delete_huddle_logic_gate_entity_relationships after delete on public.huddle_logic_gates",
	} {
		if !strings.Contains(normalizedCanonical, required) {
			t.Fatalf("canonical schema missing %q", required)
		}
	}
	if strings.Contains(normalizedCanonical, "add constraint entity_relationships_huddle_node_fkey") {
		t.Fatal("canonical schema retains the Huddle-Node-only resource foreign key")
	}
}

func TestActionItemSourceHistoricalMigrationRemainsTableBased(t *testing.T) {
	const historicalPath = "../../db/migrations/20260829_action_item_delegation_source.sql"
	raw, err := os.ReadFile(historicalPath)
	if err != nil {
		t.Fatal(err)
	}
	lf := bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
	lf = bytes.ReplaceAll(lf, []byte("\r"), nil)
	blob := append([]byte(fmt.Sprintf("blob %d\x00", len(lf))), lf...)
	if got, want := fmt.Sprintf("%x", sha1.Sum(blob)), "cdbfe46e9c6676d599c2d13b981994e324012a2e"; got != want {
		t.Fatalf("historical Action Item Source migration Git blob=%s, want shipped 42c57a66 blob %s", got, want)
	}
}

type actionItemEditorReference struct {
	EntityID   string
	ActionItem bool
}

func actionItemEditorTestDocument(t *testing.T, references ...actionItemEditorReference) json.RawMessage {
	t.Helper()
	content := make([]map[string]any, 0, len(references))
	for _, reference := range references {
		attrs := map[string]any{"entityType": "entity", "entityId": reference.EntityID, "label": "Entity", "actionItem": reference.ActionItem}
		if reference.ActionItem {
			attrs["actionItemColor"] = nil
		}
		content = append(content, map[string]any{"type": "mangoEntityLink", "attrs": attrs})
	}
	document, err := json.Marshal(map[string]any{
		"format": MangoTiptapFormat, "schema_version": MangoTiptapSchemaVersion,
		"document": map[string]any{"type": "doc", "content": []map[string]any{{"type": "paragraph", "content": content}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return document
}

func createActionItemEditorTestTextbox(t *testing.T, repo Repository, companyID, huddleNodeID, title string) EditorJSONDocumentRef {
	t.Helper()
	textbox, err := repo.CreateHuddleNodeTextbox(HuddleNodeTextboxCreateInput{CompanyID: companyID, HuddleNodeID: huddleNodeID, Title: title})
	if err != nil {
		t.Fatal(err)
	}
	return EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeHuddleNode, ResourceID: huddleNodeID, DocumentID: textbox.TextboxID}
}

func commitActionItemEditorTestDocument(t *testing.T, repo Repository, ref EditorJSONDocumentRef, actorUserID string, baseRevision int64, operationID string, references ...actionItemEditorReference) EditorJSONCommit {
	t.Helper()
	commit, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: ref, OperationID: operationID, ClientID: "action-item-test", ActorUserID: actorUserID,
		BaseRevision: baseRevision, SchemaVersion: MangoTiptapSchemaVersion,
		JSONDocument: actionItemEditorTestDocument(t, references...),
	})
	if err != nil {
		t.Fatalf("commit %s: %v", operationID, err)
	}
	return commit
}

func TestMemoryActionItemSavedReferencesAndHuddleProcessRollup(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "action-item-owner")

	firstGate, err := repo.CreateLogicGate(company.CompanyID, "Daily Huddle")
	if err != nil {
		t.Fatal(err)
	}
	firstProcess, err := repo.ConvertLogicGateToHuddle(company.CompanyID, firstGate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	firstNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: firstProcess.HuddleLogicGateID, Name: "Monday", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	secondNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: firstProcess.HuddleLogicGateID, Name: "Tuesday", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}

	created, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Call the supplier\nConfirm the ship date", CreatedByUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("CreateActionItem: %v", err)
	}
	if created.Name != "Call the supplier" || created.CreatedByUserID != user.UserID || created.EntityTypeID != ActionItemEntityTypeID {
		t.Fatalf("created action item=%+v", created)
	}
	assertActionItemFieldValue(t, created, ActionItemStatusSystemKey, `"in_progress"`)
	assertActionItemFieldValue(t, created, ActionItemColorSystemKey, "null")
	assertActionItemFieldValue(t, created, ActionItemAssignedBySystemKey, "null")
	assertActionItemFieldValue(t, created, ActionItemSourceSystemKey, "null")
	if len(created.EntityFields) != 7 {
		t.Fatalf("field count=%d, want 7", len(created.EntityFields))
	}

	for _, huddleNodeID := range []string{firstNode.HuddleNodeID, secondNode.HuddleNodeID} {
		items, err := listHuddleNodeOwnerRollupForTest(repo, company.CompanyID, huddleNodeID)
		if err != nil {
			t.Fatal(err)
		}
		if len(items) != 0 {
			t.Fatalf("company-wide creation unexpectedly attached to Huddle Node %s: %+v", huddleNodeID, items)
		}
	}
	processItems, err := repo.ListHuddleLogicGateActionItems(company.CompanyID, firstProcess.HuddleLogicGateID)
	if err != nil || len(processItems) != 0 {
		t.Fatalf("empty Huddle Process rollup=%+v err=%v", processItems, err)
	}
	ordinaryType, err := repo.CreateEntityType(EntityTypeInput{CompanyID: company.CompanyID, Name: "Decision"})
	if err != nil {
		t.Fatal(err)
	}
	ordinary, err := repo.CreateEntity(EntityInput{CompanyID: company.CompanyID, EntityTypeID: ordinaryType.EntityTypeID, Name: "Ordinary Entity"})
	if err != nil {
		t.Fatal(err)
	}
	ordinaryRelationshipKey := entityRelationshipKey(company.CompanyID, ordinary.EntityID, EntityTypeHuddleNode, firstNode.HuddleNodeID)
	repo.entityRelationships[ordinaryRelationshipKey] = domain.EntityRelationship{CompanyID: company.CompanyID, EntityID: ordinary.EntityID, ResourceType: EntityTypeHuddleNode, ResourceID: firstNode.HuddleNodeID}

	firstRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, firstNode.HuddleNodeID, "First notes")
	firstCommit := commitActionItemEditorTestDocument(t, repo, firstRef, user.UserID, 0, "first-reference",
		actionItemEditorReference{EntityID: created.EntityID, ActionItem: true},
		actionItemEditorReference{EntityID: created.EntityID, ActionItem: false},
		actionItemEditorReference{EntityID: ordinary.EntityID},
	)
	firstRelationshipKey := entityRelationshipKey(company.CompanyID, created.EntityID, EntityTypeHuddleNode, firstNode.HuddleNodeID)
	if _, exists := repo.entityRelationships[firstRelationshipKey]; !exists {
		t.Fatalf("saved editor relationship missing from %+v", repo.entityRelationships)
	}
	firstRelationship := repo.entityRelationships[firstRelationshipKey]
	siblingRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, firstNode.HuddleNodeID, "Sibling notes")
	siblingCommit := commitActionItemEditorTestDocument(t, repo, siblingRef, user.UserID, 0, "sibling-reference", actionItemEditorReference{EntityID: created.EntityID, ActionItem: true})
	if current := repo.entityRelationships[firstRelationshipKey]; !current.CreatedTimestamp.Equal(firstRelationship.CreatedTimestamp) {
		t.Fatalf("deduped saved references changed relationship timestamp from %s to %s", firstRelationship.CreatedTimestamp, current.CreatedTimestamp)
	}
	firstClear := commitActionItemEditorTestDocument(t, repo, firstRef, user.UserID, firstCommit.Revision, "remove-first-reference")
	if _, exists := repo.entityRelationships[firstRelationshipKey]; !exists {
		t.Fatal("removing one saved reference removed the surviving sibling relationship")
	}
	siblingClear := commitActionItemEditorTestDocument(t, repo, siblingRef, user.UserID, siblingCommit.Revision, "remove-final-reference")
	if _, exists := repo.entityRelationships[firstRelationshipKey]; exists {
		t.Fatal("removing the final saved reference retained the Action Item relationship")
	}
	if _, exists := repo.entityRelationships[ordinaryRelationshipKey]; !exists {
		t.Fatal("Action Item recomputation removed an ordinary Entity relationship")
	}
	if _, err := repo.GetEntity(company.CompanyID, created.EntityID); err != nil {
		t.Fatalf("removing the final saved reference removed the Action Item: %v", err)
	}
	firstReadd := commitActionItemEditorTestDocument(t, repo, firstRef, user.UserID, firstClear.Revision, "restore-first-reference", actionItemEditorReference{EntityID: created.EntityID, ActionItem: true})
	_ = siblingClear
	secondRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, secondNode.HuddleNodeID, "Tuesday notes")
	secondCommit := commitActionItemEditorTestDocument(t, repo, secondRef, user.UserID, 0, "second-node-reference", actionItemEditorReference{EntityID: created.EntityID, ActionItem: true})
	secondRelationshipKey := entityRelationshipKey(company.CompanyID, created.EntityID, EntityTypeHuddleNode, secondNode.HuddleNodeID)
	if _, exists := repo.entityRelationships[secondRelationshipKey]; !exists {
		t.Fatal("second Huddle Node saved reference did not create its exact edge")
	}
	for _, huddleNodeID := range []string{firstNode.HuddleNodeID, secondNode.HuddleNodeID} {
		items, listErr := listHuddleNodeOwnerRollupForTest(repo, company.CompanyID, huddleNodeID)
		if listErr != nil || len(items) != 1 || items[0].EntityID != created.EntityID {
			t.Fatalf("deduped sibling Huddle Node rollup for %s = %+v, err=%v", huddleNodeID, items, listErr)
		}
	}
	processItems, err = repo.ListHuddleLogicGateActionItems(company.CompanyID, firstProcess.HuddleLogicGateID)
	if err != nil || len(processItems) != 1 || processItems[0].EntityID != created.EntityID {
		t.Fatalf("direct Huddle Process rollup=%+v err=%v", processItems, err)
	}

	secondGate, err := repo.CreateLogicGate(company.CompanyID, "Weekly Huddle")
	if err != nil {
		t.Fatal(err)
	}
	secondProcess, err := repo.ConvertLogicGateToHuddle(company.CompanyID, secondGate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	otherNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: secondProcess.HuddleLogicGateID, Name: "Weekly", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	otherRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, otherNode.HuddleNodeID, "Weekly notes")
	commitActionItemEditorTestDocument(t, repo, otherRef, user.UserID, 0, "other-process-reference", actionItemEditorReference{EntityID: created.EntityID, ActionItem: true})
	items, err := listHuddleNodeOwnerRollupForTest(repo, company.CompanyID, otherNode.HuddleNodeID)
	if err != nil || len(items) != 1 || items[0].EntityID != created.EntityID {
		t.Fatalf("second Huddle Process items=%+v err=%v", items, err)
	}
	firstSecondClear := commitActionItemEditorTestDocument(t, repo, firstRef, user.UserID, firstReadd.Revision, "clear-first-node")
	items, err = listHuddleNodeOwnerRollupForTest(repo, company.CompanyID, firstNode.HuddleNodeID)
	if err != nil || len(items) != 1 || items[0].EntityID != created.EntityID {
		t.Fatalf("second Node reference should keep first Process rollup=%+v err=%v", items, err)
	}
	commitActionItemEditorTestDocument(t, repo, secondRef, user.UserID, secondCommit.Revision, "clear-second-node")
	items, err = listHuddleNodeOwnerRollupForTest(repo, company.CompanyID, firstNode.HuddleNodeID)
	if err != nil || len(items) != 0 {
		t.Fatalf("removing final first Process reference items=%+v err=%v", items, err)
	}
	items, err = listHuddleNodeOwnerRollupForTest(repo, company.CompanyID, otherNode.HuddleNodeID)
	if err != nil || len(items) != 1 || items[0].EntityID != created.EntityID {
		t.Fatalf("other Process reference changed=%+v err=%v", items, err)
	}
	commitActionItemEditorTestDocument(t, repo, firstRef, user.UserID, firstSecondClear.Revision, "reference-before-recycle", actionItemEditorReference{EntityID: created.EntityID, ActionItem: true})

	if _, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Invalid color", Color: actionItemTestStringPointer("blue"), CreatedByUserID: user.UserID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid color error=%v, want ErrInvalid", err)
	}

	if err := repo.DeleteHuddleNode(company.CompanyID, firstNode.HuddleNodeID, user.UserID); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.entityRelationships[firstRelationshipKey]; exists {
		t.Fatalf("live relationship survived exact Huddle Node recycle: %+v", repo.entityRelationships)
	}
	recycleItems, err := repo.ListRecycleBinItems(company.CompanyID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	var firstNodeRecycleID string
	for _, recycleItem := range recycleItems {
		if recycleItem.ObjectKind == "huddle_node" && recycleItem.ObjectID == firstNode.HuddleNodeID {
			firstNodeRecycleID = recycleItem.RecycleBinItemID
			break
		}
	}
	if firstNodeRecycleID == "" {
		t.Fatalf("Huddle Node recycle item missing from %+v", recycleItems)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, user.UserID, []string{firstNodeRecycleID}); err != nil {
		t.Fatal(err)
	}
	restoredItems, err := listHuddleNodeOwnerRollupForTest(repo, company.CompanyID, firstNode.HuddleNodeID)
	if err != nil || len(restoredItems) != 1 || restoredItems[0].EntityID != created.EntityID {
		t.Fatalf("restored Huddle Node action items=%+v err=%v", restoredItems, err)
	}

	if err := repo.DeleteHuddleNode(company.CompanyID, firstNode.HuddleNodeID, user.UserID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleNode(company.CompanyID, secondNode.HuddleNodeID, user.UserID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleLogicGate(company.CompanyID, firstProcess.HuddleLogicGateID, user.UserID); err != nil {
		t.Fatal(err)
	}
	recycleItems, err = repo.ListRecycleBinItems(company.CompanyID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	firstNodeRecycleID, processRecycleID := "", ""
	for _, recycleItem := range recycleItems {
		switch {
		case recycleItem.ObjectKind == "huddle_node" && recycleItem.ObjectID == firstNode.HuddleNodeID:
			firstNodeRecycleID = recycleItem.RecycleBinItemID
		case recycleItem.ObjectKind == "huddle_logic_gate" && recycleItem.ObjectID == firstProcess.HuddleLogicGateID:
			processRecycleID = recycleItem.RecycleBinItemID
		}
	}
	if firstNodeRecycleID == "" || processRecycleID == "" {
		t.Fatalf("Huddle Process/Node recycle items missing from %+v", recycleItems)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, user.UserID, []string{processRecycleID, firstNodeRecycleID}); err != nil {
		t.Fatal(err)
	}
	restoredItems, err = listHuddleNodeOwnerRollupForTest(repo, company.CompanyID, firstNode.HuddleNodeID)
	if err != nil || len(restoredItems) != 1 || restoredItems[0].EntityID != created.EntityID {
		t.Fatalf("restored Huddle Process and Node action items=%+v err=%v", restoredItems, err)
	}
}

func TestMemoryHuddleNodeCreatedAndDueActionItemSurfacesStayDistinct(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "huddle-node-surface-owner")
	gate, err := repo.CreateLogicGate(company.CompanyID, "Daily")
	if err != nil {
		t.Fatal(err)
	}
	board, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	currentNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: "Current", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	siblingNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: "Sibling", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}

	create := func(name, sourceType, sourceID string) domain.Entity {
		t.Helper()
		item, createErr := repo.CreateActionItem(ActionItemInput{
			CompanyID: company.CompanyID, BodyText: name, CreatedByUserID: user.UserID,
			SourceResourceType: sourceType, SourceResourceID: sourceID,
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		return item
	}
	setField := func(item domain.Entity, systemKey, rawValue string) {
		t.Helper()
		for _, field := range item.EntityFields {
			if field.SystemKey != systemKey {
				continue
			}
			if _, updateErr := repo.UpdateEntityField(EntityFieldInput{
				CompanyID: company.CompanyID, EntityID: item.EntityID, EntityFieldID: field.EntityFieldID,
				Value: json.RawMessage(rawValue), ValueSet: true,
			}); updateErr != nil {
				t.Fatal(updateErr)
			}
			return
		}
		t.Fatalf("Action Item %s is missing field %s", item.EntityID, systemKey)
	}
	link := func(item domain.Entity, resourceType, resourceID string) {
		t.Helper()
		repo.entityRelationships[entityRelationshipKey(company.CompanyID, item.EntityID, resourceType, resourceID)] = domain.EntityRelationship{
			CompanyID: company.CompanyID, EntityID: item.EntityID,
			ResourceType: resourceType, ResourceID: resourceID, CreatedTimestamp: time.Now().UTC(),
		}
	}

	createdHere := create("Created here and complete", EntityTypeHuddleNode, currentNode.HuddleNodeID)
	setField(createdHere, ActionItemStatusSystemKey, `"done"`)
	setField(createdHere, ActionItemCompletionDueDateSystemKey, `"2026-08-01"`)
	link(createdHere, EntityTypeHuddleLogicGate, board.HuddleLogicGateID)

	siblingDue := create("Sibling due", EntityTypeHuddleNode, siblingNode.HuddleNodeID)
	setField(siblingDue, ActionItemCompletionDueDateSystemKey, `"2026-08-30"`)
	link(siblingDue, EntityTypeHuddleNode, siblingNode.HuddleNodeID)
	directDue := create("Direct Board due", "", "")
	setField(directDue, ActionItemCompletionDueDateSystemKey, `"2026-08-31"`)
	link(directDue, EntityTypeHuddleLogicGate, board.HuddleLogicGateID)
	future := create("Future", "", "")
	setField(future, ActionItemCompletionDueDateSystemKey, `"2026-09-01"`)
	link(future, EntityTypeHuddleLogicGate, board.HuddleLogicGateID)
	completed := create("Completed elsewhere", "", "")
	setField(completed, ActionItemCompletionDueDateSystemKey, `"2026-08-15"`)
	setField(completed, ActionItemStatusSystemKey, `"done"`)
	link(completed, EntityTypeHuddleLogicGate, board.HuddleLogicGateID)

	createdItems, err := repo.ListHuddleNodeCreatedActionItems(company.CompanyID, currentNode.HuddleNodeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(createdItems) != 1 || createdItems[0].EntityID != createdHere.EntityID {
		t.Fatalf("created surface = %+v, want completed exact-Source item", createdItems)
	}

	dueItems, err := repo.ListHuddleNodeDueActionItems(company.CompanyID, currentNode.HuddleNodeID, "2026-08-31")
	if err != nil {
		t.Fatal(err)
	}
	dueIDs := map[string]bool{}
	for _, item := range dueItems {
		dueIDs[item.EntityID] = true
	}
	if len(dueIDs) != 2 || !dueIDs[siblingDue.EntityID] || !dueIDs[directDue.EntityID] {
		t.Fatalf("due surface IDs = %v, want sibling and direct Board due items", dueIDs)
	}
	for _, excluded := range []domain.Entity{createdHere, future, completed} {
		if dueIDs[excluded.EntityID] {
			t.Fatalf("due surface included excluded item %q", excluded.Name)
		}
	}
	if _, err := repo.ListHuddleNodeDueActionItems(company.CompanyID, currentNode.HuddleNodeID, "2026-8-31"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid viewing date error = %v, want ErrInvalid", err)
	}
}

func TestMemoryActionItemSourceCannotMoveBetweenHuddleNodes(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "immutable-huddle-source")
	gate, err := repo.CreateLogicGate(company.CompanyID, "Immutable Source")
	if err != nil {
		t.Fatal(err)
	}
	board, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: "First", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: "Second", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	item, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Keep immutable provenance", CreatedByUserID: user.UserID,
		SourceResourceType: EntityTypeHuddleNode, SourceResourceID: first.HuddleNodeID,
	})
	if err != nil {
		t.Fatal(err)
	}
	var sourceField domain.EntityField
	for _, field := range item.EntityFields {
		if field.SystemKey == ActionItemSourceSystemKey {
			sourceField = field
		}
	}
	if sourceField.EntityFieldID == "" {
		t.Fatal("Action Item Source field is missing")
	}
	nextSource, err := json.Marshal(map[string]string{"resource_type": EntityTypeHuddleNode, "resource_id": second.HuddleNodeID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateEntityField(EntityFieldInput{
		CompanyID: company.CompanyID, EntityID: item.EntityID, EntityFieldID: sourceField.EntityFieldID,
		Value: nextSource, ValueSet: true,
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("Source mutation error = %v, want ErrConflict", err)
	}
	source, err := repo.GetActionItemSource(company.CompanyID, item.EntityID)
	if err != nil || source.ResourceType != EntityTypeHuddleNode || source.ResourceID != first.HuddleNodeID {
		t.Fatalf("Source after rejected mutation = %+v err=%v", source, err)
	}
	firstItems, err := repo.ListHuddleNodeCreatedActionItems(company.CompanyID, first.HuddleNodeID)
	if err != nil || len(firstItems) != 1 || firstItems[0].EntityID != item.EntityID {
		t.Fatalf("original Created list = %+v err=%v", firstItems, err)
	}
	secondItems, err := repo.ListHuddleNodeCreatedActionItems(company.CompanyID, second.HuddleNodeID)
	if err != nil || len(secondItems) != 0 {
		t.Fatalf("new Node Created list = %+v err=%v", secondItems, err)
	}
}

func TestMemoryHuddleLogicGateSavedActionItemReferencesRollUpAndRestore(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "huddle-logic-gate-action-item-owner")
	gate, err := repo.CreateLogicGate(company.CompanyID, "Direct Huddle")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	actionItem, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Direct process action", CreatedByUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	processRef := EditorJSONDocumentRef{
		CompanyID: company.CompanyID, ResourceType: EntityTypeHuddleLogicGate,
		ResourceID: process.HuddleLogicGateID, DocumentID: process.HuddleLogicGateID,
	}
	processCommit := commitActionItemEditorTestDocument(t, repo, processRef, user.UserID, 0, "direct-process-reference", actionItemEditorReference{EntityID: actionItem.EntityID})
	processRelationshipKey := entityRelationshipKey(company.CompanyID, actionItem.EntityID, EntityTypeHuddleLogicGate, process.HuddleLogicGateID)
	if _, exists := repo.entityRelationships[processRelationshipKey]; !exists {
		t.Fatalf("direct Huddle Logic Gate relationship missing from %+v", repo.entityRelationships)
	}
	items, err := repo.ListHuddleLogicGateActionItems(company.CompanyID, process.HuddleLogicGateID)
	if err != nil || len(items) != 1 || items[0].EntityID != actionItem.EntityID {
		t.Fatalf("direct Huddle Logic Gate rollup=%+v err=%v", items, err)
	}

	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: process.HuddleLogicGateID, Name: "Monday", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := repo.GetHuddleNodeWorkspace(company.CompanyID, node.HuddleNodeID)
	if err != nil || len(workspace.Textboxes) != 1 {
		t.Fatalf("default Huddle Node workspace=%+v err=%v", workspace, err)
	}
	nodeRef := EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeHuddleNode, ResourceID: node.HuddleNodeID, DocumentID: workspace.Textboxes[0].TextboxID}
	nodeCommit := commitActionItemEditorTestDocument(t, repo, nodeRef, user.UserID, 0, "child-node-reference", actionItemEditorReference{EntityID: actionItem.EntityID})
	items, err = repo.ListHuddleLogicGateActionItems(company.CompanyID, process.HuddleLogicGateID)
	if err != nil || len(items) != 1 {
		t.Fatalf("deduped direct and child rollup=%+v err=%v", items, err)
	}

	processClear := commitActionItemEditorTestDocument(t, repo, processRef, user.UserID, processCommit.Revision, "clear-direct-process-reference")
	if _, exists := repo.entityRelationships[processRelationshipKey]; exists {
		t.Fatal("clearing the direct Huddle Logic Gate reference retained its exact relationship")
	}
	items, err = repo.ListHuddleLogicGateActionItems(company.CompanyID, process.HuddleLogicGateID)
	if err != nil || len(items) != 1 {
		t.Fatalf("child reference did not survive direct reference removal: items=%+v err=%v", items, err)
	}
	commitActionItemEditorTestDocument(t, repo, nodeRef, user.UserID, nodeCommit.Revision, "clear-child-node-reference")
	items, err = repo.ListHuddleLogicGateActionItems(company.CompanyID, process.HuddleLogicGateID)
	if err != nil || len(items) != 0 {
		t.Fatalf("clearing both reference sources retained rollup items=%+v err=%v", items, err)
	}
	commitActionItemEditorTestDocument(t, repo, processRef, user.UserID, processClear.Revision, "restore-direct-process-reference", actionItemEditorReference{EntityID: actionItem.EntityID})

	if err := repo.DeleteHuddleNode(company.CompanyID, node.HuddleNodeID, user.UserID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleLogicGate(company.CompanyID, process.HuddleLogicGateID, user.UserID); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.entityRelationships[processRelationshipKey]; exists {
		t.Fatal("direct Huddle Logic Gate relationship survived recycle")
	}
	recycleItems, err := repo.ListRecycleBinItems(company.CompanyID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	processRecycleID := ""
	for _, item := range recycleItems {
		if item.ObjectKind == EntityTypeHuddleLogicGate && item.ObjectID == process.HuddleLogicGateID {
			processRecycleID = item.RecycleBinItemID
		}
	}
	if processRecycleID == "" {
		t.Fatalf("Huddle Logic Gate recycle item missing from %+v", recycleItems)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, user.UserID, []string{processRecycleID}); err != nil {
		t.Fatal(err)
	}
	items, err = repo.ListHuddleLogicGateActionItems(company.CompanyID, process.HuddleLogicGateID)
	if err != nil || len(items) != 1 || items[0].EntityID != actionItem.EntityID {
		t.Fatalf("restored direct Huddle Logic Gate action items=%+v err=%v", items, err)
	}
}

func TestMemorySavedHuddleReferencesUseCanonicalCompanyAndEntityType(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "action-item-sync-validation")
	gate, err := repo.CreateLogicGate(company.CompanyID, "Daily")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: process.HuddleLogicGateID, Name: "Daily", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	ordinaryType, err := repo.CreateEntityType(EntityTypeInput{CompanyID: company.CompanyID, Name: "Decision"})
	if err != nil {
		t.Fatal(err)
	}
	ordinaryEntity, err := repo.CreateEntity(EntityInput{CompanyID: company.CompanyID, EntityTypeID: ordinaryType.EntityTypeID, Name: "Ordinary"})
	if err != nil {
		t.Fatal(err)
	}
	localActionItem, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Local but unmarked", CreatedByUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	otherUser, otherCompany := createActionItemTestCompany(t, repo, "action-item-sync-other-company")
	otherActionItem, err := repo.CreateActionItem(ActionItemInput{CompanyID: otherCompany.CompanyID, BodyText: "Other company", CreatedByUserID: otherUser.UserID})
	if err != nil {
		t.Fatal(err)
	}
	ref := createActionItemEditorTestTextbox(t, repo, company.CompanyID, node.HuddleNodeID, "Validation")
	commitActionItemEditorTestDocument(t, repo, ref, user.UserID, 0, "invalid-reference-types",
		actionItemEditorReference{EntityID: ordinaryEntity.EntityID, ActionItem: true},
		actionItemEditorReference{EntityID: otherActionItem.EntityID, ActionItem: true},
		actionItemEditorReference{EntityID: localActionItem.EntityID},
	)
	expectedKey := entityRelationshipKey(company.CompanyID, localActionItem.EntityID, EntityTypeHuddleNode, node.HuddleNodeID)
	if len(repo.entityRelationships) != 1 {
		t.Fatalf("saved reference relationships=%+v, want only the exact local Action Item", repo.entityRelationships)
	}
	if _, exists := repo.entityRelationships[expectedKey]; !exists {
		t.Fatalf("an Action Item reference with actionItem=false did not roll up: %+v", repo.entityRelationships)
	}
}

func TestMemoryActionItemSourceCreationIsExactAtomicAndAuthorized(t *testing.T) {
	repo := NewMemoryRepo()
	owner, company := createActionItemTestCompany(t, repo, "action-item-source-owner")
	member, err := repo.UpsertAuthUser("action-item-source-member", "source-member@example.com", "Source Member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	sourceNode, err := repo.CreateNode(company.CompanyID, "Canonical source")
	if err != nil {
		t.Fatal(err)
	}

	created, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Created from source", CreatedByUserID: member.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: sourceNode.NodeID,
	})
	if err != nil {
		t.Fatalf("authorized source creation: %v", err)
	}
	source, err := repo.GetActionItemSource(company.CompanyID, created.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if source.CompanyID != company.CompanyID || source.EntityID != created.EntityID || source.ResourceType != EntityTypeNode || source.ResourceID != sourceNode.NodeID {
		t.Fatalf("stored source = %+v, want exact company/type/ID", source)
	}
	for _, field := range created.EntityFields {
		if field.SystemKey != ActionItemSourceSystemKey {
			continue
		}
		if _, err := repo.UpdateEntityField(EntityFieldInput{
			CompanyID: company.CompanyID, EntityID: created.EntityID, EntityFieldID: field.EntityFieldID,
			Value: field.Value, ValueSet: true,
		}); !errors.Is(err, ErrConflict) {
			t.Fatalf("same-value Source API update error=%v, want ErrConflict", err)
		}
		break
	}
	staleRecycleID := newUUIDv7String()
	repo.mu.Lock()
	repo.recycleBin[key(company.CompanyID, staleRecycleID)] = memoryRecycleBinItem{
		Item: domain.RecycleBinItem{
			CompanyID: company.CompanyID, RecycleBinItemID: staleRecycleID,
			ObjectKind: EntityTypeNode, ObjectID: sourceNode.NodeID, DeletedByUserID: member.UserID,
		},
		Delta:    memoryRecycleBinSnapshot{nodes: map[string]domain.Node{key(company.CompanyID, sourceNode.NodeID): sourceNode}},
		UseDelta: true,
	}
	repo.mu.Unlock()
	if err := repo.PermanentlyDeleteRecycleBinItems(company.CompanyID, member.UserID, []string{staleRecycleID}); err != nil {
		t.Fatal(err)
	}
	if preserved, err := repo.GetActionItemSource(company.CompanyID, created.EntityID); err != nil || preserved.ResourceID != sourceNode.NodeID {
		t.Fatalf("live Source after stale recycle deletion=%+v err=%v, want preserved", preserved, err)
	}
	direct, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Direct", CreatedByUserID: member.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetActionItemSource(company.CompanyID, direct.EntityID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("direct Action Item source error = %v, want ErrNotFound", err)
	}

	assertRejectedAtomically := func(name string, input ActionItemInput, want error) {
		t.Helper()
		repo.mu.RLock()
		entityCount, fieldCount := len(repo.entities), len(repo.entityFields)
		repo.mu.RUnlock()
		if _, err := repo.CreateActionItem(input); !errors.Is(err, want) {
			t.Fatalf("%s error = %v, want %v", name, err, want)
		}
		repo.mu.RLock()
		defer repo.mu.RUnlock()
		if len(repo.entities) != entityCount || len(repo.entityFields) != fieldCount {
			t.Fatalf("%s partially wrote entity/fields: entities %d->%d fields %d->%d", name, entityCount, len(repo.entities), fieldCount, len(repo.entityFields))
		}
	}

	missingID := "91919191-9191-4191-8191-919191919191"
	assertRejectedAtomically("missing endpoint", ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Missing", CreatedByUserID: member.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: missingID,
	}, ErrNotFound)

	otherCompany := repo.EnsureCompany("92929292-9292-4292-8292-929292929292", "Other source company")
	otherNode, err := repo.CreateNode(otherCompany.CompanyID, "Other company source")
	if err != nil {
		t.Fatal(err)
	}
	assertRejectedAtomically("cross-company endpoint", ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Cross company", CreatedByUserID: member.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: otherNode.NodeID,
	}, ErrNotFound)
	assertRejectedAtomically("unsupported type", ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Unsupported", CreatedByUserID: member.UserID,
		SourceResourceType: "entity", SourceResourceID: sourceNode.NodeID,
	}, ErrInvalid)

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: company.CompanyID, EntityType: EntityTypeNode, EntityID: sourceNode.NodeID,
		DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	assertRejectedAtomically("unauthorized endpoint", ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Unauthorized", CreatedByUserID: member.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: sourceNode.NodeID,
	}, ErrNotFound)
}

func TestPostgresVisibleActionItemSourcesUseOneBatchedPermissionProjection(t *testing.T) {
	raw, err := os.ReadFile("postgres_action_items.go")
	if err != nil {
		t.Fatal(err)
	}
	body := extractFunctionSourceForTest(t, string(raw), "func (r *PostgresRepo) ListVisibleActionItemSources")
	for _, required := range []string{
		"field.entity_id::text=any($2::text[])",
		"myWorkViewerPermissionCTE",
		`myWorkPermissionAccessCTEs("action_source_access_targets", "action_source")`,
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("batched visible Source projection missing %q", required)
		}
	}
	if strings.Count(body, ".QueryContext(") != 1 || strings.Contains(body, "GetActionItemSource(") || strings.Contains(body, "mangorts_user_can_access_resource") {
		t.Fatalf("visible Source projection must use one set-based permission query:\n%s", body)
	}
}

func TestMemoryActionItemSourceRecycleRestoreAndPermanentDelete(t *testing.T) {
	repo := NewMemoryRepo()
	actor, company := createActionItemTestCompany(t, repo, "action-item-source-lifecycle")
	node, err := repo.CreateNode(company.CompanyID, "Restorable Source")
	if err != nil {
		t.Fatal(err)
	}
	item, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Source lifecycle", CreatedByUserID: actor.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: node.NodeID,
	})
	if err != nil {
		t.Fatal(err)
	}

	deleteNode := func() string {
		t.Helper()
		if _, err := repo.DeleteCompanyExplorerTargets(company.CompanyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeNode, ID: node.NodeID}}, actor.UserID); err != nil {
			t.Fatal(err)
		}
		items, err := repo.ListRecycleBinItems(company.CompanyID, actor.UserID)
		if err != nil {
			t.Fatal(err)
		}
		for _, recycled := range items {
			if recycled.ObjectKind == EntityTypeNode && recycled.ObjectID == node.NodeID {
				return recycled.RecycleBinItemID
			}
		}
		t.Fatal("recycled Source endpoint is missing")
		return ""
	}

	firstRecycleID := deleteNode()
	if source, err := repo.GetActionItemSource(company.CompanyID, item.EntityID); err != nil || source.ResourceID != node.NodeID {
		t.Fatalf("preserved recycled Source=%+v err=%v", source, err)
	}
	var statusField domain.EntityField
	for _, field := range item.EntityFields {
		if field.SystemKey == ActionItemStatusSystemKey {
			statusField = field
			break
		}
	}
	if statusField.EntityFieldID == "" {
		t.Fatal("Action Item status field is missing")
	}
	if _, err := repo.UpdateEntityField(EntityFieldInput{
		CompanyID: company.CompanyID, EntityID: item.EntityID, EntityFieldID: statusField.EntityFieldID,
		Value: json.RawMessage(`"pending"`), ValueSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{firstRecycleID}); err != nil {
		t.Fatal(err)
	}
	restored, err := repo.GetEntity(company.CompanyID, item.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	assertActionItemFieldValue(t, restored, ActionItemStatusSystemKey, `"pending"`)
	if source, err := repo.GetActionItemSource(company.CompanyID, item.EntityID); err != nil || source.ResourceID != node.NodeID {
		t.Fatalf("restored Source=%+v err=%v", source, err)
	}

	secondRecycleID := deleteNode()
	if err := repo.PermanentlyDeleteRecycleBinItems(company.CompanyID, actor.UserID, []string{secondRecycleID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetActionItemSource(company.CompanyID, item.EntityID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Source after permanent endpoint deletion error=%v, want ErrNotFound", err)
	}
}

func TestActionItemDefaultsAndLiveTemplateConfig(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "action-item-defaults")

	generic, err := repo.CreateEntity(EntityInput{
		CompanyID: company.CompanyID, EntityTypeID: ActionItemEntityTypeID, Name: "Created from Entities",
		CreatedByUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("generic CreateEntity action item: %v", err)
	}
	assertActionItemFieldValue(t, generic, ActionItemStatusSystemKey, `"in_progress"`)
	assertActionItemFieldValue(t, generic, ActionItemColorSystemKey, "null")
	if err := repo.DeleteEntity(company.CompanyID, generic.EntityID); !errors.Is(err, ErrConflict) {
		t.Fatalf("Action Item hard delete error=%v, want ErrConflict", err)
	}
	if _, err := repo.GetEntity(company.CompanyID, generic.EntityID); err != nil {
		t.Fatalf("Action Item changed after rejected hard delete: %v", err)
	}

	statusTemplate, ok := actionItemTemplateBySystemKey(t, repo, company.CompanyID, ActionItemStatusSystemKey)
	if !ok {
		t.Fatal("status template missing")
	}
	invalidStatusConfig := json.RawMessage(`{"default":"in_progress","options":[{"key":"in_progress","label":"In progress"},{"key":"pending","label":"Pending"}]}`)
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityFieldTypeID: statusTemplate.EntityFieldTypeID, Config: invalidStatusConfig, ConfigSet: true}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("removing required status key error=%v, want ErrInvalid", err)
	}
	extraStatusConfig := json.RawMessage(`{"default":"in_progress","options":[{"key":"in_progress","label":"In progress"},{"key":"pending","label":"Pending"},{"key":"done","label":"Done"},{"key":"blocked","label":"Blocked"}]}`)
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityFieldTypeID: statusTemplate.EntityFieldTypeID, Config: extraStatusConfig, ConfigSet: true}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("extra required status key error=%v, want ErrInvalid", err)
	}
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityFieldTypeID: statusTemplate.EntityFieldTypeID, Name: "State", NameSet: true}); !errors.Is(err, ErrConflict) {
		t.Fatalf("required label update error=%v, want ErrConflict", err)
	}
	actionFolder, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: company.CompanyID, EntityTypeID: ActionItemEntityTypeID, Name: "Escalations"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityTypeID: ActionItemEntityTypeID, EntityFolderID: &actionFolder.EntityFolderID, Name: "status", FieldType: EntityFieldTypeText}); !errors.Is(err, ErrConflict) {
		t.Fatalf("shadowed required field create error=%v, want ErrConflict", err)
	}
	actionCustomTemplate, err := repo.CreateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityTypeID: ActionItemEntityTypeID, EntityFolderID: &actionFolder.EntityFolderID, Name: "Escalation note", FieldType: EntityFieldTypeText})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityFieldTypeID: actionCustomTemplate.EntityFieldTypeID, Name: "Color", NameSet: true}); !errors.Is(err, ErrConflict) {
		t.Fatalf("shadowed required field update error=%v, want ErrConflict", err)
	}

	customType, err := repo.CreateEntityType(EntityTypeInput{CompanyID: company.CompanyID, Name: "Decision"})
	if err != nil {
		t.Fatal(err)
	}
	choiceTemplate, err := repo.CreateEntityFieldType(EntityFieldTypeInput{
		CompanyID: company.CompanyID, EntityTypeID: customType.EntityTypeID, Name: "Outcome", FieldType: EntityFieldTypeChoice,
		Config: json.RawMessage(`{"default":"open","options":[{"key":"open","label":"Open"},{"key":"closed","label":"Closed"}]}`), ConfigSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	decision, err := repo.CreateEntity(EntityInput{CompanyID: company.CompanyID, EntityTypeID: customType.EntityTypeID, Name: "Choose"})
	if err != nil {
		t.Fatal(err)
	}
	if len(decision.EntityFields) != 1 || string(decision.EntityFields[0].Value) != `"open"` {
		t.Fatalf("choice default fields=%+v", decision.EntityFields)
	}
	if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: company.CompanyID, EntityID: decision.EntityID, EntityFieldID: decision.EntityFields[0].EntityFieldID, Value: json.RawMessage(`"closed"`), ValueSet: true}); err != nil {
		t.Fatal(err)
	}
	updatedTemplate, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{
		CompanyID: company.CompanyID, EntityFieldTypeID: choiceTemplate.EntityFieldTypeID,
		Config: json.RawMessage(`{"default":"open","options":[{"key":"open","label":"Still open"}]}`), ConfigSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	current, err := repo.GetEntity(company.CompanyID, decision.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if string(current.EntityFields[0].Value) != `"open"` || string(current.EntityFields[0].Config) != string(updatedTemplate.Config) {
		t.Fatalf("live choice field=%+v template=%+v", current.EntityFields[0], updatedTemplate)
	}
	secondDecision, err := repo.CreateEntity(EntityInput{CompanyID: company.CompanyID, EntityTypeID: customType.EntityTypeID, Name: "Choose again"})
	if err != nil {
		t.Fatal(err)
	}
	retypedField, err := repo.UpdateEntityField(EntityFieldInput{
		CompanyID: company.CompanyID, EntityID: secondDecision.EntityID, EntityFieldID: secondDecision.EntityFields[0].EntityFieldID,
		FieldType: EntityFieldTypeText, FieldTypeSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if retypedField.EntityFieldTypeID != nil || retypedField.SystemKey != "" || string(retypedField.Config) != `{}` {
		t.Fatalf("retyped copied field retained template link: %+v", retypedField)
	}
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{
		CompanyID: company.CompanyID, EntityFieldTypeID: choiceTemplate.EntityFieldTypeID,
		FieldType: EntityFieldTypeText, FieldTypeSet: true, Config: json.RawMessage(`{}`), ConfigSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	current, err = repo.GetEntity(company.CompanyID, decision.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if current.EntityFields[0].EntityFieldTypeID != nil || current.EntityFields[0].FieldType != EntityFieldTypeChoice || string(current.EntityFields[0].Value) != `"open"` || string(current.EntityFields[0].Config) != `{}` {
		t.Fatalf("template retype changed copied field instead of detaching it: %+v", current.EntityFields[0])
	}
	if _, err := repo.CreateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityTypeID: customType.EntityTypeID, Name: "Status", FieldType: EntityFieldTypeText}); err != nil {
		t.Fatalf("ordinary Entity Type reserved-looking field: %v", err)
	}
}

func TestMemoryEnsureCompanyProvisionsActionItemDefaults(t *testing.T) {
	repo := NewMemoryRepo()
	company := repo.EnsureCompany("71717171-7171-4171-8171-717171717171", "Bootstrap")
	if company.CompanyID == "" {
		t.Fatal("EnsureCompany failed")
	}
	if current, exists := repo.entityTypes[key(company.CompanyID, ActionItemEntityTypeID)]; !exists || current.SystemKey != ActionItemEntityTypeSystemKey {
		t.Fatalf("EnsureCompany Action Item type=%+v exists=%v", current, exists)
	}
	if err := repo.verifyActionItemDefaultsLocked(company.CompanyID); err != nil {
		t.Fatalf("EnsureCompany Action Item defaults: %v", err)
	}
	user, err := repo.UpsertAuthUser("bootstrap-action-item", "bootstrap@example.com", "Bootstrap")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("bootstrap-action-item", company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Bootstrapped action", CreatedByUserID: user.UserID}); err != nil {
		t.Fatalf("CreateActionItem after EnsureCompany: %v", err)
	}
}

func TestMemoryMembershipDeletionClearsActionItemPersonAndCreatorAtomically(t *testing.T) {
	repo := NewMemoryRepo()
	companyA := repo.EnsureCompany("81818181-8181-4181-8181-818181818181", "Company A")
	companyB := repo.EnsureCompany("82828282-8282-4282-8282-828282828282", "Company B")
	user, err := repo.UpsertAuthUser("action-item-member-cleanup", "cleanup@example.com", "Cleanup")
	if err != nil {
		t.Fatal(err)
	}
	for _, company := range []domain.Company{companyA, companyB} {
		if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
	}
	personValue, _ := json.Marshal(user.UserID)
	createAssigned := func(companyID string) domain.Entity {
		item, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, BodyText: "Assigned work", CreatedByUserID: user.UserID})
		if err != nil {
			t.Fatal(err)
		}
		updated := 0
		for _, field := range item.EntityFields {
			if field.SystemKey != ActionItemPersonInChargeSystemKey && field.SystemKey != ActionItemAssignedBySystemKey {
				continue
			}
			if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: companyID, EntityID: item.EntityID, EntityFieldID: field.EntityFieldID, Value: personValue, ValueSet: true}); err != nil {
				t.Fatal(err)
			}
			updated++
		}
		if updated != 2 {
			t.Fatalf("updated person fields=%d, want Person in charge and Assigned by", updated)
		}
		current, err := repo.GetEntity(companyID, item.EntityID)
		if err != nil {
			t.Fatal(err)
		}
		return current
	}
	itemA := createAssigned(companyA.CompanyID)
	itemB := createAssigned(companyB.CompanyID)

	forced := errors.New("forced membership cleanup rollback")
	repo.domainEventAppendErr = forced
	if _, err := repo.DeleteCompanyUser(companyA.CompanyID, user.UserID, false); !errors.Is(err, forced) {
		t.Fatalf("failed membership deletion error=%v, want %v", err, forced)
	}
	repo.domainEventAppendErr = nil
	rolledBack, err := repo.GetEntity(companyA.CompanyID, itemA.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if rolledBack.CreatedByUserID != user.UserID {
		t.Fatalf("rolled-back creator=%q, want %q", rolledBack.CreatedByUserID, user.UserID)
	}
	assertActionItemFieldValue(t, rolledBack, ActionItemPersonInChargeSystemKey, `"`+user.UserID+`"`)
	assertActionItemFieldValue(t, rolledBack, ActionItemAssignedBySystemKey, `"`+user.UserID+`"`)

	if _, err := repo.DeleteCompanyUser(companyA.CompanyID, user.UserID, false); err != nil {
		t.Fatal(err)
	}
	cleared, err := repo.GetEntity(companyA.CompanyID, itemA.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if cleared.CreatedByUserID != "" {
		t.Fatalf("deleted-company creator=%q, want empty", cleared.CreatedByUserID)
	}
	assertActionItemFieldValue(t, cleared, ActionItemPersonInChargeSystemKey, "null")
	assertActionItemFieldValue(t, cleared, ActionItemAssignedBySystemKey, "null")
	untouched, err := repo.GetEntity(companyB.CompanyID, itemB.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if untouched.CreatedByUserID != user.UserID {
		t.Fatalf("other-company creator=%q, want %q", untouched.CreatedByUserID, user.UserID)
	}
	assertActionItemFieldValue(t, untouched, ActionItemPersonInChargeSystemKey, `"`+user.UserID+`"`)
	assertActionItemFieldValue(t, untouched, ActionItemAssignedBySystemKey, `"`+user.UserID+`"`)
}

func createActionItemTestCompany(t *testing.T, repo *MemoryRepo, subject string) (domain.User, domain.Company) {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Action Item Test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	return user, company
}

func assertActionItemFieldValue(t *testing.T, entity domain.Entity, systemKey, expected string) {
	t.Helper()
	for _, field := range entity.EntityFields {
		if field.SystemKey == systemKey {
			actual := string(field.Value)
			if actual == "" {
				actual = "null"
			}
			actual = canonicalJSONForActionItemFieldTest(t, actual)
			expected = canonicalJSONForActionItemFieldTest(t, expected)
			if actual != expected {
				t.Fatalf("field %s value=%s, want %s", systemKey, actual, expected)
			}
			return
		}
	}
	t.Fatalf("field %s missing from %+v", systemKey, entity.EntityFields)
}

func canonicalJSONForActionItemFieldTest(t *testing.T, raw string) string {
	t.Helper()
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		t.Fatalf("invalid test JSON %q: %v", raw, err)
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(canonical)
}

func actionItemTemplateBySystemKey(t *testing.T, repo *MemoryRepo, companyID, systemKey string) (domain.EntityFieldType, bool) {
	t.Helper()
	items, err := repo.ListEntityFieldTypes(companyID, ActionItemEntityTypeID)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.SystemKey == systemKey {
			return item, true
		}
	}
	return domain.EntityFieldType{}, false
}

func actionItemTestStringPointer(value string) *string { return &value }
