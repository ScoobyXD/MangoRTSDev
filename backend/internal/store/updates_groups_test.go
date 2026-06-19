package store

import (
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestCollectUpdateResourceIDsSkipsMalformedIDs(t *testing.T) {
	nodeID := "11111111-1111-4111-8111-111111111111"
	logicGateID := "22222222-2222-4222-8222-222222222222"
	projectID := "33333333-3333-4333-8333-333333333333"

	nodeIDs, logicGateIDs, projectIDs := collectUpdateResourceIDs([]domain.Notification{
		{EntityType: EntityTypeNode, EntityID: nodeID, NodeID: "not-a-node-uuid", LogicGateID: "not-a-gate-uuid"},
		{EntityType: EntityTypeLogicGate, EntityID: logicGateID},
		{EntityType: EntityTypeProject, EntityID: projectID},
		{EntityType: EntityTypeProject, EntityID: "not-a-project-uuid"},
	})

	if !nodeIDs[nodeID] {
		t.Fatalf("valid node entity id was not collected")
	}
	if logicGateIDs["not-a-gate-uuid"] {
		t.Fatalf("malformed logic_gate_id should not be collected")
	}
	if !logicGateIDs[logicGateID] {
		t.Fatalf("valid logic gate entity id was not collected")
	}
	if !projectIDs[projectID] {
		t.Fatalf("valid project entity id was not collected")
	}
	if projectIDs["not-a-project-uuid"] {
		t.Fatalf("malformed project entity id should not be collected")
	}
}

func TestPostgresUpdateNotificationAccessTargetSkipsMalformedTarget(t *testing.T) {
	projectID := "44444444-4444-4444-8444-444444444444"
	target, ok := postgresUpdateNotificationAccessTarget(domain.Notification{
		EntityType:  EntityTypeProject,
		EntityID:    projectID,
		LogicGateID: "not-a-gate-uuid",
	})
	if !ok {
		t.Fatalf("expected valid project target")
	}
	if target.ResourceType != EntityTypeProject || target.ResourceID != projectID {
		t.Fatalf("target = %#v, want project %s", target, projectID)
	}
}
