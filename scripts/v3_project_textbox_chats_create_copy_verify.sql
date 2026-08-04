-- V3 PROJECT TEXTBOX CHAT COPY
--
-- Run this entire file in DBeaver only after Project chat writes are paused.
-- Keep Project chat writes paused until the backend has been deployed with
-- project_textbox_chats as its only Project-chat reader and writer.
--
-- This is an additive copy. It does not update or delete project_information,
-- project_projection_table, project_textboxes, email data, or attachments.
-- It deliberately refuses to copy a different snapshot than the one reviewed
-- on 2026-08-04: 16 chats, 3 replies, and zero chat attachments.

select
  current_setting('server_version') as server_version,
  current_setting('server_version_num')::integer as server_version_num,
  case
    when current_setting('server_version_num')::integer between 170000 and 179999
      then 'SUPPORTED'
    else 'STOP_UNSUPPORTED_POSTGRESQL_VERSION'
  end as version_status;

begin;

set local lock_timeout = '10s';
set local statement_timeout = '2min';

do $$
begin
  if current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception 'STOP: this script supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;

  if to_regclass('public.project_projection_table') is null
     or to_regclass('public.project_textboxes') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.users') is null
     or to_regclass('public.email_messages') is null
     or to_regclass('public.email_relationships') is null then
    raise exception 'STOP: one or more required current tables are missing';
  end if;

  -- Exact unordered column-name set and exact count. Physical column order is
  -- intentionally ignored.
  if (select count(*) from pg_attribute
      where attrelid='public.project_projection_table'::regclass
        and attnum>0 and not attisdropped) <> 7
     or exists (
       select expected.column_name
       from (values
         ('company_id'),('project_id'),('information_id'),('type'),
         ('information'),('created_timestamp'),('updated_timestamp')
       ) expected(column_name)
       except
       select attname
       from pg_attribute
       where attrelid='public.project_projection_table'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname
       from pg_attribute
       where attrelid='public.project_projection_table'::regclass
         and attnum>0 and not attisdropped
       except
       select expected.column_name
       from (values
         ('company_id'),('project_id'),('information_id'),('type'),
         ('information'),('created_timestamp'),('updated_timestamp')
       ) expected(column_name)
     ) then
    raise exception 'STOP: project_projection_table column set drifted';
  end if;

  if (select count(*) from pg_attribute
      where attrelid='public.project_textboxes'::regclass
        and attnum>0 and not attisdropped) <> 9
     or exists (
       select expected.column_name
       from (values
         ('company_id'),('project_id'),('textbox_id'),('body_json'),('revision'),
         ('display_order'),('created_timestamp'),('updated_timestamp'),('deleted_timestamp')
       ) expected(column_name)
       except
       select attname
       from pg_attribute
       where attrelid='public.project_textboxes'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname
       from pg_attribute
       where attrelid='public.project_textboxes'::regclass
         and attnum>0 and not attisdropped
       except
       select expected.column_name
       from (values
         ('company_id'),('project_id'),('textbox_id'),('body_json'),('revision'),
         ('display_order'),('created_timestamp'),('updated_timestamp'),('deleted_timestamp')
       ) expected(column_name)
     ) then
    raise exception 'STOP: project_textboxes column set drifted';
  end if;
end
$$;

