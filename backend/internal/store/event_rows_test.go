package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
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

func TestRacioMutationInsertsEventRowWithProjectionDelta(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999109"
	repo.EnsureCompany(companyID, "RACIO Event Rows Co")
	user, err := repo.UpsertAuthUser("racio-event-user", "racio-event-user@example.com", "RACIO Event User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "RACIO event row gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}

	if _, err := repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		ActorUserID:    user.UserID,
		IdempotencyKey: "racio-add-event-row",
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: user.UserID,
		}},
	}); err != nil {
		t.Fatalf("AddLogicGateRaciAssignments: %v", err)
	}

	rows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	var row EventRow
	for _, candidate := range rows {
		if candidate.EventType == EventTypeRacioProjectionDelta {
			row = candidate
			break
		}
	}
	wantScope := RacioRealtimeUserScope(user.UserID)
	wantSequenceScope := RacioProjectionUserScope(user.UserID)
	if row.EventID == "" || row.PrimaryScope != wantScope || row.SequenceScope != wantSequenceScope || row.Sequence != 1 {
		t.Fatalf("RACIO event row = %+v, want scope=%s sequence_scope=%s", row, wantScope, wantSequenceScope)
	}
	payload, err := DecodeRacioProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeRacioProjectionDeltaEventPayload: %v", err)
	}
	if payload.Projection != ProjectionNameRacioMatrix || payload.Scope != wantScope || payload.ProjectionScope != wantSequenceScope || len(payload.Deltas) == 0 {
		t.Fatalf("payload = %+v, want RACIO projection deltas", payload)
	}
}

func TestRacioMutationEventRowRollbackLeavesNoEventRow(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999110"
	repo.EnsureCompany(companyID, "RACIO Rollback Co")
	user, err := repo.UpsertAuthUser("racio-rollback-user", "racio-rollback-user@example.com", "RACIO Rollback User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "RACIO rollback gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	beforeRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}

	repo.eventRowAppendErr = errors.New("forced racio event row failure")
	_, err = repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: user.UserID,
		}},
	})
	if !errors.Is(err, repo.eventRowAppendErr) {
		t.Fatalf("AddLogicGateRaciAssignments error = %v, want forced event row failure", err)
	}
	repo.eventRowAppendErr = nil
	afterRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows after: %v", err)
	}
	if len(afterRows) != len(beforeRows) {
		t.Fatalf("event rows after rollback = %d, want %d", len(afterRows), len(beforeRows))
	}
	assignments, err := repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: user.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("AddLogicGateRaciAssignments after rollback: %v", err)
	}
	if !assignments.Changed {
		t.Fatalf("RACIO assignment was not rolled back")
	}
}

func TestRacioMatrixNodeCreateForExistingLogicGateWritesProjectionEventRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999114"
	repo.EnsureCompany(companyID, "RACIO Matrix Existing Gate Event Rows Co")
	user, err := repo.UpsertAuthUser("racio-matrix-existing-user", "racio-matrix-existing-user@example.com", "RACIO Matrix Existing User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "RACIO matrix existing gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: user.UserID,
		}},
	}); err != nil {
		t.Fatalf("AddLogicGateRaciAssignments setup: %v", err)
	}

	beforeRows, err := repo.ListEventRows(companyID, 20)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}
	priority := 3
	nodeID := "11111111-1111-4111-8111-111111111115"
	if _, err := repo.CreateRacioMatrixNode(RacioMatrixNodeCreateInput{
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		NodeID:         nodeID,
		Title:          "RACIO matrix existing gate node",
		Status:         LogicGateWorkStatusPending,
		Priority:       &priority,
		PrioritySet:    true,
		ActorUserID:    user.UserID,
		IdempotencyKey: "racio-matrix-existing-event-row",
	}); err != nil {
		t.Fatalf("CreateRacioMatrixNode existing gate: %v", err)
	}

	newRows := eventRowsAfterPrefixForTest(t, repo, companyID, len(beforeRows))
	kanbanRows := eventRowsOfTypeForTest(newRows, EventTypeKanbanProjectionDelta)
	racioRows := eventRowsOfTypeForTest(newRows, EventTypeRacioProjectionDelta)
	if len(kanbanRows) != 1 || len(racioRows) != 1 {
		t.Fatalf("new event rows = %+v, want exactly one Kanban and one RACIO row", newRows)
	}
	assertKanbanProjectionEventRowForLogicGate(t, kanbanRows[0], logicGate.LogicGateID, 1)
	assertRacioProjectionEventRowForUser(t, racioRows[0], user.UserID, 2, []string{EntityTypeNode})
}

