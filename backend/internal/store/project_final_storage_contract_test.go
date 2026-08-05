package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readProjectFinalContractFile(t *testing.T, path ...string) string {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(path...))
	if err != nil {
		t.Fatal(err)
	}
	return strings.ToLower(string(body))
}

func TestProjectProductionStorageDoesNotUseLegacyInformationTables(t *testing.T) {
	paths := []string{
		"postgres_projects.go",
		"postgres_project_final_storage.go",
		"postgres_editor_json_metadata.go",
		"postgres_editor_textboxes.go",
		"attachment_relationship_cleanup.go",
		"postgres_recycle_bin.go",
		filepath.Join("..", "..", "cmd", "mango-attachment-migrate", "main.go"),
	}
	for _, path := range paths {
		body := readProjectFinalContractFile(t, path)
		for _, legacy := range []string{"project_information", "project_projection_table"} {
			if strings.Contains(body, legacy) {
				t.Errorf("production path %s still references %s", path, legacy)
			}
		}
	}
}

func TestProjectFinalStorageSchemaAndRuntimeContracts(t *testing.T) {
	schema := readProjectFinalContractFile(t, "..", "..", "db", "schema.sql")
	migration := readProjectFinalContractFile(t, "..", "..", "db", "migrations", "20260804_zzz_project_final_runtime_storage.sql")
	runtime := readProjectFinalContractFile(t, "postgres_project_final_storage.go")
	for _, required := range []string{
		"create table if not exists project_textbox_chats",
		"references project_textboxes(company_id, project_id, textbox_id) on delete cascade",
		"references project_textbox_chats(company_id, project_id, textbox_id, chat_id) on delete cascade",
		"idx_project_textbox_chats_textbox_created",
		"idx_project_textbox_chats_email_selection",
		"metadata_revision bigint not null default 1",
		"email_message_id text not null default ''",
	} {
		if !strings.Contains(schema, required) || !strings.Contains(migration, required) {
			t.Errorf("final schema/migration missing %q", required)
		}
	}
	for _, required := range []string{
		"from project_textboxes textbox",
		"from project_textbox_chats chat",
		"from email_relationships relationship",
		"join email_messages message",
		"join email_threads thread",
		"resource_type='project_chat_message'",
		"relationship.resource_textbox_id=$4",
	} {
		if !strings.Contains(runtime, required) {
			t.Errorf("Project final runtime missing %q", required)
		}
	}
}

func TestProjectMetadataOperatorScriptIsGuardedAndNonDestructive(t *testing.T) {
	script := readProjectFinalContractFile(t, "..", "..", "..", "scripts", "v3_project_final_runtime_metadata_copy_verify.sql")
	for _, required := range []string{
		"server_version_num",
		"postgresql 17.x only",
		"begin;",
		"commit;",
		"copy_complete",
		"rows_needing_review",
		"except",
		"project_projection_table where type::text='text block chat')<>16",
		"project_textbox_chats where deleted_timestamp is null)<>16",
		"project_projection_table where type::text='attached email')<>6",
		"email_relationships where resource_type='project')<>6",
		"legacy/final project chat identity sets differ",
		"legacy/final project email relationship identity sets differ",
	} {
		if !strings.Contains(script, required) {
			t.Errorf("Project operator script missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"drop table",
		"delete from",
		"truncate ",
		"order by ordinal_position",
		"array_agg(attname order by",
		"\\set",
		"\\i ",
		"\\copy",
	} {
		if strings.Contains(script, forbidden) {
			t.Errorf("Project operator script contains forbidden token %q", forbidden)
		}
	}
}
