package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestPostgresProcessStepsRuntime(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Steps runtime")
	if err != nil {
		t.Fatal(err)
	}
	assertProcessStepsRequestResolvers(t, repo, company.CompanyID)
	gate, err := repo.CreateLogicGate(company.CompanyID, "Review invoices")
	if err != nil {
		t.Fatal(err)
	}
	other, err := repo.CreateLogicGate(company.CompanyID, "Other")
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Name: "Prepare"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Name: "Approve", AfterProcessStepID: &first.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	if second.Relationship == nil {
		t.Fatal("Add next must connect exact steps")
	}
	renamed := "Send"
	position := 3000
	if _, err = repo.UpdateProcessStep(ProcessStepUpdateInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, ProcessStepID: second.Step.ProcessStepID, Name: &renamed, Position: &position}); err != nil {
		t.Fatal(err)
	}
	edgeInput := ProcessStepRelationshipInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Source: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: first.Step.ProcessStepID}, Target: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: second.Step.ProcessStepID}}
	duplicate, err := repo.CreateProcessStepRelationship(edgeInput)
	if err != nil || duplicate.Relationship.ResourceOperationalRelationshipID != second.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("Repeated edge: %+v %v", duplicate, err)
	}
	nodeID := newUUIDv7String()
	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, NodeID: nodeID, CreateNodeTitle: "Invoice 42", Status: "In Progress", ProcessStepID: &first.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	moved, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, NodeID: nodeID, ProcessStepID: &second.Step.ProcessStepID, ProcessStepIDSet: true})
	if err != nil {
		t.Fatal(err)
	}
	if nodeWorkStatus(moved.Node) != "In Progress" || moved.Assignment.AssignmentID != assigned.Assignment.AssignmentID {
		t.Fatal("Step moves must preserve status and assignment identity")
	}
	finished, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, NodeID: nodeID, Status: "Done"})
	if err != nil {
		t.Fatal(err)
	}
	if finished.Assignment.ProcessStepID == nil || *finished.Assignment.ProcessStepID != second.Step.ProcessStepID {
		t.Fatal("Done must remember step")
	}
	issue, err := repo.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, NodeID: nodeID, IsIssue: true})
	if err != nil {
		t.Fatal(err)
	}
	if nodeWorkStatus(issue.Node) != "Done" {
		t.Fatal("Issue must not override status")
	}
	invalid := "Issue"
	if _, err = repo.UpdateNode(UpdateNodeInput{CompanyID: company.CompanyID, NodeID: nodeID, Status: &invalid, StatusSet: true}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Issue status accepted: %v", err)
	}
	work, err := repo.GetLogicGateWork(company.CompanyID, gate.LogicGateID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(work.Steps) != 2 || len(work.Nodes) != 1 || work.Nodes[0].Status != "Done" || len(work.Relationships) != 1 {
		t.Fatalf("Canonical work: %+v", work)
	}
	if _, err = repo.DeleteProcessStep(ProcessStepDeleteInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, ProcessStepID: second.Step.ProcessStepID}); err != nil {
		t.Fatal(err)
	}
	work, err = repo.GetLogicGateWork(company.CompanyID, gate.LogicGateID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(work.Nodes) != 1 || work.Nodes[0].ProcessStepID != nil || work.Nodes[0].Status != "Done" || len(work.Relationships) != 0 {
		t.Fatalf("Step deletion lost work: %+v", work)
	}
	if _, err = repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company.CompanyID, LogicGateID: other.LogicGateID, NodeID: nodeID, ProcessStepID: &first.Step.ProcessStepID, ProcessStepIDSet: true}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Foreign step accepted: %v", err)
	}
	moved, err = repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{CompanyID: company.CompanyID, LogicGateID: other.LogicGateID, NodeID: nodeID})
	if err != nil {
		t.Fatal(err)
	}
	if moved.Assignment.ProcessStepID != nil || nodeWorkStatus(moved.Node) != "Done" {
		t.Fatal("Cross-Process move must preserve Node status")
	}
	third, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Name: "Third", AfterProcessStepID: &first.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.DeleteProcessStepRelationship(ProcessStepRelationshipDeleteInput{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, RelationshipID: third.Relationship.ResourceOperationalRelationshipID}); err != nil {
		t.Fatal(err)
	}
}
