package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func readAttachmentStep1Artifact(t *testing.T, path ...string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(path...))
	if err != nil {
		t.Fatal(err)
	}
	return strings.ToLower(strings.ReplaceAll(string(raw), "\r\n", "\n"))
}

func TestAttachmentStep1ArtifactsArePhasedAndOperatorGated(t *testing.T) {
	preflight := readAttachmentStep1Artifact(t, "..", "..", "..", "scripts", "attachment_step1_preflight.sql")
	step1 := readAttachmentStep1Artifact(t, "..", "..", "..", "scripts", "attachment_step1_create_copy_reconcile.sql")
	boundary := readAttachmentStep1Artifact(t, "..", "..", "..", "scripts", "attachment_step2_database_cutover.sql")
	migration := readAttachmentStep1Artifact(t, "..", "..", "db", "migrations", "20260804_attachment_step1_expansion.sql")
	schema := readAttachmentStep1Artifact(t, "..", "..", "db", "schema.sql")
	cleanupMain := readAttachmentStep1Artifact(t, "..", "..", "cmd", "mango-attachment-step1-cleanup", "main.go")

	inlineStart := strings.Index(step1, "-- additive attachment step 1 expansion only.")
	inlineEnd := strings.Index(step1, "-- end inlined additive expansion")
	if inlineStart < 0 || inlineEnd <= inlineStart ||
		strings.TrimSpace(step1[inlineStart:inlineEnd]) != strings.TrimSpace(migration) {
		t.Fatal("DBeaver Step 1 expansion drifted from the repository migration")
	}

	if !strings.Contains(preflight, "begin transaction isolation level repeatable read read only") ||
		!strings.Contains(preflight, "ready_for_attachment_step1") ||
		!strings.Contains(preflight, "stop_and_review") {
		t.Fatal("preflight is not a clear repeatable-read, read-only readiness report")
	}
	decisionStart := strings.Index(preflight, "-- result set 1: decision first")
	columnsStart := strings.Index(preflight, "-- result set 2: exact current/destination column inventory")
	constraintsStart := strings.Index(preflight, "-- result set 3: exact keys")
	if decisionStart < 0 || columnsStart <= decisionStart || constraintsStart <= columnsStart {
		t.Fatal("preflight does not present decision, summary, and detail before schema inventories")
	}
	if !strings.Contains(preflight, "when 'readiness' then 1") {
		t.Fatal("preflight does not put the readiness row first")
	}

	for _, forbidden := range []string{"insert into ", "update ", "delete from ", "create table ", "alter table ", "drop table "} {
		if strings.Contains(preflight, forbidden) {
			t.Errorf("preflight contains write SQL %q", forbidden)
		}
	}
	for _, required := range []string{
		"attachments", "resource_attachments", "attachment_relationships",
		"attachment_upload_intents", "attachment_upload_parts", "attachment_variants",
		"attachment_migration_runs", "attachment_migration_items",
		"approved_broken_relationship", "other_zero_owner_attachment",
		"unsafe_cross_attachment_reuse", "legacy_preview_type", "upload_status",
		"expected_final", "approved_broken_identities", "=213",
		"approved_relationships_already_absent", "missing_owner_relationships_to_delete",
		"target_cleanup_identity_conflicts",
	} {
		if !strings.Contains(preflight, required) {
			t.Errorf("preflight missing %q", required)
		}
	}
	if strings.HasPrefix(step1, "\\") || strings.Contains(step1, "\n\\") {
		t.Error("Step 1 write entry point contains a psql-only command")
	}
	for _, required := range []string{
		"share row exclusive mode", "attachment_step1_assert_columns",
		"attachment_step1_approved_evidence", "source_checksum",
		"conflicting existing attachment_relationships target",
		"on conflict(upload_job_id) do nothing",
		"on conflict(attachment_id,preview_type) do nothing",
		"unexpected unfinished attachment upload job",
		"md5(to_jsonb(source)::text)=approved.source_checksum",
		"set deleted_timestamp=coalesce", "ready_for_guarded_s3_cleanup",
		"attachment_step1_relationship_cleanup",
		"cleanup identity conflicts with an existing final relationship",
	} {
		if !strings.Contains(step1, required) {
			t.Errorf("Step 1 write entry point missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"drop table resource_attachments", "drop table attachment_upload_intents",
		"drop table attachment_variants", "drop table attachment_migration_runs",
		"drop table attachment_migration_items",
		"rename column upload_intent_id to upload_job_id",
	} {
		if strings.Contains(step1, forbidden) || strings.Contains(migration, forbidden) {
			t.Errorf("Step 1 artifact crosses the phased boundary with %q", forbidden)
		}
	}
	for _, required := range []string{
		"create table if not exists attachment_upload_jobs",
		"attachment_relationship_id uuid",
		"create table if not exists attachment_previews",
		"preview_type in ('display', 'thumbnail')",
		"trg_resource_attachments_reject_pending",
		"trg_attachment_relationships_validate_live_owner",
	} {
		if !strings.Contains(migration, required) || !strings.Contains(schema, required) {
			t.Errorf("canonical/additive schema missing %q", required)
		}
	}
	for _, required := range []string{
		"do not run during step 1", "access exclusive mode",
		"rename column upload_intent_id to upload_job_id",
		"references attachment_upload_jobs(upload_job_id)",
		"ready_for_immediate_step2_backend_deploy",
	} {
		if !strings.Contains(boundary, required) {
			t.Errorf("Step 2 boundary missing %q", required)
		}
	}
	for _, required := range []string{
		"delete_attachment_step1_orphans", "company-id",
		"apply requires the exact confirmation string", "dry-run",
		"news3attachmentstoragefromenv",
	} {
		if !strings.Contains(cleanupMain, required) {
			t.Errorf("cleanup command missing operator gate %q", required)
		}
	}
}

func TestAttachmentStep1Postgres18FirstRunRerunAndDriftRollback(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_STEP1_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set MANGORTS_ATTACHMENT_STEP1_TEST_DATABASE_URL to a disposable PostgreSQL 18 database")
	}
	if os.Getenv("MANGORTS_ATTACHMENT_STEP1_TEST_RESET_ACK") != "DROP_DISPOSABLE_SCHEMA" {
		t.Fatal("set MANGORTS_ATTACHMENT_STEP1_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA for the guarded disposable test")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.Host != "127.0.0.1" && !strings.EqualFold(config.Host, "localhost") {
		t.Fatalf("refusing non-local disposable database host %q", config.Host)
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	defer db.Close()

	var version int
	var databaseName string
	if err := db.QueryRow(`
select current_setting('server_version_num')::integer,current_database()`).
		Scan(&version, &databaseName); err != nil {
		t.Fatal(err)
	}
	if version < 180000 || version >= 190000 {
		t.Fatalf("PostgreSQL version=%d, want 18.x", version)
	}
	if !strings.HasPrefix(databaseName, "mangorts_attachment_step1_test_") {
		t.Fatalf("refusing non-disposable database %q", databaseName)
	}
	if _, err := db.Exec("drop schema public cascade; create schema public"); err != nil {
		t.Fatalf("reset disposable schema: %v", err)
	}

	schemaRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(schemaRaw)); err != nil {
		t.Fatalf("apply canonical schema: %v", err)
	}
	if _, err := db.Exec(attachmentStep1FixtureSQL); err != nil {
		t.Fatalf("seed attachment Step 1 fixture: %v", err)
	}

	preflightRaw, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "attachment_step1_preflight.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(preflightRaw)); err != nil {
		t.Fatalf("first preflight: %v", err)
	}
	assertAttachmentStep1Counts(t, db, 219, 5, 0, 0, 1)

	stepRaw, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "attachment_step1_create_copy_reconcile.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(stepRaw)); err != nil {
		t.Fatalf("first Step 1 run: %v", err)
	}
	assertAttachmentStep1Counts(t, db, 4, 4, 1, 2, 1)
	var pendingCleanup int
	if err := db.QueryRow("select count(*) from attachments where deleted_timestamp is not null").
		Scan(&pendingCleanup); err != nil {
		t.Fatal(err)
	}
	if pendingCleanup != 214 {
		t.Fatalf("pending cleanup attachments=%d, want 214", pendingCleanup)
	}

	if _, err := db.Exec(string(stepRaw)); err != nil {
		t.Fatalf("identical Step 1 rerun: %v", err)
	}
	assertAttachmentStep1Counts(t, db, 4, 4, 1, 2, 1)

	if _, err := db.Exec(`
delete from attachment_previews
where attachment_id=md5('retained-a')::uuid and preview_type='display';
update attachment_upload_jobs
set mime_type='application/drift'
where upload_job_id=md5('upload-job')::uuid`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(stepRaw)); err == nil {
		t.Fatal("forced target drift unexpectedly committed")
	}
	if _, err := db.Exec("rollback"); err != nil {
		t.Fatalf("roll back expected failed operator transaction: %v", err)
	}
	var previewRows int
	var jobMime string
	if err := db.QueryRow(`
select
  (select count(*) from attachment_previews
   where attachment_id=md5('retained-a')::uuid and preview_type='display'),
  (select mime_type from attachment_upload_jobs
   where upload_job_id=md5('upload-job')::uuid)`).Scan(&previewRows, &jobMime); err != nil {
		t.Fatal(err)
	}
	if previewRows != 0 || jobMime != "application/drift" {
		t.Fatalf("failed run did not roll back its copy: preview=%d mime=%q", previewRows, jobMime)
	}

	for _, table := range []string{
		"resource_attachments", "attachment_upload_intents", "attachment_variants",
		"attachment_migration_runs", "attachment_migration_items",
	} {
		var present bool
		if err := db.QueryRow(`select to_regclass('public.'||$1) is not null`, table).Scan(&present); err != nil {
			t.Fatal(err)
		}
		if !present {
			t.Errorf("Step 1 dropped legacy table %s", table)
		}
	}
	var finalFK, legacyColumn, finalColumn bool
	if err := db.QueryRow(`
select
  exists(select 1 from pg_constraint
    where conrelid='attachment_upload_parts'::regclass and contype='f'
      and pg_get_constraintdef(oid) like
        '%REFERENCES attachment_upload_intents(upload_intent_id)%'),
  exists(select 1 from information_schema.columns
    where table_name='attachment_upload_parts' and column_name='upload_intent_id'),
  exists(select 1 from information_schema.columns
    where table_name='attachment_upload_parts' and column_name='upload_job_id')`).
		Scan(&finalFK, &legacyColumn, &finalColumn); err != nil {
		t.Fatal(err)
	}
	if !finalFK || !legacyColumn || finalColumn {
		t.Fatalf("Step 1 changed live multipart contract: fk=%v legacy=%v final=%v",
			finalFK, legacyColumn, finalColumn)
	}

	if _, err := db.Exec(`
update attachment_upload_jobs job
set mime_type=intent.mime_type
from attachment_upload_intents intent
where intent.upload_intent_id=job.upload_job_id;
insert into attachment_previews(
  attachment_id,preview_type,mime_type,byte_size,sha256,generation_version,
  width,height,storage_bucket,storage_key,created_timestamp,updated_timestamp
)
select attachment_id,variant_type,mime_type,byte_size,sha256,generation_version,
       width,height,storage_bucket,storage_key,created_timestamp,updated_timestamp
from attachment_variants
where attachment_id=md5('retained-a')::uuid and variant_type='display'
on conflict(attachment_id,preview_type) do nothing`); err != nil {
		t.Fatalf("repair disposable forced drift: %v", err)
	}
	if _, err := db.Exec(string(stepRaw)); err != nil {
		t.Fatalf("reconcile repaired disposable target: %v", err)
	}
	boundaryRaw, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "attachment_step2_database_cutover.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(boundaryRaw)); err != nil {
		t.Fatalf("Step 2 multipart boundary first run: %v", err)
	}
	if _, err := db.Exec(string(boundaryRaw)); err != nil {
		t.Fatalf("Step 2 multipart boundary identical rerun: %v", err)
	}
	if err := db.QueryRow(`
select
  exists(select 1 from pg_constraint
    where conrelid='attachment_upload_parts'::regclass and contype='f'
      and pg_get_constraintdef(oid) like
        '%REFERENCES attachment_upload_jobs(upload_job_id)%'),
  exists(select 1 from information_schema.columns
    where table_name='attachment_upload_parts' and column_name='upload_intent_id'),
  exists(select 1 from information_schema.columns
    where table_name='attachment_upload_parts' and column_name='upload_job_id')`).
		Scan(&finalFK, &legacyColumn, &finalColumn); err != nil {
		t.Fatal(err)
	}
	if !finalFK || legacyColumn || !finalColumn {
		t.Fatalf("Step 2 multipart boundary shape: fk=%v legacy=%v final=%v",
			finalFK, legacyColumn, finalColumn)
	}
}

