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

func TestPostgresCompanyExplorerV2RowsUseFinalStorageAndLogicGateNativeChildren(t *testing.T) {
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
		"case companyexplorerv2entityproject: rows = []companyexplorerv2row{}",
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
		"querycompanyexplorerfinalprojectchildren",
		"from project_relationship_projection projection",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("final company explorer rows kept removed V2 copy-graph marker %q", forbidden)
		}
	}
}

func TestPostgresCompanyExplorerSearchUsesVisibleExplorerLocations(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_search.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_search.go: %v", err)
	}
	source := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, want := range []string{
		"with recursive visible_folder_paths as",
		"folder.created_timestamp",
		"folder.updated_timestamp",
		"child.created_timestamp",
		"child.updated_timestamp",
		"companyexploreraccesspredicate(\"'folder'\", \"folder.folder_id\", \"$3\", \"$4\")",
		"companyexploreraccesspredicate(\"'folder'\", \"child.folder_id\", \"$3\", \"$4\")",
		"visible_item_locations as",
		"and (item.parent_folder_id is null or parent.folder_id is not null)",
		"companyexploreraccesspredicate(\"item.target_type\", \"item.target_id\", \"$3\", \"$4\")",
		"visible_logic_gate_locations as",
		"from node_logic_gate_assignments assignment",
		"join visible_logic_gate_locations logic_gate_location",
		"companyexploreraccesspredicate(\"'node'\", \"assignment.node_id\", \"$3\", \"$4\")",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("company explorer search SQL missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"from project_relationships relationship",
		"project_locations",
		"relationship.resource_id as target_id",
		"from candidates candidate left join ranked_locations",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("company explorer search SQL kept hidden/project relationship search marker %q", forbidden)
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

func TestPostgresCompanyExplorerV2NativeChildrenUseCompactArgs(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_v2.go: %v", err)
	}
	source := string(raw)
	nativeArgs := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func companyExplorerNativeChildrenArgs")), " "))
	for _, want := range []string{
		"query.companyid",
		"companyexplorerlazynullable(query.permissionuserid)",
		"entitypermissionview",
		"parententityid",
	} {
		if !strings.Contains(nativeArgs, want) {
			t.Fatalf("companyExplorerNativeChildrenArgs missing %q", want)
		}
	}
	if strings.Contains(nativeArgs, "query.parententityid") {
		t.Fatalf("companyExplorerNativeChildrenArgs must not include query.ParentEntityID")
	}

	logicGateRows := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) queryCompanyExplorerFinalLogicGateChildren")), " "))
	for _, want := range []string{
		"companyexplorernativechildrenargs(query, logicgateid)",
		"assignment.logic_gate_id=$4::uuid",
		"companyexplorernativechildreneffectiveaccessselect",
		"companyexplorernativechildrenaccesspredicate",
	} {
		if !strings.Contains(logicGateRows, want) {
			t.Fatalf("queryCompanyExplorerFinalLogicGateChildren missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"companyexplorerfinalargs(query)",
		"assignment.logic_gate_id=$5::uuid",
	} {
		if strings.Contains(logicGateRows, forbidden) {
			t.Fatalf("queryCompanyExplorerFinalLogicGateChildren kept stale arg shape marker %q", forbidden)
		}
	}
}

func TestPostgresCompanyExplorerDeleteUsesResourcePermissionsCleanup(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer.go: %v", err)
	}
	source := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, want := range []string{
		`execoptionalpostgresshapecleanuptx(tx, "resource_permissions"`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("company explorer delete cleanup missing %q", want)
		}
	}
	if strings.Contains(source, `resource_access_grants`) {
		t.Fatalf("company explorer delete cleanup must not reference legacy resource_access_grants")
	}
	if strings.Contains(source, `!ispostgresundefinedtable(err, "resource_permissions")`) {
		t.Fatalf("company explorer delete cleanup must use savepoint-backed optional shape cleanup")
	}

	projectRaw, err := os.ReadFile("postgres_projects.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_projects.go: %v", err)
	}
	projectDelete := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, string(projectRaw), "func postgresDeleteProjectTx")), " "))
	for _, want := range []string{
		`execoptionalpostgresshapecleanuptx(tx, "resource_permissions"`,
	} {
		if !strings.Contains(projectDelete, want) {
			t.Fatalf("postgresDeleteProjectTx missing %q", want)
		}
	}
	if strings.Contains(projectDelete, `resource_access_grants`) {
		t.Fatalf("postgresDeleteProjectTx must not reference legacy resource_access_grants")
	}
}

func TestPostgresRecycleSnapshotSkipsOptionalShapeDriftWithSavepoint(t *testing.T) {
	raw, err := os.ReadFile("postgres_recycle_bin.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_recycle_bin.go: %v", err)
	}
	source := string(raw)
	snapshotRows := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func postgresSnapshotRowsWithCacheTx")), " "))
	for _, want := range []string{
		`const savepoint = "mangorts_recycle_snapshot"`,
		"`savepoint `+savepoint",
		"cache.shapeok",
		"cache.shapebad",
		"postgresrecyclesnapshottableexiststx",
		"isrecyclesnapshotshapeerror(err)",
		"rollbackandreleaserecyclesnapshotsavepointtx",
		`return json.rawmessage("[]"), nil`,
	} {
		if !strings.Contains(snapshotRows, want) {
			t.Fatalf("postgresSnapshotRowsWithCacheTx missing %q", want)
		}
	}
	createItems := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func postgresCreateRecycleBinItemsTx")), " "))
	for _, want := range []string{
		"snapshotcache := newrecyclesnapshotcache()",
		"postgressnapshotrecyclepayloadwithcachetx",
	} {
		if !strings.Contains(createItems, want) {
			t.Fatalf("postgresCreateRecycleBinItemsTx missing %q", want)
		}
	}
	shapeError := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func isRecycleSnapshotShapeError")), " "))
	for _, want := range []string{
		`ispostgresundefinedtable(err, "")`,
		`ispostgresundefinedcolumn(err, "")`,
	} {
		if !strings.Contains(shapeError, want) {
			t.Fatalf("isRecycleSnapshotShapeError missing %q", want)
		}
	}
}
