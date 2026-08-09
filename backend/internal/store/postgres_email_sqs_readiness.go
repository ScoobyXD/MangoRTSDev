package store

import (
	"context"
	"fmt"
	"strings"
)

var emailSQSFinalColumns = map[string][]string{
	"email_connections": {
		"email_connection_id", "company_id", "connection_type", "personal_user_id", "provider", "account_email",
		"grant_id", "status", "connected_by_user_id", "ingestion_started_at", "last_successful_scan_at",
		"created_timestamp", "updated_timestamp",
	},
	"email_ingestion_jobs": {
		"ingestion_job_id", "company_id", "email_connection_id", "email_thread_id", "provider_message_id",
		"provider_thread_id", "priority", "status", "provider_attempt_count", "attempt_token",
		"sqs_accepted_timestamp", "last_error", "completed_timestamp",
		"failed_timestamp", "created_timestamp", "updated_timestamp",
	},
	"communications_email_archive_job_items": {
		"job_item_id", "archive_job_id", "message_id", "status", "provider_attempt_count", "attempt_token", "last_error",
		"archived_timestamp", "failed_timestamp", "created_timestamp",
		"updated_timestamp",
	},
}

type emailSQSConstraintContract struct {
	table      string
	name       string
	definition string
}

var emailSQSFinalConstraints = []emailSQSConstraintContract{
	{
		table:      "email_connections",
		name:       "email_connections_status_chk",
		definition: "CHECK (status = ANY (ARRAY['connected'::text, 'disconnected'::text, 'reauth_required'::text, 'configuration_required'::text]))",
	},
	{
		table:      "email_ingestion_jobs",
		name:       "email_ingestion_jobs_status_chk",
		definition: "CHECK (status = ANY (ARRAY['accepted'::text, 'processing'::text, 'completed'::text, 'parked'::text, 'exhausted'::text]))",
	},
	{
		table:      "email_ingestion_jobs",
		name:       "email_ingestion_jobs_provider_attempt_chk",
		definition: "CHECK (provider_attempt_count >= 0 AND provider_attempt_count <= 3)",
	},
	{
		table:      "communications_email_archive_job_items",
		name:       "communications_email_archive_job_items_status_chk",
		definition: "CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'archived'::text, 'failed'::text]))",
	},
	{
		table:      "communications_email_archive_job_items",
		name:       "communications_email_archive_job_items_provider_attempt_chk",
		definition: "CHECK (provider_attempt_count >= 0 AND provider_attempt_count <= 3)",
	},
}

const emailSQSConstraintDefinitionQuery = `
	select coalesce((
		select pg_get_constraintdef(constraint_record.oid, true)
		from pg_constraint constraint_record
		join pg_class table_record on table_record.oid=constraint_record.conrelid
		join pg_namespace table_namespace on table_namespace.oid=table_record.relnamespace
		where table_namespace.nspname='public'
		  and table_record.relname=$1
		  and constraint_record.conname=$2
		  and constraint_record.contype='c'
	), '')`

const emailSQSStableIndexDefinitionQuery = `
	select exists (
		select 1
		from pg_index index_record
		join pg_class index_class on index_class.oid=index_record.indexrelid
		join pg_namespace index_namespace on index_namespace.oid=index_class.relnamespace
		join pg_class table_class on table_class.oid=index_record.indrelid
		join pg_namespace table_namespace on table_namespace.oid=table_class.relnamespace
		join pg_am access_method on access_method.oid=index_class.relam
		where index_namespace.nspname='public'
		  and index_class.relname='idx_email_ingestion_jobs_stable_message'
		  and table_namespace.nspname='public'
		  and table_class.relname='email_ingestion_jobs'
		  and access_method.amname='btree'
		  and index_record.indisunique
		  and index_record.indisvalid
		  and index_record.indisready
		  and not index_record.indnullsnotdistinct
		  and index_record.indnkeyatts=3
		  and index_record.indnatts=3
		  and index_record.indpred is null
		  and index_record.indexprs is null
		  and pg_get_indexdef(index_record.indexrelid, 1, true)='company_id'
		  and pg_get_indexdef(index_record.indexrelid, 2, true)='email_connection_id'
		  and pg_get_indexdef(index_record.indexrelid, 3, true)='provider_message_id'
	)`

func (r *PostgresRepo) CheckEmailSQSWorkerSchemaReadinessContext(ctx context.Context) error {
	var version int
	if err := r.db.QueryRowContext(ctx, `select current_setting('server_version_num')::integer`).Scan(&version); err != nil {
		return err
	}
	if version < 170000 || version >= 180000 {
		return fmt.Errorf("email SQS worker requires PostgreSQL 17.x, found server_version_num=%d", version)
	}
	for table, columns := range emailSQSFinalColumns {
		ready, err := r.postgresTableHasExactColumnsContext(ctx, table, columns)
		if err != nil {
			return err
		}
		if !ready {
			return fmt.Errorf("email SQS worker final schema is not ready for public.%s", table)
		}
	}
	for _, contract := range emailSQSFinalConstraints {
		var actual string
		if err := r.db.QueryRowContext(ctx, emailSQSConstraintDefinitionQuery, contract.table, contract.name).Scan(&actual); err != nil {
			return err
		}
		if !emailSQSConstraintDefinitionMatches(contract, actual) {
			return fmt.Errorf("email SQS worker final constraint public.%s.%s is missing or has the wrong definition", contract.table, contract.name)
		}
	}
	var stableIdentityReady bool
	if err := r.db.QueryRowContext(ctx, emailSQSStableIndexDefinitionQuery).Scan(&stableIdentityReady); err != nil {
		return err
	}
	if !stableIdentityReady {
		return fmt.Errorf("email SQS worker stable identity index must be the exact unique unfiltered btree index on public.email_ingestion_jobs(company_id,email_connection_id,provider_message_id)")
	}
	return nil
}

func emailSQSConstraintDefinitionMatches(contract emailSQSConstraintContract, actual string) bool {
	return canonicalEmailSQSConstraintDefinition(actual) == canonicalEmailSQSConstraintDefinition(contract.definition)
}

func canonicalEmailSQSConstraintDefinition(definition string) string {
	definition = strings.ToLower(definition)
	definition = strings.ReplaceAll(definition, "::text[]", "")
	definition = strings.ReplaceAll(definition, "::text", "")
	definition = strings.NewReplacer(" ", "", "\t", "", "\r", "", "\n", "", "(", "", ")", "").Replace(definition)
	return definition
}

func (r *PostgresRepo) postgresTableHasExactColumnsContext(ctx context.Context, table string, expected []string) (bool, error) {
	placeholders := make([]string, 0, len(expected))
	args := make([]any, 0, len(expected)+1)
	args = append(args, table)
	for i, column := range expected {
		args = append(args, column)
		placeholders = append(placeholders, fmt.Sprintf("$%d", i+2))
	}
	var actualCount, matchingCount int
	err := r.db.QueryRowContext(ctx, `
		select count(*), count(*) filter (where column_name in (`+strings.Join(placeholders, ",")+`))
		from information_schema.columns
		where table_schema='public' and table_name=$1`, args...).Scan(&actualCount, &matchingCount)
	if err != nil {
		return false, err
	}
	return actualCount == len(expected) && matchingCount == len(expected), nil
}
