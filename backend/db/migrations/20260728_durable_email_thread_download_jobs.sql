-- Replace the old process-local email-thread download terminology/state with
-- durable, leased, retryable jobs. Apply through the human-reviewed migration
-- process; agents must not apply this migration to a live database.

alter table communications_email_threads
  drop constraint if exists communications_email_threads_hydration_chk;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema=current_schema()
      and table_name='communications_email_threads'
      and column_name='hydration_status'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema=current_schema()
      and table_name='communications_email_threads'
      and column_name='download_status'
  ) then
    alter table communications_email_threads
      rename column hydration_status to download_status;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema=current_schema()
      and table_name='communications_email_threads'
      and column_name='last_hydration_error'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema=current_schema()
      and table_name='communications_email_threads'
      and column_name='last_download_error'
  ) then
    alter table communications_email_threads
      rename column last_hydration_error to last_download_error;
  end if;
end $$;

alter table communications_email_threads
  drop constraint if exists communications_email_threads_download_status_chk;

alter table communications_email_threads
  add constraint communications_email_threads_download_status_chk check (
    download_status in ('partial', 'downloading', 'complete', 'failed')
    and (not history_complete or download_status in ('downloading', 'complete', 'failed'))
  );

alter table communications_email_messages
  add column if not exists download_complete boolean not null default false;

-- Existing complete rows predate Mango-owned attachment copying. Leave message
-- rows incomplete so the next explicit import can safely resume missing files.

create table if not exists communications_email_thread_download_jobs (
  download_job_id uuid primary key,
  company_id uuid not null,
  email_thread_id uuid not null,
  download_scope text not null,
  requested_provider_message_id text not null default '',
  requested_by_user_id uuid,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text not null default '',
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_timestamp timestamptz,
  failed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_thread_download_jobs_scope_chk check (
    (download_scope='full_thread' and requested_provider_message_id='')
    or (download_scope='message' and btrim(requested_provider_message_id)<>'')
  ),
  constraint communications_email_thread_download_jobs_status_chk check (status in ('pending','processing','retry','completed','failed')),
  constraint communications_email_thread_download_jobs_attempt_chk check (attempt_count >= 0),
  foreign key (company_id, email_thread_id)
    references communications_email_threads(company_id, email_thread_id) on delete cascade,
  foreign key (requested_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_communications_email_thread_download_jobs_active_full
  on communications_email_thread_download_jobs(company_id, email_thread_id)
  where download_scope='full_thread' and status in ('pending','processing','retry');

create unique index if not exists idx_communications_email_thread_download_jobs_active_message
  on communications_email_thread_download_jobs(company_id, email_thread_id, requested_provider_message_id)
  where download_scope='message' and status in ('pending','processing','retry');

create index if not exists idx_communications_email_thread_download_jobs_claim
  on communications_email_thread_download_jobs(status, available_at, created_timestamp)
  where status in ('pending','processing','retry');
