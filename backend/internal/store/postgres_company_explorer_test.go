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
		"item.target_type in ('project', 'logic_gate')",
		"item.target_type='logic_gate'",
		"item.target_type='project'",
		"mangorts_user_can_access_resource(item.company_id, item.target_type, item.target_id",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("lazy company explorer SQL missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"item.target_type='node'",
		"item.target_type not in",
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

func TestPostgresCompanyExplorerV2RowsUseFinalStorageAndLeafItems(t *testing.T) {
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
		"case companyexplorerv2entityproject, companyexplorerv2entitylogicgate: rows = []companyexplorerv2row{}",
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
		"querycompanyexplorerfinallogicgatechildren",
		"companyexplorernativechildren",
		"from project_relationship_projection projection",
		"from node_logic_gate_assignments assignment",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("final company explorer rows kept removed V2 copy-graph marker %q", forbidden)
		}
	}
}

func TestPostgresCompanyExplorerV2NodeEdgesUseOrdinaryNodeSemantics(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_v2.go: %v", err)
	}
	source := string(raw)
	for _, signature := range []string{"func (r *PostgresRepo) MoveCompanyExplorerV2Edge", "func (r *PostgresRepo) DeleteCompanyExplorerV2Edges"} {
		body := extractFunctionSourceForTest(t, source, signature)
		for _, forbidden := range []string{"postgresRejectEmailCollaborationNodeMutation", "communications_email_collaborations", "ErrProtectedEmailCollaborationResource"} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("%s retains special email Node guard %q", signature, forbidden)
			}
		}
	}
}
func TestPostgresCompanyExplorerV2PermissionRuleMarkersCoverLeafResources(t *testing.T) {
	markerSQL := strings.ToLower(strings.Join(strings.Fields(companyExplorerPermissionRulesSelect("all_rows.entity_type", "all_rows.entity_id")), " "))
	for _, want := range []string{
		"all_rows.entity_type='folder'",
		"from company_explorer_folders permission_folder",
		"permission_marker.resource_type='company_explorer_folder'",
		"all_rows.entity_type='logic_gate'",
		"from logic_gates permission_logic_gate",
		"permission_logic_gate.logic_gate_id=all_rows.entity_id",
		"permission_marker.resource_type='logic_gate'",
		"all_rows.entity_type='project'",
		"from projects permission_project",
		"permission_project.project_id=all_rows.entity_id",
		"permission_marker.resource_type='project'",
	} {
		if !strings.Contains(markerSQL, want) {
			t.Fatalf("companyExplorerPermissionRulesSelect missing %q in %s", want, markerSQL)
		}
	}
	if strings.Contains(markerSQL, "all_rows.entity_type='node'") {
		t.Fatalf("Company Explorer permission markers must not add node row locks")
	}
}

func TestPostgresCompanyExplorerSearchUsesSharedCandidateFirstPath(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_search.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_search.go: %v", err)
	}
	source := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	if !strings.Contains(source, "return r.searchcompanyexplorercandidates(query)") {
		t.Fatal("Company Explorer search must use the shared candidate-first authorization path")
	}
	for _, forbidden := range []string{"visible_folder_paths", "visible_item_locations", "mangorts_user_can_access_resource"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("Company Explorer search entrypoint retained broad pre-filter work %q", forbidden)
		}
	}
}

