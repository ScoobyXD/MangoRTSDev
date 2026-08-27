-- Guarded append-only compensation for
-- 20260826_zzzy_process_map_actual_size_square_layout.sql.
-- Run directly in PostgreSQL 17+ (including DBeaver). This is intentionally
-- not a normal migration file and MUST NOT be placed in backend/db/migrations.

begin;

set local timezone='UTC';

do $$
begin
  raise notice 'Process Map actual-size rollback connected PostgreSQL server_version=% server_version_num=%',
    current_setting('server_version'),current_setting('server_version_num');
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: Process Map actual-size rollback requires PostgreSQL 17 or newer';
  end if;
  if to_regclass('public.schema_migrations') is null
     or to_regclass('public.company_explorer_folders') is null
     or to_regclass('public.company_explorer_items') is null
     or to_regclass('public.logic_gates') is null
     or to_regclass('public.process_map_placements') is null
     or to_regclass('public.domain_events') is null
     or to_regclass('public.workspace_read_versions') is null
     or to_regclass('public.process_map_actual_size_layout_recovery_placements') is null
     or to_regclass('public.process_map_actual_size_layout_recovery_runs') is null
     or to_regprocedure('public.workspace_read_version_keys_for_domain_event(text,jsonb)') is null
     or to_regprocedure('public.trg_update_workspace_read_versions()') is null then
    raise exception 'STOP: Process Map actual-size rollback requires the complete application and recovery structure';
  end if;
  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid='public.domain_events'::regclass
      and trigger_row.tgname='trg_update_workspace_read_versions'
      and trigger_row.tgfoid=to_regprocedure('public.trg_update_workspace_read_versions()')
      and trigger_row.tgenabled in ('O','A')
      and not trigger_row.tgisinternal
  ) then
    raise exception 'STOP: Process Map actual-size rollback requires the enabled read-version trigger';
  end if;
end $$;

lock table schema_migrations, company_explorer_folders, company_explorer_items,
  logic_gates, process_map_placements, domain_events, workspace_read_versions,
  process_map_actual_size_layout_recovery_placements,
  process_map_actual_size_layout_recovery_runs in share row exclusive mode;

do $$
begin
  if (select count(*) from pg_attribute
      where attrelid='process_map_actual_size_layout_recovery_placements'::regclass
        and attnum>0 and not attisdropped)<>20
     or exists (
       with expected(column_name,data_type,is_not_null) as (values
         ('company_id','uuid',true),('resource_type','text',true),('resource_id','uuid',true),
         ('placement_incarnation_token','uuid',true),('map_parent_folder_id','uuid',false),
         ('before_grid_x','integer',true),('before_grid_y','integer',true),
         ('before_grid_width','integer',true),('before_grid_height','integer',true),
         ('before_revision','bigint',true),
         ('before_created_timestamp','timestamp with time zone',true),
         ('before_updated_timestamp','timestamp with time zone',true),
         ('expected_grid_x','integer',true),('expected_grid_y','integer',true),
         ('expected_grid_width','integer',true),('expected_grid_height','integer',true),
         ('expected_revision','bigint',true),
         ('expected_created_timestamp','timestamp with time zone',true),
         ('expected_updated_timestamp','timestamp with time zone',true),
         ('changed_by_migration','boolean',true)
       ), actual as (
         select attribute.attname::text column_name,
                format_type(attribute.atttypid,attribute.atttypmod) data_type,
                attribute.attnotnull is_not_null
         from pg_attribute attribute
         where attribute.attrelid='process_map_actual_size_layout_recovery_placements'::regclass
           and attribute.attnum>0 and not attribute.attisdropped
       )
       (select * from expected except select * from actual)
       union all
       (select * from actual except select * from expected)
     )
     or (select count(*) from pg_attribute
         where attrelid='process_map_actual_size_layout_recovery_runs'::regclass
           and attnum>0 and not attisdropped)<>14
     or exists (
       with expected(column_name,data_type,is_not_null) as (values
         ('company_id','uuid',true),('recovery_key','text',true),
         ('format_version','integer',true),('status','text',true),
         ('marker_event_id','uuid',true),('marker_sequence','bigint',true),
         ('marker_created_timestamp','timestamp with time zone',true),
         ('placement_count','bigint',true),('changed_placement_count','bigint',true),
         ('placement_checksum','text',true),
         ('created_timestamp','timestamp with time zone',true),
         ('rollback_event_id','uuid',false),('rollback_sequence','bigint',false),
         ('rolled_back_timestamp','timestamp with time zone',false)
       ), actual as (
         select attribute.attname::text column_name,
                format_type(attribute.atttypid,attribute.atttypmod) data_type,
                attribute.attnotnull is_not_null
         from pg_attribute attribute
         where attribute.attrelid='process_map_actual_size_layout_recovery_runs'::regclass
           and attribute.attnum>0 and not attribute.attisdropped
       )
       (select * from expected except select * from actual)
       union all
       (select * from actual except select * from expected)
     )
     or not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid='process_map_actual_size_layout_recovery_placements'::regclass
         and constraint_row.conname='process_map_actual_size_layout_recovery_placements_pkey'
         and constraint_row.contype='p' and constraint_row.convalidated
         and pg_get_constraintdef(constraint_row.oid)='PRIMARY KEY (company_id, resource_type, resource_id)'
     )
     or not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid='process_map_actual_size_layout_recovery_runs'::regclass
         and constraint_row.conname='process_map_actual_size_layout_recovery_runs_pkey'
         and constraint_row.contype='p' and constraint_row.convalidated
         and pg_get_constraintdef(constraint_row.oid)='PRIMARY KEY (company_id)'
     )
     or (select count(*)
         from pg_constraint constraint_row
         where constraint_row.conrelid='process_map_actual_size_layout_recovery_runs'::regclass
           and constraint_row.contype='c' and constraint_row.convalidated
           and (constraint_row.conname,pg_get_constraintdef(constraint_row.oid)) in (values
             ('pm_actual_size_recovery_runs_format_chk','CHECK ((format_version = 1))'),
             ('pm_actual_size_recovery_runs_status_chk','CHECK ((status = ANY (ARRAY[''applied''::text, ''rolled_back''::text])))'),
             ('pm_actual_size_recovery_runs_counts_chk','CHECK (((placement_count >= 0) AND (changed_placement_count >= 0) AND (changed_placement_count <= placement_count)))'),
             ('pm_actual_size_recovery_runs_rollback_state_chk','CHECK ((((status = ''applied''::text) AND (rollback_event_id IS NULL) AND (rollback_sequence IS NULL) AND (rolled_back_timestamp IS NULL)) OR ((status = ''rolled_back''::text) AND (rollback_event_id IS NOT NULL) AND (rollback_sequence IS NOT NULL) AND (rolled_back_timestamp IS NOT NULL))))')
           ))<>4 then
    raise exception 'STOP: Process Map actual-size recovery table structure is unsafe';
  end if;
