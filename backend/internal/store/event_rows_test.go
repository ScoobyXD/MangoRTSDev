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

func TestGVICMatrixMutationInsertsEventRowWithProjectionDelta(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999109"
	repo.EnsureCompany(companyID, "GVICMatrix Event Rows Co")
	user, err := repo.UpsertAuthUser("GVICMatrix-event-user", "GVICMatrix-event-user@example.com", "GVICMatrix Event User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "GVICMatrix event row gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "GVICMatrix event row node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	if _, err := repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		ActorUserID:    user.UserID,
		IdempotencyKey: "GVICMatrix-add-event-row",
		Assignments: []LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: user.UserID,
		}},
	}); err != nil {
		t.Fatalf("AddLogicGateGVICAssignments: %v", err)
	}

	rows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	var row EventRow
	for _, candidate := range rows {
		if candidate.EventType == EventTypeGVICMatrixProjectionDelta {
			row = candidate
			break
		}
	}
	wantScope := GVICMatrixRealtimeUserScope(user.UserID)
	wantSequenceScope := GVICMatrixProjectionUserScope(user.UserID)
	if row.EventID == "" || row.PrimaryScope != wantScope || row.SequenceScope != wantSequenceScope || row.Sequence != 1 {
		t.Fatalf("GVICMatrix event row = %+v, want scope=%s sequence_scope=%s", row, wantScope, wantSequenceScope)
	}
	if !eventRowTestScopeContains(row.AffectedScopes, wantScope) {
		t.Fatalf("GVICMatrix affected scopes = %+v, want %s", row.AffectedScopes, wantScope)
	}
	if myWorkScope := MyWorkUserScope(user.UserID); !eventRowTestScopeContains(row.AffectedScopes, myWorkScope) {
		t.Fatalf("GVICMatrix affected scopes = %+v, want %s", row.AffectedScopes, myWorkScope)
	}
	if companyScope := MyWorkCompanyScope(companyID); eventRowTestScopeContains(row.AffectedScopes, companyScope) {
		t.Fatalf("GVICMatrix affected scopes = %+v, should not include broad %s when user scope is known", row.AffectedScopes, companyScope)
	}
	payload, err := DecodeGVICMatrixProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeGVICMatrixProjectionDeltaEventPayload: %v", err)
	}
	if payload.Projection != ProjectionNameGVICMatrix || payload.Scope != wantScope || payload.ProjectionScope != wantSequenceScope || len(payload.Deltas) == 0 {
		t.Fatalf("payload = %+v, want GVICMatrix projection deltas", payload)
	}
}

func TestGVICEffectiveProjectionDeltaEventInputsRecordMyWorkUserScope(t *testing.T) {
	companyID := "99999999-9999-4999-8999-999999999111"
	userID := "11111111-1111-4111-8111-111111111111"
	inputs := GVICProjectionDeltaEventInputs(companyID, "", "", []ProjectionDelta{{
		Projection: ProjectionNameGVICEffectiveAssignments,
		Operation:  ProjectionDeltaOperationUpsert,
		RowKey: ProjectionRowKey{
			UserID: userID,
		},
	}})
	if len(inputs) != 1 {
		t.Fatalf("GVICProjectionDeltaEventInputs returned %d rows, want 1", len(inputs))
	}
	row := inputs[0]
	if row.PrimaryScope != "gvic:user:"+userID {
		t.Fatalf("GVIC effective event row primary scope = %q, want user scope", row.PrimaryScope)
	}
	if !eventRowTestScopeContains(row.AffectedScopes, MyWorkUserScope(userID)) {
		t.Fatalf("GVIC effective affected scopes = %+v, want %s", row.AffectedScopes, MyWorkUserScope(userID))
	}
	if eventRowTestScopeContains(row.AffectedScopes, MyWorkCompanyScope(companyID)) {
		t.Fatalf("GVIC effective affected scopes = %+v, should not include company scope when user scope is known", row.AffectedScopes)
	}
}

