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
		"../../db/migrations/20260801_z_retire_legacy_editor_storage.sql",
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
			"trg_node_editor_text_limit",
			"trg_project_editor_text_limit",
			"trg_logic_gate_editor_text_limit",
			"octet_length(textbox.body_json::text)",
			"from node_textboxes textbox",
			"from project_textboxes textbox",
			"from logic_gate_textboxes textbox",
			"attachment object bytes are excluded",
		} {
			if !strings.Contains(text, required) {
				t.Errorf("%s missing %q", path, required)
			}
		}
		for _, forbidden := range []string{
			"trg_generic_editor_owner_text_limit",
			"mangorts_enforce_generic_editor_owner_text_limit()\nreturns trigger",
			"octet_length(textbox.document_json::text)",
		} {
			if strings.Contains(text, forbidden) {
				t.Errorf("%s retains obsolete limit contract %q", path, forbidden)
			}
		}
	}
}
