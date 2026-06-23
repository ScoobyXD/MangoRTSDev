package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestMemoryGroupMembershipGVICSyncIsAffectedGroupScoped(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-gvic-membership-scope"
	repo.EnsureCompany(companyID, "GVIC Membership Scope")

	first := mustCreateGVICMembershipUser(t, repo, "gvic-member-first", companyID)
	next := mustCreateGVICMembershipUser(t, repo, "gvic-member-next", companyID)
	unrelatedUser := mustCreateGVICMembershipUser(t, repo, "gvic-member-unrelated", companyID)

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

	parentNode := mustCreateGVICMembershipNode(t, repo, companyID, "parent assigned node")
	childNode := mustCreateGVICMembershipNode(t, repo, companyID, "child assigned node")
	unrelatedNode := mustCreateGVICMembershipNode(t, repo, companyID, "unrelated assigned node")
	logicGate, err := repo.CreateLogicGate(companyID, "child assigned gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	linkedNode := mustCreateGVICMembershipNode(t, repo, companyID, "linked node")
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

	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeNode, parentNode.NodeID, parent.GroupID, domain.GVICRoleConsulted)
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeNode, childNode.NodeID, child.GroupID, domain.GVICRoleInformed)
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedGroup.GroupID, domain.GVICRoleConsulted)
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, child.GroupID, domain.GVICRoleInformed)

	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, parentNode.NodeID, []string{first.UserID}, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, childNode.NodeID, []string{first.UserID}, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, []string{first.UserID}, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, linkedNode.NodeID, []string{first.UserID}, GVICInheritanceLogicGateInherited)

	unrelatedBefore := mustListGVICMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedBefore) != 1 || unrelatedBefore[0].UserID != unrelatedUser.UserID {
		t.Fatalf("unrelated initial effective = %+v, want unrelated user", unrelatedBefore)
	}
	unrelatedUpdatedAt := unrelatedBefore[0].UpdatedTimestamp

	time.Sleep(time.Millisecond)
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{next.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child next: %v", err)
	}

	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, parentNode.NodeID, []string{next.UserID}, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, childNode.NodeID, []string{next.UserID}, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, []string{next.UserID}, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, linkedNode.NodeID, []string{next.UserID}, GVICInheritanceLogicGateInherited)

	unrelatedAfter := mustListGVICMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedAfter) != 1 || unrelatedAfter[0].UserID != unrelatedUser.UserID || !unrelatedAfter[0].UpdatedTimestamp.Equal(unrelatedUpdatedAt) {
		t.Fatalf("unrelated effective after child membership change = %+v, want unchanged timestamp %s", unrelatedAfter, unrelatedUpdatedAt)
	}

	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, nil); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child empty: %v", err)
	}
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, parentNode.NodeID, nil, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, childNode.NodeID, nil, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, nil, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, linkedNode.NodeID, nil, GVICInheritanceLogicGateInherited)

	if _, err := repo.SetCompanyUserGroupMembers(companyID, unassignedGroup.GroupID, []string{first.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers unassigned: %v", err)
	}
}

