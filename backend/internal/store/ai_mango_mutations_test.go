package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryAIMangoMutationContract(t *testing.T) {
	testAIMangoMutationContract(t, NewMemoryRepo())
}

func TestPostgresAIMangoMutationContract(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	testAIMangoMutationContract(t, repo)
}

func testAIMangoMutationContract(t *testing.T, repo Repository) {
	t.Helper()
	ctx := context.Background()
	run := newAIActionReceiptRun(t, repo)
	if _, err := repo.AddCompanyMembership("ai-receipt-owner", run.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	run, err := repo.BindAIRun(ctx, run.CompanyID, run.UserID, run.RunID, "native-mutations")
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(run.CompanyID, "Tools")
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: run.CompanyID, LogicGateID: gate.LogicGateID, Name: "Review", ActorUserID: run.UserID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: run.CompanyID, LogicGateID: gate.LogicGateID, Name: "Approve", ActorUserID: run.UserID})
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.AICreateNode(ctx, run, "create", LogicGateNodeAssignmentInput{LogicGateID: gate.LogicGateID, NodeID: NewUUIDv7String(), CreateNodeTitle: "Original", ProcessStepID: &first.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	input := UpdateNodeInput{NodeID: created.Node.NodeID, Title: "AI title", TitleSet: true}
	var concurrent sync.WaitGroup
	for range 5 {
		concurrent.Add(1)
		go func() {
			defer concurrent.Done()
			result, err := repo.AIUpdateNode(ctx, run, "rename", input)
			if err != nil || result.Node.Title != "AI title" {
				t.Errorf("concurrent rename: %+v %v", result, err)
			}
		}()
	}
	concurrent.Wait()
	manual, _, err := repo.UpdateNodeAndWorkspaceEvent(UpdateNodeInput{CompanyID: run.CompanyID, NodeID: input.NodeID, Title: "Manual title", TitleSet: true, ActorUserID: run.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if replay, err := repo.AIUpdateNode(ctx, run, "rename", input); err != nil || replay.Node.Title != "AI title" {
		t.Fatalf("saved rename: %+v %v", replay, err)
	}
	if current, err := repo.GetNode(run.CompanyID, input.NodeID); err != nil || current.Title != manual.Title {
		t.Fatalf("retry overwrote manual edit: %+v %v", current, err)
	}
	move := LogicGateNodeAssignmentMoveInput{NodeID: input.NodeID, LogicGateID: gate.LogicGateID, ProcessStepID: &second.Step.ProcessStepID, ProcessStepIDSet: true}
	result, err := repo.AIMoveNode(ctx, run, "move", move)
	if err != nil || result.Assignment.ProcessStepID == nil || *result.Assignment.ProcessStepID != second.Step.ProcessStepID || *result.Node.Status != *created.Node.Status {
		t.Fatalf("move preserved identity/status: %+v %v", result, err)
	}
	wrongStep := NewUUIDv7String()
	move.ProcessStepID = &wrongStep
	if _, err := repo.AIMoveNode(ctx, run, "invalid-step", move); err == nil {
		t.Fatal("missing Step accepted")
	}
	assignments, err := repo.ListNodeLogicGateAssignments(run.CompanyID, input.NodeID)
	if err != nil || len(assignments) != 1 || assignments[0].ProcessStepID == nil || *assignments[0].ProcessStepID != second.Step.ProcessStepID {
		t.Fatalf("failed move changed assignment: %+v %v", assignments, err)
	}
	ref := EditorJSONDocumentRef{CompanyID: run.CompanyID, ResourceType: EntityTypeProcessStep, ResourceID: first.Step.ProcessStepID, DocumentID: first.Step.ProcessStepID}
	snapshot, err := repo.GetEditorJSONSnapshot(ref)
	if err != nil {
		t.Fatal(err)
	}
	editor := EditorJSONCommitInput{Document: ref, BaseRevision: snapshot.Revision, SchemaVersion: 1, JSONDocument: json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"AI instructions"}]}]}}`)}
	committed, err := repo.AICommitEditor(ctx, run, "editor", editor)
	if err != nil {
		t.Fatal(err)
	}
	newTextbox := EditorJSONCommitInput{Document: EditorJSONDocumentRef{ResourceType: EntityTypeNode, ResourceID: input.NodeID}, SchemaVersion: 1, JSONDocument: editor.JSONDocument}
	textbox, err := repo.AICreateEditor(ctx, run, "new-textbox", newTextbox)
	if err != nil || cleanUUIDText(textbox.Document.DocumentID) == "" {
		t.Fatalf("new editor identity: %+v %v", textbox, err)
	}
	replayedTextbox, err := repo.AICreateEditor(ctx, run, "new-textbox", newTextbox)
	if err != nil || replayedTextbox.Document != textbox.Document || replayedTextbox.Commit.Revision != textbox.Commit.Revision {
		t.Fatalf("new editor replay identity: %+v %v", replayedTextbox, err)
	}
	if postgres, ok := repo.(*PostgresRepo); ok {
		details, err := postgres.GetNodeDetails(run.CompanyID, input.NodeID)
		encoded, _ := json.Marshal(details)
		if err != nil || !strings.Contains(string(encoded), textbox.Document.DocumentID) {
			t.Fatalf("canonical Node details omitted textbox identity: %s %v", encoded, err)
		}
	}
	editorManual := editor
	editorManual.OperationID, editorManual.ClientID, editorManual.ActorUserID = "manual-edit", "manual-client", run.UserID
	editorManual.BaseRevision = committed.Revision
	editorManual.JSONDocument = json.RawMessage(strings.ReplaceAll(string(editor.JSONDocument), "AI instructions", "Manual instructions"))
	if _, err := repo.CommitEditorJSONDocument(editorManual); err != nil {
		t.Fatal(err)
	}
	if replay, err := repo.AICommitEditor(ctx, run, "editor", editor); err != nil || replay.Revision != committed.Revision {
		t.Fatalf("editor receipt: %+v %v", replay, err)
	}
	if current, err := repo.GetEditorJSONSnapshot(ref); err != nil || !strings.Contains(string(current.JSONDocument), "Manual instructions") {
		t.Fatalf("retry overwrote editor: %+v %v", current, err)
	}
	// Fail history after the canonical mutation. Neither the mutation nor receipt
	// may survive this failed shared transaction.
	_, err = repo.AppendAIHistoryEvent(ctx, run.CompanyID, run.UserID, run.RunID, AIHistoryEvent{ID: "action:mango_update_node:rollback", Type: "conflicting-fixture-event", CreatedAt: time.Now().UTC(), Data: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	input.Title = "Must roll back"
	if _, err := repo.AIUpdateNode(ctx, run, "rollback", input); !errors.Is(err, ErrConflict) {
		t.Fatalf("history conflict: %v", err)
	}
	if current, err := repo.GetNode(run.CompanyID, input.NodeID); err != nil || current.Title != manual.Title {
		t.Fatalf("failed history leaked business change: %+v %v", current, err)
	}
	// A Node's direct edit grant does not replace its actual source Process check.
	edit, deny := ResourceDefaultAccessEdit, ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{CompanyID: run.CompanyID, ResourceType: EntityTypeNode, ResourceID: input.NodeID, PermissionMode: PolicyModeCustomized, DefaultAccess: &edit, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{CompanyID: run.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("ai-receipt-owner", run.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	move.ProcessStepID = &first.Step.ProcessStepID
	if _, err := repo.AIMoveNode(ctx, run, "denied-move", move); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked Process allowed move: %v", err)
	}
	if _, err := repo.AICommitEditor(ctx, run, "denied-editor", editor); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked Process allowed Step editor: %v", err)
	}
	if _, err := repo.SetAIRunStatus(ctx, run.CompanyID, run.UserID, run.RunID, "stopping"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AIUpdateNode(ctx, run, "late-update", input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Stop admitted update: %v", err)
	}
}
