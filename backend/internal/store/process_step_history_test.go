package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func processHistoryDocument(text string) json.RawMessage {
	encoded, _ := json.Marshal(map[string]any{"format": "mango-tiptap-json", "schema_version": 1,
		"document": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}}}})
	return encoded
}

func saveProcessHistoryDocument(t *testing.T, repo Repository, ref EditorJSONDocumentRef, text string) EditorJSONCommit {
	t.Helper()
	snapshot, err := repo.GetEditorJSONSnapshot(ref)
	if err != nil {
		t.Fatal(err)
	}
	commit, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{Document: ref, OperationID: newUUIDv7String(), ClientID: "history-test", BaseRevision: snapshot.Revision, SchemaVersion: 1, JSONDocument: processHistoryDocument(text), Annotations: []EditorJSONAnnotation{{ID: "comment", Kind: "comment", From: 1, To: 4}}})
	if err != nil {
		t.Fatal(err)
	}
	return commit
}

func TestProcessStepHistoryRestoresExactSurvivingSections(t *testing.T) {
	repo := NewMemoryRepo()
	const companyID = "60606060-6060-4060-8060-606060606060"
	repo.EnsureCompany(companyID, "Process history")
	assertProcessStepHistory(t, repo, companyID)
}

func TestPostgresProcessStepHistoryRestoresExactSurvivingSections(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process history")
	if err != nil {
		t.Fatal(err)
	}
	assertProcessStepHistory(t, repo, company.CompanyID)
}

func TestProcessStepHistoryCapturesUntouchedOverview(t *testing.T) {
	repo := NewMemoryRepo()
	const companyID = "62626262-6262-4262-8262-626262626262"
	repo.EnsureCompany(companyID, "Untouched overview")
	assertProcessStepHistoryCapturesUntouchedOverview(t, repo, companyID)
}

func TestPostgresProcessStepHistoryCapturesUntouchedOverview(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Untouched overview")
	if err != nil {
		t.Fatal(err)
	}
	assertProcessStepHistoryCapturesUntouchedOverview(t, repo, company.CompanyID)
}

func assertProcessStepHistoryCapturesUntouchedOverview(t *testing.T, repo Repository, companyID string) {
	t.Helper()
	gate, err := repo.CreateLogicGate(companyID, "Invoice")
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Review", BodyJSON: processStepSOPBody})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Send", AfterProcessStepID: &first.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	version, err := repo.CreateLogicGateEditorSaveVersion(EditorSaveVersionInput{CompanyID: companyID, ResourceID: gate.LogicGateID})
	if err != nil || len(version.Items) != 3 {
		t.Fatalf("snapshot must include untouched overview and both steps: %+v %v", version, err)
	}
	projections, err := repo.ListLogicGateProjections(companyID, gate.LogicGateID)
	if err != nil || len(projections) != 0 {
		t.Fatalf("capturing an empty overview must not create a live document: %+v %v", projections, err)
	}
	overview := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, DocumentID: "logic-gate-overview"}
	stepRef := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeProcessStep, ResourceID: first.Step.ProcessStepID, DocumentID: first.Step.ProcessStepID}
	overviewChanged := saveProcessHistoryDocument(t, repo, overview, "Written after snapshot")
	saveProcessHistoryDocument(t, repo, stepRef, "Changed instructions")
	if _, err := repo.RestoreLogicGateEditorSaveVersion(EditorSaveVersionRestoreInput{CompanyID: companyID, ResourceID: gate.LogicGateID, SaveID: version.SaveID}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := repo.GetEditorJSONSnapshot(overview)
	if err != nil || snapshot.Deleted || snapshot.Revision <= overviewChanged.Revision || !editorJSONValuesEqual(snapshot.JSONDocument, emptyMangoTiptapDocument) {
		t.Fatalf("restored untouched overview must be empty and live: %+v %v", snapshot, err)
	}
	work, err := repo.GetLogicGateWork(companyID, gate.LogicGateID, "")
	if err != nil || len(work.Steps) != 2 || work.Steps[0].ProcessStepID != first.Step.ProcessStepID || work.Steps[1].ProcessStepID != second.Step.ProcessStepID || !editorJSONValuesEqual(work.Steps[0].BodyJSON, processStepSOPBody) || len(work.Relationships) != 1 || work.Relationships[0].ResourceOperationalRelationshipID != second.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("restore changed flow or lost step SOP: %+v %v", work, err)
	}
}