func TestMemoryNodeAndLogicGatePrimaryGVICAllowsOnlyOneUserPerRole(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-gvic-node-primary-user"
	repo.EnsureCompany(companyID, "GVIC Node Primary User")

	first := mustCreateGVICMembershipUser(t, repo, "gvic-node-primary-first", companyID)
	next := mustCreateGVICMembershipUser(t, repo, "gvic-node-primary-next", companyID)
	verified := mustCreateGVICMembershipUser(t, repo, "gvic-node-primary-verified", companyID)
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Primary Group")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	node := mustCreateGVICMembershipNode(t, repo, companyID, "node primary slots")

	_, err = repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   group.GroupID,
		}},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("node generated group assignment error = %v, want %v", err, ErrInvalid)
	}

	_, err = repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{
			{Role: domain.GVICRoleGenerated, PrincipalType: EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.GVICRoleGenerated, PrincipalType: EntityPermissionSubjectUser, PrincipalID: next.UserID},
		},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("node generated multi-user assignment error = %v, want %v", err, ErrInvalid)
	}

	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{
			{Role: domain.GVICRoleGenerated, PrincipalType: EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.GVICRoleVerified, PrincipalType: EntityPermissionSubjectUser, PrincipalID: verified.UserID},
			{Role: domain.GVICRoleConsulted, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID},
		},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments valid node GVIC: %v", err)
	}

	result, err := repo.AddResourceGVICAssignments(ResourceGVICAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   next.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("AddResourceGVICAssignments replacement: %v", err)
	}
	generatedUsers := []string{}
	for _, assignment := range result.GVICAssignments {
		if assignment.Role == domain.GVICRoleGenerated {
			generatedUsers = append(generatedUsers, assignment.UserID)
		}
	}
	if len(generatedUsers) != 1 || generatedUsers[0] != next.UserID {
		t.Fatalf("generated users after replacement = %+v, want only %s", generatedUsers, next.UserID)
	}

	logicGate, err := repo.CreateLogicGate(companyID, "logic gate primary slots")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	_, err = repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   group.GroupID,
		}},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("logic gate generated group assignment error = %v, want %v", err, ErrInvalid)
	}

	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{
			{Role: domain.GVICRoleGenerated, PrincipalType: EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.GVICRoleVerified, PrincipalType: EntityPermissionSubjectUser, PrincipalID: verified.UserID},
			{Role: domain.GVICRoleInformed, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID},
		},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments valid logic gate GVIC: %v", err)
	}

	logicGateResult, err := repo.AddResourceGVICAssignments(ResourceGVICAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   next.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("AddResourceGVICAssignments logic gate replacement: %v", err)
	}
	logicGateGeneratedUsers := []string{}
	for _, assignment := range logicGateResult.GVICAssignments {
		if assignment.Role == domain.GVICRoleGenerated {
			logicGateGeneratedUsers = append(logicGateGeneratedUsers, assignment.UserID)
		}
	}
	if len(logicGateGeneratedUsers) != 1 || logicGateGeneratedUsers[0] != next.UserID {
		t.Fatalf("logic gate generated users after replacement = %+v, want only %s", logicGateGeneratedUsers, next.UserID)
	}
}

