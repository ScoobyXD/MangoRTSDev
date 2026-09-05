package store

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMemoryLogicGateSOPProjectsNewestLiveCanonicalTextboxWithoutMetadata(t *testing.T) {
	repo := NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	process, err := repo.CreateLogicGate(companyID, "SOP projection")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.SetEditorDataFormatForTests(EditorDataFormatGate{
		CompanyID: companyID, EditorFormat: EditorFormatTiptapJSON,
		MigrationState: EditorMigrationReady, DocumentSchemaVersion: MangoTiptapSchemaVersion,
	}); err != nil {
		t.Fatal(err)
	}
	first := EditorJSONDocumentRef{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: process.LogicGateID,
		DocumentID: "22222222-2222-4222-8222-222222222222",
	}
	second := first
	second.DocumentID = "33333333-3333-4333-8333-333333333333"
	commit := func(ref EditorJSONDocumentRef, operation string, revision int64, text string) EditorJSONCommit {
		t.Helper()
		document := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + text + `"}]}]}}`)
		saved, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
			Document: ref, OperationID: operation, ClientID: "sop-test", BaseRevision: revision,
			SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
		})
		if err != nil {
			t.Fatal(err)
		}
		return saved
	}
	assertSOP := func(ref EditorJSONDocumentRef, saved EditorJSONCommit, title string) {
		t.Helper()
		items, err := repo.ListLogicGateProjections(companyID, process.LogicGateID)
		if err != nil {
			t.Fatal(err)
		}
		if len(items) != 1 {
			t.Fatalf("SOP projections = %+v, want one live canonical textbox", items)
		}
		item := items[0]
		if item.CompanyID != companyID || item.LogicGateID != process.LogicGateID || item.InformationID != ref.DocumentID || item.Type != "Text box" || item.IsDeleted || item.Revision != saved.Revision {
			t.Fatalf("SOP projection = %+v, want live textbox %s revision %d", item, ref.DocumentID, saved.Revision)
		}
		var payload struct {
			Title    string `json:"title"`
			Document string `json:"document"`
		}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(item.Information, editorTextBlockProjectionPrefix)), &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Document != string(saved.JSONDocument) || payload.Title != title {
			t.Fatalf("SOP payload = %+v, want canonical body and title %q", payload, title)
		}
	}

	firstSave := commit(first, "first", 0, "First SOP")
	assertSOP(first, firstSave, "")
	secondSave := commit(second, "second", 0, "Second SOP")
	assertSOP(second, secondSave, "")

	if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: process.LogicGateID, DocumentID: first.DocumentID},
		Title:    "Process instructions",
	}); err != nil {
		t.Fatal(err)
	}
	assertSOP(first, firstSave, "Process instructions")
	firstSave = commit(first, "first-updated", firstSave.Revision, "Current SOP")
	assertSOP(first, firstSave, "Process instructions")

	if _, err := repo.DeleteEditorJSONDocument(EditorJSONDeleteInput{
		Document: first, OperationID: "delete-first", ClientID: "sop-test", BaseRevision: firstSave.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	assertSOP(second, secondSave, "")
	if _, err := repo.DeleteEditorJSONDocument(EditorJSONDeleteInput{
		Document: second, OperationID: "delete-second", ClientID: "sop-test", BaseRevision: secondSave.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListLogicGateProjections(companyID, process.LogicGateID)
	if err != nil || len(items) != 0 {
		t.Fatalf("deleted SOP projections = %+v, error = %v; want none", items, err)
	}
}
