package store

import (
	"os"
	"strings"
	"testing"
)

func TestAttachmentPendingDeletionIndexMatchesCanonicalSchema(t *testing.T) {
	for _, path := range []string{
		"../../db/schema.sql",
		"../../db/migrations/20260905_attachment_pending_deletion_index.sql",
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sql := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
		if !strings.Contains(sql, "create index idx_attachments_pending_deletion on public.attachments using btree (company_id, attachment_id) where (deleted_timestamp is not null)") {
			t.Fatalf("%s must index only durable pending attachment identities", path)
		}
	}
}