func TestMemoryGroupParentMoveGVICSyncUsesOldAndNewAncestors(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-gvic-parent-move-scope"
	repo.EnsureCompany(companyID, "GVIC Parent Move Scope")

	movedUser := mustCreateGVICMembershipUser(t, repo, "gvic-parent-move-user", companyID)
	unrelatedUser := mustCreateGVICMembershipUser(t, repo, "gvic-parent-move-unrelated", companyID)

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

	oldGate, oldNode := mustCreateGVICMembershipGateWithNode(t, repo, companyID, "old ancestor gate", "old ancestor node")
	newGate, newNode := mustCreateGVICMembershipGateWithNode(t, repo, companyID, "new ancestor gate", "new ancestor node")
	unrelatedGate, unrelatedNode := mustCreateGVICMembershipGateWithNode(t, repo, companyID, "unrelated gate", "unrelated node")
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeLogicGate, oldGate.LogicGateID, oldParent.GroupID, domain.GVICRoleConsulted)
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeLogicGate, newGate.LogicGateID, newParent.GroupID, domain.GVICRoleConsulted)
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeLogicGate, unrelatedGate.LogicGateID, unrelatedGroup.GroupID, domain.GVICRoleConsulted)

	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, oldGate.LogicGateID, []string{movedUser.UserID}, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, oldNode.NodeID, []string{movedUser.UserID}, GVICInheritanceLogicGateInherited)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, newGate.LogicGateID, nil, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, newNode.NodeID, nil, GVICInheritanceLogicGateInherited)

	unrelatedBefore := mustListGVICMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedBefore) != 1 || unrelatedBefore[0].UserID != unrelatedUser.UserID {
		t.Fatalf("unrelated node effective before move = %+v, want unrelated user", unrelatedBefore)
	}
	unrelatedEffectiveUpdatedAt := unrelatedBefore[0].UpdatedTimestamp
	unrelatedProjectionBefore := mustFindGVICMembershipProjectionRow(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedUser.UserID)

	time.Sleep(time.Millisecond)
	if _, err := repo.UpdateCompanyUserGroup(companyID, movedGroup.GroupID, &newParent.GroupID, "", 0); err != nil {
		t.Fatalf("UpdateCompanyUserGroup move: %v", err)
	}

	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, oldGate.LogicGateID, nil, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, oldNode.NodeID, nil, GVICInheritanceLogicGateInherited)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, newGate.LogicGateID, []string{movedUser.UserID}, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, newNode.NodeID, []string{movedUser.UserID}, GVICInheritanceLogicGateInherited)

	unrelatedAfter := mustListGVICMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedAfter) != 1 || unrelatedAfter[0].UserID != unrelatedUser.UserID || !unrelatedAfter[0].UpdatedTimestamp.Equal(unrelatedEffectiveUpdatedAt) {
		t.Fatalf("unrelated node effective after move = %+v, want unchanged timestamp %s", unrelatedAfter, unrelatedEffectiveUpdatedAt)
	}
	unrelatedProjectionAfter := mustFindGVICMembershipProjectionRow(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedUser.UserID)
	if !unrelatedProjectionAfter.UpdatedTimestamp.Equal(unrelatedProjectionBefore.UpdatedTimestamp) {
		t.Fatalf("unrelated projection updated_timestamp = %s, want unchanged %s", unrelatedProjectionAfter.UpdatedTimestamp, unrelatedProjectionBefore.UpdatedTimestamp)
	}
}

func TestMemoryGroupDeleteGVICSyncClearsDeletedAndAncestorResources(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-gvic-group-delete-scope"
	repo.EnsureCompany(companyID, "GVIC Group Delete Scope")

	deletedUser := mustCreateGVICMembershipUser(t, repo, "gvic-delete-user", companyID)
	unrelatedUser := mustCreateGVICMembershipUser(t, repo, "gvic-delete-unrelated", companyID)

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

	parentGate, parentNode := mustCreateGVICMembershipGateWithNode(t, repo, companyID, "parent gate", "parent node")
	childGate, childNode := mustCreateGVICMembershipGateWithNode(t, repo, companyID, "child gate", "child node")
	unrelatedGate, unrelatedNode := mustCreateGVICMembershipGateWithNode(t, repo, companyID, "delete unrelated gate", "delete unrelated node")
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeLogicGate, parentGate.LogicGateID, parent.GroupID, domain.GVICRoleInformed)
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeLogicGate, childGate.LogicGateID, child.GroupID, domain.GVICRoleInformed)
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeLogicGate, unrelatedGate.LogicGateID, unrelatedGroup.GroupID, domain.GVICRoleInformed)

	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, parentGate.LogicGateID, []string{deletedUser.UserID}, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, childGate.LogicGateID, []string{deletedUser.UserID}, GVICInheritanceDirect)

	unrelatedBefore := mustListGVICMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedBefore) != 1 || unrelatedBefore[0].UserID != unrelatedUser.UserID {
		t.Fatalf("unrelated node effective before delete = %+v, want unrelated user", unrelatedBefore)
	}
	unrelatedEffectiveUpdatedAt := unrelatedBefore[0].UpdatedTimestamp
	unrelatedProjectionBefore := mustFindGVICMembershipProjectionRow(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedUser.UserID)

	time.Sleep(time.Millisecond)
	if err := repo.DeleteCompanyUserGroup(companyID, child.GroupID); err != nil {
		t.Fatalf("DeleteCompanyUserGroup child: %v", err)
	}

	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, parentGate.LogicGateID, nil, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, parentNode.NodeID, nil, GVICInheritanceLogicGateInherited)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeLogicGate, childGate.LogicGateID, nil, GVICInheritanceDirect)
	assertGVICMembershipEffectiveUsers(t, repo, companyID, EntityTypeNode, childNode.NodeID, nil, GVICInheritanceLogicGateInherited)
	childSourceRows, err := repo.ListResourceGVICAssignments(companyID, EntityTypeLogicGate, childGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListResourceGVICAssignments child gate: %v", err)
	}
	if len(childSourceRows) != 0 {
		t.Fatalf("child gate source assignments after delete = %+v, want none", childSourceRows)
	}

	unrelatedAfter := mustListGVICMembershipEffective(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID)
	if len(unrelatedAfter) != 1 || unrelatedAfter[0].UserID != unrelatedUser.UserID || !unrelatedAfter[0].UpdatedTimestamp.Equal(unrelatedEffectiveUpdatedAt) {
		t.Fatalf("unrelated node effective after delete = %+v, want unchanged timestamp %s", unrelatedAfter, unrelatedEffectiveUpdatedAt)
	}
	unrelatedProjectionAfter := mustFindGVICMembershipProjectionRow(t, repo, companyID, EntityTypeNode, unrelatedNode.NodeID, unrelatedUser.UserID)
	if !unrelatedProjectionAfter.UpdatedTimestamp.Equal(unrelatedProjectionBefore.UpdatedTimestamp) {
		t.Fatalf("unrelated projection updated_timestamp = %s, want unchanged %s", unrelatedProjectionAfter.UpdatedTimestamp, unrelatedProjectionBefore.UpdatedTimestamp)
	}
}