func assertAttachmentStep1Counts(
	t *testing.T,
	db *sql.DB,
	legacyRelationships int,
	finalRelationships int,
	jobs int,
	previews int,
	parts int,
) {
	t.Helper()
	var gotLegacy, gotFinal, gotJobs, gotPreviews, gotParts int
	if err := db.QueryRow(`
select
  (select count(*) from resource_attachments),
  (select count(*) from attachment_relationships),
  (select count(*) from attachment_upload_jobs),
  (select count(*) from attachment_previews),
  (select count(*) from attachment_upload_parts)`).
		Scan(&gotLegacy, &gotFinal, &gotJobs, &gotPreviews, &gotParts); err != nil {
		t.Fatal(err)
	}
	if gotLegacy != legacyRelationships || gotFinal != finalRelationships ||
		gotJobs != jobs || gotPreviews != previews || gotParts != parts {
		t.Fatalf("counts legacy/final/jobs/previews/parts=%d/%d/%d/%d/%d, want %d/%d/%d/%d/%d",
			gotLegacy, gotFinal, gotJobs, gotPreviews, gotParts,
			legacyRelationships, finalRelationships, jobs, previews, parts)
	}
}

const attachmentStep1FixtureSQL = `
insert into users(user_id,cognito_subject,email,display_name)
values(md5('attachment-user')::uuid,'attachment-user','test@example.com','Attachment Test');
insert into companies(company_id,name)
values(md5('attachment-company')::uuid,'Attachment Test');
insert into company_memberships(company_id,user_id,role)
values(md5('attachment-company')::uuid,md5('attachment-user')::uuid,'company_user');
insert into nodes(company_id,node_id,name,created_timestamp)
values
  (md5('attachment-company')::uuid,md5('node-a')::uuid,'Node A',now()),
  (md5('attachment-company')::uuid,md5('node-b')::uuid,'Node B',now());

insert into email_drafts(
  company_id,draft_id,email_account_type,personal_user_id,
  personal_account_email,created_by_user_id,updated_by_user_id
) values(
  md5('attachment-company')::uuid,'draft-live','personal_email_account',
  md5('attachment-user')::uuid,'test@example.com',
  md5('attachment-user')::uuid,md5('attachment-user')::uuid
);

insert into attachments(
  attachment_id,company_id,uploaded_by_user_id,original_filename,mime_type,
  byte_size,sha256,storage_bucket,storage_key,source_kind
)
select md5('orphan-'||g)::uuid,md5('attachment-company')::uuid,
       md5('attachment-user')::uuid,'fixture.bin','application/octet-stream',
       1,repeat('a',64),'test-bucket','orphan/'||g,'user_upload'
from generate_series(1,213) g;
insert into attachments(
  attachment_id,company_id,uploaded_by_user_id,original_filename,mime_type,
  byte_size,sha256,storage_bucket,storage_key,source_kind
) values
  (md5('retained-a')::uuid,md5('attachment-company')::uuid,
   md5('attachment-user')::uuid,'a.png','image/png',1,repeat('b',64),
   'test-bucket','retained/a','user_upload'),
  (md5('retained-b')::uuid,md5('attachment-company')::uuid,
   md5('attachment-user')::uuid,'b.bin','application/octet-stream',67108865,
   repeat('c',64),'test-bucket','retained/b','user_upload'),
  (md5('missing-owner-file')::uuid,md5('attachment-company')::uuid,
   md5('attachment-user')::uuid,'missing.bin','application/octet-stream',1,
   repeat('f',64),'test-bucket','missing/owner','user_upload');

insert into resource_attachments(
  resource_attachment_id,company_id,resource_type,resource_id,attachment_id,
  relationship_kind,created_by_user_id
)
select md5('broken-rel-'||g)::uuid,md5('attachment-company')::uuid,
       'email_draft','personal:'||md5('attachment-user')::uuid::text||
       ':missing-draft-'||g,md5('orphan-'||g)::uuid,'email_attachment',
       md5('attachment-user')::uuid
from generate_series(1,213) g;
insert into resource_attachments(
  resource_attachment_id,company_id,resource_type,resource_id,attachment_id,
  relationship_kind,created_by_user_id
) values
  (md5('valid-rel-a1')::uuid,md5('attachment-company')::uuid,'node',
   md5('node-a')::uuid::text,md5('retained-a')::uuid,'file_attachment',
   md5('attachment-user')::uuid),
  (md5('valid-rel-a2')::uuid,md5('attachment-company')::uuid,'node',
   md5('node-b')::uuid::text,md5('retained-a')::uuid,'inline_image',
   md5('attachment-user')::uuid),
  (md5('valid-rel-b')::uuid,md5('attachment-company')::uuid,'node',
   md5('node-a')::uuid::text,md5('retained-b')::uuid,'file_attachment',
   md5('attachment-user')::uuid),
  (md5('missing-owner-rel')::uuid,md5('attachment-company')::uuid,'node',
   md5('missing-node')::uuid::text,md5('missing-owner-file')::uuid,
   'file_attachment',md5('attachment-user')::uuid),
  (md5('deleted-rel')::uuid,md5('attachment-company')::uuid,'node',
   md5('node-a')::uuid::text,md5('retained-a')::uuid,'migrated_inline_image',
   md5('attachment-user')::uuid);
update resource_attachments set deleted_timestamp=now()
where resource_attachment_id=md5('deleted-rel')::uuid;

insert into resource_attachments(
  resource_attachment_id,company_id,resource_type,resource_id,attachment_id,
  information_id,message_id,editor_surface,relationship_kind,created_by_user_id
) values(
  md5('legacy-email-rel')::uuid,md5('attachment-company')::uuid,'email_draft',
  'personal:'||md5('attachment-user')::uuid::text||
    ':test%40example.com:draft-live',md5('retained-a')::uuid,
  md5('legacy-email-origin')::uuid,'legacy-provider-message','legacy-editor',
  'email_attachment',md5('attachment-user')::uuid
);

insert into attachment_relationships
select resource_attachment_id,company_id,resource_type,resource_id,attachment_id,
       information_id,message_id,editor_surface,relationship_kind,
       created_by_user_id,created_timestamp,deleted_timestamp
from resource_attachments
where resource_attachment_id in(
  md5('valid-rel-a1')::uuid,md5('valid-rel-a2')::uuid,md5('valid-rel-b')::uuid,
  md5('deleted-rel')::uuid
);

insert into attachment_relationships(
  attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,
  information_id,message_id,editor_surface,relationship_kind,created_by_user_id,
  created_timestamp,deleted_timestamp
)
select resource_attachment_id,company_id,'email_draft','draft-live',attachment_id,
       null,'','',relationship_kind,created_by_user_id,created_timestamp,null
from resource_attachments
where resource_attachment_id=md5('legacy-email-rel')::uuid;

insert into v3_email_migration_runs(
  run_id,mapping_version,status,summary,completed_timestamp
) values(md5('email-run')::uuid,1,'complete','{}',now());
insert into v3_email_migration_items(
  run_id,source_table,company_id,source_key,target_table,target_key,
  disposition,source_checksum
)
select md5('email-run')::uuid,'resource_attachments',r.company_id,
       r.resource_attachment_id::text,'attachments',r.attachment_id::text,
       'retained_orphan_evidence',md5(to_jsonb(r)::text)
from resource_attachments r
where r.resource_attachment_id in(
  select md5('broken-rel-'||g)::uuid from generate_series(1,213) g
);

insert into attachment_upload_intents(
  upload_intent_id,company_id,actor_user_id,client_request_id,attachment_id,
  resource_attachment_id,original_filename,mime_type,size_bytes,sha256,
  resource_type,resource_id,relationship_kind,source_kind,storage_bucket,
  storage_key,multipart_upload_id,strategy,part_size_bytes,part_count,status,
  expires_timestamp,completed_timestamp
) values(
  md5('upload-job')::uuid,md5('attachment-company')::uuid,
  md5('attachment-user')::uuid,'fixture-upload',md5('retained-b')::uuid,
  md5('valid-rel-b')::uuid,'b.bin','application/octet-stream',67108865,
  repeat('c',64),'node',md5('node-a')::uuid::text,'file_attachment',
  'user_upload','test-bucket','retained/b','multipart-id','multipart',
  16777216,5,'completed',now()+interval '1 day',now()
);
insert into attachment_upload_parts(
  upload_intent_id,part_number,expected_size_bytes,observed_size_bytes,
  checksum_algorithm,expected_checksum,etag,s3_checksum,uploaded_timestamp
) values(
  md5('upload-job')::uuid,1,16777216,16777216,'SHA256','checksum',
  'etag','checksum',now()
);

insert into attachment_variants(
  attachment_id,variant_type,mime_type,byte_size,sha256,generation_version,
  width,height,storage_bucket,storage_key
) values
  (md5('retained-a')::uuid,'display','image/png',1,repeat('d',64),1,1,1,
   'test-bucket','retained/a-display'),
  (md5('retained-a')::uuid,'thumbnail','image/png',1,repeat('e',64),1,1,1,
   'test-bucket','retained/a-thumbnail'),
  (md5('retained-a')::uuid,'original','image/png',1,repeat('b',64),1,1,1,
   'test-bucket','retained/a'),
  (md5('retained-b')::uuid,'email_send','application/octet-stream',67108865,
   repeat('c',64),1,null,null,'test-bucket','retained/b-email-send');
`
