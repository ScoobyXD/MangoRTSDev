package httpapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"miraeopus/backend/internal/store"
)

func TestGVICMatrixProjectionDeltaFanoutIsScopedAndPermissionFiltered(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777402"
	repo.EnsureCompany(companyID, "GVICMatrix Projection Fanout Co")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "GVICMatrix-projection-viewer")
	other := mustLogicGateWorkHTTPUser(t, repo, companyID, "GVICMatrix-projection-other")
	blocked := mustLogicGateWorkHTTPUser(t, repo, companyID, "GVICMatrix-projection-blocked")

	visibleNode, err := repo.CreateNode(companyID, "Visible projection node")
	if err != nil {
		t.Fatalf("CreateNode visible: %v", err)
	}
	hiddenNode, err := repo.CreateNode(companyID, "Hidden projection node")
	if err != nil {
		t.Fatalf("CreateNode hidden: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         hiddenNode.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions hidden: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()

	viewerCh := server.projectionHub.subscribe(companyID, store.ProjectionNameGVICMatrix, projectionUserScope(viewer.UserID))
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameGVICMatrix, projectionUserScope(viewer.UserID), viewerCh)
	otherCh := server.projectionHub.subscribe(companyID, store.ProjectionNameGVICMatrix, projectionUserScope(other.UserID))
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameGVICMatrix, projectionUserScope(other.UserID), otherCh)
	blockedCh := server.projectionHub.subscribe(companyID, store.ProjectionNameGVICMatrix, projectionUserScope(blocked.UserID))
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameGVICMatrix, projectionUserScope(blocked.UserID), blockedCh)

	server.publishProjectionDeltasAsync([]store.ProjectionDelta{
		GVICMatrixProjectionDeltaForTest(companyID, viewer.UserID, visibleNode.NodeID, visibleNode.Title, visibleNode.CreatedTimestamp),
	})
	envelope := readProjectionEnvelopeForTest(t, viewerCh)
	if envelope.ProjectionSequence <= 0 || len(envelope.Deltas) != 1 {
		t.Fatalf("viewer envelope = %+v, want one sequenced delta", envelope)
	}
	if envelope.Deltas[0].Operation != store.ProjectionDeltaOperationUpsert || envelope.Deltas[0].Row == nil || envelope.Deltas[0].Row.NodeID != visibleNode.NodeID {
		t.Fatalf("viewer delta = %+v, want upsert row for visible node", envelope.Deltas[0])
	}
	assertNoProjectionPayloadForTest(t, otherCh)

	server.publishProjectionDeltasAsync([]store.ProjectionDelta{
		GVICMatrixProjectionDeltaForTest(companyID, blocked.UserID, hiddenNode.NodeID, hiddenNode.Title, hiddenNode.CreatedTimestamp),
	})
	blockedEnvelope := readProjectionEnvelopeForTest(t, blockedCh)
	if len(blockedEnvelope.Deltas) != 1 {
		t.Fatalf("blocked envelope = %+v, want one delta", blockedEnvelope)
	}
	if blockedEnvelope.Deltas[0].Operation != store.ProjectionDeltaOperationDelete || blockedEnvelope.Deltas[0].Row != nil {
		t.Fatalf("blocked delta = %+v, want delete without row payload", blockedEnvelope.Deltas[0])
	}
}

func TestGVICMatrixProjectionSequencesAreUserScoped(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777404"
	repo.EnsureCompany(companyID, "GVICMatrix Projection Sequence Scope Co")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "GVICMatrix-sequence-viewer")
	other := mustLogicGateWorkHTTPUser(t, repo, companyID, "GVICMatrix-sequence-other")

	node, err := repo.CreateNode(companyID, "Scoped GVIC sequence node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()

	viewerScope := projectionUserScope(viewer.UserID)
	otherScope := projectionUserScope(other.UserID)
	viewerCh := server.projectionHub.subscribe(companyID, store.ProjectionNameGVICMatrix, viewerScope)
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameGVICMatrix, viewerScope, viewerCh)
	otherCh := server.projectionHub.subscribe(companyID, store.ProjectionNameGVICMatrix, otherScope)
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameGVICMatrix, otherScope, otherCh)

	server.publishProjectionDeltasAsync([]store.ProjectionDelta{
		GVICMatrixProjectionDeltaForTest(companyID, viewer.UserID, node.NodeID, node.Title, node.CreatedTimestamp),
	})
	firstViewer := readProjectionEnvelopeForTest(t, viewerCh)
	if firstViewer.ProjectionScope != viewerScope || firstViewer.ProjectionSequence != 1 {
		t.Fatalf("first viewer envelope = %+v, want user scope %q sequence 1", firstViewer, viewerScope)
	}

	server.publishProjectionDeltasAsync([]store.ProjectionDelta{
		GVICMatrixProjectionDeltaForTest(companyID, other.UserID, node.NodeID, node.Title, node.CreatedTimestamp),
	})
	firstOther := readProjectionEnvelopeForTest(t, otherCh)
	if firstOther.ProjectionScope != otherScope || firstOther.ProjectionSequence != 1 {
		t.Fatalf("first other envelope = %+v, want user scope %q sequence 1", firstOther, otherScope)
	}

	server.publishProjectionDeltasAsync([]store.ProjectionDelta{
		GVICMatrixProjectionDeltaForTest(companyID, viewer.UserID, node.NodeID, node.Title, node.CreatedTimestamp),
	})
	secondViewer := readProjectionEnvelopeForTest(t, viewerCh)
	if secondViewer.ProjectionSequence != 2 {
		t.Fatalf("second viewer sequence = %d, want 2", secondViewer.ProjectionSequence)
	}
}

