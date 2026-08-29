-- Transactional sanitizer for the one-time Dev -> QA cleaned data copy.
--
-- Run only in an isolated raw scratch database named
-- mangorts_qa_raw_YYYYMMDD[_suffix]. Keep the QA API and email worker stopped,
-- and review qa_dev_copy_preflight.sql first. This script deliberately omits
-- every attachment and disables every imported Cognito/Nylas identity.
--
-- After commit, export data only, excluding schema_migrations, into a fresh
-- current-repository canonical database. Never use this raw database directly
-- as the application database.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';
set local idle_in_transaction_session_timeout = '30min';

do $guard$
declare
  missing_root_count integer;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: QA copy sanitizer requires PostgreSQL 17.x; connected server_version=%',
      current_setting('server_version');
  end if;

  if current_database() !~ '^mangorts_qa_raw_[0-9]{8}(_[a-z0-9]+)*$'
     or lower(current_database()) ~ '(dev|prod)' then
    raise exception 'STOP: QA copy sanitizer requires an isolated mangorts_qa_raw_YYYYMMDD scratch database; connected database=%',
      current_database();
  end if;

  if current_setting('transaction_read_only') <> 'off' then
    raise exception 'STOP: QA copy sanitizer cannot run in a read-only transaction';
  end if;

  if to_regclass('public.company_explorer_folders') is null
     or to_regclass('public.huddle_explorer_folders') is null
     or to_regclass('public.users') is null
     or to_regclass('public.attachments') is null
     or to_regclass('public.entity_types') is null
     or to_regclass('public.entity_folders') is null
     or to_regclass('public.entity_field_types') is null
     or to_regclass('public.entities') is null
     or to_regclass('public.entity_fields') is null
     or to_regclass('public.entity_relationships') is null
     or to_regclass('public.huddle_node_textboxes') is null
     or to_regclass('public.huddle_node_textbox_chats') is null then
    raise exception 'STOP: required Mango tables are missing from the raw QA copy';
  end if;

  with excluded_root_names(name) as (
    values
      ('sidebar huddles private'),('tk'),('finance 1'),('finance 1.5'),
      ('finance 2'),('hr 1'),('hr 1.5'),('hr 2'),('legal'),('fo')
  )
  select count(*)
    into missing_root_count
  from excluded_root_names root_name
  where not exists (
    select 1 from public.company_explorer_folders folder
    where folder.parent_folder_id is null
      and lower(btrim(folder.name)) = root_name.name
  )
    and not exists (
      select 1 from public.huddle_explorer_folders folder
      where folder.parent_folder_id is null
        and lower(btrim(folder.name)) = root_name.name
    );

  if missing_root_count <> 0 then
    raise exception 'STOP: % required excluded root name(s) were not found at the root of either explorer',
      missing_root_count;
  end if;

  if exists (
    select 1
    from public.company_explorer_folders folder
    where folder.parent_folder_id is null
      and lower(btrim(folder.name)) in (
        'sidebar huddles private','tk','finance 1','finance 1.5','finance 2',
        'hr 1','hr 1.5','hr 2','legal','fo'
      )
    group by folder.company_id, lower(btrim(folder.name))
    having count(*) <> 1
  ) then
    raise exception 'STOP: a company explorer has duplicate excluded root names';
  end if;

  if exists (
    select 1
    from public.huddle_explorer_folders folder
    where folder.parent_folder_id is null
      and lower(btrim(folder.name)) in (
        'sidebar huddles private','tk','finance 1','finance 1.5','finance 2',
        'hr 1','hr 1.5','hr 2','legal','fo'
      )
    group by folder.company_id, lower(btrim(folder.name))
    having count(*) <> 1
  ) then
    raise exception 'STOP: a Huddle explorer has duplicate excluded root names';
  end if;
end
$guard$;

create temp table qa_excluded_resources (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  primary key (company_id, resource_type, resource_id)
) on commit drop;

