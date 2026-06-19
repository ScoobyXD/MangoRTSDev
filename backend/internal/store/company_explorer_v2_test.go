package store

import (
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryCompanyExplorerV2SubscriptionsUseRealTreeShape(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-220000000001"
	repo.EnsureCompany(companyID, "V2 Explorer Co")

	user, err := repo.UpsertAuthUser("v2-roots-user", "v2-roots@example.com", "V2 Roots User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("v2-roots-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Operations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}

	allRoots, err := repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows all: %v", err)
	}
	companyRoot := requireCompanyExplorerV2Row(t, allRoots.Rows, CompanyExplorerV2EntityCompany, companyID)
	if len(allRoots.Rows) != 1 || companyRoot.ParentEntityID != "" {
		t.Fatalf("all roots = %+v, want only company root", allRoots.Rows)
	}

	meRoots, err := repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeMe,
		ScopeUserID:      user.UserID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows me before subscription: %v", err)
	}
	if len(meRoots.Rows) != 0 {
		t.Fatalf("me roots before subscription = %+v, want empty tag view", meRoots.Rows)
	}

	folder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:        companyID,
		ParentEntityID:   companyRoot.EntityID,
		Name:             "Customer Work",
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder: %v", err)
	}
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Customer Project", Status: "Active", ActorUserID: user.UserID})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	project := projectResult.Project
	if project == nil {
		t.Fatalf("CreateProject returned nil project")
	}
	projectRow, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID:        companyID,
		ParentEntityID:   folder.EntityID,
		ChildEntityType:  CompanyExplorerV2EntityProject,
		ChildResourceID:  project.ProjectID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge project: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Launch Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:    companyID,
		ProjectID:    project.ProjectID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		ActorUserID:  user.UserID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Launch Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	assignmentPriority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:      companyID,
		LogicGateID:    logicGate.LogicGateID,
		NodeID:         node.NodeID,
		Priority:       &assignmentPriority,
		PrioritySet:    true,
		MutationOrigin: "test",
		ActorUserID:    user.UserID,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	nodeEntityID := companyExplorerV2NativeEntityID(companyID, CompanyExplorerV2EntityNode, node.NodeID)
	if _, err := repo.UpsertCompanyExplorerV2Subscription(CompanyExplorerV2SubscriptionInput{
		CompanyID:        companyID,
		OwnerType:        CompanyExplorerV2SubscriptionOwnerUser,
		OwnerID:          user.UserID,
		AnchorEntityID:   nodeEntityID,
		ActorUserID:      user.UserID,
		PermissionUserID: user.UserID,
	}); err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Subscription node: %v", err)
	}

	meRoots, err = repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeMe,
		ScopeUserID:      user.UserID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows me after subscription: %v", err)
	}
	meFolder := requireCompanyExplorerV2Row(t, meRoots.Rows, CompanyExplorerV2EntityFolder, folder.EntityID)
	if meFolder.ParentEntityID != "" {
		t.Fatalf("subscribed ancestor root parent = %q, want empty tag root", meFolder.ParentEntityID)
	}
	folderChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeMe,
		ScopeUserID:      user.UserID,
		ParentEntityID:   folder.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows subscribed folder: %v", err)
	}
	requireCompanyExplorerV2Row(t, folderChildren.Rows, CompanyExplorerV2EntityProject, project.ProjectID)
	projectChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeMe,
		ScopeUserID:      user.UserID,
		ParentEntityID:   projectRow.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows subscribed project: %v", err)
	}
	logicGateRow := requireCompanyExplorerV2Row(t, projectChildren.Rows, CompanyExplorerV2EntityLogicGate, logicGate.LogicGateID)
	logicGateChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeMe,
		ScopeUserID:      user.UserID,
		ParentEntityID:   logicGateRow.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows subscribed logic gate: %v", err)
	}
	requireCompanyExplorerV2Row(t, logicGateChildren.Rows, CompanyExplorerV2EntityNode, node.NodeID)

	logicGateEntityID := companyExplorerV2NativeEntityID(companyID, CompanyExplorerV2EntityLogicGate, logicGate.LogicGateID)
	if _, err := repo.UpsertCompanyExplorerV2Subscription(CompanyExplorerV2SubscriptionInput{
		CompanyID:        companyID,
		OwnerType:        CompanyExplorerV2SubscriptionOwnerTeam,
		OwnerID:          group.GroupID,
		AnchorEntityID:   logicGateEntityID,
		ActorUserID:      user.UserID,
		PermissionUserID: user.UserID,
	}); err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Subscription team logic gate: %v", err)
	}
	teamGateChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeTeam,
		ScopeUserID:      user.UserID,
		ParentEntityID:   logicGateEntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows team logic gate: %v", err)
	}
	requireCompanyExplorerV2Row(t, teamGateChildren.Rows, CompanyExplorerV2EntityNode, node.NodeID)
}
func TestMemoryProjectRelationshipMovesResourceBetweenProjects(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-220000000003"
	repo.EnsureCompany(companyID, "Project Relationship Move Co")

	user, err := repo.UpsertAuthUser("project-move-user", "project-move@example.com", "Project Move User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("project-move-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	alpha, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Alpha", Status: "Active", ActorUserID: user.UserID})
	if err != nil {
		t.Fatalf("CreateProject alpha: %v", err)
	}
	bravo, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Bravo", Status: "Active", ActorUserID: user.UserID})
	if err != nil {
		t.Fatalf("CreateProject bravo: %v", err)
	}
	if alpha.Project == nil || bravo.Project == nil {
		t.Fatalf("created projects missing")
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Single Parent Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	first, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:    companyID,
		ProjectID:    alpha.Project.ProjectID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		ActorUserID:  user.UserID,
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship first: %v", err)
	}
	second, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:    companyID,
		ProjectID:    bravo.Project.ProjectID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		ActorUserID:  user.UserID,
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship move: %v", err)
	}
	if first.Relationship == nil || second.Relationship == nil {
		t.Fatalf("relationship mutation missing projection")
	}
	if second.Relationship.RelationshipID != first.Relationship.RelationshipID {
		t.Fatalf("move created a new relationship id %s, want existing %s", second.Relationship.RelationshipID, first.Relationship.RelationshipID)
	}
	if second.Relationship.ProjectID != bravo.Project.ProjectID {
		t.Fatalf("moved relationship ProjectID = %s, want %s", second.Relationship.ProjectID, bravo.Project.ProjectID)
	}
	alphaRows, err := repo.ListProjectRelationshipProjections(companyID, alpha.Project.ProjectID)
	if err != nil {
		t.Fatalf("ListProjectRelationshipProjections alpha: %v", err)
	}
	if len(alphaRows) != 0 {
		t.Fatalf("alpha relationships after move = %+v, want empty", alphaRows)
	}
	bravoRows, err := repo.ListProjectRelationshipProjections(companyID, bravo.Project.ProjectID)
	if err != nil {
		t.Fatalf("ListProjectRelationshipProjections bravo: %v", err)
	}
	if len(bravoRows) != 1 || bravoRows[0].RelationshipID != first.Relationship.RelationshipID {
		t.Fatalf("bravo relationships after move = %+v, want moved relationship", bravoRows)
	}
}
func TestMemoryCompanyExplorerV2WritesMoveAndFolderPermissions(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-220000000002"
	repo.EnsureCompany(companyID, "V2 Explorer Writes Co")

	admin, err := repo.UpsertAuthUser("v2-writes-admin", "v2-writes-admin@example.com", "V2 Writes Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership("v2-writes-admin", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership admin: %v", err)
	}
	viewer, err := repo.UpsertAuthUser("v2-writes-viewer", "v2-writes-viewer@example.com", "V2 Writes Viewer")
	if err != nil {
		t.Fatalf("UpsertAuthUser viewer: %v", err)
	}
	if _, err := repo.AddCompanyMembership("v2-writes-viewer", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership viewer: %v", err)
	}

	roots, err := repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows: %v", err)
	}
	companyRoot := requireCompanyExplorerV2Row(t, roots.Rows, CompanyExplorerV2EntityCompany, companyID)

	privateFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:        companyID,
		ParentEntityID:   companyRoot.EntityID,
		Name:             "Private folder",
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder private: %v", err)
	}
	openFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:        companyID,
		ParentEntityID:   companyRoot.EntityID,
		Name:             "Open folder",
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder open: %v", err)
	}

	viewerChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   companyRoot.EntityID,
		PermissionUserID: viewer.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows viewer before grant: %v", err)
	}
	if findCompanyExplorerV2Row(viewerChildren.Rows, CompanyExplorerV2EntityFolder, privateFolder.EntityID) != nil {
		t.Fatalf("viewer saw private folder before permission grant")
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       EntityTypeCompanyExplorerFolder,
		EntityID:         privateFolder.EntityID,
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions private folder: %v", err)
	}
	viewerChildren, err = repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   companyRoot.EntityID,
		PermissionUserID: viewer.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows viewer after grant: %v", err)
	}
	if findCompanyExplorerV2Row(viewerChildren.Rows, CompanyExplorerV2EntityFolder, privateFolder.EntityID) == nil {
		t.Fatalf("viewer did not see private folder after explicit view grant")
	}

	node, err := repo.CreateNode(companyID, "Placed node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	placedNode, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID:        companyID,
		ParentEntityID:   privateFolder.EntityID,
		ChildEntityType:  CompanyExplorerV2EntityNode,
		ChildResourceID:  node.NodeID,
		Position:         2000,
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge node: %v", err)
	}
	if placedNode.EntityType != CompanyExplorerV2EntityNode || placedNode.ResourceID != node.NodeID || placedNode.EdgeID == "" {
		t.Fatalf("placed node row = %+v, want node resource with stored edge", placedNode)
	}

	movedNode, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID:        companyID,
		EdgeID:           placedNode.EdgeID,
		ParentEntityID:   openFolder.EntityID,
		Position:         3000,
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatalf("MoveCompanyExplorerV2Edge: %v", err)
	}
	if movedNode.ParentEntityID != openFolder.EntityID || movedNode.Position != 3000 {
		t.Fatalf("moved node row = %+v, want parent %s position 3000", movedNode, openFolder.EntityID)
	}

	privateChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   privateFolder.EntityID,
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows private: %v", err)
	}
	if findCompanyExplorerV2Row(privateChildren.Rows, CompanyExplorerV2EntityNode, node.NodeID) != nil {
		t.Fatalf("moved node still appears under old parent")
	}
	openChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   openFolder.EntityID,
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows open: %v", err)
	}
	if findCompanyExplorerV2Row(openChildren.Rows, CompanyExplorerV2EntityNode, node.NodeID) == nil {
		t.Fatalf("moved node not found under new parent")
	}

	if err := repo.DeleteCompanyExplorerV2Folder(companyID, privateFolder.EntityID); err != nil {
		t.Fatalf("DeleteCompanyExplorerV2Folder: %v", err)
	}
	if _, err := repo.GetCompanyExplorerV2FolderDefaultAccess(companyID, privateFolder.EntityID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetCompanyExplorerV2FolderDefaultAccess after delete err = %v, want ErrNotFound", err)
	}
}

func requireCompanyExplorerV2Row(t *testing.T, rows []CompanyExplorerV2Row, entityType, id string) CompanyExplorerV2Row {
	t.Helper()
	row := findCompanyExplorerV2Row(rows, entityType, id)
	if row == nil {
		t.Fatalf("missing V2 row type=%s id=%s in %+v", entityType, id, rows)
	}
	return *row
}

func findCompanyExplorerV2Row(rows []CompanyExplorerV2Row, entityType, id string) *CompanyExplorerV2Row {
	for i := range rows {
		row := &rows[i]
		if row.EntityType != entityType {
			continue
		}
		if row.EntityID == id || row.ResourceID == id {
			return row
		}
	}
	return nil
}
