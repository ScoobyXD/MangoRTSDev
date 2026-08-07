package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
)

func newV2PolicyTestRepo(t *testing.T) (*MemoryRepo, string, domain.User, domain.User, domain.User) {
	t.Helper()
	repo := NewMemoryRepo()
	companyID := "11111111-2222-4333-8444-555555555555"
	repo.EnsureCompany(companyID, "V2 policy tests")
	create := func(subject, role string) domain.User {
		user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
		if err != nil {
			t.Fatalf("UpsertAuthUser: %v", err)
		}
		if _, err := repo.AddCompanyMembership(subject, companyID, role); err != nil {
			t.Fatalf("AddCompanyMembership: %v", err)
		}
		return user
	}
	return repo, companyID, create("v2-admin", domain.RoleCompanyAdmin), create("v2-user-a", domain.RoleCompanyUser), create("v2-user-b", domain.RoleCompanyUser)
}

func putMemoryPermissionPolicy(t *testing.T, repo *MemoryRepo, input ResourcePermissionPolicyUpdateInput) ResourcePermissionPolicy {
	t.Helper()
	policy, _, err := repo.PutResourcePermissionPolicy(input)
	if err != nil {
		t.Fatalf("PutResourcePermissionPolicy: %v", err)
	}
	return policy
}

func TestV2PermissionDirectUserBeatsGroupAndAdminBypasses(t *testing.T) {
	repo, companyID, admin, userA, userB := newV2PolicyTestRepo(t)
	node, err := repo.CreateNode(companyID, "permission precedence")
	if err != nil {
		t.Fatal(err)
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "editors")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{userA.UserID, userB.UserID}); err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: group.GroupID, AccessLevel: EntityPermissionEdit},
			{SubjectType: EntityPermissionSubjectUser, SubjectID: userB.UserID, AccessLevel: EntityPermissionNoAccess},
		}, DescendantAction: PolicyDescendantActionInheritedOnly,
	})
	if allowed, _ := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, userA.UserID, EntityPermissionEdit); !allowed {
		t.Fatal("group edit was not live")
	}
	if allowed, _ := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, userB.UserID, EntityPermissionEdit); allowed {
		t.Fatal("direct user no_access did not beat group edit")
	}
	if allowed, _ := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, admin.UserID, EntityPermissionEdit); !allowed {
		t.Fatal("company admin did not bypass policy")
	}
}

func TestV2PermissionNestedGroupNearestAndEqualDepthDeny(t *testing.T) {
	repo, companyID, _, userA, _ := newV2PolicyTestRepo(t)
	node, _ := repo.CreateNode(companyID, "group precedence")
	parent, _ := repo.CreateCompanyUserGroup(companyID, "", "parent")
	child, _ := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "child")
	peer, _ := repo.CreateCompanyUserGroup(companyID, "", "peer")
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{userA.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, peer.GroupID, []string{userA.UserID}); err != nil {
		t.Fatal(err)
	}
	edit := ResourceDefaultAccessEdit
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionMode: PolicyModeCustomized, DefaultAccess: &edit, Permissions: []EntityPermissionInput{
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: parent.GroupID, AccessLevel: EntityPermissionNoAccess},
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: child.GroupID, AccessLevel: EntityPermissionEdit},
			{SubjectType: EntityPermissionSubjectGroup, SubjectID: peer.GroupID, AccessLevel: EntityPermissionNoAccess},
		}, DescendantAction: PolicyDescendantActionInheritedOnly,
	})
	if allowed, _ := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, userA.UserID, EntityPermissionEdit); allowed {
		t.Fatal("equal-depth no_access did not win")
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, peer.GroupID, nil); err != nil {
		t.Fatal(err)
	}
	if allowed, _ := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, userA.UserID, EntityPermissionEdit); !allowed {
		t.Fatal("nearest child-group edit did not beat parent deny")
	}
}

