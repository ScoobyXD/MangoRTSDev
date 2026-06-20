package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresGetCompanyExplorerFolderUsesSchemaCompatibleLookup(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer.go: %v", err)
	}
	body := extractFunctionSourceForTest(t, string(raw), "func (r *PostgresRepo) GetCompanyExplorerFolder")
	normalized := strings.ToLower(strings.Join(strings.Fields(body), " "))
	if !strings.Contains(normalized, "r.getcompanyexplorerfolder(ctx, companyid, folderid, true)") {
		t.Fatal("GetCompanyExplorerFolder should use the schema-compatible shared folder lookup")
	}
	if !strings.Contains(normalized, "postgresresourcedefaultaccess(ctx, r.db, companyid, entitytypecompanyexplorerfolder, folderid)") {
		t.Fatal("GetCompanyExplorerFolder should load folder default_access without widening the folder row query")
	}
	if strings.Contains(normalized, "account_email") {
		t.Fatal("GetCompanyExplorerFolder must not select the dropped company_explorer_folders.account_email column")
	}
}

func TestPostgresCompanyExplorerLazyUsesFinalItemsAndNoScopedFolders(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_lazy.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_lazy.go: %v", err)
	}
	source := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, want := range []string{
		"$2::text as scope",
		"$3::uuid as scope_user_id",
		"$4::uuid as permission_user_id",
		"$5::uuid as parent_id",
		"$6::text as access_level",
		"from company_explorer_items item",
		"item.parent_folder_id is null",
		"item.parent_folder_id=$5::uuid",
		"item.target_type='node'",
		"item.target_type='logic_gate'",
		"item.target_type='project'",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("lazy company explorer SQL missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"company_explorer_folder_items",
		".scope_id",
		".scope_type",
		"scope_groups",
		"scope_users",
		"folder.folder_kind",
		"folder.system_key",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("lazy company explorer SQL kept removed scoped storage marker %q", forbidden)
		}
	}
}

func TestPostgresCompanyExplorerV2RowsUseFinalStorageAndNativeChildren(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_v2.go: %v", err)
	}
	source := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, want := range []string{
		"func (r *postgresrepo) querycompanyexplorerfinalcontainerchildren",
		"from company_explorer_folders folder",
		"from company_explorer_items item",
		"func (r *postgresrepo) querycompanyexplorerfinalprojectchildren",
		"from project_relationship_projection projection",
		"func (r *postgresrepo) querycompanyexplorerfinallogicgatechildren",
		"from node_logic_gate_assignments assignment",
		"insert into company_explorer_items",
		"update company_explorer_items",
		"delete from company_explorer_items",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("final company explorer rows missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"company_explorer_entities",
		"company_explorer_edges",
		"company_explorer_subscriptions",
		"querycompanyexplorerv2derivedgroups",
		"ensurecompanyexplorerv2nativeentities",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("final company explorer rows kept removed V2 copy-graph marker %q", forbidden)
		}
	}
}