func TestRacioMatrixNodeCreateWithNewLogicGateWritesProjectionEventRowsOnce(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999116"
	repo.EnsureCompany(companyID, "RACIO Matrix New Gate Event Rows Co")
	user, err := repo.UpsertAuthUser("racio-matrix-new-user", "racio-matrix-new-user@example.com", "RACIO Matrix New User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}

	priority := 4
	nodeID := "11111111-1111-4111-8111-111111111116"
	result, err := repo.CreateRacioMatrixNode(RacioMatrixNodeCreateInput{
		CompanyID:                companyID,
		NodeID:                   nodeID,
		Title:                    "RACIO matrix new gate node",
		CreateLogicGateHeader:    "RACIO matrix new gate",
		CreatorLogicGateRaciRole: domain.LogicGateRaciRoleResponsible,
		Status:                   LogicGateWorkStatusPending,
		Priority:                 &priority,
		PrioritySet:              true,
		ActorUserID:              user.UserID,
		IdempotencyKey:           "racio-matrix-new-event-row",
	})
	if err != nil {
		t.Fatalf("CreateRacioMatrixNode new gate: %v", err)
	}
	if result.LogicGate == nil {
		t.Fatalf("CreateRacioMatrixNode returned no created logic gate")
	}

	rows, err := repo.ListEventRows(companyID, 20)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	kanbanRows := eventRowsOfTypeForTest(rows, EventTypeKanbanProjectionDelta)
	racioRows := eventRowsOfTypeForTest(rows, EventTypeRacioProjectionDelta)
	if len(kanbanRows) != 1 || len(racioRows) != 1 {
		t.Fatalf("event rows = %+v, want one Kanban row and one RACIO row for the created logic-gate projection", rows)
	}
	assertKanbanProjectionEventRowForLogicGate(t, kanbanRows[0], result.LogicGate.LogicGateID, 1)
	assertRacioProjectionEventRowForUser(t, racioRows[0], user.UserID, 1, []string{EntityTypeLogicGate})
	if current, err := repo.CurrentEventRowSequence(companyID, RacioProjectionUserScope(user.UserID)); err != nil || current != 1 {
		t.Fatalf("CurrentEventRowSequence RACIO = %d err=%v, want 1", current, err)
	}
}

func TestEditorNodeInformationInsertsEventRowWithProjectionDelta(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999111"
	repo.EnsureCompany(companyID, "Editor Node Event Rows Co")
	node, err := repo.CreateNode(companyID, "Editor event row node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	informationID := "11111111-1111-4111-8111-111111111111"
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID:     companyID,
		NodeID:        node.NodeID,
		InformationID: informationID,
		Type:          "Text box",
		Information:   "node editor content",
		ActorUserID:   "11111111-1111-4111-8111-111111111112",
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor: %v", err)
	}

	rows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	var row EventRow
	for _, candidate := range rows {
		if candidate.EventType == EventTypeEditorProjectionDelta {
			row = candidate
			break
		}
	}
	wantScope := EditorRealtimeScope(EntityTypeNode, node.NodeID)
	if row.EventID == "" || row.PrimaryScope != wantScope || row.SequenceScope != wantScope || row.Sequence != 1 {
		t.Fatalf("editor node event row = %+v, want scope=%s sequence=1", row, wantScope)
	}
	payload, err := DecodeEditorProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeEditorProjectionDeltaEventPayload: %v", err)
	}
	if payload.Scope != wantScope || payload.ResourceType != EntityTypeNode || payload.ResourceID != node.NodeID || len(payload.Deltas) != 1 {
		t.Fatalf("payload = %+v, want one node editor delta for %s", payload, wantScope)
	}
	delta := payload.Deltas[0]
	if delta.Operation != ProjectionDeltaOperationUpsert || delta.Row == nil || delta.Row.NodeID != node.NodeID || delta.Row.InformationID != informationID || delta.Row.Information != "node editor content" {
		t.Fatalf("delta = %+v, want node upsert row", delta)
	}
	if current, err := repo.CurrentEventRowSequence(companyID, wantScope); err != nil || current != 1 {
		t.Fatalf("CurrentEventRowSequence = %d err=%v, want 1", current, err)
	}
}

func TestEditorLogicGateInformationInsertsEventRowWithProjectionDelta(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999112"
	repo.EnsureCompany(companyID, "Editor Logic Gate Event Rows Co")
	logicGate, err := repo.CreateLogicGate(companyID, "Editor event row gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	informationID := "11111111-1111-4111-8111-111111111113"
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "logic gate editor content", informationID); err != nil {
		t.Fatalf("AddLogicGateInformation: %v", err)
	}

	rows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	var row EventRow
	for _, candidate := range rows {
		if candidate.EventType == EventTypeEditorProjectionDelta {
			row = candidate
			break
		}
	}
	wantScope := EditorRealtimeScope(EntityTypeLogicGate, logicGate.LogicGateID)
	if row.EventID == "" || row.PrimaryScope != wantScope || row.SequenceScope != wantScope || row.Sequence != 1 {
		t.Fatalf("editor logic gate event row = %+v, want scope=%s sequence=1", row, wantScope)
	}
	payload, err := DecodeEditorProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeEditorProjectionDeltaEventPayload: %v", err)
	}
	if payload.Scope != wantScope || payload.ResourceType != EntityTypeLogicGate || payload.ResourceID != logicGate.LogicGateID || len(payload.Deltas) != 1 {
		t.Fatalf("payload = %+v, want one logic gate editor delta for %s", payload, wantScope)
	}
	delta := payload.Deltas[0]
	if delta.Operation != ProjectionDeltaOperationUpsert || delta.Row == nil || delta.Row.LogicGateID != logicGate.LogicGateID || delta.Row.InformationID != informationID || delta.Row.Information != "logic gate editor content" {
		t.Fatalf("delta = %+v, want logic gate upsert row", delta)
	}
}