func TestGVICMatrixMutationEventRowRollbackLeavesNoEventRow(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999110"
	repo.EnsureCompany(companyID, "GVICMatrix Rollback Co")
	user, err := repo.UpsertAuthUser("GVICMatrix-rollback-user", "GVICMatrix-rollback-user@example.com", "GVICMatrix Rollback User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "GVICMatrix rollback gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "GVICMatrix rollback node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	beforeRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}

	repo.eventRowAppendErr = errors.New("forced GVICMatrix event row failure")
	_, err = repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: user.UserID,
		}},
	})
	if !errors.Is(err, repo.eventRowAppendErr) {
		t.Fatalf("AddLogicGateGVICAssignments error = %v, want forced event row failure", err)
	}
	repo.eventRowAppendErr = nil
	afterRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows after: %v", err)
	}
	if len(afterRows) != len(beforeRows) {
		t.Fatalf("event rows after rollback = %d, want %d", len(afterRows), len(beforeRows))
	}
	assignments, err := repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: user.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("AddLogicGateGVICAssignments after rollback: %v", err)
	}
	if !assignments.Changed {
		t.Fatalf("GVICMatrix assignment was not rolled back")
	}
}

func eventRowTestScopeContains(scopes []string, want string) bool {
	for _, scope := range scopes {
		if scope == want {
			return true
		}
	}
	return false
}

func TestGVICMatrixNodeCreateForExistingLogicGateWritesProjectionEventRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999114"
	repo.EnsureCompany(companyID, "GVICMatrix Matrix Existing Gate Event Rows Co")
	user, err := repo.UpsertAuthUser("GVICMatrix-matrix-existing-user", "GVICMatrix-matrix-existing-user@example.com", "GVICMatrix Matrix Existing User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "GVICMatrix matrix existing gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: user.UserID,
		}},
	}); err != nil {
		t.Fatalf("AddLogicGateGVICAssignments setup: %v", err)
	}

	beforeRows, err := repo.ListEventRows(companyID, 20)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}
	priority := 3
	nodeID := "11111111-1111-4111-8111-111111111115"
	if _, err := repo.CreateGVICMatrixNode(GVICMatrixNodeCreateInput{
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		NodeID:         nodeID,
		Title:          "GVICMatrix matrix existing gate node",
		Status:         LogicGateWorkStatusPending,
		Priority:       &priority,
		PrioritySet:    true,
		ActorUserID:    user.UserID,
		IdempotencyKey: "GVICMatrix-matrix-existing-event-row",
	}); err != nil {
		t.Fatalf("CreateGVICMatrixNode existing gate: %v", err)
	}

	newRows := eventRowsAfterPrefixForTest(t, repo, companyID, len(beforeRows))
	kanbanRows := eventRowsOfTypeForTest(newRows, EventTypeKanbanProjectionDelta)
	GVICMatrixRows := eventRowsOfTypeForTest(newRows, EventTypeGVICMatrixProjectionDelta)
	if len(kanbanRows) != 1 || len(GVICMatrixRows) != 1 {
		t.Fatalf("new event rows = %+v, want exactly one Kanban and one GVICMatrix row", newRows)
	}
	assertKanbanProjectionEventRowForLogicGate(t, kanbanRows[0], logicGate.LogicGateID, 1)
	assertGVICMatrixProjectionEventRowForUser(t, GVICMatrixRows[0], user.UserID, 2, []string{EntityTypeNode})
}

