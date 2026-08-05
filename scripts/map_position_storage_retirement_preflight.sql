-- Read-only preflight for retiring Node Map and Logic Gate Map position storage.
-- Open and execute this whole file in DBeaver before the separately approved
-- scripts/retire_map_position_storage.sql transaction. This script writes nothing.

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only,
       case
         when current_setting('server_version_num')::integer between 170000 and 179999
           then 'POSTGRESQL_17_SUPPORTED'
         else 'STOP_UNSUPPORTED_POSTGRESQL_VERSION'
       end as version_status;

begin transaction isolation level repeatable read read only;

set local statement_timeout = '5min';

-- Report historical map work relative to the durable derived-projection checkpoint.
with map_projection_events as (
  select event.company_id, event.event_id, event.event_type, event.created_timestamp
  from domain_events event
  where event.stream_type = 'workspace'
    and event.stream_id = event.company_id::text
    and (
      event.event_type in (
        'node_map_position_upsert_requested',
        'logic_gate_map_position_upsert_requested'
      )
      or (
        event.event_type = 'workspace_derived_projection_requested'
        and exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(event.payload->'tasks') = 'array' then event.payload->'tasks'
              else '[]'::jsonb
            end
          ) task
          where task->>'kind' in (
            'node_map_position_upsert',
            'logic_gate_map_position_upsert'
          )
        )
      )
    )
), classified as (
  select event.*,
         checkpoint.checkpoint_timestamp,
         checkpoint.checkpoint_event_id,
         case
           when checkpoint.company_id is null then true
           when event.created_timestamp > checkpoint.checkpoint_timestamp then true
           when event.created_timestamp = checkpoint.checkpoint_timestamp
             and event.event_id::text > checkpoint.checkpoint_event_id::text then true
           else false
         end as is_pending
  from map_projection_events event
  left join workspace_derived_domain_event_projection_checkpoints checkpoint
    on checkpoint.company_id = event.company_id
)
select company_id,
       count(*) as historical_map_projection_event_count,
       count(*) filter (where is_pending) as pending_map_projection_event_count,
       max(created_timestamp) as newest_map_projection_event_timestamp,
       max(checkpoint_timestamp) as projection_checkpoint_timestamp
from classified
group by company_id
order by company_id;

-- Report the exact target and protected-table presence before the blocking checks.
select name,
       to_regclass('public.' || name) is not null as present
from (values
  ('node_map_positions'),
  ('logic_gate_map_positions'),
  ('node_relationships'),
  ('logic_gate_relationships'),
  ('node_textboxes_history'),
  ('logic_gate_textboxes_history'),
  ('node_content_changes'),
  ('node_content_change_seen'),
  ('node_textbox_seen_snapshots'),
  ('node_view_user_versions')
) target(name)
order by name;