func TestV2PermissionCustomizeInheritAndForceReset(t *testing.T) {
	repo, companyID, _, userA, userB := newV2PolicyTestRepo(t)
	gate, _ := repo.CreateLogicGate(companyID, "parent")
	node, _ := repo.CreateNode(companyID, "child")
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "pending", Priority: &priority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	currentChild, err := repo.GetResourcePermissionPolicy(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		PermissionMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: currentChild.Revision,
	})
	deny := ResourceDefaultAccessNoAccess
	parent := putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: userA.UserID, AccessLevel: EntityPermissionEdit}}, DescendantAction: PolicyDescendantActionInheritedOnly,
	})
	child, err := repo.GetResourcePermissionPolicy(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	if child.PermissionMode != PolicyModeInherited || child.EffectiveSource.ResourceID != gate.LogicGateID {
		t.Fatalf("child did not inherit gate policy: %+v", child)
	}
	child = putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny,
		Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: userB.UserID, AccessLevel: EntityPermissionEdit}}, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: child.Revision,
	})
	parent = putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: userA.UserID, AccessLevel: EntityPermissionEdit}}, DescendantAction: PolicyDescendantActionIncludingCustomized,
		ExpectedRevision: parent.Revision,
	})
	_ = parent
	overwritten, _ := repo.GetResourcePermissionPolicy(companyID, EntityTypeNode, node.NodeID)
	if overwritten.OverwrittenByAncestor == nil || overwritten.EffectiveSource.ResourceID != gate.LogicGateID {
		t.Fatalf("force reset did not supersede child customization: %+v", overwritten)
	}
	activeAgain := putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny,
		Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: userB.UserID, AccessLevel: EntityPermissionEdit}}, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: overwritten.Revision,
	})
	if activeAgain.OverwrittenByAncestor != nil || activeAgain.EffectiveSource.ResourceID != node.NodeID {
		t.Fatalf("later customization did not reactivate child: %+v", activeAgain)
	}
	child = putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly, ExpectedRevision: activeAgain.Revision})
	if child.PermissionMode != PolicyModeInherited || child.EffectiveSource.ResourceID != gate.LogicGateID {
		t.Fatalf("inherit did not remove child boundary: %+v", child)
	}
}

func TestV2PermissionModeAutomaticallyTracksExactParentPolicy(t *testing.T) {
	repo, companyID, _, userA, userB := newV2PolicyTestRepo(t)
	gate, _ := repo.CreateLogicGate(companyID, "automatic parent")
	node, _ := repo.CreateNode(companyID, "automatic child")
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "pending", Priority: &priority, PrioritySet: true,
	}); err != nil {
		t.Fatal(err)
	}
	deny := ResourceDefaultAccessNoAccess
	parentPermissions := []EntityPermissionInput{
		{SubjectType: EntityPermissionSubjectUser, SubjectID: userA.UserID, AccessLevel: EntityPermissionEdit},
		{SubjectType: EntityPermissionSubjectUser, SubjectID: userB.UserID, AccessLevel: EntityPermissionNoAccess},
	}
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, Permissions: parentPermissions, DescendantAction: PolicyDescendantActionInheritedOnly,
	})
	child, err := repo.GetResourcePermissionPolicy(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	if child.ParentPolicy == nil || child.ParentPolicy.DefaultAccess != deny || len(child.ParentPolicy.Permissions) != 2 {
		t.Fatalf("parent snapshot = %+v", child.ParentPolicy)
	}

	child = putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &deny,
		Permissions:      []EntityPermissionInput{parentPermissions[1], parentPermissions[0]},
		DescendantAction: PolicyDescendantActionInheritedOnly, ExpectedRevision: child.Revision,
	})
	if child.PermissionMode != PolicyModeInherited {
		t.Fatalf("exact unordered parent match mode = %q, want inherited", child.PermissionMode)
	}

	child = putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, Permissions: parentPermissions[:1],
		DescendantAction: PolicyDescendantActionInheritedOnly, ExpectedRevision: child.Revision,
	})
	if child.PermissionMode != PolicyModeCustomized {
		t.Fatalf("different parent policy mode = %q, want customized", child.PermissionMode)
	}

	child = putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, Permissions: parentPermissions,
		DescendantAction: PolicyDescendantActionInheritedOnly, ExpectedRevision: child.Revision,
	})
	if child.PermissionMode != PolicyModeInherited {
		t.Fatalf("restored parent policy mode = %q, want inherited", child.PermissionMode)
	}
}

func TestV2PermissionRejectsStaleRevisionAndDoesNotGrantThroughRACI(t *testing.T) {
	repo, companyID, _, userA, _ := newV2PolicyTestRepo(t)
	node, _ := repo.CreateNode(companyID, "separation")
	current, _ := repo.GetResourcePermissionPolicy(companyID, EntityTypeNode, node.NodeID)
	deny := ResourceDefaultAccessNoAccess
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, DescendantAction: PolicyDescendantActionInheritedOnly, ExpectedRevision: current.Revision})
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, DescendantAction: PolicyDescendantActionInheritedOnly, ExpectedRevision: current.Revision}); err != ErrVersionConflict {
		t.Fatalf("stale write error=%v", err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, AssignmentMode: PolicyModeCustomized, Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: userA.UserID}}, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
		t.Fatal(err)
	}
	if allowed, _ := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, userA.UserID, EntityPermissionEdit); allowed {
		t.Fatal("RACI incorrectly granted Edit permission")
	}
}
