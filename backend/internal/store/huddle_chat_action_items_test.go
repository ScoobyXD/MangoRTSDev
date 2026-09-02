package store

import (
	"encoding/json"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryHuddleChatActionItemRelationships(t *testing.T) {
	testHuddleChatActionItemRelationships(t, NewMemoryRepo())
}

func TestPostgresHuddleChatActionItemRelationships(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	testHuddleChatActionItemRelationships(t, repo)
}

func testHuddleChatActionItemRelationships(t *testing.T, repo Repository) {
	t.Helper()
	actor, err := repo.UpsertAuthUser("huddle-chat-action-items", "huddle-chat-action-items@example.test", "Chat Owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Huddle Chat Action Items")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	board, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: company.CompanyID, Name: "Daily", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: "Monday", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	item, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Call the supplier", CreatedByUserID: actor.UserID,
		AnalysisDueDate: "2026-09-01", SourceResourceType: EntityTypeHuddleNode, SourceResourceID: node.HuddleNodeID,
	})
	if err != nil {
		t.Fatal(err)
	}
	otherCompany, err := repo.CreateCompany("Other Huddle Chat Company")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, otherCompany.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	foreignItem, err := repo.CreateActionItem(ActionItemInput{CompanyID: otherCompany.CompanyID, BodyText: "Other company", CreatedByUserID: actor.UserID, AnalysisDueDate: "2026-09-01"})
	if err != nil {
		t.Fatal(err)
	}
	firstRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, node.HuddleNodeID, "First notes")
	secondRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, node.HuddleNodeID, "Second notes")
	links, err := json.Marshal([]map[string]any{
		{"entity_type": "entity", "entity_id": item.EntityID, "start": 0, "end": 6},
		{"entity_type": "entity", "entity_id": item.EntityID, "start": 7, "end": 13},
		{"entity_type": "entity", "entity_id": foreignItem.EntityID, "start": 14, "end": 20},
		{"entity_type": "entity", "entity_id": "not-an-id"},
	})
	if err != nil {
		t.Fatal(err)
	}
	assertRollup := func(want int) {
		t.Helper()
		items, err := repo.ListHuddleLogicGateActionItems(company.CompanyID, board.HuddleLogicGateID)
		if err != nil || len(items) != want || (want == 1 && items[0].EntityID != item.EntityID) {
			t.Fatalf("rollup=%+v err=%v, want %d exact local Action Items", items, err, want)
		}
	}
	saveChat := func(ref EditorJSONDocumentRef, chatID, parentID string, revision *int64, entityLinks json.RawMessage) HuddleNodeTextboxChat {
		t.Helper()
		chat, err := repo.UpsertHuddleNodeTextboxChat(HuddleNodeTextboxChatInput{
			CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: ref.DocumentID,
			ChatID: chatID, ParentChatID: parentID, ActorUserID: actor.UserID, AuthorUserID: actor.UserID,
			Message: "Action action foreign", EntityLinks: entityLinks, ExpectedRevision: revision,
		})
		if err != nil {
			t.Fatal(err)
		}
		return chat
	}
	assertRollup(0)
	if memory, ok := repo.(*MemoryRepo); ok {
		resetHuddleActionItemRealtimeForTest(memory)
	}
	chat := saveChat(firstRef, newUUIDv7String(), "", nil, links)
	assertRollup(1)
	if memory, ok := repo.(*MemoryRepo); ok {
		assertHuddleActionItemRealtimeScopes(t, memory, company.CompanyID, board.HuddleLogicGateID, node.HuddleNodeID)
	}
	firstCommit := commitActionItemEditorTestDocument(t, repo, firstRef, actor.UserID, 0, "empty-document-keeps-chat")
	assertRollup(1)
	withEditor := commitActionItemEditorTestDocument(t, repo, firstRef, actor.UserID, firstCommit.Revision, "editor-and-chat", actionItemEditorReference{EntityID: item.EntityID})
	wrongType, _ := json.Marshal([]map[string]any{{"entity_type": "node", "entity_id": item.EntityID}})
	chat = saveChat(firstRef, chat.ChatID, "", &chat.Revision, wrongType)
	assertRollup(1)
	clearedEditor := commitActionItemEditorTestDocument(t, repo, firstRef, actor.UserID, withEditor.Revision, "final-editor-reference-removed")
	assertRollup(0)

	// Deleting a parent chat removes its replies, while another textbox keeps the edge.
	saveChat(firstRef, newUUIDv7String(), chat.ChatID, nil, links)
	saveChat(secondRef, newUUIDv7String(), "", nil, links)
	assertRollup(1)
	if err := repo.DeleteHuddleNodeTextboxChat(HuddleNodeTextboxChatDeleteInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, ChatID: chat.ChatID,
		ActorUserID: actor.UserID, ExpectedRevision: &chat.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	assertRollup(1)
	if _, err := repo.DeleteEditorJSONDocument(EditorJSONDeleteInput{
		Document: secondRef, OperationID: "delete-final-chat-textbox", ClientID: "action-item-test", ActorUserID: actor.UserID, BaseRevision: 0,
	}); err != nil {
		t.Fatal(err)
	}
	assertRollup(0)
	// A later document save cannot reintroduce a chat from the deleted textbox.
	commitActionItemEditorTestDocument(t, repo, firstRef, actor.UserID, clearedEditor.Revision, "save-after-chat-deletion")
	assertRollup(0)
	if _, err := repo.GetEntity(company.CompanyID, item.EntityID); err != nil {
		t.Fatalf("removing references deleted the Action Item: %v", err)
	}
	source, err := repo.GetActionItemSource(company.CompanyID, item.EntityID)
	if err != nil || source.ResourceType != EntityTypeHuddleNode || source.ResourceID != node.HuddleNodeID {
		t.Fatalf("chat changes rewrote Source: %+v err=%v", source, err)
	}
}
