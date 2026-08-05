package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLogicGateProductionStorageHasNoLegacyTableSQL(t *testing.T) {
	paths := []string{
		"postgres.go",
		"postgres_logic_gates.go",
		"postgres_logic_gate_final_storage.go",
		"postgres_editor_json_metadata.go",
		"postgres_editor_projection_revisions.go",
		"postgres_editor_save_versions.go",
		"postgres_company_explorer.go",
		"postgres_recycle_bin.go",
		"attachment_relationship_cleanup.go",
		"../http/logic_gate_handlers.go",
		"../../cmd/mango-attachment-migrate/main.go",
	}
	for _, path := range paths {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		lower := strings.ToLower(string(body))
		for _, legacy := range []string{"logic_gate_information", "logic_gate_projection_table"} {
			for _, sqlPrefix := range []string{"from ", "into ", "update ", "delete from ", "join "} {
				if strings.Contains(lower, sqlPrefix+legacy) {
					t.Errorf("%s still contains production legacy SQL %q", path, sqlPrefix+legacy)
				}
			}
		}
	}
}

func TestLogicGateReadinessUsesFinalStorage(t *testing.T) {
	for _, path := range []string{"../../../scripts/check_db_ready.ps1", "../../../scripts/check_db_ready.sh"} {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		lower := strings.ToLower(string(body))
		if strings.Contains(lower, "logic_gate_projection_table") || strings.Contains(lower, "logic_gate_information") {
			t.Errorf("%s still requires legacy Logic Gate storage", path)
		}
		for _, required := range []string{"logic_gate_textboxes", "logic_gate_textboxes_history"} {
			if !strings.Contains(lower, required) {
				t.Errorf("%s does not require final Logic Gate table %s", path, required)
			}
		}
	}
}

func TestLogicGateFinalSchemaMigrationAndOperatorSafety(t *testing.T) {
	schemaBytes, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := strings.ToLower(string(schemaBytes))
	for _, legacy := range []string{"logic_gate_information", "logic_gate_projection_table", "logic_gate_textbox_chats"} {
		if strings.Contains(schema, "create table if not exists "+legacy) {
			t.Errorf("canonical schema creates retired or unsupported table %s", legacy)
		}
	}
	for _, required := range []string{
		"create table if not exists logic_gate_textboxes",
		"title text not null default ''",
		"email_message_id text not null default ''",
		"email_accent text not null default ''",
		"metadata_revision bigint not null default 1",
		"create table if not exists logic_gate_textboxes_history",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("canonical schema missing Logic Gate final storage %q", required)
		}
	}

	migrationBytes, err := os.ReadFile("../../db/migrations/20260805_logic_gate_final_runtime_storage.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration := strings.ToLower(string(migrationBytes))
	for _, required := range []string{
		"alter table logic_gate_textboxes",
		"add column if not exists title",
		"add column if not exists metadata_revision",
		"server_version_num",
	} {
		if !strings.Contains(migration, required) {
			t.Errorf("additive migration missing %q", required)
		}
	}

	preflightBytes, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "v3_logic_gate_final_runtime_preflight.sql"))
	if err != nil {
		t.Fatal(err)
	}
	preflight := strings.ToLower(string(preflightBytes))
	if strings.Contains(preflight, "ordinal_position") {
		t.Error("Logic Gate preflight must not depend on physical column order")
	}
	for _, required := range []string{
		"repeatable read read only", "server_version", "except",
		"stop_and_review", "ready_for_logic_gate_schema_and_copy",
		"active_unsupported_projection_type", "manual_save_missing_final_history",
	} {
		if !strings.Contains(preflight, required) {
			t.Errorf("Logic Gate preflight missing %q", required)
		}
	}

	retirementBytes, err := os.ReadFile("../../db/operator_migrations/20260805_retire_logic_gate_legacy_storage.sql")
	if err != nil {
		t.Fatal(err)
	}
	retirement := strings.ToLower(string(retirementBytes))
	for _, required := range []string{
		"copy_verified", "no_current_writer_verified", "smoke_and_recycle_verified",
		"soak_and_snapshot_confirmed", "operator_approved",
		"drop table logic_gate_information;", "drop table logic_gate_projection_table;",
	} {
		if !strings.Contains(retirement, required) {
			t.Errorf("Logic Gate operator retirement missing %q", required)
		}
	}
	if strings.Contains(retirement, "drop table if exists") || strings.Contains(retirement, "drop table logic_gate_information cascade") || strings.Contains(retirement, "drop table logic_gate_projection_table cascade") {
		t.Error("Logic Gate retirement must expose drift and refuse surviving dependencies")
	}
}
