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
	claimed, err := repo.ClaimAvailableEventRows(10, DefaultEventRowProcessingLeaseTimeout)
	if err != nil {
		t.Fatalf("ClaimAvailableEventRows: %v", err)
	}
	if len(claimed) != 1 || claimed[0].EventID != row.EventID || claimed[0].AttemptCount != 1 || claimed[0].ProcessingStartedAt == nil {
		t.Fatalf("claimed = %+v, want one claimed row with attempt count", claimed)
	}
	if second, err := repo.ClaimAvailableEventRows(10, DefaultEventRowProcessingLeaseTimeout); err != nil || len(second) != 0 {
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
	if _, err := repo.ClaimAvailableEventRows(10, DefaultEventRowProcessingLeaseTimeout); err != nil {
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

func TestEventWorkerClaimLeaseDoesNotDoubleClaimFreshRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999105"
	repo.EnsureCompany(companyID, "Event Lease Fresh Co")
	row, err := repo.AppendEventRow(EventRowInput{
		CompanyID:     companyID,
		EventType:     EventTypePermissionChanged,
		PrimaryScope:  "node:fresh",
		SequenceScope: "node:fresh",
	})
	if err != nil {
		t.Fatalf("AppendEventRow: %v", err)
	}
	first, err := repo.ClaimAvailableEventRows(10, time.Minute)
	if err != nil {
		t.Fatalf("ClaimAvailableEventRows first: %v", err)
	}
	if len(first) != 1 || first[0].EventID != row.EventID {
		t.Fatalf("first claim = %+v, want row %s", first, row.EventID)
	}
	second, err := repo.ClaimAvailableEventRows(10, time.Minute)
	if err != nil {
		t.Fatalf("ClaimAvailableEventRows second: %v", err)
	}
	if len(second) != 0 {
		t.Fatalf("fresh in-progress claim = %+v, want no rows", second)
	}
}

func TestEventWorkerClaimLeaseReclaimsStaleRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999106"
	repo.EnsureCompany(companyID, "Event Lease Stale Co")
	row, err := repo.AppendEventRow(EventRowInput{
		CompanyID:     companyID,
		EventType:     EventTypePermissionChanged,
		PrimaryScope:  "node:stale",
		SequenceScope: "node:stale",
	})
	if err != nil {
		t.Fatalf("AppendEventRow: %v", err)
	}
	if _, err := repo.ClaimAvailableEventRows(10, time.Minute); err != nil {
		t.Fatalf("ClaimAvailableEventRows first: %v", err)
	}
	staleStartedAt := time.Now().UTC().Add(-2 * time.Minute)
	repo.mu.Lock()
	stale := repo.eventRows[eventRowMemoryKey(companyID, row.EventID)]
	stale.ProcessingStartedAt = &staleStartedAt
	repo.eventRows[eventRowMemoryKey(companyID, row.EventID)] = stale
	repo.mu.Unlock()

	reclaimed, err := repo.ClaimAvailableEventRows(10, time.Minute)
	if err != nil {
		t.Fatalf("ClaimAvailableEventRows stale: %v", err)
	}
	if len(reclaimed) != 1 || reclaimed[0].EventID != row.EventID || reclaimed[0].AttemptCount != 2 {
		t.Fatalf("reclaimed = %+v, want same row with second attempt", reclaimed)
	}
	if reclaimed[0].ProcessingStartedAt == nil || !reclaimed[0].ProcessingStartedAt.After(staleStartedAt) {
		t.Fatalf("reclaimed processing_started_at = %v, want refreshed after %v", reclaimed[0].ProcessingStartedAt, staleStartedAt)
	}
}

func TestEventWorkerClaimLeaseNeverReclaimsProcessedRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999107"
	repo.EnsureCompany(companyID, "Event Lease Processed Co")
	row, err := repo.AppendEventRow(EventRowInput{
		CompanyID:     companyID,
		EventType:     EventTypePermissionChanged,
		PrimaryScope:  "node:processed",
		SequenceScope: "node:processed",
	})
	if err != nil {
		t.Fatalf("AppendEventRow: %v", err)
	}
	if _, err := repo.ClaimAvailableEventRows(10, time.Minute); err != nil {
		t.Fatalf("ClaimAvailableEventRows first: %v", err)
	}
	if err := repo.MarkEventRowProcessed(companyID, row.EventID); err != nil {
		t.Fatalf("MarkEventRowProcessed: %v", err)
	}
	claimed, err := repo.ClaimAvailableEventRows(10, time.Nanosecond)
	if err != nil {
		t.Fatalf("ClaimAvailableEventRows processed: %v", err)
	}
	if len(claimed) != 0 {
		t.Fatalf("processed claim = %+v, want no rows", claimed)
	}
}

func TestEventWorkerFailedRowsRespectAvailableAtBeforeRetry(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999108"
	repo.EnsureCompany(companyID, "Event Lease Failed Co")
	row, err := repo.AppendEventRow(EventRowInput{
		CompanyID:     companyID,
		EventType:     EventTypePermissionChanged,
		PrimaryScope:  "node:failed",
		SequenceScope: "node:failed",
	})
	if err != nil {
		t.Fatalf("AppendEventRow: %v", err)
	}
	if _, err := repo.ClaimAvailableEventRows(10, time.Minute); err != nil {
		t.Fatalf("ClaimAvailableEventRows first: %v", err)
	}
	if err := repo.MarkEventRowFailed(companyID, row.EventID, "retry later", time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatalf("MarkEventRowFailed future: %v", err)
	}
	early, err := repo.ClaimAvailableEventRows(10, time.Nanosecond)
	if err != nil {
		t.Fatalf("ClaimAvailableEventRows future failed: %v", err)
	}
	if len(early) != 0 {
		t.Fatalf("future failed claim = %+v, want no rows", early)
	}
	if err := repo.MarkEventRowFailed(companyID, row.EventID, "retry now", time.Now().UTC().Add(-time.Second)); err != nil {
		t.Fatalf("MarkEventRowFailed past: %v", err)
	}
	retry, err := repo.ClaimAvailableEventRows(10, time.Minute)
	if err != nil {
		t.Fatalf("ClaimAvailableEventRows retry: %v", err)
	}
	if len(retry) != 1 || retry[0].EventID != row.EventID || retry[0].AttemptCount != 2 {
		t.Fatalf("retry claim = %+v, want failed row after available_at with second attempt", retry)
	}
}
