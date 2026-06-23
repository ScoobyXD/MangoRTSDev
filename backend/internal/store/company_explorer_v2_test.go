package store

import (
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryCompanyExplorerV2FinalViewReadsCompanyTree(t *testing.T) {
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

	allRoots, err := repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows all: %v", err)
	}
	if findCompanyExplorerV2Row(allRoots.Rows, CompanyExplorerV2EntityCompany, companyID) != nil {
		t.Fatalf("all roots included synthetic company root: %+v", allRoots.Rows)
	}
	_, err = repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeMe,
		PermissionUserID: user.UserID,
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("ListCompanyExplorerV2RootRows legacy me err = %v, want ErrInvalid", err)
	}

	folder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:        companyID,
		ParentEntityID:   companyID,
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

	rootRows, err := repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows after create: %v", err)
	}
	rootFolder := requireCompanyExplorerV2Row(t, rootRows.Rows, CompanyExplorerV2EntityFolder, folder.EntityID)
	if rootFolder.ParentEntityID != "" {
		t.Fatalf("root folder row parent = %q, want empty visible root parent", rootFolder.ParentEntityID)
	}
	if findCompanyExplorerV2Row(rootRows.Rows, CompanyExplorerV2EntityCompany, companyID) != nil {
		t.Fatalf("root rows included synthetic company row: %+v", rootRows.Rows)
	}

	rootChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   companyID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows root: %v", err)
	}
	requireCompanyExplorerV2Row(t, rootChildren.Rows, CompanyExplorerV2EntityFolder, folder.EntityID)
	folderChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   folder.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows folder: %v", err)
	}
	requireCompanyExplorerV2Row(t, folderChildren.Rows, CompanyExplorerV2EntityProject, project.ProjectID)
	projectChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   projectRow.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows project: %v", err)
	}
	logicGateRow := requireCompanyExplorerV2Row(t, projectChildren.Rows, CompanyExplorerV2EntityLogicGate, logicGate.LogicGateID)
	teamGateChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   logicGateRow.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows logic gate: %v", err)
	}
	requireCompanyExplorerV2Row(t, teamGateChildren.Rows, CompanyExplorerV2EntityNode, node.NodeID)
}

func TestMemoryCompanyExplorerV2PreservesManualAndNativeParentContexts(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-220000000002"
	repo.EnsureCompany(companyID, "V2 Context Co")

	user, err := repo.UpsertAuthUser("v2-context-user", "v2-context@example.com", "V2 Context User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("v2-context-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	roots, err := repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows: %v", err)
	}
	if findCompanyExplorerV2Row(roots.Rows, CompanyExplorerV2EntityCompany, companyID) != nil {
		t.Fatalf("roots included synthetic company root: %+v", roots.Rows)
	}
	folder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:        companyID,
		ParentEntityID:   companyID,
		Name:             "Manual Gate Placements",
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder: %v", err)
	}
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Native Project", Status: "Active", ActorUserID: user.UserID})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	project := projectResult.Project
	if project == nil {
		t.Fatalf("CreateProject returned nil project")
	}
	projectRow, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID:        companyID,
		ParentEntityID:   companyID,
		ChildEntityType:  CompanyExplorerV2EntityProject,
		ChildResourceID:  project.ProjectID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge project: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Shared Gate")
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
	manualGate, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID:        companyID,
		ParentEntityID:   folder.EntityID,
		ChildEntityType:  CompanyExplorerV2EntityLogicGate,
		ChildResourceID:  logicGate.LogicGateID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge logic gate: %v", err)
	}
	if manualGate.EdgeID == "" {
		t.Fatalf("manual gate placement has empty edge id: %+v", manualGate)
	}

	folderChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   folder.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows folder: %v", err)
	}
	folderGate := requireCompanyExplorerV2Row(t, folderChildren.Rows, CompanyExplorerV2EntityLogicGate, logicGate.LogicGateID)
	if folderGate.ParentEntityID != folder.EntityID || folderGate.EdgeID == "" {
		t.Fatalf("folder gate row = %+v, want stored edge under folder", folderGate)
	}
	projectChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   projectRow.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows project: %v", err)
	}
	projectGate := requireCompanyExplorerV2Row(t, projectChildren.Rows, CompanyExplorerV2EntityLogicGate, logicGate.LogicGateID)
	if projectGate.ParentEntityID != projectRow.EntityID || projectGate.EdgeID != "" {
		t.Fatalf("project gate row = %+v, want native relationship under project", projectGate)
	}
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