func TestKanbanProjectionDeltaFanoutIsActiveBoardScopedAndPermissionFiltered(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777502"
	repo.EnsureCompany(companyID, "Kanban Projection Fanout Co")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "kanban-projection-viewer")
	other := mustLogicGateWorkHTTPUser(t, repo, companyID, "kanban-projection-other")
	blocked := mustLogicGateWorkHTTPUser(t, repo, companyID, "kanban-projection-blocked")

	logicGate, err := repo.CreateLogicGate(companyID, "Visible Kanban Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Visible Kanban Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	assigned, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: viewer.UserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions node: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()

	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	viewerScope := projectionKanbanBoardUserScope(boardID, viewer.UserID)
	blockedScope := projectionKanbanBoardUserScope(boardID, blocked.UserID)
	otherScope := projectionKanbanBoardUserScope(store.LogicGateKanbanBoardID("other-gate"), other.UserID)
	viewerCh := server.projectionHub.subscribe(companyID, store.ProjectionNameKanbanBoard, viewerScope)
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameKanbanBoard, viewerScope, viewerCh)
	blockedCh := server.projectionHub.subscribe(companyID, store.ProjectionNameKanbanBoard, blockedScope)
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameKanbanBoard, blockedScope, blockedCh)
	otherCh := server.projectionHub.subscribe(companyID, store.ProjectionNameKanbanBoard, otherScope)
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameKanbanBoard, otherScope, otherCh)

	rows, err := repo.ListKanbanBoardProjectionRowsForNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListKanbanBoardProjectionRowsForNode: %v", err)
	}
	server.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rows))

	envelope := readProjectionEnvelopeForTest(t, viewerCh)
	if envelope.Projection != store.ProjectionNameKanbanBoard || envelope.ProjectionSequence <= 0 || len(envelope.Deltas) != 1 {
		t.Fatalf("viewer envelope = %+v, want one sequenced Kanban delta", envelope)
	}
	if got := envelope.Deltas[0]; got.Operation != store.ProjectionDeltaOperationUpsert || got.Row == nil || got.Row.CardID != assigned.Card.CardID || got.Row.BoardID != boardID || got.Row.Priority == nil || *got.Row.Priority != priority {
		t.Fatalf("viewer delta = %+v, want upsert row for visible Kanban card", got)
	}
	assertNoProjectionPayloadForTest(t, otherCh)

	blockedEnvelope := readProjectionEnvelopeForTest(t, blockedCh)
	if len(blockedEnvelope.Deltas) != 1 {
		t.Fatalf("blocked envelope = %+v, want one delta", blockedEnvelope)
	}
	if got := blockedEnvelope.Deltas[0]; got.Operation != store.ProjectionDeltaOperationDelete || got.Row != nil || got.RowKey.CardID != assigned.Card.CardID || got.RowKey.BoardID != boardID {
		t.Fatalf("blocked delta = %+v, want delete without Kanban row payload", got)
	}
}

