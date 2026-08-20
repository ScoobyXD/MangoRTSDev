begin;

lock table email_drafts in share row exclusive mode;

alter table email_drafts
  add column shared_resource_type text,
  add column shared_resource_id uuid,
  add column revision bigint not null default 1,
  add constraint email_drafts_revision_chk check (revision > 0),
  add constraint email_drafts_shared_owner_chk check (
    (shared_resource_type is null and shared_resource_id is null)
    or (shared_resource_type is not null and shared_resource_id is not null
      and shared_resource_type in ('node','project'))
  ),
  add constraint email_drafts_shared_reply_chk check (
    shared_resource_type is null
    or (kind='reply' and source_email_message_id is not null and scheduled_send_timestamp is null)
  );

drop index idx_email_drafts_active_personal_message_personal_account;
drop index idx_email_drafts_active_personal_message_shared_inbox;
create unique index idx_email_drafts_active_personal_message_personal_account
  on email_drafts(company_id,created_by_user_id,source_email_message_id,personal_user_id,personal_account_email)
  where deleted_timestamp is null and source_email_message_id is not null
    and email_account_type='personal_email_account'
    and shared_resource_type is null and shared_resource_id is null;
create unique index idx_email_drafts_active_personal_message_shared_inbox
  on email_drafts(company_id,created_by_user_id,source_email_message_id,shared_inbox_id)
  where deleted_timestamp is null and source_email_message_id is not null
    and email_account_type='shared_email_account'
    and shared_resource_type is null and shared_resource_id is null;
create unique index idx_email_drafts_active_shared_resource_message
  on email_drafts(company_id,shared_resource_type,shared_resource_id,source_email_message_id)
  where deleted_timestamp is null and shared_resource_type is not null;
create index idx_email_drafts_resource_shared_mailbox_updated
  on email_drafts(company_id,email_account_type,personal_user_id,personal_account_email,shared_inbox_id,updated_timestamp desc)
  where deleted_timestamp is null and shared_resource_type is not null;

create or replace function mangorts_validate_email_draft_shared_owner()
returns trigger language plpgsql as $$
begin
  if new.deleted_timestamp is not null or new.shared_resource_type is null then
    return new;
  end if;
  if new.shared_resource_type='node' then
    perform 1 from nodes where company_id=new.company_id and node_id=new.shared_resource_id for key share;
  elsif new.shared_resource_type='project' then
    perform 1 from projects where company_id=new.company_id and project_id=new.shared_resource_id for key share;
  else
    raise exception 'shared email draft owner type is invalid'
      using errcode='23514', constraint='email_drafts_shared_owner_chk';
  end if;
  if not found then
    raise exception 'shared email draft owner does not exist in company'
      using errcode='23503', constraint='email_drafts_shared_owner_fkey';
  end if;
  perform 1 from email_relationships
  where company_id=new.company_id and email_message_id=new.source_email_message_id
    and resource_type=new.shared_resource_type and resource_id=new.shared_resource_id
    and resource_textbox_id is null
  for share;
  if not found then
    raise exception 'shared email draft source relationship does not exist'
      using errcode='23503', constraint='email_drafts_shared_source_relationship_fkey';
  end if;
  return new;
end;
$$;

create trigger trg_validate_email_draft_shared_owner
before insert or update of company_id,shared_resource_type,shared_resource_id,source_email_message_id,deleted_timestamp
on email_drafts for each row execute function mangorts_validate_email_draft_shared_owner();

create or replace function mangorts_protect_shared_email_draft_owner()
returns trigger language plpgsql as $$
declare owner_id uuid;
begin
  if not exists (select 1 from companies where company_id=old.company_id) then
    if tg_op='UPDATE' then return new; end if;
    return old;
  end if;
  if tg_table_name='nodes' then
    if tg_op='UPDATE' and old.company_id is not distinct from new.company_id and old.node_id is not distinct from new.node_id then return new; end if;
    owner_id:=old.node_id;
  else
    if tg_op='UPDATE' and old.company_id is not distinct from new.company_id and old.project_id is not distinct from new.project_id then return new; end if;
    owner_id:=old.project_id;
  end if;
  if exists (select 1 from email_drafts where company_id=old.company_id
    and shared_resource_type=case when tg_table_name='nodes' then 'node' else 'project' end
    and shared_resource_id=owner_id and deleted_timestamp is null) then
    raise exception 'resource is required by a shared email draft'
      using errcode='23503', constraint='shared_email_draft_owner_required';
  end if;
  if tg_op='UPDATE' then return new; end if;
  return old;
end;
$$;

create trigger trg_protect_node_shared_email_draft_owner
before delete or update of company_id,node_id on nodes
for each row execute function mangorts_protect_shared_email_draft_owner();
create trigger trg_protect_project_shared_email_draft_owner
before delete or update of company_id,project_id on projects
for each row execute function mangorts_protect_shared_email_draft_owner();

create or replace function mangorts_protect_shared_email_draft_relationship()
returns trigger language plpgsql as $$
begin
  if old.resource_textbox_id is null and old.resource_type in ('node','project')
    and exists (select 1 from email_drafts where company_id=old.company_id
      and shared_resource_type=old.resource_type and shared_resource_id=old.resource_id
      and source_email_message_id=old.email_message_id and deleted_timestamp is null) then
    raise exception 'wide email relationship is required by a shared email draft'
      using errcode='23503', constraint='shared_email_draft_source_relationship_required';
  end if;
  return old;
end;
$$;

create constraint trigger trg_protect_shared_email_draft_relationship
after delete or update of company_id,email_message_id,resource_type,resource_id,resource_textbox_id
on email_relationships deferrable initially deferred
for each row execute function mangorts_protect_shared_email_draft_relationship();

alter table attachment_upload_jobs
  add column resource_expected_revision bigint not null default 0,
  add column resource_revision bigint not null default 0,
  add constraint attachment_upload_jobs_resource_revision_chk
    check (resource_expected_revision >= 0 and resource_revision >= 0);

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

create trigger trg_attachment_relationships_lock_email_draft_owner
before insert or update of company_id,resource_type,resource_id,deleted_timestamp
on attachment_relationships for each row
execute function mangorts_lock_live_email_draft_attachment_owner();

commit;
