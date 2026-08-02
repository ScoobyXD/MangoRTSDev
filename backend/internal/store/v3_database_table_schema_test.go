package store

import (
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func v3TableColumns(t *testing.T, schema, table string) []string {
	t.Helper()
	startToken := "create table if not exists " + table + " ("
	start := strings.Index(schema, startToken)
	if start < 0 {
		t.Fatalf("canonical schema does not create %s", table)
	}
	bodyStart := start + len(startToken)
	end := strings.Index(schema[bodyStart:], "\n);")
	if end < 0 {
		t.Fatalf("canonical schema has no end for %s", table)
	}
	columnPattern := regexp.MustCompile(`(?m)^  ([a-z][a-z0-9_]*)\s+`)
	columns := make([]string, 0)
	for _, match := range columnPattern.FindAllStringSubmatch(schema[bodyStart:bodyStart+end], -1) {
		switch match[1] {
		case "primary", "unique", "foreign", "constraint", "references", "and", "or":
			continue
		}
		columns = append(columns, match[1])
	}
	return columns
}

func TestV3CanonicalSchemaHasExactPermanentTableColumns(t *testing.T) {
	raw, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := strings.ToLower(strings.ReplaceAll(string(raw), "\r\n", "\n"))
	expected := map[string][]string{
		"node_textboxes": {
			"company_id", "node_id", "textbox_id", "body_json", "revision", "display_order",
			"created_timestamp", "updated_timestamp", "deleted_timestamp",
		},
		"node_textbox_chats": {
			"company_id", "chat_id", "node_id", "textbox_id", "parent_chat_id", "selection_source",
			"selection_textbox_id", "selection_email_message_id", "selection_quote", "selection_start",
			"selection_end", "author_user_id", "author_display_name", "message", "entity_links",
			"mentioned_user_ids", "mentioned_group_ids", "revision", "created_timestamp",
			"updated_timestamp", "deleted_timestamp",
		},
		"node_textbox_seen_snapshots": {
			"company_id", "node_id", "textbox_id", "user_id", "body_json", "textbox_revision",
			"textbox_updated_timestamp", "seen_timestamp",
		},
		"node_content_changes": {
			"company_id", "change_id", "node_id", "textbox_id", "change_type", "text", "start_offset",
			"end_offset", "actor_user_id", "actor_display_name", "created_timestamp",
		},
		"email_threads": {
			"company_id", "email_thread_id", "mailbox_scope_type", "personal_user_id",
			"personal_account_email", "shared_inbox_id", "mailbox_account_email", "provider",
			"provider_thread_key", "provider_thread_id", "root_provider_message_id", "download_status",
			"history_complete", "fetched_timestamp", "last_download_error", "created_timestamp",
			"updated_timestamp",
		},
		"email_messages": {
			"company_id", "email_message_id", "email_thread_id", "provider_message_id", "message_order",
			"subject", "sender_snapshot", "to_snapshot", "cc_snapshot", "bcc_snapshot", "reply_to_snapshot",
			"message_timestamp", "rich_html_body", "text_fallback", "snippet", "unread", "starred",
			"folder_snapshot", "folder_id_snapshot", "attachment_metadata", "download_complete",
			"created_timestamp", "updated_timestamp",
		},
		"email_relationships": {
			"company_id", "email_relationship_id", "email_thread_id", "email_message_id", "resource_type",
			"resource_id", "resource_textbox_id", "created_timestamp",
		},
		"email_drafts": {
			"company_id", "draft_id", "email_relationship_id", "source_email_message_id", "mailbox_scope_type",
			"personal_user_id", "personal_account_email", "shared_inbox_id", "sender_account_email",
			"created_by_user_id", "updated_by_user_id", "kind", "to_recipients", "cc_recipients",
			"bcc_recipients", "subject", "body_editor_html", "scheduled_send_timestamp", "revision", "send_state",
			"send_claim_token", "send_idempotency_key", "send_idempotency_grant_id",
			"send_idempotency_timestamp", "send_claimed_revision", "send_claimed_timestamp",
			"sent_email_message_id", "sent_provider_message_id", "created_timestamp", "updated_timestamp",
			"deleted_timestamp",
		},
		"email_thread_download_jobs": {
			"download_job_id", "company_id", "email_thread_id", "download_scope",
			"requested_provider_message_id", "requested_by_user_id", "status", "attempt_count", "last_error",
			"available_at", "processing_started_at", "completed_timestamp", "failed_timestamp",
			"created_timestamp", "updated_timestamp",
		},
	}
	for table, want := range expected {
		if got := v3TableColumns(t, schema, table); !reflect.DeepEqual(got, want) {
			t.Errorf("%s columns = %#v, want %#v", table, got, want)
		}
	}
}

func TestV3CanonicalSchemaExcludesEveryRetiredTableAndLegacyAttachmentIdentity(t *testing.T) {
	raw, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := strings.ToLower(string(raw))
	for _, retired := range []string{
		"node_information", "node_projection_table", "node_projection_seen_snapshots",
		"communications_email_threads", "communications_email_messages", "communications_email_drafts",
		"communications_email_thread_download_jobs", "communications_email_collaborations",
		"communications_email_collaboration_participants", "communications_email_nodes",
		"communications_email_node_attachments", "communications_node_email_threads",
	} {
		if strings.Contains(schema, "create table if not exists "+retired+" (") {
			t.Errorf("canonical schema still creates retired table %s", retired)
		}
	}
	resourceAttachments := strings.Join(v3TableColumns(t, schema, "resource_attachments"), ",")
	if resourceAttachments == "" {
		t.Fatal("resource_attachments contract was not parsed")
	}
	start := strings.Index(schema, "create table if not exists resource_attachments (")
	end := strings.Index(schema[start:], "\n);")
	block := schema[start : start+end]
	if strings.Contains(block, "'attached_email'") || !strings.Contains(block, "'email_relationship'") {
		t.Fatal("resource_attachments must use email_relationship and reject attached_email")
	}
}

func TestV3MigrationIsStrictAndHasRepresentativeLegacyFixture(t *testing.T) {
	migrationBytes, err := os.ReadFile("../../db/migrations/20260802_zz_v3_database_table_cutover.sql")
	if err != nil {
		t.Fatal(err)
	}
	fixtureBytes, err := os.ReadFile("../../db/testdata/v3_cutover_representative_legacy.sql")
	if err != nil {
		t.Fatal(err)
	}
	assertionBytes, err := os.ReadFile("../../db/testdata/v3_cutover_representative_assertions.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration := strings.ToLower(string(migrationBytes))
	fixture := strings.ToLower(string(fixtureBytes))
	assertions := strings.ToLower(string(assertionBytes))
	for _, exactSetCheck := range []string{
		"cardinality(actual_columns) <> cardinality(expected_columns)",
		"actual_columns @> expected_columns",
		"actual_columns <@ expected_columns",
	} {
		if !strings.Contains(migration, exactSetCheck) {
			t.Errorf("strict V3 migration missing order-independent exact column-set check %q", exactSetCheck)
		}
	}
	for _, forbidden := range []string{"drop table if exists", "create table if not exists node_textbox_chats", "create table if not exists email_relationships"} {
		if strings.Contains(migration, forbidden) {
			t.Errorf("strict V3 migration contains drift-hiding statement %q", forbidden)
		}
	}
	for _, required := range []string{
		"mangorts_v3_assert_columns", "mangorts_v3_collaboration_repair",
		"mangorts_v3_message_snapshot_candidates", "drop table node_information;",
		"drop table node_projection_table;", "drop table communications_email_collaborations;",
		"trg_validate_email_relationship_resource", "trg_node_view_version_textbox_chats",
		"trg_node_view_user_version_textbox_snapshots",
	} {
		if !strings.Contains(migration, required) {
			t.Errorf("strict V3 migration missing %q", required)
		}
	}
	for _, required := range []string{
		"normalized subject", "collaboration fallback subject", "projection fallback subject",
		"node_projection_seen_snapshots", "node_content_changes", "resource_attachments",
	} {
		if !strings.Contains(fixture, required) {
			t.Errorf("representative legacy fixture missing %q", required)
		}
	}
	for _, required := range []string{
		"normalized message did not keep precedence and id", "collaboration snapshot fallback failed",
		"projection snapshot fallback failed", "attachment relationship identity was not converted",
	} {
		if !strings.Contains(assertions, required) {
			t.Errorf("representative migration assertions missing %q", required)
		}
	}
}
