package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAttachmentUploadStep2SchemaContract(t *testing.T) {
	schemaBody, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	boundaryBody, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "attachment_step2_database_cutover.sql"))
	if err != nil {
		t.Fatal(err)
	}
	schema := normalizeCanonicalSchemaContract(string(schemaBody))
	boundary := strings.ToLower(string(boundaryBody))
	for _, required := range []string{
		"create table if not exists attachment_upload_jobs", "upload_job_id uuid not null",
		"add constraint attachment_upload_jobs_pkey primary key (upload_job_id)",
		"attachment_relationship_id uuid", "create table if not exists attachment_upload_parts",
		"add constraint attachment_upload_parts_pkey primary key (upload_job_id, part_number)",
		"foreign key (upload_job_id) references attachment_upload_jobs(upload_job_id)",
		"unique (company_id, actor_user_id, client_request_id)", "unique (attachment_id)",
		"sha256_verification_method", "storage_checksum_algorithm", "storage_checksum_value",
		"storage_checksum_type", "expected_size_bytes", "observed_size_bytes",
		"signing_attempt_count", "last_signed_timestamp",
		"status = any (array['pending'::text, 'uploading'::text, 'completing'::text, 'completed'::text, 'failed'::text, 'aborted'::text, 'expired'::text])",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("final upload schema missing %q", required)
		}
	}
	for _, forbidden := range []string{"upload_intent_id", "resource_attachment_id", "presigned_url", "upload_url", "part_url"} {
		if strings.Contains(schema, forbidden) {
			t.Errorf("final upload schema must not contain %q", forbidden)
		}
	}
	for _, required := range []string{
		"access exclusive mode", "rename column upload_intent_id to upload_job_id",
		"references attachment_upload_jobs(upload_job_id)",
		"ready_for_immediate_step2_backend_deploy",
	} {
		if !strings.Contains(boundary, required) {
			t.Errorf("Step 2 boundary missing %q", required)
		}
	}
	if strings.HasPrefix(boundary, "\\") || strings.Contains(boundary, "\n\\") {
		t.Fatal("Step 2 boundary contains a psql-only command")
	}
}

func TestAttachmentStep2ApplicationSQLUsesOnlyFinalTables(t *testing.T) {
	paths := []string{
		"postgres_attachment_uploads.go", "postgres_attachments.go",
		filepath.Join("..", "attachmentcleanup", "postgres.go"), filepath.Join("..", "..", "cmd", "mango-attachment-previews", "main.go"),
	}
	for _, path := range paths {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		text := strings.ToLower(string(body))
		for _, forbidden := range []string{"resource_attachments", "attachment_upload_intents", "attachment_variants", "email_send"} {
			if strings.Contains(text, forbidden) {
				t.Errorf("%s still uses legacy application token %q", path, forbidden)
			}
		}
	}
}

func TestAttachmentOwnerDeletionPathsUseSharedRetirement(t *testing.T) {
	contracts := map[string][]string{
		"postgres_company_explorer.go": {
			"retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, \"company_explorer_folder\"",
			"retireNodeChatAttachmentRelationshipsTx", "EntityTypeLogicGate", "delete from email_relationships",
		},
		"postgres_communications_triage.go":    {"postgresDeleteNodeWithDependentProjectionsTx", "EntityTypeNode"},
		"postgres_projects.go":                 {"retireProjectChatAttachmentRelationshipsTx", "EntityTypeProject", "delete from email_relationships"},
		"postgres_logic_gate_final_storage.go": {"resource_type='logic_gate'", "attachment_relationships"},
		"postgres_node_textbox_chats.go":       {"retireNodeTextboxChatTreeRelationshipsTx", "retireAttachmentRelationshipsTx"},
		"postgres_editor_textboxes.go":         {"retireNodeTextboxAttachmentRelationshipsTx", "retireProjectTextboxAttachmentRelationshipsTx"},
		"attachment_relationship_cleanup.go":   {"project_textbox_chats", "project_chat_message", "retireProjectTextboxChatTreeRelationshipsTx"},
		"postgres_project_textbox_chats.go":    {"project_chat_message", "attachment_relationships"},
		"postgres_email_drafts.go":             {"retireAttachmentOwnerRelationshipsTx", "email_draft"},
		"postgres_shared_inbox_folders.go":     {"shared_inbox_folder", "shared_inbox", "retireAttachmentOwnerRelationshipsTx"},
	}
	for path, required := range contracts {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for _, fragment := range required {
			if !strings.Contains(string(body), fragment) {
				t.Errorf("%s missing shared attachment cleanup hook %q", path, fragment)
			}
		}
	}
}