func TestMemoryCompanyExplorerDeleteRecycleBinSummarizesContainerDescendants(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-220000000004"
	repo.EnsureCompany(companyID, "Recycle Summary Co")

	folder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:      companyID,
		ParentEntityID: companyID,
		Name:           "Root Folder",
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder root: %v", err)
	}
	childFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:      companyID,
		ParentEntityID: folder.EntityID,
		Name:           "Child Folder",
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder child: %v", err)
	}
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Contained Project", Status: "Active"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	project := projectResult.Project
	if project == nil {
		t.Fatalf("CreateProject returned nil project")
	}
	if _, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID:       companyID,
		ParentEntityID:  childFolder.EntityID,
		ChildEntityType: CompanyExplorerV2EntityProject,
		ChildResourceID: project.ProjectID,
	}); err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge project: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Contained Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:    companyID,
		ProjectID:    project.ProjectID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Contained Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	assignmentPriority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Priority:    &assignmentPriority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	result, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: folder.EntityID}})
	if err != nil {
		t.Fatalf("DeleteCompanyExplorerTargets folder: %v", err)
	}
	requireDeletedTarget(t, result.Targets, "folder", childFolder.EntityID)
	requireDeletedTarget(t, result.Targets, EntityTypeProject, project.ProjectID)
	requireDeletedTarget(t, result.Targets, EntityTypeLogicGate, logicGate.LogicGateID)
	requireDeletedTarget(t, result.Targets, EntityTypeNode, node.NodeID)

	items, err := repo.ListRecycleBinItems(companyID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems: %v", err)
	}
	rootItem := requireRecycleItem(t, items, "folder", folder.EntityID)
	requireContainedRecycleItem(t, rootItem.ContainedItems, "folder", childFolder.EntityID, "Child Folder")
	requireContainedRecycleItem(t, rootItem.ContainedItems, EntityTypeProject, project.ProjectID, "Contained Project")
	requireContainedRecycleItem(t, rootItem.ContainedItems, EntityTypeLogicGate, logicGate.LogicGateID, "Contained Gate")
	requireContainedRecycleItem(t, rootItem.ContainedItems, EntityTypeNode, node.NodeID, "Contained Node")
}

