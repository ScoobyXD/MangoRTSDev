-- Forward-only DEV finalizer for databases that already ran the first
-- 20260809 email SQS migration. That shipped migration produced the exact
-- 19-column ingestion and 13-column archive shapes checked below. This file
-- removes the retired database-delivery fields and reaches the canonical
-- 17/11 SQS shapes without guessing about partial drift.

do $migration$
declare
  column_count bigint;
  intermediate_column_count bigint;
  final_column_count bigint;
  ingestion_state text;
  archive_state text;
  invalid_status_count bigint;
  active_work_count bigint;
  duplicate_identity_count bigint;
  duplicate_node_textbox_message_count bigint;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: DEV email SQS finalizer requires PostgreSQL 17.x; connected server is %',
      current_setting('server_version');
  end if;

  if to_regclass('public.email_connections') is null
     or to_regclass('public.email_ingestion_jobs') is null
     or to_regclass('public.communications_email_archive_job_items') is null
     or to_regclass('public.email_relationships') is null then
    raise exception 'STOP: required V3 email tables are missing';
  end if;

  lock table public.email_connections,
    public.email_ingestion_jobs,
    public.communications_email_archive_job_items,
    public.email_relationships
    in share row exclusive mode;

  select count(*) into duplicate_node_textbox_message_count
  from (
    select 1
    from email_relationships
    where resource_type='node' and resource_textbox_id is not null
    group by company_id,email_message_id,resource_id
    having count(*) > 1
  ) duplicates;
  if duplicate_node_textbox_message_count <> 0 then
    raise exception 'STOP: % exact email message/Node pair(s) are linked to more than one textbox; review those typed relationships before finalizing SQS delivery',
      duplicate_node_textbox_message_count;
  end if;

  select count(*), count(*) filter (where column_name = any (array[
    'email_connection_id','company_id','connection_type','personal_user_id','provider','account_email',
    'grant_id','status','connected_by_user_id','ingestion_started_at','last_successful_scan_at',
    'created_timestamp','updated_timestamp'
  ]::text[]))
  into column_count, final_column_count
  from information_schema.columns
  where table_schema='public' and table_name='email_connections';
  if column_count <> 13 or final_column_count <> 13 then
    raise exception 'STOP: email_connections must have exactly the approved 13 columns; found total %, approved %',
      column_count, final_column_count;
  end if;

  select count(*),
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','provider_attempt_count','attempt_token',
      'enqueue_source_id','last_error','available_at','processing_started_at','completed_timestamp',
      'failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])),
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','provider_attempt_count','attempt_token','enqueue_source_id',
      'sqs_accepted_timestamp','last_error','completed_timestamp','failed_timestamp','created_timestamp',
      'updated_timestamp'
    ]::text[]))
  into column_count, intermediate_column_count, final_column_count
  from information_schema.columns
  where table_schema='public' and table_name='email_ingestion_jobs';
  if column_count = 19 and intermediate_column_count = 19 then
    ingestion_state := 'intermediate';
  elsif column_count = 17 and final_column_count = 17 then
    ingestion_state := 'final';
  else
    raise exception 'STOP: email_ingestion_jobs must be exact previously-applied 19 or exact final 17 columns; found total %, intermediate-approved %, final-approved %',
      column_count, intermediate_column_count, final_column_count;
  end if;

  select count(*),
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','attempt_token','last_error',
      'available_at','processing_started_at','archived_timestamp','failed_timestamp','created_timestamp',
      'updated_timestamp'
    ]::text[])),
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','provider_attempt_count','attempt_token','last_error',
      'archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[]))
  into column_count, intermediate_column_count, final_column_count
  from information_schema.columns
  where table_schema='public' and table_name='communications_email_archive_job_items';
  if column_count = 13 and intermediate_column_count = 13 then
    archive_state := 'intermediate';
  elsif column_count = 11 and final_column_count = 11 then
    archive_state := 'final';
  else
    raise exception 'STOP: communications_email_archive_job_items must be exact previously-applied 13 or exact final 11 columns; found total %, intermediate-approved %, final-approved %',
      column_count, intermediate_column_count, final_column_count;
  end if;

  if ingestion_state <> archive_state then
    raise exception 'STOP: email SQS tables must be coherently all previously-applied or all-final';
  end if;

  select
    (select count(*) from email_ingestion_jobs
      where status is null or status not in ('accepted','processing','completed','parked','exhausted'))+
    (select count(*) from communications_email_archive_job_items
      where status is null or status not in ('pending','processing','archived','failed'))
  into invalid_status_count;
  if invalid_status_count <> 0 then
    raise exception 'STOP: % email SQS row(s) have a status outside the final approved sets',
      invalid_status_count;
  end if;

  select
    (select count(*) from email_ingestion_jobs where status in ('pending','retry','processing'))+
    (select count(*) from communications_email_archive_job_items where status in ('pending','retry','processing'))
  into active_work_count;
  if active_work_count <> 0 then
    raise exception 'STOP: % database-delivered email item(s) must finish or receive deliberate operator review before finalizing SQS delivery',
      active_work_count;
  end if;

  select count(*) into duplicate_identity_count
  from (
    select 1
    from email_ingestion_jobs
    group by company_id,email_connection_id,provider_message_id
    having count(*) > 1
  ) duplicates;
  if duplicate_identity_count <> 0 then
    raise exception 'STOP: email_ingestion_jobs contains % duplicate stable identity group(s); the previously-applied migration must already have collapsed these rows',
      duplicate_identity_count;
  end if;

  if ingestion_state = 'intermediate' then
    drop index if exists idx_email_ingestion_jobs_claim;
    alter table email_ingestion_jobs
      drop constraint if exists email_ingestion_jobs_attempt_chk;
    alter table email_ingestion_jobs
      add column sqs_accepted_timestamp timestamptz,
      drop column attempt_count,
      drop column available_at,
      drop column processing_started_at;

    drop index if exists idx_communications_email_archive_job_items_claim;
    alter table communications_email_archive_job_items
      add column provider_attempt_count integer not null default 0,
      drop column attempt_count,
      drop column available_at,
      drop column processing_started_at;
  end if;

  alter table email_connections
    drop constraint if exists email_connections_status_chk;
  alter table email_connections
    add constraint email_connections_status_chk check (
      status in ('connected','disconnected','reauth_required','configuration_required')
    );

  alter table email_ingestion_jobs
    drop constraint if exists email_ingestion_jobs_status_chk,
    drop constraint if exists email_ingestion_jobs_provider_attempt_chk;
  alter table email_ingestion_jobs
    alter column status set default 'accepted',
    add constraint email_ingestion_jobs_status_chk check (
      status in ('accepted','processing','completed','parked','exhausted')
    ),
    add constraint email_ingestion_jobs_provider_attempt_chk check (
      provider_attempt_count between 0 and 3
    );

  alter table communications_email_archive_job_items
    drop constraint if exists communications_email_archive_job_items_status_chk,
    drop constraint if exists communications_email_archive_job_items_provider_attempt_chk;
  alter table communications_email_archive_job_items
    add constraint communications_email_archive_job_items_status_chk check (
      status in ('pending','processing','archived','failed')
    ),
    add constraint communications_email_archive_job_items_provider_attempt_chk check (
      provider_attempt_count between 0 and 3
    );

  drop index if exists idx_communications_email_archive_job_items_claim;
  drop index if exists idx_email_ingestion_jobs_active_message;
  drop index if exists idx_email_ingestion_jobs_claim;
  drop index if exists idx_email_ingestion_jobs_stable_message;
  create unique index idx_email_ingestion_jobs_stable_message
    on email_ingestion_jobs(company_id,email_connection_id,provider_message_id);

  drop trigger if exists trg_email_relationships_one_node_per_thread on email_relationships;
  drop function if exists mangorts_enforce_one_node_per_email_thread();
  drop index if exists idx_email_relationships_one_node_textbox_per_message;
  create unique index idx_email_relationships_one_node_textbox_per_message
    on email_relationships(company_id,email_message_id,resource_id)
    where resource_type='node' and resource_textbox_id is not null;
end
$migration$;
