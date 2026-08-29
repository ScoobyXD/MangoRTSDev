-- READ-ONLY preflight for retire_unused_operational_tables.sql. Run the entire
-- file in DBeaver with the database-enforced read-only credential. Review every
-- result set separately in each environment. This file cannot change the database.

begin transaction isolation level repeatable read read only;
set local statement_timeout = '5min';

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only,
       case
         when current_setting('server_version_num')::integer between 170000 and 189999
           then 'POSTGRESQL_VERSION_SUPPORTED'
         else 'STOP_UNSUPPORTED_POSTGRESQL_VERSION'
       end as version_status;

do $$
declare
  missing_relations text;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'STOP: retirement supports PostgreSQL 17.x and 18.x; connected server is %',
      current_setting('server_version');
  end if;
  if not current_setting('transaction_read_only')::boolean then
    raise exception 'STOP: this preflight must be a read-only transaction';
  end if;

  select string_agg(target.name, ', ' order by target.name)
  into missing_relations
  from (values
    ('domain_events'),
    ('process_map_actual_size_layout_recovery_placements'),
    ('process_map_actual_size_layout_recovery_runs'),
    ('raci_tabs_items'),
    ('schema_migrations'),
    ('user_logic_gate_shortcuts'),
    ('users'),
    ('workspace_derived_domain_event_projection_checkpoints')
  ) target(name)
  where to_regclass('public.' || target.name) is null;
  if missing_relations is not null then
    raise exception 'STOP: required preflight relation set drifted; missing: %', missing_relations;
  end if;
end;
$$;

-- Exact current row counts proposed for deletion.
select 'user_logic_gate_shortcuts' as table_name, count(*) as row_count
from public.user_logic_gate_shortcuts
union all
select 'workspace_derived_domain_event_projection_checkpoints', count(*)
from public.workspace_derived_domain_event_projection_checkpoints
union all
select 'process_map_actual_size_layout_recovery_placements', count(*)
from public.process_map_actual_size_layout_recovery_placements
union all
select 'process_map_actual_size_layout_recovery_runs', count(*)
from public.process_map_actual_size_layout_recovery_runs
order by table_name;

-- Exactly which users still own manual shortcuts, and how many of those rows
-- already overlap their canonical RACI Tabs membership.
select shortcut.user_id,
       user_row.display_name,
       user_row.email,
       shortcut.company_id,
       count(*) as shortcut_count,
       count(*) filter (where exists (
         select 1
         from public.raci_tabs_items item
         where item.company_id = shortcut.company_id
           and item.user_id = shortcut.user_id
           and item.logic_gate_id = shortcut.logic_gate_id
       )) as also_in_raci_tabs,
       min(shortcut.created_timestamp) as first_shortcut_created,
       max(shortcut.updated_timestamp) as last_shortcut_updated
from public.user_logic_gate_shortcuts shortcut
join public.users user_row on user_row.user_id = shortcut.user_id
group by shortcut.user_id, user_row.display_name, user_row.email, shortcut.company_id
order by user_row.display_name, shortcut.user_id, shortcut.company_id;

-- Zero rows is required. Payload contents are inspected only enough to identify
-- the three retired derived task kinds; unrelated payload data is not returned.
select event.company_id,
       count(*) as relevant_events_beyond_checkpoint,
       min(event.created_timestamp) as oldest_event_timestamp,
       max(event.created_timestamp) as newest_event_timestamp
from public.domain_events event
left join public.workspace_derived_domain_event_projection_checkpoints checkpoint
  on checkpoint.company_id = event.company_id
where event.stream_type = 'workspace'
  and event.stream_id = event.company_id::text
  and (
    event.event_type in (
      'company_explorer_folder_item_assign_requested',
      'node_map_position_upsert_requested',
      'logic_gate_map_position_upsert_requested'
    )
    or (
      event.event_type = 'workspace_derived_projection_requested'
      and exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(event.payload->'tasks') = 'array'
            then event.payload->'tasks' else '[]'::jsonb end
        ) task
        where task->>'kind' in (
          'company_explorer_folder_item_assign',
          'node_map_position_upsert',
          'logic_gate_map_position_upsert'
        )
      )
    )
  )
  and (
    checkpoint.company_id is null
    or event.created_timestamp > checkpoint.checkpoint_timestamp
    or (
      event.created_timestamp = checkpoint.checkpoint_timestamp
      and event.event_id::text > checkpoint.checkpoint_event_id::text
    )
  )
group by event.company_id
order by event.company_id;

select company_id,
       status,
       placement_count,
       changed_placement_count,
       created_timestamp,
       rolled_back_timestamp
from public.process_map_actual_size_layout_recovery_runs
order by company_id;

select company_id,
       count(*) as stored_placement_rows,
       count(*) filter (where changed_by_migration) as changed_placement_rows
from public.process_map_actual_size_layout_recovery_placements
group by company_id
order by company_id;

-- Catalog inventory for human review. The write script repeats an exact unordered
-- columns/types/nullability/defaults, constraints, and indexes comparison under lock.
select relation.relname as table_name,
       attribute.attname as column_name,
       format_type(attribute.atttypid, attribute.atttypmod) as data_type,
       attribute.attnotnull as is_not_null,
       pg_get_expr(default_row.adbin, default_row.adrelid) as default_expression
from pg_attribute attribute
join pg_class relation on relation.oid = attribute.attrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
left join pg_attrdef default_row
  on default_row.adrelid = attribute.attrelid and default_row.adnum = attribute.attnum
where namespace.nspname = 'public'
  and relation.relname in (
    'user_logic_gate_shortcuts',
    'workspace_derived_domain_event_projection_checkpoints',
    'process_map_actual_size_layout_recovery_placements',
    'process_map_actual_size_layout_recovery_runs'
  )
  and attribute.attnum > 0
  and not attribute.attisdropped
order by relation.relname, attribute.attname;

select relation.relname as table_name,
       constraint_row.conname as constraint_name,
       constraint_row.contype as constraint_type,
       constraint_row.convalidated as is_validated,
       pg_get_constraintdef(constraint_row.oid) as definition
from pg_constraint constraint_row
join pg_class relation on relation.oid = constraint_row.conrelid
join pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname in (
    'user_logic_gate_shortcuts',
    'workspace_derived_domain_event_projection_checkpoints',
    'process_map_actual_size_layout_recovery_placements',
    'process_map_actual_size_layout_recovery_runs'
  )
order by relation.relname, constraint_row.conname;

select table_relation.relname as table_name,
       index_relation.relname as index_name,
       pg_get_indexdef(index_relation.oid) as definition
from pg_index index_row
join pg_class table_relation on table_relation.oid = index_row.indrelid
join pg_namespace namespace on namespace.oid = table_relation.relnamespace
join pg_class index_relation on index_relation.oid = index_row.indexrelid
where namespace.nspname = 'public'
  and table_relation.relname in (
    'user_logic_gate_shortcuts',
    'workspace_derived_domain_event_projection_checkpoints',
    'process_map_actual_size_layout_recovery_placements',
    'process_map_actual_size_layout_recovery_runs'
  )
order by table_relation.relname, index_relation.relname;

select exists (
  select 1
  from public.schema_migrations
  where version = '20260828_zz_retire_unused_operational_tables.sql'
) as retirement_migration_already_recorded;

rollback;
