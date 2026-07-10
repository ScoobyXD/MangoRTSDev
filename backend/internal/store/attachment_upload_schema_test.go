package store

import (
	"os"
	"strings"
	"testing"
)

func TestAttachmentUploadSchemaContract(t *testing.T) {
	for _, path := range []string{"../../db/migrations/20260710_browser_attachment_uploads.sql", "../../db/schema.sql"} {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		sqlText := strings.ToLower(string(body))
		contractText := sqlText
		if start := strings.Index(contractText, "create table if not exists attachment_upload_intents"); start >= 0 {
			contractText = contractText[start:]
		}
		if end := strings.Index(contractText, "create table if not exists attachment_variants"); end >= 0 {
			contractText = contractText[:end]
		}
		for _, required := range []string{
			"attachment_upload_intents",
			"attachment_upload_parts",
			"unique (company_id, actor_user_id, client_request_id)",
			"unique (attachment_id)",
			"resource_attachment_id uuid",
			"sha256_verification_method",
			"storage_checksum_algorithm",
			"storage_checksum_value",
			"storage_checksum_type",
			"expected_size_bytes",
			"observed_size_bytes",
			"signing_attempt_count",
			"last_signed_timestamp",
			"status in ('pending', 'uploading', 'completing', 'completed', 'failed', 'aborted', 'expired')",
		} {
			if !strings.Contains(sqlText, required) {
				t.Errorf("%s missing schema contract fragment %q", path, required)
			}
		}
		for _, forbidden := range []string{"presigned_url", "upload_url", "part_url"} {
			if strings.Contains(contractText, forbidden) {
				t.Errorf("%s must not persist %q", path, forbidden)
			}
		}
	}
}
