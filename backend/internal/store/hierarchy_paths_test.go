package store

import (
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryCompanyExplorerHierarchyPathDerivesTypedAncestors(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-660000000101"
	repo.EnsureCompany(companyID, "Hierarchy Paths")
	admin, err := repo.UpsertAuthUser("hierarchy-path-admin", "hierarchy-admin@example.com", "Hierarchy Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	parent, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{CompanyID: companyID, ParentEntityID: companyID, Name: "Operations", PermissionUserID: admin.UserID})
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{CompanyID: companyID, ParentEntityID: parent.EntityID, Name: "Fulfillment", PermissionUserID: admin.UserID})
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Order Intake")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID: companyID, ParentEntityID: child.EntityID,
		ChildEntityType: EntityTypeLogicGate, ChildResourceID: gate.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Confirm shipping address")
	if err != nil {
		t.Fatal(err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID,
		Priority: &priority, PrioritySet: true,
	}); err != nil {
		t.Fatal(err)
	}

	gatePath, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, gatePath, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusResolved,
		[]string{CompanyExplorerV2EntityFolder, CompanyExplorerV2EntityFolder}, []string{"Operations", "Fulfillment"})

	nodePath, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, nodePath, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusResolved,
		[]string{CompanyExplorerV2EntityFolder, CompanyExplorerV2EntityFolder, EntityTypeLogicGate}, []string{"Operations", "Fulfillment", "Order Intake"})
	for _, segment := range nodePath.Segments {
		if segment.Name == node.Title {
			t.Fatalf("Node title %q was duplicated inside its hierarchy path", node.Title)
		}
	}

	if _, err := repo.RenameCompanyExplorerFolder(companyID, parent.EntityID, "Customer Operations", admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	renamed, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Segments[0].Name != "Customer Operations" {
		t.Fatalf("renamed path = %+v, want current folder name", renamed.Segments)
	}
}

func TestMemoryCompanyExplorerHierarchyPathDistinguishesRootMissingAndUnsafeAncestry(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-660000000102"
	repo.EnsureCompany(companyID, "Hierarchy Status")
	admin, err := repo.UpsertAuthUser("hierarchy-status-admin", "hierarchy-status-admin@example.com", "Hierarchy Status Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Root Process")
	if err != nil {
		t.Fatal(err)
	}
	rootRow, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID: companyID, ParentEntityID: companyID,
		ChildEntityType: EntityTypeLogicGate, ChildResourceID: gate.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	rootPath, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, rootPath, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusResolved, []string{}, []string{})

	if err := repo.DeleteCompanyExplorerV2Edge(companyID, rootRow.EdgeID, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	missingPath, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, missingPath, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusOmitted, []string{}, []string{})

	cycleA, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{CompanyID: companyID, ParentEntityID: companyID, Name: "Cycle A"})
	if err != nil {
		t.Fatal(err)
	}
	cycleB, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{CompanyID: companyID, ParentEntityID: cycleA.EntityID, Name: "Cycle B"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{CompanyID: companyID, ParentEntityID: cycleB.EntityID, ChildEntityType: EntityTypeLogicGate, ChildResourceID: gate.LogicGateID}); err != nil {
		t.Fatal(err)
	}
	repo.mu.Lock()
	cycleAFolder := repo.folders[key(companyID, cycleA.EntityID)]
	cycleAParent := cycleB.EntityID
	cycleAFolder.ParentFolderID = &cycleAParent
	repo.folders[key(companyID, cycleA.EntityID)] = cycleAFolder
	repo.mu.Unlock()
	cyclePath, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, cyclePath, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusOmitted, []string{}, []string{})
}

