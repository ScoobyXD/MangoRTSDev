package store

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestMemoryHuddleNodeRecycleRestoresEditorAndPreservesPostDeleteState(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	userID := "22222222-2222-4222-8222-222222222222"

	source, err := repo.CreateLogicGate(companyID, "Daily Huddle")
	if err != nil {
		t.Fatal(err)
	}
	huddle, err := repo.ConvertLogicGateToHuddle(companyID, source.LogicGateID, userID)
	if err != nil {
		t.Fatal(err)
	}
	monday, err := repo.CreateHuddleNode(HuddleCreateInput{
		CompanyID: companyID, OwnerID: huddle.HuddleLogicGateID, Name: "Monday", ActorID: userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	mondayTextbox, err := repo.CreateHuddleNodeTextbox(HuddleNodeTextboxCreateInput{
		CompanyID: companyID, HuddleNodeID: monday.HuddleNodeID, Title: "Meeting notes",
	})
	if err != nil {
		t.Fatal(err)
	}
	mondayRef := EditorJSONDocumentRef{
		CompanyID: companyID, ResourceType: EntityTypeHuddleNode,
		ResourceID: monday.HuddleNodeID, DocumentID: mondayTextbox.TextboxID,
	}
	mondayInput := EditorJSONCommitInput{
		Document: mondayRef, OperationID: "monday-body", ClientID: "recycle-test",
		ActorUserID: userID, BaseRevision: 0, SchemaVersion: MangoTiptapSchemaVersion,
		JSONDocument: json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Call Costco about mangoes"}]}]}}`),
	}
	mondayCommit, err := repo.CommitEditorJSONDocument(mondayInput)
	if err != nil {
		t.Fatal(err)
	}
	mondayDocumentKey := editorJSONMemoryKey(mondayRef)

	if err := repo.DeleteHuddleNode(companyID, monday.HuddleNodeID, userID); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.editorJSONDocuments[mondayDocumentKey]; exists {
		t.Fatal("deleted Huddle Node editor document still exists")
	}
	if _, exists := repo.editorJSONOperations[mondayDocumentKey]; exists {
		t.Fatal("deleted Huddle Node editor operations still exist")
	}
	if _, err := repo.GetEditorJSONSnapshot(mondayRef); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted Huddle Node editor snapshot error = %v, want ErrNotFound", err)
	}

	// This node and its body are created after Monday is deleted. Restoring Monday
	// must merge only Monday's deleted state instead of replacing the whole repo.
	tuesday, err := repo.CreateHuddleNode(HuddleCreateInput{
		CompanyID: companyID, OwnerID: huddle.HuddleLogicGateID, Name: "Tuesday", ActorID: userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	tuesdayTextbox, err := repo.CreateHuddleNodeTextbox(HuddleNodeTextboxCreateInput{
		CompanyID: companyID, HuddleNodeID: tuesday.HuddleNodeID, Title: "Tuesday notes",
	})
	if err != nil {
		t.Fatal(err)
	}
	tuesdayRef := EditorJSONDocumentRef{
		CompanyID: companyID, ResourceType: EntityTypeHuddleNode,
		ResourceID: tuesday.HuddleNodeID, DocumentID: tuesdayTextbox.TextboxID,
	}
	tuesdayCommit, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: tuesdayRef, OperationID: "tuesday-body", ClientID: "recycle-test",
		ActorUserID: userID, BaseRevision: 0, SchemaVersion: MangoTiptapSchemaVersion,
		JSONDocument: json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Keep Tuesday notes"}]}]}}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	recycleItems, err := repo.ListRecycleBinItems(companyID, userID)
	if err != nil {
		t.Fatal(err)
	}
	recycleItemID := ""
	for _, item := range recycleItems {
		if item.ObjectKind == "huddle_node" && item.ObjectID == monday.HuddleNodeID {
			recycleItemID = item.RecycleBinItemID
			break
		}
	}
	if recycleItemID == "" {
		t.Fatalf("Monday Huddle Node recycle item missing: %+v", recycleItems)
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, userID, []string{recycleItemID}); err != nil {
		t.Fatal(err)
	}

	if restoredTuesday, err := repo.GetHuddleNode(companyID, tuesday.HuddleNodeID); err != nil || restoredTuesday.Name != "Tuesday" {
		t.Fatalf("post-delete Huddle Node = %+v, err=%v", restoredTuesday, err)
	}
	restoredTuesdayBody, err := repo.GetEditorJSONSnapshot(tuesdayRef)
	if err != nil || string(restoredTuesdayBody.JSONDocument) != string(tuesdayCommit.JSONDocument) {
		t.Fatalf("post-delete editor body = %+v, err=%v", restoredTuesdayBody, err)
	}
	restoredMondayBody, err := repo.GetEditorJSONSnapshot(mondayRef)
	if err != nil || restoredMondayBody.Revision != mondayCommit.Revision || string(restoredMondayBody.JSONDocument) != string(mondayCommit.JSONDocument) {
		t.Fatalf("restored editor body = %+v, err=%v", restoredMondayBody, err)
	}
	if operations := repo.editorJSONOperations[mondayDocumentKey]; len(operations) != 1 || operations[0].OperationID != mondayInput.OperationID {
		t.Fatalf("restored editor operations = %+v", operations)
	}
	duplicate, err := repo.CommitEditorJSONDocument(mondayInput)
	if err != nil || !duplicate.Deduplicated || duplicate.Revision != mondayCommit.Revision {
		t.Fatalf("restored editor operation dedupe = %+v, err=%v", duplicate, err)
	}
}
