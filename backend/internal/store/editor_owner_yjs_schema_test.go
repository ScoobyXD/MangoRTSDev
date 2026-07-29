package store

import (
	"os"
	"strings"
	"testing"
)

func readEditorSchemaFile(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return strings.ToLower(strings.ReplaceAll(string(body), "\r\n", "\n"))
}

func TestRetiredYJSStorageHasForwardCleanup(t *testing.T) {
	sqlText := readEditorSchemaFile(t, "../../db/migrations/20260728_zz_retire_yjs_storage.sql")
	for _, required := range []string{
		"drop table if exists editor_owner_yjs_updates",
		"drop table if exists editor_owner_yjs_checkpoints",
		"drop table if exists node_textbox_yjs_updates",
		"drop table if exists node_textbox_yjs_checkpoints",
		"drop function if exists mangorts_cleanup_node_v2_yjs_retention(integer)",
		"drop column if exists collaboration_epoch",
		"drop column if exists latest_update_sequence",
		"drop column if exists materialized_through_sequence",
	} {
		if !strings.Contains(sqlText, required) {
			t.Errorf("Yjs retirement migration missing %q", required)
		}
	}

	canonical := readEditorSchemaFile(t, "../../db/schema.sql")
	for _, forbidden := range []string{
		"create table if not exists editor_owner_yjs_updates",
		"create table if not exists editor_owner_yjs_checkpoints",
		"create table if not exists node_textbox_yjs_updates",
		"create table if not exists node_textbox_yjs_checkpoints",
		"create or replace function mangorts_cleanup_node_v2_yjs_retention",
		"create table if not exists node_verification_content_pins",
		"create table if not exists node_verification_update_pins",
		"collaboration_epoch uuid not null",
		"latest_update_sequence bigint not null",
		"materialized_through_sequence bigint not null",
		"yjs",
	} {
		if strings.Contains(canonical, forbidden) {
			t.Errorf("canonical schema still contains retired Yjs storage %q", forbidden)
		}
	}
}
