package store

import (
	"os"
	"strings"
	"testing"
)

const (
	editorOwnerYJSBegin = "-- EDITOR_OWNER_YJS_DELTAS_BEGIN"
	editorOwnerYJSEnd   = "-- EDITOR_OWNER_YJS_DELTAS_END"
)

func editorOwnerYJSBlock(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	text := strings.ReplaceAll(string(body), "\r\n", "\n")
	start := strings.Index(text, editorOwnerYJSBegin)
	end := strings.Index(text, editorOwnerYJSEnd)
	if start < 0 || end < start {
		t.Fatalf("%s is missing editor owner Yjs markers", path)
	}
	return strings.TrimSpace(text[start : end+len(editorOwnerYJSEnd)])
}

func TestEditorOwnerYJSMigrationMatchesCanonicalSchema(t *testing.T) {
	migration := editorOwnerYJSBlock(t, "../../db/migrations/20260728_editor_owner_yjs_deltas.sql")
	canonical := editorOwnerYJSBlock(t, "../../db/schema.sql")
	if migration != canonical {
		t.Fatal("editor owner Yjs migration and canonical schema blocks differ")
	}
}

func TestEditorOwnerYJSSchemaStoresDeltasAndEpochs(t *testing.T) {
	sqlText := strings.ToLower(editorOwnerYJSBlock(t, "../../db/migrations/20260728_editor_owner_yjs_deltas.sql"))
	for _, required := range []string{
		"collaboration_epoch uuid not null",
		"latest_update_sequence bigint not null",
		"materialized_through_sequence bigint not null",
		"create table if not exists editor_owner_yjs_updates",
		"update_payload bytea not null",
		"create table if not exists editor_owner_yjs_checkpoints",
		"checkpoint_payload bytea not null",
		"unique (company_id, owner_type, owner_id, document_id, collaboration_epoch, update_sha256)",
	} {
		if !strings.Contains(sqlText, required) {
			t.Errorf("editor owner Yjs schema missing %q", required)
		}
	}
	if strings.Contains(sqlText, "document_json jsonb not null,\n  created_timestamp") {
		t.Fatal("ordinary update rows must not store full document JSON")
	}
}
