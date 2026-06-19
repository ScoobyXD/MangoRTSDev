package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNotificationsSchemaRemovesLegacySourceAnchor(t *testing.T) {
	legacyTable := "notification_" + "events"
	legacyIndexPrefix := "idx_notification_" + "events"

	schemaPath := filepath.Join("..", "..", "db", "schema.sql")
	schemaRaw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	schema := strings.ToLower(strings.Join(strings.Fields(string(schemaRaw)), " "))
	for _, forbidden := range []string{
		"create table if not exists " + legacyTable,
		"references " + legacyTable,
		"foreign key (source_event_id)",
	} {
		if strings.Contains(schema, forbidden) {
			t.Fatalf("canonical notifications schema still contains %q", forbidden)
		}
	}
	for _, required := range []string{
		"source_event_id uuid not null",
		"create unique index if not exists idx_notifications_dedupe on notifications(recipient_user_id, source_event_id, notification_type, entity_type, entity_id)",
		"create index if not exists idx_notifications_source_event_id on notifications(source_event_id)",
		"comment on column notifications.source_event_id",
	} {
		if !strings.Contains(schema, required) {
			t.Fatalf("canonical notifications schema missing %q", required)
		}
	}

	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260523_remove_notification_source_anchor.sql")
	migrationRaw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("ReadFile removal migration: %v", err)
	}
	migration := strings.ToLower(strings.Join(strings.Fields(string(migrationRaw)), " "))
	for _, required := range []string{
		"alter table public.notifications drop constraint",
		"create index if not exists idx_notifications_source_event_id on notifications(source_event_id)",
		"drop index if exists " + legacyIndexPrefix + "_pending",
		"drop index if exists " + legacyIndexPrefix + "_idempotency_key",
		"drop index if exists " + legacyIndexPrefix + "_company_created",
		"drop table if exists " + legacyTable,
		"not foreign-key constrained",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("source-anchor removal migration missing %q", required)
		}
	}
	if strings.Contains(migration, "references domain_events") {
		t.Fatal("source_event_id should not add a hard domain_events foreign key without a proven backfill")
	}
}

func TestSchemaDropsDerivedResourceGrantCompatibilityTriggers(t *testing.T) {
	schemaPath := filepath.Join("..", "..", "db", "schema.sql")
	schemaRaw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	schema := strings.ToLower(strings.Join(strings.Fields(string(schemaRaw)), " "))
	for _, forbidden := range []string{
		"trg_grant_node_assignee_edit_access",
		"trg_grant_logic_gate_GVIC_edit_access",
		"mangorts_grant_resource_access_at_least",
	} {
		if strings.Contains(schema, forbidden) {
			t.Fatalf("canonical schema still contains derived grant compatibility behavior %q", forbidden)
		}
	}

	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260523_drop_logic_gate_raci_access_trigger.sql")
	migrationRaw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("ReadFile derived grant cleanup migration: %v", err)
	}
	migration := strings.ToLower(strings.Join(strings.Fields(string(migrationRaw)), " "))
	for _, required := range []string{
		"drop trigger if exists trg_grant_node_assignee_edit_access on nodes",
		"drop trigger if exists trg_grant_logic_gate_raci_edit_access on logic_gate_raci_assignments",
		"drop function if exists trg_grant_node_assignee_edit_access()",
		"drop function if exists trg_grant_logic_gate_raci_edit_access()",
		"drop function if exists mangorts_grant_resource_access_at_least(uuid, text, uuid, text, uuid, text)",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("derived grant cleanup migration missing %q", required)
		}
	}
}
