package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestMemorySetEntityPermissionsScopedDirectGrantReplacementAndRevocation(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "44444444-4444-4444-8444-444444444401"
	repo.EnsureCompany(companyID, "Phase 2A Direct Grants Co")

	first := mustEffectiveAccessUser(t, repo, companyID, "phase2a-direct-first")
	second := mustEffectiveAccessUser(t, repo, companyID, "phase2a-direct-second")
	node, err := repo.CreateNode(companyID, "Scoped direct grant node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   first.UserID,
			AccessLevel: EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions first: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, first.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)

	firstSourceID := effectiveAccessSourceID(EntityTypeNode, node.NodeID, EntityPermissionSubjectUser, first.UserID)
	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, first.UserID, EntityTypeNode, node.NodeID, effectiveAccessSourceDirectUserGrant, firstSourceID)]; !ok {
		t.Fatalf("direct user fact for first user was not written")
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   second.UserID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions replacement: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, first.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, companyID, second.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, first.UserID, EntityTypeNode, node.NodeID, effectiveAccessSourceDirectUserGrant, firstSourceID)]; ok {
		t.Fatalf("stale direct user fact for first user was not removed")
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, first.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, second.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
}

func TestMemorySetEntityPermissionsNoAccessAndDirectPrecedence(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "44444444-4444-4444-8444-444444444402"
	repo.EnsureCompany(companyID, "Phase 2A No Access Co")

	user := mustEffectiveAccessUser(t, repo, companyID, "phase2a-no-access-user")
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Engineering")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}
	node, err := repo.CreateNode(companyID, "No access node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: group.GroupID, AccessLevel: EntityPermissionAdmin},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions no_access: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
	assertEffectiveAccessLevel(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionNoAccess)

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: group.GroupID, AccessLevel: EntityPermissionAdmin},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: EntityPermissionView},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions direct view: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, false)
}

