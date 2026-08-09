-- Human-run DEV transaction. First stop/drain old API and email writers, run
-- email_sqs_delivery_preflight.sql, verify a DEV recovery point, and continue
-- only when every decision says READY. Plain PostgreSQL for DBeaver.

begin;

-- This block is intentionally the canonical migration body. Every shape and
-- data gate runs before the first ALTER/UPDATE, and any STOP rolls back all work.
do $migration$
declare
  column_count bigint;
  legacy_column_count bigint;
  final_column_count bigint;
  ingestion_is_legacy boolean;
  archive_is_legacy boolean;
  duplicate_identity_count bigint;
  legacy_active_count bigint;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: DEV email SQS migration requires PostgreSQL 17.x; connected server is %',
      current_setting('server_version');
  end if;
  if to_regclass('public.email_connections') is null
     or to_regclass('public.email_ingestion_jobs') is null
     or to_regclass('public.communications_email_archive_job_items') is null then
    raise exception 'STOP: required V3 email tables are missing';
  end if;

  select count(*), count(*) filter (where column_name = any (array[
    'email_connection_id','company_id','connection_type','personal_user_id','provider','account_email',
    'grant_id','status','connected_by_user_id','ingestion_started_at','last_successful_scan_at',
    'created_timestamp','updated_timestamp'
  ]::text[])) into column_count, final_column_count
  from information_schema.columns where table_schema='public' and table_name='email_connections';
  if column_count <> 13 or final_column_count <> 13 then
    raise exception 'STOP: email_connections must have exactly the approved 13 columns; found total %, approved %', column_count, final_column_count;
  end if;

  select count(*),
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','last_error','available_at',
      'processing_started_at','completed_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])),
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','provider_attempt_count','attempt_token',
      'enqueue_source_id','last_error','available_at','processing_started_at','completed_timestamp',
      'failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) into column_count, legacy_column_count, final_column_count
  from information_schema.columns where table_schema='public' and table_name='email_ingestion_jobs';
  if column_count = 16 and legacy_column_count = 16 then ingestion_is_legacy := true;
  elsif column_count = 19 and final_column_count = 19 then ingestion_is_legacy := false;
  else raise exception 'STOP: email_ingestion_jobs must be exact legacy 16 or exact final 19 columns; found total %, legacy-approved %, final-approved %', column_count, legacy_column_count, final_column_count;
  end if;

  select count(*),
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','last_error','available_at',
      'processing_started_at','archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])),
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','attempt_token','last_error',
      'available_at','processing_started_at','archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) into column_count, legacy_column_count, final_column_count
  from information_schema.columns where table_schema='public' and table_name='communications_email_archive_job_items';
  if column_count = 12 and legacy_column_count = 12 then archive_is_legacy := true;
  elsif column_count = 13 and final_column_count = 13 then archive_is_legacy := false;
  else raise exception 'STOP: communications_email_archive_job_items must be exact legacy 12 or exact final 13 columns; found total %, legacy-approved %, final-approved %', column_count, legacy_column_count, final_column_count;
  end if;

  if ingestion_is_legacy <> archive_is_legacy then
    raise exception 'STOP: email SQS tables must be coherently all-legacy or all-final; email_connections keeps its exact 13-column shape in both states';
  end if;

  select
    (select count(*) from email_ingestion_jobs where status in ('pending','retry','processing'))+
    (select count(*) from communications_email_archive_job_items where status in ('pending','retry','processing'))
  into legacy_active_count;
  if legacy_active_count <> 0 then
    raise exception 'STOP: % legacy database-delivered email item(s) must finish or receive deliberate operator review before SQS cutover', legacy_active_count;
  end if;
  select count(*) into duplicate_identity_count from (
    select company_id,email_connection_id,provider_message_id from email_ingestion_jobs
    group by company_id,email_connection_id,provider_message_id having count(*) > 1
  ) duplicates;
  if duplicate_identity_count <> 0 then
    raise exception 'STOP: % duplicate stable ingestion job identity group(s) require review', duplicate_identity_count;
  end if;

  if ingestion_is_legacy then
    alter table email_ingestion_jobs
      add column provider_attempt_count integer not null default 0,
      add column attempt_token uuid,
      add column enqueue_source_id text not null default '';
  end if;
  if archive_is_legacy then
    alter table communications_email_archive_job_items add column attempt_token uuid;
  end if;

  alter table email_connections drop constraint if exists email_connections_status_chk;
  alter table email_connections add constraint email_connections_status_chk check (
    status in ('connected','disconnected','reauth_required','configuration_required')
  );
  update email_ingestion_jobs
  set status='exhausted',provider_attempt_count=0,attempt_token=null,updated_timestamp=now()
  where status='failed';
  alter table communications_email_archive_job_items drop constraint if exists communications_email_archive_job_items_status_chk;
  alter table communications_email_archive_job_items add constraint communications_email_archive_job_items_status_chk
    check (status in ('pending','processing','archived','failed'));
  alter table email_ingestion_jobs
    drop constraint if exists email_ingestion_jobs_status_chk,
    drop constraint if exists email_ingestion_jobs_provider_attempt_chk;
  alter table email_ingestion_jobs
    alter column status set default 'accepted',
    add constraint email_ingestion_jobs_status_chk check (status in ('accepted','processing','completed','parked','exhausted')),
    add constraint email_ingestion_jobs_provider_attempt_chk check (provider_attempt_count between 0 and 3);
  drop index if exists idx_communications_email_archive_job_items_claim;
  drop index if exists idx_email_ingestion_jobs_active_message;
  drop index if exists idx_email_ingestion_jobs_claim;
  drop index if exists idx_email_ingestion_jobs_stable_message;
  create unique index idx_email_ingestion_jobs_stable_message
    on email_ingestion_jobs(company_id,email_connection_id,provider_message_id);
end
$migration$;

commit;

select current_setting('server_version') as connected_server_version,
  (select count(*) from email_connections where status='configuration_required') as configuration_required_connections,
  (select count(*) from email_ingestion_jobs where status='accepted') as accepted_jobs,
  (select count(*) from email_ingestion_jobs where status='processing') as processing_jobs,
  (select count(*) from email_ingestion_jobs where status='completed') as completed_jobs,
  (select count(*) from email_ingestion_jobs where status='parked') as parked_jobs,
  (select count(*) from email_ingestion_jobs where status='exhausted') as exhausted_jobs;
