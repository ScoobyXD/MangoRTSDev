-- Personal drafts are owned by their creator. Shared drafts are scoped to one
-- exact source message in one exact Node. Obsolete rows without that exact
-- identity are removed instead of guessing a new scope.

begin;

update email_drafts
set created_by_user_id=personal_user_id
where email_thread_id is null
  and created_by_user_id is null
  and email_account_type='personal_email_account';

update attachment_relationships relationship
set deleted_timestamp=now()
where relationship.resource_type='email_draft'
  and relationship.deleted_timestamp is null
  and exists (
    select 1
    from email_drafts draft
    where draft.company_id=relationship.company_id
      and draft.draft_id=relationship.resource_id
      and (
        (draft.email_thread_id is null and draft.created_by_user_id is null)
        or
        (draft.email_thread_id is not null and (draft.origin_node_id is null or draft.source_email_message_id is null))
      )
  );

delete from email_drafts
where (email_thread_id is null and created_by_user_id is null)
   or (email_thread_id is not null and (origin_node_id is null or source_email_message_id is null));

alter table email_drafts drop constraint if exists email_drafts_origin_node_chk;
alter table email_drafts add constraint email_drafts_origin_node_chk check (
  (email_thread_id is null and origin_node_id is null and created_by_user_id is not null)
  or
  (email_thread_id is not null and origin_node_id is not null and source_email_message_id is not null)
);

alter table email_drafts drop constraint if exists email_drafts_origin_node_fkey;
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

commit;
