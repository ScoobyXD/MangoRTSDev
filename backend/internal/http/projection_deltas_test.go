package httpapi

import (
	"encoding/json"
	"testing"
	"time"

	"miraeopus/backend/internal/store"
)

func TestRacioProjectionDeltaFanoutIsScopedAndPermissionFiltered(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777402"
	repo.EnsureCompany(companyID, "RACIO Projection Fanout Co")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "racio-projection-viewer")
	other := mustLogicGateWorkHTTPUser(t, repo, companyID, "racio-projection-other")
	blocked := mustLogicGateWorkHTTPUser(t, repo, companyID, "racio-projection-blocked")

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

	viewerCh := server.projectionHub.subscribe(companyID, store.ProjectionNameRacioMatrix, projectionUserScope(viewer.UserID))
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameRacioMatrix, projectionUserScope(viewer.UserID), viewerCh)
	otherCh := server.projectionHub.subscribe(companyID, store.ProjectionNameRacioMatrix, projectionUserScope(other.UserID))
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameRacioMatrix, projectionUserScope(other.UserID), otherCh)
	blockedCh := server.projectionHub.subscribe(companyID, store.ProjectionNameRacioMatrix, projectionUserScope(blocked.UserID))
	defer server.projectionHub.unsubscribe(companyID, store.ProjectionNameRacioMatrix, projectionUserScope(blocked.UserID), blockedCh)

	server.publishProjectionDeltasAsync([]store.ProjectionDelta{
		racioProjectionDeltaForTest(companyID, viewer.UserID, visibleNode.NodeID, visibleNode.Title, visibleNode.CreatedTimestamp),
	})
	envelope := readProjectionEnvelopeForTest(t, viewerCh)
	if envelope.ProjectionSequence <= 0 || len(envelope.Deltas) != 1 {
		t.Fatalf("viewer envelope = %+v, want one sequenced delta", envelope)
	}
	if envelope.Deltas[0].Operation != store.ProjectionDeltaOperationUpsert || envelope.Deltas[0].Row == nil || envelope.Deltas[0].Row.ResourceID != visibleNode.NodeID {
		t.Fatalf("viewer delta = %+v, want upsert row for visible node", envelope.Deltas[0])
	}
	assertNoProjectionPayloadForTest(t, otherCh)

	server.publishProjectionDeltasAsync([]store.ProjectionDelta{
		racioProjectionDeltaForTest(companyID, blocked.UserID, hiddenNode.NodeID, hiddenNode.Title, hiddenNode.CreatedTimestamp),
	})
	blockedEnvelope := readProjectionEnvelopeForTest(t, blockedCh)
	if len(blockedEnvelope.Deltas) != 1 {
		t.Fatalf("blocked envelope = %+v, want one delta", blockedEnvelope)
	}
	if blockedEnvelope.Deltas[0].Operation != store.ProjectionDeltaOperationDelete || blockedEnvelope.Deltas[0].Row != nil {
		t.Fatalf("blocked delta = %+v, want delete without row payload", blockedEnvelope.Deltas[0])
	}
}

func racioProjectionDeltaForTest(companyID, userID, nodeID, title string, created time.Time) store.ProjectionDelta {
	row := store.RacioMatrixProjectionRow{
		CompanyID:                companyID,
		UserID:                   userID,
		ResourceType:             store.EntityTypeNode,
		ResourceID:               nodeID,
		DisplayTitle:             title,
		ResourceCreatedTimestamp: created,
		UpdatedTimestamp:         time.Now().UTC(),
	}
	return store.ProjectionDelta{
		CompanyID:  companyID,
		Projection: store.ProjectionNameRacioMatrix,
		Operation:  store.ProjectionDeltaOperationUpsert,
		RowKey: store.ProjectionRowKey{
			UserID:       userID,
			ResourceType: store.EntityTypeNode,
			ResourceID:   nodeID,
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