func TestMemoryCompanyExplorerDeleteRecycleBinSummarizesProjectAndLogicGateChildren(t *testing.T) {
	t.Run("project", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "11111111-1111-4111-8111-220000000005"
		repo.EnsureCompany(companyID, "Recycle Project Summary Co")
		project, logicGate, node := createProjectGateNodeTree(t, repo, companyID)

		result, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeProject, ID: project.ProjectID}})
		if err != nil {
			t.Fatalf("DeleteCompanyExplorerTargets project: %v", err)
		}
		requireDeletedTarget(t, result.Targets, EntityTypeLogicGate, logicGate.LogicGateID)
		requireDeletedTarget(t, result.Targets, EntityTypeNode, node.NodeID)
		if _, err := repo.GetLogicGate(companyID, logicGate.LogicGateID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("GetLogicGate after project delete err = %v, want ErrNotFound", err)
		}
		if _, err := repo.GetNode(companyID, node.NodeID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("GetNode after project delete err = %v, want ErrNotFound", err)
		}
		items, err := repo.ListRecycleBinItems(companyID)
		if err != nil {
			t.Fatalf("ListRecycleBinItems project: %v", err)
		}
		projectItem := requireRecycleItem(t, items, EntityTypeProject, project.ProjectID)
		requireContainedRecycleItem(t, projectItem.ContainedItems, EntityTypeLogicGate, logicGate.LogicGateID, "Project Gate")
		requireContainedRecycleItem(t, projectItem.ContainedItems, EntityTypeNode, node.NodeID, "Project Node")
	})

	t.Run("logic_gate", func(t *testing.T) {
		repo := NewMemoryRepo()
		companyID := "11111111-1111-4111-8111-220000000006"
		repo.EnsureCompany(companyID, "Recycle Gate Summary Co")
		_, logicGate, node := createProjectGateNodeTree(t, repo, companyID)

		result, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeLogicGate, ID: logicGate.LogicGateID}})
		if err != nil {
			t.Fatalf("DeleteCompanyExplorerTargets logic gate: %v", err)
		}
		requireDeletedTarget(t, result.Targets, EntityTypeNode, node.NodeID)
		if _, err := repo.GetNode(companyID, node.NodeID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("GetNode after logic gate delete err = %v, want ErrNotFound", err)
		}
		items, err := repo.ListRecycleBinItems(companyID)
		if err != nil {
			t.Fatalf("ListRecycleBinItems logic gate: %v", err)
		}
		logicGateItem := requireRecycleItem(t, items, EntityTypeLogicGate, logicGate.LogicGateID)
		requireContainedRecycleItem(t, logicGateItem.ContainedItems, EntityTypeNode, node.NodeID, "Project Node")
	})
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
	if findCompanyExplorerV2Row(roots.Rows, CompanyExplorerV2EntityCompany, companyID) != nil {
		t.Fatalf("roots included synthetic company root: %+v", roots.Rows)
	}

	privateFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:        companyID,
		ParentEntityID:   companyID,
		Name:             "Private folder",
		DefaultAccess:    ResourceDefaultAccessNoAccess,
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder private: %v", err)
	}
	openFolder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:        companyID,
		ParentEntityID:   companyID,
		Name:             "Open folder",
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder open: %v", err)
	}

	viewerChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   companyID,
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
		ParentEntityID:   companyID,
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

func TestMemoryCompanyExplorerDefaultUnfiledFolders(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-220000000101"
	repo.EnsureCompany(companyID, "Default Folder Co")

	user, err := repo.UpsertAuthUser("default-folders-user", "default-folders@example.com", "Default Folders User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("default-folders-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}

	roots, err := repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows: %v", err)
	}
	defaults := companyExplorerDefaultFolderIDs(companyID)
	unfiled := requireCompanyExplorerV2Row(t, roots.Rows, CompanyExplorerV2EntityFolder, defaults.UnfiledFolderID)
	if unfiled.Name != CompanyExplorerDefaultRootFolderName || unfiled.ParentEntityID != "" {
		t.Fatalf("unfiled row = %+v", unfiled)
	}

	children, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   defaults.UnfiledFolderID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows unfiled: %v", err)
	}
	gotNames := companyExplorerV2RowNames(children.Rows)
	wantNames := []string{CompanyExplorerDefaultProjectsFolderName, CompanyExplorerDefaultLogicGatesFolderName, CompanyExplorerDefaultNodesFolderName}
	if len(gotNames) != len(wantNames) {
		t.Fatalf("default child names = %v, want %v", gotNames, wantNames)
	}
	for index := range wantNames {
		if gotNames[index] != wantNames[index] {
			t.Fatalf("default child names = %v, want %v", gotNames, wantNames)
		}
	}
}

