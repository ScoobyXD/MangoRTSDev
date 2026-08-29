-- DESTRUCTIVE, HUMAN-RUN retirement for four obsolete tables. Plain PostgreSQL
-- for DBeaver. Deploy the shortcut-free application, stop every old application
-- instance, then run retire_unused_operational_tables_preflight.sql with the
-- database-enforced read-only credential. Confirm a restorable snapshot, then
-- change every approval below to true. This script serializes with the migration runner,
-- validates the exact table structures, uses no CASCADE, and records the matching
-- human-gated migration sentinel in the same transaction as the four strict drops.

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only,
       case
         when current_setting('server_version_num')::integer between 170000 and 189999
           then 'POSTGRESQL_VERSION_SUPPORTED'
         else 'STOP_UNSUPPORTED_POSTGRESQL_VERSION'
       end as version_status;

select target.name,
       to_regclass('public.' || target.name) is not null as present
from (values
  ('user_logic_gate_shortcuts'),
  ('workspace_derived_domain_event_projection_checkpoints'),
  ('process_map_actual_size_layout_recovery_placements'),
  ('process_map_actual_size_layout_recovery_runs')
) target(name)
order by target.name;

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';
set local search_path = public, pg_catalog;

create temporary table mangorts_unused_table_retirement_approval (
  read_only_preflight_confirmed boolean not null,
  shortcut_free_application_deployed boolean not null,
  old_application_instances_stopped boolean not null,
  restorable_snapshot_confirmed boolean not null,
  operator_approved boolean not null
) on commit drop;

-- OPERATOR: change every false to true only after the named evidence exists.
insert into mangorts_unused_table_retirement_approval
values (false,false,false,false,false);

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'STOP: retirement supports PostgreSQL 17.x and 18.x; connected server is %',
      current_setting('server_version');
  end if;
  if current_setting('transaction_read_only')::boolean then
    raise exception 'STOP: retirement requires the human operator write connection';
  end if;
  if not exists (
    select 1
    from mangorts_unused_table_retirement_approval
    where read_only_preflight_confirmed
      and shortcut_free_application_deployed
      and old_application_instances_stopped
      and restorable_snapshot_confirmed
      and operator_approved
  ) then
    raise exception 'STOP: all five retirement approvals must be explicitly true';
  end if;
end;
$$;

-- Same key as backend/cmd/miraeopus-migrate. Session and transaction advisory
-- locks conflict, so this cannot race a normal migration run.
select pg_advisory_xact_lock(4855156563379734401);

do $$
declare
  missing_tables text;
begin
  if to_regclass('public.schema_migrations') is null
     or to_regclass('public.domain_events') is null then
    raise exception 'STOP: required migration or event evidence table is missing';
  end if;
  if exists (
    select 1
    from public.schema_migrations
    where version = '20260828_zz_retire_unused_operational_tables.sql'
  ) then
    raise exception 'STOP: the retirement migration sentinel is already recorded';
  end if;

  select string_agg(target.name, ', ' order by target.name)
  into missing_tables
  from (values
    ('user_logic_gate_shortcuts'),
    ('workspace_derived_domain_event_projection_checkpoints'),
    ('process_map_actual_size_layout_recovery_placements'),
    ('process_map_actual_size_layout_recovery_runs')
  ) target(name)
  where to_regclass('public.' || target.name) is null;
  if missing_tables is not null then
    raise exception 'STOP: retirement target table set drifted; missing: %', missing_tables;
  end if;
end;
$$;

lock table public.domain_events in share mode;
lock table public.user_logic_gate_shortcuts,
  public.workspace_derived_domain_event_projection_checkpoints,
  public.process_map_actual_size_layout_recovery_placements,
  public.process_map_actual_size_layout_recovery_runs in access exclusive mode;

create temporary table mangorts_unused_table_expected_columns (
  table_name text not null,
  column_name text not null,
  data_type text not null,
  is_not_null boolean not null,
  default_expression text,
  primary key (table_name, column_name)
) on commit drop;

