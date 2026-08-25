-- DESTRUCTIVE, HUMAN-RUN map position retirement. Plain PostgreSQL for DBeaver.
-- Run scripts/map_position_storage_retirement_preflight.sql first with a read-only
-- credential. Do not change these approvals until its READY result is preserved,
-- the matching map-free application is deployed, smoke tests pass, old writers are
-- stopped, and a restorable snapshot is confirmed. This script uses no CASCADE.

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only,
       case
         when current_setting('server_version_num')::integer between 170000 and 179999
           then 'POSTGRESQL_17_SUPPORTED'
         else 'STOP_UNSUPPORTED_POSTGRESQL_VERSION'
       end as version_status;

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create temporary table mangorts_map_position_retirement_approval (
  read_only_preflight_ready boolean not null,
  projection_checkpoint_drained boolean not null,
  map_free_application_deployed boolean not null,
  old_writers_stopped boolean not null,
  smoke_and_snapshot_confirmed boolean not null,
  operator_approved boolean not null
) on commit drop;

-- OPERATOR: change every false to true only after the named evidence exists.
insert into mangorts_map_position_retirement_approval
values (false,false,false,false,false,false);

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: map position retirement supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;
  if current_setting('transaction_read_only')::boolean then
    raise exception 'STOP: retirement requires the human operator write connection';
  end if;
  if not exists (
    select 1 from mangorts_map_position_retirement_approval
    where read_only_preflight_ready
      and projection_checkpoint_drained
      and map_free_application_deployed
      and old_writers_stopped
      and smoke_and_snapshot_confirmed
      and operator_approved
  ) then
    raise exception 'STOP: all six map position retirement approvals must be explicitly true';
  end if;
  if to_regclass('public.domain_events') is null
     or to_regclass('public.workspace_derived_domain_event_projection_checkpoints') is null
     or to_regclass('public.schema_migrations') is null then
    raise exception 'STOP: required projection or migration evidence tables are missing';
  end if;
  if to_regclass('public.node_map_positions') is null
     or to_regclass('public.logic_gate_map_positions') is null then
    raise exception 'STOP: target map position table set drifted or was already retired';
  end if;
  if to_regclass('public.logic_gate_relationships') is not null then
    raise exception 'STOP: retired logic_gate_relationships authority is still present';
  end if;
  if to_regclass('public.process_map_placements') is null
     or to_regclass('public.resource_operational_relationships') is null
     or to_regclass('public.process_map_traces') is null then
    raise exception 'STOP: a canonical Process Map authority is missing';
  end if;
end
$$;

lock table public.node_map_positions, public.logic_gate_map_positions in access exclusive mode;
lock table public.domain_events, public.workspace_derived_domain_event_projection_checkpoints in share mode;

do $$
declare
  dependency_count integer;
begin
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
      ('node_relationships'),
      ('process_map_placements'),('resource_operational_relationships'),('process_map_traces'),
      ('node_textboxes_history'),('logic_gate_textboxes_history'),
      ('node_view_user_versions')
    ) protected(name)
    where to_regclass('public.' || protected.name) is null
  ) then
    raise exception 'STOP: a protected relationship, history, or Node view-version table is missing';
  end if;
end
$$;

drop table public.node_map_positions;
drop table public.logic_gate_map_positions;

insert into schema_migrations(version)
values ('operator/20260805_retire_map_position_storage.sql')
on conflict (version) do nothing;

commit;

select current_setting('server_version') as server_version,
       'MAP_POSITION_RETIREMENT_COMPLETE' as status,
       to_regclass('public.node_map_positions') is null as node_position_table_dropped,
       to_regclass('public.logic_gate_map_positions') is null as logic_gate_position_table_dropped,
       to_regclass('public.node_relationships') is not null as node_relationships_preserved,
       to_regclass('public.logic_gate_relationships') is null as logic_gate_relationships_retired,
       to_regclass('public.process_map_placements') is not null as process_map_placements_preserved,
       to_regclass('public.resource_operational_relationships') is not null as operational_relationships_preserved,
       to_regclass('public.process_map_traces') is not null as process_map_traces_preserved,
       to_regclass('public.node_view_user_versions') is not null as node_view_user_versions_preserved;
