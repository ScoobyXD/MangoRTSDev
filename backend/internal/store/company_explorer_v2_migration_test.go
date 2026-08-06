package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	companyExplorerFinalCutoverMigration   = "20260620_company_explorer_final_cutover.sql"
	companyExplorerNoNodeItemsMigration    = "20260626_company_explorer_no_node_items.sql"
	resourcePermissionsIgnoreGVICMigration = "20260701_resource_permissions_ignore_gvic.sql"
	resourcePolicyPointersMigration        = "20260701_resource_policy_pointers.sql"
	resourcePolicyNoGVICMigration          = "20260702_resource_policy_access_helper_no_gvic.sql"
)

func TestCompanyExplorerFinalSchemaDefinesContainmentTables(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	normalized := normalizeSQLForCompanyExplorerV2Test(string(raw))

	for _, want := range []string{
		"create table if not exists company_explorer_folders",
		"parent_folder_id uuid",
		"default_access text not null default 'edit'",
		"create table if not exists company_explorer_items",
		"target_type text not null",
		"target_id uuid not null",
		"constraint company_explorer_items_target_type_chk check (target_type in ('project', 'logic_gate'))",
		"unique (company_id, target_type, target_id)",
		"foreign key (company_id, parent_folder_id) references company_explorer_folders(company_id, folder_id) on delete cascade",
		"create index if not exists idx_company_explorer_items_parent_position",
		"create index if not exists idx_company_explorer_items_target",
	} {
		if !strings.Contains(normalized, want) {
			t.Fatalf("schema missing %q", want)
		}
	}

	for _, forbidden := range []string{
		"create table if not exists company_explorer_folder_items",
		"create table if not exists company_explorer_entities",
		"create table if not exists company_explorer_edges",
		"create table if not exists company_explorer_subscriptions",
		"folder_kind text not null",
		"system_key text",
		"scope_type text",
		"scope_id text",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("schema kept removed company explorer storage marker %q", forbidden)
		}
	}
}

func TestCompanyExplorerFinalCutoverMigratesAndDropsLegacyStorage(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", companyExplorerFinalCutoverMigration))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	normalized := normalizeSQLForCompanyExplorerV2Test(string(raw))

	for _, want := range []string{
		"create table if not exists company_explorer_items",
		"from company_explorer_folder_items item",
		"insert into company_explorer_items",
		"from company_explorer_edges edge",
		"insert into project_relationships",
		"insert into node_logic_gate_assignments",
		"drop column if exists folder_kind",
		"drop column if exists system_key",
		"drop column if exists scope_type",
		"drop column if exists scope_id",
		"drop table if exists company_explorer_subscriptions",
		"drop table if exists company_explorer_edges",
		"drop table if exists company_explorer_entities",
		"drop table if exists company_explorer_folder_items",
		"drop table if exists company_explorer_folder_shares",
		"drop table if exists company_explorer_default_folder_seeds",
	} {
		if !strings.Contains(normalized, want) {
			t.Fatalf("final cutover migration missing marker %q", want)
		}
	}
}

func TestCompanyExplorerNoNodeItemsMigrationDeletesNodePlacement(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", companyExplorerNoNodeItemsMigration))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	normalized := normalizeSQLForCompanyExplorerV2Test(string(raw))
	for _, want := range []string{
		"delete from company_explorer_items where target_type='node'",
		"unfiled_nodes",
		"check (target_type in ('project', 'logic_gate'))",
		"create or replace view company_explorer_final_backfill_verification",
	} {
		if !strings.Contains(normalized, want) {
			t.Fatalf("no-node migration missing marker %q", want)
		}
	}
}

func TestCompanyExplorerFinalVerificationViewCoversCutoverInvariants(t *testing.T) {
	for _, path := range []string{
		filepath.Join("..", "..", "db", "schema.sql"),
		filepath.Join("..", "..", "db", "migrations", companyExplorerFinalCutoverMigration),
		filepath.Join("..", "..", "db", "migrations", companyExplorerNoNodeItemsMigration),
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		normalized := normalizeSQLForCompanyExplorerV2Test(string(raw))
		for _, want := range []string{
			"create or replace view company_explorer_final_backfill_verification",
			"manual_references_have_existing_targets",
			"folders_have_valid_parents",
		} {
			if !strings.Contains(normalized, want) {
				t.Fatalf("%s missing verification marker %q", path, want)
			}
		}
	}
}

func TestCompanyExplorerAccessHelperCutoverUsesFinalFolderStorage(t *testing.T) {
	for _, path := range []string{
		filepath.Join("..", "..", "db", "schema.sql"),
		filepath.Join("..", "..", "db", "migrations", resourcePermissionsIgnoreGVICMigration),
		filepath.Join("..", "..", "db", "migrations", resourcePolicyPointersMigration),
		filepath.Join("..", "..", "db", "migrations", resourcePolicyNoGVICMigration),
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		normalized := extractAccessHelperSQLForCompanyExplorerV2Test(t, normalizeSQLForCompanyExplorerV2Test(string(raw)))
		if strings.HasSuffix(filepath.ToSlash(path), "db/schema.sql") {
			for _, want := range []string{
				"from mangorts_v2_resolve_permission_policy",
				"direct_rule as",
				"member_groups(group_id,depth,path) as",
				"group_rule as",
				"when (select allowed from admin_actor) then true",
			} {
				if !strings.Contains(normalized, want) {
					t.Fatalf("%s missing V2 access helper marker %q", path, want)
				}
			}
			continue
		}
		for _, want := range []string{
			"create or replace function mangorts_user_can_access_resource",
			"from company_explorer_folders folder",
			"where normalized.resource_type='company_explorer_folder' and folder.company_id=p_company_id and folder.folder_id=p_resource_id",
			"from shared_inbox_folders folder",
			"from shared_inboxes inbox",
			"from resource_permissions access",
			"group_tree(company_id, ancestor_group_id, descendant_group_id, depth) as",
			"join group_tree closure",
			"from company_user_groups user_group",
			"join company_user_group_members member",
		} {
			if !strings.Contains(normalized, want) {
				t.Fatalf("%s missing access helper marker %q", path, want)
			}
		}
		for _, forbidden := range []string{
			"gvic_access",
			"gvic_resource_lookup",
			"resource_gvic_effective_assignments",
			"company_user_group_closure",
			"when (select max_rank from gvic_access) >= requested.required_rank",
			"folder.folder_kind",
			"folder.system_key",
			"folder.scope_type",
			"folder.scope_id",
			"folder_kind <> 'communications'",
		} {
			if strings.Contains(normalized, forbidden) {
				t.Fatalf("%s kept removed access helper marker %q", path, forbidden)
			}
		}
	}
}

func extractAccessHelperSQLForCompanyExplorerV2Test(t *testing.T, sql string) string {
	t.Helper()
	start := strings.LastIndex(sql, "create or replace function mangorts_user_can_access_resource")
	if start < 0 {
		t.Fatalf("missing mangorts_user_can_access_resource")
	}
	sql = sql[start:]
	end := strings.Index(sql, "$$ language sql stable;")
	v2End := strings.Index(sql, "$$;")
	if end < 0 || (v2End >= 0 && v2End < end) {
		end = v2End
	}
	if end < 0 {
		t.Fatalf("missing mangorts_user_can_access_resource terminator")
	}
	return sql[:end]
}

func normalizeSQLForCompanyExplorerV2Test(sql string) string {
	return strings.ToLower(strings.Join(strings.Fields(sql), " "))
}