insert into mangorts_unused_table_expected_columns values
  ('user_logic_gate_shortcuts','user_id','uuid',true,null),
  ('user_logic_gate_shortcuts','company_id','uuid',true,null),
  ('user_logic_gate_shortcuts','logic_gate_id','uuid',true,null),
  ('user_logic_gate_shortcuts','position','integer',true,null),
  ('user_logic_gate_shortcuts','created_timestamp','timestamp with time zone',true,'now()'),
  ('user_logic_gate_shortcuts','updated_timestamp','timestamp with time zone',true,'now()'),
  ('workspace_derived_domain_event_projection_checkpoints','company_id','uuid',true,null),
  ('workspace_derived_domain_event_projection_checkpoints','checkpoint_timestamp','timestamp with time zone',true,null),
  ('workspace_derived_domain_event_projection_checkpoints','checkpoint_event_id','uuid',true,null),
  ('workspace_derived_domain_event_projection_checkpoints','updated_timestamp','timestamp with time zone',true,'now()'),
  ('process_map_actual_size_layout_recovery_placements','company_id','uuid',true,null),
  ('process_map_actual_size_layout_recovery_placements','resource_type','text',true,null),
  ('process_map_actual_size_layout_recovery_placements','resource_id','uuid',true,null),
  ('process_map_actual_size_layout_recovery_placements','placement_incarnation_token','uuid',true,null),
  ('process_map_actual_size_layout_recovery_placements','map_parent_folder_id','uuid',false,null),
  ('process_map_actual_size_layout_recovery_placements','before_grid_x','integer',true,null),
  ('process_map_actual_size_layout_recovery_placements','before_grid_y','integer',true,null),
  ('process_map_actual_size_layout_recovery_placements','before_grid_width','integer',true,null),
  ('process_map_actual_size_layout_recovery_placements','before_grid_height','integer',true,null),
  ('process_map_actual_size_layout_recovery_placements','before_revision','bigint',true,null),
  ('process_map_actual_size_layout_recovery_placements','before_created_timestamp','timestamp with time zone',true,null),
  ('process_map_actual_size_layout_recovery_placements','before_updated_timestamp','timestamp with time zone',true,null),
  ('process_map_actual_size_layout_recovery_placements','expected_grid_x','integer',true,null),
  ('process_map_actual_size_layout_recovery_placements','expected_grid_y','integer',true,null),
  ('process_map_actual_size_layout_recovery_placements','expected_grid_width','integer',true,null),
  ('process_map_actual_size_layout_recovery_placements','expected_grid_height','integer',true,null),
  ('process_map_actual_size_layout_recovery_placements','expected_revision','bigint',true,null),
  ('process_map_actual_size_layout_recovery_placements','expected_created_timestamp','timestamp with time zone',true,null),
  ('process_map_actual_size_layout_recovery_placements','expected_updated_timestamp','timestamp with time zone',true,null),
  ('process_map_actual_size_layout_recovery_placements','changed_by_migration','boolean',true,null),
  ('process_map_actual_size_layout_recovery_runs','company_id','uuid',true,null),
  ('process_map_actual_size_layout_recovery_runs','recovery_key','text',true,null),
  ('process_map_actual_size_layout_recovery_runs','format_version','integer',true,null),
  ('process_map_actual_size_layout_recovery_runs','status','text',true,null),
  ('process_map_actual_size_layout_recovery_runs','marker_event_id','uuid',true,null),
  ('process_map_actual_size_layout_recovery_runs','marker_sequence','bigint',true,null),
  ('process_map_actual_size_layout_recovery_runs','marker_created_timestamp','timestamp with time zone',true,null),
  ('process_map_actual_size_layout_recovery_runs','placement_count','bigint',true,null),
  ('process_map_actual_size_layout_recovery_runs','changed_placement_count','bigint',true,null),
  ('process_map_actual_size_layout_recovery_runs','placement_checksum','text',true,null),
  ('process_map_actual_size_layout_recovery_runs','created_timestamp','timestamp with time zone',true,null),
  ('process_map_actual_size_layout_recovery_runs','rollback_event_id','uuid',false,null),
  ('process_map_actual_size_layout_recovery_runs','rollback_sequence','bigint',false,null),
  ('process_map_actual_size_layout_recovery_runs','rolled_back_timestamp','timestamp with time zone',false,null);

