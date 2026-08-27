package store

import (
	"database/sql"
	"fmt"
)

type PostgresRepo struct {
	db *sql.DB
}

func NewPostgresRepo(db *sql.DB) *PostgresRepo {
	return &PostgresRepo{db: db}
}

// CheckApplicationSchemaReadiness verifies the deployed application contract
// without creating, altering, dropping, or repairing schema or data.
func (r *PostgresRepo) CheckApplicationSchemaReadiness() error {
	if r == nil || r.db == nil {
		return ErrInvalid
	}
	requiredTables := []string{
		"email_connections",
		"communications_message_read_receipt_summaries", "communications_message_read_receipt_signals",
		"email_threads", "email_messages", "email_relationships", "email_drafts",
		"email_signatures", "email_ingestion_jobs", "attachments", "attachment_relationships",
		"node_textboxes", "node_textbox_chats", "node_textboxes_history",
		"project_textboxes", "project_textbox_chats", "logic_gate_textboxes", "logic_gate_textboxes_history",
		"score_cards",
	}
	for _, table := range requiredTables {
		var exists bool
		if err := r.db.QueryRow(`select to_regclass('public.' || $1) is not null`, table).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("application schema is not ready: missing table %s", table)
		}
	}
	requiredColumns := [][2]string{
		{"email_connections", "email_connection_id"},
		{"email_connections", "company_id"},
		{"email_connections", "connection_type"},
		{"email_connections", "personal_user_id"},
		{"email_connections", "ingestion_started_at"},
		{"email_connections", "last_successful_scan_at"},
		{"email_threads", "email_connection_id"},
		{"email_ingestion_jobs", "email_connection_id"},
		{"email_ingestion_jobs", "provider_message_id"},
		{"email_ingestion_jobs", "priority"},
		{"email_ingestion_jobs", "provider_attempt_count"},
		{"email_ingestion_jobs", "attempt_token"},
		{"email_ingestion_jobs", "sqs_accepted_timestamp"},
		{"communications_email_archive_job_items", "attempt_token"},
		{"email_messages", "email_message_id"},
		{"email_relationships", "resource_textbox_id"},
		{"email_drafts", "source_email_message_id"},
		{"attachment_relationships", "resource_type"},
		{"attachment_relationships", "resource_id"},
		{"node_textboxes", "body_json"},
		{"node_textboxes", "color"},
		{"node_textbox_chats", "chat_id"},
		{"project_textboxes", "title"},
		{"project_textboxes", "color"},
		{"project_textboxes", "metadata_revision"},
		{"project_textbox_chats", "chat_id"},
		{"logic_gate_textboxes", "title"},
		{"logic_gate_textboxes", "email_message_id"},
		{"logic_gate_textboxes", "email_accent"},
		{"logic_gate_textboxes", "metadata_revision"},
		{"score_cards", "qd_rating_id"},
		{"score_cards", "quality_rating"},
		{"score_cards", "cost_rating"},
		{"score_cards", "delivery_rating"},
		{"score_cards", "rated_created_timestamp"},
	}
	for _, required := range requiredColumns {
		var exists bool
		if err := r.db.QueryRow(`
select exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name=$1 and column_name=$2
)`, required[0], required[1]).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("application schema is not ready: missing column %s.%s", required[0], required[1])
		}
	}
	var obsoleteConnectionStorage bool
	if err := r.db.QueryRow(`
select to_regclass('public.user_email_connections') is not null
    or to_regclass('public.company_email_connections') is not null
    or to_regclass('public.email_thread_download_jobs') is not null
`).Scan(&obsoleteConnectionStorage); err != nil {
		return err
	}
	if obsoleteConnectionStorage {
		return fmt.Errorf("application schema is not ready: obsolete email connection or ingestion job table remains")
	}
	return nil
}
