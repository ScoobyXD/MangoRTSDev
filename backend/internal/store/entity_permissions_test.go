package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestMemoryEntityPermissionsIncludeDescendantGroupMembers(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	repo.EnsureCompany(companyID, "Permission Co")

	childUser, err := repo.UpsertAuthUser("child-user", "child@example.com", "Child User")
	if err != nil {
		t.Fatalf("UpsertAuthUser child: %v", err)
	}
	otherUser, err := repo.UpsertAuthUser("other-user", "other@example.com", "Other User")
	if err != nil {
		t.Fatalf("UpsertAuthUser other: %v", err)
	}
	if _, err := repo.AddCompanyMembership("child-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership child: %v", err)
	}
	if _, err := repo.AddCompanyMembership("other-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership other: %v", err)
	}

	parent, err := repo.CreateCompanyUserGroup(companyID, "", "Finance")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	child, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Payroll")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{childUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}

	node, err := repo.CreateNode(companyID, "Restricted node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectGroup,
			SubjectID:   parent.GroupID,
			Permission:  EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	if allowed, err := repo.UserCanViewEntity(companyID, EntityTypeNode, node.NodeID, childUser.UserID); err != nil || !allowed {
		t.Fatalf("child group user allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanViewEntity(companyID, EntityTypeNode, node.NodeID, otherUser.UserID); err != nil || allowed {
		t.Fatalf("other user allowed = %v err = %v, want false", allowed, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{CompanyID: companyID, EntityType: EntityTypeNode, EntityID: node.NodeID}); err != nil {
		t.Fatalf("clear SetEntityPermissions: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, otherUser.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("other user edit allowed after clear = %v err = %v, want true", allowed, err)
	}
}

func TestMemoryEntityPermissionsAccessLevelHierarchy(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111112"
	repo.EnsureCompany(companyID, "Access Co")

	viewer, err := repo.UpsertAuthUser("viewer-user", "viewer@example.com", "Viewer User")
	if err != nil {
		t.Fatalf("UpsertAuthUser viewer: %v", err)
	}
	editor, err := repo.UpsertAuthUser("editor-user", "editor@example.com", "Editor User")
	if err != nil {
		t.Fatalf("UpsertAuthUser editor: %v", err)
	}
	admin, err := repo.UpsertAuthUser("admin-user", "admin@example.com", "Admin User")
	if err != nil {
		t.Fatalf("UpsertAuthUser admin: %v", err)
	}
	blocked, err := repo.UpsertAuthUser("blocked-user", "blocked@example.com", "Blocked User")
	if err != nil {
		t.Fatalf("UpsertAuthUser blocked: %v", err)
	}
	companyAdmin, err := repo.UpsertAuthUser("company-admin-user", "company-admin@example.com", "Company Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser company admin: %v", err)
	}
	devAdmin, err := repo.UpsertAuthUser("dev-admin-user", "dev-admin@example.com", "Dev Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser dev admin: %v", err)
	}
	for _, subject := range []string{"viewer-user", "editor-user", "admin-user", "blocked-user"} {
		if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatalf("AddCompanyMembership %s: %v", subject, err)
		}
	}
	if _, err := repo.AddCompanyMembership("company-admin-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership company admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership("dev-admin-user", companyID, domain.RoleDevAdmin); err != nil {
		t.Fatalf("AddCompanyMembership dev admin: %v", err)
	}

	node, err := repo.CreateNode(companyID, "Access node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	for _, accessLevel := range []string{EntityPermissionView, EntityPermissionEdit} {
		if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, viewer.UserID, accessLevel); err != nil || !allowed {
			t.Fatalf("viewer no-grant node %s allowed = %v err = %v, want true", accessLevel, allowed, err)
		}
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, viewer.UserID, EntityPermissionAdmin); err != nil || allowed {
		t.Fatalf("viewer no-grant node admin allowed = %v err = %v, want false", allowed, err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Open logic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeLogicGate, logicGate.LogicGateID, viewer.UserID, EntityPermissionAdmin); err != nil || allowed {
		t.Fatalf("viewer no-grant logic gate admin allowed = %v err = %v, want false", allowed, err)
	}
	sharedInbox, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Shared inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder shared inbox: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, sharedInbox.FolderID, viewer.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("viewer no-grant shared inbox edit allowed = %v err = %v, want false", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, sharedInbox.FolderID, companyAdmin.UserID, EntityPermissionAdmin); err != nil || !allowed {
		t.Fatalf("company admin shared inbox admin allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, sharedInbox.FolderID, devAdmin.UserID, EntityPermissionAdmin); err != nil || !allowed {
		t.Fatalf("dev admin shared inbox admin allowed = %v err = %v, want true", allowed, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: EntityPermissionView},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: EntityPermissionEdit},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: admin.UserID, AccessLevel: EntityPermissionAdmin},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: blocked.UserID, AccessLevel: EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	cases := []struct {
		name        string
		userID      string
		accessLevel string
		want        bool
	}{
		{name: "viewer can view", userID: viewer.UserID, accessLevel: EntityPermissionView, want: true},
		{name: "viewer cannot edit", userID: viewer.UserID, accessLevel: EntityPermissionEdit, want: false},
		{name: "blocked no access cannot view", userID: blocked.UserID, accessLevel: EntityPermissionView, want: false},
		{name: "editor can view", userID: editor.UserID, accessLevel: EntityPermissionView, want: true},
		{name: "editor can edit", userID: editor.UserID, accessLevel: EntityPermissionEdit, want: true},
		{name: "editor cannot admin", userID: editor.UserID, accessLevel: EntityPermissionAdmin, want: false},
		{name: "admin can view", userID: admin.UserID, accessLevel: EntityPermissionView, want: true},
		{name: "admin can edit", userID: admin.UserID, accessLevel: EntityPermissionEdit, want: true},
		{name: "admin can admin", userID: admin.UserID, accessLevel: EntityPermissionAdmin, want: true},
		{name: "company admin role can admin", userID: companyAdmin.UserID, accessLevel: EntityPermissionAdmin, want: true},
		{name: "dev admin role can admin", userID: devAdmin.UserID, accessLevel: EntityPermissionAdmin, want: true},
	}
	for _, tc := range cases {
		allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, tc.userID, tc.accessLevel)
		if err != nil || allowed != tc.want {
			t.Fatalf("%s allowed = %v err = %v, want %v", tc.name, allowed, err, tc.want)
		}
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectUser, SubjectID: companyAdmin.UserID, AccessLevel: EntityPermissionNoAccess},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: devAdmin.UserID, AccessLevel: EntityPermissionNoAccess},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: blocked.UserID, AccessLevel: EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions role admins no_access: %v", err)
	}
	permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListEntityPermissions role admins no_access: %v", err)
	}
	for _, permission := range permissions {
		if permission.SubjectID == companyAdmin.UserID || permission.SubjectID == devAdmin.UserID {
			t.Fatalf("role admin no_access grant was persisted: %+v", permission)
		}
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, companyAdmin.UserID, EntityPermissionAdmin); err != nil || !allowed {
		t.Fatalf("company admin after no_access input allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, devAdmin.UserID, EntityPermissionAdmin); err != nil || !allowed {
		t.Fatalf("dev admin after no_access input allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, blocked.UserID, EntityPermissionView); err != nil || allowed {
		t.Fatalf("blocked after no_access input allowed = %v err = %v, want false", allowed, err)
	}
}

func TestMemoryAssignmentsGrantEditAccess(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111114"
	repo.EnsureCompany(companyID, "Assignment Access Co")

	assigned, err := repo.UpsertAuthUser("assigned-user", "assigned@example.com", "Assigned User")
	if err != nil {
		t.Fatalf("UpsertAuthUser assigned: %v", err)
	}
	responsible, err := repo.UpsertAuthUser("responsible-user", "responsible@example.com", "Responsible User")
	if err != nil {
		t.Fatalf("UpsertAuthUser responsible: %v", err)
	}
	for _, subject := range []string{"assigned-user", "responsible-user"} {
		if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatalf("AddCompanyMembership %s: %v", subject, err)
		}
	}

	node, err := repo.CreateNode(companyID, "Assigned node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   assigned.UserID,
			AccessLevel: EntityPermissionNoAccess,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions node deny: %v", err)
	}
	if _, err := repo.UpdateNode(UpdateNodeInput{
		CompanyID:         companyID,
		NodeID:            node.NodeID,
		AssigneeUserID:    &assigned.UserID,
		AssigneeUserIDSet: true,
	}); err != nil {
		t.Fatalf("UpdateNode assignee: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, assigned.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("assigned node edit allowed = %v err = %v, want true", allowed, err)
	}

	gate, err := repo.CreateLogicGate(companyID, "RACI gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeLogicGate,
		EntityID:   gate.LogicGateID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   responsible.UserID,
			AccessLevel: EntityPermissionNoAccess,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions gate deny: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleConsulted,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeLogicGate, gate.LogicGateID, responsible.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("RACI user logic gate edit allowed = %v err = %v, want false", allowed, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{CompanyID: companyID, EntityType: EntityTypeLogicGate, EntityID: gate.LogicGateID}); err != nil {
		t.Fatalf("clear gate permissions: %v", err)
	}
	repaired, err := repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleConsulted,
			UserID: responsible.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("duplicate AddLogicGateRaciAssignments: %v", err)
	}
	if repaired.Changed {
		t.Fatalf("duplicate AddLogicGateRaciAssignments changed = true, want false")
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeLogicGate, gate.LogicGateID, responsible.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("cleared direct permissions default edit allowed = %v err = %v, want true", allowed, err)
	}
}

func TestMemorySharedTriagePermissionsInheritAndChildOverrides(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111113"
	repo.EnsureCompany(companyID, "Shared Access Co")

	joe, err := repo.UpsertAuthUser("joe-user", "joe@example.com", "Joe User")
	if err != nil {
		t.Fatalf("UpsertAuthUser joe: %v", err)
	}
	pam, err := repo.UpsertAuthUser("pam-user", "pam@example.com", "Pam User")
	if err != nil {
		t.Fatalf("UpsertAuthUser pam: %v", err)
	}
	for _, subject := range []string{"joe-user", "pam-user"} {
		if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatalf("AddCompanyMembership %s: %v", subject, err)
		}
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Support")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{joe.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}
	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Parent inbox")
	if err != nil {
		t.Fatalf("Create parent folder: %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "communications", "Child inbox")
	if err != nil {
		t.Fatalf("Create child folder: %v", err)
	}
	grandchild, err := repo.CreateCompanyExplorerFolder(companyID, child.FolderID, "communications", "Grandchild inbox")
	if err != nil {
		t.Fatalf("Create grandchild folder: %v", err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeSharedTriageFolder,
		EntityID:   parent.FolderID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: group.GroupID, AccessLevel: EntityPermissionNoAccess},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: pam.UserID, AccessLevel: EntityPermissionAdmin},
		},
	}); err != nil {
		t.Fatalf("Set parent permissions: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, child.FolderID, joe.UserID, EntityPermissionView); err != nil || allowed {
		t.Fatalf("joe inherited no_access child view allowed = %v err = %v, want false", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, child.FolderID, pam.UserID, EntityPermissionAdmin); err != nil || !allowed {
		t.Fatalf("pam propagated child admin allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, grandchild.FolderID, pam.UserID, EntityPermissionAdmin); err != nil || !allowed {
		t.Fatalf("pam propagated grandchild admin allowed = %v err = %v, want true", allowed, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeSharedTriageFolder,
		EntityID:   child.FolderID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: group.GroupID, AccessLevel: EntityPermissionNoAccess},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: joe.UserID, AccessLevel: EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("Set child permissions: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, parent.FolderID, joe.UserID, EntityPermissionView); err != nil || allowed {
		t.Fatalf("joe parent view allowed = %v err = %v, want false", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, child.FolderID, joe.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("joe child group override edit allowed = %v err = %v, want false", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, grandchild.FolderID, joe.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("joe nested child group override edit allowed = %v err = %v, want false", allowed, err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeSharedTriageFolder,
		EntityID:   child.FolderID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectUser, SubjectID: joe.UserID, AccessLevel: EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("Set child custom permissions: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, child.FolderID, joe.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("joe child custom edit allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, grandchild.FolderID, joe.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("joe nested child custom edit allowed = %v err = %v, want true", allowed, err)
	}
}
