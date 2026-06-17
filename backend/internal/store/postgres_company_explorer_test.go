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