end $$;

do $$
begin
  if not exists(select 1 from process_map_actual_size_layout_recovery_runs) then
    raise exception 'STOP: Process Map actual-size rollback recovery run metadata is missing';
  end if;
  if exists (
    select 1
    from process_map_actual_size_layout_recovery_runs run
    where run.recovery_key<>'migration:20260826-process-map-actual-size-square-layout'
       or run.format_version<>1
       or run.status<>'applied'
       or run.rollback_event_id is not null
       or run.rollback_sequence is not null
       or run.rolled_back_timestamp is not null
  ) then
    raise exception 'STOP: Process Map actual-size rollback already ran or recovery run metadata is corrupt';
  end if;

  if exists (
    (select distinct company_id from process_map_actual_size_layout_recovery_placements
     except
     select company_id from process_map_actual_size_layout_recovery_runs)
    union all
    (select company_id from process_map_actual_size_layout_recovery_runs
     except
     select distinct company_id from process_map_actual_size_layout_recovery_placements)
  ) then
    raise exception 'STOP: Process Map actual-size rollback recovery company membership is corrupt';
  end if;

  if exists (
    select 1
    from process_map_actual_size_layout_recovery_runs run
    where run.placement_count<>(
      select count(*) from process_map_actual_size_layout_recovery_placements snapshot
      where snapshot.company_id=run.company_id
    ) or run.changed_placement_count<>(
      select count(*) from process_map_actual_size_layout_recovery_placements snapshot
      where snapshot.company_id=run.company_id and snapshot.changed_by_migration
    ) or run.placement_checksum is distinct from (
      select md5(coalesce(jsonb_agg(to_jsonb(snapshot) order by resource_type,resource_id)::text,'[]'))
      from process_map_actual_size_layout_recovery_placements snapshot
      where snapshot.company_id=run.company_id
    )
  ) then
    raise exception 'STOP: Process Map actual-size rollback recovery snapshot is missing or corrupt';
  end if;

  if exists (
    select 1
    from process_map_actual_size_layout_recovery_placements snapshot
    left join process_map_placements placement
      on placement.company_id=snapshot.company_id
     and placement.resource_type=snapshot.resource_type
     and placement.resource_id=snapshot.resource_id
    where placement.resource_id is null
       or placement.placement_incarnation_token is distinct from snapshot.placement_incarnation_token
       or placement.map_parent_folder_id is distinct from snapshot.map_parent_folder_id
       or placement.grid_x is distinct from snapshot.expected_grid_x
       or placement.grid_y is distinct from snapshot.expected_grid_y
       or placement.grid_width is distinct from snapshot.expected_grid_width
       or placement.grid_height is distinct from snapshot.expected_grid_height
       or placement.revision is distinct from snapshot.expected_revision
       or placement.created_timestamp is distinct from snapshot.expected_created_timestamp
       or placement.updated_timestamp is distinct from snapshot.expected_updated_timestamp
  ) or exists (
    select 1
    from process_map_placements placement
    where placement.company_id in (select company_id from process_map_actual_size_layout_recovery_runs)
      and not exists (
        select 1
        from process_map_actual_size_layout_recovery_placements snapshot
        where snapshot.company_id=placement.company_id
          and snapshot.resource_type=placement.resource_type
          and snapshot.resource_id=placement.resource_id
      )
  ) then
    raise exception 'STOP: Process Map placement membership, identity, parent, or expected post-layout state changed';
  end if;

  if exists (
    select 1
    from process_map_actual_size_layout_recovery_placements snapshot
    where (snapshot.resource_type='company_explorer_folder' and not exists (
      select 1 from company_explorer_folders folder
      where folder.company_id=snapshot.company_id
        and folder.folder_id=snapshot.resource_id
        and folder.parent_folder_id is not distinct from snapshot.map_parent_folder_id
    )) or (snapshot.resource_type='logic_gate' and not exists (
      select 1 from company_explorer_items item
      where item.company_id=snapshot.company_id
        and item.target_type='logic_gate'
        and item.target_id=snapshot.resource_id
        and item.parent_folder_id is not distinct from snapshot.map_parent_folder_id
    ))
  ) or exists (
    select 1
    from company_explorer_folders folder
    where folder.company_id in (select company_id from process_map_actual_size_layout_recovery_runs)
      and not exists (
        select 1 from process_map_actual_size_layout_recovery_placements snapshot
        where snapshot.company_id=folder.company_id
          and snapshot.resource_type='company_explorer_folder'
          and snapshot.resource_id=folder.folder_id
      )
  ) or exists (
    select 1
    from company_explorer_items item
    where item.target_type='logic_gate'
      and item.company_id in (select company_id from process_map_actual_size_layout_recovery_runs)
      and not exists (
        select 1 from process_map_actual_size_layout_recovery_placements snapshot
        where snapshot.company_id=item.company_id
          and snapshot.resource_type='logic_gate'
          and snapshot.resource_id=item.target_id
      )
  ) then
    raise exception 'STOP: Process Map Explorer membership or parentage changed after the actual-size migration';
  end if;

  if exists (
    select 1
    from process_map_actual_size_layout_recovery_runs run
    left join domain_events marker
      on marker.company_id=run.company_id and marker.event_id=run.marker_event_id
    where marker.event_id is null
       or marker.stream_type is distinct from 'workspace'
       or marker.stream_id is distinct from run.company_id::text
       or marker.sequence is distinct from run.marker_sequence
       or marker.event_type is distinct from 'process_map_placement_saved'
       or marker.actor_user_id is not null
       or marker.idempotency_key is distinct from 'migration:20260826-process-map-actual-size-square-layout'
       or marker.payload is distinct from jsonb_build_object('realtime_change_type','process_map_actual_size_square_layout_applied')
       or marker.created_timestamp is distinct from run.marker_created_timestamp
       or exists (
         select 1
         from domain_events later
         where later.company_id=run.company_id
           and later.stream_type='workspace'
           and later.stream_id=run.company_id::text
           and later.sequence>run.marker_sequence
           and exists (
             select 1
             from workspace_read_version_keys_for_domain_event(later.event_type,later.payload) key
             where key.scope='process-map'
           )
       )
  ) or exists (
    select 1
    from domain_events marker
    where marker.idempotency_key='migration:20260826-process-map-actual-size-square-layout'
      and not exists (
        select 1 from process_map_actual_size_layout_recovery_runs run
        where run.company_id=marker.company_id and run.marker_event_id=marker.event_id
      )
  ) then
    raise exception 'STOP: Process Map relevant event state changed after the actual-size migration';
  end if;

  if exists (
    select 1
    from process_map_actual_size_layout_recovery_runs run
    where not exists (
      select 1 from workspace_read_versions read_version
      where read_version.company_id=run.company_id
        and read_version.scope='process-map' and read_version.resource_key=''
        and read_version.version=run.marker_sequence
    )
  ) then
    raise exception 'STOP: Process Map read version changed after the actual-size migration';
  end if;

  if exists (
    select 1
    from process_map_actual_size_layout_recovery_runs run
    where greatest(
      coalesce((
        select max(event.sequence)
        from domain_events event
        where event.company_id=run.company_id
          and event.stream_type='workspace'
          and event.stream_id=run.company_id::text
      ),0),
      coalesce((
        select read_version.version from workspace_read_versions read_version
        where read_version.company_id=run.company_id
          and read_version.scope='process-map' and read_version.resource_key=''
      ),0),
      coalesce((
        select read_version.version from workspace_read_versions read_version
        where read_version.company_id=run.company_id
          and read_version.scope='workspace-snapshot:full' and read_version.resource_key=''
      ),0)
    )=9223372036854775807
  ) then
    raise exception 'STOP: Process Map actual-size rollback cannot advance a maximum workspace event sequence';
  end if;

  if (
    select count(*) from schema_migrations
    where version in (
      '20260826_zzzy_process_map_actual_size_square_layout.sql',
      '20260826_zzzz_process_map_tidy_initial_layout.sql',
      '20260826_zzzzz_process_map_rectangular_layout.sql',
      '20260826_zzzzzz_process_map_square_layout.sql'
    )
  )<>4 then
    raise exception 'STOP: Process Map actual-size replay-safety ledger state changed';
  end if;
  if exists (
    select 1 from domain_events
    where idempotency_key='migration:20260826-process-map-actual-size-square-layout:rollback'
  ) then
    raise exception 'STOP: Process Map actual-size rollback was already recorded';
  end if;
  if exists (
    select 1
    from process_map_actual_size_layout_recovery_placements
    where changed_by_migration and expected_revision=9223372036854775807
  ) then
    raise exception 'STOP: Process Map actual-size rollback cannot advance a maximum placement revision';
  end if;
