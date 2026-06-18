package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
)

func setupResourceAccessPolicyTest(t *testing.T) (*MemoryRepo, string, domain.User, domain.User, domain.User) {
	t.Helper()
	repo := NewMemoryRepo()
	companyID := "11111111-2222-4333-8444-555555555555"
	repo.EnsureCompany(companyID, "Resource Access Co")
	admin, err := repo.UpsertAuthUser("resource-admin", "resource-admin@example.com", "Resource Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser admin: %v", err)
	}
	allowed, err := repo.UpsertAuthUser("resource-allowed", "resource-allowed@example.com", "Resource Allowed")
	if err != nil {
		t.Fatalf("UpsertAuthUser allowed: %v", err)
	}
	other, err := repo.UpsertAuthUser("resource-other", "resource-other@example.com", "Resource Other")
	if err != nil {
		t.Fatalf("UpsertAuthUser other: %v", err)
	}
	if _, err := repo.AddCompanyMembership("resource-admin", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership("resource-allowed", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership allowed: %v", err)
	}
	if _, err := repo.AddCompanyMembership("resource-other", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership other: %v", err)
	}
	return repo, companyID, admin, allowed, other
}

func TestMemoryResourceAccessPolicyDefaultOverrideSemantics(t *testing.T) {
	repo, companyID, admin, allowed, other := setupResourceAccessPolicyTest(t)
	node, err := repo.CreateNode(companyID, "Policy node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Policy gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if node.DefaultAccess != ResourceDefaultAccessEdit {
		t.Fatalf("node default_access = %q, want edit", node.DefaultAccess)
	}
	if gate.DefaultAccess != ResourceDefaultAccessEdit {
		t.Fatalf("logic gate default_access = %q, want edit", gate.DefaultAccess)
	}
	if permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID); err != nil || len(permissions) != 0 {
		t.Fatalf("new node permissions = %v err = %v, want no creator/override rows", permissions, err)
	}
	if allowedAccess, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, other.UserID, EntityPermissionEdit); err != nil || !allowedAccess {
		t.Fatalf("default edit/no override allowed = %v err = %v, want true", allowedAccess, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:       companyID,
		EntityType:      EntityTypeNode,
		EntityID:        node.NodeID,
		OverrideUserIDs: []string{other.UserID},
	}); err != nil {
		t.Fatalf("deny override: %v", err)
	}
	if allowedAccess, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, other.UserID, EntityPermissionView); err != nil || allowedAccess {
		t.Fatalf("default edit/override denied = %v err = %v, want false", allowedAccess, err)
	}
	if adminAccess, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, admin.UserID, EntityPermissionAdmin); err != nil || !adminAccess {
		t.Fatalf("admin bypass = %v err = %v, want true", adminAccess, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{allowed.UserID},
	}); err != nil {
		t.Fatalf("default no_access allow override: %v", err)
	}
	if allowedAccess, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, other.UserID, EntityPermissionEdit); err != nil || allowedAccess {
		t.Fatalf("default no_access/no override allowed = %v err = %v, want false", allowedAccess, err)
	}
	if allowedAccess, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, allowed.UserID, EntityPermissionEdit); err != nil || !allowedAccess {
		t.Fatalf("default no_access/override allowed = %v err = %v, want true", allowedAccess, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessEdit,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{allowed.UserID},
	}); err != nil {
		t.Fatalf("toggle default: %v", err)
	}
	permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListEntityPermissions after toggle: %v", err)
	}
	if len(permissions) != 1 || permissions[0].SubjectID != allowed.UserID || permissions[0].AccessLevel != EntityPermissionNoAccess {
		t.Fatalf("toggle permissions = %+v, want same override user as denied exception", permissions)
	}
	if allowedAccess, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, allowed.UserID, EntityPermissionEdit); err != nil || allowedAccess {
		t.Fatalf("toggle inverted access = %v err = %v, want false", allowedAccess, err)
	}
}

