package store

import (
	"os"
	"strings"
	"testing"
)

func TestRealtimeCleanupCanonicalSchemaAndForwardMigration(t *testing.T) {
	schemaBytes, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("ReadFile schema.sql: %v", err)
	}
	schema := strings.ToLower(string(schemaBytes))
	for _, forbidden := range []string{
		"create table if not exists event_rows",
		"notification_domain_event_projection_checkpoints",
		"company_projection_sequences",
		"mangorts_trg_bump_logic_gate_work_from_projection_sequence",
	} {
		if strings.Contains(schema, forbidden) {
			t.Fatalf("canonical schema retains removed realtime storage %q", forbidden)
		}
	}
	for _, required := range []string{
		"create table if not exists realtime_outbox",
		"idx_realtime_outbox_claim",
		"idx_realtime_outbox_published_sequence",
		"drop index if exists idx_logic_gate_projection_table_one_text_box",
	} {
		if !strings.Contains(schema, required) {
			t.Fatalf("canonical schema missing unified realtime storage %q", required)
		}
	}

	migrationBytes, err := os.ReadFile("../../db/migrations/20260712_realtime_simplification.sql")
	if err != nil {
		t.Fatalf("ReadFile realtime simplification migration: %v", err)
	}
	migration := strings.ToLower(string(migrationBytes))
	for _, required := range []string{
		"drop table if exists event_rows",
		"drop table if exists notification_domain_event_projection_checkpoints",
		"drop index if exists idx_domain_events_pending",
		"drop column if exists published_timestamp",
		"drop table if exists company_projection_sequences",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("realtime simplification migration missing %q", required)
		}
	}

	unifiedBytes, err := os.ReadFile("../../db/migrations/20260715_unified_realtime_collaboration.sql")
	if err != nil {
		t.Fatalf("ReadFile unified realtime migration: %v", err)
	}
	unified := strings.ToLower(string(unifiedBytes))
	for _, required := range []string{
		"create table if not exists realtime_outbox",
		"create table if not exists editor_collaboration_documents",
		"create table if not exists editor_collaboration_operations",
		"idx_realtime_outbox_claim",
	} {
		if !strings.Contains(unified, required) {
			t.Fatalf("unified realtime migration missing %q", required)
		}
	}
}

func TestRealtimeCleanupStoreSourceHasNoObsoleteEventQueue(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("ReadDir store: %v", err)
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		sourceBytes, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", name, err)
		}
		source := strings.ToLower(string(sourceBytes))
		for _, forbidden := range []string{
			"appendeventrows",
			"eventrowinput",
			"projectiondeltaeventinputs",
			"permissionchangedeventinput",
			"projectiondelta",
		} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s retains removed event queue source %q", name, forbidden)
			}
		}
	}
}
