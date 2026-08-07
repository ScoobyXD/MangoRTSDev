package store

import (
	"miraeopus/backend/internal/domain"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestMemoryGroupMembershipRACISyncIsAffectedGroupScoped(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-gvic-membership-scope"
	repo.EnsureCompany(companyID, "RACI Membership Scope")

	first := mustCreateRACIMembershipUser(t, repo, "gvic-member-first", companyID)
	next := mustCreateRACIMembershipUser(t, repo, "gvic-member-next", companyID)
	unrelatedUser := mustCreateRACIMembershipUser(t, repo, "gvic-member-unrelated", companyID)

	parent, err := repo.CreateCompanyUserGroup(companyID, "", "Parent")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	child, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Child")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	unrelatedGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Unrelated")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup unrelated: %v", err)
	}
	unassignedGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Unassigned")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup unassigned: %v", err)
	}

	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{first.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child initial: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, unrelatedGroup.GroupID, []string{unrelatedUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers unrelated: %v", err)
	}

	parentNode := mustCreateRACIMembershipNode(t, repo, companyID, "parent assigned node")
	childNode := mustCreateRACIMembershipNode(t, repo, companyID, "child assigned node")
	unrelatedNode := mustCreateRACIMembershipNode(t, repo, companyID, "unrelated assigned node")
	logicGate, err := repo.CreateLogicGate(companyID, "child assigned gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	mustSetRACIMembershipGroupAssignment(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, child.GroupID, domain.RACIRoleInformed)
	linkedNode := mustCreateRACIMembershipNode(t, repo, companyID, "linked node")
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      linkedNode.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	mustSetRACIMembershipInherited(t, repo, companyID, EntityTypeNode, linkedNode.NodeID)

	mustSetRACIMembershipGroupAssignment(t, repo, companyID, EntityTypeNode, parentNode.NodeID, parent.GroupID, domain.RACIRoleConsulted)
	mustSetRACIMembershipGroupAssignment(t, repo, companyID, EntityTypeNode, childNode.NodeID, child.GroupID, domain.RACIRoleInformed)
	mustSetRACIMembershipGroupAssignment(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedGroup.GroupID, domain.RACIRoleConsulted)

	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, parentNode.NodeID, []string{first.UserID}, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, childNode.NodeID, []string{first.UserID}, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, []string{first.UserID}, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, linkedNode.NodeID, []string{first.UserID}, "inherited")

	unrelatedBefore := mustListRACIMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedBefore) != 1 || unrelatedBefore[0].UserID != unrelatedUser.UserID {
		t.Fatalf("unrelated initial effective = %+v, want unrelated user", unrelatedBefore)
	}
	unrelatedUpdatedAt := unrelatedBefore[0].UpdatedTimestamp

	time.Sleep(time.Millisecond)
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{next.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child next: %v", err)
	}

	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, parentNode.NodeID, []string{next.UserID}, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, childNode.NodeID, []string{next.UserID}, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, []string{next.UserID}, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, linkedNode.NodeID, []string{next.UserID}, "inherited")

	unrelatedAfter := mustListRACIMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedAfter) != 1 || unrelatedAfter[0].UserID != unrelatedUser.UserID || !unrelatedAfter[0].UpdatedTimestamp.Equal(unrelatedUpdatedAt) {
		t.Fatalf("unrelated effective after child membership change = %+v, want unchanged timestamp %s", unrelatedAfter, unrelatedUpdatedAt)
	}

	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, nil); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child empty: %v", err)
	}
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, parentNode.NodeID, nil, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, childNode.NodeID, nil, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, nil, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, linkedNode.NodeID, nil, RACIInheritanceDirect)

	if _, err := repo.SetCompanyUserGroupMembers(companyID, unassignedGroup.GroupID, []string{first.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers unassigned: %v", err)
	}
}

