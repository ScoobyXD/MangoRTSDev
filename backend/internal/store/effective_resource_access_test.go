package store

import (
	"miraeopus/backend/internal/domain"
	"slices"
	"testing"
)

func TestMemoryEffectiveAccessDirectUserGrant(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222201"
	repo.EnsureCompany(companyID, "Effective Direct Co")

	viewer := mustEffectiveAccessUser(t, repo, companyID, "effective-direct-viewer")
	blocked := mustEffectiveAccessUser(t, repo, companyID, "effective-direct-blocked")
	node, err := repo.CreateNode(companyID, "Direct grant node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: EntityPermissionEdit},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: blocked.UserID, AccessLevel: EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	assertEffectiveAccess(t, repo, companyID, viewer.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, viewer.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, viewer.UserID, EntityTypeNode, node.NodeID, EntityPermissionAdmin, false)
	assertEffectiveAccess(t, repo, companyID, blocked.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)

	ids, err := repo.ListEffectiveResourceIDsForUser(companyID, viewer.UserID, EntityTypeNode, EntityPermissionView, []string{node.NodeID})
	if err != nil {
		t.Fatalf("ListEffectiveResourceIDsForUser: %v", err)
	}
	if !ids[node.NodeID] {
		t.Fatalf("effective IDs = %+v, want %s", ids, node.NodeID)
	}
	users, err := repo.ListEffectiveUsersForResource(companyID, EntityTypeNode, node.NodeID, EntityPermissionEdit)
	if err != nil {
		t.Fatalf("ListEffectiveUsersForResource: %v", err)
	}
	if !slices.Contains(users, viewer.UserID) || slices.Contains(users, blocked.UserID) {
		t.Fatalf("effective users = %+v, want viewer only", users)
	}
	for _, fact := range repo.effectiveAccess {
		if fact.CompanyID == companyID && fact.AccessLevel == EntityPermissionNoAccess {
			t.Fatalf("effective access wrote no_access fact: %+v", fact)
		}
	}
}

func TestMemoryEffectiveAccessGroupGrantAndNestedInheritance(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222202"
	repo.EnsureCompany(companyID, "Effective Group Co")

	parentUser := mustEffectiveAccessUser(t, repo, companyID, "effective-group-parent")
	childUser := mustEffectiveAccessUser(t, repo, companyID, "effective-group-child")
	otherUser := mustEffectiveAccessUser(t, repo, companyID, "effective-group-other")
	parentGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Operations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	childGroup, err := repo.CreateCompanyUserGroup(companyID, parentGroup.GroupID, "Shift A")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, parentGroup.GroupID, []string{parentUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers parent: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, []string{childUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Group grant node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectGroup,
			SubjectID:   parentGroup.GroupID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	assertEffectiveAccess(t, repo, companyID, parentUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, childUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, otherUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
}

func TestMemoryEffectiveAccessRaciProjectsEdit(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222203"
	repo.EnsureCompany(companyID, "Effective RACI Co")

	user := mustEffectiveAccessUser(t, repo, companyID, "effective-raci-user")
	gate, err := repo.CreateLogicGate(companyID, "RACI gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleInformed,
			UserID: user.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}

	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionAdmin, false)
}

func TestMemoryEffectiveAccessSharedTriageFolderInheritance(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222204"
	repo.EnsureCompany(companyID, "Effective Shared Triage Co")

	user := mustEffectiveAccessUser(t, repo, companyID, "effective-shared-user")
	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Parent inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent: %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "communications", "Child inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child: %v", err)
	}
	grandchild, err := repo.CreateCompanyExplorerFolder(companyID, child.FolderID, "communications", "Grandchild inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder grandchild: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeSharedTriageFolder,
		EntityID:   parent.FolderID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeSharedTriageFolder, parent.FolderID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeSharedTriageFolder, child.FolderID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeSharedTriageFolder, grandchild.FolderID, EntityPermissionEdit, true)
}

func TestMemoryEffectiveAccessLogicGateAssignedNodeContextualVisibility(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222205"
	repo.EnsureCompany(companyID, "Effective Assignment Co")

	user := mustEffectiveAccessUser(t, repo, companyID, "effective-assignment-user")
	gate, err := repo.CreateLogicGate(companyID, "Assigned work")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Assigned node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "Pending",
		NodeTitle:   node.Title,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeLogicGate,
		EntityID:   gate.LogicGateID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, false)
}

func TestMemoryEffectiveAccessSourceSpecificReprojection(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222206"
	repo.EnsureCompany(companyID, "Effective Reprojection Co")

	directUser := mustEffectiveAccessUser(t, repo, companyID, "effective-reproject-direct")
	contextOnlyUser := mustEffectiveAccessUser(t, repo, companyID, "effective-reproject-context")
	gate, err := repo.CreateLogicGate(companyID, "Reprojection gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Reprojection node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "Pending",
		NodeTitle:   node.Title,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   directUser.UserID,
			AccessLevel: EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("Set node permissions: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeLogicGate,
		EntityID:   gate.LogicGateID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectUser, SubjectID: directUser.UserID, AccessLevel: EntityPermissionView},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: contextOnlyUser.UserID, AccessLevel: EntityPermissionView},
		},
	}); err != nil {
		t.Fatalf("Set gate permissions: %v", err)
	}

	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("first RebuildEffectiveResourceAccessForCompany: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, directUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, contextOnlyUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeLogicGate,
		EntityID:   gate.LogicGateID,
	}); err != nil {
		t.Fatalf("clear gate permissions: %v", err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("second RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	assertEffectiveAccess(t, repo, companyID, directUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, directUser.UserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, companyID, contextOnlyUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
	users, err := repo.ListEffectiveUsersForResource(companyID, EntityTypeNode, node.NodeID, EntityPermissionView)
	if err != nil {
		t.Fatalf("ListEffectiveUsersForResource: %v", err)
	}
	if !slices.Contains(users, directUser.UserID) || slices.Contains(users, contextOnlyUser.UserID) {
		t.Fatalf("node effective users after reprojection = %+v, want only direct user", users)
	}
}

func mustEffectiveAccessUser(t *testing.T, repo *MemoryRepo, companyID, subject string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func assertEffectiveAccess(t *testing.T, repo *MemoryRepo, companyID, userID, resourceType, resourceID, accessLevel string, want bool) {
	t.Helper()
	got, err := repo.UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel)
	if err != nil {
		t.Fatalf("UserHasEffectiveAccess(%s, %s, %s, %s) error: %v", userID, resourceType, resourceID, accessLevel, err)
	}
	if got != want {
		t.Fatalf("UserHasEffectiveAccess(%s, %s, %s, %s) = %v, want %v", userID, resourceType, resourceID, accessLevel, got, want)
	}
}
