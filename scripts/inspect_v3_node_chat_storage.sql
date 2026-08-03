-- Read-only inspection for the legacy Node chat sources and relation storage.
-- This can run before the additive V3 chat expansion migration.

begin transaction read only;

-- DBeaver's table-size label normally reflects total relation size: the main
-- heap, indexes, and any out-of-line TOAST values. It is not a row count.
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
  stats.last_vacuum,
  stats.last_autovacuum,
  stats.last_analyze,
  stats.last_autoanalyze
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
left join pg_stat_user_tables stats on stats.relid = relation.oid
where namespace.nspname = current_schema()
  and relation.relname in ('node_information', 'node_projection_table')
order by relation.relname;

-- Live row contents can still be small even when old/dead heap or TOAST pages
-- make the physical relation large.
select
  count(*) as live_rows,
  pg_size_pretty(coalesce(sum(pg_column_size(information)), 0)::bigint) as live_information_bytes,
  pg_size_pretty(coalesce(max(pg_column_size(information)), 0)::bigint) as largest_live_information_value
from node_information;

-- node_information is event/history storage. These counts are informative but
-- are not the current UI chat count.
select type::text as information_type, count(*) as event_rows
from node_information
group by type::text
order by event_rows desc, information_type;

-- node_projection_table is the current Node UI authority. The exact rows used
-- for the first V3 chat copy are Text block chat projections.
select
  count(*) as stored_chat_projections,
  count(*) filter (where not is_deleted) as current_chat_projections,
  count(*) filter (where is_deleted) as deleted_chat_projections,
  count(distinct (company_id, node_id)) as nodes_with_chat_projections
from node_projection_table
where type = 'Text block chat'::information_type;

-- This intentionally reports identities and counts, not user message bodies.
with parsed as (
  select
    projection.company_id,
    projection.node_id,
    projection.information_id as chat_id,
    case
      when pg_input_is_valid(projection.information, 'jsonb')
        then projection.information::jsonb
      else null
    end as payload
  from node_projection_table projection
  where projection.type = 'Text block chat'::information_type
    and not projection.is_deleted
), mapped as (
  select
    parsed.*,
    case
      when pg_input_is_valid(nullif(btrim(parsed.payload->>'block_id'), ''), 'uuid')
        then (parsed.payload->>'block_id')::uuid
      else null
    end as textbox_id
  from parsed
)
select
  count(*) as source_rows,
  count(*) filter (where payload is null or jsonb_typeof(payload) <> 'object') as invalid_payload_rows,
  count(*) filter (where payload is not null and textbox_id is null) as invalid_textbox_identity_rows,
  count(*) filter (where textbox.textbox_id is null and mapped.textbox_id is not null) as missing_host_rows,
  count(*) filter (where textbox.textbox_id is not null) as rows_with_permanent_host
from mapped
left join node_textboxes textbox
  on textbox.company_id = mapped.company_id
 and textbox.node_id = mapped.node_id
 and textbox.textbox_id = mapped.textbox_id;

commit;
