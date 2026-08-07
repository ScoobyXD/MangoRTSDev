package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

const (
	companyExplorerFinalCutoverMigration    = "20260620_company_explorer_final_cutover.sql"
	companyExplorerNoNodeItemsMigration     = "20260626_company_explorer_no_node_items.sql"
	companyExplorerRemoveNodeItemsMigration = "20260806_zz_remove_company_explorer_node_items.sql"
	resourcePermissionsIgnoreRACIMigration  = "20260701_resource_permissions_ignore_gvic.sql"
	resourcePolicyPointersMigration         = "20260701_resource_policy_pointers.sql"
	resourcePolicyNoRACIMigration           = "20260702_resource_policy_access_helper_no_gvic.sql"
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

func TestCompanyExplorerRemoveNodeItemsMigrationIsAtomicAndNarrow(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", companyExplorerRemoveNodeItemsMigration))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	normalized := normalizeSQLForCompanyExplorerV2Test(string(raw))
	for _, want := range []string{
		"begin;",
		"server_version_num",
		"delete from company_explorer_items where target_type = 'node'",
		"unfiled_nodes",
		"delete from company_explorer_folders nodes_folder",
		"check (target_type in ('project', 'logic_gate'))",
		"commit;",
	} {
		if !strings.Contains(normalized, want) {
			t.Fatalf("Node placement cleanup migration missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"delete from nodes",
		"delete from node_logic_gate_assignments",
		"delete from project_relationships",
		"delete from email_relationships",
		"delete from attachments",
		"delete from attachment_relationships",
		"delete from node_textbox_chats",
		"delete from resource_gvic_assignments",
		"delete from resource_permissions",
		"\\set",
		"\\i",
		"\\copy",
		"\\echo",
		":variable",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("Node placement cleanup migration contains forbidden marker %q", forbidden)
		}
	}
}

func TestCompanyExplorerRemoveNodeItemsDisposablePostgres(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_COMPANY_EXPLORER_NODE_ITEMS_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set MANGORTS_COMPANY_EXPLORER_NODE_ITEMS_TEST_DATABASE_URL to a disposable local PostgreSQL 17 or 18 database")
	}
	if os.Getenv("MANGORTS_COMPANY_EXPLORER_NODE_ITEMS_TEST_RESET_ACK") != "DROP_DISPOSABLE_SCHEMA" {
		t.Fatal("set MANGORTS_COMPANY_EXPLORER_NODE_ITEMS_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA for the guarded disposable test")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.Host != "127.0.0.1" && !strings.EqualFold(config.Host, "localhost") {
		t.Fatalf("refusing non-local disposable database host %q", config.Host)
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	defer db.Close()

	var version int
	var databaseName string
	if err := db.QueryRow(`select current_setting('server_version_num')::integer, current_database()`).Scan(&version, &databaseName); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 190000 || !strings.HasPrefix(databaseName, "mangorts_company_explorer_node_items_test") {
		t.Fatalf("refusing PostgreSQL version/database %d/%q", version, databaseName)
	}
	if _, err := db.Exec("drop schema public cascade; create schema public"); err != nil {
		t.Fatalf("reset disposable schema: %v", err)
	}

	fixture := `
create table nodes (
  company_id uuid not null,
  node_id uuid not null,
  name text not null,
  primary key (company_id, node_id)
);
create table projects (
  company_id uuid not null,
  project_id uuid not null,
  name text not null,
  primary key (company_id, project_id)
);
create table logic_gates (
  company_id uuid not null,
  logic_gate_id uuid not null,
  header text not null,
  primary key (company_id, logic_gate_id)
);
create table company_explorer_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  primary key (company_id, folder_id)
);
create table company_explorer_items (
  company_id uuid not null,
  item_id uuid not null,
  parent_folder_id uuid,
  target_type text not null,
  target_id uuid not null,
  constraint company_explorer_items_target_type_chk check (target_type in ('project', 'logic_gate', 'node')),
  primary key (company_id, item_id)
);
create table node_logic_gate_assignments (
  company_id uuid not null,
  assignment_id uuid not null,
  node_id uuid not null,
  logic_gate_id uuid not null,
  primary key (company_id, assignment_id)
);
create table project_relationships (
  company_id uuid not null,
  relationship_id uuid not null,
  project_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  primary key (company_id, relationship_id)
);
create table email_relationships (
  company_id uuid not null,
  email_relationship_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  primary key (company_id, email_relationship_id)
);
create table node_textbox_chats (
  company_id uuid not null,
  node_id uuid not null,
  chat_id uuid not null,
  primary key (company_id, chat_id)
);
create table attachments (
  company_id uuid not null,
  attachment_id uuid not null,
  primary key (company_id, attachment_id)
);
create table attachment_relationships (
  company_id uuid not null,
  attachment_relationship_id uuid not null,
  resource_type text not null,
  resource_id text not null,
  primary key (company_id, attachment_relationship_id)
);
create table resource_gvic_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  primary key (company_id, resource_type, resource_id, role)
);
create table resource_permissions (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  subject_id uuid not null,
  primary key (company_id, resource_type, resource_id, subject_id)
);

insert into nodes values
  ('11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000001', 'Preserved Node');
insert into projects values
  ('11111111-1111-4111-8111-000000000001', '33333333-3333-4333-8333-000000000001', 'Preserved Project');
insert into logic_gates values
  ('11111111-1111-4111-8111-000000000001', '44444444-4444-4444-8444-000000000001', 'Preserved Logic Gate');
insert into company_explorer_folders values
  ('11111111-1111-4111-8111-000000000001',
   md5('11111111-1111-4111-8111-000000000001:company_explorer_default_folder:unfiled')::uuid,
   null, 'Unfiled'),
  ('11111111-1111-4111-8111-000000000001',
   md5('11111111-1111-4111-8111-000000000001:company_explorer_default_folder:unfiled_nodes')::uuid,
   md5('11111111-1111-4111-8111-000000000001:company_explorer_default_folder:unfiled')::uuid,
   'Nodes');
insert into company_explorer_items values
  ('11111111-1111-4111-8111-000000000001', '55555555-5555-4555-8555-000000000001',
   md5('11111111-1111-4111-8111-000000000001:company_explorer_default_folder:unfiled_nodes')::uuid,
   'node', '22222222-2222-4222-8222-000000000001'),
  ('11111111-1111-4111-8111-000000000001', '55555555-5555-4555-8555-000000000002',
   md5('11111111-1111-4111-8111-000000000001:company_explorer_default_folder:unfiled')::uuid,
   'project', '33333333-3333-4333-8333-000000000001'),
  ('11111111-1111-4111-8111-000000000001', '55555555-5555-4555-8555-000000000003',
   md5('11111111-1111-4111-8111-000000000001:company_explorer_default_folder:unfiled')::uuid,
   'logic_gate', '44444444-4444-4444-8444-000000000001');
insert into node_logic_gate_assignments values
  ('11111111-1111-4111-8111-000000000001', '66666666-6666-4666-8666-000000000001',
   '22222222-2222-4222-8222-000000000001', '44444444-4444-4444-8444-000000000001');
insert into project_relationships values
  ('11111111-1111-4111-8111-000000000001', '77777777-7777-4777-8777-000000000001',
   '33333333-3333-4333-8333-000000000001', 'node', '22222222-2222-4222-8222-000000000001');
insert into email_relationships values
  ('11111111-1111-4111-8111-000000000001', '88888888-8888-4888-8888-000000000001',
   'node', '22222222-2222-4222-8222-000000000001');
insert into node_textbox_chats values
  ('11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000001',
   '88888888-8888-4888-8888-000000000002');
insert into attachments values
  ('11111111-1111-4111-8111-000000000001', '88888888-8888-4888-8888-000000000003');
insert into attachment_relationships values
  ('11111111-1111-4111-8111-000000000001', '88888888-8888-4888-8888-000000000004',
   'node', '22222222-2222-4222-8222-000000000001');
insert into resource_gvic_assignments values
  ('11111111-1111-4111-8111-000000000001', 'node', '22222222-2222-4222-8222-000000000001', 'responsible');
insert into resource_permissions values
  ('11111111-1111-4111-8111-000000000001', 'node', '22222222-2222-4222-8222-000000000001',
   '88888888-8888-4888-8888-000000000005');
`
	if _, err := db.Exec(fixture); err != nil {
		t.Fatalf("seed legacy Node placement fixture: %v", err)
	}
	migrationRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", companyExplorerRemoveNodeItemsMigration))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migrationRaw)); err != nil {
		t.Fatalf("apply Node placement cleanup migration: %v", err)
	}
	for query, want := range map[string]int{
		"select count(*) from nodes":                                                                1,
		"select count(*) from node_logic_gate_assignments":                                          1,
		"select count(*) from project_relationships":                                                1,
		"select count(*) from email_relationships":                                                  1,
		"select count(*) from node_textbox_chats":                                                   1,
		"select count(*) from attachments":                                                          1,
		"select count(*) from attachment_relationships":                                             1,
		"select count(*) from resource_gvic_assignments":                                            1,
		"select count(*) from resource_permissions":                                                 1,
		"select count(*) from company_explorer_items where target_type='node'":                      0,
		"select count(*) from company_explorer_items where target_type in ('project','logic_gate')": 2,
		"select count(*) from company_explorer_folders where folder_id=md5(company_id::text || ':company_explorer_default_folder:unfiled_nodes')::uuid": 0,
	} {
		var got int
		if err := db.QueryRow(query).Scan(&got); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		if got != want {
			t.Fatalf("%s = %d, want %d", query, got, want)
		}
	}
	if _, err := db.Exec(`insert into company_explorer_items values ('11111111-1111-4111-8111-000000000001','99999999-9999-4999-8999-000000000001',null,'node','22222222-2222-4222-8222-000000000001')`); err == nil {
		t.Fatal("restored target_type constraint accepted a Node placement")
	}
	if _, err := db.Exec(string(migrationRaw)); err != nil {
		t.Fatalf("idempotent Node placement cleanup rerun: %v", err)
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
		filepath.Join("..", "..", "db", "migrations", resourcePermissionsIgnoreRACIMigration),
		filepath.Join("..", "..", "db", "migrations", resourcePolicyPointersMigration),
		filepath.Join("..", "..", "db", "migrations", resourcePolicyNoRACIMigration),
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
