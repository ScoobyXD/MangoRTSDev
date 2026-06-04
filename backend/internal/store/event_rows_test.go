package store

import (
	"errors"
	"testing"
	"time"
)

func TestKanbanMutationInsertsEventRowWithProjectionDelta(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999101"
	repo.EnsureCompany(companyID, "Event Rows Co")
	logicGate, err := repo.CreateLogicGate(companyID, "Event row gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Event row node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		NodeID:         node.NodeID,
		Status:         "pending",
		Priority:       &priority,
		PrioritySet:    true,
		ActorUserID:    "11111111-1111-4111-8111-111111111101",
		IdempotencyKey: "assign-event-row",
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	rows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("event rows = %d, want 1", len(rows))
	}
	row := rows[0]
	wantScope := "board:" + LogicGateKanbanBoardID(logicGate.LogicGateID)
	if row.EventType != EventTypeKanbanProjectionDelta || row.PrimaryScope != wantScope || row.SequenceScope != wantScope || row.Sequence != 1 {
		t.Fatalf("event row = %+v, want Kanban projection event for %s", row, wantScope)
	}
	payload, err := DecodeKanbanProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeKanbanProjectionDeltaEventPayload: %v", err)
	}
	if payload.Projection != ProjectionNameKanbanBoard || len(payload.Deltas) == 0 {
		t.Fatalf("payload = %+v, want Kanban deltas", payload)
	}
}

func TestKanbanMutationEventRowRollbackLeavesNoEventRow(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999102"
	repo.EnsureCompany(companyID, "Event Rollback Co")
	logicGate, err := repo.CreateLogicGate(companyID, "Rollback gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Rollback node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus setup: %v", err)
	}
	beforeRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}
	repo.eventRowAppendErr = errors.New("forced event row failure")
	_, err = repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "done",
	})
	if !errors.Is(err, repo.eventRowAppendErr) {
		t.Fatalf("MoveLogicGateNodeAssignment error = %v, want forced event row failure", err)
	}
	repo.eventRowAppendErr = nil
	afterRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows after: %v", err)
	}
	if len(afterRows) != len(beforeRows) {
		t.Fatalf("event rows after rollback = %d, want %d", len(afterRows), len(beforeRows))
	}
	card, err := repo.GetKanbanCard(companyID, LogicGateKanbanBoardID(logicGate.LogicGateID), assigned.Card.CardID)
	if err != nil {
		t.Fatalf("GetKanbanCard after rollback: %v", err)
	}
	if card.ColumnID != "pending" {
		t.Fatalf("card column after rollback = %q, want pending", card.ColumnID)
	}
}

func TestEventWorkerClaimAndProcessBookkeeping(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999103"
	repo.EnsureCompany(companyID, "Event Worker Co")
	row, err := repo.AppendEventRow(EventRowInput{
		CompanyID:     companyID,
		EventType:     EventTypePermissionChanged,
		ResourceType:  EntityTypeNode,
		ResourceID:    "11111111-1111-4111-8111-111111111103",
		PrimaryScope:  "node:11111111-1111-4111-8111-111111111103",
		SequenceScope: "node:11111111-1111-4111-8111-111111111103",
		Payload:       map[string]any{"entity_type": EntityTypeNode, "entity_id": "11111111-1111-4111-8111-111111111103"},
	})
	if err != nil {
		t.Fatalf("AppendEventRow: %v", err)
	}
	claimed, err := repo.ClaimAvailableEventRows(10)
	if err != nil {
		t.Fatalf("ClaimAvailableEventRows: %v", err)
	}
	if len(claimed) != 1 || claimed[0].EventID != row.EventID || claimed[0].AttemptCount != 1 || claimed[0].ProcessingStartedAt == nil {
		t.Fatalf("claimed = %+v, want one claimed row with attempt count", claimed)
	}
	if second, err := repo.ClaimAvailableEventRows(10); err != nil || len(second) != 0 {
		t.Fatalf("second claim = %+v err=%v, want no duplicate claim", second, err)
	}
	if err := repo.MarkEventRowProcessed(companyID, row.EventID); err != nil {
		t.Fatalf("MarkEventRowProcessed: %v", err)
	}
	rows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	if rows[0].ProcessedAt == nil || rows[0].ProcessingStartedAt != nil {
		t.Fatalf("processed row = %+v, want processed and unclaimed", rows[0])
	}
}

func TestEventWorkerRetryBookkeepingRecordsError(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999104"
	repo.EnsureCompany(companyID, "Event Retry Co")
	row, err := repo.AppendEventRow(EventRowInput{
		CompanyID:     companyID,
		EventType:     "unsupported.test",
		PrimaryScope:  "test:retry",
		SequenceScope: "test:retry",
	})
	if err != nil {
		t.Fatalf("AppendEventRow: %v", err)
	}
	if _, err := repo.ClaimAvailableEventRows(10); err != nil {
		t.Fatalf("ClaimAvailableEventRows: %v", err)
	}
	next := time.Now().UTC().Add(time.Minute)
	if err := repo.MarkEventRowFailed(companyID, row.EventID, "publish failed", next); err != nil {
		t.Fatalf("MarkEventRowFailed: %v", err)
	}
	rows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	if rows[0].AttemptCount != 1 || rows[0].LastError != "publish failed" || rows[0].ProcessingStartedAt != nil || rows[0].AvailableAt.Before(next.Add(-time.Second)) {
		t.Fatalf("failed row = %+v, want retry state", rows[0])
	}
}
