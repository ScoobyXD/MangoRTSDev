package store

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPostgresEmailSQSReadinessRequiresExactPublicObjects(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_EMAIL_SQS_TEST_DSN"))
	if dsn == "" {
		t.Skip("disposable PostgreSQL 17 email SQS database not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	var version int
	if err := db.QueryRowContext(ctx, `select current_setting('server_version_num')::integer`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 180000 {
		t.Fatalf("readiness success test requires PostgreSQL 17.x, found server_version_num=%d", version)
	}
	repo := NewPostgresRepo(db)
	if err := repo.CheckEmailSQSWorkerSchemaReadinessContext(ctx); err != nil {
		t.Fatalf("exact migrated PostgreSQL 17 schema was not ready: %v", err)
	}

	_, err = db.ExecContext(ctx, `
		drop schema if exists email_sqs_deceptive cascade;
		create schema email_sqs_deceptive;
		create table email_sqs_deceptive.email_connections (
			status text constraint email_connections_status_chk check (status='wrong')
		);
		create table email_sqs_deceptive.email_ingestion_jobs (
			company_id uuid,
			email_connection_id uuid,
			provider_message_id text,
			status text constraint email_ingestion_jobs_status_chk check (status='wrong'),
			provider_attempt_count integer constraint email_ingestion_jobs_provider_attempt_chk check (provider_attempt_count between 0 and 99)
		);
		create unique index idx_email_ingestion_jobs_stable_message
			on email_sqs_deceptive.email_ingestion_jobs(provider_message_id);
		create table email_sqs_deceptive.communications_email_archive_job_items (
			status text constraint communications_email_archive_job_items_status_chk check (status='wrong')
		)`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(`drop schema if exists email_sqs_deceptive cascade`) })
	if err := repo.CheckEmailSQSWorkerSchemaReadinessContext(ctx); err != nil {
		t.Fatalf("same-named objects outside public influenced readiness: %v", err)
	}

	restoreConnectionConstraint := func() {
		t.Helper()
		_, restoreErr := db.ExecContext(ctx, `
			alter table public.email_connections drop constraint if exists email_connections_status_chk;
			alter table public.email_connections add constraint email_connections_status_chk
				check (status in ('connected','disconnected','reauth_required','configuration_required'))`)
		if restoreErr != nil {
			t.Fatal(restoreErr)
		}
	}
	_, err = db.ExecContext(ctx, `
		alter table public.email_connections drop constraint email_connections_status_chk;
		alter table public.email_connections add constraint email_connections_status_chk
			check (status in ('connected','disconnected','reauth_required'))`)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckEmailSQSWorkerSchemaReadinessContext(ctx); err == nil {
		t.Fatal("same-named public constraint with a wrong definition passed readiness")
	}
	restoreConnectionConstraint()

	restoreStableIndex := func() {
		t.Helper()
		_, restoreErr := db.ExecContext(ctx, `
			drop index if exists public.idx_email_ingestion_jobs_stable_message;
			create unique index idx_email_ingestion_jobs_stable_message
				on public.email_ingestion_jobs(company_id,email_connection_id,provider_message_id)`)
		if restoreErr != nil {
			t.Fatal(restoreErr)
		}
	}
	_, err = db.ExecContext(ctx, `
		drop index public.idx_email_ingestion_jobs_stable_message;
		create unique index idx_email_ingestion_jobs_stable_message
			on public.email_ingestion_jobs(company_id,email_connection_id,provider_message_id)
			where provider_message_id <> ''`)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckEmailSQSWorkerSchemaReadinessContext(ctx); err == nil {
		t.Fatal("same-named unique public index with a wrong predicate passed readiness")
	}
	restoreStableIndex()
	if err := repo.CheckEmailSQSWorkerSchemaReadinessContext(ctx); err != nil {
		t.Fatalf("restored exact public readiness contract failed: %v", err)
	}
}
