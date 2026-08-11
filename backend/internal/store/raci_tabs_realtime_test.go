package store

import (
	"encoding/json"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestRACITabsRealtimeDoorbellCoversAssignmentsGroupsAndInheritance(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "88888888-8888-4888-8888-888888888881"
	repo.EnsureCompany(companyID, "RACI Tabs Realtime")
	user := mustCreateRACIMembershipUser(t, repo, "raci-tabs-realtime-user", companyID)
	gate, err := repo.CreateLogicGate(companyID, "Realtime Gate")
	if err != nil {
		t.Fatal(err)
	}

	assertDoorbell := func(label string) {
		t.Helper()
		var found *RealtimeOutboxEvent
		for _, item := range repo.realtimeOutbox {
			if item.EventType == "raci_tabs.changed" {
				copy := item
				found = &copy
			}
		}
		if found == nil {
			t.Fatalf("%s did not create a RACI Tabs realtime event: %+v", label, repo.realtimeOutbox)
		}
		if found.Scope != raciTabsRealtimeScope || !found.AudienceRestricted || len(found.AllowedUserIDs) != 1 || found.AllowedUserIDs[0] != user.UserID {
			t.Fatalf("%s doorbell scope/audience = %+v", label, found)
		}
		var payload map[string]any
		if err := json.Unmarshal(found.Payload, &payload); err != nil || payload["type"] != "raci_tabs.changed" || payload["company_id"] != companyID {
			t.Fatalf("%s payload = %s err=%v", label, found.Payload, err)
		}
		repo.realtimeOutbox = map[string]RealtimeOutboxEvent{}
		repo.realtimeOutboxSequence = 0
	}

	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID,
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}},
	}); err != nil {
		t.Fatal(err)
	}
	assertDoorbell("direct user assignment")

	group, err := repo.CreateCompanyUserGroup(companyID, "", "Delivery")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID,
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleConsulted, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID}},
	}); err != nil {
		t.Fatal(err)
	}
	assertDoorbell("group assignment")

	for _, input := range []DomainEventInput{
		workspaceDomainEventInput(companyID, "company_user_group_members_updated", map[string]any{"group_id": group.GroupID}),
		workspaceDomainEventInput(companyID, "company_user_group_updated", map[string]any{"group_id": group.GroupID}),
		workspaceDomainEventInput(companyID, "company_user_group_deleted", map[string]any{"group_id": group.GroupID}),
		workspaceDomainEventInput(companyID, "resource_gvic_policy_updated", map[string]any{"resource_type": EntityTypeCompanyExplorerFolder, "resource_id": "99999999-9999-4999-8999-999999999999"}),
		workspaceDomainEventInput(companyID, "company_explorer_folder_updated", map[string]any{"folder_id": "99999999-9999-4999-8999-999999999999"}),
		workspaceDomainEventInput(companyID, "company_explorer_item_placed", map[string]any{"target_type": EntityTypeLogicGate, "target_id": gate.LogicGateID}),
		workspaceDomainEventInput(companyID, "company_explorer_item_removed", map[string]any{"item_id": "99999999-9999-4999-8999-999999999998"}),
	} {
		if _, err := repo.AppendDomainEvent(input); err != nil {
			t.Fatal(err)
		}
		assertDoorbell(input.Type)
	}

	if _, err := repo.AppendDomainEvent(workspaceDomainEventInput(companyID, NodeRACIUpdatedEventType, map[string]any{"node_id": "99999999-9999-4999-8999-999999999997"})); err != nil {
		t.Fatal(err)
	}
	for _, item := range repo.realtimeOutbox {
		if item.EventType == "raci_tabs.changed" {
			t.Fatalf("unrelated node RACI event created RACI Tabs doorbell: %+v", item)
		}
	}
}
