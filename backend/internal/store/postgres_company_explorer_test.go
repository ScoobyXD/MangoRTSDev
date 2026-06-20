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
		"func (r *postgresrepo) querycompanyexplorerfinalrootchildren",
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

func TestPostgresCompanyExplorerV2RootRowsUseContiguousRootArgs(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_v2.go: %v", err)
	}
	source := string(raw)
	rootArgs := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func companyExplorerRootArgs")), " "))
	for _, want := range []string{
		"query.companyid",
		"companyexplorerlazynullable(query.permissionuserid)",
		"entitypermissionview",
	} {
		if !strings.Contains(rootArgs, want) {
			t.Fatalf("companyExplorerRootArgs missing %q", want)
		}
	}
	if strings.Contains(rootArgs, "parententityid") {
		t.Fatalf("companyExplorerRootArgs must not include ParentEntityID")
	}

	rootRows := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) ListCompanyExplorerV2RootRows")), " "))
	if !strings.Contains(rootRows, "r.querycompanyexplorerfinalrootchildren(ctx, query)") {
		t.Fatalf("ListCompanyExplorerV2RootRows must read top-level rows through the root-specific query")
	}

	childRows := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) ListCompanyExplorerV2ChildRows")), " "))
	if !strings.Contains(childRows, "case companyexplorerv2entitycompany: rows, err = r.querycompanyexplorerfinalrootchildren(ctx, query)") {
		t.Fatalf("ListCompanyExplorerV2ChildRows must route company-parent reads through root-specific args")
	}

	rootChildren := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) queryCompanyExplorerFinalRootChildren")), " "))
	for _, want := range []string{
		"companyexplorerrooteffectiveaccessselect",
		"companyexplorerrootaccesspredicate",
		"companyexplorerrootargs(query)...",
		"folder.parent_folder_id is null",
		"item.parent_folder_id is null",
		"coalesce(all_rows.parent_entity_id::text, '') as parent_entity_id",
	} {
		if !strings.Contains(rootChildren, want) {
			t.Fatalf("queryCompanyExplorerFinalRootChildren missing %q", want)
		}
	}
	if strings.Contains(rootChildren, "companyexplorerfinalargs(query)") {
		t.Fatalf("queryCompanyExplorerFinalRootChildren must not use child-row args with an unused parent parameter")
	}
}