with recursive
excluded_root_names(name) as (
  values
    ('sidebar huddles private'),('tk'),('finance 1'),('finance 1.5'),
    ('finance 2'),('hr 1'),('hr 1.5'),('hr 2'),('legal'),('fo')
), seeds(company_id, resource_type, resource_id) as (
  select folder.company_id, 'company_explorer_folder'::text, folder.folder_id
  from public.company_explorer_folders folder
  join excluded_root_names root_name on root_name.name = lower(btrim(folder.name))
  where folder.parent_folder_id is null
  union
  select folder.company_id, 'huddle_explorer_folder', folder.folder_id
  from public.huddle_explorer_folders folder
  join excluded_root_names root_name on root_name.name = lower(btrim(folder.name))
  where folder.parent_folder_id is null
), edges(from_company_id, from_type, from_id, to_company_id, to_type, to_id) as (
  select parent.company_id, 'company_explorer_folder', parent.folder_id,
         child.company_id, 'company_explorer_folder', child.folder_id
  from public.company_explorer_folders child
  join public.company_explorer_folders parent
    on parent.company_id = child.company_id and parent.folder_id = child.parent_folder_id
  union
  select folder.company_id, 'company_explorer_folder', folder.folder_id,
         item.company_id, item.target_type, item.target_id
  from public.company_explorer_items item
  join public.company_explorer_folders folder
    on folder.company_id = item.company_id and folder.folder_id = item.parent_folder_id
  union
  select parent.company_id, 'huddle_explorer_folder', parent.folder_id,
         child.company_id, 'huddle_explorer_folder', child.folder_id
  from public.huddle_explorer_folders child
  join public.huddle_explorer_folders parent
    on parent.company_id = child.company_id and parent.folder_id = child.parent_folder_id
  union
  select folder.company_id, 'huddle_explorer_folder', folder.folder_id,
         item.company_id, 'huddle_logic_gate', item.resource_huddle_resource_id
  from public.huddle_explorer_items item
  join public.huddle_explorer_folders folder
    on folder.company_id = item.company_id and folder.folder_id = item.parent_folder_id
  union
  select assignment.company_id, 'logic_gate', assignment.logic_gate_id,
         assignment.company_id, 'node', assignment.node_id
  from public.node_logic_gate_assignments assignment
  union
  select node.company_id, 'huddle_logic_gate', node.huddle_logic_gate_id,
         node.company_id, 'huddle_node', node.huddle_node_id
  from public.huddle_nodes node
  union
  select kpi.company_id, 'logic_gate', kpi.logic_gate_id,
         kpi.company_id, 'kpi', kpi.kpi_id
  from public.kpis kpi
  union
  select scorecard.company_id, 'logic_gate', scorecard.logic_gate_id,
         scorecard.company_id, 'scorecard', scorecard.qd_rating_id
  from public.scorecards scorecard
), excluded_resources(company_id, resource_type, resource_id) as (
  select company_id, resource_type, resource_id from seeds
  union
  select edge.to_company_id, edge.to_type, edge.to_id
  from excluded_resources excluded
  join edges edge
    on edge.from_company_id = excluded.company_id
   and edge.from_type = excluded.resource_type
   and edge.from_id = excluded.resource_id
)
insert into qa_excluded_resources(company_id, resource_type, resource_id)
select company_id, resource_type, resource_id
from excluded_resources;

create temp table qa_excluded_project_relationships on commit drop as
select relationship.company_id, relationship.relationship_id
from public.project_relationships relationship
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = relationship.company_id
    and (
      (excluded.resource_type = 'project' and excluded.resource_id = relationship.project_id)
      or (excluded.resource_type = relationship.resource_type and excluded.resource_id = relationship.resource_id)
    )
);

create or replace function pg_temp.qa_imported_json_objects(p_input jsonb)
returns setof jsonb
language plpgsql
immutable
as $function$
declare
  child_value jsonb;
begin
  if p_input is null then
    return;
  end if;

  if jsonb_typeof(p_input) = 'object' then
    return next p_input;
    for child_value in select entry.value from jsonb_each(p_input) entry loop
      return query select nested.object_value
      from pg_temp.qa_imported_json_objects(child_value) nested(object_value);
    end loop;
  elsif jsonb_typeof(p_input) = 'array' then
    for child_value in select element.value from jsonb_array_elements(p_input) element loop
      return query select nested.object_value
      from pg_temp.qa_imported_json_objects(child_value) nested(object_value);
    end loop;
  end if;
end
$function$;

-- Capture inline email references before deleting excluded owners or mailbox
-- history. Editor links carry their durable thread/message identity; chat links
-- use their stored snake_case entity identity and derive the thread from the
-- exact same-company message row.
create temp table qa_imported_email_links (
  company_id uuid not null,
  owner_resource_type text not null,
  owner_resource_id uuid not null,
  source_kind text not null,
  entity_id text,
  email_message_id text,
  email_thread_id text
) on commit drop;