func TestMemoryResourceAccessPolicyAssignmentMovementRules(t *testing.T) {
	repo, companyID, _, allowed, other := setupResourceAccessPolicyTest(t)
	node, err := repo.CreateNode(companyID, "Move policy node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: &priority, PrioritySet: true}); err != nil {
		t.Fatalf("UpdateNode priority: %v", err)
	}
	firstGate, err := repo.CreateLogicGate(companyID, "First gate")
	if err != nil {
		t.Fatalf("CreateLogicGate first: %v", err)
	}
	secondGate, err := repo.CreateLogicGate(companyID, "Second gate")
	if err != nil {
		t.Fatalf("CreateLogicGate second: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("set node default: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: firstGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: allowed.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: firstGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "Pending",
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	loaded, err := repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after assignment: %v", err)
	}
	if loaded.DefaultAccess != ResourceDefaultAccessNoAccess {
		t.Fatalf("assignment mutated node default_access = %q, want no_access", loaded.DefaultAccess)
	}
	if permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID); err != nil || len(permissions) != 0 {
		t.Fatalf("assignment permissions = %v err = %v, want unchanged empty overrides", permissions, err)
	}
	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: firstGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "In Progress",
	}); err != nil {
		t.Fatalf("same-gate move: %v", err)
	}
	if permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID); err != nil || len(permissions) != 0 {
		t.Fatalf("same-gate move permissions = %v err = %v, want unchanged empty overrides", permissions, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeLogicGate,
		EntityID:         secondGate.LogicGateID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{other.UserID},
	}); err != nil {
		t.Fatalf("set second gate policy: %v", err)
	}
	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:       companyID,
		FromLogicGateID: firstGate.LogicGateID,
		LogicGateID:     secondGate.LogicGateID,
		NodeID:          node.NodeID,
		Status:          "Pending",
	}); err != nil {
		t.Fatalf("cross-gate move: %v", err)
	}
	loaded, err = repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after cross move: %v", err)
	}
	if loaded.DefaultAccess != ResourceDefaultAccessNoAccess {
		t.Fatalf("cross-gate copy node default_access = %q, want no_access", loaded.DefaultAccess)
	}
	permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListEntityPermissions after cross move: %v", err)
	}
	if len(permissions) != 1 || permissions[0].SubjectID != other.UserID || permissions[0].AccessLevel != EntityPermissionEdit {
		t.Fatalf("cross-gate copied permissions = %+v, want second gate allowed override", permissions)
	}
}

func TestMemoryResourceAccessPolicyCrossGateMoveOverwritesNodePolicy(t *testing.T) {
	cases := []struct {
		name          string
		nodeDefault   string
		nodeOverrides []string
		gateDefault   string
		gateOverrides []string
		wantDefault   string
		wantRows      map[string]string
	}{
		{
			name:          "same default and same rows",
			nodeDefault:   ResourceDefaultAccessNoAccess,
			nodeOverrides: []string{"allowed"},
			gateDefault:   ResourceDefaultAccessNoAccess,
			gateOverrides: []string{"allowed"},
			wantDefault:   ResourceDefaultAccessNoAccess,
			wantRows:      map[string]string{"allowed": EntityPermissionEdit},
		},
		{
			name:          "same users with different access levels",
			nodeDefault:   ResourceDefaultAccessNoAccess,
			nodeOverrides: []string{"allowed"},
			gateDefault:   ResourceDefaultAccessEdit,
			gateOverrides: []string{"allowed"},
			wantDefault:   ResourceDefaultAccessEdit,
			wantRows:      map[string]string{"allowed": EntityPermissionNoAccess},
		},
		{
			name:          "extra node user",
			nodeDefault:   ResourceDefaultAccessNoAccess,
			nodeOverrides: []string{"allowed", "other"},
			gateDefault:   ResourceDefaultAccessNoAccess,
			gateOverrides: []string{"allowed"},
			wantDefault:   ResourceDefaultAccessNoAccess,
			wantRows:      map[string]string{"allowed": EntityPermissionEdit},
		},
		{
			name:          "missing node user",
			nodeDefault:   ResourceDefaultAccessNoAccess,
			nodeOverrides: nil,
			gateDefault:   ResourceDefaultAccessNoAccess,
			gateOverrides: []string{"allowed"},
			wantDefault:   ResourceDefaultAccessNoAccess,
			wantRows:      map[string]string{"allowed": EntityPermissionEdit},
		},
		{
			name:          "different default access",
			nodeDefault:   ResourceDefaultAccessEdit,
			nodeOverrides: nil,
			gateDefault:   ResourceDefaultAccessNoAccess,
			gateOverrides: nil,
			wantDefault:   ResourceDefaultAccessNoAccess,
			wantRows:      map[string]string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo, companyID, _, allowed, other := setupResourceAccessPolicyTest(t)
			userIDs := map[string]string{
				"allowed": allowed.UserID,
				"other":   other.UserID,
			}
			node, err := repo.CreateNode(companyID, "Move exact policy node")
			if err != nil {
				t.Fatalf("CreateNode: %v", err)
			}
			priority := 2
			if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: &priority, PrioritySet: true}); err != nil {
				t.Fatalf("UpdateNode priority: %v", err)
			}
			sourceGate, err := repo.CreateLogicGate(companyID, "Source policy gate")
			if err != nil {
				t.Fatalf("CreateLogicGate source: %v", err)
			}
			targetGate, err := repo.CreateLogicGate(companyID, "Target policy gate")
			if err != nil {
				t.Fatalf("CreateLogicGate target: %v", err)
			}
			if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
				CompanyID:   companyID,
				LogicGateID: sourceGate.LogicGateID,
				NodeID:      node.NodeID,
				Status:      "Pending",
			}); err != nil {
				t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
			}
			setMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeNode, node.NodeID, tc.nodeDefault, resourcePolicyOverrideIDsForTest(tc.nodeOverrides, userIDs))
			setMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeLogicGate, targetGate.LogicGateID, tc.gateDefault, resourcePolicyOverrideIDsForTest(tc.gateOverrides, userIDs))

			if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
				CompanyID:       companyID,
				FromLogicGateID: sourceGate.LogicGateID,
				LogicGateID:     targetGate.LogicGateID,
				NodeID:          node.NodeID,
				Status:          "Pending",
			}); err != nil {
				t.Fatalf("MoveLogicGateNodeAssignment: %v", err)
			}
			assertMemoryNodeResourcePolicyForTest(t, repo, companyID, node.NodeID, tc.wantDefault, resourcePolicyExpectedRowsForTest(tc.wantRows, userIDs))
		})
	}
}