do $$
declare
  dependency_count integer;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: map position retirement supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;

  if not current_setting('transaction_read_only')::boolean then
    raise exception 'STOP: run this preflight with a database-enforced read-only credential';
  end if;

  if to_regclass('public.domain_events') is null
     or to_regclass('public.workspace_derived_domain_event_projection_checkpoints') is null then
    raise exception 'STOP: required derived-projection evidence tables are missing';
  end if;

  if to_regclass('public.node_map_positions') is null
     or to_regclass('public.logic_gate_map_positions') is null then
    raise exception 'STOP: target map position table set drifted or was already retired';
  end if;

  if (select count(*) from pg_attribute
      where attrelid = 'public.node_map_positions'::regclass and attnum > 0 and not attisdropped) <> 5
     or exists((values ('company_id'),('node_id'),('updated_timestamp'),('x'),('y'))
       except select attname from pg_attribute
       where attrelid = 'public.node_map_positions'::regclass and attnum > 0 and not attisdropped)
     or exists(select attname from pg_attribute
       where attrelid = 'public.node_map_positions'::regclass and attnum > 0 and not attisdropped
       except values ('company_id'),('node_id'),('updated_timestamp'),('x'),('y')) then
    raise exception 'STOP: node_map_positions exact unordered column set drifted';
  end if;

  if (select count(*) from pg_attribute
      where attrelid = 'public.logic_gate_map_positions'::regclass and attnum > 0 and not attisdropped) <> 5
     or exists((values ('company_id'),('logic_gate_id'),('updated_timestamp'),('x'),('y'))
       except select attname from pg_attribute
       where attrelid = 'public.logic_gate_map_positions'::regclass and attnum > 0 and not attisdropped)
     or exists(select attname from pg_attribute
       where attrelid = 'public.logic_gate_map_positions'::regclass and attnum > 0 and not attisdropped
       except values ('company_id'),('logic_gate_id'),('updated_timestamp'),('x'),('y')) then
    raise exception 'STOP: logic_gate_map_positions exact unordered column set drifted';
  end if;

  if not exists (
       select 1 from pg_constraint
       where conrelid = 'public.node_map_positions'::regclass and contype = 'p'
         and pg_get_constraintdef(oid) = 'PRIMARY KEY (company_id, node_id)'
     ) or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.logic_gate_map_positions'::regclass and contype = 'p'
         and pg_get_constraintdef(oid) = 'PRIMARY KEY (company_id, logic_gate_id)'
     ) then
    raise exception 'STOP: map position primary-key contract drifted';
  end if;

  if not exists (
       select 1 from pg_constraint
       where conrelid = 'public.node_map_positions'::regclass and contype = 'f'
         and confrelid = 'public.nodes'::regclass and confdeltype = 'c'
     ) or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.logic_gate_map_positions'::regclass and contype = 'f'
         and confrelid = 'public.logic_gates'::regclass and confdeltype = 'c'
     ) then
    raise exception 'STOP: map position foreign-key contract drifted';
  end if;

  if exists (
    select 1
    from domain_events event
    left join workspace_derived_domain_event_projection_checkpoints checkpoint
      on checkpoint.company_id = event.company_id
    where event.stream_type = 'workspace'
      and event.stream_id = event.company_id::text
      and (
        event.event_type in ('node_map_position_upsert_requested','logic_gate_map_position_upsert_requested')
        or (
          event.event_type = 'workspace_derived_projection_requested'
          and exists (
            select 1
            from jsonb_array_elements(
              case when jsonb_typeof(event.payload->'tasks') = 'array'
                then event.payload->'tasks' else '[]'::jsonb end
            ) task
            where task->>'kind' in ('node_map_position_upsert','logic_gate_map_position_upsert')
          )
        )
      )
      and (
        checkpoint.company_id is null
        or event.created_timestamp > checkpoint.checkpoint_timestamp
        or (event.created_timestamp = checkpoint.checkpoint_timestamp
          and event.event_id::text > checkpoint.checkpoint_event_id::text)
      )
  ) then
    raise exception 'STOP: a historical map projection task is still beyond its company checkpoint';
  end if;

  if exists (
    select 1 from pg_constraint
    where contype = 'f'
      and confrelid in ('public.node_map_positions'::regclass,'public.logic_gate_map_positions'::regclass)
  ) then
    raise exception 'STOP: a foreign key still references map position storage';
  end if;

  if exists (
      select 1 from pg_views
      where schemaname not in ('pg_catalog','information_schema')
        and (definition ilike '%node_map_positions%' or definition ilike '%logic_gate_map_positions%')
    ) or exists (
      select 1 from pg_matviews
      where schemaname not in ('pg_catalog','information_schema')
        and (definition ilike '%node_map_positions%' or definition ilike '%logic_gate_map_positions%')
    ) then
    raise exception 'STOP: a view still depends on map position storage';
  end if;

  select count(*) into dependency_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname not in ('pg_catalog','information_schema')
    and procedure.prokind in ('f','p')
    and (pg_get_functiondef(procedure.oid) ilike '%node_map_positions%'
      or pg_get_functiondef(procedure.oid) ilike '%logic_gate_map_positions%');
  if dependency_count <> 0 then
    raise exception 'STOP: % function or procedure definitions still reference map position storage', dependency_count;
  end if;

  if exists (
    select 1
    from (values
      ('node_relationships'),('logic_gate_relationships'),
      ('node_textboxes_history'),('logic_gate_textboxes_history'),
      ('node_content_changes'),('node_content_change_seen'),
      ('node_textbox_seen_snapshots'),('node_view_user_versions')
    ) protected(name)
    where to_regclass('public.' || protected.name) is null
  ) then
    raise exception 'STOP: a protected relationship, history, or unread/highlight table is missing';
  end if;
end
$$;

select current_setting('server_version') as server_version,
       'READY_FOR_SEPARATELY_APPROVED_MAP_POSITION_RETIREMENT' as status,
       (select count(*) from node_map_positions) as node_position_rows,
       (select count(*) from logic_gate_map_positions) as logic_gate_position_rows;

rollback;