func assertProcessStepHistory(t *testing.T, repo Repository, companyID string) {
	t.Helper()
	gate, err := repo.CreateLogicGate(companyID, "Invoice")
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Prepare"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Approve"})
	if err != nil {
		t.Fatal(err)
	}
	// A legitimate UUID overview ID and a Step ID must remain distinct typed documents.
	overview := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, DocumentID: first.Step.ProcessStepID}
	stepRef := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeProcessStep, ResourceID: first.Step.ProcessStepID, DocumentID: first.Step.ProcessStepID}
	saveProcessHistoryDocument(t, repo, overview, "Original overview")
	saveProcessHistoryDocument(t, repo, stepRef, "Original instructions")
	version, err := repo.CreateLogicGateEditorSaveVersion(EditorSaveVersionInput{CompanyID: companyID, ResourceID: gate.LogicGateID, SaveKind: "manual"})
	if err != nil || version.ItemCount != 3 {
		t.Fatalf("save version=%+v err=%v", version, err)
	}
	listed, err := repo.ListLogicGateEditorSaveVersions(companyID, gate.LogicGateID)
	if err != nil || len(listed) != 1 || listed[0].ItemCount != 3 {
		t.Fatalf("history list=%+v err=%v", listed, err)
	}
	stepItems := 0
	for _, item := range listed[0].Items {
		if item.ProcessStepID != nil {
			stepItems++
			if item.SourceInformationID != *item.ProcessStepID {
				t.Fatalf("history changed exact step identity: %+v", item)
			}
		}
	}
	if stepItems != 2 {
		t.Fatalf("step history items=%d", stepItems)
	}
	overviewChanged := saveProcessHistoryDocument(t, repo, overview, "Changed overview")
	stepChanged := saveProcessHistoryDocument(t, repo, stepRef, "Changed instructions")
	newOverview := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, DocumentID: "extra-overview"}
	saveProcessHistoryDocument(t, repo, newOverview, "Added after snapshot")
	name := "Renamed step"
	if _, err := repo.UpdateProcessStep(ProcessStepUpdateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, ProcessStepID: first.Step.ProcessStepID, Name: &name}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteProcessStep(ProcessStepDeleteInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, ProcessStepID: second.Step.ProcessStepID}); err != nil {
		t.Fatal(err)
	}
	newStep, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "New step", BodyJSON: processHistoryDocument("New step instructions")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.RestoreLogicGateEditorSaveVersion(EditorSaveVersionRestoreInput{CompanyID: companyID, ResourceID: gate.LogicGateID, SaveID: version.SaveID}); err != nil {
		t.Fatal(err)
	}
	for _, want := range []struct {
		ref      EditorJSONDocumentRef
		text     string
		revision int64
	}{{overview, "Original overview", overviewChanged.Revision + 1}, {stepRef, "Original instructions", stepChanged.Revision + 1}} {
		snapshot, err := repo.GetEditorJSONSnapshot(want.ref)
		if err != nil || !strings.Contains(string(snapshot.JSONDocument), want.text) || snapshot.Revision != want.revision || len(snapshot.Annotations) != 1 {
			t.Fatalf("restored snapshot=%+v err=%v", snapshot, err)
		}
	}
	retired, err := repo.GetEditorJSONSnapshot(newOverview)
	if err != nil || !retired.Deleted {
		t.Fatalf("overview absent from history was not retired: %+v err=%v", retired, err)
	}
	step, err := repo.GetProcessStep(companyID, first.Step.ProcessStepID)
	if err != nil || step.Name != name {
		t.Fatalf("restore changed step name=%+v err=%v", step, err)
	}
	if _, err := repo.GetProcessStep(companyID, second.Step.ProcessStepID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore recreated deleted step: %v", err)
	}
	step, err = repo.GetProcessStep(companyID, newStep.Step.ProcessStepID)
	if err != nil || !strings.Contains(string(step.BodyJSON), "New step instructions") {
		t.Fatalf("restore changed later step=%+v err=%v", step, err)
	}
}

