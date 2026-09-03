package store

import "testing"

func TestPostgresExplorerHierarchyPathsUseCanonicalPlacementAndOwnership(t *testing.T) {
	db, repo := openCompanyExplorerSearchPostgresIntegration(t)
	companyID := newUUIDv7String()
	userID := newUUIDv7String()
	rootFolderID := newUUIDv7String()
	gateFolderID := newUUIDv7String()
	projectFolderID := newUUIDv7String()
	gateID := newUUIDv7String()
	projectID := newUUIDv7String()
	nodeID := newUUIDv7String()
	gateItemID := newUUIDv7String()
	projectItemID := newUUIDv7String()
	assignmentID := newUUIDv7String()
	projectRelationshipID := newUUIDv7String()
	huddleRootFolderID := newUUIDv7String()
	huddleChildFolderID := newUUIDv7String()
	huddleGateID := newUUIDv7String()
	huddleNodeID := newUUIDv7String()
	huddleItemID := newUUIDv7String()

	t.Cleanup(func() {
		for _, statement := range []string{
			`delete from huddle_explorer_items where company_id=$1::uuid`,
			`delete from huddle_nodes where company_id=$1::uuid`,
			`delete from huddle_logic_gates where company_id=$1::uuid`,
			`delete from huddle_explorer_folders where company_id=$1::uuid`,
			`delete from project_relationships where company_id=$1::uuid`,
			`delete from node_logic_gate_assignments where company_id=$1::uuid`,
			`delete from company_explorer_items where company_id=$1::uuid`,
			`delete from nodes where company_id=$1::uuid`,
			`delete from projects where company_id=$1::uuid`,
			`delete from logic_gates where company_id=$1::uuid`,
			`delete from company_explorer_folders where company_id=$1::uuid`,
			`delete from resource_permissions where company_id=$1::uuid`,
			`delete from resource_permission_settings where company_id=$1::uuid`,
			`delete from company_memberships where company_id=$1::uuid`,
			`delete from companies where company_id=$1::uuid`,
		} {
			_, _ = db.Exec(statement, companyID)
		}
		_, _ = db.Exec(`delete from users where user_id=$1::uuid`, userID)
	})

	statements := []struct {
		query string
		args  []any
	}{
		{`insert into users(user_id,cognito_subject,email,display_name) values($1::uuid,$2,$3,$4)`, []any{userID, "hierarchy-path-" + userID, userID + "@example.test", "Hierarchy Path User"}},
		{`insert into companies(company_id,name) values($1::uuid,$2)`, []any{companyID, "Hierarchy Path Integration"}},
		{`insert into company_memberships(company_id,user_id,role) values($1::uuid,$2::uuid,'company_user')`, []any{companyID, userID}},
		{`insert into company_explorer_folders(company_id,folder_id,name,default_access) values($1::uuid,$2::uuid,'Workspace Root','edit')`, []any{companyID, rootFolderID}},
		{`insert into company_explorer_folders(company_id,folder_id,parent_folder_id,name,default_access) values($1::uuid,$2::uuid,$3::uuid,'Process Home','edit')`, []any{companyID, gateFolderID, rootFolderID}},
		{`insert into company_explorer_folders(company_id,folder_id,parent_folder_id,name,default_access) values($1::uuid,$2::uuid,$3::uuid,'Project Home','edit')`, []any{companyID, projectFolderID, rootFolderID}},
		{`insert into logic_gates(company_id,logic_gate_id,header,default_access,created_timestamp) values($1::uuid,$2::uuid,'Postgres Process','edit',now())`, []any{companyID, gateID}},
		{`insert into projects(company_id,project_id,name,default_access) values($1::uuid,$2::uuid,'Postgres Project','edit')`, []any{companyID, projectID}},
		{`insert into nodes(company_id,node_id,name,priority,default_access,created_timestamp) values($1::uuid,$2::uuid,'Postgres Node',1,'edit',now())`, []any{companyID, nodeID}},
		{`insert into company_explorer_items(company_id,item_id,parent_folder_id,target_type,target_id) values($1::uuid,$2::uuid,$3::uuid,'logic_gate',$4::uuid)`, []any{companyID, gateItemID, gateFolderID, gateID}},
		{`insert into company_explorer_items(company_id,item_id,parent_folder_id,target_type,target_id) values($1::uuid,$2::uuid,$3::uuid,'project',$4::uuid)`, []any{companyID, projectItemID, projectFolderID, projectID}},
		{`insert into node_logic_gate_assignments(company_id,assignment_id,node_id,logic_gate_id,position) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,1000)`, []any{companyID, assignmentID, nodeID, gateID}},
		{`insert into project_relationships(company_id,relationship_id,project_id,resource_type,resource_id) values($1::uuid,$2::uuid,$3::uuid,'node',$4::uuid)`, []any{companyID, projectRelationshipID, projectID, nodeID}},
		{`insert into huddle_explorer_folders(company_id,folder_id,name) values($1::uuid,$2::uuid,'Huddles')`, []any{companyID, huddleRootFolderID}},
		{`insert into huddle_explorer_folders(company_id,folder_id,parent_folder_id,name) values($1::uuid,$2::uuid,$3::uuid,'Standups')`, []any{companyID, huddleChildFolderID, huddleRootFolderID}},
		{`insert into huddle_logic_gates(company_id,huddle_logic_gate_id,header) values($1::uuid,$2::uuid,'Daily Operations')`, []any{companyID, huddleGateID}},
		{`insert into huddle_nodes(company_id,huddle_node_id,huddle_logic_gate_id,name) values($1::uuid,$2::uuid,$3::uuid,'Tuesday Review')`, []any{companyID, huddleNodeID, huddleGateID}},
		{`insert into huddle_explorer_items(company_id,huddle_explorer_item_id,resource_huddle_resource_id,huddle_type,parent_folder_id) values($1::uuid,$2::uuid,$3::uuid,'huddle_logic_gate',$4::uuid)`, []any{companyID, huddleItemID, huddleGateID, huddleChildFolderID}},
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement.query, statement.args...); err != nil {
			t.Fatalf("seed hierarchy path integration: %v", err)
		}
	}

	gatePath, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gateID, PermissionUserID: userID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, gatePath, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusResolved,
		[]string{CompanyExplorerV2EntityFolder, CompanyExplorerV2EntityFolder}, []string{"Workspace Root", "Process Home"})
	nodePath, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nodeID, PermissionUserID: userID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, nodePath, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusResolved,
		[]string{CompanyExplorerV2EntityFolder, CompanyExplorerV2EntityFolder, EntityTypeLogicGate}, []string{"Workspace Root", "Process Home", "Postgres Process"})

	customizeForUser := func(resourceType, resourceID string) {
		t.Helper()
		if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
			CompanyID: companyID, EntityType: resourceType, EntityID: resourceID,
			DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
			Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: userID, AccessLevel: EntityPermissionEdit}},
		}); err != nil {
			t.Fatalf("customize %s/%s: %v", resourceType, resourceID, err)
		}
	}
	customizeForUser(EntityTypeLogicGate, gateID)
	customizeForUser(EntityTypeProject, projectID)
	customizeForUser(EntityTypeNode, nodeID)
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeCompanyExplorerFolder, EntityID: gateFolderID,
		DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("hide Process folder: %v", err)
	}

	projectFallback, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nodeID, PermissionUserID: userID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, projectFallback, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusResolved,
		[]string{CompanyExplorerV2EntityFolder, CompanyExplorerV2EntityFolder, EntityTypeProject}, []string{"Workspace Root", "Project Home", "Postgres Project"})

	if _, err := db.Exec(`update company_explorer_items set parent_folder_id=null where company_id=$1::uuid and item_id=$2::uuid`, companyID, projectItemID); err != nil {
		t.Fatal(err)
	}
	projectRoot, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeProject, ResourceID: projectID, PermissionUserID: userID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, projectRoot, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusResolved, []string{}, []string{})
	if _, err := db.Exec(`delete from company_explorer_items where company_id=$1::uuid and item_id=$2::uuid`, companyID, projectItemID); err != nil {
		t.Fatal(err)
	}
	projectMissing, err := repo.GetCompanyExplorerHierarchyPath(CompanyExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeProject, ResourceID: projectID, PermissionUserID: userID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, projectMissing, ExplorerHierarchyKindCompanyExplorer, ExplorerHierarchyStatusOmitted, []string{}, []string{})

	huddleGatePath, err := repo.GetHuddleExplorerHierarchyPath(HuddleExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeHuddleLogicGate, ResourceID: huddleGateID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, huddleGatePath, ExplorerHierarchyKindHuddleExplorer, ExplorerHierarchyStatusResolved,
		[]string{HuddleExplorerHierarchyEntityFolder, HuddleExplorerHierarchyEntityFolder}, []string{"Huddles", "Standups"})
	huddleNodePath, err := repo.GetHuddleExplorerHierarchyPath(HuddleExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeHuddleNode, ResourceID: huddleNodeID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, huddleNodePath, ExplorerHierarchyKindHuddleExplorer, ExplorerHierarchyStatusResolved,
		[]string{HuddleExplorerHierarchyEntityFolder, HuddleExplorerHierarchyEntityFolder, EntityTypeHuddleLogicGate}, []string{"Huddles", "Standups", "Daily Operations"})

	if _, err := db.Exec(`update huddle_explorer_items set parent_folder_id=null where company_id=$1::uuid and huddle_explorer_item_id=$2::uuid`, companyID, huddleItemID); err != nil {
		t.Fatal(err)
	}
	huddleRoot, err := repo.GetHuddleExplorerHierarchyPath(HuddleExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeHuddleLogicGate, ResourceID: huddleGateID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, huddleRoot, ExplorerHierarchyKindHuddleExplorer, ExplorerHierarchyStatusResolved, []string{}, []string{})
	if _, err := db.Exec(`delete from huddle_explorer_items where company_id=$1::uuid and huddle_explorer_item_id=$2::uuid`, companyID, huddleItemID); err != nil {
		t.Fatal(err)
	}
	huddleMissing, err := repo.GetHuddleExplorerHierarchyPath(HuddleExplorerHierarchyPathQuery{CompanyID: companyID, ResourceType: EntityTypeHuddleNode, ResourceID: huddleNodeID})
	if err != nil {
		t.Fatal(err)
	}
	assertHierarchyPath(t, huddleMissing, ExplorerHierarchyKindHuddleExplorer, ExplorerHierarchyStatusOmitted, []string{}, []string{})
}
