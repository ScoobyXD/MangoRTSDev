package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestEmailConversionPreservesStatusAndExactProcessStep(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111190"
	repo.EnsureCompany(companyID, "Process Steps")
	user, gate := setupEmailConversionUserAndGate(t, repo, companyID)
	created, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Review"})
	if err != nil {
		t.Fatal(err)
	}
	stepID := created.Step.ProcessStepID
	message := domain.EmailMessageSnapshot{ID: "done-email", ThreadID: "done-thread", Subject: "Completed work"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatal(err)
	}
	result, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		CompanyID: companyID, UserID: user.UserID, AccountEmail: user.Email,
		LogicGateID: gate.LogicGateID, ProcessStepID: &stepID, Status: "Done", MessageIDs: []string{message.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Assignments) != 1 || result.Assignments[0].ProcessStepID == nil || *result.Assignments[0].ProcessStepID != stepID {
		t.Fatalf("assignment lost its selected step: %+v", result.Assignments)
	}
	if optionalStringValue(result.Nodes[0].Status) != "Done" {
		t.Fatalf("status = %v", result.Nodes[0].Status)
	}
	if _, err := repo.DeleteProcessStep(ProcessStepDeleteInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, ProcessStepID: stepID}); err != nil {
		t.Fatal(err)
	}
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, result.Nodes[0].NodeID)
	if err != nil || len(assignments) != 1 || assignments[0].ProcessStepID != nil || assignments[0].LogicGateID != gate.LogicGateID {
		t.Fatalf("step deletion changed Process membership: %+v, %v", assignments, err)
	}
	node, err := repo.GetNode(companyID, result.Nodes[0].NodeID)
	if err != nil || optionalStringValue(node.Status) != "Done" {
		t.Fatalf("step deletion changed Node status: %+v, %v", node, err)
	}
}

func TestEmailConversionRejectsStepFromAnotherProcessAtomically(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111191"
	repo.EnsureCompany(companyID, "Process Steps")
	user, gate := setupEmailConversionUserAndGate(t, repo, companyID)
	otherGate, err := repo.CreateLogicGate(companyID, "Other process")
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: otherGate.LogicGateID, Name: "Other step"})
	if err != nil {
		t.Fatal(err)
	}
	stepID := created.Step.ProcessStepID
	message := domain.EmailMessageSnapshot{ID: "rejected-email", Subject: "Preserve me"}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatal(err)
	}
	_, err = repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		CompanyID: companyID, UserID: user.UserID, AccountEmail: user.Email,
		LogicGateID: gate.LogicGateID, ProcessStepID: &stepID, MessageIDs: []string{message.ID},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("error = %v, want ErrInvalid", err)
	}
	if nodes, err := repo.ListNodes(companyID); err != nil || len(nodes) != 0 {
		t.Fatalf("failed conversion created Nodes: %+v, %v", nodes, err)
	}
	if items := communicationsTriageItemsForTest(repo, user.UserID); len(items) != 1 || items[0].MessageID != message.ID {
		t.Fatalf("failed conversion removed its email: %+v", items)
	}
}

func TestMyWorkProcessCountsUseNodeStatusIndependentlyOfIssue(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111192"
	repo.EnsureCompany(companyID, "Process Steps")
	user, gate := setupEmailConversionUserAndGate(t, repo, companyID)
	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: newUUIDv7String(), CreateNodeTitle: "Waiting work", Status: "Pending", IsIssue: true, IsIssueSet: true})
	if err != nil {
		t.Fatal(err)
	}
	query := MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProcesses, Role: domain.RACIRoleResponsible}
	response, err := repo.GetMyWork(context.Background(), query)
	if err != nil || len(response.Processes.Items) != 1 || response.Processes.Items[0].StatusCounts.Pending != 1 {
		t.Fatalf("pending issue was not counted: %+v, %v", response.Processes, err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, NodeID: assigned.Node.NodeID, LogicGateID: gate.LogicGateID, Status: "Done"}); err != nil {
		t.Fatal(err)
	}
	response, err = repo.GetMyWork(context.Background(), query)
	if err != nil || len(response.Processes.Items) != 1 || response.Processes.Items[0].StatusCounts != (domain.MyWorkProcessStatusCounts{}) {
		t.Fatalf("done issue remains in active counts: %+v, %v", response.Processes, err)
	}
}

func TestProcessWorkRealtimeUsesExactProcessScope(t *testing.T) {
	companyID := "11111111-1111-4111-8111-111111111193"
	gateID := "11111111-1111-4111-8111-111111111194"
	input, err := processWorkChangedOutboxInputForEvents(companyID, gateID, "node_updated", []string{"event-one"}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if input.Scope != "process:"+gateID || input.ResourceID != gateID || input.EventType != ProcessWorkChangedEventType {
		t.Fatalf("unexpected realtime identity: %+v", input)
	}
	var payload map[string]any
	if err := json.Unmarshal(input.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["logic_gate_id"] != gateID {
		t.Fatalf("missing exact Process identity: %+v", payload)
	}
	if _, exists := payload["board_id"]; exists {
		t.Fatalf("obsolete board identity: %+v", payload)
	}
}
