package store

import (
	"errors"
	"reflect"
	"testing"
)

func TestPostgresProcessMapNodeWorkPrecondition(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Node work preconditions")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(company.CompanyID, "AI Process")
	if err != nil {
		t.Fatal(err)
	}
	other, err := repo.CreateLogicGate(company.CompanyID, "Human-selected Process")
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: company.CompanyID, LogicGateID: process.LogicGateID, Name: "First"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: company.CompanyID, LogicGateID: process.LogicGateID, Name: "Second"})
	if err != nil {
		t.Fatal(err)
	}
	nodeID := newUUIDv7String()
	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company.CompanyID, LogicGateID: process.LogicGateID, NodeID: nodeID, CreateNodeTitle: "Work", Status: "In Progress", ProcessStepID: &first.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	expected := &NodeWorkPrecondition{LogicGateID: process.LogicGateID, ProcessStepID: first.Step.ProcessStepID, Status: nodeWorkStatus(assigned.Node), AssignmentVersion: assigned.Assignment.Version}
	write := EditorJSONCommitInput{
		Document:    EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: nodeID, DocumentID: newUUIDv7String()},
		OperationID: newUUIDv7String(), ClientID: "test", SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: emptyMangoTiptapDocument, ExpectedNodeWork: expected,
	}
	if saved, err := repo.CommitEditorJSONDocument(write); err != nil || saved.Revision != 1 {
		t.Fatalf("matching write = %+v, err=%v", saved, err)
	}
	move := LogicGateNodeAssignmentMoveInput{CompanyID: company.CompanyID, LogicGateID: process.LogicGateID, NodeID: nodeID, ProcessStepID: &second.Step.ProcessStepID, ProcessStepIDSet: true, ExpectedNodeWork: expected}
	moved, err := repo.MoveLogicGateNodeAssignment(move)
	if err != nil || moved.Assignment.ProcessStepID == nil || *moved.Assignment.ProcessStepID != second.Step.ProcessStepID {
		t.Fatalf("matching move = %+v, err=%v", moved, err)
	}
	expected = &NodeWorkPrecondition{LogicGateID: process.LogicGateID, ProcessStepID: second.Step.ProcessStepID, Status: nodeWorkStatus(moved.Node), AssignmentVersion: moved.Assignment.Version}
	transferred, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company.CompanyID, LogicGateID: other.LogicGateID, NodeID: nodeID})
	if err != nil {
		t.Fatal(err)
	}
	move.ExpectedNodeWork = expected
	if _, err := repo.MoveLogicGateNodeAssignment(move); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale move error = %v, want conflict", err)
	}
	write.Document.DocumentID, write.OperationID, write.ExpectedNodeWork = newUUIDv7String(), newUUIDv7String(), expected
	if _, err := repo.CommitEditorJSONDocument(write); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale write error = %v, want conflict", err)
	}
	var count int
	if err := db.QueryRow(`select count(*) from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, company.CompanyID, nodeID, write.Document.DocumentID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rejected write created textbox: count=%d err=%v", count, err)
	}
	assignments, err := repo.ListNodeLogicGateAssignments(company.CompanyID, nodeID)
	if err != nil || len(assignments) != 1 || !reflect.DeepEqual(assignments[0], transferred.Assignment) {
		t.Fatalf("rejected work changed human placement: assignments=%+v err=%v", assignments, err)
	}
}
