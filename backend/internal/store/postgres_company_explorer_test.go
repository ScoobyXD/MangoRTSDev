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

func TestPostgresCompanyExplorerLazyFolderScopeUsesTextScopeID(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_lazy.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_lazy.go: %v", err)
	}
	body := extractFunctionSourceForTest(t, string(raw), "func companyExplorerLazyFolderScopePredicate")
	normalized := strings.ToLower(strings.Join(strings.Fields(body), " "))
	for _, needle := range []string{
		".scope_id=$3::text",
		"select group_id::text from scope_groups",
		"select user_id::text from scope_users",
	} {
		if !strings.Contains(normalized, needle) {
			t.Fatalf("lazy folder scope predicate missing %q", needle)
		}
	}
	for _, forbidden := range []string{
		".scope_id=$3::uuid",
		".scope_id in (select group_id from scope_groups)",
		".scope_id in (select user_id from scope_users)",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("lazy folder scope predicate must not compare text scope_id to uuid source %q", forbidden)
		}
	}
}

func TestPostgresCompanyExplorerLazyScopeCTETypesUnusedRootParameters(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_lazy.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_lazy.go: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "const companyExplorerLazyScopeCTE =")
	if start < 0 {
		t.Fatal("companyExplorerLazyScopeCTE not found")
	}
	end := strings.Index(source[start:], "func companyExplorerLazyFolderScopePredicate")
	if end < 0 {
		t.Fatal("companyExplorerLazyScopeCTE end not found")
	}
	body := source[start : start+end]
	normalized := strings.ToLower(strings.Join(strings.Fields(body), " "))
	for _, needle := range []string{
		"$5::uuid as parent_id",
		"$6::text as access_level",
	} {
		if !strings.Contains(normalized, needle) {
			t.Fatalf("lazy scope CTE must type root-query placeholder %q", needle)
		}
	}
}

func TestPostgresCompanyExplorerV2NativeNodeHydrationUsesNodeSchemaColumns(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_v2.go: %v", err)
	}
	body := extractFunctionSourceForTest(t, string(raw), "func (r *PostgresRepo) ensureCompanyExplorerV2NativeEntities")
	normalized := strings.ToLower(strings.Join(strings.Fields(body), " "))
	if strings.Contains(normalized, "node.updated_timestamp") {
		t.Fatal("nodes table has no updated_timestamp column; V2 native hydration must use node.created_timestamp")
	}
	if !strings.Contains(normalized, "node.title, null, node.created_timestamp, node.created_timestamp") {
		t.Fatal("V2 native node hydration should map both entity timestamps from node.created_timestamp")
	}
}

func TestPostgresCompanyExplorerV2RowsQueriesTypeSharedPlaceholders(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_v2.go: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "const companyExplorerV2TypedArgsCTE =")
	if start < 0 {
		t.Fatal("companyExplorerV2TypedArgsCTE not found")
	}
	end := strings.Index(source[start:], "func companyExplorerV2AccessPredicate")
	if end < 0 {
		t.Fatal("companyExplorerV2TypedArgsCTE end not found")
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(source[start:start+end]), " "))
	for _, needle := range []string{
		"$2::text as view",
		"$3::uuid as scope_user_id",
		"$5::uuid as parent_entity_id",
		"$6::text as access_level",
	} {
		if !strings.Contains(normalized, needle) {
			t.Fatalf("V2 rows queries must type shared placeholder %q", needle)
		}
	}
	for _, functionName := range []string{
		"func (r *PostgresRepo) ListCompanyExplorerV2RootRows",
		"func (r *PostgresRepo) getCompanyExplorerV2Parent",
		"func (r *PostgresRepo) queryCompanyExplorerV2StoredChildren",
		"func (r *PostgresRepo) queryCompanyExplorerV2DerivedGroups",
		"func (r *PostgresRepo) queryCompanyExplorerV2DerivedGroupUsers",
		"func (r *PostgresRepo) queryCompanyExplorerV2DerivedProjectChildren",
		"func (r *PostgresRepo) queryCompanyExplorerV2DerivedLogicGateNodes",
		"func (r *PostgresRepo) UpsertCompanyExplorerV2Edge",
		"func (r *PostgresRepo) companyExplorerV2RowByEdge",
	} {
		body := extractFunctionSourceForTest(t, source, functionName)
		normalizedBody := strings.ToLower(strings.Join(strings.Fields(body), " "))
		if strings.Contains(normalizedBody, "companyexplorerv2args(") && !strings.Contains(normalizedBody, "companyexplorerv2typedargscte") {
			t.Fatalf("%s uses companyExplorerV2Args without typing shared placeholders", functionName)
		}
	}
}

func TestPostgresCompanyExplorerV2DerivedGroupsDoNotReuseCommonJoinAlias(t *testing.T) {
	raw, err := os.ReadFile("postgres_company_explorer_v2.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer_v2.go: %v", err)
	}
	source := string(raw)
	derivedSwitcher := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) queryCompanyExplorerV2DerivedChildren")
	derivedGroups := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) queryCompanyExplorerV2DerivedGroups")
	normalizedSwitcher := strings.ToLower(strings.Join(strings.Fields(derivedSwitcher), " "))
	normalizedGroups := strings.ToLower(strings.Join(strings.Fields(derivedGroups), " "))
	if strings.Contains(normalizedGroups, "from company_user_groups user_group") {
		t.Fatal("derived group query must not reuse the common display join alias user_group")
	}
	for _, needle := range []string{
		"from company_user_groups child_group",
		"coalesce(child_group.position, 1000)",
		"child_group.parent_group_id is null",
		"child_group.parent_group_id=$7::uuid",
	} {
		if !strings.Contains(normalizedGroups, needle) && !strings.Contains(normalizedSwitcher, needle) {
			t.Fatalf("derived group query should use child_group alias for %q", needle)
		}
	}
}