func TestMemoryCompanyExplorerDefaultPlacementAndExplicitRootException(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-220000000102"
	repo.EnsureCompany(companyID, "Default Placement Co")

	user, err := repo.UpsertAuthUser("default-placement-user", "default-placement@example.com", "Default Placement User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("default-placement-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	defaults := companyExplorerDefaultFolderIDs(companyID)

	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID:                       companyID,
		Name:                            "Bare Project",
		Status:                          "Active",
		ActorUserID:                     user.UserID,
		CompanyExplorerDefaultPlacement: true,
	})
	if err != nil {
		t.Fatalf("CreateProject default placement: %v", err)
	}
	if projectResult.FolderItem == nil || projectResult.FolderItem.FolderID != defaults.ProjectsFolderID {
		t.Fatalf("project default folder item = %+v, want Projects folder %s", projectResult.FolderItem, defaults.ProjectsFolderID)
	}

	nodeBatch, err := repo.CreateWorkspaceEntityBatch(WorkspaceEntityBatchInput{
		CompanyID:      companyID,
		EntityKind:     EntityTypeNode,
		MutationOrigin: MutationOriginNodeMap,
		CreatorUserID:  user.UserID,
		Items:          []WorkspaceEntityBatchItemInput{{ClientID: "node-1", Title: "Bare Node"}},
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceEntityBatch node: %v", err)
	}
	if len(nodeBatch.FolderItems) != 1 || nodeBatch.FolderItems[0].FolderID != defaults.NodesFolderID {
		t.Fatalf("node folder items = %+v, want Nodes folder %s", nodeBatch.FolderItems, defaults.NodesFolderID)
	}

	rootBatch, err := repo.CreateWorkspaceEntityBatch(WorkspaceEntityBatchInput{
		CompanyID:      companyID,
		EntityKind:     EntityTypeLogicGate,
		MutationOrigin: MutationOriginCompanyExplorer,
		CreatorUserID:  user.UserID,
		Items:          []WorkspaceEntityBatchItemInput{{ClientID: "gate-root", Title: "Root Gate"}},
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceEntityBatch root gate: %v", err)
	}
	if len(rootBatch.FolderItems) != 0 {
		t.Fatalf("company explorer root create returned folder items = %+v, want none", rootBatch.FolderItems)
	}
	rootGateID := rootBatch.EntityMappings[0].EntityID
	rootGateRow, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID:        companyID,
		ParentEntityID:   companyID,
		ChildEntityType:  CompanyExplorerV2EntityLogicGate,
		ChildResourceID:  rootGateID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge root gate: %v", err)
	}
	if rootGateRow.ParentEntityID != "" {
		t.Fatalf("root gate visible parent = %q, want root", rootGateRow.ParentEntityID)
	}

	logicGateChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   defaults.LogicGatesFolderID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows Logic Gates: %v", err)
	}
	if findCompanyExplorerV2Row(logicGateChildren.Rows, CompanyExplorerV2EntityLogicGate, rootGateID) != nil {
		t.Fatalf("root-created logic gate appeared under Unfiled/Logic Gates")
	}
	rootChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   companyID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows root: %v", err)
	}
	requireCompanyExplorerV2Row(t, rootChildren.Rows, CompanyExplorerV2EntityLogicGate, rootGateID)
}

