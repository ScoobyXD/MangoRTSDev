-- Personal drafts are owned by their creator. Shared drafts are scoped to one
-- exact source message in one exact Node. Stop instead of guessing old scope.

update email_drafts
set created_by_user_id=personal_user_id
where email_thread_id is null
  and created_by_user_id is null
  and email_account_type='personal_email_account';

do $$
begin
  if exists (select 1 from email_drafts where email_thread_id is null and created_by_user_id is null) then
    raise exception 'email draft migration stopped: personal draft owner is ambiguous';
  end if;
  if exists (
    select 1 from email_drafts
    where email_thread_id is not null and (origin_node_id is null or source_email_message_id is null)
  ) then
    raise exception 'email draft migration stopped: shared draft Node or source message is ambiguous';
  end if;
end;
$$;

alter table email_drafts drop constraint if exists email_drafts_origin_node_chk;
alter table email_drafts add constraint email_drafts_origin_node_chk check (
  (email_thread_id is null and origin_node_id is null and created_by_user_id is not null)
  or
  (email_thread_id is not null and origin_node_id is not null and source_email_message_id is not null)
);

alter table email_drafts drop constraint if exists email_drafts_company_id_origin_node_id_fkey;
alter table email_drafts add constraint email_drafts_company_id_origin_node_id_fkey
  foreign key (company_id,origin_node_id)
  references nodes(company_id,node_id) on delete cascade;

drop index if exists idx_email_drafts_active_thread;
create unique index if not exists idx_email_drafts_active_shared_message_node
  on email_drafts(company_id,origin_node_id,source_email_message_id)
  where deleted_timestamp is null and email_thread_id is not null and send_state in ('draft','sending');
create unique index if not exists idx_email_drafts_active_personal_message_personal_account
  on email_drafts(company_id,created_by_user_id,source_email_message_id,personal_user_id,personal_account_email)
  where deleted_timestamp is null and email_thread_id is null and source_email_message_id is not null
    and email_account_type='personal_email_account' and send_state in ('draft','sending');
create unique index if not exists idx_email_drafts_active_personal_message_shared_inbox
  on email_drafts(company_id,created_by_user_id,source_email_message_id,shared_inbox_id)
  where deleted_timestamp is null and email_thread_id is null and source_email_message_id is not null
    and email_account_type='shared_email_account' and send_state in ('draft','sending');
