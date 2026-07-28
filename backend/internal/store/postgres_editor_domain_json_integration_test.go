package store

import (
	"encoding/json"
	"testing"
)

func TestPostgresRealtimeActiveProjectAndLogicGateJSONUseOwnerTables(t *testing.T) {
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

	var runID string
	if err := db.QueryRow(`insert into editor_conversion_runs(
		conversion_run_id,company_id,owner_type,mode,status,batch_size,source_snapshot_timestamp,
		backup_reference,expected_count,converted_count,started_timestamp,completed_timestamp
	) values(gen_random_uuid(),$1::uuid,'all','backfill','completed',100,now(),'disposable owner routing proof',0,0,now(),now())
	returning conversion_run_id::text`, company.CompanyID).Scan(&runID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into editor_rollout_gates(
		company_id,owner_type,rollout_state,validation_run_id,validated_timestamp,activated_timestamp
	) select $1::uuid,owner_type,'active',$2::uuid,now(),now()
	from unnest(array['node','project','logic_gate']) owner_type`, company.CompanyID, runID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into workspace_editor_formats(
		company_id,editor_format,migration_state,expected_document_count,converted_document_count,
		validated_timestamp,cutover_timestamp
	) values($1::uuid,'tiptap_json','ready',0,0,now(),now())`, company.CompanyID); err != nil {
		t.Fatal(err)
	}

	document := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Owner table text"}]}]}}`)
	cases := []struct {
		name, resourceType, resourceID, documentID, currentTable, ownerColumn string
	}{
		{"project", EntityTypeProject, projectResult.Project.ProjectID, "00000000-0000-4000-8000-000000000201", "project_editor_documents", "project_id"},
		{"logic gate", EntityTypeLogicGate, logicGate.LogicGateID, "00000000-0000-4000-8000-000000000202", "logic_gate_editor_documents", "logic_gate_id"},
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
			if err != nil || len(versions) != 1 || versions[0].Revision != 1 {
				t.Fatalf("versions=%+v err=%v", versions, err)
			}
			if got := countPostgresRows(t, db, "select count(*) from editor_json_documents where company_id=$1::uuid and resource_type=$2 and resource_id=$3 and document_id=$4", company.CompanyID, tc.resourceType, tc.resourceID, tc.documentID); got != 0 {
				t.Fatalf("legacy generic current-document rows=%d, want 0", got)
			}
			var plainText string
			query := "select plain_text from " + tc.currentTable + " where company_id=$1::uuid and " + tc.ownerColumn + "=$2::uuid and document_id=$3"
			if err := db.QueryRow(query, company.CompanyID, tc.resourceID, tc.documentID).Scan(&plainText); err != nil || plainText != "Owner table text" {
				t.Fatalf("plain_text=%q err=%v", plainText, err)
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