func TestMemoryCompanyExplorerSearchOrdersTypesAndReturnsLocationPath(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-220000000103"
	repo.EnsureCompany(companyID, "Search Co")

	user, err := repo.UpsertAuthUser("explorer-search-user", "explorer-search@example.com", "Explorer Search User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("explorer-search-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}

	gateBatch, err := repo.CreateWorkspaceEntityBatch(WorkspaceEntityBatchInput{
		CompanyID:      companyID,
		EntityKind:     EntityTypeLogicGate,
		MutationOrigin: MutationOriginLogicGateMap,
		CreatorUserID:  user.UserID,
		Items:          []WorkspaceEntityBatchItemInput{{ClientID: "gate", Title: "Search Alpha"}},
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceEntityBatch gate: %v", err)
	}
	nodeBatch, err := repo.CreateWorkspaceEntityBatch(WorkspaceEntityBatchInput{
		CompanyID:      companyID,
		EntityKind:     EntityTypeNode,
		MutationOrigin: MutationOriginNodeMap,
		CreatorUserID:  user.UserID,
		Items:          []WorkspaceEntityBatchItemInput{{ClientID: "node", Title: "Search Alpha"}},
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceEntityBatch node: %v", err)
	}
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID:                       companyID,
		Name:                            "Search Alpha",
		Status:                          "Active",
		ActorUserID:                     user.UserID,
		CompanyExplorerDefaultPlacement: true,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	folder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID:        companyID,
		ParentEntityID:   companyID,
		Name:             "Search Alpha Folder",
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder: %v", err)
	}

	results, err := repo.SearchCompanyExplorer(CompanyExplorerSearchQuery{
		CompanyID:        companyID,
		Query:            "Search Alpha",
		PermissionUserID: user.UserID,
		Limit:            10,
	})
	if err != nil {
		t.Fatalf("SearchCompanyExplorer: %v", err)
	}
	if len(results.Results) < 4 {
		t.Fatalf("search results = %+v, want at least 4", results.Results)
	}
	wantTypes := []string{EntityTypeLogicGate, EntityTypeNode, EntityTypeProject, CompanyExplorerV2EntityFolder}
	for index, want := range wantTypes {
		if results.Results[index].ResourceType != want {
			t.Fatalf("result type order = %+v, want %v first", results.Results, wantTypes)
		}
	}

	gateID := gateBatch.EntityMappings[0].EntityID
	nodeID := nodeBatch.EntityMappings[0].EntityID
	projectID := projectResult.Project.ProjectID
	requireCompanyExplorerSearchPath(t, results.Results, EntityTypeLogicGate, gateID, []string{CompanyExplorerDefaultRootFolderName, CompanyExplorerDefaultLogicGatesFolderName})
	requireCompanyExplorerSearchPath(t, results.Results, EntityTypeNode, nodeID, []string{CompanyExplorerDefaultRootFolderName, CompanyExplorerDefaultNodesFolderName})
	requireCompanyExplorerSearchPath(t, results.Results, EntityTypeProject, projectID, []string{CompanyExplorerDefaultRootFolderName, CompanyExplorerDefaultProjectsFolderName})
	requireCompanyExplorerSearchPath(t, results.Results, CompanyExplorerV2EntityFolder, folder.EntityID, []string{})
	for _, result := range results.Results[:4] {
		if result.MatchReason == "" || result.DisplayName == "" || result.ResourceID == "" {
			t.Fatalf("search result missing metadata: %+v", result)
		}
	}
}
func createProjectGateNodeTree(t *testing.T, repo *MemoryRepo, companyID string) (domain.Project, domain.LogicGate, domain.Node) {
	t.Helper()
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Project Parent", Status: "Active"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if projectResult.Project == nil {
		t.Fatalf("CreateProject returned nil project")
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Project Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:    companyID,
		ProjectID:    projectResult.Project.ProjectID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Project Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	assignmentPriority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Priority:    &assignmentPriority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	return *projectResult.Project, logicGate, node
}

func companyExplorerV2RowNames(rows []CompanyExplorerV2Row) []string {
	names := make([]string, 0, len(rows))
	for _, row := range rows {
		names = append(names, row.Name)
	}
	return names
}

func requireCompanyExplorerSearchPath(t *testing.T, results []CompanyExplorerSearchResult, resourceType, resourceID string, wantNames []string) CompanyExplorerSearchResult {
	t.Helper()
	for _, result := range results {
		if result.ResourceType != resourceType || result.ResourceID != resourceID {
			continue
		}
		if len(result.LocationPath) != len(wantNames) {
			t.Fatalf("location path for %s/%s = %+v, want %v", resourceType, resourceID, result.LocationPath, wantNames)
		}
		for index, want := range wantNames {
			if result.LocationPath[index].Name != want {
				t.Fatalf("location path for %s/%s = %+v, want %v", resourceType, resourceID, result.LocationPath, wantNames)
			}
		}
		return result
	}
	t.Fatalf("missing search result type=%s id=%s in %+v", resourceType, resourceID, results)
	return CompanyExplorerSearchResult{}
}

func requireDeletedTarget(t *testing.T, targets []CompanyExplorerDeletedTarget, kind, id string) {
	t.Helper()
	for _, target := range targets {
		if target.Kind == kind && target.ID == id {
			return
		}
	}
	t.Fatalf("missing deleted target kind=%s id=%s in %+v", kind, id, targets)
}

func requireRecycleItem(t *testing.T, items []domain.RecycleBinItem, kind, id string) domain.RecycleBinItem {
	t.Helper()
	for _, item := range items {
		if item.ObjectKind == kind && item.ObjectID == id {
			return item
		}
	}
	t.Fatalf("missing recycle item kind=%s id=%s in %+v", kind, id, items)
	return domain.RecycleBinItem{}
}

func requireContainedRecycleItem(t *testing.T, items []domain.RecycleBinContainedItem, kind, id, label string) {
	t.Helper()
	for _, item := range items {
		if item.Kind == kind && item.ID == id && item.Label == label {
			return
		}
	}
	t.Fatalf("missing contained recycle item kind=%s id=%s label=%q in %+v", kind, id, label, items)
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