create table if not exists project_textbox_chats (
  company_id uuid not null,
  chat_id uuid not null,
  project_id uuid not null,
  textbox_id text not null,
  parent_chat_id uuid,
  selection_source text not null default 'text',
  selection_textbox_id text,
  selection_email_message_id uuid,
  selection_quote text not null default '',
  selection_start integer,
  selection_end integer,
  author_user_id uuid,
  author_display_name text not null default '',
  message text not null default '',
  edited_timestamp timestamptz,
  entity_links jsonb not null default '[]'::jsonb,
  mentioned_user_ids uuid[] not null default '{}'::uuid[],
  mentioned_group_ids uuid[] not null default '{}'::uuid[],
  revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, chat_id),
  unique (company_id, project_id, textbox_id, chat_id),
  foreign key (company_id, project_id, textbox_id)
    references project_textboxes(company_id, project_id, textbox_id) on delete cascade,
  foreign key (company_id, project_id, textbox_id, parent_chat_id)
    references project_textbox_chats(company_id, project_id, textbox_id, chat_id) on delete cascade,
  foreign key (author_user_id) references users(user_id) on delete set null,
  constraint project_textbox_chats_textbox_id_chk check (btrim(textbox_id) <> ''),
  constraint project_textbox_chats_selection_source_chk
    check (selection_source in ('text','email')),
  constraint project_textbox_chats_selection_target_chk check (
    (selection_source='text' and selection_email_message_id is null)
    or (selection_source='email' and selection_email_message_id is not null)
  ),
  constraint project_textbox_chats_selection_offsets_chk check (
    (selection_start is null and selection_end is null)
    or (selection_start >= 0 and selection_end >= selection_start)
  ),
  constraint project_textbox_chats_entity_links_chk
    check (jsonb_typeof(entity_links)='array'),
  constraint project_textbox_chats_revision_chk check (revision > 0),
  constraint project_textbox_chats_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (edited_timestamp is null or edited_timestamp >= created_timestamp)
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  )
);

create index if not exists idx_project_textbox_chats_textbox_created
  on project_textbox_chats(
    company_id,project_id,textbox_id,created_timestamp,chat_id
  ) where deleted_timestamp is null;

create index if not exists idx_project_textbox_chats_parent
  on project_textbox_chats(
    company_id,project_id,textbox_id,parent_chat_id
  ) where parent_chat_id is not null and deleted_timestamp is null;

create index if not exists idx_project_textbox_chats_email_selection
  on project_textbox_chats(company_id,selection_email_message_id)
  where selection_email_message_id is not null and deleted_timestamp is null;

comment on table project_textbox_chats is
  'Permanent Project textbox chats keyed by the preserved legacy projection information_id.';

do $$
begin
  -- Refuse an earlier/partial table with the same name but a different shape.
  if (select count(*) from pg_attribute
      where attrelid='public.project_textbox_chats'::regclass
        and attnum>0 and not attisdropped) <> 22
     or exists (
       select expected.column_name
       from (values
         ('company_id'),('chat_id'),('project_id'),('textbox_id'),('parent_chat_id'),
         ('selection_source'),('selection_textbox_id'),('selection_email_message_id'),
         ('selection_quote'),('selection_start'),('selection_end'),('author_user_id'),
         ('author_display_name'),('message'),('edited_timestamp'),('entity_links'),
         ('mentioned_user_ids'),('mentioned_group_ids'),('revision'),
         ('created_timestamp'),('updated_timestamp'),('deleted_timestamp')
       ) expected(column_name)
       except
       select attname from pg_attribute
       where attrelid='public.project_textbox_chats'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname from pg_attribute
       where attrelid='public.project_textbox_chats'::regclass
         and attnum>0 and not attisdropped
       except
       select expected.column_name
       from (values
         ('company_id'),('chat_id'),('project_id'),('textbox_id'),('parent_chat_id'),
         ('selection_source'),('selection_textbox_id'),('selection_email_message_id'),
         ('selection_quote'),('selection_start'),('selection_end'),('author_user_id'),
         ('author_display_name'),('message'),('edited_timestamp'),('entity_links'),
         ('mentioned_user_ids'),('mentioned_group_ids'),('revision'),
         ('created_timestamp'),('updated_timestamp'),('deleted_timestamp')
       ) expected(column_name)
     ) then
    raise exception 'STOP: project_textbox_chats column set drifted';
  end if;
end
$$;

create or replace function pg_temp.mango_try_jsonb(value text)
returns jsonb language plpgsql immutable strict as $$
begin
  return value::jsonb;
exception when invalid_text_representation then
  return null;
end
$$;

create or replace function pg_temp.mango_try_uuid(value text)
returns uuid language plpgsql immutable strict as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end
$$;

create or replace function pg_temp.mango_try_integer(value text)
returns integer language plpgsql immutable strict as $$
begin
  return value::integer;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end
$$;

create or replace function pg_temp.mango_try_timestamptz(value text)
returns timestamptz language plpgsql stable strict as $$
begin
  return value::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then
  return null;
end
$$;

