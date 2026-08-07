-- V3 email ingestion cutover. PostgreSQL 17.x compatible.
-- This keeps the existing company connection, thread, message, relationship,
-- and job rows in place while replacing their runtime identity columns.

do $migration$
declare
  rollout_at timestamptz := transaction_timestamp();
  ambiguous_personal_count bigint;
  duplicate_grant_count bigint;
  missing_thread_connection_count bigint;
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: V3 email ingestion requires PostgreSQL 17.x or newer; connected server is %',
      current_setting('server_version');
  end if;

  if to_regclass('public.email_connections') is not null
     and to_regclass('public.company_email_connections') is null then
    if to_regclass('public.user_email_connections') is null
       and to_regclass('public.email_ingestion_jobs') is not null
       and to_regclass('public.email_thread_download_jobs') is null then
      return;
    end if;
    raise exception 'STOP: partial V3 email ingestion cutover detected; do not guess or drop remaining tables';
  end if;
  if to_regclass('public.company_email_connections') is null
     or to_regclass('public.user_email_connections') is null then
    raise exception 'STOP: expected user_email_connections and company_email_connections before V3 email ingestion cutover';
  end if;

  select count(*) into ambiguous_personal_count
  from user_email_connections connection
  where (
    select count(*)
    from company_memberships membership
    where membership.user_id=connection.user_id
  ) <> 1;
  if ambiguous_personal_count <> 0 then
    raise exception 'STOP: % personal email connection(s) do not map to exactly one company; resolve those rows explicitly before retrying',
      ambiguous_personal_count;
  end if;

  select count(*) into duplicate_grant_count
  from (
    select grant_id
    from (
      select grant_id from company_email_connections
      union all
      select grant_id from user_email_connections
    ) all_connections
    group by grant_id
    having count(*) > 1
  ) duplicates;
  if duplicate_grant_count <> 0 then
    raise exception 'STOP: % grant ID(s) occur more than once across the two source connection tables; resolve them before retrying',
      duplicate_grant_count;
  end if;

  alter table company_email_connections rename to email_connections;
  alter table email_connections rename column company_email_connection_id to email_connection_id;
  alter table email_connections
    drop constraint if exists company_email_connections_company_id_account_email_key,
    drop constraint if exists company_email_connections_company_id_grant_id_key;
  alter table email_connections
    add column connection_type text,
    add column personal_user_id uuid,
    add column ingestion_started_at timestamptz,
    add column last_successful_scan_at timestamptz;

  update email_connections
  set connection_type='shared',
      ingestion_started_at=rollout_at,
      last_successful_scan_at=rollout_at;

  insert into email_connections (
    email_connection_id,company_id,connection_type,personal_user_id,
    provider,account_email,grant_id,status,connected_by_user_id,
    ingestion_started_at,last_successful_scan_at,created_timestamp,updated_timestamp
  )
  select
    md5('email_connection:' || membership.company_id::text || ':' ||
        connection.user_id::text || ':' || connection.account_email)::uuid,
    membership.company_id,'personal',connection.user_id,
    connection.provider,connection.account_email,connection.grant_id,connection.status,
    connection.user_id,rollout_at,rollout_at,
    connection.created_timestamp,connection.updated_timestamp
  from user_email_connections connection
  join company_memberships membership on membership.user_id=connection.user_id;

  if (select count(*) from email_connections where connection_type='personal')
     <> (select count(*) from user_email_connections) then
    raise exception 'STOP: personal email connection count mismatch after in-place cutover copy';
  end if;

  alter table email_connections
    alter column connection_type set not null,
    alter column ingestion_started_at set not null,
    alter column last_successful_scan_at set not null;

  alter table email_connections
    drop constraint if exists company_email_connections_provider_chk,
    drop constraint if exists company_email_connections_account_email_chk,
    drop constraint if exists company_email_connections_grant_id_nonblank_chk,
    drop constraint if exists company_email_connections_status_chk,
    add constraint email_connections_type_chk check (connection_type in ('personal','shared')),
    add constraint email_connections_scope_chk check (
      (connection_type='personal' and personal_user_id is not null)
      or (connection_type='shared' and personal_user_id is null)
    ),
    add constraint email_connections_provider_chk check (provider in ('google','microsoft')),
    add constraint email_connections_account_email_chk check (
      btrim(account_email)<>'' and account_email=lower(btrim(account_email))
    ),
    add constraint email_connections_grant_id_nonblank_chk check (btrim(grant_id)<>''),
    add constraint email_connections_status_chk check (
      status in ('connected','disconnected','reauth_required')
    ),
    add constraint email_connections_checkpoint_chk check (
      last_successful_scan_at>=ingestion_started_at
    ),
    add constraint email_connections_personal_user_fkey
      foreign key (personal_user_id) references users(user_id) on delete cascade;

  create unique index idx_email_connections_grant_id
    on email_connections(grant_id);
  create unique index idx_email_connections_personal
    on email_connections(company_id,personal_user_id,account_email)
    where connection_type='personal';
  create unique index idx_email_connections_shared
    on email_connections(company_id,account_email)
    where connection_type='shared';
  create index idx_email_connections_company_status
    on email_connections(company_id,status,last_successful_scan_at);

  drop index if exists idx_company_email_connections_company_status;
  drop index if exists idx_user_email_connections_grant_id;
  drop index if exists idx_user_email_connections_user_updated;
  drop table user_email_connections;

  alter table email_threads add column email_connection_id uuid;
  update email_threads thread
  set email_connection_id=connection.email_connection_id
  from email_connections connection
  where thread.email_account_type='personal_email_account'
    and connection.company_id=thread.company_id
    and connection.connection_type='personal'
    and connection.personal_user_id=thread.personal_user_id
    and connection.account_email=thread.personal_account_email;
  update email_threads thread
  set email_connection_id=connection.email_connection_id
  from shared_inboxes inbox
  join email_connections connection
    on connection.company_id=inbox.company_id
   and connection.email_connection_id=inbox.company_email_connection_id
  where thread.email_account_type='shared_email_account'
    and inbox.company_id=thread.company_id
    and inbox.shared_inbox_id=thread.shared_inbox_id;

  select count(*) into missing_thread_connection_count
  from email_threads where email_connection_id is null;
  if missing_thread_connection_count <> 0 then
    raise exception 'STOP: % email thread(s) could not resolve an exact email connection',
      missing_thread_connection_count;
  end if;

  drop index if exists idx_email_threads_personal_provider;
  drop index if exists idx_email_threads_shared_provider;
  alter table email_threads
    drop constraint if exists email_threads_account_type_chk,
    drop constraint if exists email_threads_account_scope_chk,
    drop constraint if exists email_threads_account_email_chk,
    drop constraint if exists email_threads_personal_account_email_chk,
    drop constraint if exists email_threads_provider_chk,
    alter column email_connection_id set not null,
    add constraint email_threads_email_connection_fkey
      foreign key (company_id,email_connection_id)
      references email_connections(company_id,email_connection_id) on delete cascade,
    drop column email_account_type,
    drop column personal_user_id,
    drop column personal_account_email,
    drop column shared_inbox_id,
    drop column email_account_email,
    drop column provider;
  create unique index idx_email_threads_connection_provider
    on email_threads(company_id,email_connection_id,provider_thread_key);

  alter table email_thread_download_jobs rename to email_ingestion_jobs;
  alter table email_ingestion_jobs rename column download_job_id to ingestion_job_id;
  alter table email_ingestion_jobs
    add column email_connection_id uuid,
    add column provider_message_id text,
    add column provider_thread_id text not null default '',
    add column priority smallint not null default 20;
  update email_ingestion_jobs job
  set email_connection_id=thread.email_connection_id,
      provider_message_id=case
        when btrim(job.requested_provider_message_id)<>'' then job.requested_provider_message_id
        else thread.root_provider_message_id
      end,
      provider_thread_id=thread.provider_thread_id
  from email_threads thread
  where thread.company_id=job.company_id
    and thread.email_thread_id=job.email_thread_id;

  -- The old schema allowed one active full-thread job and one active message
  -- job for the same root message. The new worker always reconciles the full
  -- provider thread, so retain the oldest active row and close only redundant
  -- active rows without deleting their history.
  with ranked_active_jobs as (
    select ingestion_job_id,
           row_number() over (
             partition by company_id,email_connection_id,provider_message_id
             order by created_timestamp,ingestion_job_id
           ) as active_rank
    from email_ingestion_jobs
    where status in ('pending','processing','retry')
  )
  update email_ingestion_jobs job
  set status='completed',
      last_error='superseded_by_email_ingestion_cutover',
      processing_started_at=null,
      completed_timestamp=coalesce(job.completed_timestamp,rollout_at),
      failed_timestamp=null,
      updated_timestamp=rollout_at
  from ranked_active_jobs ranked
  where ranked.ingestion_job_id=job.ingestion_job_id
    and ranked.active_rank>1;

  drop index if exists idx_email_thread_download_jobs_active_full;
  drop index if exists idx_email_thread_download_jobs_active_message;
  drop index if exists idx_email_thread_download_jobs_claim;
  alter table email_ingestion_jobs
    drop constraint if exists email_thread_download_jobs_company_id_email_thread_id_fkey,
    drop constraint if exists email_thread_download_jobs_requested_by_user_id_fkey,
    drop constraint if exists email_thread_download_jobs_scope_chk,
    drop constraint if exists email_thread_download_jobs_status_chk,
    drop constraint if exists email_thread_download_jobs_attempt_chk,
    alter column email_connection_id set not null,
    alter column provider_message_id set not null,
    alter column email_thread_id drop not null,
    add constraint email_ingestion_jobs_connection_fkey
      foreign key (company_id,email_connection_id)
      references email_connections(company_id,email_connection_id) on delete cascade,
    add constraint email_ingestion_jobs_thread_fkey
      foreign key (company_id,email_thread_id)
      references email_threads(company_id,email_thread_id) on delete set null,
    add constraint email_ingestion_jobs_message_chk check (btrim(provider_message_id)<>''),
    add constraint email_ingestion_jobs_priority_chk check (priority between 0 and 100),
    add constraint email_ingestion_jobs_status_chk check (
      status in ('pending','processing','retry','completed','failed')
    ),
    add constraint email_ingestion_jobs_attempt_chk check (attempt_count>=0),
    drop column download_scope,
    drop column requested_provider_message_id,
    drop column requested_by_user_id;
  create unique index idx_email_ingestion_jobs_active_message
    on email_ingestion_jobs(company_id,email_connection_id,provider_message_id)
    where status in ('pending','processing','retry');
  create index idx_email_ingestion_jobs_claim
    on email_ingestion_jobs(status,priority,available_at,created_timestamp)
    where status in ('pending','processing','retry');
end
$migration$;