func TestProcessStepHistoryOutboxFailureLeavesAllSectionsUnchanged(t *testing.T) {
	repo := NewMemoryRepo()
	const companyID = "61616161-6161-4161-8161-616161616161"
	repo.EnsureCompany(companyID, "Atomic history")
	gate, err := repo.CreateLogicGate(companyID, "Atomic")
	if err != nil {
		t.Fatal(err)
	}
	step, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Read"})
	if err != nil {
		t.Fatal(err)
	}
	overview := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, DocumentID: "logic-gate-overview"}
	stepRef := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeProcessStep, ResourceID: step.Step.ProcessStepID, DocumentID: step.Step.ProcessStepID}
	saveProcessHistoryDocument(t, repo, overview, "Saved overview")
	saveProcessHistoryDocument(t, repo, stepRef, "Saved instructions")
	version, err := repo.CreateLogicGateEditorSaveVersion(EditorSaveVersionInput{CompanyID: companyID, ResourceID: gate.LogicGateID})
	if err != nil {
		t.Fatal(err)
	}
	beforeOverview := saveProcessHistoryDocument(t, repo, overview, "Current overview")
	beforeStep := saveProcessHistoryDocument(t, repo, stepRef, "Current instructions")
	outboxBefore := repo.realtimeOutboxSequence
	repo.realtimeOutboxErr = errors.New("forced outbox failure")
	if _, err := repo.RestoreLogicGateEditorSaveVersion(EditorSaveVersionRestoreInput{CompanyID: companyID, ResourceID: gate.LogicGateID, SaveID: version.SaveID}); err == nil {
		t.Fatal("restore should fail when durable event fails")
	}
	for _, before := range []struct {
		ref    EditorJSONDocumentRef
		commit EditorJSONCommit
	}{{overview, beforeOverview}, {stepRef, beforeStep}} {
		after, err := repo.GetEditorJSONSnapshot(before.ref)
		if err != nil || after.Revision != before.commit.Revision || !editorJSONValuesEqual(after.JSONDocument, before.commit.JSONDocument) {
			t.Fatalf("failed restore changed document=%+v err=%v", after, err)
		}
	}
	if repo.realtimeOutboxSequence != outboxBefore {
		t.Fatal("failed restore left partial events")
	}
}

func TestPostgresProcessStepHistoryFailureRollsBackEarlierSectionWrites(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Atomic history failure")
	if err != nil {
		t.Fatal(err)
	}
	gate, _ := repo.CreateLogicGate(company.CompanyID, "Atomic")
	step, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Name: "Read"})
	if err != nil {
		t.Fatal(err)
	}
	refs := []EditorJSONDocumentRef{
		{CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, DocumentID: "logic-gate-overview"},
		{CompanyID: company.CompanyID, ResourceType: EntityTypeProcessStep, ResourceID: step.Step.ProcessStepID, DocumentID: step.Step.ProcessStepID},
	}
	for _, ref := range refs {
		saveProcessHistoryDocument(t, repo, ref, "Saved body")
	}
	version, err := repo.CreateLogicGateEditorSaveVersion(EditorSaveVersionInput{CompanyID: company.CompanyID, ResourceID: gate.LogicGateID})
	if err != nil {
		t.Fatal(err)
	}
	before := []EditorJSONCommit{}
	for _, ref := range refs {
		before = append(before, saveProcessHistoryDocument(t, repo, ref, "Current body"))
	}
	_, err = db.ExecContext(context.Background(), `create function fail_step_history_event() returns trigger language plpgsql as $$ begin if new.resource_type='process_step' then raise exception 'forced Step history failure'; end if; return new; end $$;
		create trigger fail_step_history_event before insert on realtime_outbox for each row execute function fail_step_history_event()`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `drop trigger if exists fail_step_history_event on realtime_outbox; drop function if exists fail_step_history_event()`)
	})
	if _, err := repo.RestoreLogicGateEditorSaveVersion(EditorSaveVersionRestoreInput{CompanyID: company.CompanyID, ResourceID: gate.LogicGateID, SaveID: version.SaveID}); err == nil {
		t.Fatal("restore should fail")
	}
	for index, ref := range refs {
		after, err := repo.GetEditorJSONSnapshot(ref)
		if err != nil || after.Revision != before[index].Revision || !editorJSONValuesEqual(after.JSONDocument, before[index].JSONDocument) {
			t.Fatalf("partial restore committed: %+v err=%v", after, err)
		}
	}
}