create or replace function pg_temp.mango_try_uuid_array(value jsonb)
returns uuid[] language plpgsql immutable strict as $$
declare result uuid[];
begin
  if jsonb_typeof(value) <> 'array' then
    return null;
  end if;
  select coalesce(array_agg(distinct item::uuid order by item::uuid),'{}'::uuid[])
    into result
    from jsonb_array_elements_text(value) items(item);
  return result;
exception when invalid_text_representation then
  return null;
end
$$;

create temporary table mango_project_chat_source on commit drop as
with raw as (
  select
    projection.company_id,
    projection.project_id,
    projection.information_id as chat_id,
    projection.created_timestamp,
    projection.updated_timestamp,
    pg_temp.mango_try_jsonb(projection.information) as payload
  from project_projection_table projection
  where projection.type='Text block chat'::information_type
), decoded as (
  select
    raw.*,
    nullif(btrim(payload->>'block_id'),'') as textbox_id,
    nullif(btrim(payload->>'parent_id'),'') as parent_id_text,
    pg_temp.mango_try_uuid(nullif(btrim(payload->>'parent_id'),'')) as requested_parent_chat_id,
    coalesce(nullif(btrim(payload->>'selection_source'),''),'text') as selection_source,
    nullif(btrim(payload->>'selection_block_id'),'') as selection_textbox_id,
    nullif(btrim(payload->>'selection_message_id'),'') as selection_message_ref,
    coalesce(payload->>'selection_quote','') as selection_quote,
    nullif(payload->>'selection_start','') as selection_start_text,
    nullif(payload->>'selection_end','') as selection_end_text,
    pg_temp.mango_try_integer(nullif(payload->>'selection_start','')) as selection_start,
    pg_temp.mango_try_integer(nullif(payload->>'selection_end','')) as selection_end,
    nullif(lower(btrim(payload->>'author_id')),'') as author_id_text,
    pg_temp.mango_try_uuid(nullif(lower(btrim(payload->>'author_id')),'')) as parsed_author_user_id,
    coalesce(payload->>'author_name','') as author_display_name,
    coalesce(payload->>'message',payload->>'content','') as message,
    nullif(btrim(payload->>'created_timestamp'),'') as payload_created_text,
    pg_temp.mango_try_timestamptz(nullif(btrim(payload->>'created_timestamp'),'')) as payload_created_timestamp,
    nullif(btrim(payload->>'edited_timestamp'),'') as edited_text,
    pg_temp.mango_try_timestamptz(nullif(btrim(payload->>'edited_timestamp'),'')) as edited_timestamp,
    case
      when not (payload ? 'attachments') or payload->'attachments'='null'::jsonb then 0
      when jsonb_typeof(payload->'attachments')='array' then jsonb_array_length(payload->'attachments')
      else -1
    end as attachment_count,
    case
      when not (payload ? 'entity_links') or payload->'entity_links'='null'::jsonb then '[]'::jsonb
      when jsonb_typeof(payload->'entity_links')='array' then payload->'entity_links'
      else null
    end as entity_links,
    case
      when not (payload ? 'mentioned_user_ids') or payload->'mentioned_user_ids'='null'::jsonb
        then '{}'::uuid[]
      else pg_temp.mango_try_uuid_array(payload->'mentioned_user_ids')
    end as mentioned_user_ids,
    case
      when not (payload ? 'mentioned_group_ids') or payload->'mentioned_group_ids'='null'::jsonb
        then '{}'::uuid[]
      else pg_temp.mango_try_uuid_array(payload->'mentioned_group_ids')
    end as mentioned_group_ids
  from raw
), resolved as (
  select
    decoded.*,
    host.textbox_id is not null as host_exists,
    selection_host.textbox_id is not null as selection_host_exists,
    author.user_id as author_user_id,
    email_match.match_count as email_match_count,
    email_match.email_message_id as selection_email_message_id,
    email_access.relationship_count as email_relationship_count
  from decoded
  left join project_textboxes host
    on host.company_id=decoded.company_id
   and host.project_id=decoded.project_id
   and host.textbox_id=decoded.textbox_id
   and host.deleted_timestamp is null
  left join project_textboxes selection_host
    on selection_host.company_id=decoded.company_id
   and selection_host.project_id=decoded.project_id
   and selection_host.textbox_id=decoded.selection_textbox_id
   and selection_host.deleted_timestamp is null
  left join users author on author.user_id=decoded.parsed_author_user_id
  left join lateral (
    select
      count(distinct message.email_message_id)::integer as match_count,
      (array_agg(distinct message.email_message_id order by message.email_message_id))[1]
        as email_message_id
    from email_messages message
    where message.company_id=decoded.company_id
      and (
        message.email_message_id::text=decoded.selection_message_ref
        or message.provider_message_id=decoded.selection_message_ref
      )
  ) email_match on true
  left join lateral (
    select count(*)::integer as relationship_count
    from email_relationships relationship
    where relationship.company_id=decoded.company_id
      and relationship.email_message_id=email_match.email_message_id
      and relationship.resource_type='project'
      and relationship.resource_id=decoded.project_id
      and (
        relationship.resource_textbox_id is null
        or relationship.resource_textbox_id=decoded.textbox_id
      )
  ) email_access on true
), timed as (
  select
    resolved.*,
    coalesce(payload_created_timestamp,created_timestamp) as target_created_timestamp,
    greatest(
      updated_timestamp,
      coalesce(payload_created_timestamp,created_timestamp),
      coalesce(edited_timestamp,updated_timestamp)
    ) as target_updated_timestamp
  from resolved
)
select
  timed.*,
  array_remove(array[
    case when payload is null then 'invalid_json' end,
    case when payload is not null and jsonb_typeof(payload)<>'object' then 'payload_not_object' end,
    case when textbox_id is null then 'block_id_missing' end,
    case when not host_exists then 'live_project_textbox_missing' end,
    case when parent_id_text is not null and requested_parent_chat_id is null then 'parent_id_invalid' end,
    case when selection_source not in ('text','email') then 'selection_source_invalid' end,
    case when selection_textbox_id is not null and not selection_host_exists then 'selection_textbox_missing' end,
    case when selection_source='text' and selection_message_ref is not null then 'text_selection_has_email' end,
    case when selection_source='email' and coalesce(email_match_count,0)<>1 then 'email_identity_not_exact' end,
    case when selection_source='email' and coalesce(email_relationship_count,0)=0 then 'email_not_related_to_project' end,
    case when (selection_start_text is null)<>(selection_end_text is null) then 'selection_offsets_incomplete' end,
    case when selection_start_text is not null and (selection_start is null or selection_end is null) then 'selection_offsets_invalid' end,
    case when selection_start is not null and (selection_start<0 or selection_end<selection_start) then 'selection_offsets_invalid' end,
    case when author_id_text is not null and parsed_author_user_id is null then 'author_id_invalid' end,
    case when payload_created_text is not null and payload_created_timestamp is null then 'created_timestamp_invalid' end,
    case when edited_text is not null and edited_timestamp is null then 'edited_timestamp_invalid' end,
    case when edited_timestamp is not null and edited_timestamp<target_created_timestamp then 'edited_timestamp_before_created' end,
    case when attachment_count<>0 then 'chat_attachments_changed_or_invalid' end,
    case when entity_links is null then 'entity_links_invalid' end,
    case when mentioned_user_ids is null then 'mentioned_user_ids_invalid' end,
    case when mentioned_group_ids is null then 'mentioned_group_ids_invalid' end,
    case when btrim(message)='' then 'empty_chat_message' end,
    case when updated_timestamp<created_timestamp then 'projection_timestamps_invalid' end
  ],null)::text[] as issue_codes