func TestKanbanProjectionSequencesAreBoardScoped(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777504"
	repo.EnsureCompany(companyID, "Kanban Projection Sequence Scope Co")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "kanban-sequence-viewer")

	logicGateA, err := repo.CreateLogicGate(companyID, "Board A Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate A: %v", err)
	}
	nodeA, err := repo.CreateNode(companyID, "Board A Node")
	if err != nil {
		t.Fatalf("CreateNode A: %v", err)
	}
	priorityA := 2
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGateA.LogicGateID,
		NodeID:      nodeA.NodeID,
		Status:      "pending",
		Priority:    &priorityA,
		PrioritySet: true,
		ActorUserID: viewer.UserID,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus A: %v", err)
	}

	logicGateB, err := repo.CreateLogicGate(companyID, "Board B Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate B: %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Board B Node")
	if err != nil {
		t.Fatalf("CreateNode B: %v", err)
	}
	priorityB := 3
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGateB.LogicGateID,
		NodeID:      nodeB.NodeID,
		Status:      "pending",
		Priority:    &priorityB,
		PrioritySet: true,
		ActorUserID: viewer.UserID,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus B: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()

	boardA := store.LogicGateKanbanBoardID(logicGateA.LogicGateID)
	boardB := store.LogicGateKanbanBoardID(logicGateB.LogicGateID)
	boardAScope := projectionKanbanBoardScopePrefix(boardA)
	boardBScope := projectionKanbanBoardScopePrefix(boardB)
	boardACh := server.projectionHub.subscribe(companyID, store.ProjectionNameKanbanBoard, projectionKanbanBoardUserScope(boardA, viewer.UserID))
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameKanbanBoard, projectionKanbanBoardUserScope(boardA, viewer.UserID), boardACh)
	boardBCh := server.projectionHub.subscribe(companyID, store.ProjectionNameKanbanBoard, projectionKanbanBoardUserScope(boardB, viewer.UserID))
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameKanbanBoard, projectionKanbanBoardUserScope(boardB, viewer.UserID), boardBCh)

	rowsA, err := repo.ListKanbanBoardProjectionRowsForNode(companyID, nodeA.NodeID)
	if err != nil {
		t.Fatalf("ListKanbanBoardProjectionRowsForNode A: %v", err)
	}
	rowsB, err := repo.ListKanbanBoardProjectionRowsForNode(companyID, nodeB.NodeID)
	if err != nil {
		t.Fatalf("ListKanbanBoardProjectionRowsForNode B: %v", err)
	}

	server.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rowsA))
	firstA := readProjectionEnvelopeForTest(t, boardACh)
	if firstA.ProjectionScope != boardAScope || firstA.ProjectionSequence != 1 {
		t.Fatalf("first board A envelope = %+v, want scope %q sequence 1", firstA, boardAScope)
	}

	server.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rowsB))
	firstB := readProjectionEnvelopeForTest(t, boardBCh)
	if firstB.ProjectionScope != boardBScope || firstB.ProjectionSequence != 1 {
		t.Fatalf("first board B envelope = %+v, want scope %q sequence 1", firstB, boardBScope)
	}

	server.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rowsA))
	secondA := readProjectionEnvelopeForTest(t, boardACh)
	if secondA.ProjectionScope != boardAScope || secondA.ProjectionSequence != 2 {
		t.Fatalf("second board A envelope = %+v, want scope %q sequence 2", secondA, boardAScope)
	}

	boardASequence, err := repo.CurrentProjectionSequence(companyID, store.ProjectionNameKanbanBoard, boardAScope)
	if err != nil {
		t.Fatalf("CurrentProjectionSequence board A: %v", err)
	}
	boardBSequence, err := repo.CurrentProjectionSequence(companyID, store.ProjectionNameKanbanBoard, boardBScope)
	if err != nil {
		t.Fatalf("CurrentProjectionSequence board B: %v", err)
	}
	if boardASequence != 2 || boardBSequence != 1 {
		t.Fatalf("board sequences A=%d B=%d, want A=2 B=1", boardASequence, boardBSequence)
	}
}

func TestKanbanProjectionPermissionRevocationPublishesDeleteWithoutRowPayload(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777503"
	repo.EnsureCompany(companyID, "Kanban Projection Revocation Co")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "kanban-revocation-viewer")

	logicGate, err := repo.CreateLogicGate(companyID, "Revoked Kanban Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Revoked Kanban Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 3
	assigned, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: viewer.UserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions grant: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()

	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	viewerScope := projectionKanbanBoardUserScope(boardID, viewer.UserID)
	viewerCh := server.projectionHub.subscribe(companyID, store.ProjectionNameKanbanBoard, viewerScope)
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameKanbanBoard, viewerScope, viewerCh)

	rows, err := repo.ListKanbanBoardProjectionRowsForNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListKanbanBoardProjectionRowsForNode grant: %v", err)
	}
	server.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rows))
	initial := readProjectionEnvelopeForTest(t, viewerCh)
	if len(initial.Deltas) != 1 || initial.Deltas[0].Operation != store.ProjectionDeltaOperationUpsert || initial.Deltas[0].Row == nil {
		t.Fatalf("initial delta = %+v, want authorized upsert", initial)
	}

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}

	server.publishKanbanPermissionProjectionDeltasAsync(companyID, store.EntityTypeNode, node.NodeID)
	revoked := readProjectionEnvelopeForTest(t, viewerCh)
	if len(revoked.Deltas) != 1 {
		t.Fatalf("revoked envelope = %+v, want one delete delta", revoked)
	}
	if got := revoked.Deltas[0]; got.Operation != store.ProjectionDeltaOperationDelete || got.Row != nil || got.RowKey.CardID != assigned.Card.CardID || got.RowKey.NodeID != node.NodeID {
		t.Fatalf("revoked delta = %+v, want delete row key only", got)
	}
}

