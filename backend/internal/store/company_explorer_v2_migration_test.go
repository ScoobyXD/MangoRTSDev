package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const companyExplorerV2Migration = "20260617_company_explorer_v2_tables.sql"

func TestCompanyExplorerV2SchemaDefinesGraphTables(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	schema := string(raw)
	normalized := normalizeSQLForCompanyExplorerV2Test(schema)

	for _, want := range []string{
		"create table if not exists company_explorer_entities",
		"entity_type in ('company', 'user_group', 'user', 'folder', 'project', 'logic_gate', 'node')",
		"(entity_type = 'folder' and resource_id is null)",
		"(entity_type <> 'folder' and resource_id is not null)",
		"constraint company_explorer_entities_folder_default_access_chk",
		"create unique index if not exists idx_company_explorer_entities_native_resource",
		"on company_explorer_entities(company_id, entity_type, resource_id) where resource_id is not null",
		"create table if not exists company_explorer_edges",
		"constraint company_explorer_edges_not_self_chk check (parent_entity_id <> child_entity_id)",
		"unique (company_id, parent_entity_id, child_entity_id)",
		"foreign key (company_id, parent_entity_id) references company_explorer_entities",
		"foreign key (company_id, child_entity_id) references company_explorer_entities",
	} {
		if !strings.Contains(normalized, want) {
			t.Fatalf("schema missing %q", want)
		}
	}

	edgesBlock := normalizeSQLForCompanyExplorerV2Test(sqlBlockAfter(t, schema, "create table if not exists company_explorer_edges ("))
	for _, forbidden := range []string{
		"unique (company_id, child_entity_id)",
		"primary key (company_id, child_entity_id)",
	} {
		if strings.Contains(edgesBlock, forbidden) {
			t.Fatalf("edges table prevents multi-parent placement with %q:\n%s", forbidden, edgesBlock)
		}
	}
}

func TestCompanyExplorerV2MigrationIsAdditiveAndBackfillsLegacyData(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", companyExplorerV2Migration))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	normalized := normalizeSQLForCompanyExplorerV2Test(string(raw))

	for _, forbidden := range []string{
		"drop table if exists company_explorer_folders",
		"drop table company_explorer_folders",
		"drop table if exists company_explorer_folder_items",
		"drop table company_explorer_folder_items",
		"drop table if exists company_explorer_folder_shares",
		"drop table company_explorer_folder_shares",
		"drop table if exists company_explorer_default_folder_seeds",
		"drop table company_explorer_default_folder_seeds",
		"delete from company_explorer_folders",
		"delete from company_explorer_folder_items",
		"delete from company_explorer_folder_shares",
		"delete from company_explorer_default_folder_seeds",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("phase 1 migration must preserve old tables/rows, found %q", forbidden)
		}
	}

	for _, want := range []string{
		"select folder.company_id, folder.folder_id, 'folder', null, folder.name, folder.default_access",
		"from company_explorer_folders folder on conflict (company_id, entity_id) do update",
		"from company_explorer_folder_items item where item.item_type in ('node', 'logic_gate', 'project')",
		"child.entity_type = item.item_type and child.resource_id = item.resource_id",
		"with scoped_user_roots as",
		"group by folder.company_id, mangorts_try_uuid(folder.scope_id)",
		"from scoped_user_roots scoped",
		"with scoped_team_roots as",
		"from scoped_team_roots scoped",
		"folder.parent_folder_id is null",
		"root.scope_type = 'user' and scoped_root.entity_type = 'user'",
		"root.scope_type = 'team' and scoped_root.entity_type = 'user_group'",
		"company_root.entity_type = 'company'",
		"on conflict (company_id, parent_entity_id, child_entity_id) do update set position = excluded.position",
		"insert into resource_access_grants",
		"from company_explorer_folder_shares share",
		"where share.status = 'active' and share.user_id is not null",
		"'company_explorer_folder', share.folder_id, 'user', share.user_id, 'edit'",
		"default folder seeds are not copied into v2",
	} {
		if !strings.Contains(normalized, want) {
			t.Fatalf("migration missing backfill marker %q", want)
		}
	}
}

func TestCompanyExplorerV2MigrationHasPlacementGuards(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", companyExplorerV2Migration))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	normalized := normalizeSQLForCompanyExplorerV2Test(string(raw))

	for _, want := range []string{
		"unique (company_id, parent_entity_id, child_entity_id)",
		"create or replace function mangorts_prevent_company_explorer_edge_cycle()",
		"with recursive ancestors(entity_id, path) as",
		"where entity_id = new.child_entity_id",
		"create trigger trg_company_explorer_edges_prevent_cycle",
		"before insert or update of company_id, parent_entity_id, child_entity_id",
	} {
		if !strings.Contains(normalized, want) {
			t.Fatalf("migration missing placement guard %q", want)
		}
	}

	edgesBlock := normalizedCreateTableForTest(t, string(raw), "company_explorer_edges")
	if strings.Contains(edgesBlock, "unique (company_id, child_entity_id)") {
		t.Fatalf("edges table must allow the same child under multiple parents:\n%s", edgesBlock)
	}
}

func TestCompanyExplorerV2VerificationViewCoversMigrationInvariants(t *testing.T) {
	for _, path := range []string{
		filepath.Join("..", "..", "db", "schema.sql"),
		filepath.Join("..", "..", "db", "migrations", companyExplorerV2Migration),
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		normalized := normalizeSQLForCompanyExplorerV2Test(string(raw))
		for _, want := range []string{
			"create or replace view company_explorer_v2_backfill_verification",
			"old_folders_to_v2_folder_entities",
			"old_folder_items_to_v2_resource_edges",
			"old_parent_child_folder_paths_to_v2_edges",
			"company_root_folders_to_company_root_edges",
			"user_root_folders_to_user_root_edges",
			"team_root_folders_to_group_root_edges",
			"folder_default_access_to_v2_entities",
			"folder_permission_rows_target_v2_folder_entities",
			"active_folder_shares_to_edit_grants",
			"legacy_folder_item_ids_are_valid_uuids",
			"legacy_root_scope_ids_are_valid_uuids",
		} {
			if !strings.Contains(normalized, want) {
				t.Fatalf("%s missing verification marker %q", path, want)
			}
		}
	}
}

func normalizeSQLForCompanyExplorerV2Test(sql string) string {
	return strings.ToLower(strings.Join(strings.Fields(sql), " "))
}