func TestPostgresGroupHierarchyGVICSyncUsesScopedHelpers(t *testing.T) {
	entityRaw, err := os.ReadFile("postgres_entity_permissions.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_entity_permissions.go: %v", err)
	}
	entitySource := string(entityRaw)
	updateBody := extractFunctionSourceForTest(t, entitySource, "func (r *PostgresRepo) UpdateCompanyUserGroup")
	deleteBody := extractFunctionSourceForTest(t, entitySource, "func (r *PostgresRepo) DeleteCompanyUserGroup")
	for name, body := range map[string]string{
		"UpdateCompanyUserGroup": updateBody,
		"DeleteCompanyUserGroup": deleteBody,
	} {
		if strings.Contains(body, "recomputeGroupDependentEffectiveAccessForCompanyTx") {
			t.Fatalf("%s should not call broad company GVIC recompute", name)
		}
		for _, needle := range []string{
			"gvicAncestorGroupIDsForGroupsTx",
			"gvicResourceKeysForGroupPrincipalIDsTx",
			"syncPostgresGVICForResourceKeysTx",
		} {
			if !strings.Contains(body, needle) {
				t.Fatalf("%s missing scoped helper %q", name, needle)
			}
		}
	}
	keysIndex := strings.Index(deleteBody, "gvicResourceKeysForGroupPrincipalIDsTx")
	deleteSourceIndex := strings.Index(deleteBody, "delete from resource_gvic_assignments")
	if keysIndex < 0 || deleteSourceIndex < 0 || keysIndex > deleteSourceIndex {
		t.Fatalf("DeleteCompanyUserGroup should collect affected GVIC keys before deleting source assignments")
	}

	gvicRaw, err := os.ReadFile("postgres_gvic.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_gvic.go: %v", err)
	}
	gvicSource := string(gvicRaw)
	syncBody := extractFunctionSourceForTest(t, gvicSource, "func syncPostgresGVICForResourceKeysTx")
	for _, needle := range []string{
		"syncResourceGVICEffectiveAssignmentsTx",
		"syncPostgresGVICMatrixProjectionForNodeDeltasTx",
		"syncPostgresGVICMatrixProjectionForLogicGateAssignmentsDeltasTx",
	} {
		if !strings.Contains(syncBody, needle) {
			t.Fatalf("syncPostgresGVICForResourceKeysTx missing %q", needle)
		}
	}
	affectedBody := extractFunctionSourceForTest(t, gvicSource, "func syncPostgresGVICForAffectedGroupsTx")
	if !strings.Contains(affectedBody, "syncPostgresGVICForResourceKeysTx") || strings.Contains(affectedBody, "syncResourceGVICEffectiveAssignmentsTx") {
		t.Fatalf("syncPostgresGVICForAffectedGroupsTx should delegate to resource-key GVIC+matrix sync, body:\n%s", affectedBody)
	}
	effectiveDeltaBody := extractFunctionSourceForTest(t, gvicSource, "func syncDerivedResourceGVICEffectiveAssignmentsDeltaTx")
	for _, needle := range []string{
		"not exists",
		"do nothing",
	} {
		if !strings.Contains(effectiveDeltaBody, needle) {
			t.Fatalf("syncDerivedResourceGVICEffectiveAssignmentsDeltaTx missing delta sync marker %q", needle)
		}
	}
	for _, forbidden := range []string{
		"delete from resource_gvic_effective_assignments\nwhere company_id=$1::uuid",
		"do update set updated_timestamp=now()",
	} {
		if strings.Contains(effectiveDeltaBody, forbidden) {
			t.Fatalf("syncDerivedResourceGVICEffectiveAssignmentsDeltaTx contains rebuild/retimestamp pattern %q", forbidden)
		}
	}
}

