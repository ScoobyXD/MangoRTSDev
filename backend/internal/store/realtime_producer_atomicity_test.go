package store

import (
	"errors"
	"testing"
)

func TestMemoryNodeChatMutationAndOutboxAreAtomic(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "19191919-1919-4191-8191-191919191901"
	node, err := repo.CreateNode(companyID, "Atomic chat")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	forced := errors.New("forced outbox failure")
	repo.realtimeOutboxErr = forced
	input := NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, Type: "Text block chat",
		Information: "plain-text legacy chat body", InformationID: "chat-message-1",
	}
	if _, err := repo.AddNodeInformationWithActor(input); !errors.Is(err, forced) {
		t.Fatalf("AddNodeInformationWithActor error = %v, want forced outbox failure", err)
	}
	if got := len(repo.nodeInfo[key(companyID, node.NodeID)]); got != 0 {
		t.Fatalf("node information rows after failed create = %d, want 0", got)
	}
	if got := len(repo.nodeText[key(companyID, node.NodeID)]); got != 0 {
		t.Fatalf("node projections after failed create = %d, want 0", got)
	}
	if len(repo.realtimeOutbox) != 0 {
		t.Fatalf("outbox rows after failed create = %d, want 0", len(repo.realtimeOutbox))
	}

	repo.realtimeOutboxErr = nil
	if _, err := repo.AddNodeInformationWithActor(input); err != nil {
		t.Fatalf("AddNodeInformationWithActor success: %v", err)
	}
	if len(repo.realtimeOutbox) != 1 {
		t.Fatalf("outbox rows after committed create = %d, want 1", len(repo.realtimeOutbox))
	}

	repo.realtimeOutboxErr = forced
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: input.InformationID,
	}); !errors.Is(err, forced) {
		t.Fatalf("DeleteNodeProjectionWithActor error = %v, want forced outbox failure", err)
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil || len(projections) != 1 || projections[0].InformationID != input.InformationID {
		t.Fatalf("projections after failed delete = %+v err=%v, want original chat", projections, err)
	}
	if len(repo.realtimeOutbox) != 1 {
		t.Fatalf("outbox rows after failed delete = %d, want original create only", len(repo.realtimeOutbox))
	}

	repo.realtimeOutboxErr = nil
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: input.InformationID,
	}); err != nil {
		t.Fatalf("DeleteNodeProjectionWithActor success: %v", err)
	}
	projections, err = repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil || len(projections) != 0 {
		t.Fatalf("projections after committed delete = %+v err=%v, want none", projections, err)
	}
	if len(repo.realtimeOutbox) != 2 {
		t.Fatalf("outbox rows after committed delete = %d, want create and delete", len(repo.realtimeOutbox))
	}
}

func TestMemoryWorkspaceMutationAndOutboxAreAtomic(t *testing.T) {
	forced := errors.New("forced outbox failure")

	t.Run("Process step mutation", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "19191919-1919-4191-8191-191919191902"
		logicGate, err := repo.CreateLogicGate(companyID, "Atomic Process")
		if err != nil {
			t.Fatal(err)
		}
		repo.realtimeOutboxErr = forced
		if _, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Name: "Review"}); !errors.Is(err, forced) {
			t.Fatalf("CreateProcessStep error = %v, want forced outbox failure", err)
		}
		work, err := repo.GetLogicGateWork(companyID, logicGate.LogicGateID, "")
		if err != nil || len(work.Steps) != 0 {
			t.Fatalf("steps after failed outbox insert = %+v err=%v, want none", work.Steps, err)
		}
		if len(repo.domainEvents) != 0 || len(repo.realtimeOutbox) != 0 {
			t.Fatalf("split Process state domain_events=%d outbox=%d", len(repo.domainEvents), len(repo.realtimeOutbox))
		}
	})

	t.Run("Company Explorer delete", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "19191919-1919-4191-8191-191919191903"
		logicGate, err := repo.CreateLogicGate(companyID, "Atomic gate")
		if err != nil {
			t.Fatalf("CreateLogicGate: %v", err)
		}
		repo.realtimeOutboxErr = forced
		if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{
			Kind: "logic_gate", ID: logicGate.LogicGateID,
		}}, "actor-user"); !errors.Is(err, forced) {
			t.Fatalf("DeleteCompanyExplorerTargets error = %v, want forced outbox failure", err)
		}
		if _, err := repo.GetLogicGate(companyID, logicGate.LogicGateID); err != nil {
			t.Fatalf("logic gate missing after failed outbox insert: %v", err)
		}
		if len(repo.domainEvents) != 0 || len(repo.realtimeOutbox) != 0 {
			t.Fatalf("split delete state domain_events=%d outbox=%d", len(repo.domainEvents), len(repo.realtimeOutbox))
		}
	})
}

func TestBusinessMutationFailureDoesNotCreateRealtimeOutboxRow(t *testing.T) {
	repo := NewMemoryRepo()
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: "19191919-1919-4191-8191-191919191904",
		NodeID:    "missing-node", Type: "Text block chat", InformationID: "missing-chat",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing-node chat error = %v, want ErrNotFound", err)
	}
	if len(repo.realtimeOutbox) != 0 {
		t.Fatalf("outbox rows after failed business mutation = %d, want 0", len(repo.realtimeOutbox))
	}
}

func TestMemoryBatchedWorkspaceEventsAndOutboxAreAtomic(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "19191919-1919-4191-8191-191919191905"
	logicGate, err := repo.CreateLogicGate(companyID, "Batched atomic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	inputs := []DomainEventInput{
		workspaceDomainEventInput(companyID, ProcessWorkChangedEventType, map[string]any{"logic_gate_id": logicGate.LogicGateID}),
		workspaceDomainEventInput(companyID, ProcessWorkChangedEventType, map[string]any{"logic_gate_id": logicGate.LogicGateID}),
	}
	repo.realtimeOutboxErr = errors.New("forced batched outbox failure")
	if _, err := repo.AppendDomainEvents(inputs); err == nil {
		t.Fatal("AppendDomainEvents succeeded with forced batched outbox failure")
	}
	if len(repo.domainEvents) != 0 || len(repo.realtimeOutbox) != 0 {
		t.Fatalf("split batched state domain_events=%d outbox=%d", len(repo.domainEvents), len(repo.realtimeOutbox))
	}

	repo.realtimeOutboxErr = nil
	events, err := repo.AppendDomainEvents(inputs)
	if err != nil {
		t.Fatalf("AppendDomainEvents: %v", err)
	}
	if len(events) != 2 || len(repo.domainEvents) != 2 || len(repo.realtimeOutbox) != 1 {
		t.Fatalf("committed batch events=%d stored=%d outbox=%d, want 2/2/1", len(events), len(repo.domainEvents), len(repo.realtimeOutbox))
	}
}
