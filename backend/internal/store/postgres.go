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
		"user_email_connections", "company_email_connections",
		"communications_message_read_receipt_summaries", "communications_message_read_receipt_signals",
		"email_threads", "email_messages", "email_relationships", "email_drafts",
		"email_signatures", "email_thread_download_jobs", "attachments", "attachment_relationships",
		"project_textboxes", "project_textbox_chats",
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
		{"user_email_connections", "account_email"},
		{"email_threads", "email_account_type"},
		{"email_threads", "email_account_email"},
		{"email_messages", "email_message_id"},
		{"email_relationships", "resource_textbox_id"},
		{"email_drafts", "send_idempotency_key"},
		{"email_drafts", "sent_email_message_id"},
		{"attachment_relationships", "resource_type"},
		{"attachment_relationships", "resource_id"},
		{"project_textboxes", "title"},
		{"project_textboxes", "email_message_id"},
		{"project_textboxes", "email_accent"},
		{"project_textboxes", "metadata_revision"},
		{"project_textbox_chats", "chat_id"},
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
	var obsoleteConnectionScope bool
	if err := r.db.QueryRow(`
select exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='user_email_connections' and column_name='connection_scope'
)`).Scan(&obsoleteConnectionScope); err != nil {
		return err
	}
	if obsoleteConnectionScope {
		return fmt.Errorf("application schema is not ready: obsolete user_email_connections.connection_scope remains")
	}
	return nil
}
