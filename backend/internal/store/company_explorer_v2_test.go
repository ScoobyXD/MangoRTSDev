package store

import (
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryCompanyExplorerV2RootsAndNativeChildren(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-220000000001"
	repo.EnsureCompany(companyID, "V2 Explorer Co")

	user, err := repo.UpsertAuthUser("v2-roots-user", "v2-roots@example.com", "V2 Roots User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("v2-roots-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Operations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}

	meRoots, err := repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeMe,
		ScopeUserID:      user.UserID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows me: %v", err)
	}
	meRoot := requireCompanyExplorerV2Row(t, meRoots.Rows, CompanyExplorerV2EntityUser, user.UserID)
	if meRoot.ParentEntityID != "" {
		t.Fatalf("me root ParentEntityID = %q, want empty", meRoot.ParentEntityID)
	}

	teamRoots, err := repo.ListCompanyExplorerV2RootRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeTeam,
		ScopeUserID:      user.UserID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows team: %v", err)
	}
	teamRoot := requireCompanyExplorerV2Row(t, teamRoots.Rows, CompanyExplorerV2EntityUserGroup, group.GroupID)
	if teamRoot.EdgeID != "" {
		t.Fatalf("team native root EdgeID = %q, want empty derived row", teamRoot.EdgeID)
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
	if !companyRoot.HasChildren {
		t.Fatalf("company root HasChildren = false, want true from native group child")
	}

	companyChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   companyRoot.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows company: %v", err)
	}
	groupRow := requireCompanyExplorerV2Row(t, companyChildren.Rows, CompanyExplorerV2EntityUserGroup, group.GroupID)
	if groupRow.EdgeID != "" {
		t.Fatalf("native group child EdgeID = %q, want empty derived row", groupRow.EdgeID)
	}

	groupChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   groupRow.EntityID,
		PermissionUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows group: %v", err)
	}
	userRow := requireCompanyExplorerV2Row(t, groupChildren.Rows, CompanyExplorerV2EntityUser, user.UserID)
	if userRow.EdgeID != "" {
		t.Fatalf("native user child EdgeID = %q, want empty derived row", userRow.EdgeID)
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