create temporary table mangorts_unused_table_expected_constraints (
  table_name text not null,
  constraint_name text not null,
  constraint_type text not null,
  is_validated boolean not null,
  definition text not null,
  primary key (table_name, constraint_name)
) on commit drop;

insert into mangorts_unused_table_expected_constraints values
  ('user_logic_gate_shortcuts','user_logic_gate_shortcuts_pkey','p',true,'PRIMARY KEY (user_id, company_id, logic_gate_id)'),
  ('user_logic_gate_shortcuts','user_logic_gate_shortcuts_user_id_fkey','f',true,'FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE'),
  ('user_logic_gate_shortcuts','user_logic_gate_shortcuts_company_id_logic_gate_id_fkey','f',true,'FOREIGN KEY (company_id, logic_gate_id) REFERENCES logic_gates(company_id, logic_gate_id) ON DELETE CASCADE'),
  ('workspace_derived_domain_event_projection_checkpoints','workspace_derived_domain_event_projection_checkpoints_pkey','p',true,'PRIMARY KEY (company_id)'),
  ('process_map_actual_size_layout_recovery_placements','process_map_actual_size_layout_recovery_placements_pkey','p',true,'PRIMARY KEY (company_id, resource_type, resource_id)'),
  ('process_map_actual_size_layout_recovery_runs','process_map_actual_size_layout_recovery_runs_pkey','p',true,'PRIMARY KEY (company_id)'),
  ('process_map_actual_size_layout_recovery_runs','pm_actual_size_recovery_runs_format_chk','c',true,'CHECK ((format_version = 1))'),
  ('process_map_actual_size_layout_recovery_runs','pm_actual_size_recovery_runs_status_chk','c',true,'CHECK ((status = ANY (ARRAY[''applied''::text, ''rolled_back''::text])))'),
  ('process_map_actual_size_layout_recovery_runs','pm_actual_size_recovery_runs_counts_chk','c',true,'CHECK (((placement_count >= 0) AND (changed_placement_count >= 0) AND (changed_placement_count <= placement_count)))'),
  ('process_map_actual_size_layout_recovery_runs','pm_actual_size_recovery_runs_rollback_state_chk','c',true,'CHECK ((((status = ''applied''::text) AND (rollback_event_id IS NULL) AND (rollback_sequence IS NULL) AND (rolled_back_timestamp IS NULL)) OR ((status = ''rolled_back''::text) AND (rollback_event_id IS NOT NULL) AND (rollback_sequence IS NOT NULL) AND (rolled_back_timestamp IS NOT NULL))))');

do $$
declare
  column_drift text;
  constraint_drift text;
  index_drift text;
