package store

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestNodeWorkPreconditionProtectsHumanChanges(t *testing.T) {
	for _, change := range []string{"step", "process", "assignment version", "status"} {
		t.Run(change, func(t *testing.T) {
			repo, companyID, process, node := processStepsFixture(t)
			first, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: process.LogicGateID, Name: "First"})
			if err != nil {
				t.Fatal(err)
			}
			second, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: process.LogicGateID, Name: "Second"})
			if err != nil {
				t.Fatal(err)
			}
			assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
				CompanyID: companyID, LogicGateID: process.LogicGateID, NodeID: node.NodeID,
				ProcessStepID: &first.Step.ProcessStepID, ProcessStepIDSet: true, Status: "In Progress",
			})
			if err != nil {
				t.Fatal(err)
			}
			expected := NodeWorkPrecondition{LogicGateID: process.LogicGateID, ProcessStepID: first.Step.ProcessStepID, Status: nodeWorkStatus(assigned.Node), AssignmentVersion: assigned.Assignment.Version}
			switch change {
			case "step":
				_, err = repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
					CompanyID: companyID, LogicGateID: process.LogicGateID, NodeID: node.NodeID,
					ProcessStepID: &second.Step.ProcessStepID, ProcessStepIDSet: true,
				})
			case "process":
				other, createErr := repo.CreateLogicGate(companyID, "Human-selected Process")
				if createErr != nil {
					t.Fatal(createErr)
				}
				_, err = repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: other.LogicGateID, NodeID: node.NodeID})
			case "assignment version":
				_, err = repo.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{CompanyID: companyID, LogicGateID: process.LogicGateID, NodeID: node.NodeID, IsIssue: true})
			case "status":
				status := "Done"
				_, err = repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Status: &status, StatusSet: true})
			}
			if err != nil {
				t.Fatal(err)
			}
			before, err := repo.ListNodeLogicGateAssignments(companyID, node.NodeID)
			if err != nil {
				t.Fatal(err)
			}
			beforeNode, err := repo.GetNode(companyID, node.NodeID)
			if err != nil {
				t.Fatal(err)
			}
			move := LogicGateNodeAssignmentMoveInput{
				CompanyID: companyID, LogicGateID: process.LogicGateID, NodeID: node.NodeID,
				ProcessStepID: &second.Step.ProcessStepID, ProcessStepIDSet: true, ExpectedNodeWork: &expected,
			}
			if _, err := repo.MoveLogicGateNodeAssignment(move); !errors.Is(err, ErrVersionConflict) {
				t.Fatalf("stale move error = %v, want conflict", err)
			}
			ref := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: newUUIDv7String()}
			write := EditorJSONCommitInput{
				Document: ref, OperationID: newUUIDv7String(), ClientID: "test", SchemaVersion: MangoTiptapSchemaVersion,
				JSONDocument:     json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Saved work"}]}]}}`),
				ExpectedNodeWork: &expected,
			}
			if _, err := repo.CommitEditorJSONDocument(write); !errors.Is(err, ErrVersionConflict) {
				t.Fatalf("stale write error = %v, want conflict", err)
			}
			if _, exists := repo.editorJSONDocuments[editorJSONMemoryKey(ref)]; exists {
				t.Fatal("a rejected write must not create even an empty textbox")
			}
			after, err := repo.ListNodeLogicGateAssignments(companyID, node.NodeID)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("rejected work changed assignment: before=%+v after=%+v err=%v", before, after, err)
			}
			afterNode, err := repo.GetNode(companyID, node.NodeID)
			if err != nil || nodeWorkStatus(afterNode) != nodeWorkStatus(beforeNode) {
				t.Fatalf("rejected work changed status: %v", err)
			}
		})
	}
}

func TestNodeWorkPreconditionAllowsMatchingWritesAndMoves(t *testing.T) {
	repo, companyID, process, node := processStepsFixture(t)
	step, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: process.LogicGateID, Name: "Work"})
	if err != nil {
		t.Fatal(err)
	}
	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: process.LogicGateID, NodeID: node.NodeID, ProcessStepID: &step.Step.ProcessStepID, ProcessStepIDSet: true, Status: "In Progress"})
	if err != nil {
		t.Fatal(err)
	}
	expected := &NodeWorkPrecondition{LogicGateID: process.LogicGateID, ProcessStepID: step.Step.ProcessStepID, Status: nodeWorkStatus(assigned.Node), AssignmentVersion: assigned.Assignment.Version}
	committed, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document:    EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: newUUIDv7String()},
		OperationID: newUUIDv7String(), ClientID: "test", SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: emptyMangoTiptapDocument, ExpectedNodeWork: expected,
	})
	if err != nil || committed.Revision != 1 {
		t.Fatalf("matching write = %+v, err=%v", committed, err)
	}
	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: process.LogicGateID, NodeID: node.NodeID, ProcessStepID: &step.Step.ProcessStepID, ProcessStepIDSet: true, ExpectedNodeWork: expected}); err != nil {
		t.Fatalf("matching move: %v", err)
	}
}
