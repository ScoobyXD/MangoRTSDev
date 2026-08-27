package store

import (
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
)

func TestProcessMapAccessAudienceUsesBoundedSetPasses(t *testing.T) {
	raw, err := os.ReadFile("realtime_producer_events.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)

	resources := processMapFunctionBodyForContractTest(t, source,
		"func (r *MemoryRepo) processMapAccessResourcesLocked", "func (r *MemoryRepo) processMapAccessAudienceLocked")
	if strings.Contains(resources, "processMapDescendantsLocked") {
		t.Fatal("Memory access snapshot rescans every placement once per folder depth")
	}
	for _, required := range []string{"childrenByParent", "for _, placement := range r.processMapPlacements"} {
		if !strings.Contains(resources, required) {
			t.Fatalf("Memory access snapshot is missing bounded placement index %q", required)
		}
	}

	memoryAudience := processMapFunctionBodyForContractTest(t, source,
		"func (r *MemoryRepo) processMapAccessAudienceLocked", "func postgresProcessMapAccessResourcesTx")
	for _, forbidden := range []string{
		"effectiveUserIDsForResourceLocked", "userHasEffectiveAccessLocked", "userHasRoleAdminAccessLocked",
		"directMemoryPermissionEdgesLocked", "userGroupPermissionDepthLocked",
	} {
		if strings.Contains(memoryAudience, forbidden) {
			t.Fatalf("Memory access snapshot restored repeated per-resource scan %q", forbidden)
		}
	}
	for _, collection := range []string{"r.memberships", "r.entityPermissions", "r.userGroups", "r.userGroupMembers"} {
		if count := strings.Count(memoryAudience, "range "+collection); count != 1 {
			t.Fatalf("Memory access snapshot scans %s %d times, want one set pass", collection, count)
		}
	}

	postgresAudience := processMapFunctionBodyForContractTest(t, source,
		"func postgresProcessMapAccessAudienceTx", "func markProcessMapProtectedGeometryChanged")
	if count := strings.Count(postgresAudience, "tx.QueryContext("); count != 1 {
		t.Fatalf("Postgres access snapshot executes %d queries, want one set query", count)
	}
	for _, required := range []string{"jsonb_to_recordset", "cross join eligible_users", "mangorts_user_can_access_resource"} {
		if !strings.Contains(postgresAudience, required) {
			t.Fatalf("Postgres access snapshot is missing set query contract %q", required)
		}
	}
	if strings.Contains(postgresAudience, "postgresEffectiveUsersForResourceTx") {
		t.Fatal("Postgres access snapshot restored one query per resource")
	}
}

func TestMemoryProcessMapAccessAudienceMatchesAuthoritativeResolver(t *testing.T) {
	repo, companyID, companyAdmin, groupUser, directUser := newV2PolicyTestRepo(t)
	otherCompanyID := "22222222-3333-4444-8555-666666666666"
	repo.EnsureCompany(otherCompanyID, "Other company")
	devAdmin, err := repo.UpsertAuthUser("audience-dev-admin", "audience-dev-admin@example.test", "Audience Dev Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("audience-dev-admin", otherCompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}

	parentGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Audience parent group")
	if err != nil {
		t.Fatal(err)
	}
	childGroup, err := repo.CreateCompanyUserGroup(companyID, parentGroup.GroupID, "Audience child group")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, []string{groupUser.UserID}); err != nil {
		t.Fatal(err)
	}

	root, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Audience root")
	if err != nil {
		t.Fatal(err)
	}
	nested, err := repo.CreateCompanyExplorerFolder(companyID, root.FolderID, "logic_gate", "Audience nested")
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Audience process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID: companyID, ParentEntityID: nested.FolderID,
		ChildEntityType: CompanyExplorerV2EntityLogicGate, ChildResourceID: gate.LogicGateID,
		ActorUserID: companyAdmin.UserID, PermissionUserID: companyAdmin.UserID,
	}); err != nil {
		t.Fatal(err)
	}

	noAccess := ResourceDefaultAccessNoAccess
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: root.FolderID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: parentGroup.GroupID, AccessLevel: EntityPermissionEdit},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: groupUser.UserID, AccessLevel: EntityPermissionNoAccess},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: directUser.UserID, AccessLevel: EntityPermissionEdit},
		},
		DescendantAction: PolicyDescendantActionInheritedOnly,
	})

	repo.mu.Lock()
	resources := repo.processMapAccessResourcesLocked(companyID, domain.ProcessMapResourceTypeFolder, root.FolderID)
	got := repo.processMapAccessAudienceLocked(companyID, resources)
	want := processMapAccessAudience{}
	for _, resource := range resources {
		want[processMapAccessAudienceKey(resource.ResourceType, resource.ResourceID)] = repo.effectiveUserIDsForResourceLocked(
			companyID, resource.ResourceType, resource.ResourceID, EntityPermissionEdit,
		)
	}
	repo.mu.Unlock()

	if len(resources) != 3 {
		t.Fatalf("mapped subtree resources = %+v, want root, nested folder, and process", resources)
	}
	if processMapAccessAudienceChanged(got, want) {
		t.Fatalf("set-based audience = %+v, authoritative audience = %+v", got, want)
	}
	for _, resource := range resources {
		users := got[processMapAccessAudienceKey(resource.ResourceType, resource.ResourceID)]
		if !users[companyAdmin.UserID] || !users[devAdmin.UserID] || !users[directUser.UserID] || users[groupUser.UserID] {
			t.Fatalf("audience for %+v = %+v, want company/dev admins and direct edit, with direct deny over inherited group edit", resource, users)
		}
	}
}
