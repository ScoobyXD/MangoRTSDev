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
		"postgres_project_email_relationships.go",
		"postgres_project_textbox_chats.go",
		"postgres_editor_json_metadata.go",
		"postgres_editor_textboxes.go",
		"attachment_relationship_cleanup.go",
		"postgres_recycle_bin.go",
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
	schema := normalizeCanonicalSchemaContract(readProjectFinalContractFile(t, "..", "..", "db", "schema.sql"))
	migration := readProjectFinalContractFile(t, "..", "..", "db", "migrations", "20260818_project_email_textbox_parity.sql")
	runtime := readProjectFinalContractFile(t, "postgres_project_final_storage.go") +
		readProjectFinalContractFile(t, "postgres_project_email_relationships.go") +
		readProjectFinalContractFile(t, "postgres_project_textbox_chats.go") +
		readProjectFinalContractFile(t, "postgres_email_relationship_locks.go")
	for _, required := range []string{
		"create table if not exists project_textbox_chats",
		"references project_textboxes(company_id, project_id, textbox_id) on delete cascade",
		"references project_textbox_chats(company_id, project_id, textbox_id, chat_id) on delete cascade",
		"idx_project_textbox_chats_textbox_created",
		"idx_project_textbox_chats_email_selection",
		"metadata_revision bigint default 1 not null",
		"constraint project_textboxes_color_chk",
		"constraint='email_relationship_project_document_forbidden'",
		"constraint='project_document_chat_forbidden'",
		"constraint='email_chat_requires_exact_textbox_relationship'",
		"trg_validate_email_textbox_relationship_has_wide_owner",
		"trg_protect_email_relationship_dependencies",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("final schema missing %q", required)
		}
	}
	legacyConversionStart := strings.Index(migration, "-- convert the retired project textbox identity copy")
	chatConversionStart := strings.Index(migration, "-- an existing project email chat is itself an exact textbox claim")
	if legacyConversionStart < 0 || chatConversionStart <= legacyConversionStart {
		t.Fatal("could not isolate legacy Project textbox relationship conversion")
	}
	legacyConversion := migration[legacyConversionStart:chatConversionStart]
	if strings.Count(legacyConversion, "textbox.deleted_timestamp is null") != 2 {
		t.Fatal("both legacy Project wide and exact relationship conversions must exclude deleted textboxes")
	}
	for _, required := range []string{
		"begin;",
		"lock table project_textboxes,project_textbox_chats,email_relationships",
		"node_textboxes,node_textbox_chats",
		"drop column if exists email_message_id",
		"drop column if exists email_accent",
		"constraint project_textboxes_color_chk",
		"idx_email_relationships_one_textbox_per_message_owner",
		"pg_input_is_valid(btrim(textbox.email_message_id),'uuid')",
		"deleted project textboxes retain legacy email identity",
		"email relationship targets a missing or deleted owner textbox",
		"active email chat targets a missing or deleted owner textbox",
		"existing email relationships conflict with one-message-per-owner cardinality",
		"node email chat is missing its exact message textbox relationship",
		"where textbox.deleted_timestamp is null",
		"project email work conflicts with one-message-per-owner cardinality",
		"project email chat does not reference an internal message identity",
		"resource_type in ('node','project')",
		"trg_validate_email_relationship_resource",
		"trg_validate_node_email_chat_relationship",
		"trg_validate_email_textbox_relationship_has_wide_owner",
		"mangorts_validate_project_email_chat_relationship",
		"mangorts_protect_email_relationship_dependencies",
		"after delete or update of company_id,email_thread_id,email_message_id",
		"commit;",
	} {
		if !strings.Contains(migration, required) {
			t.Errorf("final migration missing %q", required)
		}
	}
	for _, required := range []string{
		"from project_textboxes textbox",
		"from project_textbox_chats chat",
		"from email_relationships relationship",
		"join email_messages message",
		"join email_threads thread",
		"resource_type='project_chat_message'",
		"resource_textbox_id=$4",
		"'email_message_ids'",
		"'color'",
	} {
		if !strings.Contains(runtime, required) {
			t.Errorf("Project final runtime missing %q", required)
		}
	}
	projectTextboxSchema := sqlBlockAfter(t, schema, "create table if not exists project_textboxes (")
	for _, obsolete := range []string{
		"email_message_id text not null default ''",
		"email_accent text not null default ''",
	} {
		if strings.Contains(projectTextboxSchema, obsolete) {
			t.Errorf("final schema retains obsolete Project textbox field %q", obsolete)
		}
	}
}

