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
	if allowed, err := repo.UserCanViewEntity(companyID, EntityTypeNode, node.NodeID, otherUser.UserID); err != nil || !allowed {
		t.Fatalf("other user allowed after clear = %v err = %v, want true", allowed, err)
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
	for _, subject := range []string{"viewer-user", "editor-user", "admin-user"} {
		if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatalf("AddCompanyMembership %s: %v", subject, err)
		}
	}

	node, err := repo.CreateNode(companyID, "Access node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, viewer.UserID, EntityPermissionView); err != nil || !allowed {
		t.Fatalf("viewer no-grant view allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, viewer.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("viewer no-grant edit allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, viewer.UserID, EntityPermissionAdmin); err != nil || !allowed {
		t.Fatalf("viewer no-grant admin allowed = %v err = %v, want true", allowed, err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Open logic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeLogicGate, logicGate.LogicGateID, viewer.UserID, EntityPermissionAdmin); err != nil || !allowed {
		t.Fatalf("viewer no-grant logic gate admin allowed = %v err = %v, want true", allowed, err)
	}
	sharedInbox, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Shared inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder shared inbox: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedTriageFolder, sharedInbox.FolderID, viewer.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("viewer no-grant shared inbox edit allowed = %v err = %v, want false", allowed, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: EntityPermissionView},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: EntityPermissionEdit},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: admin.UserID, AccessLevel: EntityPermissionAdmin},
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
		{name: "editor can view", userID: editor.UserID, accessLevel: EntityPermissionView, want: true},
		{name: "editor can edit", userID: editor.UserID, accessLevel: EntityPermissionEdit, want: true},
		{name: "editor cannot admin", userID: editor.UserID, accessLevel: EntityPermissionAdmin, want: false},
		{name: "admin can view", userID: admin.UserID, accessLevel: EntityPermissionView, want: true},
		{name: "admin can edit", userID: admin.UserID, accessLevel: EntityPermissionEdit, want: true},
		{name: "admin can admin", userID: admin.UserID, accessLevel: EntityPermissionAdmin, want: true},
	}
	for _, tc := range cases {
		allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, tc.userID, tc.accessLevel)
		if err != nil || allowed != tc.want {
			t.Fatalf("%s allowed = %v err = %v, want %v", tc.name, allowed, err, tc.want)
		}
	}
}
