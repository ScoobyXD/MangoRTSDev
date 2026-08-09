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
		"mangorts_email_thread_canonical_nodes",
		"row_number() over",
		"order by destination.first_created_timestamp",
		"delete from email_relationships relationship",
		"relationship.resource_id<>canonical.node_id",
		"email_chat_linked_to_later_node_requires_review",
		"mangorts_email_message_preferred_textboxes",
		"email_message_chat_linked_to_multiple_textboxes",
		"insert into email_relationships(",
		"chat.textbox_id::text",
		"email_chat_missing_exact_textbox_relationship",
		"email_message_already_linked_to_another_textbox",
		"drop trigger if exists trg_node_logic_gate_assignment_priority",
		"create trigger trg_email_relationships_one_node_per_thread",
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
	} {
		if strings.Contains(migration, forbidden) {
			t.Errorf("priority migration must not contain %q", forbidden)
		}
	}

	if !strings.HasPrefix(strings.TrimSpace(migration), "begin;\n") || strings.Count(migration, "\ncommit;\n") != 1 {
		t.Fatal("priority migration must use one complete transaction")
	}
	if strings.Index(migration, "row_number() over") > strings.Index(migration, "delete from email_relationships relationship") {
		t.Fatal("priority migration must choose the earliest Node before deleting later relationships")
	}
}

func TestCanonicalEmailRelationshipGuardMatchesPriorityMigration(t *testing.T) {
	schemaRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	migrationRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260808_node_priority_not_assigned.sql"))
	if err != nil {
		t.Fatal(err)
	}

	for name, body := range map[string]string{
		"canonical schema":   strings.ToLower(string(schemaRaw)),
		"priority migration": strings.ToLower(string(migrationRaw)),
	} {
		for _, required := range []string{
			"mangorts_enforce_one_node_per_email_thread",
			"email_thread_already_linked_to_another_node",
			"email_message_already_linked_to_another_textbox",
			"relationship.email_message_id=new.email_message_id",
			"relationship.resource_textbox_id<>new.resource_textbox_id",
			"update of company_id,email_thread_id,email_message_id,resource_type,resource_id,resource_textbox_id",
		} {
			if !strings.Contains(body, required) {
				t.Errorf("%s is missing %q", name, required)
			}
		}
	}
}
