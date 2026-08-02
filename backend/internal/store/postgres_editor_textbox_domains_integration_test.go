package store

import (
	"encoding/json"
	"testing"
)

func TestPostgresRealtimeProjectAndLogicGateJSONUsePermanentTextboxTables(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Owner-specific editor JSON proof")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })

	actor, err := repo.UpsertAuthUser("owner-json-proof", "owner-json-proof@example.test", "Owner JSON Proof")
	if err != nil {
		t.Fatal(err)
	}
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: company.CompanyID, Name: "Owner JSON Project", Status: "Not started",
		Health: "On track", ActorUserID: actor.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(company.CompanyID, "Owner JSON Logic Gate")
	if err != nil {
		t.Fatal(err)
	}

	document := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Owner table text"}]}]}}`)
	cases := []struct {
		name, resourceType, resourceID, documentID, currentTable, ownerColumn string
	}{
		{"project", EntityTypeProject, projectResult.Project.ProjectID, "00000000-0000-4000-8000-000000000201", "project_textboxes", "project_id"},
		{"logic gate", EntityTypeLogicGate, logicGate.LogicGateID, "00000000-0000-4000-8000-000000000202", "logic_gate_textboxes", "logic_gate_id"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ref := EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: tc.resourceType, ResourceID: tc.resourceID, DocumentID: tc.documentID}
			input := EditorJSONCommitInput{
				Document: ref, OperationID: tc.name + "-operation", ClientID: "owner-json-client",
				ActorUserID: actor.UserID, BaseRevision: 0, SchemaVersion: 1,
				JSONDocument: document, Annotations: []EditorJSONAnnotation{{ID: "owner-comment", Kind: "comment", From: 1, To: 5}},
			}
			commit, err := repo.CommitEditorJSONDocument(input)
			if err != nil || commit.Revision != 1 {
				t.Fatalf("commit=%+v err=%v", commit, err)
			}
			duplicate, err := repo.CommitEditorJSONDocument(input)
			if err != nil || !duplicate.Deduplicated || duplicate.EventID != commit.EventID {
				t.Fatalf("duplicate=%+v err=%v", duplicate, err)
			}
			snapshot, err := repo.GetEditorJSONSnapshot(ref)
			if err != nil || snapshot.Revision != 1 || len(snapshot.Annotations) != 1 {
				t.Fatalf("snapshot=%+v err=%v", snapshot, err)
			}
			versions, err := repo.ListEditorJSONVersions(ref, 10)
			if err != nil || len(versions) != 0 {
				t.Fatalf("versions=%+v err=%v", versions, err)
			}
			query := "select count(*) from " + tc.currentTable + " where company_id=$1::uuid and " + tc.ownerColumn + "=$2::uuid and textbox_id=$3"
			if got := countPostgresRows(t, db, query, company.CompanyID, tc.resourceID, tc.documentID); got != 1 {
				t.Fatalf("permanent textbox rows=%d, want 1", got)
			}
			deleteInput := EditorJSONDeleteInput{
				Document: ref, OperationID: tc.name + "-delete", ClientID: "owner-json-client",
				ActorUserID: actor.UserID, BaseRevision: 1,
			}
			deleted, err := repo.DeleteEditorJSONDocument(deleteInput)
			if err != nil || deleted.Revision != 2 {
				t.Fatalf("delete=%+v err=%v", deleted, err)
			}
			duplicateDelete, err := repo.DeleteEditorJSONDocument(deleteInput)
			if err != nil || !duplicateDelete.Deduplicated || duplicateDelete.EventID != deleted.EventID {
				t.Fatalf("duplicate delete=%+v err=%v", duplicateDelete, err)
			}
			deletedSnapshot, err := repo.GetEditorJSONSnapshot(ref)
			if err != nil || !deletedSnapshot.Deleted || deletedSnapshot.Revision != 2 {
				t.Fatalf("deleted snapshot=%+v err=%v", deletedSnapshot, err)
			}
		})
	}
}
