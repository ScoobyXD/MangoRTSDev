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
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeLogicGate,
		EntityID:         firstGate.LogicGateID,
		DefaultAccess:    ResourceDefaultAccessEdit,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{other.UserID},
	}); err != nil {
		t.Fatalf("set first gate policy: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: firstGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: allowed.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
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
	if loaded.DefaultAccess != ResourceDefaultAccessEdit {
		t.Fatalf("assignment copied node default_access = %q, want edit", loaded.DefaultAccess)
	}
	permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListEntityPermissions after assignment: %v", err)
	}
	if len(permissions) != 1 || permissions[0].SubjectID != other.UserID || permissions[0].AccessLevel != EntityPermissionNoAccess {
		t.Fatalf("assignment copied permissions = %+v, want first gate denied override", permissions)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{allowed.UserID},
	}); err != nil {
		t.Fatalf("set manual node policy: %v", err)
	}
	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: firstGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "In Progress",
	}); err != nil {
		t.Fatalf("same-gate move: %v", err)
	}
	assertMemoryNodeResourcePolicyForTest(t, repo, companyID, node.NodeID, ResourceDefaultAccessNoAccess, map[string]string{allowed.UserID: EntityPermissionEdit})

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
	permissions, err = repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID)
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

func TestMemoryResourceAccessPolicyFolderTemplateSnapshots(t *testing.T) {
	repo, companyID, _, allowed, other := setupResourceAccessPolicyTest(t)
	parentFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:      companyID,
		ParentEntityID: companyID,
		Name:           "Template folder",
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder parent: %v", err)
	}
	setMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeCompanyExplorerFolder, parentFolder.EntityID, ResourceDefaultAccessNoAccess, []string{allowed.UserID})

	childFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:      companyID,
		ParentEntityID: parentFolder.EntityID,
		Name:           "Child folder",
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder child: %v", err)
	}
	assertMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeCompanyExplorerFolder, childFolder.EntityID, ResourceDefaultAccessNoAccess, map[string]string{allowed.UserID: EntityPermissionEdit})

	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Placed project", Status: "Active"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if projectResult.Project == nil {
		t.Fatalf("CreateProject returned nil project")
	}
	projectRow, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID:       companyID,
		ParentEntityID:  parentFolder.EntityID,
		ChildEntityType: EntityTypeProject,
		ChildResourceID: projectResult.Project.ProjectID,
	})
	if err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge project: %v", err)
	}
	assertMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeProject, projectResult.Project.ProjectID, ResourceDefaultAccessNoAccess, map[string]string{allowed.UserID: EntityPermissionEdit})

	logicGate, err := repo.CreateLogicGate(companyID, "Placed gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID:       companyID,
		ParentEntityID:  parentFolder.EntityID,
		ChildEntityType: EntityTypeLogicGate,
		ChildResourceID: logicGate.LogicGateID,
	}); err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge logic gate: %v", err)
	}
	assertMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, ResourceDefaultAccessNoAccess, map[string]string{allowed.UserID: EntityPermissionEdit})

	setMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeCompanyExplorerFolder, parentFolder.EntityID, ResourceDefaultAccessEdit, []string{other.UserID})
	assertMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeCompanyExplorerFolder, childFolder.EntityID, ResourceDefaultAccessNoAccess, map[string]string{allowed.UserID: EntityPermissionEdit})
	assertMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeProject, projectResult.Project.ProjectID, ResourceDefaultAccessNoAccess, map[string]string{allowed.UserID: EntityPermissionEdit})
	assertMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeLogicGate, logicGate.LogicGateID, ResourceDefaultAccessNoAccess, map[string]string{allowed.UserID: EntityPermissionEdit})

	setMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeProject, projectResult.Project.ProjectID, ResourceDefaultAccessEdit, nil)
	if _, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID:       companyID,
		ParentEntityID:  parentFolder.EntityID,
		ChildEntityType: EntityTypeProject,
		ChildResourceID: projectResult.Project.ProjectID,
		Position:        5000,
	}); err != nil {
		t.Fatalf("same-folder project upsert: %v", err)
	}
	assertMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeProject, projectResult.Project.ProjectID, ResourceDefaultAccessEdit, map[string]string{})

	targetFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:      companyID,
		ParentEntityID: companyID,
		Name:           "Target folder",
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder target: %v", err)
	}
	setMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeCompanyExplorerFolder, targetFolder.EntityID, ResourceDefaultAccessEdit, []string{other.UserID})
	if _, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID:      companyID,
		EdgeID:         projectRow.EdgeID,
		ParentEntityID: targetFolder.EntityID,
	}); err != nil {
		t.Fatalf("MoveCompanyExplorerV2Edge project: %v", err)
	}
	assertMemoryResourcePolicyForTest(t, repo, companyID, EntityTypeProject, projectResult.Project.ProjectID, ResourceDefaultAccessEdit, map[string]string{other.UserID: EntityPermissionNoAccess})
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

