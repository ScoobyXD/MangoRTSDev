package store

import (
	"os"
	"strings"
	"testing"
)

func readEmailSQSContractFile(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return strings.ToLower(strings.ReplaceAll(string(raw), "\r\n", "\n"))
}

func TestEmailSQSSchemaUsesPermanentIdentityAndProviderAttemptFence(t *testing.T) {
	schema := readEmailSQSContractFile(t, "../../db/schema.sql")
	migration := readEmailSQSContractFile(t, "../../db/migrations/20260809_zzzz_email_sqs_delivery_finalize.sql")
	for label, body := range map[string]string{"schema": schema, "migration": migration} {
		compact := strings.Join(strings.Fields(body), "")
		for _, required := range []string{
			"configuration_required",
			"provider_attempt_count",
			"attempt_token",
			"enqueue_source_id",
			"sqs_accepted_timestamp",
			"status in ('accepted','processing','completed','parked','exhausted')",
			"idx_email_ingestion_jobs_stable_message",
		} {
			if !strings.Contains(compact, strings.Join(strings.Fields(required), "")) {
				t.Errorf("%s is missing %q", label, required)
			}
		}
	}
	if !strings.Contains(schema, "idx_email_relationships_one_textbox_per_message_owner") {
		t.Fatal("canonical schema is missing the final Node/Project textbox cardinality index")
	}
	if !strings.Contains(migration, "idx_email_relationships_one_node_textbox_per_message") {
		t.Fatal("historical SQS migration no longer contains its then-current Node cardinality index")
	}
	for _, required := range []string{
		"communications_email_archive_job_items must be exact previously-applied 13 or exact final 11 columns",
		"email_ingestion_jobs must be exact previously-applied 19 or exact final 17 columns",
		"email_connections must have exactly the approved 13 columns",
		"add column sqs_accepted_timestamp timestamptz",
		"add column provider_attempt_count integer not null default 0",
		"drop column attempt_count",
		"drop column available_at",
		"drop column processing_started_at",
		"drop index if exists idx_email_ingestion_jobs_claim",
		"drop trigger if exists trg_email_relationships_one_node_per_thread on email_relationships",
		"drop function if exists mangorts_enforce_one_node_per_email_thread()",
		"drop index if exists idx_email_relationships_one_node_textbox_per_message",
		"drop index if exists idx_communications_email_archive_job_items_claim",
		"provider_attempt_count between 0 and 3",
		"email sqs tables must be coherently all previously-applied or all-final",
		"email sqs row(s) have a status outside the final approved sets",
		"current_setting('server_version_num')::integer < 170000",
		"current_setting('server_version_num')::integer >= 180000",
		"lock table public.email_connections",
		"previously-applied migration must already have collapsed these rows",
		"exact email message/node pair(s) are linked to more than one textbox",
	} {
		if !strings.Contains(migration, required) {
			t.Errorf("migration is missing %q", required)
		}
	}
	if strings.Contains(migration, "add column if not exists") {
		t.Fatal("migration masks partial schema drift with ADD COLUMN IF NOT EXISTS")
	}
	if strings.Contains(migration, "ordinal_position") || strings.Contains(migration, "array_agg") {
		t.Fatal("migration compares physical column order instead of exact unordered sets")
	}
	if strings.Contains(schema, "idx_email_ingestion_jobs_claim") || strings.Contains(schema, "idx_communications_email_archive_job_items_claim") {
		t.Fatal("canonical schema retains a legacy email claimant index")
	}
	if strings.Contains(schema, "trg_email_relationships_one_node_per_thread") || strings.Contains(schema, "mangorts_enforce_one_node_per_email_thread") {
		t.Fatal("canonical schema retains the obsolete one-thread/one-Node guard")
	}
	for _, obsolete := range []string{"available_at", "processing_started_at"} {
		if strings.Contains(schema, obsolete) {
			t.Errorf("canonical schema retains obsolete email SQS field %q", obsolete)
		}
	}
	for _, forbiddenDelete := range []string{"delete from email_threads", "delete from email_messages", "delete from attachments", "delete from attachment_relationships"} {
		if strings.Contains(migration, forbiddenDelete) {
			t.Errorf("migration deletes durable email truth with %q", forbiddenDelete)
		}
	}
}