begin
  if (
    select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'user_logic_gate_shortcuts',
        'workspace_derived_domain_event_projection_checkpoints',
        'process_map_actual_size_layout_recovery_placements',
        'process_map_actual_size_layout_recovery_runs'
      )
      and relation.relkind = 'r'
      and relation.relpersistence = 'p'
  ) <> 4 then
    raise exception 'STOP: every retirement target must be an ordinary permanent public table';
  end if;

  with actual as (
    select relation.relname::text as table_name,
           attribute.attname::text as column_name,
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
  ), drift as (
    (select * from mangorts_unused_table_expected_columns except select * from actual)
    union all
    (select * from actual except select * from mangorts_unused_table_expected_columns)
  )
  select string_agg(distinct table_name, ', ' order by table_name)
  into column_drift
  from drift;
  if column_drift is not null then
    raise exception 'STOP: exact unordered column/type/nullability/default set drifted for: %', column_drift;
  end if;

  with actual as (
    select relation.relname::text as table_name,
           constraint_row.conname::text as constraint_name,
           constraint_row.contype::text as constraint_type,
           constraint_row.convalidated as is_validated,
           replace(pg_get_constraintdef(constraint_row.oid), 'public.', '') as definition
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
      and constraint_row.contype in ('p','f','c','u','x')
  ), drift as (
    (select * from mangorts_unused_table_expected_constraints except select * from actual)
    union all
    (select * from actual except select * from mangorts_unused_table_expected_constraints)
  )
  select string_agg(distinct table_name, ', ' order by table_name)
  into constraint_drift
  from drift;
  if constraint_drift is not null then
    raise exception 'STOP: exact primary/check/foreign/unique/exclusion constraint set drifted for: %', constraint_drift;
  end if;

  with expected(table_name, index_count) as (values
    ('user_logic_gate_shortcuts',2::bigint),
    ('workspace_derived_domain_event_projection_checkpoints',1::bigint),
    ('process_map_actual_size_layout_recovery_placements',1::bigint),
    ('process_map_actual_size_layout_recovery_runs',1::bigint)
  ), actual as (
    select relation.relname::text as table_name, count(*) as index_count
    from pg_index index_row
    join pg_class relation on relation.oid = index_row.indrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (select table_name from expected)
    group by relation.relname
  )
  select string_agg(expected.table_name, ', ' order by expected.table_name)
  into index_drift
  from expected
  left join actual using (table_name)
  where actual.index_count is distinct from expected.index_count;
  if index_drift is not null then
    raise exception 'STOP: exact index count drifted for: %', index_drift;
  end if;

  if not exists (
    select 1
    from pg_index index_row
    join pg_class table_relation on table_relation.oid = index_row.indrelid
    join pg_namespace namespace on namespace.oid = table_relation.relnamespace
    join pg_class index_relation on index_relation.oid = index_row.indexrelid
    join pg_am access_method on access_method.oid = index_relation.relam
    where namespace.nspname = 'public'
      and table_relation.relname = 'user_logic_gate_shortcuts'
      and index_relation.relname = 'idx_user_logic_gate_shortcuts_user_company_position'
      and access_method.amname = 'btree'
      and not index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indislive
      and index_row.indpred is null
      and index_row.indexprs is null
      and index_row.indnkeyatts = 4
      and index_row.indnatts = 4
      and (
        select array_agg(attribute.attname::text order by key.ordinality)
        from unnest(index_row.indkey) with ordinality key(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = index_row.indrelid and attribute.attnum = key.attnum
      ) = array['user_id','company_id','position','logic_gate_id']::text[]
  ) then
    raise exception 'STOP: shortcut ordering index identity drifted';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
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
  ) then
    raise exception 'STOP: a historical derived-projection task is still beyond its company checkpoint';
  end if;
end;
$$;

select
  (select count(*) from public.user_logic_gate_shortcuts) as shortcut_rows_to_delete,
  (select count(*) from public.workspace_derived_domain_event_projection_checkpoints) as checkpoint_rows_to_delete,
  (select count(*) from public.process_map_actual_size_layout_recovery_placements) as recovery_placement_rows_to_delete,
  (select count(*) from public.process_map_actual_size_layout_recovery_runs) as recovery_run_rows_to_delete;

drop table public.user_logic_gate_shortcuts;
drop table public.workspace_derived_domain_event_projection_checkpoints;
drop table public.process_map_actual_size_layout_recovery_placements;
drop table public.process_map_actual_size_layout_recovery_runs;

insert into public.schema_migrations(version)
values ('20260828_zz_retire_unused_operational_tables.sql');

commit;

select current_setting('server_version') as server_version,
       'UNUSED_OPERATIONAL_TABLE_RETIREMENT_COMPLETE' as status,
       to_regclass('public.user_logic_gate_shortcuts') is null as shortcuts_dropped,
       to_regclass('public.workspace_derived_domain_event_projection_checkpoints') is null as checkpoint_dropped,
       to_regclass('public.process_map_actual_size_layout_recovery_placements') is null as recovery_placements_dropped,
       to_regclass('public.process_map_actual_size_layout_recovery_runs') is null as recovery_runs_dropped,
       exists (
         select 1 from public.schema_migrations
         where version = '20260828_zz_retire_unused_operational_tables.sql'
       ) as migration_recorded;
