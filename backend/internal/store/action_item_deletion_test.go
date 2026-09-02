package store

import (
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryActionItemDeletionCleansReferencesAndPreservesHuddleRestore(t *testing.T) {
	repo := NewMemoryRepo()
	testActionItemDeletionLifecycle(t, repo, func(companyID, entityID string) {
		for _, field := range repo.entityFields {
			if field.CompanyID == companyID && field.EntityID == entityID {
				t.Fatal("deleted Action Item retained a field")
			}
		}
		for _, relationship := range repo.entityRelationships {
			if relationship.CompanyID == companyID && relationship.EntityID == entityID {
				t.Fatal("deleted Action Item retained a relationship")
			}
		}
	})
}

func TestPostgresActionItemDeletionCleansReferencesAndPreservesHuddleRestore(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	testActionItemDeletionLifecycle(t, repo, func(companyID, entityID string) {
		for _, table := range []string{"entity_fields", "entity_relationships"} {
			if got := countPostgresRows(t, db, "select count(*) from "+table+" where company_id=$1::uuid and entity_id=$2::uuid", companyID, entityID); got != 0 {
				t.Fatalf("deleted Action Item retained %d rows in %s", got, table)
			}
		}
	})
}

func testActionItemDeletionLifecycle(t *testing.T, repo Repository, assertNoReferences func(string, string)) {
	t.Helper()
	actor, err := repo.UpsertAuthUser("action-item-deletion", "action-item-deletion@example.test", "Action Item owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Action Item deletion")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	board, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: company.CompanyID, Name: "Board", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: "Meeting", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	deleted, err := repo.CreateActionItem(ActionItemInput{AnalysisDueDate: "2026-08-01",
		CompanyID: company.CompanyID, BodyText: "Delete this item", CreatedByUserID: actor.UserID,
		CompletionDueDate: "2026-09-04", SourceResourceType: EntityTypeHuddleNode, SourceResourceID: node.HuddleNodeID,
	})
	if err != nil {
		t.Fatal(err)
	}
	survivor, err := repo.CreateActionItem(ActionItemInput{AnalysisDueDate: "2026-08-01",
		CompanyID: company.CompanyID, BodyText: "Keep this item", CreatedByUserID: actor.UserID, CompletionDueDate: "2026-09-05",
	})
	if err != nil {
		t.Fatal(err)
	}
	boardRef := EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeHuddleLogicGate, ResourceID: board.HuddleLogicGateID, DocumentID: board.HuddleLogicGateID}
	commitActionItemEditorTestDocument(t, repo, boardRef, actor.UserID, 0, "board-items", actionItemEditorReference{EntityID: deleted.EntityID}, actionItemEditorReference{EntityID: survivor.EntityID})
	nodeRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, node.HuddleNodeID, "Meeting items")
	commitActionItemEditorTestDocument(t, repo, nodeRef, actor.UserID, 0, "node-items", actionItemEditorReference{EntityID: deleted.EntityID}, actionItemEditorReference{EntityID: survivor.EntityID})
	if err := repo.DeleteHuddleNode(company.CompanyID, node.HuddleNodeID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	recycled, err := repo.ListRecycleBinItems(company.CompanyID, actor.UserID)
	if err != nil || len(recycled) != 1 {
		t.Fatalf("recycled Huddle Node = %+v, err=%v", recycled, err)
	}
	if err := repo.DeleteEntity("99999999-9999-4999-8999-999999999999", deleted.EntityID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-company deletion = %v, want not found", err)
	}
	if _, err := repo.GetEntity(company.CompanyID, deleted.EntityID); err != nil {
		t.Fatalf("cross-company deletion changed Action Item: %v", err)
	}
	if memory, ok := repo.(*MemoryRepo); ok {
		resetHuddleActionItemRealtimeForTest(memory)
	}
	if err := repo.DeleteEntity(company.CompanyID, deleted.EntityID); err != nil {
		t.Fatal(err)
	}
	if memory, ok := repo.(*MemoryRepo); ok {
		assertHuddleActionItemRealtimeScopes(t, memory, company.CompanyID, board.HuddleLogicGateID)
	}
	if _, err := repo.GetEntity(company.CompanyID, deleted.EntityID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted Action Item lookup = %v, want not found", err)
	}
	assertNoReferences(company.CompanyID, deleted.EntityID)
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{recycled[0].RecycleBinItemID}); err != nil {
		t.Fatalf("restore Huddle Node after deleting its referenced Action Item: %v", err)
	}
	assertNoReferences(company.CompanyID, deleted.EntityID)
	items, err := repo.ListHuddleLogicGateActionItems(company.CompanyID, board.HuddleLogicGateID)
	if err != nil || len(items) != 1 || items[0].EntityID != survivor.EntityID {
		t.Fatalf("Board rollup after delete/restore = %+v, err=%v", items, err)
	}
	if _, err := repo.GetHuddleNode(company.CompanyID, node.HuddleNodeID); err != nil {
		t.Fatalf("Action Item deletion prevented restoring its source Node: %v", err)
	}
	if _, err := repo.GetEntity(company.CompanyID, survivor.EntityID); err != nil {
		t.Fatalf("Action Item deletion removed the other item: %v", err)
	}
}
