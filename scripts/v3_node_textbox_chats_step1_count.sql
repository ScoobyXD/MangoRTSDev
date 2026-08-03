-- STEP 1: read-only count and classification of current Node textbox chats.
-- Run this entire script first. It writes nothing.

begin transaction isolation level repeatable read read only;

with raw as (
  select
    projection.company_id,
    projection.node_id,
    projection.information_id as chat_id,
    projection.information,
    projection.created_timestamp,
    projection.updated_timestamp,
    case
      when pg_input_is_valid(projection.information, 'jsonb')
        then projection.information::jsonb
      else null
    end as payload,
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
    case
      when pg_input_is_valid(nullif(btrim(raw.payload->>'block_id'), ''), 'uuid')
        then (raw.payload->>'block_id')::uuid
      else null
    end as textbox_id,
    nullif(btrim(raw.payload->>'parent_id'), '') as parent_chat_id_text,
    case
      when pg_input_is_valid(nullif(btrim(raw.payload->>'parent_id'), ''), 'uuid')
        then (raw.payload->>'parent_id')::uuid
      else null
    end as parent_chat_id,
    coalesce(nullif(btrim(raw.payload->>'selection_source'), ''), 'text') as selection_source,
    nullif(btrim(raw.payload->>'selection_block_id'), '') as selection_textbox_id_text,
    nullif(btrim(raw.payload->>'selection_message_id'), '') as selection_message_id_text,
    nullif(raw.payload->>'selection_start', '') as selection_start_text,
    nullif(raw.payload->>'selection_end', '') as selection_end_text,
    nullif(lower(btrim(raw.payload->>'author_id')), '') as author_user_id_text
  from raw
), enriched as (
  select
    decoded.*,
    host.textbox_id is not null as host_textbox_exists,
    coalesce(email_match.match_count, 0) as email_message_match_count,
    coalesce(user_mentions.invalid_count, 0) as invalid_user_mention_count,
    coalesce(group_mentions.invalid_count, 0) as invalid_group_mention_count
  from decoded
  left join node_textboxes host
    on host.company_id = decoded.company_id
   and host.node_id = decoded.node_id
   and host.textbox_id = decoded.textbox_id
  left join lateral (
    select count(*) as match_count
    from communications_email_messages message
    where message.company_id = decoded.company_id
      and message.provider_message_id = decoded.selection_message_id_text
  ) email_match on true
  left join lateral (
    select count(*) filter (
      where not pg_input_is_valid(item.value, 'uuid')
    ) as invalid_count
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(decoded.payload->'mentioned_user_ids') = 'array'
          then decoded.payload->'mentioned_user_ids'
        else '[]'::jsonb
      end
    ) item(value)
  ) user_mentions on true
  left join lateral (
    select count(*) filter (
      where not pg_input_is_valid(item.value, 'uuid')
    ) as invalid_count
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(decoded.payload->'mentioned_group_ids') = 'array'
          then decoded.payload->'mentioned_group_ids'
        else '[]'::jsonb
      end
    ) item(value)
  ) group_mentions on true
), classified as (
  select
    enriched.*,
    array_remove(array[
      case when enriched.payload is null then 'invalid_json' end,
      case when enriched.payload is not null and jsonb_typeof(enriched.payload) <> 'object'
        then 'payload_not_object' end,
      case when enriched.textbox_id is null then 'block_id_missing_or_invalid' end,
      case when enriched.parent_chat_id_text is not null and enriched.parent_chat_id is null
        then 'parent_id_invalid' end,
      case when enriched.selection_source not in ('text', 'email')
        then 'selection_source_invalid' end,
      case when enriched.selection_textbox_id_text is not null
             and not pg_input_is_valid(enriched.selection_textbox_id_text, 'uuid')
        then 'selection_textbox_id_invalid' end,
      case when enriched.selection_source = 'email'
             and enriched.selection_textbox_id_text is not null
        then 'email_selection_has_textbox_id' end,
      case when enriched.selection_source = 'text'
             and enriched.selection_message_id_text is not null
        then 'text_selection_has_email_message_id' end,
      case when enriched.selection_source = 'email'
             and enriched.selection_message_id_text is null
        then 'email_selection_message_id_missing' end,
      case when enriched.selection_source = 'email'
             and enriched.selection_message_id_text is not null
             and enriched.email_message_match_count = 0
        then 'email_selection_message_unresolved' end,
      case when enriched.selection_source = 'email'
             and enriched.email_message_match_count > 1
        then 'email_selection_message_ambiguous' end,
      case when (enriched.selection_start_text is null) <> (enriched.selection_end_text is null)
        then 'selection_offsets_incomplete' end,
      case when enriched.selection_start_text is not null
             and (
               not pg_input_is_valid(enriched.selection_start_text, 'integer')
               or not pg_input_is_valid(enriched.selection_end_text, 'integer')
             )
        then 'selection_offsets_invalid' end,
      case when enriched.selection_start_text is not null
             and pg_input_is_valid(enriched.selection_start_text, 'integer')
             and pg_input_is_valid(enriched.selection_end_text, 'integer')
             and (
               enriched.selection_start_text::integer < 0
               or enriched.selection_end_text::integer < enriched.selection_start_text::integer
             )
        then 'selection_offsets_invalid' end,
      case when enriched.author_user_id_text is not null
             and not pg_input_is_valid(enriched.author_user_id_text, 'uuid')
        then 'author_id_invalid' end,
      case when enriched.payload ? 'entity_links'
             and enriched.payload->'entity_links' <> 'null'::jsonb
             and jsonb_typeof(enriched.payload->'entity_links') <> 'array'
        then 'entity_links_not_array' end,
      case when enriched.payload ? 'mentioned_user_ids'
             and enriched.payload->'mentioned_user_ids' <> 'null'::jsonb
             and (
               jsonb_typeof(enriched.payload->'mentioned_user_ids') <> 'array'
               or enriched.invalid_user_mention_count > 0
             )
        then 'mentioned_user_ids_invalid' end,
      case when enriched.payload ? 'mentioned_group_ids'
             and enriched.payload->'mentioned_group_ids' <> 'null'::jsonb
             and (
               jsonb_typeof(enriched.payload->'mentioned_group_ids') <> 'array'
               or enriched.invalid_group_mention_count > 0
             )
        then 'mentioned_group_ids_invalid' end,
      case when enriched.company_chat_id_count > 1 then 'duplicate_company_chat_id' end,
      case when enriched.updated_timestamp < enriched.created_timestamp then 'timestamps_invalid' end
    ], null)::text[] as issue_codes
  from enriched
), ready as (
  select
    classified.*,
    case
      when cardinality(classified.issue_codes) > 0 then 'needs_human_mapping'
      when not classified.host_textbox_exists then 'discarded_deleted_host'
      else 'copyable'
    end as copy_state,
    case
      when cardinality(classified.issue_codes) > 0
        then array_to_string(classified.issue_codes, ',')
      when not classified.host_textbox_exists then 'host_textbox_missing'
      else 'copyable'
    end as copy_reason
  from classified
)
select
  count(*) as current_legacy_chats,
  count(*) filter (where copy_state = 'copyable') as chats_to_copy,
  count(*) filter (where copy_state = 'discarded_deleted_host') as missing_textbox_chats,
  count(*) filter (where copy_state = 'needs_human_mapping') as chats_requiring_review,
  jsonb_agg(
    jsonb_build_object(
      'company_id', company_id,
      'node_id', node_id,
      'chat_id', chat_id,
      'textbox_id', textbox_id,
      'state', copy_state,
      'reason', copy_reason
    ) order by company_id, node_id, chat_id
  ) filter (where copy_state <> 'copyable') as exceptions_without_message_bodies
from ready;

-- This explains large table-size labels such as the screenshot's 3.3 GB.
select
  relation.relname as table_name,
  pg_size_pretty(pg_relation_size(relation.oid)) as heap_size,
  pg_size_pretty(pg_indexes_size(relation.oid)) as index_size,
  pg_size_pretty(
    case
      when relation.reltoastrelid = 0 then 0
      else pg_total_relation_size(relation.reltoastrelid)
    end
  ) as toast_size,
  pg_size_pretty(pg_total_relation_size(relation.oid)) as total_size,
  stats.n_live_tup,
  stats.n_dead_tup,
  stats.last_autovacuum,
  stats.last_autoanalyze
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
left join pg_stat_user_tables stats on stats.relid = relation.oid
where namespace.nspname = current_schema()
  and relation.relname in ('node_information', 'node_projection_table')
order by relation.relname;

commit;
