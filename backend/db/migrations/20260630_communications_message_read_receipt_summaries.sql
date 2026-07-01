create table if not exists communications_message_read_receipt_summaries (
  receipt_scope_type varchar not null,
  receipt_scope_id varchar not null,
  user_id uuid references users(user_id) on delete cascade,
  company_id uuid references companies(company_id) on delete cascade,
  company_email_connection_id uuid references company_email_connections(company_email_connection_id) on delete cascade,
  shared_inbox_id uuid,
  message_id text not null,
  thread_id text not null default '',
  status text not null default 'likely_read',
  signal_count integer not null default 0,
  first_signal_timestamp timestamptz not null,
  last_signal_timestamp timestamptz not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (receipt_scope_type, receipt_scope_id, message_id),
  constraint communications_message_read_receipt_summaries_scope_chk check (receipt_scope_type in ('personal', 'shared')),
  constraint communications_message_read_receipt_summaries_message_id_chk check (btrim(message_id) <> ''),
  constraint communications_message_read_receipt_summaries_status_chk check (status in ('likely_read', 'read')),
  constraint communications_message_read_receipt_summaries_signal_count_chk check (signal_count >= 0),
  constraint communications_message_read_receipt_summaries_personal_chk check (
    (receipt_scope_type = 'personal' and user_id is not null and company_email_connection_id is null)
    or (receipt_scope_type = 'shared' and company_id is not null and company_email_connection_id is not null)
  )
);

create index if not exists idx_communications_message_read_receipt_summaries_user_latest
  on communications_message_read_receipt_summaries(user_id, last_signal_timestamp desc)
  where receipt_scope_type = 'personal';

create index if not exists idx_communications_message_read_receipt_summaries_shared_latest
  on communications_message_read_receipt_summaries(company_email_connection_id, last_signal_timestamp desc)
  where receipt_scope_type = 'shared';

create index if not exists idx_communications_message_read_receipt_summaries_thread
  on communications_message_read_receipt_summaries(receipt_scope_type, receipt_scope_id, thread_id)
  where thread_id <> '';

do $$
begin
  if to_regclass('public.communications_message_read_statuses') is not null then
    insert into public.communications_message_read_receipt_summaries (
      receipt_scope_type,
      receipt_scope_id,
      user_id,
      message_id,
      thread_id,
      status,
      signal_count,
      first_signal_timestamp,
      last_signal_timestamp,
      created_timestamp,
      updated_timestamp
    )
    select
      'personal',
      user_id::text,
      user_id,
      message_id,
      thread_id,
      status,
      signal_count,
      first_signal_timestamp,
      last_signal_timestamp,
      created_timestamp,
      updated_timestamp
    from public.communications_message_read_statuses
    on conflict (receipt_scope_type, receipt_scope_id, message_id) do update set
      thread_id = case
        when excluded.thread_id <> '' then excluded.thread_id
        else communications_message_read_receipt_summaries.thread_id
      end,
      status = case
        when communications_message_read_receipt_summaries.status = 'read' or excluded.status = 'read' then 'read'
        else 'likely_read'
      end,
      signal_count = greatest(communications_message_read_receipt_summaries.signal_count, excluded.signal_count),
      first_signal_timestamp = least(communications_message_read_receipt_summaries.first_signal_timestamp, excluded.first_signal_timestamp),
      last_signal_timestamp = greatest(communications_message_read_receipt_summaries.last_signal_timestamp, excluded.last_signal_timestamp),
      updated_timestamp = greatest(communications_message_read_receipt_summaries.updated_timestamp, excluded.updated_timestamp);
  end if;
end $$;