func TestEmailTextboxDependenciesLockTheirPrerequisiteRelationships(t *testing.T) {
	lockRuntime := readProjectFinalContractFile(t, "postgres_email_relationship_locks.go")
	projectEmailRuntime := readProjectFinalContractFile(t, "postgres_project_email_relationships.go")
	projectChatRuntime := readProjectFinalContractFile(t, "postgres_project_textbox_chats.go")
	nodeEmailRuntime := readProjectFinalContractFile(t, "postgres_node_final_storage.go")
	nodeChatRuntime := readProjectFinalContractFile(t, "postgres_node_textbox_chats.go")
	schema := normalizeCanonicalSchemaContract(readProjectFinalContractFile(t, "..", "..", "db", "schema.sql"))
	migration := readProjectFinalContractFile(t, "..", "..", "db", "migrations", "20260818_project_email_textbox_parity.sql")

	for label, source := range map[string]string{
		"Project exact relationship": projectEmailRuntime,
		"Node exact relationship":    nodeEmailRuntime,
	} {
		if !strings.Contains(source, "lockpostgreswideemailownerthreadrelationshiptx") {
			t.Errorf("%s does not lock its wide prerequisite", label)
		}
	}
	for label, source := range map[string]string{
		"Project email chat": projectChatRuntime,
		"Node email chat":    nodeChatRuntime,
	} {
		if !strings.Contains(source, "lockpostgresexactemailtextboxrelationshiptx") {
			t.Errorf("%s does not lock its exact prerequisite", label)
		}
	}
	if strings.Count(lockRuntime, "for share") != 2 {
		t.Fatal("shared Postgres prerequisite helpers must lock both wide and exact relationships")
	}
	for label, source := range map[string]string{"canonical schema": schema, "forward migration": migration} {
		if strings.Count(source, "for share") < 3 {
			t.Errorf("%s must serialize the wide-owner and both email-chat dependency triggers", label)
		}
	}
}

func TestProjectRecycleRestoreInstallsDependenciesBeforeChatsAndReconcilesColor(t *testing.T) {
	recycle := readProjectFinalContractFile(t, "postgres_recycle_bin.go")
	orderStart := strings.Index(recycle, "var recyclerestoretableorder")
	reconcileStart := strings.Index(recycle, "func reconcilerestoredprojecttextboxcolorstx")
	if orderStart < 0 || reconcileStart <= orderStart {
		t.Fatal("could not isolate recycle restore dependency order")
	}
	order := recycle[orderStart:reconcileStart]
	emailRelationships := strings.Index(order, `"email_relationships",`)
	projectChats := strings.Index(order, `"project_textbox_chats",`)
	if emailRelationships < 0 || projectChats < 0 || emailRelationships > projectChats {
		t.Fatal("Project recycle restore must install email relationships before Project chats")
	}
	for _, required := range []string{
		"reconcilerestoredprojecttextboxcolorstx",
		"then coalesce(textbox.color,'#0ea5e9') else null end",
		"relationship.resource_textbox_id=textbox.textbox_id",
		`if tablename == "email_relationships"`,
		"from restored exact",
		"exact.resource_type in ('node','project')",
	} {
		if !strings.Contains(recycle, required) {
			t.Errorf("Project recycle restore missing %q", required)
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
