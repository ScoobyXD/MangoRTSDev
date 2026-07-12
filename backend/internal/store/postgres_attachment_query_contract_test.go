package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresAttachmentReadsUseOneContentQueryAndBatchedMetadataVariants(t *testing.T) {
	source, err := os.ReadFile("postgres_attachments.go")
	if err != nil {
		t.Fatalf("read postgres_attachments.go: %v", err)
	}
	text := string(source)
	for _, required := range []string{
		"func (r *PostgresRepo) ReadAttachmentContent",
		"left join attachment_variants v",
		"join resource_attachments ra",
		"func (r *PostgresRepo) listResourceAttachmentVariants",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("postgres attachment read contract missing %q", required)
		}
	}
	start := strings.Index(text, "func (r *PostgresRepo) ListResourceAttachments")
	end := strings.Index(text[start:], "func (r *PostgresRepo) listResourceAttachmentVariants")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate ListResourceAttachments")
	}
	listBody := text[start : start+end]
	if strings.Contains(listBody, "listAttachmentVariants(") {
		t.Fatal("ListResourceAttachments still performs per-attachment variant queries")
	}
}
