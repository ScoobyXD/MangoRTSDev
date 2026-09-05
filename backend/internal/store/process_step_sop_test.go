package store

import (
	"encoding/json"
	"errors"
	"testing"
)

var processStepSOPBody = json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Check the invoice","marks":[{"type":"bold"}]}]}]},"annotations":[]}`)

func TestProcessStepSOPUsesCanonicalEditor(t *testing.T) {
	repo, companyID, _, _ := processStepsFixture(t)
	assertProcessStepSOPUsesCanonicalEditor(t, repo, companyID)
}

func TestPostgresProcessStepSOPUsesCanonicalEditor(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Step SOP")
	if err != nil {
		t.Fatal(err)
	}
	assertProcessStepSOPUsesCanonicalEditor(t, repo, company.CompanyID)
}

func assertProcessStepSOPUsesCanonicalEditor(t *testing.T, repo Repository, companyID string) {
	t.Helper()
	process, err := repo.CreateLogicGate(companyID, "Invoice SOP")
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: process.LogicGateID, Name: "Review", BodyJSON: processStepSOPBody})
	if err != nil {
		t.Fatal(err)
	}
	stepID := created.Step.ProcessStepID
	ref := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeProcessStep, ResourceID: stepID, DocumentID: stepID}
	wantDocument, _, err := decodeEditorTextboxBody(processStepSOPBody)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := repo.GetEditorJSONSnapshot(ref)
	if err != nil || snapshot.Revision != 0 || !editorJSONValuesEqual(snapshot.JSONDocument, wantDocument) {
		t.Fatalf("initial body was not in canonical editor: %+v %v", snapshot, err)
	}
	rename, position := "Review and send", 4000
	updated, err := repo.UpdateProcessStep(ProcessStepUpdateInput{CompanyID: companyID, LogicGateID: process.LogicGateID, ProcessStepID: stepID, Name: &rename, Position: &position})
	if err != nil || !editorJSONValuesEqual(updated.Step.BodyJSON, processStepSOPBody) || updated.Step.Revision != 0 {
		t.Fatalf("name/order change altered SOP: %+v %v", updated, err)
	}
	commit, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{Document: ref, OperationID: newUUIDv7String(), ClientID: "sop-test", BaseRevision: snapshot.Revision, SchemaVersion: 1, JSONDocument: emptyMangoTiptapDocument, Annotations: []EditorJSONAnnotation{}})
	if err != nil || commit.Revision != 1 {
		t.Fatalf("clear SOP: %+v %v", commit, err)
	}
	work, err := repo.GetLogicGateWork(companyID, process.LogicGateID, "")
	if err != nil || len(work.Steps) != 1 || !editorJSONValuesEqual(work.Steps[0].BodyJSON, emptyEditorTextboxBody()) || work.Steps[0].Revision != 1 || work.Steps[0].Name != rename || work.Steps[0].Position != position {
		t.Fatalf("work snapshot lost saved body or changed step: %+v %v", work, err)
	}
	if _, err := repo.DeleteEditorJSONDocument(EditorJSONDeleteInput{Document: ref, OperationID: newUUIDv7String(), ClientID: "sop-test", BaseRevision: 1}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("fixed step section accepted textbox deletion: %v", err)
	}
	if _, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: process.LogicGateID, Name: "Invalid", BodyJSON: json.RawMessage(`{"document":{"type":"doc"}}`)}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid SOP accepted: %v", err)
	}
	if _, err := repo.DeleteProcessStep(ProcessStepDeleteInput{CompanyID: companyID, LogicGateID: process.LogicGateID, ProcessStepID: stepID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetEditorJSONSnapshot(ref); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted step still has an editor: %v", err)
	}
	if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{Document: ref, OperationID: newUUIDv7String(), ClientID: "sop-test", BaseRevision: 1, SchemaVersion: 1, JSONDocument: wantDocument}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("late save recreated deleted step: %v", err)
	}
}

func TestProcessStepSOPMemoryDoesNotExposeMutableBody(t *testing.T) {
	repo, companyID, process, _ := processStepsFixture(t)
	created, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: process.LogicGateID, Name: "Review", BodyJSON: processStepSOPBody})
	if err != nil {
		t.Fatal(err)
	}
	created.Step.BodyJSON[0] = '!'
	step, err := repo.GetProcessStep(companyID, created.Step.ProcessStepID)
	if err != nil || !editorJSONValuesEqual(step.BodyJSON, processStepSOPBody) {
		t.Fatalf("caller mutated persisted body: %+v %v", step, err)
	}
	step.BodyJSON[0] = '!'
	work, err := repo.GetLogicGateWork(companyID, process.LogicGateID, "")
	if err != nil || !editorJSONValuesEqual(work.Steps[0].BodyJSON, processStepSOPBody) {
		t.Fatalf("read mutated persisted body: %+v %v", work, err)
	}
}
