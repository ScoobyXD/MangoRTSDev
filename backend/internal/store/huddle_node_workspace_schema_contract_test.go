package store

import (
	"os"
	"strings"
	"testing"
)

func normalizeHuddleNodeWorkspaceSQL(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	normalized = strings.ReplaceAll(normalized, "public.", "")
	return strings.ReplaceAll(normalized, ", ", ",")
}

func huddleNodeWorkspaceSQLTable(t *testing.T, path, normalized, tableName string) string {
	t.Helper()
	marker := "create table " + tableName + " ("
	start := strings.Index(normalized, marker)
	if start < 0 {
		t.Fatalf("%s is missing %s", path, marker)
	}
	definition := normalized[start:]
	end := strings.Index(definition, ");")
	if end < 0 {
		t.Fatalf("%s has an incomplete %s definition", path, tableName)
	}
	return definition[:end]
}

func requireHuddleNodeWorkspaceSQLFragments(t *testing.T, path, normalized string, fragments ...string) {
	t.Helper()
	for _, fragment := range fragments {
		if !strings.Contains(normalized, fragment) {
			t.Errorf("%s is missing SQL contract fragment %q", path, fragment)
		}
	}
}

func huddleNodeWorkspaceSQLWindow(t *testing.T, path, normalized, marker string) string {
	t.Helper()
	start := strings.Index(normalized, marker)
	if start < 0 {
		t.Fatalf("%s is missing SQL marker %q", path, marker)
	}
	end := start + 1000
	if end > len(normalized) {
		end = len(normalized)
	}
	return normalized[start:end]
}

func TestHuddleNodeWorkspaceSchemaAndMigrationContract(t *testing.T) {
	paths := []string{
		"../../db/migrations/20260828_huddle_node_workspace.sql",
		"../../db/schema.sql",
	}
	for _, path := range paths {
		normalized := normalizeHuddleNodeWorkspaceSQL(t, path)
		textboxes := huddleNodeWorkspaceSQLTable(t, path, normalized, "huddle_node_textboxes")
		chats := huddleNodeWorkspaceSQLTable(t, path, normalized, "huddle_node_textbox_chats")
		attachmentRelationships := huddleNodeWorkspaceSQLWindow(t, path, normalized, "attachment_relationships_type_chk")
		attachmentUploadJobs := huddleNodeWorkspaceSQLWindow(t, path, normalized, "attachment_upload_jobs_resource_type_chk")

		requireHuddleNodeWorkspaceSQLFragments(t, path, textboxes,
			"company_id uuid not null",
			"huddle_node_id uuid not null",
			"textbox_id uuid not null",
			"body_json jsonb not null",
			"revision bigint",
			"deleted_timestamp",
			"display_order bigint",
			"title text",
		)
		requireHuddleNodeWorkspaceSQLFragments(t, path, chats,
			"company_id uuid not null",
			"chat_id uuid not null",
			"huddle_node_id uuid not null",
			"textbox_id uuid not null",
			"parent_chat_id uuid",
			"author_user_id uuid",
			"message text",
			"entity_links jsonb",
			"mentioned_user_ids uuid[]",
			"mentioned_group_ids uuid[]",
			"revision bigint",
			"deleted_timestamp",
		)
		requireHuddleNodeWorkspaceSQLFragments(t, path, normalized,
			"constraint huddle_node_textboxes_owner_fkey foreign key (company_id,huddle_node_id) references huddle_nodes(company_id,huddle_node_id) on delete cascade",
			"constraint huddle_node_textbox_chats_textbox_fkey foreign key (company_id,huddle_node_id,textbox_id) references huddle_node_textboxes(company_id,huddle_node_id,textbox_id) on delete cascade",
			"constraint huddle_node_textbox_chats_parent_fkey foreign key (company_id,huddle_node_id,textbox_id,parent_chat_id) references huddle_node_textbox_chats(company_id,huddle_node_id,textbox_id,chat_id) on delete cascade",
			"huddle_node_textboxes_live_order_idx",
			"huddle_node_textbox_chats_live_idx",
			"huddle_node_textbox_chats_parent_identity_idx",
			"elsif new.resource_type='huddle_node' then",
			"not exists(select 1 from huddle_nodes where company_id=new.company_id and huddle_node_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end)",
			"raise exception 'attachment huddle node owner does not exist' using errcode='23503'",
		)
		if !strings.Contains(attachmentRelationships, "'huddle_node'") {
			t.Errorf("%s attachment_relationships does not allow huddle_node", path)
		}
		if !strings.Contains(attachmentUploadJobs, "'huddle_node'") {
			t.Errorf("%s attachment_upload_jobs does not allow huddle_node", path)
		}
	}

	schemaPath := "../../db/schema.sql"
	schema := normalizeHuddleNodeWorkspaceSQL(t, schemaPath)
	requireHuddleNodeWorkspaceSQLFragments(t, schemaPath, schema,
		"create trigger trg_attachment_relationships_validate_live_owner before insert or update of company_id,attachment_id,resource_type,resource_id,deleted_timestamp on attachment_relationships for each row execute function mangorts_validate_attachment_relationship_owner()",
	)
}