func TestMemoryResourceAccessPolicyNewCompanyUserFollowsDefault(t *testing.T) {
	repo, companyID, _, _, _ := setupResourceAccessPolicyTest(t)
	node, err := repo.CreateNode(companyID, "New user policy node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("set default no_access: %v", err)
	}
	newUser, err := repo.UpsertAuthUser("resource-new-user", "resource-new-user@example.com", "Resource New User")
	if err != nil {
		t.Fatalf("UpsertAuthUser new: %v", err)
	}
	if _, err := repo.AddCompanyMembership("resource-new-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership new: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, newUser.UserID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("new user follows no_access default = %v err = %v, want false", allowed, err)
	}
	if permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID); err != nil || len(permissions) != 0 {
		t.Fatalf("new user created rows = %v err = %v, want none", permissions, err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessEdit,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("set default edit: %v", err)
	}
	if allowed, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, newUser.UserID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("new user follows edit default = %v err = %v, want true", allowed, err)
	}
}

func setMemoryResourcePolicyForTest(t *testing.T, repo *MemoryRepo, companyID, entityType, entityID, defaultAccess string, overrideUserIDs []string) {
	t.Helper()
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       entityType,
		EntityID:         entityID,
		DefaultAccess:    defaultAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  overrideUserIDs,
	}); err != nil {
		t.Fatalf("SetEntityPermissions %s/%s: %v", entityType, entityID, err)
	}
}

func assertMemoryNodeResourcePolicyForTest(t *testing.T, repo *MemoryRepo, companyID, nodeID, wantDefault string, wantRows map[string]string) {
	t.Helper()
	node, err := repo.GetNode(companyID, nodeID)
	if err != nil {
		t.Fatalf("GetNode: %v", err)
	}
	if node.DefaultAccess != wantDefault {
		t.Fatalf("node default_access = %q, want %q", node.DefaultAccess, wantDefault)
	}
	permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, nodeID)
	if err != nil {
		t.Fatalf("ListEntityPermissions: %v", err)
	}
	got := make(map[string]string, len(permissions))
	for _, permission := range permissions {
		got[permission.SubjectID] = permission.AccessLevel
	}
	if len(got) != len(wantRows) {
		t.Fatalf("node permissions = %+v, want %+v", permissions, wantRows)
	}
	for userID, accessLevel := range wantRows {
		if got[userID] != accessLevel {
			t.Fatalf("node permission for user %s = %q, want %q; all permissions = %+v", userID, got[userID], accessLevel, permissions)
		}
	}
}

func resourcePolicyOverrideIDsForTest(names []string, userIDs map[string]string) []string {
	out := make([]string, 0, len(names))
	for _, name := range names {
		out = append(out, userIDs[name])
	}
	return out
}

func resourcePolicyExpectedRowsForTest(rows map[string]string, userIDs map[string]string) map[string]string {
	out := make(map[string]string, len(rows))
	for name, accessLevel := range rows {
		out[userIDs[name]] = accessLevel
	}
	return out
}
