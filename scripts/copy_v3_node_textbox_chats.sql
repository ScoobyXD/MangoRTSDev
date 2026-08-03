-- Operator-gated V3 Node textbox chat snapshot copy.
--
-- Preconditions:
--   1. The expansion component from the operator-controlled Step 2 has run.
--   2. This is run by a human-approved database operator.
--
-- This script never updates or deletes a legacy row. It copies every safely
-- classified current projection, records every source disposition, and leaves
-- review rows untouched. Rerunning it copies only a later delta and reports
-- exact existing targets as already_copied.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

create temporary table mangorts_v3_current_chat_run (
  run_id uuid primary key
) on commit preserve rows;

insert into mangorts_v3_current_chat_run(run_id) values (gen_random_uuid());

insert into v3_migration_runs(run_id, phase, mapping_version, mapping_checksum, status)
select
  run_id,
  'node_textbox_chats',
  2,
  md5(
    pg_get_viewdef('v3_node_textbox_chat_source_v1'::regclass, true)
    || pg_get_functiondef('v3_migration_try_jsonb_v1(text)'::regprocedure)
    || pg_get_functiondef('v3_migration_try_uuid_v1(text)'::regprocedure)
    || pg_get_functiondef('v3_migration_try_integer_v1(text)'::regprocedure)
    || pg_get_functiondef('v3_migration_try_timestamptz_v1(text)'::regprocedure)
    || pg_get_functiondef('v3_migration_try_chat_attachment_ids_v1(jsonb)'::regprocedure)
    || pg_get_functiondef('v3_migration_try_uuid_array_v1(jsonb)'::regprocedure)
  ),
  'running'
from mangorts_v3_current_chat_run;

create temporary table mangorts_v3_chat_copy_source on commit drop as
select *
from v3_node_textbox_chat_source_v1
order by company_id, node_id, chat_id;

insert into node_textbox_chats(
  company_id,
  chat_id,
  node_id,
  textbox_id,
  parent_chat_id,
  selection_source,
  selection_textbox_id,
  selection_email_message_id,
  selection_quote,
  selection_start,
  selection_end,
  author_user_id,
  author_display_name,
  message,
  edited_timestamp,
  entity_links,
  mentioned_user_ids,
  mentioned_group_ids,
  revision,
  created_timestamp,
  updated_timestamp,
  deleted_timestamp
)
select
  source.company_id,
  source.chat_id,
  source.node_id,
  source.textbox_id,
  null,
  source.selection_source,
  source.selection_textbox_id,
  source.selection_email_message_id,
  source.selection_quote,
  source.selection_start,
  source.selection_end,
  source.author_user_id,
  source.author_display_name,
  source.message,
  source.edited_timestamp,
  source.entity_links,
  source.mentioned_user_ids,
  source.mentioned_group_ids,
  source.revision,
  source.created_timestamp,
  source.updated_timestamp,
  source.deleted_timestamp
from mangorts_v3_chat_copy_source source
where source.migration_state = 'ready_to_copy'
order by source.company_id, source.node_id, source.chat_id
on conflict (company_id, chat_id) do nothing;
insert into resource_attachments(
  resource_attachment_id,
  company_id,
  resource_type,
  resource_id,
  attachment_id,
  information_id,
  message_id,
  editor_surface,
  relationship_kind,
  created_by_user_id,
  created_timestamp
)
select
  gen_random_uuid(),
  source.company_id,
  'node_chat_message',
  source.chat_id::text,
  attachment_id,
  source.textbox_id,
  '',
  'node_textbox_chat',
  'chat_attachment',
  source.author_user_id,
  source.created_timestamp
from mangorts_v3_chat_copy_source source
cross join lateral unnest(source.attachment_ids) attachment(attachment_id)
where source.migration_state = 'ready_to_copy'
  and not exists (
    select 1
    from resource_attachments existing
    where existing.company_id=source.company_id
      and existing.resource_type='node_chat_message'
      and existing.resource_id=source.chat_id::text
      and existing.attachment_id=attachment.attachment_id
      and existing.relationship_kind='chat_attachment'
      and existing.deleted_timestamp is null
  );


-- Parents are linked only after all copyable rows exist. A missing, malformed,
-- wrong-textbox, hostless, or otherwise uncopyable parent leaves the reply as a
-- top-level comment, which is the documented V3 retention rule.
update node_textbox_chats target
set parent_chat_id = source.parent_chat_id
from mangorts_v3_chat_copy_source source
where source.migration_state = 'ready_to_copy'
  and source.parent_chat_id is not null
  and target.company_id = source.company_id
  and target.chat_id = source.chat_id;

-- A concurrent or unexpected target conflict rolls the transaction back. The
-- source tables remain untouched and a rerun is safe.
do $$
begin
  if exists (
    select 1
    from mangorts_v3_chat_copy_source source
    join v3_node_textbox_chat_source_v1 current_state
      on current_state.company_id = source.company_id
     and current_state.node_id = source.node_id
     and current_state.chat_id = source.chat_id
    where source.migration_state = 'ready_to_copy'
      and current_state.migration_state <> 'already_copied'
  ) then
    raise exception 'V3 Node textbox chat copy produced an unexpected target mismatch';
  end if;
end
$$;

insert into v3_migration_items(
  run_id,
  phase,
  company_id,
  node_id,
  source_id,
  target_id,
  disposition,
  reason,
  source_checksum,
  details
)
select
  run.run_id,
  'node_textbox_chats',
  source.company_id,
  source.node_id,
  source.chat_id,
  case
    when source.migration_state in ('ready_to_copy', 'already_copied') then source.chat_id
    else null
  end,
  case
    when source.migration_state = 'ready_to_copy' then 'copied'
    when source.migration_state = 'already_copied' then 'already_copied'
    when source.migration_state = 'discarded_deleted_host' then 'discarded_deleted_host'
    else 'needs_human_mapping'
  end,
  source.migration_reason,
  source.source_checksum,
  jsonb_build_object(
    'textbox_id', source.textbox_id,
    'requested_parent_chat_id', source.requested_parent_chat_id,
    'parent_detached', source.parent_detached,
    'legacy_selection_message_id', source.legacy_selection_message_id,
    'issue_codes', source.issue_codes
  )
from mangorts_v3_chat_copy_source source
cross join mangorts_v3_current_chat_run run
order by source.company_id, source.node_id, source.chat_id;

update v3_migration_runs run
set
  status = case
    when exists (
      select 1
      from v3_migration_items item
      where item.run_id = run.run_id
        and item.disposition = 'needs_human_mapping'
    ) then 'needs_review'
    else 'complete'
  end,
  summary = (
    select jsonb_build_object(
      'source_rows', count(*),
      'copied', count(*) filter (where item.disposition = 'copied'),
      'already_copied', count(*) filter (where item.disposition = 'already_copied'),
      'discarded_deleted_host', count(*) filter (where item.disposition = 'discarded_deleted_host'),
      'needs_human_mapping', count(*) filter (where item.disposition = 'needs_human_mapping')
    )
    from v3_migration_items item
    where item.run_id = run.run_id
  ),
  completed_timestamp = now()
where run.run_id = (select run_id from mangorts_v3_current_chat_run);

commit;

select
  run.run_id,
  run.phase,
  run.mapping_version,
  run.mapping_checksum,
  run.status,
  run.summary,
  run.started_timestamp,
  run.completed_timestamp
from v3_migration_runs run
where run.run_id = (select run_id from mangorts_v3_current_chat_run);

drop table mangorts_v3_current_chat_run;
