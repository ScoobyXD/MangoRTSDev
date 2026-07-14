-- Forward repair for personal read receipts that were initially migrated with
-- a user-wide scope. This filename sorts before the separately committed legacy
-- table drop on fresh installs, but every phase also tolerates that drop having
-- already run on an existing database.
do $$
begin
  if to_regclass('public.communications_message_read_statuses') is not null then
    insert into public.communications_message_read_receipt_summaries as receipt (
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
        when receipt.thread_id <> '' then receipt.thread_id
        else excluded.thread_id
      end,
      status = case
        when receipt.status = 'read' or excluded.status = 'read' then 'read'
        else 'likely_read'
      end,
      signal_count = greatest(receipt.signal_count, excluded.signal_count),
      first_signal_timestamp = least(receipt.first_signal_timestamp, excluded.first_signal_timestamp),
      last_signal_timestamp = greatest(receipt.last_signal_timestamp, excluded.last_signal_timestamp),
      created_timestamp = least(receipt.created_timestamp, excluded.created_timestamp),
      updated_timestamp = greatest(receipt.updated_timestamp, excluded.updated_timestamp);
  end if;
end $$;

with single_personal_accounts as (
  select
    user_id,
    min(lower(btrim(account_email))) as account_email
  from public.user_email_connections
  group by user_id
  having count(*) = 1
)
insert into public.communications_message_read_receipt_summaries as receipt (
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
  legacy.user_id::text || ':' || account.account_email,
  legacy.user_id,
  legacy.message_id,
  legacy.thread_id,
  legacy.status,
  legacy.signal_count,
  legacy.first_signal_timestamp,
  legacy.last_signal_timestamp,
  legacy.created_timestamp,
  legacy.updated_timestamp
from public.communications_message_read_receipt_summaries legacy
join single_personal_accounts account
  on account.user_id = legacy.user_id
where legacy.receipt_scope_type = 'personal'
  and legacy.receipt_scope_id = legacy.user_id::text
on conflict (receipt_scope_type, receipt_scope_id, message_id) do update set
  thread_id = case
    when receipt.thread_id <> '' then receipt.thread_id
    else excluded.thread_id
  end,
  status = case
    when receipt.status = 'read' or excluded.status = 'read' then 'read'
    else 'likely_read'
  end,
  signal_count = greatest(receipt.signal_count, excluded.signal_count),
  first_signal_timestamp = least(receipt.first_signal_timestamp, excluded.first_signal_timestamp),
  last_signal_timestamp = greatest(receipt.last_signal_timestamp, excluded.last_signal_timestamp),
  created_timestamp = least(receipt.created_timestamp, excluded.created_timestamp),
  updated_timestamp = greatest(receipt.updated_timestamp, excluded.updated_timestamp);

-- Rows copied above had one possible stored account. Remaining user-wide rows
-- are multi-account or orphan history, so reset them instead of guessing.
delete from public.communications_message_read_receipt_summaries
where receipt_scope_type = 'personal'
  and receipt_scope_id = user_id::text;

alter table public.communications_message_read_receipt_summaries
  drop constraint if exists communications_message_read_receipt_summaries_personal_chk;

alter table public.communications_message_read_receipt_summaries
  add constraint communications_message_read_receipt_summaries_personal_chk check (
    (
      receipt_scope_type = 'personal'
      and user_id is not null
      and company_email_connection_id is null
      and receipt_scope_id like user_id::text || ':%'
      and length(receipt_scope_id) > length(user_id::text) + 1
    )
    or (
      receipt_scope_type = 'shared'
      and company_id is not null
      and company_email_connection_id is not null
    )
  );
