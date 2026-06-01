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
		"insert into company_explorer_folder_items",
		"on conflict (company_id, item_type, item_id) do nothing",
		"returning company_id, folder_id, item_type, item_id, position",
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

	projectBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) projectDeferredCompanyExplorerFolderItemTx")
	normalizedProject := strings.ToLower(strings.Join(strings.Fields(projectBody), " "))
	for _, needle := range []string{
		"insertmissingcompanyexplorerfolderitemsql",
		"if !inserted { return nil, nil }",
		"folderitemassignedworkspaceeventinput",
	} {
		if !strings.Contains(normalizedProject, needle) {
			t.Fatalf("projectDeferredCompanyExplorerFolderItemTx missing %q", needle)
		}
	}
	if strings.Contains(normalizedProject, "assigncompanyexplorerfolderitemsql") {
		t.Fatal("projectDeferredCompanyExplorerFolderItemTx should not call the moving folder assignment helper")
	}
}
