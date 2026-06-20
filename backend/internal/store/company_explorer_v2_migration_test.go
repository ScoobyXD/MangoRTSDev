package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const companyExplorerFinalCutoverMigration = "20260620_company_explorer_final_cutover.sql"

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
		"constraint company_explorer_items_target_type_chk check (target_type in ('project', 'logic_gate', 'node'))",
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

func TestCompanyExplorerFinalVerificationViewCoversCutoverInvariants(t *testing.T) {
	for _, path := range []string{
		filepath.Join("..", "..", "db", "schema.sql"),
		filepath.Join("..", "..", "db", "migrations", companyExplorerFinalCutoverMigration),
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

func normalizeSQLForCompanyExplorerV2Test(sql string) string {
	return strings.ToLower(strings.Join(strings.Fields(sql), " "))
}
