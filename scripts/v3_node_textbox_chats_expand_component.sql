-- V3 Node textbox chat expansion.
--
-- This phase is deliberately additive. It creates the permanent chat table and
-- the shared classifier used by inventory, copy, and reconciliation. It does
-- not copy data, change application readers/writers, or remove legacy rows.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

create table node_textbox_chats (
  company_id uuid not null,
  chat_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  parent_chat_id uuid,
  selection_source text not null default 'text',
  selection_textbox_id uuid,
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
  unique (company_id, node_id, textbox_id, chat_id),
  foreign key (company_id, node_id, textbox_id)
    references node_textboxes(company_id, node_id, textbox_id) on delete cascade,
  foreign key (company_id, node_id, textbox_id, parent_chat_id)
    references node_textbox_chats(company_id, node_id, textbox_id, chat_id) on delete cascade,
  foreign key (author_user_id) references users(user_id) on delete set null,
  constraint node_textbox_chats_selection_source_chk
    check (selection_source in ('text', 'email')),
  constraint node_textbox_chats_selection_target_chk check (
    (selection_source = 'text' and selection_email_message_id is null)
    or (selection_source = 'email' and selection_email_message_id is not null)
  ),
  constraint node_textbox_chats_selection_offsets_chk check (
    (selection_start is null and selection_end is null)
    or (selection_start >= 0 and selection_end >= selection_start)
  ),
  constraint node_textbox_chats_entity_links_chk
    check (jsonb_typeof(entity_links) = 'array'),
  constraint node_textbox_chats_revision_chk check (revision > 0),
  constraint node_textbox_chats_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (edited_timestamp is null or edited_timestamp >= created_timestamp)
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  )
);

create index idx_node_textbox_chats_textbox_created
  on node_textbox_chats(company_id, node_id, textbox_id, created_timestamp, chat_id)
  where deleted_timestamp is null;

create index idx_node_textbox_chats_parent
  on node_textbox_chats(company_id, node_id, textbox_id, parent_chat_id)
  where parent_chat_id is not null and deleted_timestamp is null;

create index idx_node_textbox_chats_email_selection
  on node_textbox_chats(company_id, selection_email_message_id)
  where selection_email_message_id is not null and deleted_timestamp is null;

comment on table node_textbox_chats is
  'Permanent Node textbox chat storage created by operator Step 2 before backend cutover.';

create table v3_migration_runs (
  run_id uuid primary key,
  phase text not null,
  mapping_version integer not null,
  mapping_checksum text not null,
  status text not null,
  summary jsonb not null default '{}'::jsonb,
  started_timestamp timestamptz not null default now(),
  completed_timestamp timestamptz,
  constraint v3_migration_runs_phase_chk check (btrim(phase) <> ''),
  constraint v3_migration_runs_mapping_version_chk check (mapping_version > 0),
  constraint v3_migration_runs_mapping_checksum_chk check (mapping_checksum ~ '^[0-9a-f]{32}$'),
  constraint v3_migration_runs_status_chk
    check (status in ('running', 'complete', 'needs_review')),
  constraint v3_migration_runs_summary_chk check (jsonb_typeof(summary) = 'object'),
  constraint v3_migration_runs_timestamps_chk check (
    completed_timestamp is null or completed_timestamp >= started_timestamp
  )
);

create table v3_migration_items (
  run_id uuid not null,
  phase text not null,
  company_id uuid not null,
  node_id uuid not null,
  source_id uuid not null,
  target_id uuid,
  disposition text not null,
  reason text not null,
  source_checksum text not null,
  details jsonb not null default '{}'::jsonb,
  recorded_timestamp timestamptz not null default now(),
  primary key (run_id, phase, company_id, node_id, source_id),
  foreign key (run_id) references v3_migration_runs(run_id) on delete cascade,
  constraint v3_migration_items_phase_chk check (btrim(phase) <> ''),
  constraint v3_migration_items_disposition_chk check (
    disposition in ('copied', 'already_copied', 'discarded_deleted_host', 'needs_human_mapping')
  ),
  constraint v3_migration_items_reason_chk check (btrim(reason) <> ''),
  constraint v3_migration_items_checksum_chk check (source_checksum ~ '^[0-9a-f]{32}$'),
  constraint v3_migration_items_details_chk check (jsonb_typeof(details) = 'object')
);