func TestEmailSQSOperatorSQLIsPlainReviewedPostgreSQL(t *testing.T) {
	preflight := readEmailSQSContractFile(t, "../../../scripts/email_sqs_delivery_preflight.sql")
	apply := readEmailSQSContractFile(t, "../../../scripts/email_sqs_delivery_apply.sql")
	for label, body := range map[string]string{"preflight": preflight, "apply": apply} {
		for _, forbidden := range []string{"\\set", "\\i", "\\copy", "\\echo"} {
			if strings.Contains(body, forbidden) {
				t.Errorf("%s contains psql-only command %q", label, forbidden)
			}
		}
		if strings.Contains(body, "ordinal_position") || strings.Contains(body, "array_agg") {
			t.Errorf("%s compares physical column order instead of exact unordered sets", label)
		}
	}
	if !strings.Contains(preflight, "stop: this script supports postgresql 17.x only") {
		t.Fatal("preflight does not report an unsupported PostgreSQL version as STOP")
	}
	if !strings.Contains(apply, "begin;") || !strings.Contains(apply, "commit;") {
		t.Fatal("operator apply is not one explicit transaction")
	}
	for _, required := range []string{
		"drop trigger if exists trg_email_relationships_one_node_per_thread on email_relationships",
		"drop function if exists mangorts_enforce_one_node_per_email_thread()",
	} {
		if !strings.Contains(apply, required) {
			t.Errorf("operator apply is missing %q", required)
		}
	}
	for _, required := range []string{
		"exact approved 13-column shape",
		"exact previously-applied 19-column shape",
		"exact approved final 17-column shape",
		"exact previously-applied 13-column shape",
		"exact approved final 11-column shape",
		"ready: all email sqs tables are in the coherent previously-applied shape",
		"ready: all email sqs tables are in the coherent final shape",
		"stop: email sqs tables must be coherently all previously-applied or all-final",
		"duplicate_stable_identity_groups",
		"ready: stable ingestion identities are unique",
		"ready: every email sqs row uses a final approved status",
		"stop: one or more email sqs rows use a status outside the final approved sets",
		"ready: each exact email message is linked to at most one textbox in each node",
		"stop: one or more exact email messages are linked to multiple textboxes in the same node",
	} {
		if !strings.Contains(preflight, required) {
			t.Errorf("preflight is missing %q", required)
		}
	}
	if strings.Contains(apply, "add column if not exists") {
		t.Fatal("operator apply masks partial schema drift with ADD COLUMN IF NOT EXISTS")
	}
	if strings.Contains(apply, "cross join email_ingestion_jobs") {
		t.Fatal("operator verification multiplies independent status counts")
	}
}

func TestEmailSQSWorkerReadinessRequiresExactPublicCatalogDefinitions(t *testing.T) {
	for _, contract := range emailSQSFinalConstraints {
		if !emailSQSConstraintDefinitionMatches(contract, contract.definition) {
			t.Fatalf("approved constraint %s.%s did not match itself", contract.table, contract.name)
		}
	}
	wrongStatus := emailSQSFinalConstraints[0]
	if emailSQSConstraintDefinitionMatches(wrongStatus, "CHECK (status IN ('connected','disconnected','reauth_required'))") {
		t.Fatal("same-named connection constraint with a wrong definition passed readiness")
	}
	wrongAttemptFence := emailSQSFinalConstraints[2]
	if emailSQSConstraintDefinitionMatches(wrongAttemptFence, "CHECK (provider_attempt_count BETWEEN 0 AND 4)") {
		t.Fatal("same-named provider attempt constraint with a wrong upper bound passed readiness")
	}

	constraintQuery := strings.ToLower(strings.Join(strings.Fields(emailSQSConstraintDefinitionQuery), " "))
	for _, required := range []string{
		"table_namespace.nspname='public'",
		"table_record.relname=$1",
		"constraint_record.conname=$2",
		"constraint_record.contype='c'",
		"pg_get_constraintdef(constraint_record.oid, true)",
	} {
		if !strings.Contains(constraintQuery, required) {
			t.Errorf("constraint readiness query is missing exact public-table condition %q", required)
		}
	}

	indexQuery := strings.ToLower(strings.Join(strings.Fields(emailSQSStableIndexDefinitionQuery), " "))
	for _, required := range []string{
		"index_namespace.nspname='public'",
		"table_namespace.nspname='public'",
		"table_class.relname='email_ingestion_jobs'",
		"index_record.indisunique",
		"not index_record.indnullsnotdistinct",
		"index_record.indnkeyatts=3",
		"index_record.indnatts=3",
		"index_record.indpred is null",
		"index_record.indexprs is null",
		"pg_get_indexdef(index_record.indexrelid, 1, true)='company_id'",
		"pg_get_indexdef(index_record.indexrelid, 2, true)='email_connection_id'",
		"pg_get_indexdef(index_record.indexrelid, 3, true)='provider_message_id'",
	} {
		if !strings.Contains(indexQuery, required) {
			t.Errorf("stable identity readiness query is missing exact definition condition %q", required)
		}
	}
}