end $$;

do $$
declare
  expected_count bigint;
  updated_count bigint;
begin
  select count(*) into expected_count
  from process_map_actual_size_layout_recovery_placements
  where changed_by_migration;

  update process_map_placements placement
  set grid_x=snapshot.before_grid_x,
      grid_y=snapshot.before_grid_y,
      grid_width=snapshot.before_grid_width,
      grid_height=snapshot.before_grid_height,
      revision=placement.revision+1,
      updated_timestamp=statement_timestamp()
  from process_map_actual_size_layout_recovery_placements snapshot
  where snapshot.changed_by_migration
    and placement.company_id=snapshot.company_id
    and placement.resource_type=snapshot.resource_type
    and placement.resource_id=snapshot.resource_id;

  get diagnostics updated_count=row_count;
  if updated_count<>expected_count then
    raise exception 'STOP: Process Map actual-size rollback updated % placements; expected %',updated_count,expected_count;
  end if;
end $$;

with company_sequence as (
  select run.company_id,
         greatest(
           coalesce((
             select max(event.sequence) from domain_events event
             where event.company_id=run.company_id
               and event.stream_type='workspace'
               and event.stream_id=run.company_id::text
           ),0),
           coalesce((
             select read_version.version from workspace_read_versions read_version
             where read_version.company_id=run.company_id
               and read_version.scope='process-map' and read_version.resource_key=''
           ),0),
           coalesce((
             select read_version.version from workspace_read_versions read_version
             where read_version.company_id=run.company_id
               and read_version.scope='workspace-snapshot:full' and read_version.resource_key=''
           ),0)
         ) maximum_sequence
  from process_map_actual_size_layout_recovery_runs run
)
insert into domain_events(
  event_id,company_id,stream_type,stream_id,sequence,event_type,
  actor_user_id,idempotency_key,payload,created_timestamp
)
select gen_random_uuid(),company.company_id,'workspace',company.company_id::text,
       company.maximum_sequence+1,'process_map_placement_saved',null,
       'migration:20260826-process-map-actual-size-square-layout:rollback',
       jsonb_build_object('realtime_change_type','process_map_actual_size_square_layout_rolled_back'),
       statement_timestamp()
from company_sequence company;

do $$
begin
  if exists (
    select 1
    from process_map_actual_size_layout_recovery_runs run
    left join domain_events rollback_event
      on rollback_event.company_id=run.company_id
     and rollback_event.idempotency_key='migration:20260826-process-map-actual-size-square-layout:rollback'
    where rollback_event.event_id is null
       or not exists (
         select 1 from workspace_read_versions read_version
         where read_version.company_id=run.company_id
           and read_version.scope='process-map' and read_version.resource_key=''
           and read_version.version=rollback_event.sequence
       )
       or not exists (
         select 1 from workspace_read_versions read_version
         where read_version.company_id=run.company_id
           and read_version.scope='workspace-snapshot:full' and read_version.resource_key=''
           and read_version.version=rollback_event.sequence
       )
  ) then
    raise exception 'STOP: Process Map actual-size rollback marker did not advance required read versions';
  end if;
end $$;

update process_map_actual_size_layout_recovery_runs run
set status='rolled_back',
    rollback_event_id=event.event_id,
    rollback_sequence=event.sequence,
    rolled_back_timestamp=event.created_timestamp
from domain_events event
where event.company_id=run.company_id
  and event.idempotency_key='migration:20260826-process-map-actual-size-square-layout:rollback';

commit;