create index idx_v3_migration_items_source
  on v3_migration_items(phase, company_id, node_id, source_id, recorded_timestamp desc);

create function v3_migration_try_jsonb_v1(value text)
returns jsonb
language plpgsql
immutable
strict
as $$
begin
  return value::jsonb;
exception when invalid_text_representation then
  return null;
end
$$;

create function v3_migration_try_uuid_v1(value text)
returns uuid
language plpgsql
immutable
strict
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end
$$;

create function v3_migration_try_integer_v1(value text)
returns integer
language plpgsql
immutable
strict
as $$
begin
  return value::integer;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end
$$;
create function v3_migration_try_timestamptz_v1(value text)
returns timestamptz
language plpgsql
stable
strict
as $$
begin
  return value::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then
  return null;
end
$$;

create function v3_migration_try_uuid_array_v1(value jsonb)
returns uuid[]
language plpgsql
immutable
strict
as $$
declare
  result uuid[];
begin
  if jsonb_typeof(value) <> 'array' then
    return null;
  end if;
  select coalesce(array_agg(item::uuid order by ordinal), '{}'::uuid[])
    into result
    from jsonb_array_elements_text(value) with ordinality as items(item, ordinal);
  return result;
exception when invalid_text_representation then
  return null;
end
$$;

create function v3_migration_try_chat_attachment_ids_v1(value jsonb)
returns uuid[]
language plpgsql
immutable
strict
as $$
declare
  result uuid[];
begin
  if jsonb_typeof(value) <> 'array' or exists (
    select 1
    from jsonb_array_elements(value) item
    where jsonb_typeof(item) <> 'object'
       or coalesce(nullif(btrim(item->>'attachment_id'), ''), nullif(btrim(item->>'attachmentID'), ''), nullif(btrim(item->>'id'), '')) is null
  ) then
    return null;
  end if;
  select coalesce(array_agg(distinct attachment_id order by attachment_id), '{}'::uuid[])
    into result
    from (
      select coalesce(nullif(btrim(item->>'attachment_id'), ''), nullif(btrim(item->>'attachmentID'), ''), nullif(btrim(item->>'id'), ''))::uuid as attachment_id
      from jsonb_array_elements(value) item
    ) parsed;
  return result;
exception when invalid_text_representation then
  return null;
end
$$;

