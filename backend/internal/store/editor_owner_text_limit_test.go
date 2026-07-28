package store

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestEditorOwnerTextLimitArithmeticAndMessage(t *testing.T) {
	if EditorOwnerTextMaxBytes != 1<<30 {
		t.Fatalf("EditorOwnerTextMaxBytes=%d", EditorOwnerTextMaxBytes)
	}
	if EditorOwnerTextLimitExceeded(EditorOwnerTextMaxBytes-1, 1) {
		t.Fatal("exactly one GiB must be accepted")
	}
	if !EditorOwnerTextLimitExceeded(EditorOwnerTextMaxBytes-1, 2) {
		t.Fatal("one byte beyond one GiB must be rejected")
	}
	if !EditorOwnerTextLimitExceeded(0, EditorOwnerTextMaxBytes+1) {
		t.Fatal("one oversized document must be rejected")
	}
	for _, required := range []string{"1 GB", "text", "text-box", "Attachments", "do not count"} {
		if !strings.Contains(EditorOwnerTextLimitMessage, required) {
			t.Errorf("limit message missing %q", required)
		}
	}
	if mapped := mapEditorOwnerTextLimitError(errors.New("ERROR: editor_owner_text_limit_exceeded (SQLSTATE P0001)")); !errors.Is(mapped, ErrEditorOwnerTextLimit) {
		t.Fatalf("mapped error=%v", mapped)
	}
}

func TestEditorOwnerTextLimitDatabaseContract(t *testing.T) {
	paths := []string{
		"../../db/schema.sql",
		"../../db/migrations/20260727_zzzz_editor_owner_text_limit.sql",
	}
	for _, path := range paths {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		text := strings.ToLower(string(body))
		for _, required := range []string{
			"1073741824",
			"editor_owner_text_limit_exceeded",
			"trg_generic_editor_owner_text_limit",
			"trg_node_editor_text_limit",
			"trg_project_editor_text_limit",
			"trg_logic_gate_editor_text_limit",
			"octet_length(document.canonical_document::text)",
			"octet_length(textbox.document_json::text)",
			"attachment object bytes are excluded",
		} {
			if !strings.Contains(text, required) {
				t.Errorf("%s missing %q", path, required)
			}
		}
		if strings.Contains(path, "zzzz_editor_owner_text_limit") {
			for _, forbidden := range []string{
				"editor_json_versions version",
				"node_textbox_yjs_updates update",
				"attachments attachment",
			} {
				if strings.Contains(text, forbidden) {
					t.Errorf("%s incorrectly counts non-current storage %q", path, forbidden)
				}
			}
		}
	}
}
