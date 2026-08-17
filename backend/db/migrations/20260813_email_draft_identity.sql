-- Shared draft authority is the exact Node and exact ingested source message.
-- The old relationship/collaboration identity is not part of the draft contract.

do $$
declare
  server_number integer := current_setting('server_version_num')::integer;
begin
  raise notice 'email draft identity migration PostgreSQL server_version_num=%', server_number;
  if server_number < 170000 then
    raise exception 'email draft identity migration STOP: PostgreSQL 17 or newer is required';
  end if;
end
$$;

begin;

drop index if exists idx_email_drafts_collaboration_updated;
alter table email_drafts drop constraint if exists email_drafts_collaboration_fkey;
alter table email_drafts drop constraint if exists communications_email_drafts_collaboration_fkey;
alter table email_drafts drop constraint if exists communications_email_drafts_shared_collaboration_chk;
alter table email_drafts drop column if exists collaboration_id;

alter table email_drafts
  add column if not exists is_shared boolean;

update email_drafts
set is_shared=(email_thread_id is not null)
where is_shared is null;

alter table email_drafts
  alter column is_shared set default false,
  alter column is_shared set not null;

alter table email_drafts drop constraint if exists email_drafts_origin_node_chk;
alter table email_drafts add constraint email_drafts_origin_node_chk check (
  (not is_shared and email_thread_id is null and origin_node_id is null and created_by_user_id is not null)
  or
  (is_shared and email_thread_id is not null and origin_node_id is not null and source_email_message_id is not null)
);

drop index if exists idx_email_drafts_active_shared_message_node;
create unique index idx_email_drafts_active_shared_message_node
  on email_drafts(company_id,origin_node_id,source_email_message_id)
  where deleted_timestamp is null and is_shared and send_state in ('draft','sending');

drop index if exists idx_email_drafts_active_personal_message_personal_account;
create unique index idx_email_drafts_active_personal_message_personal_account
  on email_drafts(company_id,created_by_user_id,source_email_message_id,personal_user_id,personal_account_email)
  where deleted_timestamp is null and not is_shared and source_email_message_id is not null
    and email_account_type='personal_email_account' and send_state in ('draft','sending');

drop index if exists idx_email_drafts_active_personal_message_shared_inbox;
create unique index idx_email_drafts_active_personal_message_shared_inbox
  on email_drafts(company_id,created_by_user_id,source_email_message_id,shared_inbox_id)
  where deleted_timestamp is null and not is_shared and source_email_message_id is not null
    and email_account_type='shared_email_account' and send_state in ('draft','sending');

commit;
