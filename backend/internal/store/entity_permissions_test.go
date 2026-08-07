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
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectGroup,
			SubjectID:   parent.GroupID,
			AccessLevel: EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, childUser.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("child group user allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, otherUser.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("other user allowed = %v err = %v, want false", allowed, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessEdit,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("reopen SetEntityPermissions: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, otherUser.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("other user edit allowed after reopen = %v err = %v, want true", allowed, err)
	}
}

func TestMemoryEntityPermissionsResolveOnlyEditOrNoAccess(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111112"
	repo.EnsureCompany(companyID, "Access Co")

	editor, err := repo.UpsertAuthUser("editor-user", "editor@example.com", "Editor User")
	if err != nil {
		t.Fatalf("UpsertAuthUser editor: %v", err)
	}
	blocked, err := repo.UpsertAuthUser("blocked-user", "blocked@example.com", "Blocked User")
	if err != nil {
		t.Fatalf("UpsertAuthUser blocked: %v", err)
	}
	companyAdmin, err := repo.UpsertAuthUser("company-admin-user", "company-admin@example.com", "Company Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser company admin: %v", err)
	}
	for _, subject := range []string{"editor-user", "blocked-user"} {
		if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatalf("AddCompanyMembership %s: %v", subject, err)
		}
	}
	if _, err := repo.AddCompanyMembership("company-admin-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership company admin: %v", err)
	}

	node, err := repo.CreateNode(companyID, "Access node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, editor.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("default edit allowed = %v err = %v, want true", allowed, err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeNode, EntityID: node.NodeID,
		DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: EntityPermissionEdit},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: blocked.UserID, AccessLevel: EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, editor.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("explicit edit allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, blocked.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("no-access user allowed = %v err = %v, want false", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, companyAdmin.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("company admin edit allowed = %v err = %v, want true", allowed, err)
	}
	for _, obsolete := range []string{"view", "admin", "manage", ""} {
		if normalized, ok := NormalizeEntityPermission(obsolete); ok || normalized != "" {
			t.Fatalf("NormalizeEntityPermission(%q) = %q, %v; want rejected", obsolete, normalized, ok)
		}
	}
	for _, supported := range []string{EntityPermissionNoAccess, EntityPermissionEdit} {
		if normalized, ok := NormalizeEntityPermission(supported); !ok || normalized != supported {
			t.Fatalf("NormalizeEntityPermission(%q) = %q, %v", supported, normalized, ok)
		}
	}
}

func TestMemoryAssignmentsDoNotGrantEditAccess(t *testing.T) {
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
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, assigned.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("assigned node edit allowed = %v err = %v, want false", allowed, err)
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
	if _, err := repo.SetLogicGateRACIAssignments(LogicGateRACIAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{
			Role:   domain.RACIRoleConsulted,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRACIAssignments: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeLogicGate, gate.LogicGateID, responsible.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("RACI user logic gate edit allowed = %v err = %v, want false", allowed, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeLogicGate,
		EntityID:   gate.LogicGateID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   responsible.UserID,
			AccessLevel: EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions gate view: %v", err)
	}
	if _, err := repo.SetLogicGateRACIAssignments(LogicGateRACIAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{
			Role:   domain.RACIRoleResponsible,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRACIAssignments responsible: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeLogicGate, gate.LogicGateID, responsible.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("explicit edit with RACI assignment allowed = %v err = %v, want true", allowed, err)
	}
	if _, err := repo.SetLogicGateRACIAssignments(LogicGateRACIAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{
			Role:   domain.RACIRoleConsulted,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRACIAssignments consulted restore: %v", err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeLogicGate,
		EntityID:         gate.LogicGateID,
		DefaultAccess:    ResourceDefaultAccessEdit,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("clear gate permissions: %v", err)
	}
	repaired, err := repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{
			Role:   domain.RACIRoleConsulted,
			UserID: responsible.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("duplicate AddLogicGateRACIAssignments: %v", err)
	}
	if repaired.Changed {
		t.Fatalf("duplicate AddLogicGateRACIAssignments changed = true, want false")
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeLogicGate, gate.LogicGateID, responsible.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("cleared direct permissions default edit allowed = %v err = %v, want true", allowed, err)
	}
}

func TestMemorySharedTriagePermissionsUseDirectDefaultOverrides(t *testing.T) {
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
	parent, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Parent inbox", "")
	if err != nil {
		t.Fatalf("Create parent folder: %v", err)
	}
	child, err := repo.CreateCommunicationsSharedInboxFolder(companyID, parent.FolderID, "Child inbox", "")
	if err != nil {
		t.Fatalf("Create child folder: %v", err)
	}
	grandchild, err := repo.CreateCommunicationsSharedInboxFolder(companyID, child.FolderID, "Grandchild inbox", "")
	if err != nil {
		t.Fatalf("Create grandchild folder: %v", err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeSharedInboxFolder,
		EntityID:         parent.FolderID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectUser, SubjectID: pam.UserID, AccessLevel: EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("Set parent permissions: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedInboxFolder, parent.FolderID, joe.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("joe parent no_access allowed = %v err = %v, want false", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedInboxFolder, parent.FolderID, pam.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("pam parent override edit allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedInboxFolder, child.FolderID, joe.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("joe child inherited no_access allowed = %v err = %v, want false", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedInboxFolder, grandchild.FolderID, pam.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("pam grandchild inherited parent edit allowed = %v err = %v, want true", allowed, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeSharedInboxFolder,
		EntityID:         child.FolderID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: group.GroupID, AccessLevel: EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("Set child permissions: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedInboxFolder, child.FolderID, joe.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("joe child group override edit allowed = %v err = %v, want true", allowed, err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedInboxFolder, grandchild.FolderID, joe.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("joe grandchild inherited child group edit allowed = %v err = %v, want true", allowed, err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeSharedInboxFolder,
		EntityID:         grandchild.FolderID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions:      []EntityPermissionInput{},
	}); err != nil {
		t.Fatalf("Set grandchild no_access: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeSharedInboxFolder, grandchild.FolderID, joe.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("joe grandchild direct no_access allowed = %v err = %v, want false", allowed, err)
	}
}
