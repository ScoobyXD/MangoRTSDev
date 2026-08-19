begin;

lock table email_drafts in share row exclusive mode;

alter table email_drafts
  add column if not exists shared_node_id uuid,
  add column if not exists shared_project_id uuid,
  add column if not exists revision bigint not null default 1;

alter table if exists attachment_upload_jobs
  add column if not exists resource_expected_revision bigint not null default 0,
  add column if not exists resource_revision bigint not null default 0;

alter table if exists attachment_upload_jobs
  drop constraint if exists attachment_upload_jobs_resource_revision_chk,
  add constraint attachment_upload_jobs_resource_revision_chk
    check (resource_expected_revision >= 0 and resource_revision >= 0);

alter table email_drafts
  drop constraint if exists email_drafts_shared_node_fkey,
  drop constraint if exists email_drafts_shared_project_fkey,
  drop constraint if exists email_drafts_revision_chk,
  drop constraint if exists email_drafts_shared_owner_chk,
  drop constraint if exists email_drafts_shared_reply_chk;

alter table email_drafts
  add constraint email_drafts_shared_node_fkey
    foreign key (company_id,shared_node_id) references nodes(company_id,node_id) on delete cascade,
  add constraint email_drafts_shared_project_fkey
    foreign key (company_id,shared_project_id) references projects(company_id,project_id) on delete cascade,
  add constraint email_drafts_revision_chk check (revision > 0),
  add constraint email_drafts_shared_owner_chk check (
    (shared_node_id is null and shared_project_id is null)
    or (shared_node_id is not null and shared_project_id is null)
    or (shared_node_id is null and shared_project_id is not null)
  ),
  add constraint email_drafts_shared_reply_chk check (
    (shared_node_id is null and shared_project_id is null)
    or (kind='reply' and source_email_message_id is not null and scheduled_send_timestamp is null)
  );

drop index if exists idx_email_drafts_active_personal_message_personal_account;
drop index if exists idx_email_drafts_active_personal_message_shared_inbox;
create unique index idx_email_drafts_active_personal_message_personal_account
  on email_drafts(company_id,created_by_user_id,source_email_message_id,personal_user_id,personal_account_email)
  where deleted_timestamp is null and source_email_message_id is not null
    and email_account_type='personal_email_account'
    and shared_node_id is null and shared_project_id is null;
create unique index idx_email_drafts_active_personal_message_shared_inbox
  on email_drafts(company_id,created_by_user_id,source_email_message_id,shared_inbox_id)
  where deleted_timestamp is null and source_email_message_id is not null
    and email_account_type='shared_email_account'
    and shared_node_id is null and shared_project_id is null;
create unique index idx_email_drafts_active_shared_node_message
  on email_drafts(company_id,shared_node_id,source_email_message_id)
  where deleted_timestamp is null and shared_node_id is not null;
create unique index idx_email_drafts_active_shared_project_message
  on email_drafts(company_id,shared_project_id,source_email_message_id)
  where deleted_timestamp is null and shared_project_id is not null;
create index idx_email_drafts_resource_shared_mailbox_updated
  on email_drafts(company_id,email_account_type,personal_user_id,personal_account_email,shared_inbox_id,updated_timestamp desc)
  where deleted_timestamp is null and (shared_node_id is not null or shared_project_id is not null);

create or replace function mangorts_lock_live_email_draft_attachment_owner()
returns trigger language plpgsql as $$
begin
  if new.deleted_timestamp is not null or new.resource_type<>'email_draft' then
    return new;
  end if;
  perform 1 from email_drafts
  where company_id=new.company_id and draft_id=new.resource_id
    and deleted_timestamp is null
  for share;
  if not found then
    raise exception 'attachment email draft owner does not exist' using errcode='23503';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attachment_relationships_lock_email_draft_owner on attachment_relationships;
create trigger trg_attachment_relationships_lock_email_draft_owner
before insert or update of company_id,resource_type,resource_id,deleted_timestamp
on attachment_relationships for each row
execute function mangorts_lock_live_email_draft_attachment_owner();

commit;
