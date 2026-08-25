package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNodePriorityNotAssignedMigrationReconcilesEmailRelationshipsSafely(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260808_node_priority_not_assigned.sql"))
	if err != nil {
		t.Fatal(err)
	}
	migration := strings.ToLower(strings.ReplaceAll(string(raw), "\r\n", "\n"))

	for _, required := range []string{
		"begin;",
		"commit;",
		"set local lock_timeout = '5s'",
		"postgresql_server_version_num",
		"not between 170000 and 189999",
		"lock table email_relationships in share row exclusive mode",
		"cardinality(actual_columns)<>8",
		"not actual_columns @> array[",
		"cardinality(actual_columns)<>9",
		"duplicate_email_semantic_edge",
		"email_message_linked_to_multiple_textboxes_in_one_node",
		"email_message_chat_textbox_repair_requires_review",
		"email_message_chat_textbox_repair_failed",
		"email_chat_missing_message_textbox_or_node_relationship",
		"email_chat_conflicts_with_existing_textbox_relationship",
		"insert into email_relationships(",
		"min(chat.created_timestamp)",
		"chat.textbox_id::text",
		"email_chat_missing_exact_textbox_relationship",
		"drop trigger if exists trg_node_logic_gate_assignment_priority",
		"drop trigger if exists trg_email_relationships_one_node_per_thread",
		"idx_email_relationships_active_identity",
		"idx_email_relationships_one_node_textbox_per_message",
		"mangorts_validate_node_email_chat_relationship",
		"mangorts_protect_node_email_chat_relationship",
		"idx_email_drafts_active_thread",
		"node_priority_not_assigned_complete",
	} {
		if !strings.Contains(migration, required) {
			t.Errorf("priority migration is missing %q", required)
		}
	}

	for _, forbidden := range []string{
		"delete from nodes",
		"delete from node_textboxes",
		"delete from node_textbox_chats",
		"delete from email_threads",
		"delete from email_messages",
		"email_thread_already_linked_to_multiple_nodes",
		"email_thread_already_linked_to_another_node",
	} {
		if strings.Contains(migration, forbidden) {
			t.Errorf("priority migration must not contain %q", forbidden)
		}
	}

	if !strings.HasPrefix(strings.TrimSpace(migration), "begin;\n") || strings.Count(migration, "\ncommit;\n") != 1 {
		t.Fatal("priority migration must use one complete transaction")
	}
}

func TestCorrectedPriorityAndSQSMigrationsShareTheFinalEmailRelationshipGuard(t *testing.T) {
	schemaRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	migrationRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260808_node_priority_not_assigned.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sqsMigrationRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260809_zzzz_email_sqs_delivery_finalize.sql"))
	if err != nil {
		t.Fatal(err)
	}

	for name, body := range map[string]string{
		"priority migration": strings.ToLower(string(migrationRaw)),
	} {
		for _, required := range []string{
			"idx_email_relationships_active_identity",
			"idx_email_relationships_one_node_textbox_per_message",
			"mangorts_validate_node_email_chat_relationship",
			"relationship.resource_id=new.node_id",
			"relationship.resource_textbox_id=new.textbox_id::text",
			"mangorts_protect_node_email_chat_relationship",
			"update of company_id,email_message_id,resource_type,resource_id,resource_textbox_id",
		} {
			if !strings.Contains(body, required) {
				t.Errorf("%s is missing %q", name, required)
			}
		}
		for _, forbidden := range []string{
			"email_thread_already_linked_to_another_node",
			"create trigger trg_email_relationships_one_node_per_thread",
		} {
			if strings.Contains(body, forbidden) {
				t.Errorf("%s retains obsolete one-Node rule %q", name, forbidden)
			}
		}
		if name == "canonical schema" && strings.Contains(body, "mangorts_enforce_one_node_per_email_thread") {
			t.Errorf("%s retains obsolete one-Node enforcement function", name)
		}
	}
	canonical := normalizeCanonicalSchemaContract(string(schemaRaw))
	for _, required := range []string{
		"idx_email_relationships_active_identity",
		"idx_email_relationships_one_textbox_per_message_owner",
		"mangorts_validate_node_email_chat_relationship",
		"relationship.resource_id=new.node_id",
		"relationship.resource_textbox_id=new.textbox_id::text",
		"mangorts_protect_email_relationship_dependencies",
		"update of company_id, email_thread_id, email_message_id, resource_type, resource_id, resource_textbox_id",
	} {
		if !strings.Contains(canonical, required) {
			t.Errorf("canonical schema is missing %q", required)
		}
	}
	sqsMigration := strings.ToLower(string(sqsMigrationRaw))
	for _, required := range []string{
		"drop trigger if exists trg_email_relationships_one_node_per_thread on email_relationships",
		"drop function if exists mangorts_enforce_one_node_per_email_thread()",
		"create unique index idx_email_relationships_one_node_textbox_per_message",
	} {
		if !strings.Contains(sqsMigration, required) {
			t.Errorf("SQS migration is missing compatible final relationship guard %q", required)
		}
	}
}
