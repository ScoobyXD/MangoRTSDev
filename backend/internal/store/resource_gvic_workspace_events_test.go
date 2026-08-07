package store

import (
	"miraeopus/backend/internal/domain"
	"reflect"
	"testing"
)

func TestResourceGVICUpdatedWorkspaceEventTargetsOnlyNewOrChangedAssignments(t *testing.T) {
	before := []domain.ResourceGVICEffectiveAssignment{
		{UserID: "alice", Role: domain.GVICRoleConsulted},
		{UserID: "removed", Role: domain.GVICRoleInformed},
	}
	after := []domain.ResourceGVICEffectiveAssignment{
		{UserID: "alice", Role: domain.GVICRoleConsulted},
		{UserID: "bob", Role: domain.GVICRoleResponsible},
	}
	if got := resourceGVICChangedUserIDs(before, after); !reflect.DeepEqual(got, []string{"bob"}) {
		t.Fatalf("changed users = %v, want only newly assigned Bob", got)
	}

	result := ResourceGVICAssignmentMutationResult{
		CompanyID:            "company-1",
		ResourceType:         EntityTypeNode,
		ResourceID:           "node-1",
		Operation:            GVICAssignmentCommandSet,
		Changed:              true,
		EffectiveAssignments: after,
	}
	event, ok := resourceGVICUpdatedWorkspaceEventInput(result, before, "actor-1", "node-gvic-1")
	if !ok {
		t.Fatal("expected targeted Node GVIC event")
	}
	if event.Type != NodeGVICUpdatedEventType || event.Payload["node_id"] != "node-1" {
		t.Fatalf("event = %+v, want Node GVIC update", event)
	}
	got, _ := event.Payload["assignment_user_ids"].([]string)
	if !reflect.DeepEqual(got, []string{"bob"}) {
		t.Fatalf("assignment_user_ids = %v, want only Bob", got)
	}
}

func TestResourceGVICUpdatedWorkspaceEventSkipsUnchangedAndRemovedUsers(t *testing.T) {
	before := []domain.ResourceGVICEffectiveAssignment{
		{UserID: "alice", Role: domain.GVICRoleVerifier},
		{UserID: "removed", Role: domain.GVICRoleInformed},
	}
	after := []domain.ResourceGVICEffectiveAssignment{
		{UserID: "alice", Role: domain.GVICRoleVerifier},
	}
	result := ResourceGVICAssignmentMutationResult{
		CompanyID:            "company-1",
		ResourceType:         EntityTypeLogicGate,
		ResourceID:           "logic-gate-1",
		Operation:            GVICAssignmentCommandSet,
		Changed:              true,
		EffectiveAssignments: after,
	}
	if event, ok := resourceGVICUpdatedWorkspaceEventInput(result, before, "actor-1", "logic-gate-gvic-1"); ok {
		t.Fatalf("unexpected assignment event for unchanged/removed users: %+v", event)
	}
}