func TestMemoryNodeAndLogicGateRACIRolesAllowGroupsAndMultiplePrincipals(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-gvic-node-primary-user"
	repo.EnsureCompany(companyID, "RACI Node Primary User")

	first := mustCreateRACIMembershipUser(t, repo, "gvic-node-primary-first", companyID)
	next := mustCreateRACIMembershipUser(t, repo, "gvic-node-primary-next", companyID)
	accountable := mustCreateRACIMembershipUser(t, repo, "gvic-node-primary-accountable", companyID)
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Primary Group")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	node := mustCreateRACIMembershipNode(t, repo, companyID, "node primary slots")

	_, err = repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   group.GroupID,
		}},
	})
	if err != nil {
		t.Fatalf("node Responsible group assignment rejected: %v", err)
	}

	_, err = repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: next.UserID},
		},
	})
	if err != nil {
		t.Fatalf("node multiple Responsible users rejected: %v", err)
	}

	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: accountable.UserID},
			{Role: domain.RACIRoleConsulted, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID},
		},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments valid node RACI: %v", err)
	}

	result, err := repo.AddResourceRACIAssignments(ResourceRACIAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   next.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("AddResourceRACIAssignments replacement: %v", err)
	}
	responsibleUsers := []string{}
	for _, assignment := range result.RACIAssignments {
		if assignment.Role == domain.RACIRoleResponsible {
			responsibleUsers = append(responsibleUsers, assignment.UserID)
		}
	}
	if len(responsibleUsers) != 2 || !stringSliceContains(responsibleUsers, first.UserID) || !stringSliceContains(responsibleUsers, next.UserID) {
		t.Fatalf("Responsible users after add = %+v, want %s and %s", responsibleUsers, first.UserID, next.UserID)
	}

	logicGate, err := repo.CreateLogicGate(companyID, "logic gate primary slots")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	_, err = repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   group.GroupID,
		}},
	})
	if err != nil {
		t.Fatalf("logic gate Responsible group assignment rejected: %v", err)
	}

	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: accountable.UserID},
			{Role: domain.RACIRoleInformed, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID},
		},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments valid logic gate RACI: %v", err)
	}

	logicGateResult, err := repo.AddResourceRACIAssignments(ResourceRACIAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   next.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("AddResourceRACIAssignments logic gate replacement: %v", err)
	}
	logicGateResponsibleUsers := []string{}
	for _, assignment := range logicGateResult.RACIAssignments {
		if assignment.Role == domain.RACIRoleResponsible {
			logicGateResponsibleUsers = append(logicGateResponsibleUsers, assignment.UserID)
		}
	}
	if len(logicGateResponsibleUsers) != 2 || !stringSliceContains(logicGateResponsibleUsers, first.UserID) || !stringSliceContains(logicGateResponsibleUsers, next.UserID) {
		t.Fatalf("logic gate Responsible users after add = %+v, want %s and %s", logicGateResponsibleUsers, first.UserID, next.UserID)
	}
}