func TestMemoryNodeHierarchyPathUsesVisibleGateThenProjectAndOmitsAllHiddenPaths(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-660000000104"
	repo.EnsureCompany(companyID, "Node Hierarchy Priority")
	admin, err := repo.UpsertAuthUser("node-hierarchy-admin", "node-hierarchy-admin@example.com", "Node Hierarchy Admin")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := repo.UpsertAuthUser("node-hierarchy-viewer", "node-hierarchy-viewer@example.com", "Node Hierarchy Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	gateFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{CompanyID: companyID, ParentEntityID: companyID, Name: "Process Home"})
	if err != nil {
		t.Fatal(err)
	}
	projectFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{CompanyID: companyID, ParentEntityID: companyID, Name: "Project Home"})
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Priority Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{CompanyID: companyID, ParentEntityID: gateFolder.EntityID, ChildEntityType: EntityTypeLogicGate, ChildResourceID: gate.LogicGateID}); err != nil {
		t.Fatal(err)
	}
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Fallback Project", Status: "Active", CompanyExplorerDefaultPlacement: true})
	if err != nil {
		t.Fatal(err)
	}
	project := projectResult.Project
	if project == nil {
		t.Fatal("CreateProject returned no Project")
	}
	if _, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{CompanyID: companyID, ParentEntityID: projectFolder.EntityID, ChildEntityType: EntityTypeProject, ChildResourceID: project.ProjectID}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Priority Node")
	if err != nil {
		t.Fatal(err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Priority: &priority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{CompanyID: companyID, ProjectID: project.ProjectID, ResourceType: EntityTypeNode, ResourceID: node.NodeID}); err != nil {
		t.Fatal(err)
	}

	customizeForViewer := func(resourceType, resourceID string) {
		t.Helper()
		if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
			CompanyID: companyID, EntityType: resourceType, EntityID: resourceID,
			DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true,
			Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: EntityPermissionEdit}},
			ActorUserID: admin.UserID,
		}); err != nil {
			t.Fatalf("SetEntityPermissions(%s/%s): %v", resourceType, resourceID, err)
		}
	}
	customizeForViewer(EntityTypeLogicGate, gate.LogicGateID)
	customizeForViewer(EntityTypeProject, project.ProjectID)
	customizeForViewer(EntityTypeNode, node.NodeID)

	visibleGate, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionUserID: viewer.UserID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, visibleGate, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusResolved,
		[]string{CompanyExplorerV2EntityFolder, EntityTypeLogicGate}, []string{"Process Home", "Priority Process"})

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeCompanyExplorerFolder, EntityID: gateFolder.EntityID,
		DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	projectFallback, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionUserID: viewer.UserID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, projectFallback, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusResolved,
		[]string{CompanyExplorerV2EntityFolder, EntityTypeProject}, []string{"Project Home", "Fallback Project"})

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeCompanyExplorerFolder, EntityID: projectFolder.EntityID,
		DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	allHidden, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, PermissionUserID: viewer.UserID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, allHidden, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusOmitted, []string{}, []string{})
}

func TestMemoryHuddleExplorerHierarchyPathUsesHuddleFolderTypeAndRequiresPlacement(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-660000000103"
	repo.EnsureCompany(companyID, "Huddle Hierarchy")
	normalGate, err := repo.CreateLogicGate(companyID, "Daily Operations")
	if err != nil {
		t.Fatal(err)
	}
	huddleGate, err := repo.ConvertLogicGateToHuddle(companyID, normalGate.LogicGateID, "")
	if err != nil {
		t.Fatal(err)
	}
	rootPath, err := repo.GetHuddleExplorerHierarchyPath(HuddleExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeHuddleLogicGate, ResourceID: huddleGate.HuddleLogicGateID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, rootPath, ExplorerHierarchyKindHuddleExplorer, ExplorerHierarchyStatusResolved, []string{}, []string{})

	parent, err := repo.CreateHuddleExplorerFolder(HuddleCreateInput{CompanyID: companyID, Name: "Huddles"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateHuddleExplorerFolder(HuddleCreateInput{CompanyID: companyID, OwnerID: parent.FolderID, Name: "Standups"})
	if err != nil {
		t.Fatal(err)
	}
	explorer, err := repo.ListHuddleExplorer(companyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(explorer.Items) != 1 {
		t.Fatalf("Huddle Explorer items = %+v, want one", explorer.Items)
	}
	itemID := explorer.Items[0].ItemID
	if err := repo.MoveHuddleExplorerItem(HuddleMoveInput{CompanyID: companyID, ResourceID: itemID, ParentFolderID: child.FolderID}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: companyID, OwnerID: huddleGate.HuddleLogicGateID, Name: "Tuesday Review"})
	if err != nil {
		t.Fatal(err)
	}
	nodePath, err := repo.GetHuddleExplorerHierarchyPath(HuddleExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeHuddleNode, ResourceID: node.HuddleNodeID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, nodePath, ExplorerHierarchyKindHuddleExplorer, ExplorerHierarchyStatusResolved,
		[]string{HuddleExplorerHierarchyEntityFolder, HuddleExplorerHierarchyEntityFolder, EntityTypeHuddleLogicGate}, []string{"Huddles", "Standups", "Daily Operations"})

	if err := repo.DeleteHuddleExplorerItem(companyID, itemID, ""); err != nil {
		t.Fatal(err)
	}
	missingPath, err := repo.GetHuddleExplorerHierarchyPath(HuddleExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeHuddleLogicGate, ResourceID: huddleGate.HuddleLogicGateID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, missingPath, ExplorerHierarchyKindHuddleExplorer, ExplorerHierarchyStatusOmitted, []string{}, []string{})
}

func assertHierarchyPath(t *testing.T, path ExplorerHierarchyPath, wantKind, wantStatus string, wantTypes, wantNames []string) {
	t.Helper()
	if path.Kind != wantKind || path.Status != wantStatus {
		t.Fatalf("path kind/status = %s/%s, want %s/%s: %+v", path.Kind, path.Status, wantKind, wantStatus, path)
	}
	if len(path.Segments) != len(wantNames) || len(wantTypes) != len(wantNames) {
		t.Fatalf("path segments = %+v, want types=%v names=%v", path.Segments, wantTypes, wantNames)
	}
	for index := range wantNames {
		if path.Segments[index].EntityType != wantTypes[index] || path.Segments[index].Name != wantNames[index] {
			t.Fatalf("path segment[%d] = %+v, want type=%s name=%s", index, path.Segments[index], wantTypes[index], wantNames[index])
		}
	}
}
