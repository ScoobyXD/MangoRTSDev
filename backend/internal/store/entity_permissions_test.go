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