func TestMemoryGroupParentMoveRACISyncUsesOldAndNewAncestors(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-gvic-parent-move-scope"
	repo.EnsureCompany(companyID, "RACI Parent Move Scope")

	movedUser := mustCreateRACIMembershipUser(t, repo, "gvic-parent-move-user", companyID)
	unrelatedUser := mustCreateRACIMembershipUser(t, repo, "gvic-parent-move-unrelated", companyID)

	oldParent, err := repo.CreateCompanyUserGroup(companyID, "", "Old parent")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup old parent: %v", err)
	}
	newParent, err := repo.CreateCompanyUserGroup(companyID, "", "New parent")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup new parent: %v", err)
	}
	movedGroup, err := repo.CreateCompanyUserGroup(companyID, oldParent.GroupID, "Moved child")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup moved child: %v", err)
	}
	unrelatedGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Unrelated")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup unrelated: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, movedGroup.GroupID, []string{movedUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers moved: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, unrelatedGroup.GroupID, []string{unrelatedUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers unrelated: %v", err)
	}

	oldGate, oldNode := mustCreateRACIMembershipGateWithNodeSnapshot(t, repo, companyID, "old ancestor gate", "old ancestor node", oldParent.GroupID, domain.RACIRoleConsulted)
	newGate, newNode := mustCreateRACIMembershipGateWithNodeSnapshot(t, repo, companyID, "new ancestor gate", "new ancestor node", newParent.GroupID, domain.RACIRoleConsulted)
	_, unrelatedNode := mustCreateRACIMembershipGateWithNodeSnapshot(t, repo, companyID, "unrelated gate", "unrelated node", unrelatedGroup.GroupID, domain.RACIRoleConsulted)

	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, oldGate.LogicGateID, []string{movedUser.UserID}, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, oldNode.NodeID, []string{movedUser.UserID}, "inherited")
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, newGate.LogicGateID, nil, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, newNode.NodeID, nil, RACIInheritanceDirect)

	unrelatedBefore := mustListRACIMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedBefore) != 1 || unrelatedBefore[0].UserID != unrelatedUser.UserID {
		t.Fatalf("unrelated node effective before move = %+v, want unrelated user", unrelatedBefore)
	}
	unrelatedEffectiveUpdatedAt := unrelatedBefore[0].UpdatedTimestamp
	unrelatedProjectionBefore := mustFindRACIMembershipProjectionRow(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedUser.UserID)

	time.Sleep(time.Millisecond)
	if _, err := repo.UpdateCompanyUserGroup(companyID, movedGroup.GroupID, &newParent.GroupID, "", 0); err != nil {
		t.Fatalf("UpdateCompanyUserGroup move: %v", err)
	}

	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, oldGate.LogicGateID, nil, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, oldNode.NodeID, nil, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, newGate.LogicGateID, []string{movedUser.UserID}, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, newNode.NodeID, []string{movedUser.UserID}, "inherited")

	unrelatedAfter := mustListRACIMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedAfter) != 1 || unrelatedAfter[0].UserID != unrelatedUser.UserID || !unrelatedAfter[0].UpdatedTimestamp.Equal(unrelatedEffectiveUpdatedAt) {
		t.Fatalf("unrelated node effective after move = %+v, want unchanged timestamp %s", unrelatedAfter, unrelatedEffectiveUpdatedAt)
	}
	unrelatedProjectionAfter := mustFindRACIMembershipProjectionRow(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedUser.UserID)
	if !unrelatedProjectionAfter.UpdatedTimestamp.Equal(unrelatedProjectionBefore.UpdatedTimestamp) {
		t.Fatalf("unrelated projection updated_timestamp = %s, want unchanged %s", unrelatedProjectionAfter.UpdatedTimestamp, unrelatedProjectionBefore.UpdatedTimestamp)
	}
}