with imported_json_sources(
  company_id, owner_resource_type, owner_resource_id, source_kind, payload
) as (
  select company_id, 'node'::text, node_id, 'editor'::text, body_json
  from public.node_textboxes
  union all
  select company_id, 'node', node_id, 'editor', body_json
  from public.node_textboxes_history
  union all
  select company_id, 'logic_gate', logic_gate_id, 'editor', body_json
  from public.logic_gate_textboxes
  union all
  select company_id, 'logic_gate', logic_gate_id, 'editor', body_json
  from public.logic_gate_textboxes_history
  union all
  select company_id, 'project', project_id, 'editor', body_json
  from public.project_textboxes
  union all
  select company_id, 'project', project_id, 'editor', body_json
  from public.project_textboxes_history
  union all
  select company_id, 'huddle_logic_gate', huddle_logic_gate_id, 'editor', body_json
  from public.huddle_logic_gates
  union all
  select company_id, 'entity', entity_id, 'editor', body_json
  from public.entities
  union all
  select company_id, 'huddle_node', huddle_node_id, 'editor', body_json
  from public.huddle_node_textboxes
  union all
  select company_id, 'node', node_id, 'chat', entity_links
  from public.node_textbox_chats
  union all
  select company_id, 'project', project_id, 'chat', entity_links
  from public.project_textbox_chats
  union all
  select company_id, 'huddle_node', huddle_node_id, 'chat', entity_links
  from public.huddle_node_textbox_chats
), imported_objects as (
  select source.company_id,
         source.owner_resource_type,
         source.owner_resource_id,
         source.source_kind,
         object.object_value
  from imported_json_sources source
  cross join lateral pg_temp.qa_imported_json_objects(source.payload) object(object_value)
), normalized_links as (
  select object.company_id,
         object.owner_resource_type,
         object.owner_resource_id,
         object.source_kind,
         coalesce(
           nullif(lower(btrim(object.object_value #>> '{attrs,entityType}')), ''),
           nullif(lower(btrim(object.object_value ->> 'entity_type')), ''),
           nullif(lower(btrim(object.object_value ->> 'entityType')), '')
         ) as entity_type,
         coalesce(
           nullif(lower(btrim(object.object_value #>> '{attrs,entityId}')), ''),
           nullif(lower(btrim(object.object_value ->> 'entity_id')), ''),
           nullif(lower(btrim(object.object_value ->> 'entityID')), ''),
           nullif(lower(btrim(object.object_value ->> 'entityId')), '')
         ) as entity_id,
         coalesce(
           nullif(lower(btrim(object.object_value #>> '{attrs,emailMessageId}')), ''),
           nullif(lower(btrim(object.object_value ->> 'email_message_id')), ''),
           nullif(lower(btrim(object.object_value ->> 'emailMessageID')), ''),
           nullif(lower(btrim(object.object_value ->> 'emailMessageId')), '')
         ) as email_message_id,
         coalesce(
           nullif(lower(btrim(object.object_value #>> '{attrs,emailThreadId}')), ''),
           nullif(lower(btrim(object.object_value ->> 'email_thread_id')), ''),
           nullif(lower(btrim(object.object_value ->> 'emailThreadID')), ''),
           nullif(lower(btrim(object.object_value ->> 'emailThreadId')), '')
         ) as email_thread_id
  from imported_objects object
  where (object.source_kind = 'editor' and object.object_value ->> 'type' = 'mangoEntityLink')
     or (object.source_kind = 'chat' and (
       object.object_value ? 'entity_type' or object.object_value ? 'entityType'
     ))
)
insert into qa_imported_email_links(
  company_id, owner_resource_type, owner_resource_id, source_kind,
  entity_id, email_message_id, email_thread_id
)
select distinct company_id,
       owner_resource_type,
       owner_resource_id,
       source_kind,
       entity_id,
       email_message_id,
       email_thread_id
from normalized_links
where entity_type = 'email_message'
  and (entity_id is not null or email_message_id is not null);

create temp table qa_excluded_email_threads (
  company_id uuid not null,
  email_thread_id uuid not null,
  primary key (company_id, email_thread_id)
) on commit drop;

insert into qa_excluded_email_threads(company_id, email_thread_id)
select distinct relationship.company_id, relationship.email_thread_id
from public.email_relationships relationship
join qa_excluded_resources excluded
  on excluded.company_id = relationship.company_id
 and excluded.resource_type = relationship.resource_type
 and excluded.resource_id = relationship.resource_id
union
select distinct message.company_id, message.email_thread_id
from public.node_textbox_chats chat
join qa_excluded_resources excluded
  on excluded.company_id = chat.company_id
 and excluded.resource_type = 'node'
 and excluded.resource_id = chat.node_id
join public.email_messages message
  on message.company_id = chat.company_id
 and message.email_message_id = chat.selection_email_message_id
where chat.selection_email_message_id is not null
union
select distinct message.company_id, message.email_thread_id
from public.project_textbox_chats chat
join qa_excluded_resources excluded
  on excluded.company_id = chat.company_id
 and excluded.resource_type = 'project'
 and excluded.resource_id = chat.project_id
join public.email_messages message
  on message.company_id = chat.company_id
 and message.email_message_id = chat.selection_email_message_id
where chat.selection_email_message_id is not null
union
select distinct message.company_id, message.email_thread_id
from qa_imported_email_links link
join qa_excluded_resources excluded
  on excluded.company_id = link.company_id
 and excluded.resource_type = link.owner_resource_type
 and excluded.resource_id = link.owner_resource_id
join public.email_messages message
  on message.company_id = link.company_id
 and (
   message.email_message_id::text = link.entity_id
   or message.email_message_id::text = link.email_message_id
 );

create temp table qa_keep_email_threads on commit drop as
select distinct relationship.company_id, relationship.email_thread_id
from public.email_relationships relationship
where not exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = relationship.company_id
    and excluded.resource_type = relationship.resource_type
    and excluded.resource_id = relationship.resource_id
)
and not exists (
  select 1 from qa_excluded_email_threads excluded_thread
  where excluded_thread.company_id = relationship.company_id
    and excluded_thread.email_thread_id = relationship.email_thread_id
)
union
select distinct message.company_id, message.email_thread_id
from public.node_textbox_chats chat
join public.email_messages message
  on message.company_id = chat.company_id
 and message.email_message_id = chat.selection_email_message_id
where chat.selection_email_message_id is not null
  and not exists (
    select 1 from qa_excluded_resources excluded
    where excluded.company_id = chat.company_id
      and excluded.resource_type = 'node'
      and excluded.resource_id = chat.node_id
  )
  and not exists (
    select 1 from qa_excluded_email_threads excluded_thread
    where excluded_thread.company_id = message.company_id
      and excluded_thread.email_thread_id = message.email_thread_id
  )
union
select distinct message.company_id, message.email_thread_id
from public.project_textbox_chats chat
join public.email_messages message
  on message.company_id = chat.company_id
 and message.email_message_id = chat.selection_email_message_id
where chat.selection_email_message_id is not null
  and not exists (
    select 1 from qa_excluded_resources excluded
    where excluded.company_id = chat.company_id
      and excluded.resource_type = 'project'
      and excluded.resource_id = chat.project_id
  )
  and not exists (
    select 1 from qa_excluded_email_threads excluded_thread
    where excluded_thread.company_id = message.company_id
      and excluded_thread.email_thread_id = message.email_thread_id
  )
union
select distinct message.company_id, message.email_thread_id
from qa_imported_email_links link
join public.email_messages message
  on message.company_id = link.company_id
 and message.email_message_id::text = link.entity_id
where not exists (
    select 1 from qa_excluded_resources excluded
    where excluded.company_id = link.company_id
      and excluded.resource_type = link.owner_resource_type
      and excluded.resource_id = link.owner_resource_id
  )
  and (link.email_message_id is null or link.email_message_id = link.entity_id)
  and (link.email_thread_id is null or link.email_thread_id = message.email_thread_id::text)
  and (
    link.source_kind = 'chat'
    or (
      link.email_message_id = message.email_message_id::text
      and link.email_thread_id = message.email_thread_id::text
    )
  )
  and not exists (
    select 1 from qa_excluded_email_threads excluded_thread
    where excluded_thread.company_id = message.company_id
      and excluded_thread.email_thread_id = message.email_thread_id
  );

create or replace function pg_temp.qa_clean_imported_json(p_company_id uuid, p_input jsonb)
returns jsonb
language plpgsql
stable
as $function$
declare
  result jsonb;
  linked_id text;
  linked_type text;
  linked_message_id text;
  linked_thread_id text;
  is_editor_link boolean;
  is_chat_link boolean;
begin
  if p_input is null then
    return null;
  end if;

  if jsonb_typeof(p_input) = 'object' then
    if p_input ->> 'type' = 'mangoAttachmentImage'
       or p_input ? 'attachment_id'
       or p_input ? 'attachmentId' then
      return null;
    end if;

    is_editor_link := p_input ->> 'type' = 'mangoEntityLink';
    is_chat_link := (p_input ? 'entity_type' or p_input ? 'entityType')
      and (p_input ? 'entity_id' or p_input ? 'entityID' or p_input ? 'entityId');

    if is_editor_link or is_chat_link then
      linked_id := coalesce(
        nullif(lower(btrim(p_input #>> '{attrs,entityId}')), ''),
        nullif(lower(btrim(p_input ->> 'entity_id')), ''),
        nullif(lower(btrim(p_input ->> 'entityID')), ''),
        nullif(lower(btrim(p_input ->> 'entityId')), '')
      );
      linked_type := coalesce(
        nullif(lower(btrim(p_input #>> '{attrs,entityType}')), ''),
        nullif(lower(btrim(p_input ->> 'entity_type')), ''),
        nullif(lower(btrim(p_input ->> 'entityType')), '')
      );

      if linked_id is null or linked_type is null then
        return null;
      end if;

      if linked_type = 'node' and not exists (
        select 1 from public.nodes endpoint
        where endpoint.company_id = p_company_id
          and endpoint.node_id::text = linked_id
      ) then
        return null;
      elsif linked_type = 'project' and not exists (
        select 1 from public.projects endpoint
        where endpoint.company_id = p_company_id
          and endpoint.project_id::text = linked_id
      ) then
        return null;
      elsif linked_type = 'logic_gate' and not exists (
        select 1 from public.logic_gates endpoint
        where endpoint.company_id = p_company_id
          and endpoint.logic_gate_id::text = linked_id
      ) then
        return null;
      elsif linked_type = 'entity' and not exists (
        select 1 from public.entities endpoint
        where endpoint.company_id = p_company_id
          and endpoint.entity_id::text = linked_id
      ) then
        return null;
      elsif linked_type = 'email_message' then
        linked_message_id := coalesce(
          nullif(lower(btrim(p_input #>> '{attrs,emailMessageId}')), ''),
          nullif(lower(btrim(p_input ->> 'email_message_id')), ''),
          nullif(lower(btrim(p_input ->> 'emailMessageID')), ''),
          nullif(lower(btrim(p_input ->> 'emailMessageId')), '')
        );
        linked_thread_id := coalesce(
          nullif(lower(btrim(p_input #>> '{attrs,emailThreadId}')), ''),
          nullif(lower(btrim(p_input ->> 'email_thread_id')), ''),
          nullif(lower(btrim(p_input ->> 'emailThreadID')), ''),
          nullif(lower(btrim(p_input ->> 'emailThreadId')), '')
        );

        if (linked_message_id is not null and linked_message_id <> linked_id)
           or (is_editor_link and (linked_message_id is null or linked_thread_id is null))
           or not exists (
             select 1
             from public.email_messages message
             join public.email_threads thread
               on thread.company_id = message.company_id
              and thread.email_thread_id = message.email_thread_id
             where message.company_id = p_company_id
               and message.email_message_id::text = linked_id
               and (linked_thread_id is null or message.email_thread_id::text = linked_thread_id)
           ) then
          return null;
        end if;
      elsif linked_type not in ('node', 'project', 'logic_gate', 'entity') then
        return null;
      end if;
    end if;

    select coalesce(jsonb_object_agg(entry.key, cleaned.value), '{}'::jsonb)
      into result
    from jsonb_each(p_input) entry
    cross join lateral (
      select pg_temp.qa_clean_imported_json(p_company_id, entry.value) as value
    ) cleaned
    where entry.key not in ('attachments', 'attachment_id', 'attachmentId')
      and cleaned.value is not null;
    return result;
  end if;

  if jsonb_typeof(p_input) = 'array' then
    select coalesce(jsonb_agg(cleaned.value order by element.ordinality), '[]'::jsonb)
      into result
    from jsonb_array_elements(p_input) with ordinality element(value, ordinality)
    cross join lateral (
      select pg_temp.qa_clean_imported_json(p_company_id, element.value) as value
    ) cleaned
    where cleaned.value is not null;
    return result;
  end if;

  return p_input;
end
$function$;

-- Omit every attachment and every incomplete upload. No surviving row may point
-- at the Dev bucket, and no object-copy step is needed for this baseline.
delete from public.attachment_upload_parts;
delete from public.attachment_upload_jobs;
delete from public.attachment_relationships;
delete from public.attachment_previews;
delete from public.attachments;

-- Remove provider work, delivery/read state, drafts, and identity workflows.
delete from public.communications_email_archive_job_items;
delete from public.communications_email_archive_jobs;
delete from public.email_ingestion_jobs;
delete from public.communications_message_read_receipt_signals;
delete from public.communications_message_read_receipt_summaries;
delete from public.communications_triage_items;
delete from public.email_drafts;
delete from public.email_signatures;
delete from public.auth_external_identity_deletions;
delete from public.invitations;

-- Omit any email thread that crossed an excluded boundary, and omit unrelated
-- mailbox history. Retain only email used by a surviving resource/chat.
create temp table qa_omit_email_threads on commit drop as
select thread.company_id, thread.email_thread_id
from public.email_threads thread
where exists (
  select 1 from qa_excluded_email_threads excluded
  where excluded.company_id = thread.company_id
    and excluded.email_thread_id = thread.email_thread_id
)
or not exists (
  select 1 from qa_keep_email_threads kept
  where kept.company_id = thread.company_id
    and kept.email_thread_id = thread.email_thread_id
);

-- Remove dependent selection chats before their exact textbox relationship,
-- then remove the wide relationship before deleting the thread. The deferred
-- dependency trigger intentionally rejects the reverse order.
delete from public.node_textbox_chats chat
where exists (
  select 1
  from public.email_messages message
  join qa_omit_email_threads omitted
    on omitted.company_id = message.company_id
   and omitted.email_thread_id = message.email_thread_id
  where message.company_id = chat.company_id
    and message.email_message_id = chat.selection_email_message_id
);

delete from public.project_textbox_chats chat
where exists (
  select 1
  from public.email_messages message
  join qa_omit_email_threads omitted
    on omitted.company_id = message.company_id
   and omitted.email_thread_id = message.email_thread_id
  where message.company_id = chat.company_id
    and message.email_message_id = chat.selection_email_message_id
);

delete from public.email_relationships relationship
using qa_omit_email_threads omitted
where omitted.company_id = relationship.company_id
  and omitted.email_thread_id = relationship.email_thread_id
  and relationship.resource_textbox_id is not null;

delete from public.email_relationships relationship
using qa_omit_email_threads omitted
where omitted.company_id = relationship.company_id
  and omitted.email_thread_id = relationship.email_thread_id;

delete from public.email_threads thread
using qa_omit_email_threads omitted
where omitted.company_id = thread.company_id
  and omitted.email_thread_id = thread.email_thread_id;

delete from public.node_textbox_chats chat
where chat.selection_email_message_id is not null
  and not exists (
    select 1 from public.email_messages message
    where message.company_id = chat.company_id
      and message.email_message_id = chat.selection_email_message_id
  );

delete from public.project_textbox_chats chat
where chat.selection_email_message_id is not null
  and not exists (
    select 1 from public.email_messages message
    where message.company_id = chat.company_id
      and message.email_message_id = chat.selection_email_message_id
  );

update public.email_messages
set provider_message_id = 'qa-copy-message:' || email_message_id::text,
    folder_id_snapshot = '[]'::jsonb,
    attachment_metadata = '[]'::jsonb,
    rich_html_body = regexp_replace(
      regexp_replace(rich_html_body, '<img[^>]*mango-attachment:[^>]*>', '', 'gi'),
      'mango-attachment:[^"''[:space:]<>]+', '', 'gi'
    ),
    download_complete = true,
    unread = false,
    updated_timestamp = greatest(updated_timestamp, transaction_timestamp());

update public.email_threads
set provider_thread_key = 'qa-copy-thread:' || email_thread_id::text,
    provider_thread_id = 'qa-copy-thread:' || email_thread_id::text,
    root_provider_message_id = 'qa-copy-root:' || email_thread_id::text,
    download_status = 'complete',
    history_complete = true,
    fetched_timestamp = coalesce(fetched_timestamp, transaction_timestamp()),
    last_download_error = '',
    updated_timestamp = greatest(updated_timestamp, transaction_timestamp());

delete from public.email_connections connection
where not exists (
  select 1 from public.email_threads thread
  where thread.company_id = connection.company_id
    and thread.email_connection_id = connection.email_connection_id
)
and not exists (
  select 1 from public.shared_inboxes inbox
  where inbox.company_id = connection.company_id
    and inbox.company_email_connection_id = connection.email_connection_id
);

update public.email_connections
set grant_id = 'qa-disabled:' || email_connection_id::text,
    status = 'configuration_required',
    ingestion_started_at = transaction_timestamp(),
    last_successful_scan_at = transaction_timestamp(),
    updated_timestamp = greatest(updated_timestamp, transaction_timestamp());

-- Clear payload-bearing, delivery, retry, projection, checkpoint, and recovery
-- state. The application rebuilds current projections from surviving sources.
delete from public.notifications;
delete from public.realtime_outbox;
delete from public.domain_events;
delete from public.recycle_bin_items;
delete from public.workspace_derived_domain_event_projection_checkpoints;
delete from public.workspace_read_versions;
delete from public.process_map_actual_size_layout_recovery_placements;
delete from public.process_map_actual_size_layout_recovery_runs;
delete from public.saved_views;
select setval('public.realtime_outbox_outbox_sequence_seq', 1, false);

-- Remove polymorphic and manually validated links before deleting endpoints.
delete from public.pins pin
using qa_excluded_resources excluded
where excluded.company_id = pin.company_id
  and excluded.resource_type = pin.resource_type
  and excluded.resource_id = pin.resource_id;

delete from public.raci_tabs_items item
using qa_excluded_resources excluded
where excluded.company_id = item.company_id
  and excluded.resource_type = 'logic_gate'
  and excluded.resource_id = item.logic_gate_id;

delete from public.user_logic_gate_shortcuts shortcut
using qa_excluded_resources excluded
where excluded.company_id = shortcut.company_id
  and excluded.resource_type = 'logic_gate'
  and excluded.resource_id = shortcut.logic_gate_id;

delete from public.process_map_placements placement
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = placement.company_id
    and (
      (excluded.resource_type = placement.resource_type and excluded.resource_id = placement.resource_id)
      or (excluded.resource_type = 'company_explorer_folder' and excluded.resource_id = placement.map_parent_folder_id)
    )
);

delete from public.resource_operational_relationships relationship
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = relationship.company_id
    and (
      (excluded.resource_type = relationship.source_resource_type and excluded.resource_id = relationship.source_resource_id)
      or (excluded.resource_type = relationship.target_resource_type and excluded.resource_id = relationship.target_resource_id)
    )
);

delete from public.node_relationships relationship
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = relationship.company_id
    and excluded.resource_type = 'node'
    and excluded.resource_id in (relationship.node_id_a, relationship.node_id_b)
);

delete from public.project_critical_path_steps step
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = step.company_id
    and excluded.resource_type = 'project'
    and excluded.resource_id = step.project_id
)
or exists (
  select 1 from qa_excluded_project_relationships excluded_relationship
  where excluded_relationship.company_id = step.company_id
    and excluded_relationship.relationship_id = step.relationship_id
);

delete from public.project_relationships relationship
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = relationship.company_id
    and (
      (excluded.resource_type = 'project' and excluded.resource_id = relationship.project_id)
      or (excluded.resource_type = relationship.resource_type and excluded.resource_id = relationship.resource_id)
    )
);

delete from public.project_management_timeline_items item
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = item.company_id
    and (
      (excluded.resource_type = 'node' and excluded.resource_id = item.node_id)
      or (excluded.resource_type = 'logic_gate' and excluded.resource_id = item.logic_gate_id)
    )
);

delete from public.node_timeline_events event
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = event.company_id
    and (
      (excluded.resource_type = 'node' and excluded.resource_id = event.node_id)
      or (excluded.resource_type = 'logic_gate' and excluded.resource_id in (event.from_logic_gate_id, event.to_logic_gate_id))
      or (excluded.resource_type = 'project' and excluded.resource_id = event.project_id)
    )
);

update public.node_timeline_events
set idempotency_key = ''
where idempotency_key <> '';

delete from public.company_explorer_items item
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = item.company_id
    and (
      (excluded.resource_type = 'company_explorer_folder' and excluded.resource_id = item.parent_folder_id)
      or (excluded.resource_type = item.target_type and excluded.resource_id = item.target_id)
    )
);

delete from public.huddle_explorer_items item
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = item.company_id
    and (
      (excluded.resource_type = 'huddle_explorer_folder' and excluded.resource_id = item.parent_folder_id)
      or (excluded.resource_type = 'huddle_logic_gate' and excluded.resource_id = item.resource_huddle_resource_id)
    )
);

-- Ownership-edge triggers need the current policy rows while they detach.
-- Remove those edges first, then remove every excluded permission/GVIC row.
delete from public.node_logic_gate_assignments assignment
where exists (
  select 1 from qa_excluded_resources excluded
  where excluded.company_id = assignment.company_id
    and (
      (excluded.resource_type = 'logic_gate' and excluded.resource_id = assignment.logic_gate_id)
      or (excluded.resource_type = 'node' and excluded.resource_id = assignment.node_id)
    )
);

delete from public.resource_gvic_assignments assignment
using qa_excluded_resources excluded
where excluded.company_id = assignment.company_id
  and excluded.resource_type = assignment.resource_type
  and excluded.resource_id = assignment.resource_id;

delete from public.resource_gvic_settings setting
using qa_excluded_resources excluded
where excluded.company_id = setting.company_id
  and excluded.resource_type = setting.resource_type
  and excluded.resource_id = setting.resource_id;

delete from public.resource_permissions permission
using qa_excluded_resources excluded
where excluded.company_id = permission.company_id
  and excluded.resource_type = permission.resource_type
  and excluded.resource_id = permission.resource_id;

delete from public.resource_permission_settings setting
using qa_excluded_resources excluded
where excluded.company_id = setting.company_id
  and excluded.resource_type = setting.resource_type
  and excluded.resource_id = setting.resource_id;

-- Endpoint deletes use declared cascades after all untyped links are gone.
delete from public.projects endpoint
using qa_excluded_resources excluded
where excluded.company_id = endpoint.company_id
  and excluded.resource_type = 'project'
  and excluded.resource_id = endpoint.project_id;

delete from public.nodes endpoint
using qa_excluded_resources excluded
where excluded.company_id = endpoint.company_id
  and excluded.resource_type = 'node'
  and excluded.resource_id = endpoint.node_id;

-- Entity relationships are non-owning edges. Remove only an edge whose exact
-- Huddle endpoint is excluded; preserve the Entity endpoint and its business data.
delete from public.entity_relationships relationship
using qa_excluded_resources excluded
where excluded.company_id = relationship.company_id
  and excluded.resource_type = relationship.resource_type
  and excluded.resource_type in ('huddle_node','huddle_logic_gate')
  and excluded.resource_id = relationship.resource_id;

delete from public.huddle_nodes endpoint
using qa_excluded_resources excluded
where excluded.company_id = endpoint.company_id
  and excluded.resource_type = 'huddle_node'
  and excluded.resource_id = endpoint.huddle_node_id;

delete from public.huddle_logic_gates endpoint
using qa_excluded_resources excluded
where excluded.company_id = endpoint.company_id
  and excluded.resource_type = 'huddle_logic_gate'
  and excluded.resource_id = endpoint.huddle_logic_gate_id;

delete from public.logic_gates endpoint
using qa_excluded_resources excluded
where excluded.company_id = endpoint.company_id
  and excluded.resource_type = 'logic_gate'
  and excluded.resource_id = endpoint.logic_gate_id;

delete from public.company_explorer_folders folder
using qa_excluded_resources excluded
where excluded.company_id = folder.company_id
  and excluded.resource_type = 'company_explorer_folder'
  and excluded.resource_id = folder.folder_id;

do $delete_huddle_folders$
declare
  removed_count integer;
  remaining_count integer;
begin
  loop
    delete from public.huddle_explorer_folders folder
    using qa_excluded_resources excluded
    where excluded.company_id = folder.company_id
      and excluded.resource_type = 'huddle_explorer_folder'
      and excluded.resource_id = folder.folder_id
      and not exists (
        select 1 from public.huddle_explorer_folders child
        where child.company_id = folder.company_id
          and child.parent_folder_id = folder.folder_id
      );
    get diagnostics removed_count = row_count;
    exit when removed_count = 0;
  end loop;

  select count(*) into remaining_count
  from public.huddle_explorer_folders folder
  join qa_excluded_resources excluded
    on excluded.company_id = folder.company_id
   and excluded.resource_type = 'huddle_explorer_folder'
   and excluded.resource_id = folder.folder_id;

  if remaining_count <> 0 then
    raise exception 'STOP: % excluded Huddle explorer folders remain; possible cycle or unexpected child',
      remaining_count;
  end if;
end
$delete_huddle_folders$;

-- Remove local attachment nodes and excluded entity links from all surviving
-- editor/chat JSON without changing surviving resource IDs.
update public.node_textboxes
set body_json = coalesce(
  pg_temp.qa_clean_imported_json(company_id, body_json),
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb
);

update public.node_textboxes_history
set body_json = coalesce(
  pg_temp.qa_clean_imported_json(company_id, body_json),
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb
);

update public.logic_gate_textboxes
set body_json = coalesce(
  pg_temp.qa_clean_imported_json(company_id, body_json),
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb
);

update public.logic_gate_textboxes_history
set body_json = coalesce(
  pg_temp.qa_clean_imported_json(company_id, body_json),
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb
);

update public.project_textboxes
set body_json = coalesce(
  pg_temp.qa_clean_imported_json(company_id, body_json),
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb
);

update public.project_textboxes_history
set body_json = coalesce(
  pg_temp.qa_clean_imported_json(company_id, body_json),
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb
);

update public.huddle_logic_gates
set body_json = coalesce(
  pg_temp.qa_clean_imported_json(company_id, body_json),
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb
);

update public.huddle_node_textboxes
set body_json = coalesce(
  pg_temp.qa_clean_imported_json(company_id, body_json),
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb
);

update public.entities
set body_json = coalesce(
  pg_temp.qa_clean_imported_json(company_id, body_json),
  '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb
);

-- Keep exact same-company person assignments and clear only imported values
-- that cannot resolve to a current membership in the Entity's company.
update public.entity_fields field
set value_jsonb = null,
    updated_timestamp = greatest(updated_timestamp, transaction_timestamp())
where field.field_type = 'person'
  and field.value_jsonb is not null
  and case
    when jsonb_typeof(field.value_jsonb) is distinct from 'string' then true
    when (field.value_jsonb #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
    else not exists (
      select 1
      from public.company_memberships membership
      where membership.company_id = field.company_id
        and membership.user_id::text = lower(field.value_jsonb #>> '{}')
    )
  end;

-- Chat messages contain the visible labels for entity_links. If any link is
-- rejected, delete the whole chat (and cascading replies) rather than leave a
-- label behind or attempt to rebase every surviving start/end offset.
delete from public.node_textbox_chats chat
where coalesce(pg_temp.qa_clean_imported_json(chat.company_id, chat.entity_links), '[]'::jsonb)
      is distinct from coalesce(chat.entity_links, '[]'::jsonb);

delete from public.project_textbox_chats chat
where coalesce(pg_temp.qa_clean_imported_json(chat.company_id, chat.entity_links), '[]'::jsonb)
      is distinct from coalesce(chat.entity_links, '[]'::jsonb);

delete from public.huddle_node_textbox_chats chat
where coalesce(pg_temp.qa_clean_imported_json(chat.company_id, chat.entity_links), '[]'::jsonb)
      is distinct from coalesce(chat.entity_links, '[]'::jsonb);

update public.node_textbox_chats
set entity_links = coalesce(pg_temp.qa_clean_imported_json(company_id, entity_links), '[]'::jsonb);

update public.project_textbox_chats
set entity_links = coalesce(pg_temp.qa_clean_imported_json(company_id, entity_links), '[]'::jsonb);

update public.huddle_node_textbox_chats
set entity_links = coalesce(pg_temp.qa_clean_imported_json(company_id, entity_links), '[]'::jsonb);

update public.logic_gate_textboxes textbox
set email_message_id = ''
where textbox.email_message_id <> ''
  and not exists (
    select 1 from public.email_messages message
    where message.company_id = textbox.company_id
      and message.email_message_id::text = textbox.email_message_id
  );

-- Preserve internal user IDs, memberships, groups, permissions, and GVIC while
-- making every imported Cognito subject unusable in QA. Jonat's QA Cognito sub
-- must be mapped to the copied row separately before first login.
update public.users
set cognito_subject = 'qa-disabled:' || user_id::text,
    updated_timestamp = greatest(updated_timestamp, transaction_timestamp());

-- Never carry the Dev migration ledger into the sanitized data-only export.
do $clear_ledger$
begin
  if to_regclass('public.schema_migrations') is not null then
    execute 'delete from public.schema_migrations';
  end if;
end
$clear_ledger$;

-- Commit-time hard stops. These are repeated by qa_dev_copy_verify.sql.
do $verify_before_commit$
begin
  if not exists (select 1 from public.companies) then
    raise exception 'STOP: sanitization left no surviving company';
  end if;

  if exists (
    select 1 from public.company_explorer_folders
    where parent_folder_id is null
      and lower(btrim(name)) in (
        'sidebar huddles private','tk','finance 1','finance 1.5','finance 2',
        'hr 1','hr 1.5','hr 2','legal','fo'
      )
  ) or exists (
    select 1 from public.huddle_explorer_folders
    where parent_folder_id is null
      and lower(btrim(name)) in (
        'sidebar huddles private','tk','finance 1','finance 1.5','finance 2',
        'hr 1','hr 1.5','hr 2','legal','fo'
      )
  ) then
    raise exception 'STOP: an excluded explorer root remains after sanitization';
  end if;

  if exists (select 1 from public.attachments)
     or exists (select 1 from public.attachment_previews)
     or exists (select 1 from public.attachment_relationships)
     or exists (select 1 from public.attachment_upload_jobs)
     or exists (select 1 from public.attachment_upload_parts) then
    raise exception 'STOP: attachment state remains after sanitization';
  end if;

  if exists (select 1 from public.users where cognito_subject <> 'qa-disabled:' || user_id::text) then
    raise exception 'STOP: an imported Cognito subject remains active';
  end if;

  if exists (
    select 1 from public.email_connections
    where status <> 'configuration_required'
       or grant_id <> 'qa-disabled:' || email_connection_id::text
  ) then
    raise exception 'STOP: an imported email connection remains active';
  end if;

  if exists (select 1 from public.domain_events)
     or exists (select 1 from public.realtime_outbox)
     or exists (select 1 from public.notifications)
     or exists (select 1 from public.recycle_bin_items)
     or exists (select 1 from public.email_ingestion_jobs)
     or exists (select 1 from public.communications_email_archive_jobs) then
    raise exception 'STOP: active job/event/delivery/recycle state remains';
  end if;
end
$verify_before_commit$;

select resource_type, count(*)::bigint as excluded_resource_count
from qa_excluded_resources
group by resource_type
order by resource_type;

select
  company.company_id,
  (select count(*)::bigint from public.company_memberships membership where membership.company_id = company.company_id) as membership_count,
  (select count(*)::bigint from public.projects endpoint where endpoint.company_id = company.company_id) as project_count,
  (select count(*)::bigint from public.logic_gates endpoint where endpoint.company_id = company.company_id) as logic_gate_count,
  (select count(*)::bigint from public.nodes endpoint where endpoint.company_id = company.company_id) as node_count,
  (select count(*)::bigint from public.entities endpoint where endpoint.company_id = company.company_id) as entity_count
from public.companies company
order by company.company_id;

select check_name, row_count
from (values
  ('surviving_users', (select count(*)::bigint from public.users)),
  ('surviving_memberships', (select count(*)::bigint from public.company_memberships)),
  ('surviving_email_threads', (select count(*)::bigint from public.email_threads)),
  ('surviving_email_messages', (select count(*)::bigint from public.email_messages)),
  ('surviving_permissions', (select count(*)::bigint from public.resource_permissions)),
  ('surviving_gvic_assignments', (select count(*)::bigint from public.resource_gvic_assignments)),
  ('attachments', (select count(*)::bigint from public.attachments)),
  ('domain_events', (select count(*)::bigint from public.domain_events)),
  ('realtime_outbox', (select count(*)::bigint from public.realtime_outbox))
) checks(check_name, row_count)
order by check_name;

commit;
