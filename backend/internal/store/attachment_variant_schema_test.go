package store

import (
	"os"
	"strings"
	"testing"
)

func TestAttachmentPreviewSchemaUsesFinalContract(t *testing.T) {
	body, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	text := normalizeCanonicalSchemaContract(string(body))
	start := strings.Index(text, "create table if not exists attachment_previews")
	if start < 0 {
		t.Fatal("could not find attachment_previews schema")
	}
	end := strings.Index(text[start:], "\n);")
	if end < 0 {
		t.Fatal("could not isolate attachment_previews schema")
	}
	contract := text[start : start+end+3]
	for _, required := range []string{
		"attachment_previews", "preview_type", "preview_type = any (array['display'::text, 'thumbnail'::text])",
		"sha256", "generation_version", "updated_timestamp", "sha256 is null", "generation_version is null",
	} {
		if !strings.Contains(contract, required) {
			t.Errorf("final preview schema missing %q", required)
		}
	}
	for _, forbidden := range []string{"variant_type", "email_send"} {
		if strings.Contains(contract, forbidden) {
			t.Errorf("final preview schema must not contain %q", forbidden)
		}
	}
}
