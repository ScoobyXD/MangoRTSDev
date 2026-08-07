package store

import (
	"miraeopus/backend/internal/domain"
	"reflect"
	"testing"
)

func TestResourceRACIUpdatedWorkspaceEventTargetsOnlyNewOrChangedAssignments(t *testing.T) {
	before := []domain.ResourceRACIEffectiveAssignment{
		{UserID: "alice", Role: domain.RACIRoleConsulted},
		{UserID: "removed", Role: domain.RACIRoleInformed},
	}
	after := []domain.ResourceRACIEffectiveAssignment{
		{UserID: "alice", Role: domain.RACIRoleConsulted},
		{UserID: "bob", Role: domain.RACIRoleResponsible},
	}
	if got := resourceRACIChangedUserIDs(before, after); !reflect.DeepEqual(got, []string{"bob"}) {
		t.Fatalf("changed users = %v, want only newly assigned Bob", got)
	}

	result := ResourceRACIAssignmentMutationResult{
		CompanyID:            "company-1",
		ResourceType:         EntityTypeNode,
		ResourceID:           "node-1",
		Operation:            RACIAssignmentCommandSet,
		Changed:              true,
		EffectiveAssignments: after,
	}
	event, ok := resourceRACIUpdatedWorkspaceEventInput(result, before, "actor-1", "node-gvic-1")
	if !ok {
		t.Fatal("expected targeted Node RACI event")
	}
	if event.Type != NodeRACIUpdatedEventType || event.Payload["node_id"] != "node-1" {
		t.Fatalf("event = %+v, want Node RACI update", event)
	}
	got, _ := event.Payload["assignment_user_ids"].([]string)
	if !reflect.DeepEqual(got, []string{"bob"}) {
		t.Fatalf("assignment_user_ids = %v, want only Bob", got)
	}
}

func TestResourceRACIUpdatedWorkspaceEventSkipsUnchangedAndRemovedUsers(t *testing.T) {
	before := []domain.ResourceRACIEffectiveAssignment{
		{UserID: "alice", Role: domain.RACIRoleAccountable},
		{UserID: "removed", Role: domain.RACIRoleInformed},
	}
	after := []domain.ResourceRACIEffectiveAssignment{
		{UserID: "alice", Role: domain.RACIRoleAccountable},
	}
	result := ResourceRACIAssignmentMutationResult{
		CompanyID:            "company-1",
		ResourceType:         EntityTypeLogicGate,
		ResourceID:           "logic-gate-1",
		Operation:            RACIAssignmentCommandSet,
		Changed:              true,
		EffectiveAssignments: after,
	}
	if event, ok := resourceRACIUpdatedWorkspaceEventInput(result, before, "actor-1", "logic-gate-gvic-1"); ok {
		t.Fatalf("unexpected assignment event for unchanged/removed users: %+v", event)
	}
}