func TestMemoryResourceAccessPolicyManagerActorPreservesManagerAccess(t *testing.T) {
	repo, companyID, _, allowed, other := setupResourceAccessPolicyTest(t)
	manager, err := repo.UpsertAuthUser("resource-manager", "resource-manager@example.com", "Resource Manager")
	if err != nil {
		t.Fatalf("UpsertAuthUser manager: %v", err)
	}
	peerManager, err := repo.UpsertAuthUser("resource-peer-manager", "resource-peer-manager@example.com", "Peer Manager")
	if err != nil {
		t.Fatalf("UpsertAuthUser peer manager: %v", err)
	}
	if _, err := repo.AddCompanyMembership("resource-manager", companyID, domain.RoleCompanyManager); err != nil {
		t.Fatalf("AddCompanyMembership manager: %v", err)
	}
	if _, err := repo.AddCompanyMembership("resource-peer-manager", companyID, domain.RoleCompanyManager); err != nil {
		t.Fatalf("AddCompanyMembership peer manager: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Manager policy node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{allowed.UserID},
		ActorUserID:      manager.UserID,
	}); err != nil {
		t.Fatalf("manager SetEntityPermissions default no_access: %v", err)
	}
	for label, userID := range map[string]string{
		"manager":      manager.UserID,
		"peer manager": peerManager.UserID,
		"allowed user": allowed.UserID,
	} {
		access, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, userID, EntityPermissionEdit)
		if err != nil || !access {
			t.Fatalf("%s access after manager default flip = %v err=%v, want true", label, access, err)
		}
	}
	if access, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, other.UserID, EntityPermissionEdit); err != nil || access {
		t.Fatalf("other user access after manager default flip = %v err=%v, want false", access, err)
	}

	permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListEntityPermissions: %v", err)
	}
	rows := map[string]string{}
	for _, permission := range permissions {
		rows[permission.SubjectID] = permission.AccessLevel
	}
	for _, userID := range []string{allowed.UserID, manager.UserID, peerManager.UserID} {
		if rows[userID] != EntityPermissionEdit {
			t.Fatalf("permission rows = %+v, want edit row for %s", rows, userID)
		}
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    ResourceDefaultAccessEdit,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{peerManager.UserID, other.UserID},
		ActorUserID:      manager.UserID,
	}); err != nil {
		t.Fatalf("manager SetEntityPermissions attempted peer deny: %v", err)
	}
	if access, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, peerManager.UserID, EntityPermissionEdit); err != nil || !access {
		t.Fatalf("peer manager access after attempted deny = %v err=%v, want true", access, err)
	}
	if access, err := repo.UserCanAccessEntity(companyID, EntityTypeNode, node.NodeID, other.UserID, EntityPermissionEdit); err != nil || access {
		t.Fatalf("other user access after deny = %v err=%v, want false", access, err)
	}
	permissions, err = repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListEntityPermissions after attempted peer deny: %v", err)
	}
	rows = map[string]string{}
	for _, permission := range permissions {
		rows[permission.SubjectID] = permission.AccessLevel
	}
	if _, ok := rows[peerManager.UserID]; ok {
		t.Fatalf("peer manager row after attempted deny = %+v, want no manager row", rows)
	}
	if rows[other.UserID] != EntityPermissionNoAccess {
		t.Fatalf("other user row after deny = %+v, want no_access row", rows)
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

func assertMemoryResourcePolicyForTest(t *testing.T, repo *MemoryRepo, companyID, entityType, entityID, wantDefault string, wantRows map[string]string) {
	t.Helper()
	gotDefault := memoryResourceDefaultAccessForTest(t, repo, companyID, entityType, entityID)
	if gotDefault != wantDefault {
		t.Fatalf("%s default_access = %q, want %q", entityType, gotDefault, wantDefault)
	}
	permissions, err := repo.ListEntityPermissions(companyID, entityType, entityID)
	if err != nil {
		t.Fatalf("ListEntityPermissions %s/%s: %v", entityType, entityID, err)
	}
	got := make(map[string]string, len(permissions))
	for _, permission := range permissions {
		got[permission.SubjectID] = permission.AccessLevel
	}
	if len(got) != len(wantRows) {
		t.Fatalf("%s permissions = %+v, want %+v", entityType, permissions, wantRows)
	}
	for userID, accessLevel := range wantRows {
		if got[userID] != accessLevel {
			t.Fatalf("%s permission for user %s = %q, want %q; all permissions = %+v", entityType, userID, got[userID], accessLevel, permissions)
		}
	}
}

func memoryResourceDefaultAccessForTest(t *testing.T, repo *MemoryRepo, companyID, entityType, entityID string) string {
	t.Helper()
	switch entityType {
	case EntityTypeNode:
		node, err := repo.GetNode(companyID, entityID)
		if err != nil {
			t.Fatalf("GetNode: %v", err)
		}
		return node.DefaultAccess
	case EntityTypeLogicGate:
		logicGate, err := repo.GetLogicGate(companyID, entityID)
		if err != nil {
			t.Fatalf("GetLogicGate: %v", err)
		}
		return logicGate.DefaultAccess
	case EntityTypeProject:
		project, err := repo.GetProject(companyID, entityID)
		if err != nil {
			t.Fatalf("GetProject: %v", err)
		}
		return project.DefaultAccess
	case EntityTypeCompanyExplorerFolder:
		defaultAccess, err := repo.GetCompanyExplorerV2FolderDefaultAccess(companyID, entityID)
		if err != nil {
			t.Fatalf("GetCompanyExplorerV2FolderDefaultAccess: %v", err)
		}
		return defaultAccess
	default:
		t.Fatalf("unsupported resource type %q", entityType)
		return ""
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