func mustCreateGVICMembershipUser(t *testing.T, repo *MemoryRepo, subject, companyID string) domain.User {
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

func mustCreateGVICMembershipNode(t *testing.T, repo *MemoryRepo, companyID, title string) domain.Node {
	t.Helper()
	node, err := repo.CreateNode(companyID, title)
	if err != nil {
		t.Fatalf("CreateNode %q: %v", title, err)
	}
	return node
}

func mustCreateGVICMembershipGateWithNode(t *testing.T, repo *MemoryRepo, companyID, gateTitle, nodeTitle string) (domain.LogicGate, domain.Node) {
	t.Helper()
	logicGate, err := repo.CreateLogicGate(companyID, gateTitle)
	if err != nil {
		t.Fatalf("CreateLogicGate %q: %v", gateTitle, err)
	}
	node := mustCreateGVICMembershipNode(t, repo, companyID, nodeTitle)
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
	return logicGate, node
}

func mustSetGVICMembershipGroupAssignment(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, groupID, role string) {
	t.Helper()
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          role,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   groupID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments %s/%s: %v", resourceType, resourceID, err)
	}
}

func mustListGVICMembershipGeneratedNodes(t *testing.T, repo *MemoryRepo, companyID, userID string) []domain.Node {
	t.Helper()
	nodes, err := repo.ListGeneratedInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: userID, Limit: 20})
	if err != nil {
		t.Fatalf("ListGeneratedInboxNodes %s: %v", userID, err)
	}
	return nodes
}

func mustFindGVICMembershipProjectionRow(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, userID string) GVICMatrixProjectionRow {
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
	rows, err := repo.ListGVICMatrixProjectionRowsForResources(companyID, nodeIDs, logicGateIDs)
	if err != nil {
		t.Fatalf("ListGVICMatrixProjectionRowsForResources %s/%s: %v", resourceType, resourceID, err)
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
	return GVICMatrixProjectionRow{}
}

func assertGVICMembershipEffectiveUsers(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID string, want []string, inheritanceType string) {
	t.Helper()
	items := mustListGVICMembershipEffective(t, repo, companyID, resourceType, resourceID)
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

func mustListGVICMembershipEffective(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID string) []domain.ResourceGVICEffectiveAssignment {
	t.Helper()
	items, err := repo.ListResourceGVICEffectiveAssignments(companyID, resourceType, resourceID)
	if err != nil {
		t.Fatalf("ListResourceGVICEffectiveAssignments %s/%s: %v", resourceType, resourceID, err)
	}
	return items
}
