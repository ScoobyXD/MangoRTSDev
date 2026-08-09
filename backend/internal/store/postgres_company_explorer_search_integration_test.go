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