func TestGVICMatrixNodeCreateWithNewLogicGateWritesProjectionEventRowsOnce(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999116"
	repo.EnsureCompany(companyID, "GVICMatrix Matrix New Gate Event Rows Co")
	user, err := repo.UpsertAuthUser("GVICMatrix-matrix-new-user", "GVICMatrix-matrix-new-user@example.com", "GVICMatrix Matrix New User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}

	priority := 4
	nodeID := "11111111-1111-4111-8111-111111111116"
	result, err := repo.CreateGVICMatrixNode(GVICMatrixNodeCreateInput{
		CompanyID:                companyID,
		NodeID:                   nodeID,
		Title:                    "GVICMatrix matrix new gate node",
		CreateLogicGateHeader:    "GVICMatrix matrix new gate",
		CreatorLogicGateGVICRole: domain.GVICRoleGenerated,
		Status:                   LogicGateWorkStatusPending,
		Priority:                 &priority,
		PrioritySet:              true,
		ActorUserID:              user.UserID,
		IdempotencyKey:           "GVICMatrix-matrix-new-event-row",
	})
	if err != nil {
		t.Fatalf("CreateGVICMatrixNode new gate: %v", err)
	}
	if result.LogicGate == nil {
		t.Fatalf("CreateGVICMatrixNode returned no created logic gate")
	}

	rows, err := repo.ListEventRows(companyID, 20)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	kanbanRows := eventRowsOfTypeForTest(rows, EventTypeKanbanProjectionDelta)
	GVICMatrixRows := eventRowsOfTypeForTest(rows, EventTypeGVICMatrixProjectionDelta)
	if len(kanbanRows) != 1 || len(GVICMatrixRows) != 1 {
		t.Fatalf("event rows = %+v, want one Kanban row and one GVICMatrix row for created logic-gate projection", rows)
	}
	assertKanbanProjectionEventRowForLogicGate(t, kanbanRows[0], result.LogicGate.LogicGateID, 1)
	assertGVICMatrixProjectionEventRowForUser(t, GVICMatrixRows[0], user.UserID, 1, []string{EntityTypeLogicGate})
	if current, err := repo.CurrentEventRowSequence(companyID, GVICMatrixProjectionUserScope(user.UserID)); err != nil || current != 1 {
		t.Fatalf("CurrentEventRowSequence GVICMatrix = %d err=%v, want 1", current, err)
	}
}

func TestUpdateNodeAndWorkspaceEventWritesProjectionEventRowsForTitleChange(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999117"
	repo.EnsureCompany(companyID, "Node Title Projection Event Rows Co")
	user, err := repo.UpsertAuthUser("node-title-projection-user", "node-title-projection@example.com", "Node Title Projection User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Node title projection gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		ActorUserID: user.UserID,
		Assignments: []LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: user.UserID,
		}},
	}); err != nil {
		t.Fatalf("AddLogicGateGVICAssignments: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Old projection title")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: user.UserID,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	beforeRows, err := repo.ListEventRows(companyID, 20)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}

	const updatedTitle = "Live projection title"
	if _, _, err := repo.UpdateNodeAndWorkspaceEvent(UpdateNodeInput{
		CompanyID:   companyID,
		NodeID:      node.NodeID,
		Title:       updatedTitle,
		TitleSet:    true,
		ActorUserID: user.UserID,
	}); err != nil {
		t.Fatalf("UpdateNodeAndWorkspaceEvent: %v", err)
	}

	newRows := eventRowsAfterPrefixForTest(t, repo, companyID, len(beforeRows))
	kanbanRows := eventRowsOfTypeForTest(newRows, EventTypeKanbanProjectionDelta)
	GVICMatrixRows := eventRowsOfTypeForTest(newRows, EventTypeGVICMatrixProjectionDelta)
	if len(kanbanRows) != 1 || len(GVICMatrixRows) != 1 {
		t.Fatalf("new event rows = %+v, want exactly one Kanban and one GVICMatrix row", newRows)
	}
	kanbanPayload, err := DecodeKanbanProjectionDeltaEventPayload(kanbanRows[0])
	if err != nil {
		t.Fatalf("DecodeKanbanProjectionDeltaEventPayload: %v", err)
	}
	if len(kanbanPayload.Deltas) != 1 || kanbanPayload.Deltas[0].Row == nil || kanbanPayload.Deltas[0].Row.NodeTitle != updatedTitle {
		t.Fatalf("Kanban title delta = %+v, want node_title %q", kanbanPayload.Deltas, updatedTitle)
	}
	GVICMatrixPayload, err := DecodeGVICMatrixProjectionDeltaEventPayload(GVICMatrixRows[0])
	if err != nil {
		t.Fatalf("DecodeGVICMatrixProjectionDeltaEventPayload: %v", err)
	}
	if len(GVICMatrixPayload.Deltas) != 1 || GVICMatrixPayload.Deltas[0].Row == nil || GVICMatrixPayload.Deltas[0].Row.NodeName != updatedTitle {
		t.Fatalf("GVICMatrix title delta = %+v, want node_name %q", GVICMatrixPayload.Deltas, updatedTitle)
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

func TestEditorProjectInformationWritesSourceProjectionAndEventRow(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999114"
	actorID := "11111111-1111-4111-8111-111111111115"
	repo.EnsureCompany(companyID, "Editor Project Event Rows Co")
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID,
		Name:      "Editor event row project",
		Status:    ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	projectID := projectResult.Project.ProjectID
	informationID := "11111111-1111-4111-8111-111111111116"
	item, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID:     companyID,
		ProjectID:     projectID,
		InformationID: informationID,
		Type:          "Text box",
		Information:   "project editor content",
		ActorUserID:   actorID,
	})
	if err != nil {
		t.Fatalf("AddProjectInformation: %v", err)
	}

	view, err := repo.GetProjectView(companyID, projectID, "")
	if err != nil {
		t.Fatalf("GetProjectView: %v", err)
	}
	if len(view.Information) != 1 || view.Information[0].InformationID != item.InformationID || view.Information[0].Information != "project editor content" {
		t.Fatalf("project source information = %+v, want saved source item %+v", view.Information, item)
	}
	projections, err := repo.ListProjectProjections(companyID, projectID)
	if err != nil {
		t.Fatalf("ListProjectProjections: %v", err)
	}
	if len(projections) != 1 || projections[0].InformationID != informationID || projections[0].Information != "project editor content" {
		t.Fatalf("project projections = %+v, want one editor projection", projections)
	}
	row := latestEventRowOfTypeForTest(t, repo, companyID, EventTypeEditorProjectionDelta)
	wantScope := EditorRealtimeScope(EntityTypeProject, projectID)
	if row.PrimaryScope != wantScope || row.SequenceScope != wantScope || row.Sequence != 1 || row.ActorUserID != actorID {
		t.Fatalf("editor project event row = %+v, want scope=%s sequence=1 actor=%s", row, wantScope, actorID)
	}
	payload, err := DecodeEditorProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeEditorProjectionDeltaEventPayload: %v", err)
	}
	if payload.Scope != wantScope || payload.ResourceType != EntityTypeProject || payload.ResourceID != projectID || len(payload.Deltas) != 1 {
		t.Fatalf("payload = %+v, want one project editor delta for %s", payload, wantScope)
	}
	delta := payload.Deltas[0]
	if delta.Operation != ProjectionDeltaOperationUpsert || delta.Row == nil || delta.Row.ProjectID != projectID || delta.Row.InformationID != informationID || delta.Row.Information != "project editor content" {
		t.Fatalf("delta = %+v, want project upsert row", delta)
	}
}

