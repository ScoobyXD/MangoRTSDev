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
	linkStart := strings.Index(text, "func (r *PostgresRepo) ListAttachmentResourceLinks")
	linkEnd := strings.Index(text[linkStart:], "func (r *PostgresRepo) ListResourceAttachments")
	if linkStart < 0 || linkEnd < 0 {
		t.Fatal("could not isolate ListAttachmentResourceLinks")
	}
	linkBody := text[linkStart : linkStart+linkEnd]
	if strings.Contains(linkBody, "select exists(") {
		t.Fatal("ListAttachmentResourceLinks still performs a separate existence query")
	}
	if !strings.Contains(linkBody, "left join resource_attachments ra") {
		t.Fatal("ListAttachmentResourceLinks must preserve existing-with-no-links semantics in one query")
	}
}
