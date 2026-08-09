package store

import (
	"database/sql"
	"fmt"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func openCompanyExplorerSearchPostgresIntegration(t *testing.T) (*sql.DB, *PostgresRepo) {
	t.Helper()
	if os.Getenv("MANGORTS_COMPANY_EXPLORER_SEARCH_POSTGRES_TEST") != "1" || os.Getenv("DB_NAME") != "mangorts_company_search_test" {
		t.Skip("disposable Company Explorer search PostgreSQL database not configured")
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), os.Getenv("DB_SSLMODE"),
	)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db, NewPostgresRepo(db)
}

func TestPostgresCompanyExplorerCandidateSearchReturnsAuthorizedPaths(t *testing.T) {
	db, repo := openCompanyExplorerSearchPostgresIntegration(t)
	companyID := newUUIDv7String()
	userID := newUUIDv7String()
	rootFolderID := newUUIDv7String()
	teamFolderID := newUUIDv7String()
	logicGateID := newUUIDv7String()
	nodeID := newUUIDv7String()
	itemID := newUUIDv7String()
	assignmentID := newUUIDv7String()
	t.Cleanup(func() {
		for _, statement := range []string{
			`delete from node_logic_gate_assignments where company_id=$1::uuid`,
			`delete from company_explorer_items where company_id=$1::uuid`,
			`delete from nodes where company_id=$1::uuid`,
			`delete from logic_gates where company_id=$1::uuid`,
			`delete from company_explorer_folders where company_id=$1::uuid`,
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
		{`insert into users(user_id,cognito_subject,email,display_name) values($1::uuid,$2,$3,$4)`, []any{userID, "company-search-" + userID, userID + "@example.test", "Company Search User"}},
		{`insert into companies(company_id,name) values($1::uuid,$2)`, []any{companyID, "Company Search Integration"}},
		{`insert into company_memberships(company_id,user_id,role) values($1::uuid,$2::uuid,'company_user')`, []any{companyID, userID}},
		{`insert into company_explorer_folders(company_id,folder_id,name,default_access) values($1::uuid,$2::uuid,'Search Root','edit')`, []any{companyID, rootFolderID}},
		{`insert into company_explorer_folders(company_id,folder_id,parent_folder_id,name,default_access) values($1::uuid,$2::uuid,$3::uuid,'Search Team','edit')`, []any{companyID, teamFolderID, rootFolderID}},
		{`insert into logic_gates(company_id,logic_gate_id,header,default_access,created_timestamp) values($1::uuid,$2::uuid,'Search Gate','edit',now())`, []any{companyID, logicGateID}},
		{`insert into company_explorer_items(company_id,item_id,parent_folder_id,target_type,target_id) values($1::uuid,$2::uuid,$3::uuid,'logic_gate',$4::uuid)`, []any{companyID, itemID, teamFolderID, logicGateID}},
		{`insert into nodes(company_id,node_id,name,priority,default_access,created_timestamp) values($1::uuid,$2::uuid,'Search Node',3,'edit',now())`, []any{companyID, nodeID}},
		{`insert into node_logic_gate_assignments(company_id,assignment_id,node_id,logic_gate_id,status_key,column_id,position,compatibility_board_id,compatibility_card_id) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'pending','pending',1000,'search-integration',$2::uuid)`, []any{companyID, assignmentID, nodeID, logicGateID}},
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement.query, statement.args...); err != nil {
			t.Fatalf("seed Company Explorer search: %v", err)
		}
	}

	results, err := repo.SearchCompanyExplorer(CompanyExplorerSearchQuery{
		CompanyID: companyID, Query: "Search", PermissionUserID: userID, Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(results.Results) != 4 {
		t.Fatalf("Company Explorer results=%d, want gate, node, folder, folder: %#v", len(results.Results), results.Results)
	}
	if results.Results[0].ResourceType != EntityTypeLogicGate || results.Results[1].ResourceType != EntityTypeNode {
		t.Fatalf("Company Explorer ranking=%v, want logic gate then node", []string{results.Results[0].ResourceType, results.Results[1].ResourceType})
	}
	requireCompanyExplorerSearchPath(t, results.Results, EntityTypeLogicGate, logicGateID, []string{"Search Root", "Search Team"})
	requireCompanyExplorerSearchPath(t, results.Results, EntityTypeNode, nodeID, []string{"Search Root", "Search Team", "Search Gate"})
	requireCompanyExplorerSearchPath(t, results.Results, CompanyExplorerV2EntityFolder, teamFolderID, []string{"Search Root"})

	picker, err := repo.SearchCompanyExplorer(CompanyExplorerSearchQuery{
		CompanyID: companyID, Query: "Search", PermissionUserID: userID, Limit: 10,
		ResourceTypes: []string{EntityTypeNode, EntityTypeLogicGate}, EditorEntityRanking: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(picker.Results) != 2 || picker.Results[0].ResourceType != EntityTypeNode || picker.Results[1].ResourceType != EntityTypeLogicGate {
		t.Fatalf("picker ranking changed: %#v", picker.Results)
	}
	for _, result := range picker.Results {
		if len(result.LocationPath) != 0 {
			t.Fatalf("picker result %s unexpectedly exposed Explorer path %#v", result.ResourceID, result.LocationPath)
		}
	}
}

func TestPostgresCompanyExplorerCandidateSearchReturnsDirectGrantWithoutRestrictedPath(t *testing.T) {
	db, repo := openCompanyExplorerSearchPostgresIntegration(t)
	companyID := newUUIDv7String()
	userID := newUUIDv7String()
	restrictedRootID := newUUIDv7String()
	restrictedTeamID := newUUIDv7String()
	visibleGateID := newUUIDv7String()
	visibleProjectID := newUUIDv7String()
	hiddenParentGateID := newUUIDv7String()
	visibleNodeID := newUUIDv7String()
	visibleGateItemID := newUUIDv7String()
	visibleProjectItemID := newUUIDv7String()
	hiddenGateItemID := newUUIDv7String()
	assignmentID := newUUIDv7String()
	t.Cleanup(func() {
		for _, statement := range []string{
			`delete from node_logic_gate_assignments where company_id=$1::uuid`,
			`delete from company_explorer_items where company_id=$1::uuid`,
			`delete from nodes where company_id=$1::uuid`,
			`delete from projects where company_id=$1::uuid`,
			`delete from logic_gates where company_id=$1::uuid`,
			`delete from company_explorer_folders where company_id=$1::uuid`,
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
		{`insert into users(user_id,cognito_subject,email,display_name) values($1::uuid,$2,$3,$4)`, []any{userID, "restricted-search-" + userID, userID + "@example.test", "Restricted Search User"}},
		{`insert into companies(company_id,name) values($1::uuid,$2)`, []any{companyID, "Restricted Search Integration"}},
		{`insert into company_memberships(company_id,user_id,role) values($1::uuid,$2::uuid,'company_user')`, []any{companyID, userID}},
		{`insert into company_explorer_folders(company_id,folder_id,name,default_access) values($1::uuid,$2::uuid,'Restricted Root','edit')`, []any{companyID, restrictedRootID}},
		{`insert into company_explorer_folders(company_id,folder_id,parent_folder_id,name,default_access) values($1::uuid,$2::uuid,$3::uuid,'Restricted Team','edit')`, []any{companyID, restrictedTeamID, restrictedRootID}},
		{`insert into logic_gates(company_id,logic_gate_id,header,default_access,created_timestamp) values($1::uuid,$2::uuid,'Restricted Visible Gate','edit',now())`, []any{companyID, visibleGateID}},
		{`insert into projects(company_id,project_id,name,default_access) values($1::uuid,$2::uuid,'Restricted Visible Project','edit')`, []any{companyID, visibleProjectID}},
		{`insert into logic_gates(company_id,logic_gate_id,header,default_access,created_timestamp) values($1::uuid,$2::uuid,'Restricted Hidden Parent Gate','edit',now())`, []any{companyID, hiddenParentGateID}},
		{`insert into company_explorer_items(company_id,item_id,parent_folder_id,target_type,target_id) values($1::uuid,$2::uuid,$3::uuid,'logic_gate',$4::uuid)`, []any{companyID, visibleGateItemID, restrictedTeamID, visibleGateID}},
		{`insert into company_explorer_items(company_id,item_id,parent_folder_id,target_type,target_id) values($1::uuid,$2::uuid,$3::uuid,'project',$4::uuid)`, []any{companyID, visibleProjectItemID, restrictedTeamID, visibleProjectID}},
		{`insert into company_explorer_items(company_id,item_id,parent_folder_id,target_type,target_id) values($1::uuid,$2::uuid,$3::uuid,'logic_gate',$4::uuid)`, []any{companyID, hiddenGateItemID, restrictedTeamID, hiddenParentGateID}},
		{`insert into nodes(company_id,node_id,name,priority,default_access,created_timestamp) values($1::uuid,$2::uuid,'Restricted Visible Node',3,'edit',now())`, []any{companyID, visibleNodeID}},
		{`insert into node_logic_gate_assignments(company_id,assignment_id,node_id,logic_gate_id,status_key,column_id,position,compatibility_board_id,compatibility_card_id) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'pending','pending',1000,'restricted-search-integration',$2::uuid)`, []any{companyID, assignmentID, visibleNodeID, hiddenParentGateID}},
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement.query, statement.args...); err != nil {
			t.Fatalf("seed restricted Company Explorer search: %v", err)
		}
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeCompanyExplorerFolder, EntityID: restrictedRootID,
		DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("restrict root folder: %v", err)
	}
	teamPolicy, err := repo.GetResourcePermissionPolicy(companyID, EntityTypeCompanyExplorerFolder, restrictedTeamID)
	if err != nil {
		t.Fatalf("read inherited team policy: %v", err)
	}
	if teamPolicy.PermissionMode != PolicyModeInherited || teamPolicy.EffectiveDefaultAccess != ResourceDefaultAccessNoAccess {
		t.Fatalf("team policy=%+v, want inherited no_access", teamPolicy)
	}
	setCustomizedPolicy := func(resourceType, resourceID string, grantUser bool) {
		t.Helper()
		permissions := []EntityPermissionInput{}
		if grantUser {
			permissions = append(permissions, EntityPermissionInput{
				SubjectType: EntityPermissionSubjectUser,
				SubjectID:   userID,
				AccessLevel: EntityPermissionEdit,
			})
		}
		if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
			CompanyID: companyID, EntityType: resourceType, EntityID: resourceID,
			DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
			Permissions: permissions,
		}); err != nil {
			t.Fatalf("set customized policy %s/%s: %v", resourceType, resourceID, err)
		}
	}
	setCustomizedPolicy(EntityTypeLogicGate, visibleGateID, true)
	setCustomizedPolicy(EntityTypeProject, visibleProjectID, true)
	setCustomizedPolicy(EntityTypeLogicGate, hiddenParentGateID, false)
	setCustomizedPolicy(EntityTypeNode, visibleNodeID, true)

	results, err := repo.SearchCompanyExplorer(CompanyExplorerSearchQuery{
		CompanyID: companyID, Query: "Restricted", PermissionUserID: userID, Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(results.Results) != 3 {
		t.Fatalf("Company Explorer restricted-path results=%d, want gate, node, project: %#v", len(results.Results), results.Results)
	}
	requireCompanyExplorerSearchPath(t, results.Results, EntityTypeLogicGate, visibleGateID, []string{})
	requireCompanyExplorerSearchPath(t, results.Results, EntityTypeNode, visibleNodeID, []string{})
	requireCompanyExplorerSearchPath(t, results.Results, EntityTypeProject, visibleProjectID, []string{})
	requireCompanyExplorerSearchMissing(t, results.Results, EntityTypeLogicGate, hiddenParentGateID)
	requireCompanyExplorerSearchMissing(t, results.Results, EntityTypeCompanyExplorerFolder, restrictedRootID)
	requireCompanyExplorerSearchMissing(t, results.Results, EntityTypeCompanyExplorerFolder, restrictedTeamID)

	picker, err := repo.SearchCompanyExplorer(CompanyExplorerSearchQuery{
		CompanyID: companyID, Query: "Restricted", PermissionUserID: userID, Limit: 10,
		ResourceTypes: []string{EntityTypeNode, EntityTypeProject, EntityTypeLogicGate}, EditorEntityRanking: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(picker.Results) != 3 || picker.Results[0].ResourceType != EntityTypeNode || picker.Results[1].ResourceType != EntityTypeProject || picker.Results[2].ResourceType != EntityTypeLogicGate {
		t.Fatalf("picker restricted-path results changed: %#v", picker.Results)
	}
	for _, result := range picker.Results {
		if len(result.LocationPath) != 0 {
			t.Fatalf("picker result %s exposed restricted path %#v", result.ResourceID, result.LocationPath)
		}
	}
}