func TestEditorNodeInformationEventRowRollbackLeavesNoProjection(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999113"
	repo.EnsureCompany(companyID, "Editor Rollback Co")
	node, err := repo.CreateNode(companyID, "Editor rollback node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	beforeRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}

	repo.eventRowAppendErr = errors.New("forced editor event row failure")
	_, err = repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID:     companyID,
		NodeID:        node.NodeID,
		InformationID: "11111111-1111-4111-8111-111111111114",
		Type:          "Text box",
		Information:   "rollback content",
	})
	if !errors.Is(err, repo.eventRowAppendErr) {
		t.Fatalf("AddNodeInformationWithActor error = %v, want forced event row failure", err)
	}
	repo.eventRowAppendErr = nil
	afterRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows after: %v", err)
	}
	if len(afterRows) != len(beforeRows) {
		t.Fatalf("event rows after rollback = %d, want %d", len(afterRows), len(beforeRows))
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections after rollback: %v", err)
	}
	if len(projections) != 0 {
		t.Fatalf("node projections after rollback = %+v, want none", projections)
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

func eventRowsAfterPrefixForTest(t *testing.T, repo *MemoryRepo, companyID string, prefixLen int) []EventRow {
	t.Helper()
	rows, err := repo.ListEventRows(companyID, 50)
	if err != nil {
		t.Fatalf("ListEventRows after: %v", err)
	}
	if prefixLen > len(rows) {
		t.Fatalf("prefixLen %d exceeds event rows %d", prefixLen, len(rows))
	}
	return rows[prefixLen:]
}

func eventRowsOfTypeForTest(rows []EventRow, eventType string) []EventRow {
	out := []EventRow{}
	for _, row := range rows {
		if row.EventType == eventType {
			out = append(out, row)
		}
	}
	return out
}

func assertKanbanProjectionEventRowForLogicGate(t *testing.T, row EventRow, logicGateID string, wantSequence int64) {
	t.Helper()
	wantScope := "board:" + LogicGateKanbanBoardID(logicGateID)
	if row.EventID == "" || row.PrimaryScope != wantScope || row.SequenceScope != wantScope || row.Sequence != wantSequence {
		t.Fatalf("Kanban event row = %+v, want scope=%s sequence=%d", row, wantScope, wantSequence)
	}
	payload, err := DecodeKanbanProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeKanbanProjectionDeltaEventPayload: %v", err)
	}
	if payload.Projection != ProjectionNameKanbanBoard || payload.Scope != wantScope || len(payload.Deltas) == 0 {
		t.Fatalf("Kanban payload = %+v, want deltas for %s", payload, wantScope)
	}
}

func assertRacioProjectionEventRowForUser(t *testing.T, row EventRow, userID string, wantSequence int64, wantResourceTypes []string) {
	t.Helper()
	wantScope := RacioRealtimeUserScope(userID)
	wantSequenceScope := RacioProjectionUserScope(userID)
	if row.EventID == "" || row.PrimaryScope != wantScope || row.SequenceScope != wantSequenceScope || row.Sequence != wantSequence {
		t.Fatalf("RACIO event row = %+v, want scope=%s sequence_scope=%s sequence=%d", row, wantScope, wantSequenceScope, wantSequence)
	}
	payload, err := DecodeRacioProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeRacioProjectionDeltaEventPayload: %v", err)
	}
	if payload.Projection != ProjectionNameRacioMatrix || payload.Scope != wantScope || payload.ProjectionScope != wantSequenceScope || len(payload.Deltas) == 0 {
		t.Fatalf("RACIO payload = %+v, want deltas for %s", payload, wantScope)
	}
	gotResourceTypes := make([]string, 0, len(payload.Deltas))
	for _, delta := range payload.Deltas {
		gotResourceTypes = append(gotResourceTypes, delta.RowKey.ResourceType)
	}
	if !sameStringSet(gotResourceTypes, wantResourceTypes) {
		t.Fatalf("RACIO payload resource types = %+v, want %+v", gotResourceTypes, wantResourceTypes)
	}
}

func sameStringSet(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	counts := map[string]int{}
	for _, value := range left {
		counts[value]++
	}
	for _, value := range right {
		counts[value]--
		if counts[value] < 0 {
			return false
		}
	}
	return true
}