func TestEditorProjectProjectionDeleteInsertsDeleteEventRow(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999115"
	actorID := "11111111-1111-4111-8111-111111111117"
	repo.EnsureCompany(companyID, "Editor Project Delete Event Rows Co")
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID,
		Name:      "Editor delete event row project",
		Status:    ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	projectID := projectResult.Project.ProjectID
	informationID := "11111111-1111-4111-8111-111111111118"
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID:     companyID,
		ProjectID:     projectID,
		InformationID: informationID,
		Type:          "Text box",
		Information:   "delete me",
	}); err != nil {
		t.Fatalf("AddProjectInformation: %v", err)
	}
	if err := repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID:     companyID,
		ProjectID:     projectID,
		InformationID: informationID,
		ActorUserID:   actorID,
	}); err != nil {
		t.Fatalf("DeleteProjectProjection: %v", err)
	}
	projections, err := repo.ListProjectProjections(companyID, projectID)
	if err != nil {
		t.Fatalf("ListProjectProjections: %v", err)
	}
	if len(projections) != 0 {
		t.Fatalf("project projections after delete = %+v, want none", projections)
	}
	row := latestEventRowOfTypeForTest(t, repo, companyID, EventTypeEditorProjectionDelta)
	wantScope := EditorRealtimeScope(EntityTypeProject, projectID)
	if row.PrimaryScope != wantScope || row.SequenceScope != wantScope || row.Sequence != 2 || row.ActorUserID != actorID {
		t.Fatalf("editor project delete event row = %+v, want scope=%s sequence=2 actor=%s", row, wantScope, actorID)
	}
	payload, err := DecodeEditorProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeEditorProjectionDeltaEventPayload: %v", err)
	}
	if payload.Scope != wantScope || payload.ResourceType != EntityTypeProject || payload.ResourceID != projectID || len(payload.Deltas) != 1 {
		t.Fatalf("payload = %+v, want one project editor delete delta for %s", payload, wantScope)
	}
	delta := payload.Deltas[0]
	if delta.Operation != ProjectionDeltaOperationDelete || delta.Row != nil || delta.RowKey.InformationID != informationID {
		t.Fatalf("delta = %+v, want project delete row key", delta)
	}
}

