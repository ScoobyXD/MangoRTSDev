package store

import (
	"miraeopus/backend/internal/domain"
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

	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeNode, parentNode.NodeID, parent.GroupID, domain.GVICRoleGenerated)
	mustSetGVICMembershipGroupAssignment(t, repo, companyID, EntityTypeNode, childNode.NodeID, child.GroupID, domain.GVICRoleVerified)
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