func TestMemoryGroupDeleteRACISyncClearsDeletedAndAncestorResources(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-gvic-group-delete-scope"
	repo.EnsureCompany(companyID, "RACI Group Delete Scope")

	deletedUser := mustCreateRACIMembershipUser(t, repo, "gvic-delete-user", companyID)
	unrelatedUser := mustCreateRACIMembershipUser(t, repo, "gvic-delete-unrelated", companyID)

	parent, err := repo.CreateCompanyUserGroup(companyID, "", "Parent")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	child, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Deleted child")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	unrelatedGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Unrelated")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup unrelated: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{deletedUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, unrelatedGroup.GroupID, []string{unrelatedUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers unrelated: %v", err)
	}

	parentGate, parentNode := mustCreateRACIMembershipGateWithNodeSnapshot(t, repo, companyID, "parent gate", "parent node", parent.GroupID, domain.RACIRoleInformed)
	childGate, childNode := mustCreateRACIMembershipGateWithNodeSnapshot(t, repo, companyID, "child gate", "child node", child.GroupID, domain.RACIRoleInformed)
	_, unrelatedNode := mustCreateRACIMembershipGateWithNodeSnapshot(t, repo, companyID, "delete unrelated gate", "delete unrelated node", unrelatedGroup.GroupID, domain.RACIRoleInformed)

	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, parentGate.LogicGateID, []string{deletedUser.UserID}, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, childGate.LogicGateID, []string{deletedUser.UserID}, RACIInheritanceDirect)

	unrelatedBefore := mustListRACIMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedBefore) != 1 || unrelatedBefore[0].UserID != unrelatedUser.UserID {
		t.Fatalf("unrelated node effective before delete = %+v, want unrelated user", unrelatedBefore)
	}
	unrelatedEffectiveUpdatedAt := unrelatedBefore[0].UpdatedTimestamp
	unrelatedProjectionBefore := mustFindRACIMembershipProjectionRow(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedUser.UserID)

	time.Sleep(time.Millisecond)
	if err := repo.DeleteCompanyUserGroup(companyID, child.GroupID); err != nil {
		t.Fatalf("DeleteCompanyUserGroup child: %v", err)
	}

	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, parentGate.LogicGateID, nil, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, parentNode.NodeID, nil, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, childGate.LogicGateID, nil, RACIInheritanceDirect)
	assertRACIMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, childNode.NodeID, nil, RACIInheritanceDirect)
	childSourceRows, err := repo.ListResourceRACIAssignments(companyID, EntityTypeLogicGate, childGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListResourceRACIAssignments child gate: %v", err)
	}
	if len(childSourceRows) != 0 {
		t.Fatalf("child gate source assignments after delete = %+v, want none", childSourceRows)
	}

	unrelatedAfter := mustListRACIMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedAfter) != 1 || unrelatedAfter[0].UserID != unrelatedUser.UserID || !unrelatedAfter[0].UpdatedTimestamp.Equal(unrelatedEffectiveUpdatedAt) {
		t.Fatalf("unrelated node effective after delete = %+v, want unchanged timestamp %s", unrelatedAfter, unrelatedEffectiveUpdatedAt)
	}
	unrelatedProjectionAfter := mustFindRACIMembershipProjectionRow(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedUser.UserID)
	if !unrelatedProjectionAfter.UpdatedTimestamp.Equal(unrelatedProjectionBefore.UpdatedTimestamp) {
		t.Fatalf("unrelated projection updated_timestamp = %s, want unchanged %s", unrelatedProjectionAfter.UpdatedTimestamp, unrelatedProjectionBefore.UpdatedTimestamp)
	}
}

func TestPostgresGroupHierarchyUsesLiveV2ResolutionWithoutFanout(t *testing.T) {
	entityRaw, err := os.ReadFile("postgres_entity_permissions.go")
	if err != nil {
		t.Fatal(err)
	}
	entitySource := string(entityRaw)
	updateBody := extractFunctionSourceForTest(t, entitySource, "func (r *PostgresRepo) UpdateCompanyUserGroup")
	deleteBody := extractFunctionSourceForTest(t, entitySource, "func (r *PostgresRepo) DeleteCompanyUserGroup")
	for name, body := range map[string]string{"update": updateBody, "delete": deleteBody} {
		for _, forbidden := range []string{"syncPostgresRACI", "resource_gvic_effective_assignments", "gvic_matrix_projection", "recomputeGroupDependent"} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("group %s retained Step 1 fanout %q", name, forbidden)
			}
		}
	}
	for _, required := range []string{"delete from resource_gvic_assignments", "delete from resource_permissions"} {
		if !strings.Contains(deleteBody, required) {
			t.Fatalf("group delete missing direct V2 graph cleanup %q", required)
		}
	}
}

