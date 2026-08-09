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

func TestFinalEmailRelationshipShapeSupersedesPriorityMigrationGuard(t *testing.T) {
	schemaRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	migrationRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260808_node_priority_not_assigned.sql"))
	if err != nil {
		t.Fatal(err)
	}
	finalMigrationRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260809_zzz_email_sqs_delivery.sql"))
	if err != nil {
		t.Fatal(err)
	}

	schema := strings.ToLower(string(schemaRaw))
	priorityMigration := strings.ToLower(string(migrationRaw))
	finalMigration := strings.ToLower(string(finalMigrationRaw))
	if !strings.Contains(priorityMigration, "create trigger trg_email_relationships_one_node_per_thread") {
		t.Fatal("priority migration no longer documents the legacy guard that the final migration must remove")
	}
	for _, required := range []string{
		"drop trigger if exists trg_email_relationships_one_node_per_thread on email_relationships",
		"drop function if exists mangorts_enforce_one_node_per_email_thread()",
		"create unique index idx_email_relationships_one_node_textbox_per_message",
	} {
		if !strings.Contains(finalMigration, required) {
			t.Errorf("final migration is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"mangorts_enforce_one_node_per_email_thread",
		"email_thread_already_linked_to_another_node",
		"trg_email_relationships_one_node_per_thread",
	} {
		if strings.Contains(schema, forbidden) {
			t.Errorf("canonical schema retains obsolete one-thread/one-Node guard %q", forbidden)
		}
	}
	if !strings.Contains(schema, "idx_email_relationships_one_node_textbox_per_message") {
		t.Fatal("canonical schema is missing the one-textbox-per-message-per-Node unique index")
	}
}