func TestEditorProjectInformationEventRowRollbackLeavesNoSourceOrProjection(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999116"
	repo.EnsureCompany(companyID, "Editor Project Rollback Co")
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID,
		Name:      "Editor rollback project",
		Status:    ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	projectID := projectResult.Project.ProjectID
	beforeRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}

	repo.eventRowAppendErr = errors.New("forced project editor event row failure")
	_, err = repo.AddProjectInformation(ProjectInformationInput{
		CompanyID:     companyID,
		ProjectID:     projectID,
		InformationID: "11111111-1111-4111-8111-111111111119",
		Type:          "Text box",
		Information:   "rollback project content",
	})
	if !errors.Is(err, repo.eventRowAppendErr) {
		t.Fatalf("AddProjectInformation error = %v, want forced event row failure", err)
	}
	repo.eventRowAppendErr = nil
	afterRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows after: %v", err)
	}
	if len(afterRows) != len(beforeRows) {
		t.Fatalf("event rows after rollback = %d, want %d", len(afterRows), len(beforeRows))
	}
	view, err := repo.GetProjectView(companyID, projectID, "")
	if err != nil {
		t.Fatalf("GetProjectView after rollback: %v", err)
	}
	if len(view.Information) != 0 {
		t.Fatalf("project source information after rollback = %+v, want none", view.Information)
	}
	projections, err := repo.ListProjectProjections(companyID, projectID)
	if err != nil {
		t.Fatalf("ListProjectProjections after rollback: %v", err)
	}
	if len(projections) != 0 {
		t.Fatalf("project projections after rollback = %+v, want none", projections)
	}
}

func TestEditorProjectProjectionDeleteEventRowRollbackRestoresProjection(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999117"
	repo.EnsureCompany(companyID, "Editor Project Delete Rollback Co")
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID,
		Name:      "Editor delete rollback project",
		Status:    ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	projectID := projectResult.Project.ProjectID
	informationID := "11111111-1111-4111-8111-111111111120"
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID:     companyID,
		ProjectID:     projectID,
		InformationID: informationID,
		Type:          "Text box",
		Information:   "keep me",
	}); err != nil {
		t.Fatalf("AddProjectInformation: %v", err)
	}
	beforeRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}

	repo.eventRowAppendErr = errors.New("forced project editor delete event row failure")
	err = repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID:     companyID,
		ProjectID:     projectID,
		InformationID: informationID,
	})
	if !errors.Is(err, repo.eventRowAppendErr) {
		t.Fatalf("DeleteProjectProjection error = %v, want forced event row failure", err)
	}
	repo.eventRowAppendErr = nil
	afterRows, err := repo.ListEventRows(companyID, 10)
	if err != nil {
		t.Fatalf("ListEventRows after: %v", err)
	}
	if len(afterRows) != len(beforeRows) {
		t.Fatalf("event rows after rollback = %d, want %d", len(afterRows), len(beforeRows))
	}
	projections, err := repo.ListProjectProjections(companyID, projectID)
	if err != nil {
		t.Fatalf("ListProjectProjections after rollback: %v", err)
	}
	if len(projections) != 1 || projections[0].InformationID != informationID || projections[0].Information != "keep me" {
		t.Fatalf("project projections after delete rollback = %+v, want original projection", projections)
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

func assertGVICMatrixProjectionEventRowForUser(t *testing.T, row EventRow, userID string, wantSequence int64, wantResourceTypes []string) {
	t.Helper()
	wantScope := GVICMatrixRealtimeUserScope(userID)
	wantSequenceScope := GVICMatrixProjectionUserScope(userID)
	if row.EventID == "" || row.PrimaryScope != wantScope || row.SequenceScope != wantSequenceScope || row.Sequence != wantSequence {
		t.Fatalf("GVICMatrix event row = %+v, want scope=%s sequence_scope=%s sequence=%d", row, wantScope, wantSequenceScope, wantSequence)
	}
	payload, err := DecodeGVICMatrixProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeGVICMatrixProjectionDeltaEventPayload: %v", err)
	}
	if payload.Projection != ProjectionNameGVICMatrix || payload.Scope != wantScope || payload.ProjectionScope != wantSequenceScope || len(payload.Deltas) == 0 {
		t.Fatalf("GVICMatrix payload = %+v, want deltas for %s", payload, wantScope)
	}
	gotResourceTypes := make([]string, 0, len(payload.Deltas))
	for _, delta := range payload.Deltas {
		switch {
		case delta.RowKey.NodeID != "":
			if delta.RowKey.ProjectionRowID == "" {
				t.Fatalf("GVICMatrix node payload row key = %+v, want projection_row_id", delta.RowKey)
			}
			gotResourceTypes = append(gotResourceTypes, EntityTypeNode)
		case delta.RowKey.ResourceType == EntityTypeLogicGate && delta.RowKey.ResourceID != "":
			gotResourceTypes = append(gotResourceTypes, EntityTypeLogicGate)
		default:
			t.Fatalf("GVICMatrix payload row key = %+v, want node or logic gate resource", delta.RowKey)
		}
	}
	if !sameStringSet(gotResourceTypes, wantResourceTypes) {
		t.Fatalf("GVICMatrix payload resource types = %+v, want %+v", gotResourceTypes, wantResourceTypes)
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