from timed;

-- Reviewable identities only; no chat bodies, filenames, provider keys, or URLs.
select
  company_id,
  project_id,
  chat_id,
  textbox_id,
  issue_codes
from mango_project_chat_source
where cardinality(issue_codes)>0
order by company_id,project_id,chat_id;

do $$
declare
  v_source_count integer;
  v_reply_count integer;
  v_attachment_count integer;
begin
  select count(*),
         count(*) filter(where source.requested_parent_chat_id is not null),
         coalesce(sum(greatest(source.attachment_count,0)),0)
    into v_source_count,v_reply_count,v_attachment_count
    from mango_project_chat_source source;

  if v_source_count<>16 then
    raise exception 'STOP: expected the reviewed 16 Project chats, found %',v_source_count;
  end if;
  if v_reply_count<>3 then
    raise exception 'STOP: expected the reviewed 3 Project replies, found %',v_reply_count;
  end if;
  if v_attachment_count<>0 then
    raise exception 'STOP: expected zero Project chat attachments, found %',v_attachment_count;
  end if;
  if exists(select 1 from mango_project_chat_source where cardinality(issue_codes)>0) then
    raise exception 'STOP: at least one Project chat needs review; nothing was copied';
  end if;
  if exists(
    select 1
    from mango_project_chat_source child
    left join mango_project_chat_source parent
      on parent.company_id=child.company_id
     and parent.project_id=child.project_id
     and parent.textbox_id=child.textbox_id
     and parent.chat_id=child.requested_parent_chat_id
    where child.requested_parent_chat_id is not null
      and parent.chat_id is null
  ) then
    raise exception 'STOP: a Project reply does not have its exact parent in the same textbox';
  end if;