create view v3_node_textbox_chat_source_v1 as
with raw as (
  select
    projection.company_id,
    projection.node_id,
    projection.information_id as chat_id,
    projection.information,
    projection.is_deleted,
    projection.revision,
    projection.created_timestamp,
    projection.updated_timestamp,
    v3_migration_try_jsonb_v1(projection.information) as payload,
    count(*) over (
      partition by projection.company_id, projection.information_id
    ) as company_chat_id_count
  from node_projection_table projection
  where projection.type = 'Text block chat'::information_type
    and not projection.is_deleted
), decoded as (
  select
    raw.*,
    nullif(btrim(raw.payload->>'block_id'), '') as textbox_id_text,
    v3_migration_try_uuid_v1(nullif(btrim(raw.payload->>'block_id'), '')) as textbox_id,
    nullif(btrim(raw.payload->>'parent_id'), '') as parent_chat_id_text,
    v3_migration_try_uuid_v1(nullif(btrim(raw.payload->>'parent_id'), '')) as requested_parent_chat_id,
    coalesce(nullif(btrim(raw.payload->>'selection_source'), ''), 'text') as selection_source,
    nullif(btrim(raw.payload->>'selection_block_id'), '') as selection_textbox_id_text,
    v3_migration_try_uuid_v1(nullif(btrim(raw.payload->>'selection_block_id'), '')) as parsed_selection_textbox_id,
    nullif(btrim(raw.payload->>'selection_message_id'), '') as selection_message_id_text,
    nullif(raw.payload->>'selection_start', '') as selection_start_text,
    nullif(raw.payload->>'selection_end', '') as selection_end_text,
    v3_migration_try_integer_v1(nullif(raw.payload->>'selection_start', '')) as selection_start,
    v3_migration_try_integer_v1(nullif(raw.payload->>'selection_end', '')) as selection_end,
    nullif(lower(btrim(raw.payload->>'author_id')), '') as author_user_id_text,
    nullif(btrim(raw.payload->>'edited_timestamp'), '') as edited_timestamp_text,
    v3_migration_try_timestamptz_v1(nullif(btrim(raw.payload->>'edited_timestamp'), '')) as parsed_edited_timestamp,
    v3_migration_try_chat_attachment_ids_v1(raw.payload->'attachments') as parsed_attachment_ids,
    v3_migration_try_uuid_v1(nullif(lower(btrim(raw.payload->>'author_id')), '')) as parsed_author_user_id,
    v3_migration_try_uuid_array_v1(raw.payload->'mentioned_user_ids') as parsed_mentioned_user_ids,
    v3_migration_try_uuid_array_v1(raw.payload->'mentioned_group_ids') as parsed_mentioned_group_ids
  from raw
), email_mapping as (
  select
    decoded.*,
    coalesce(email_match.match_count, 0) as email_message_match_count,
    email_match.email_message_id as mapped_email_message_id
  from decoded
  left join lateral (
    select
      count(*) as match_count,
      (array_agg(message.email_message_id order by message.email_message_id))[1] as email_message_id
    from communications_email_messages message
    where message.company_id = decoded.company_id
      and message.provider_message_id = decoded.selection_message_id_text
  ) email_match on true
), normalized as (
  select
    source.*,
    host.textbox_id is not null as host_textbox_exists,
    author.user_id as author_user_id,
    coalesce(source.payload->>'author_name', '') as author_display_name,
    coalesce(source.payload->>'message', source.payload->>'content', '') as message,
    coalesce(source.payload->>'selection_quote', '') as selection_quote,
    source.parsed_edited_timestamp as edited_timestamp,
    coalesce(source.parsed_attachment_ids, '{}'::uuid[]) as attachment_ids,
    (
      select count(*)
      from unnest(coalesce(source.parsed_attachment_ids, '{}'::uuid[])) wanted(attachment_id)
      left join attachments attachment
        on attachment.company_id=source.company_id
       and attachment.attachment_id=wanted.attachment_id
       and attachment.deleted_timestamp is null
      where attachment.attachment_id is null
    ) as attachment_missing_count,
    source.parsed_selection_textbox_id as selection_textbox_id,
    case
      when source.selection_source = 'email' and source.email_message_match_count = 1
        then source.mapped_email_message_id
      else null
    end as selection_email_message_id,
    case
      when jsonb_typeof(source.payload->'entity_links') = 'array'
        then source.payload->'entity_links'
      else '[]'::jsonb
    end as entity_links,
    coalesce(source.parsed_mentioned_user_ids, '{}'::uuid[]) as mentioned_user_ids,
    coalesce(source.parsed_mentioned_group_ids, '{}'::uuid[]) as mentioned_group_ids,
    greatest(source.revision, 1) as target_revision,
    case when source.is_deleted then source.updated_timestamp else null end as deleted_timestamp
  from email_mapping source
  left join node_textboxes host
    on host.company_id = source.company_id
   and host.node_id = source.node_id
   and host.textbox_id = source.textbox_id
   and host.deleted_timestamp is null
  left join users author
    on author.user_id = source.parsed_author_user_id
), classified as (
  select
    normalized.*,
    array_remove(array[
      case when normalized.payload is null then 'invalid_json' end,
      case when normalized.payload is not null and jsonb_typeof(normalized.payload) <> 'object'
        then 'payload_not_object' end,
      case when normalized.textbox_id is null then 'block_id_missing_or_invalid' end,
      case when normalized.parent_chat_id_text is not null and normalized.requested_parent_chat_id is null
        then 'parent_id_invalid' end,
      case when normalized.selection_source not in ('text', 'email')
        then 'selection_source_invalid' end,
      case when normalized.selection_textbox_id_text is not null
             and normalized.parsed_selection_textbox_id is null
        then 'selection_textbox_id_invalid' end,
      case when normalized.selection_source = 'text'
             and normalized.selection_message_id_text is not null
        then 'text_selection_has_email_message_id' end,
      case when normalized.selection_source = 'email'
             and normalized.selection_message_id_text is null
        then 'email_selection_message_id_missing' end,
      case when normalized.selection_source = 'email'
             and normalized.selection_message_id_text is not null
             and normalized.email_message_match_count = 0
        then 'email_selection_message_unresolved' end,
      case when normalized.selection_source = 'email'
             and normalized.email_message_match_count > 1
        then 'email_selection_message_ambiguous' end,
      case when (normalized.selection_start_text is null) <> (normalized.selection_end_text is null)
        then 'selection_offsets_incomplete' end,
      case when normalized.selection_start_text is not null
             and (normalized.selection_start is null or normalized.selection_end is null)
        then 'selection_offsets_invalid' end,
      case when normalized.selection_start is not null
             and (normalized.selection_start < 0 or normalized.selection_end < normalized.selection_start)
        then 'selection_offsets_invalid' end,
      case when normalized.author_user_id_text is not null and normalized.parsed_author_user_id is null
        then 'author_id_invalid' end,
      case when normalized.payload ? 'attachments'
             and normalized.payload->'attachments' <> 'null'::jsonb
             and normalized.parsed_attachment_ids is null
        then 'attachment_references_invalid' end,
      case when normalized.attachment_missing_count > 0
        then 'attachment_record_missing' end,
      case when normalized.payload ? 'entity_links'
             and normalized.payload->'entity_links' <> 'null'::jsonb
             and jsonb_typeof(normalized.payload->'entity_links') <> 'array'
        then 'entity_links_not_array' end,
      case when normalized.payload ? 'mentioned_user_ids'
             and normalized.payload->'mentioned_user_ids' <> 'null'::jsonb
             and normalized.parsed_mentioned_user_ids is null
        then 'mentioned_user_ids_invalid' end,
      case when normalized.payload ? 'mentioned_group_ids'
             and normalized.payload->'mentioned_group_ids' <> 'null'::jsonb
             and normalized.parsed_mentioned_group_ids is null
        then 'mentioned_group_ids_invalid' end,
      case when normalized.company_chat_id_count > 1 then 'duplicate_company_chat_id' end,
      case when normalized.updated_timestamp < normalized.created_timestamp then 'timestamps_invalid' end,
      case when normalized.edited_timestamp_text is not null and normalized.edited_timestamp is null
        then 'edited_timestamp_invalid' end,
      case when normalized.edited_timestamp is not null and normalized.edited_timestamp < normalized.created_timestamp
        then 'edited_timestamp_before_created' end
    ], null)::text[] as issue_codes
  from normalized
), parent_mapping as (
  select
    child.*,
    case
      when parent.chat_id is not null
       and cardinality(parent.issue_codes) = 0
       and parent.host_textbox_exists
        then parent.chat_id
      else null
    end as parent_chat_id
  from classified child
  left join classified parent
    on parent.company_id = child.company_id
   and parent.node_id = child.node_id
   and parent.chat_id = child.requested_parent_chat_id
   and parent.textbox_id = child.textbox_id
), mapped as (
  select
    source.*,
    md5(jsonb_build_object(
      'company_id', source.company_id,
      'chat_id', source.chat_id,
      'node_id', source.node_id,
      'textbox_id', source.textbox_id,
      'parent_chat_id', source.parent_chat_id,
      'selection_source', source.selection_source,
      'selection_textbox_id', source.selection_textbox_id,
      'selection_email_message_id', source.selection_email_message_id,
      'selection_quote', source.selection_quote,
      'selection_start', source.selection_start,
      'selection_end', source.selection_end,
      'author_user_id', source.author_user_id,
      'author_display_name', source.author_display_name,
      'message', source.message,
      'entity_links', source.entity_links,
      'mentioned_user_ids', source.mentioned_user_ids,
      'edited_timestamp', source.edited_timestamp,
      'attachment_ids', source.attachment_ids,
      'mentioned_group_ids', source.mentioned_group_ids,
      'revision', source.target_revision,
      'created_timestamp', source.created_timestamp,
      'updated_timestamp', source.updated_timestamp,
      'deleted_timestamp', source.deleted_timestamp
    )::text) as source_checksum
  from parent_mapping source
), target_state as (
  select
    source.*,
    target.chat_id is not null as target_exists,
    target.chat_id is not null
      and target.node_id = source.node_id
      and target.textbox_id = source.textbox_id
      and target.parent_chat_id is not distinct from source.parent_chat_id
      and target.selection_source = source.selection_source
      and target.selection_textbox_id is not distinct from source.selection_textbox_id
      and target.selection_email_message_id is not distinct from source.selection_email_message_id
      and target.selection_quote = source.selection_quote
      and target.selection_start is not distinct from source.selection_start
      and target.selection_end is not distinct from source.selection_end
      and target.author_user_id is not distinct from source.author_user_id
      and target.author_display_name = source.author_display_name
      and target.message = source.message
      and target.entity_links = source.entity_links
      and target.mentioned_user_ids = source.mentioned_user_ids
      and target.edited_timestamp is not distinct from source.edited_timestamp
      and target_attachment.attachment_ids = source.attachment_ids
      and target.mentioned_group_ids = source.mentioned_group_ids
      and target.revision = source.target_revision
      and target.created_timestamp = source.created_timestamp
      and target.updated_timestamp = source.updated_timestamp
      and target.deleted_timestamp is not distinct from source.deleted_timestamp
      as target_matches_source
  from mapped source
  left join node_textbox_chats target
    on target.company_id = source.company_id
   and target.chat_id = source.chat_id
  left join lateral (
    select coalesce(array_agg(distinct link.attachment_id order by link.attachment_id), '{}'::uuid[]) as attachment_ids
    from resource_attachments link
    where link.company_id=source.company_id
      and link.resource_type='node_chat_message'
      and link.resource_id=source.chat_id::text
      and link.relationship_kind='chat_attachment'
      and link.deleted_timestamp is null
  ) target_attachment on true
)
select
  target_state.company_id,
  target_state.node_id,
  target_state.chat_id,
  target_state.textbox_id,
  target_state.parent_chat_id,
  target_state.requested_parent_chat_id,
  target_state.selection_source,
  target_state.selection_textbox_id,
  target_state.selection_email_message_id,
  target_state.selection_message_id_text as legacy_selection_message_id,
  target_state.selection_quote,
  target_state.selection_start,
  target_state.selection_end,
  target_state.author_user_id,
  target_state.author_display_name,
  target_state.message,
  target_state.entity_links,
  target_state.mentioned_user_ids,
  target_state.edited_timestamp,
  target_state.attachment_ids,
  target_state.mentioned_group_ids,
  target_state.target_revision as revision,
  target_state.created_timestamp,
  target_state.updated_timestamp,
  target_state.deleted_timestamp,
  target_state.host_textbox_exists,
  target_state.issue_codes,
  target_state.source_checksum,
  target_state.target_exists,
  target_state.target_matches_source,
  case
    when cardinality(target_state.issue_codes) > 0 then 'needs_human_mapping'
    when not target_state.host_textbox_exists then 'discarded_deleted_host'
    when not target_state.target_exists then 'ready_to_copy'
    when target_state.target_matches_source then 'already_copied'
    else 'needs_human_mapping'
  end as migration_state,
  case
    when cardinality(target_state.issue_codes) > 0
      then array_to_string(target_state.issue_codes, ',')
    when not target_state.host_textbox_exists then 'host_textbox_missing'
    when not target_state.target_exists then 'ready_to_copy'
    when target_state.target_matches_source then 'target_already_matches'
    else 'target_conflict'
  end as migration_reason,
  target_state.requested_parent_chat_id is not null
    and target_state.parent_chat_id is null as parent_detached
from target_state;

comment on view v3_node_textbox_chat_source_v1 is
  'Versioned shared classifier for V3 Node textbox chat inventory, copy, and reconciliation.';

commit;
