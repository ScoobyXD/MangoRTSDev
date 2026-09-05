package httpapi

import (
	"encoding/json"
	"fmt"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestAssistantMyProcessesUsesCurrentAssignmentsWithoutFirstPageLimit(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "09818181-8181-4181-8181-818181818181"
	repo.EnsureCompany(companyID, "Assigned Processes")
	member := mustRealtimeAuthUser(t, repo, companyID, "assistant-my-processes-member", domain.RoleCompanyUser)
	other := mustRealtimeAuthUser(t, repo, companyID, "assistant-my-processes-other", domain.RoleCompanyAdmin)
	server := newRealtimeAuthServerForTest(repo, "assistant-token", member)
	defer server.Close()
	request := assistantToolRequest(member, companyID, domain.RoleCompanyUser)
	create := func(name, userID, role string) domain.LogicGate {
		t.Helper()
		process, err := repo.CreateLogicGate(companyID, name)
		if err != nil {
			t.Fatal(err)
		}
		if userID != "" {
			if _, err := repo.SetResourceRACIAssignments(store.ResourceRACIAssignmentUpdateInput{
				CompanyID: companyID, ResourceType: store.EntityTypeLogicGate, ResourceID: process.LogicGateID,
				Assignments: []store.ResourceRACIAssignmentInput{{Role: role, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: userID}},
			}); err != nil {
				t.Fatal(err)
			}
		}
		return process
	}
	// Every assigned Process sorts after the generic tool's first company page.
	for index := 0; index < 55; index++ {
		create(fmt.Sprintf("A unassigned %02d", index), "", "")
	}
	want := map[string]bool{}
	roles := []string{domain.RACIRoleResponsible, domain.RACIRoleAccountable, domain.RACIRoleConsulted, domain.RACIRoleInformed}
	for index := 0; index < 51; index++ {
		process := create(fmt.Sprintf("Z assigned %02d", index), member.UserID, roles[index%len(roles)])
		want[process.LogicGateID] = true
	}
	create("Z somebody else's Process", other.UserID, domain.RACIRoleResponsible)
	hidden := create("Z hidden assigned Process", member.UserID, domain.RACIRoleResponsible)
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: store.EntityTypeLogicGate, EntityID: hidden.LogicGateID,
		DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, ActorUserID: other.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	parentGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Assigned Team")
	if err != nil {
		t.Fatal(err)
	}
	childGroup, err := repo.CreateCompanyUserGroup(companyID, parentGroup.GroupID, "Nested Team")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, []string{member.UserID}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Inherited work")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(store.ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeCompanyExplorerFolder, ResourceID: folder.FolderID,
		Assignments: []store.ResourceRACIAssignmentInput{{Role: domain.RACIRoleConsulted, PrincipalType: store.EntityPermissionSubjectGroup, PrincipalID: parentGroup.GroupID}},
	}); err != nil {
		t.Fatal(err)
	}
	inherited := create("Z inherited nested-group Process", "", "")
	if _, err := repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{
		CompanyID: companyID, ParentEntityID: folder.FolderID, ChildEntityType: store.CompanyExplorerV2EntityLogicGate,
		ChildResourceID: inherited.LogicGateID, ActorUserID: other.UserID, PermissionUserID: other.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	policy, err := repo.GetResourceRACIPolicy(companyID, store.EntityTypeLogicGate, inherited.LogicGateID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(store.ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeLogicGate, ResourceID: inherited.LogicGateID,
		AssignmentMode: store.PolicyModeInherited, DescendantAction: store.PolicyDescendantActionInheritedOnly, ExpectedRevision: policy.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	want[inherited.LogicGateID] = true
	assertAssigned := func() {
		t.Helper()
		output, err := server.dispatchAssistantTool(request, "list_my_processes", `{}`)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Processes []domain.LogicGate `json:"logic_gates"`
		}
		if err := json.Unmarshal([]byte(output), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Processes) != len(want) {
			t.Fatalf("assigned Processes count=%d, want %d", len(result.Processes), len(want))
		}
		for _, process := range result.Processes {
			if !want[process.LogicGateID] {
				t.Fatalf("unassigned or inaccessible Process returned: %q", process.Header)
			}
		}
	}
	assertAssigned()
	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, nil); err != nil {
		t.Fatal(err)
	}
	delete(want, inherited.LogicGateID)
	assertAssigned()
	for _, injected := range []string{`{"user_id":"` + other.UserID + `"}`, `{"company_id":"` + companyID + `"}`, `{"limit":1}`} {
		if _, err := server.dispatchAssistantTool(request, "list_my_processes", injected); err == nil {
			t.Fatalf("accepted model-supplied assignment scope: %s", injected)
		}
	}
}
