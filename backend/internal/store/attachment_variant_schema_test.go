package store

import (
	"os"
	"strings"
	"testing"
)

func TestAttachmentVariantGenerationSchemaIsForwardAndBackwardCompatible(t *testing.T) {
	for _, path := range []string{"../../db/schema.sql", "../../db/migrations/20260712_attachment_variant_generation_metadata.sql"} {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		text := strings.ToLower(string(body))
		for _, required := range []string{"sha256", "generation_version", "updated_timestamp", "sha256 is null", "generation_version is null"} {
			if !strings.Contains(text, required) {
				t.Errorf("%s missing %q", path, required)
			}
		}
	}
}