end
$$;

insert into project_textbox_chats(
  company_id,chat_id,project_id,textbox_id,parent_chat_id,
  selection_source,selection_textbox_id,selection_email_message_id,
  selection_quote,selection_start,selection_end,
  author_user_id,author_display_name,message,edited_timestamp,
  entity_links,mentioned_user_ids,mentioned_group_ids,
  revision,created_timestamp,updated_timestamp,deleted_timestamp
)
select
  company_id,chat_id,project_id,textbox_id,null,
  selection_source,selection_textbox_id,
  case when selection_source='email' then selection_email_message_id else null end,
  selection_quote,selection_start,selection_end,
  author_user_id,author_display_name,message,edited_timestamp,
  entity_links,mentioned_user_ids,mentioned_group_ids,
  1,target_created_timestamp,target_updated_timestamp,null
from mango_project_chat_source
order by company_id,project_id,chat_id
on conflict (company_id,chat_id) do nothing;

update project_textbox_chats target
set parent_chat_id=source.requested_parent_chat_id
from mango_project_chat_source source
where source.requested_parent_chat_id is not null
  and target.company_id=source.company_id
  and target.chat_id=source.chat_id;

do $$
begin
  if (select count(*) from project_textbox_chats)<>16 then
    raise exception 'STOP: final project_textbox_chats count is not 16';
  end if;

  if exists (
    select 1
    from mango_project_chat_source source
    left join project_textbox_chats target
      on target.company_id=source.company_id and target.chat_id=source.chat_id
    where target.chat_id is null
       or target.project_id<>source.project_id
       or target.textbox_id<>source.textbox_id
       or target.parent_chat_id is distinct from source.requested_parent_chat_id
       or target.selection_source<>source.selection_source
       or target.selection_textbox_id is distinct from source.selection_textbox_id
       or target.selection_email_message_id is distinct from
          (case when source.selection_source='email' then source.selection_email_message_id else null end)
       or target.selection_quote<>source.selection_quote
       or target.selection_start is distinct from source.selection_start
       or target.selection_end is distinct from source.selection_end
       or target.author_user_id is distinct from source.author_user_id
       or target.author_display_name<>source.author_display_name
       or target.message<>source.message
       or target.edited_timestamp is distinct from source.edited_timestamp
       or target.entity_links<>source.entity_links
       or target.mentioned_user_ids<>source.mentioned_user_ids
       or target.mentioned_group_ids<>source.mentioned_group_ids
       or target.revision<>1
       or target.created_timestamp<>source.target_created_timestamp
       or target.updated_timestamp<>source.target_updated_timestamp
       or target.deleted_timestamp is not null
  ) then
    raise exception 'STOP: copied Project chat rows do not exactly match their source';
  end if;
end
$$;

select
  current_setting('server_version') as server_version,
  'COPY_COMPLETE' as status,
  (select count(*) from mango_project_chat_source) as source_chats,
  (select count(*) from project_textbox_chats) as final_chats,
  (select count(*) from project_textbox_chats where parent_chat_id is not null) as final_replies,
  (select count(*) from mango_project_chat_source where cardinality(issue_codes)>0) as rows_needing_review;

commit;

-- Expected final result:
-- status=COPY_COMPLETE, source_chats=16, final_chats=16,
-- final_replies=3, rows_needing_review=0.
--
-- Do not drop project_information or project_projection_table after this copy.
-- First deploy the backend cutover, verify that no production reader/writer or
-- database dependency remains, take the approved snapshot, and complete soak.
