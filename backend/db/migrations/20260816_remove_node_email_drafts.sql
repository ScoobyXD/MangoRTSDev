-- Node email is read-only. Remove every Node-scoped draft and the storage that
-- existed only for Node replies while preserving mailbox-scoped Triage drafts.

do $$
declare
  server_number integer := current_setting('server_version_num')::integer;
begin
  raise notice 'remove Node email drafts migration PostgreSQL server_version_num=%', server_number;
  if server_number < 170000 then
    raise exception 'remove Node email drafts migration STOP: PostgreSQL 17 or newer is required';
  end if;
end
$$;

begin;

create temporary table node_email_drafts_to_remove (
  company_id uuid not null,
  draft_id text not null,
  primary key (company_id,draft_id)
) on commit drop;

create temporary table node_email_draft_attachments_to_check (
  company_id uuid not null,
  attachment_id uuid not null,
  primary key (company_id,attachment_id)
) on commit drop;

do $$
declare
  predicate text := '';
begin
  -- A thread ID alone is not Node identity; older mailbox drafts may carry it.
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='email_drafts' and column_name='origin_node_id'
  ) then
    predicate := 'origin_node_id is not null';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='email_drafts' and column_name='is_shared'
  ) then
    predicate := predicate || case when predicate='' then '' else ' or ' end || 'is_shared';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='email_drafts' and column_name='collaboration_id'
  ) then
    predicate := predicate || case when predicate='' then '' else ' or ' end || 'collaboration_id is not null';
  end if;
  if predicate <> '' then
    execute 'insert into node_email_drafts_to_remove(company_id,draft_id) '
      || 'select company_id,draft_id from email_drafts where ' || predicate
      || ' on conflict do nothing';
  end if;
end
$$;

insert into node_email_draft_attachments_to_check(company_id,attachment_id)
select distinct relationship.company_id,relationship.attachment_id
from attachment_relationships relationship
join node_email_drafts_to_remove removed
  on removed.company_id=relationship.company_id
 and removed.draft_id=relationship.resource_id
where relationship.resource_type='email_draft'
  and relationship.deleted_timestamp is null;

update attachment_relationships relationship
set deleted_timestamp=coalesce(relationship.deleted_timestamp,now())
where relationship.resource_type='email_draft'
  and relationship.deleted_timestamp is null
  and exists (
    select 1 from node_email_drafts_to_remove removed
    where removed.company_id=relationship.company_id
      and removed.draft_id=relationship.resource_id
  );

update attachments attachment
set deleted_timestamp=coalesce(attachment.deleted_timestamp,now())
where exists (
    select 1 from node_email_draft_attachments_to_check candidate
    where candidate.company_id=attachment.company_id
      and candidate.attachment_id=attachment.attachment_id
  )
  and not exists (
    select 1 from attachment_relationships relationship
    where relationship.company_id=attachment.company_id
      and relationship.attachment_id=attachment.attachment_id
      and relationship.deleted_timestamp is null
  );

delete from email_drafts draft
using node_email_drafts_to_remove removed
where draft.company_id=removed.company_id
  and draft.draft_id=removed.draft_id;

drop index if exists idx_email_drafts_collaboration_updated;
drop index if exists idx_email_drafts_active_thread;
drop index if exists idx_email_drafts_active_shared_message_node;
drop index if exists idx_email_drafts_origin_node;
drop index if exists idx_email_drafts_active_personal_message_personal_account;
drop index if exists idx_email_drafts_active_personal_message_shared_inbox;

alter table email_drafts drop column if exists collaboration_id cascade;
alter table email_drafts drop column if exists email_thread_id cascade;
alter table email_drafts drop column if exists origin_node_id cascade;
alter table email_drafts drop column if exists is_shared cascade;
alter table email_drafts drop column if exists revision cascade;
alter table email_drafts drop column if exists send_state cascade;
alter table email_drafts drop column if exists send_claim_token cascade;
alter table email_drafts drop column if exists send_idempotency_key cascade;
alter table email_drafts drop column if exists send_idempotency_grant_id cascade;
alter table email_drafts drop column if exists send_idempotency_timestamp cascade;
alter table email_drafts drop column if exists send_claimed_revision cascade;
alter table email_drafts drop column if exists send_claimed_timestamp cascade;
alter table email_drafts drop column if exists sent_email_message_id cascade;
alter table email_drafts drop column if exists sent_provider_message_id cascade;

create unique index idx_email_drafts_active_personal_message_personal_account
  on email_drafts(company_id,created_by_user_id,source_email_message_id,personal_user_id,personal_account_email)
  where deleted_timestamp is null and source_email_message_id is not null
    and email_account_type='personal_email_account';

create unique index idx_email_drafts_active_personal_message_shared_inbox
  on email_drafts(company_id,created_by_user_id,source_email_message_id,shared_inbox_id)
  where deleted_timestamp is null and source_email_message_id is not null
    and email_account_type='shared_email_account';

commit;
