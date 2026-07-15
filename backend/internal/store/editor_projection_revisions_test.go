package store

import (
	"errors"
	"sync"
	"testing"
)

func revisionValue(value int64) *int64 { return &value }

func TestMemoryEditorTextProjectionRevisionsAreMonotonicAndConcurrentWritesHaveOneWinner(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "revision-company"
	node, err := repo.CreateNode(companyID, "Revision node")
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Revision gate")
	if err != nil {
		t.Fatal(err)
	}
	const nodeInformationID = "11111111-1111-4111-8111-111111111111"
	const gateInformationID = "22222222-2222-4222-8222-222222222222"

	createdNode, err := repo.UpsertNodeProjectionWithActor(NodeInformationInput{CompanyID: companyID, NodeID: node.NodeID, Type: "Text box", Information: "node-v1", InformationID: nodeInformationID, ExpectedRevision: revisionValue(0)})
	if err != nil {
		t.Fatal(err)
	}
	if createdNode.Revision != 1 {
		t.Fatalf("node create revision = %d, want 1", createdNode.Revision)
	}
	updatedNode, err := repo.UpsertNodeProjectionWithActor(NodeInformationInput{CompanyID: companyID, NodeID: node.NodeID, Type: "Text box", Information: "node-v2", InformationID: nodeInformationID, ExpectedRevision: revisionValue(1)})
	if err != nil {
		t.Fatal(err)
	}
	if updatedNode.Revision != 2 {
		t.Fatalf("node update revision = %d, want 2", updatedNode.Revision)
	}

	createdGate, err := repo.UpsertLogicGateProjection(LogicGateProjectionInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Type: "Text box", Information: "gate-v1", InformationID: gateInformationID, ExpectedRevision: revisionValue(0)})
	if err != nil {
		t.Fatal(err)
	}
	if createdGate.Revision != 1 {
		t.Fatalf("logic gate create revision = %d, want 1", createdGate.Revision)
	}

	type result struct {
		itemRevision int64
		err          error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	var wg sync.WaitGroup
	for _, text := range []string{"winner-a", "winner-b"} {
		text := text
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			item, writeErr := repo.UpsertNodeProjectionWithActor(NodeInformationInput{CompanyID: companyID, NodeID: node.NodeID, Type: "Text box", Information: text, InformationID: nodeInformationID, ExpectedRevision: revisionValue(2)})
			results <- result{itemRevision: item.Revision, err: writeErr}
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	successes := 0
	conflicts := 0
	for writeResult := range results {
		if writeResult.err == nil {
			successes++
			if writeResult.itemRevision != 3 {
				t.Fatalf("winning revision = %d, want 3", writeResult.itemRevision)
			}
			continue
		}
		var conflict *ProjectionRevisionConflictError
		if !errors.As(writeResult.err, &conflict) {
			t.Fatalf("losing error = %v, want revision conflict", writeResult.err)
		}
		conflicts++
		if conflict.NodeCurrent == nil || conflict.NodeCurrent.Revision != 3 {
			t.Fatalf("losing current = %+v, want revision 3", conflict.NodeCurrent)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("success/conflict = %d/%d, want 1/1", successes, conflicts)
	}

	_, staleErr := repo.UpsertNodeProjectionWithActor(NodeInformationInput{CompanyID: companyID, NodeID: node.NodeID, Type: "Text box", Information: "stale overwrite", InformationID: nodeInformationID, ExpectedRevision: revisionValue(2)})
	var staleConflict *ProjectionRevisionConflictError
	if !errors.As(staleErr, &staleConflict) || staleConflict.NodeCurrent == nil || staleConflict.NodeCurrent.Revision != 3 {
		t.Fatalf("stale update conflict = %#v / %v", staleConflict, staleErr)
	}
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{CompanyID: companyID, NodeID: node.NodeID, InformationID: nodeInformationID, ExpectedRevision: revisionValue(2)}); !errors.As(err, &staleConflict) {
		t.Fatalf("stale node delete error = %v, want conflict", err)
	}
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{CompanyID: companyID, NodeID: node.NodeID, InformationID: nodeInformationID, ExpectedRevision: revisionValue(3)}); err != nil {
		t.Fatalf("current node delete failed: %v", err)
	}
	if visible, err := repo.ListNodeProjections(companyID, node.NodeID); err != nil || len(visible) != 0 {
		t.Fatalf("deleted text projection remained visible: %+v / %v", visible, err)
	}
	recreatedNode, err := repo.UpsertNodeProjectionWithActor(NodeInformationInput{CompanyID: companyID, NodeID: node.NodeID, Type: "Text box", Information: "node-after-delete", InformationID: nodeInformationID, ExpectedRevision: revisionValue(0)})
	if err != nil {
		t.Fatal(err)
	}
	if recreatedNode.Revision != 5 {
		t.Fatalf("node revision after delete/recreate = %d, want 5", recreatedNode.Revision)
	}

	updatedGate, err := repo.UpsertLogicGateProjection(LogicGateProjectionInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Type: "Text box", Information: "gate-v2", InformationID: gateInformationID, ExpectedRevision: revisionValue(1)})
	if err != nil {
		t.Fatal(err)
	}
	if updatedGate.Revision != 2 {
		t.Fatalf("logic gate revision = %d, want 2", updatedGate.Revision)
	}
	var gateConflict *ProjectionRevisionConflictError
	_, staleGateErr := repo.UpsertLogicGateProjection(LogicGateProjectionInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Type: "Text box", Information: "stale gate overwrite", InformationID: gateInformationID, ExpectedRevision: revisionValue(1)})
	if !errors.As(staleGateErr, &gateConflict) || gateConflict.LogicGateCurrent == nil || gateConflict.LogicGateCurrent.Revision != 2 {
		t.Fatalf("stale logic gate update conflict = %#v / %v", gateConflict, staleGateErr)
	}

	start = make(chan struct{})
	results = make(chan result, 2)
	wg = sync.WaitGroup{}
	for _, text := range []string{"gate-winner-a", "gate-winner-b"} {
		text := text
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			item, writeErr := repo.UpsertLogicGateProjection(LogicGateProjectionInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Type: "Text box", Information: text, InformationID: gateInformationID, ExpectedRevision: revisionValue(2)})
			results <- result{itemRevision: item.Revision, err: writeErr}
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	successes = 0
	conflicts = 0
	for writeResult := range results {
		if writeResult.err == nil {
			successes++
			if writeResult.itemRevision != 3 {
				t.Fatalf("winning logic gate revision = %d, want 3", writeResult.itemRevision)
			}
			continue
		}
		var conflict *ProjectionRevisionConflictError
		if !errors.As(writeResult.err, &conflict) {
			t.Fatalf("losing logic gate error = %v, want revision conflict", writeResult.err)
		}
		conflicts++
		if conflict.LogicGateCurrent == nil || conflict.LogicGateCurrent.Revision != 3 {
			t.Fatalf("losing logic gate current = %+v, want revision 3", conflict.LogicGateCurrent)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("logic gate success/conflict = %d/%d, want 1/1", successes, conflicts)
	}

	if err := repo.DeleteLogicGateProjection(LogicGateProjectionDeleteInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, InformationID: gateInformationID, ExpectedRevision: revisionValue(2)}); !errors.As(err, &gateConflict) || gateConflict.LogicGateCurrent == nil || gateConflict.LogicGateCurrent.Revision != 3 {
		t.Fatalf("stale logic gate delete conflict = %#v / %v", gateConflict, err)
	}
	if err := repo.DeleteLogicGateProjection(LogicGateProjectionDeleteInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, InformationID: gateInformationID, ExpectedRevision: revisionValue(3)}); err != nil {
		t.Fatalf("current logic gate delete failed: %v", err)
	}
	if visible, err := repo.ListLogicGateProjections(companyID, gate.LogicGateID); err != nil || len(visible) != 0 {
		t.Fatalf("deleted logic gate projection remained visible: %+v / %v", visible, err)
	}
	const recreatedGateInformationID = "66666666-6666-4666-8666-666666666666"
	recreatedGate, err := repo.UpsertLogicGateProjection(LogicGateProjectionInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Type: "Text box", Information: "gate-after-delete", InformationID: recreatedGateInformationID, ExpectedRevision: revisionValue(0)})
	if err != nil {
		t.Fatal(err)
	}
	if recreatedGate.Revision != 5 || recreatedGate.InformationID != recreatedGateInformationID {
		t.Fatalf("logic gate recreation = %+v, want new information ID at revision 5", recreatedGate)
	}

	nodeItems, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	gateItems, err := repo.ListLogicGateProjections(companyID, gate.LogicGateID)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodeItems) != 1 || nodeItems[0].Revision != 5 || len(gateItems) != 1 || gateItems[0].Revision != 5 {
		t.Fatalf("node/logic gate isolation lost: node=%+v gate=%+v", nodeItems, gateItems)
	}
}

func TestMemoryEditorTextProjectionCreationRequiresRevisionZero(t *testing.T) {
	repo := NewMemoryRepo()
	node, err := repo.CreateNode("revision-zero-company", "new node")
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.UpsertNodeProjectionWithActor(NodeInformationInput{CompanyID: "revision-zero-company", NodeID: node.NodeID, Type: "Text box", Information: "missing revision", InformationID: "33333333-3333-4333-8333-333333333333"})
	if !errors.Is(err, ErrProjectionRevisionRequired) {
		t.Fatalf("missing revision error = %v", err)
	}
	_, err = repo.UpsertNodeProjectionWithActor(NodeInformationInput{CompanyID: "revision-zero-company", NodeID: node.NodeID, Type: "Text box", Information: "wrong create base", InformationID: "33333333-3333-4333-8333-333333333333", ExpectedRevision: revisionValue(4)})
	var conflict *ProjectionRevisionConflictError
	if !errors.As(err, &conflict) || conflict.NodeCurrent != nil {
		t.Fatalf("wrong create base error = %#v / %v", conflict, err)
	}
}
