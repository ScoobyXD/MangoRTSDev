package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresDeferredExplorerProjectionUsesInsertIfMissingSQL(t *testing.T) {
	raw, err := os.ReadFile("postgres_workspace_derived_projection.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_workspace_derived_projection.go: %v", err)
	}
	source := strings.ReplaceAll(string(raw), "\r\n", "\n")
	insertBody := extractFunctionSourceForTest(t, source, "func insertMissingCompanyExplorerFolderItemSQL")
	normalizedInsert := strings.ToLower(strings.Join(strings.Fields(insertBody), " "))
	for _, needle := range []string{
		"insert into company_explorer_items",
		"parent_folder_id, target_type, target_id",
		"on conflict (company_id, target_type, target_id) do nothing",
		"returning company_id::text, coalesce(parent_folder_id::text, '') as folder_id, target_type, target_id::text, position",
	} {
		if !strings.Contains(normalizedInsert, needle) {
			t.Fatalf("insertMissingCompanyExplorerFolderItemSQL missing %q", needle)
		}
	}
	for _, forbidden := range []string{"do update set", "delete from node_relationships", "delete from logic_gate_relationships"} {
		if strings.Contains(normalizedInsert, forbidden) {
			t.Fatalf("insertMissingCompanyExplorerFolderItemSQL should not contain %q", forbidden)
		}
	}
	for _, forbidden := range []string{`itemtype == "node"`, `itemtype != "node"`, "from nodes where"} {
		if strings.Contains(normalizedInsert, forbidden) {
			t.Fatalf("insertMissingCompanyExplorerFolderItemSQL retained Node placement path %q", forbidden)
		}
	}

	projectBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) projectDeferredCompanyExplorerFolderItemTx")
	normalizedProject := strings.ToLower(strings.Join(strings.Fields(projectBody), " "))
	for _, needle := range []string{
		"insertmissingcompanyexplorerfolderitemsql",
		"itemtype != entitytypelogicgate",
		"if !inserted { return nil, nil }",
		"company_explorer_item_placed",
	} {
		if !strings.Contains(normalizedProject, needle) {
			t.Fatalf("projectDeferredCompanyExplorerFolderItemTx missing %q", needle)
		}
	}
	if strings.Contains(normalizedProject, "assigncompanyexplorerfolderitemsql") {
		t.Fatal("projectDeferredCompanyExplorerFolderItemTx should not call the moving folder assignment helper")
	}
}