func TestProjectRelationshipProjectionPermissionRevocationPublishesDeleteWithoutRowPayload(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777704"
	repo.EnsureCompany(companyID, "Project Relationship Projection Revocation Co")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "project-relationship-revocation-viewer")
	projectResult, err := repo.CreateProject(store.ProjectInput{
		CompanyID: companyID,
		Name:      "Revoked Relationship Project",
		Status:    store.ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Revoked Relationship Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	relationshipID := "11111111-1111-4111-8111-111111111704"
	if _, err := repo.UpsertProjectRelationship(store.ProjectRelationshipInput{
		CompanyID:      companyID,
		ProjectID:      projectResult.Project.ProjectID,
		RelationshipID: relationshipID,
		ResourceType:   store.EntityTypeNode,
		ResourceID:     node.NodeID,
		ActorUserID:    viewer.UserID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship: %v", err)
	}
	drainEventRowsForTest(t, repo, companyID)

	server := NewServerWithOptions(repo, ServerOptions{DisableEventWorker: true})
	defer server.Close()
	projectScope := store.ProjectRelationshipProjectionProjectScope(projectResult.Project.ProjectID)
	viewerScope := projectionProjectRelationshipUserScope(projectResult.Project.ProjectID, viewer.UserID)
	viewerCh := server.projectionHub.subscribe(companyID, store.ProjectionNameProjectRelationship, viewerScope)
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameProjectRelationship, viewerScope, viewerCh)

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		ActorUserID:      viewer.UserID,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}
	if processed, err := server.processAvailableEventRows(context.Background(), 10); err != nil || processed == 0 {
		t.Fatalf("processAvailableEventRows processed=%d err=%v, want permission/project relationship events processed", processed, err)
	}
	revoked := readProjectionEnvelopeForTest(t, viewerCh)
	if revoked.Projection != store.ProjectionNameProjectRelationship || revoked.ProjectionScope != projectScope || revoked.ProjectionSequence != 1 || len(revoked.Deltas) != 1 {
		t.Fatalf("revoked envelope = %+v, want one project-scoped relationship delta", revoked)
	}
	if got := revoked.Deltas[0]; got.Operation != store.ProjectionDeltaOperationDelete || got.Row != nil ||
		got.RowKey.ProjectID != projectResult.Project.ProjectID ||
		got.RowKey.RelationshipID != relationshipID ||
		got.RowKey.ResourceType != store.EntityTypeNode ||
		got.RowKey.ResourceID != node.NodeID ||
		got.RowKey.NodeID != node.NodeID {
		t.Fatalf("revoked delta = %+v, want delete row key only for project relationship", got)
	}
}

func GVICMatrixProjectionDeltaForTest(companyID, userID, nodeID, title string, created time.Time) store.ProjectionDelta {
	projectionRowID := "my_work_node_leaf:" + companyID + ":" + userID + ":generated:none:node:" + nodeID + ":project:none:logic_gate:none"
	row := store.GVICMatrixProjectionRow{
		CompanyID:        companyID,
		ProjectionRowID:  projectionRowID,
		UserID:           userID,
		NodeName:         title,
		GVICAssignment:   "generated",
		NodeID:           nodeID,
		CreatedTimestamp: created,
		UpdatedTimestamp: time.Now().UTC(),
	}
	return store.ProjectionDelta{
		CompanyID:  companyID,
		Projection: store.ProjectionNameGVICMatrix,
		Operation:  store.ProjectionDeltaOperationUpsert,
		RowKey: store.ProjectionRowKey{
			UserID:          userID,
			ProjectionRowID: projectionRowID,
			NodeID:          nodeID,
			GVICAssignment:  "generated",
		},
		Row:                &row,
		ProjectedTimestamp: time.Now().UTC(),
	}
}

func readProjectionEnvelopeForTest(t *testing.T, ch <-chan []byte) projectionDeltaEnvelope {
	t.Helper()
	select {
	case payload := <-ch:
		var envelope projectionDeltaEnvelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			t.Fatalf("decode projection envelope: %v payload=%s", err, string(payload))
		}
		return envelope
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for projection payload")
		return projectionDeltaEnvelope{}
	}
}

func assertNoProjectionPayloadForTest(t *testing.T, ch <-chan []byte) {
	t.Helper()
	select {
	case payload := <-ch:
		t.Fatalf("unexpected projection payload: %s", string(payload))
	case <-time.After(25 * time.Millisecond):
	}
}