func TestPostgresCompanyExplorerCandidateSearchNarrowsBeforePermissionChecks(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_editor_search.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_editor_search.go: %v", err)
	}
	source := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, want := range []string{
		"with recursive candidates as",
		"candidate_batch as materialized",
		"organization_links as",
		"candidate_locations as",
		"location_folders(candidate_type",
		"member_groups_raw(group_id,depth,path) as",
		"access_targets as",
		"resolved_targets as",
		"target_access as",
		"eligible_locations as",
		"candidate_access as",
		"lower(node.name) like '%' || lower($2) || '%'",
		"lower(project.name) like '%' || lower($2) || '%'",
		"lower(logic_gate.header) like '%' || lower($2) || '%'",
		"lower(folder.name) like '%' || lower($2) || '%'",
		"where not $7",
		"when 'node' then 0 when 'project' then 1 when 'logic_gate' then 2",
		"when 'logic_gate' then 0 when 'node' then 1 when 'project' then 2 when 'folder' then 3",
		"jsonb_agg(jsonb_build_object",
		"when $7 then '[]'::jsonb",
		"companyexplorerfinalhaschildrenexpr",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("editor entity search SQL missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"visible_folder_paths",
		"visible_item_locations",
		"companyexploreraccesspredicate",
		"mangorts_user_can_access_resource",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("editor entity search SQL kept unused Explorer path work %q", forbidden)
		}
	}
	if strings.Count(source, "mangorts_v2_resolve_permission_policy") != 1 {
		t.Fatal("candidate search must resolve each deduplicated permission target through one shared policy CTE")
	}
	searchRaw, err := os.ReadFile("postgres_company_explorer_search.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_search.go: %v", err)
	}
	if strings.Contains(string(searchRaw), "ensureCompanyExplorerDefaultState(query.CompanyID)") {
		t.Fatal("search must not repair or upsert Company Explorer defaults")
	}
	handlerRaw, err := os.ReadFile("../http/company_explorer_handlers.go")
	if err != nil {
		t.Fatalf("ReadFile company_explorer_handlers.go: %v", err)
	}
	if !strings.Contains(string(handlerRaw), "Context:             r.Context()") {
		t.Fatal("search handler must carry request cancellation into the repository query")
	}
	if !strings.Contains(string(raw), "ctx := query.Context") || !strings.Contains(string(raw), "r.db.QueryContext(ctx") {
		t.Fatal("editor entity search must run PostgreSQL work under the request context")
	}
}

func TestEditorEntitySearchTrigramIndexesAreCanonical(t *testing.T) {
	for _, path := range []string{"../../db/schema.sql", "../../db/migrations/20260722_editor_entity_search_indexes.sql"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", path, err)
		}
		source := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
		for _, want := range []string{
			"create extension if not exists pg_trgm",
			"idx_nodes_name_trgm",
			"on nodes using gin (lower(name) gin_trgm_ops)",
			"idx_projects_name_trgm",
			"on projects using gin (lower(name) gin_trgm_ops)",
			"idx_logic_gates_header_trgm",
			"on logic_gates using gin (lower(header) gin_trgm_ops)",
		} {
			if !strings.Contains(source, want) {
				t.Fatalf("%s missing %q", path, want)
			}
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
		"entitypermissionedit",
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

func TestPostgresCompanyExplorerV2LeafRowsDoNotUseNativeChildren(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_v2.go: %v", err)
	}
	source := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, forbidden := range []string{
		"func companyexplorernativechildrenargs",
		"companyexplorernativechildreneffectiveaccessselect",
		"companyexplorernativechildrenaccesspredicate",
		"querycompanyexplorerfinallogicgatechildren",
		"assignment.logic_gate_id=",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("Company Explorer V2 kept removed native-child marker %q", forbidden)
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

func TestPostgresRecycleRestoreOmitsGeneratedColumnsAndProjectScopeKeepsAssociations(t *testing.T) {
	raw, err := os.ReadFile("postgres_recycle_bin.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_recycle_bin.go: %v", err)
	}
	source := string(raw)
	restore := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func postgresRestoreRecycleTableTx")), " "))
	for _, want := range []string{"postgresrecyclerestorablecolumnstx", "overriding system value"} {
		if !strings.Contains(restore, want) {
			t.Fatalf("postgresRestoreRecycleTableTx missing %q", want)
		}
	}
	if strings.Contains(restore, "select * from jsonb_populate_recordset") {
		t.Fatalf("postgresRestoreRecycleTableTx must not insert generated columns from recycle payloads")
	}
	columns := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func postgresRecycleRestorableColumnsTx")), " "))
	if !strings.Contains(columns, "attgenerated = ''") {
		t.Fatalf("postgresRecycleRestorableColumnsTx must omit generated columns")
	}
	expand := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(t, source, "func postgresExpandCompanyExplorerRecycleScopeTx")), " "))
	if strings.Contains(expand, "postgresaddprojectscopeitemstx") {
		t.Fatalf("project relationships must not expand project delete scope")
	}
}
