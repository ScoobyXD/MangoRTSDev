create table if not exists communications_email_archive_jobs (
  archive_job_id uuid primary key,
  actor_user_id uuid not null references users(user_id) on delete cascade,
  company_id uuid references companies(company_id) on delete cascade,
  shared_inbox_id uuid,
  connection_scope text not null,
  provider text not null,
  account_email text not null,
  grant_id text not null,
  company_email_connection_id uuid,
  status text not null default 'pending',
  requested_count integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  completed_timestamp timestamptz,
  constraint communications_email_archive_jobs_scope_chk check (connection_scope in ('personal', 'shared')),
  constraint communications_email_archive_jobs_provider_chk check (provider in ('google', 'microsoft')),
  constraint communications_email_archive_jobs_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  constraint communications_email_archive_jobs_grant_id_chk check (btrim(grant_id) <> ''),
  constraint communications_email_archive_jobs_status_chk check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint communications_email_archive_jobs_shared_scope_chk check (
    (connection_scope = 'personal' and shared_inbox_id is null)
    or
    (connection_scope = 'shared' and company_id is not null and shared_inbox_id is not null)
  ),
  foreign key (company_id, shared_inbox_id) references shared_inboxes(company_id, shared_inbox_id) on delete cascade,
  foreign key (company_email_connection_id) references company_email_connections(company_email_connection_id) on delete set null
);

create index if not exists idx_communications_email_archive_jobs_actor_created
  on communications_email_archive_jobs(actor_user_id, created_timestamp desc);

create index if not exists idx_communications_email_archive_jobs_shared_inbox
  on communications_email_archive_jobs(company_id, shared_inbox_id, created_timestamp desc)
  where shared_inbox_id is not null;

create table if not exists communications_email_archive_job_items (
  job_item_id uuid primary key,
  archive_job_id uuid not null references communications_email_archive_jobs(archive_job_id) on delete cascade,
  message_id text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text not null default '',
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  archived_timestamp timestamptz,
  failed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_archive_job_items_message_chk check (btrim(message_id) <> ''),
  constraint communications_email_archive_job_items_status_chk check (status in ('pending', 'processing', 'retry', 'archived', 'failed')),
  unique (archive_job_id, message_id)
);

create index if not exists idx_communications_email_archive_job_items_claim
  on communications_email_archive_job_items(status, available_at, created_timestamp, job_item_id)
  where status in ('pending', 'processing', 'retry');

create index if not exists idx_communications_email_archive_job_items_job
  on communications_email_archive_job_items(archive_job_id, created_timestamp, job_item_id);