func mustCreateRACIMembershipUser(t *testing.T, repo *MemoryRepo, subject, companyID string) domain.User {
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

func mustCreateRACIMembershipNode(t *testing.T, repo *MemoryRepo, companyID, title string) domain.Node {
	t.Helper()
	node, err := repo.CreateNode(companyID, title)
	if err != nil {
		t.Fatalf("CreateNode %q: %v", title, err)
	}
	return node
}

func mustCreateRACIMembershipGateWithNodeSnapshot(t *testing.T, repo *MemoryRepo, companyID, gateTitle, nodeTitle, groupID, role string) (domain.LogicGate, domain.Node) {
	t.Helper()
	logicGate, err := repo.CreateLogicGate(companyID, gateTitle)
	if err != nil {
		t.Fatalf("CreateLogicGate %q: %v", gateTitle, err)
	}
	mustSetRACIMembershipGroupAssignment(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, groupID, role)
	node := mustCreateRACIMembershipNode(t, repo, companyID, nodeTitle)
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus %s/%s: %v", logicGate.LogicGateID, node.NodeID, err)
	}
	mustSetRACIMembershipInherited(t, repo, companyID, EntityTypeNode, node.NodeID)
	return logicGate, node
}

func mustSetRACIMembershipGroupAssignment(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, groupID, role string) {
	t.Helper()
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          role,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   groupID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments %s/%s: %v", resourceType, resourceID, err)
	}
}

func mustSetRACIMembershipInherited(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID string) {
	t.Helper()
	current, err := repo.GetResourceRACIPolicy(companyID, resourceType, resourceID)
	if err != nil {
		t.Fatalf("GetResourceRACIPolicy %s/%s: %v", resourceType, resourceID, err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: current.Revision,
	}); err != nil {
		t.Fatalf("PutResourceRACIPolicy inherited %s/%s: %v", resourceType, resourceID, err)
	}
}

func mustListRACIMembershipResponsibleNodes(t *testing.T, repo *MemoryRepo, companyID, userID string) []domain.Node {
	t.Helper()
	nodes, err := repo.ListResponsibleInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: userID, Limit: 20})
	if err != nil {
		t.Fatalf("ListResponsibleInboxNodes %s: %v", userID, err)
	}
	return nodes
}

func mustFindRACIMembershipProjectionRow(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, userID string) RACIMatrixProjectionRow {
	t.Helper()
	nodeIDs := []string(nil)
	logicGateIDs := []string(nil)
	switch resourceType {
	case EntityTypeNode:
		nodeIDs = []string{resourceID}
	case EntityTypeLogicGate:
		logicGateIDs = []string{resourceID}
	default:
		t.Fatalf("unsupported projection resource type %q", resourceType)
	}
	rows, err := repo.ListRACIMatrixProjectionRowsForResources(companyID, nodeIDs, logicGateIDs)
	if err != nil {
		t.Fatalf("ListRACIMatrixProjectionRowsForResources %s/%s: %v", resourceType, resourceID, err)
	}
	for _, row := range rows {
		rowMatches := false
		switch resourceType {
		case EntityTypeNode:
			rowMatches = row.NodeID == resourceID
		case EntityTypeLogicGate:
			rowMatches = row.LogicGateID != nil && *row.LogicGateID == resourceID
		}
		if rowMatches && row.UserID == userID {
			return row
		}
	}
	t.Fatalf("projection row for %s/%s user %s not found in %+v", resourceType, resourceID, userID, rows)
	return RACIMatrixProjectionRow{}
}

func assertRACIMembershipEffectiveUsers(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID string, want []string, inheritanceType string) {
	t.Helper()
	items := mustListRACIMembershipEffective(t, repo, companyID, resourceType, resourceID)
	got := make([]string, 0, len(items))
	for _, item := range items {
		if item.InheritanceType != inheritanceType {
			t.Fatalf("effective inheritance for %s/%s = %+v, want %q", resourceType, resourceID, items, inheritanceType)
		}
		got = append(got, item.UserID)
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("effective users for %s/%s = %+v, want %+v", resourceType, resourceID, got, want)
	}
}

func mustListRACIMembershipEffective(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID string) []domain.ResourceRACIEffectiveAssignment {
	t.Helper()
	items, err := repo.ListResourceRACIEffectiveAssignments(companyID, resourceType, resourceID)
	if err != nil {
		t.Fatalf("ListResourceRACIEffectiveAssignments %s/%s: %v", resourceType, resourceID, err)
	}
	return items
}