func TestMemorySetEntityPermissionsRemovingDirectGrantPreservesOtherSource(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "44444444-4444-4444-8444-444444444403"
	repo.EnsureCompany(companyID, "Phase 2A Overlap Co")

	user := mustEffectiveAccessUser(t, repo, companyID, "phase2a-overlap-user")
	node, err := repo.CreateNodeWithAssignee(companyID, "Overlap node", user.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions direct grant: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
	}); err != nil {
		t.Fatalf("SetEntityPermissions revoke direct grant: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
	for _, access := range repo.effectiveAccess {
		if access.CompanyID == companyID && access.ResourceID == node.NodeID && access.SourceType == effectiveAccessSourceDirectUserGrant {
			t.Fatalf("direct grant source survived revoke: %+v", access)
		}
	}
}

func TestMemoryCompanyAndDevAdminScopedProjection(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "44444444-4444-4444-8444-444444444404"
	devAdminCompanyID := "44444444-4444-4444-8444-444444444405"
	repo.EnsureCompany(companyID, "Phase 2A Admin Target Co")
	repo.EnsureCompany(devAdminCompanyID, "Phase 2A Dev Admin Co")

	admin := mustEffectiveAccessUser(t, repo, companyID, "phase2a-company-admin")
	devAdmin, err := repo.UpsertAuthUser("phase2a-dev-admin", "phase2a-dev-admin@example.com", "Phase 2A Dev Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser dev admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership(devAdmin.CognitoSubject, devAdminCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership dev admin seed: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Admin target node")
	if err != nil {
		t.Fatalf("CreateNode target: %v", err)
	}

	assertEffectiveAccess(t, repo, companyID, admin.UserID, EntityTypeNode, node.NodeID, EntityPermissionAdmin, false)
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("promote company admin: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, admin.UserID, EntityTypeNode, node.NodeID, EntityPermissionAdmin, true)
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("demote company admin: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, admin.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, admin.UserID, EntityTypeNode, node.NodeID, EntityPermissionAdmin, false)

	if _, err := repo.AddCompanyMembership(devAdmin.CognitoSubject, devAdminCompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatalf("promote dev admin: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, devAdmin.UserID, EntityTypeNode, node.NodeID, EntityPermissionAdmin, true)
	if _, err := repo.AddCompanyMembership(devAdmin.CognitoSubject, devAdminCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("demote dev admin: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, devAdmin.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
}

func TestMemoryNewResourcesProjectCurrentAdminFacts(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "44444444-4444-4444-8444-444444444406"
	devAdminCompanyID := "44444444-4444-4444-8444-444444444407"
	repo.EnsureCompany(companyID, "Phase 2A New Resource Co")
	repo.EnsureCompany(devAdminCompanyID, "Phase 2A New Resource Dev Co")

	admin := mustEffectiveAccessUser(t, repo, companyID, "phase2a-new-resource-admin")
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("promote company admin: %v", err)
	}
	devAdmin, err := repo.UpsertAuthUser("phase2a-new-resource-dev-admin", "phase2a-new-resource-dev-admin@example.com", "Phase 2A New Resource Dev Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser dev admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership(devAdmin.CognitoSubject, devAdminCompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatalf("AddCompanyMembership dev admin: %v", err)
	}

	node, err := repo.CreateNode(companyID, "Admin projected node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Admin projected gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Admin projected inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder: %v", err)
	}

	for _, user := range []domain.User{admin, devAdmin} {
		assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionAdmin, true)
		assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionAdmin, true)
		assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionAdmin, true)
	}
}

func TestMemoryResourceDeletionRemovesEffectiveRowsForDeletedResources(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "44444444-4444-4444-8444-444444444408"
	repo.EnsureCompany(companyID, "Phase 2A Delete Co")

	admin := mustEffectiveAccessUser(t, repo, companyID, "phase2a-delete-admin")
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("promote company admin: %v", err)
	}
	assignee := mustEffectiveAccessUser(t, repo, companyID, "phase2a-delete-assignee")
	node, err := repo.CreateNodeWithAssignee(companyID, "Deleted node", assignee.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee: %v", err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Deleted gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Deleted inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder: %v", err)
	}
	assertHasEffectiveResourceRows(t, repo, companyID, EntityTypeNode, node.NodeID)
	assertHasEffectiveResourceRows(t, repo, companyID, EntityTypeLogicGate, gate.LogicGateID)
	assertHasEffectiveResourceRows(t, repo, companyID, EntityTypeSharedTriageFolder, folder.FolderID)

	if err := repo.DeleteNode(companyID, node.NodeID); err != nil {
		t.Fatalf("DeleteNode: %v", err)
	}
	if err := repo.DeleteLogicGate(companyID, gate.LogicGateID); err != nil {
		t.Fatalf("DeleteLogicGate: %v", err)
	}
	if err := repo.DeleteCompanyExplorerFolder(companyID, folder.FolderID); err != nil {
		t.Fatalf("DeleteCompanyExplorerFolder: %v", err)
	}
	assertNoEffectiveResourceRows(t, repo, companyID, EntityTypeNode, node.NodeID)
	assertNoEffectiveResourceRows(t, repo, companyID, EntityTypeLogicGate, gate.LogicGateID)
	assertNoEffectiveResourceRows(t, repo, companyID, EntityTypeSharedTriageFolder, folder.FolderID)
}

func assertHasEffectiveResourceRows(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID string) {
	t.Helper()
	for _, fact := range repo.effectiveAccess {
		if fact.CompanyID == companyID && fact.ResourceType == resourceType && fact.ResourceID == resourceID {
			return
		}
	}
	t.Fatalf("no effective rows for %s/%s before deletion", resourceType, resourceID)
}

func assertNoEffectiveResourceRows(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID string) {
	t.Helper()
	for _, fact := range repo.effectiveAccess {
		if fact.CompanyID == companyID && fact.ResourceType == resourceType && fact.ResourceID == resourceID {
			t.Fatalf("effective row for deleted %s/%s survived: %+v", resourceType, resourceID, fact)
		}
	}
}
