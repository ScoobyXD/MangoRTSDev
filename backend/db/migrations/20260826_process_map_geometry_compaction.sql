begin;

lock table process_map_placements, process_map_traces, resource_operational_relationships, recycle_bin_items in share row exclusive mode;
lock table company_explorer_folders, logic_gates in share mode;

do $$
declare
  company_row record;
begin
  raise notice 'Process Map geometry compaction connected PostgreSQL server_version=% server_version_num=%',
    current_setting('server_version'),current_setting('server_version_num');
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: Process Map geometry compaction requires PostgreSQL 17 or newer';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema='public'
      and table_name='process_map_placements'
      and column_name in ('grid_width','grid_height','placement_incarnation_token')
  ) <> 3 then
    raise exception 'STOP: Process Map V3 geometry is missing or partially drifted';
  end if;

  if exists (
    select 1
    from recycle_bin_items item
    where jsonb_typeof(item.restore_payload) is distinct from 'object'
       or (item.restore_payload ? 'process_map_placements'
         and jsonb_typeof(item.restore_payload->'process_map_placements') is distinct from 'array')
       or (item.restore_payload ? 'process_map_traces'
         and jsonb_typeof(item.restore_payload->'process_map_traces') is distinct from 'array')
       or (item.restore_payload ? 'process_map_cleanup_child_reparents'
         and jsonb_typeof(item.restore_payload->'process_map_cleanup_child_reparents') is distinct from 'array')
  ) then
    raise exception 'STOP: Process Map geometry compaction found a malformed recycle collection';
  end if;

  for company_row in
    select company_id
    from (
      select company_id from process_map_placements
      union
      select company_id
      from recycle_bin_items
      where restore_payload ?| array[
        'process_map_placements','process_map_traces','process_map_cleanup_child_reparents'
      ]
    ) affected
    order by company_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('process-map-parent:' || company_row.company_id::text,0));
  end loop;

  if exists (
    select 1
    from process_map_placements placement
    left join company_explorer_folders folder
      on placement.resource_type='company_explorer_folder'
     and folder.company_id=placement.company_id
     and folder.folder_id=placement.resource_id
    left join logic_gates process
      on placement.resource_type='logic_gate'
     and process.company_id=placement.company_id
     and process.logic_gate_id=placement.resource_id
    where placement.resource_type not in ('company_explorer_folder','logic_gate')
       or (placement.resource_type='company_explorer_folder' and folder.folder_id is null)
       or (placement.resource_type='logic_gate' and process.logic_gate_id is null)
  ) then
    raise exception 'STOP: Process Map geometry compaction found a missing, cross-company, or unsupported source';
  end if;

  if exists (
    select 1
    from process_map_placements child
    left join process_map_placements parent
      on parent.company_id=child.company_id
     and parent.resource_type='company_explorer_folder'
     and parent.resource_id=child.map_parent_folder_id
    where child.map_parent_folder_id is not null
      and parent.resource_id is null
  ) then
    raise exception 'STOP: Process Map geometry compaction found an unmapped or cross-company map parent';
  end if;

  if exists (
    with recursive ancestry(company_id,start_id,parent_id,path,cycle) as (
      select placement.company_id,placement.resource_id,placement.map_parent_folder_id,
             array[placement.resource_id],false
      from process_map_placements placement
      where placement.resource_type='company_explorer_folder'
      union all
      select ancestry.company_id,ancestry.start_id,parent.map_parent_folder_id,
             ancestry.path || ancestry.parent_id,ancestry.parent_id=any(ancestry.path)
      from ancestry
      join process_map_placements parent
        on parent.company_id=ancestry.company_id
       and parent.resource_type='company_explorer_folder'
       and parent.resource_id=ancestry.parent_id
      where ancestry.parent_id is not null
        and not ancestry.cycle
    )
    select 1 from ancestry where cycle
  ) then
    raise exception 'STOP: Process Map geometry compaction found a map-parent cycle';
  end if;

  if exists (
    select 1
    from process_map_placements child
    join process_map_placements parent
      on parent.company_id=child.company_id
     and parent.resource_type='company_explorer_folder'
     and parent.resource_id=child.map_parent_folder_id
    where child.grid_x < parent.grid_x
       or child.grid_y < parent.grid_y
       or child.grid_x::bigint+child.grid_width > parent.grid_x::bigint+parent.grid_width
       or child.grid_y::bigint+child.grid_height > parent.grid_y::bigint+parent.grid_height
  ) then
    raise exception 'STOP: Process Map geometry compaction found invalid Folder containment';
  end if;

  if exists (
    select 1
    from process_map_traces trace
    left join resource_operational_relationships relationship
      on relationship.company_id=trace.company_id
     and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
    left join process_map_placements source_placement
      on source_placement.company_id=relationship.company_id
     and source_placement.resource_type=relationship.source_resource_type
     and source_placement.resource_id=relationship.source_resource_id
    left join process_map_placements target_placement
      on target_placement.company_id=relationship.company_id
     and target_placement.resource_type=relationship.target_resource_type
     and target_placement.resource_id=relationship.target_resource_id
    where relationship.resource_operational_relationship_id is null
       or source_placement.resource_id is null
       or target_placement.resource_id is null
       or not mangorts_process_map_route_points_valid(trace.route_points)
  ) then
    raise exception 'STOP: Process Map geometry compaction found an invalid trace or missing mapped endpoint';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from recycle_bin_items item
    cross join lateral jsonb_array_elements(
      coalesce(item.restore_payload->'process_map_placements','[]'::jsonb)
    ) placement(value)
    where jsonb_typeof(placement.value) is distinct from 'object'
       or jsonb_typeof(placement.value->'company_id') is distinct from 'string'
       or not pg_input_is_valid(placement.value->>'company_id','uuid')
       or jsonb_typeof(placement.value->'resource_type') is distinct from 'string'
       or jsonb_typeof(placement.value->'resource_id') is distinct from 'string'
       or not pg_input_is_valid(placement.value->>'resource_id','uuid')
       or (placement.value->'map_parent_folder_id' <> 'null'::jsonb
         and (jsonb_typeof(placement.value->'map_parent_folder_id') is distinct from 'string'
           or not pg_input_is_valid(placement.value->>'map_parent_folder_id','uuid')))
       or jsonb_typeof(placement.value->'grid_x') is distinct from 'number'
       or not pg_input_is_valid(placement.value->>'grid_x','integer')
       or jsonb_typeof(placement.value->'grid_y') is distinct from 'number'
       or not pg_input_is_valid(placement.value->>'grid_y','integer')
       or jsonb_typeof(placement.value->'grid_width') is distinct from 'number'
       or not pg_input_is_valid(placement.value->>'grid_width','integer')
       or jsonb_typeof(placement.value->'grid_height') is distinct from 'number'
       or not pg_input_is_valid(placement.value->>'grid_height','integer')
       or jsonb_typeof(placement.value->'revision') is distinct from 'number'
       or not pg_input_is_valid(placement.value->>'revision','bigint')
       or jsonb_typeof(placement.value->'created_timestamp') is distinct from 'string'
       or not pg_input_is_valid(placement.value->>'created_timestamp','timestamp with time zone')
       or jsonb_typeof(placement.value->'updated_timestamp') is distinct from 'string'
       or not pg_input_is_valid(placement.value->>'updated_timestamp','timestamp with time zone')
  ) then
    raise exception 'STOP: Process Map geometry compaction found a malformed recycled placement';
  end if;

  if exists (
    select 1
    from recycle_bin_items item
    cross join lateral jsonb_array_elements(
      coalesce(item.restore_payload->'process_map_traces','[]'::jsonb)
    ) trace(value)
    where jsonb_typeof(trace.value) is distinct from 'object'
       or jsonb_typeof(trace.value->'company_id') is distinct from 'string'
       or not pg_input_is_valid(trace.value->>'company_id','uuid')
       or jsonb_typeof(trace.value->'resource_operational_relationship_id') is distinct from 'string'
       or not pg_input_is_valid(trace.value->>'resource_operational_relationship_id','uuid')
       or not mangorts_process_map_route_points_valid(trace.value->'route_points')
       or jsonb_typeof(trace.value->'revision') is distinct from 'number'
       or not pg_input_is_valid(trace.value->>'revision','bigint')
       or jsonb_typeof(trace.value->'created_timestamp') is distinct from 'string'
       or not pg_input_is_valid(trace.value->>'created_timestamp','timestamp with time zone')
       or jsonb_typeof(trace.value->'updated_timestamp') is distinct from 'string'
       or not pg_input_is_valid(trace.value->>'updated_timestamp','timestamp with time zone')
  ) then
    raise exception 'STOP: Process Map geometry compaction found a malformed recycled trace';
  end if;

  if exists (
    select 1
    from recycle_bin_items item
    cross join lateral jsonb_array_elements(
      coalesce(item.restore_payload->'process_map_cleanup_child_reparents','[]'::jsonb)
    ) cleanup(value)
    where jsonb_typeof(cleanup.value) is distinct from 'object'
       or jsonb_typeof(cleanup.value->'company_id') is distinct from 'string'
       or not pg_input_is_valid(cleanup.value->>'company_id','uuid')
       or jsonb_typeof(cleanup.value->'resource_type') is distinct from 'string'
       or jsonb_typeof(cleanup.value->'resource_id') is distinct from 'string'
       or not pg_input_is_valid(cleanup.value->>'resource_id','uuid')
       or jsonb_typeof(cleanup.value->'placement_incarnation_token') is distinct from 'string'
       or not pg_input_is_valid(cleanup.value->>'placement_incarnation_token','uuid')
       or jsonb_typeof(cleanup.value->'original_parent_folder_id') is distinct from 'string'
       or not pg_input_is_valid(cleanup.value->>'original_parent_folder_id','uuid')
       or (cleanup.value->'cleanup_parent_folder_id' <> 'null'::jsonb
         and (jsonb_typeof(cleanup.value->'cleanup_parent_folder_id') is distinct from 'string'
           or not pg_input_is_valid(cleanup.value->>'cleanup_parent_folder_id','uuid')))
       or jsonb_typeof(cleanup.value->'cleanup_revision') is distinct from 'number'
       or not pg_input_is_valid(cleanup.value->>'cleanup_revision','bigint')
       or jsonb_typeof(cleanup.value->'created_timestamp') is distinct from 'string'
       or not pg_input_is_valid(cleanup.value->>'created_timestamp','timestamp with time zone')
       or jsonb_typeof(cleanup.value->'grid_x') is distinct from 'number'
       or not pg_input_is_valid(cleanup.value->>'grid_x','integer')
       or jsonb_typeof(cleanup.value->'grid_y') is distinct from 'number'
       or not pg_input_is_valid(cleanup.value->>'grid_y','integer')
       or jsonb_typeof(cleanup.value->'grid_width') is distinct from 'number'
       or not pg_input_is_valid(cleanup.value->>'grid_width','integer')
       or jsonb_typeof(cleanup.value->'grid_height') is distinct from 'number'
       or not pg_input_is_valid(cleanup.value->>'grid_height','integer')
  ) then
    raise exception 'STOP: Process Map geometry compaction found a malformed cleanup claim';
  end if;
end $$;

create temporary table process_map_compaction_recycle_placements (
  recycle_bin_item_id uuid not null,
  company_id uuid not null,
  ordinality bigint not null,
  original_row jsonb not null,
  resource_type text not null,
  resource_id uuid not null,
  map_parent_folder_id uuid,
  grid_x bigint not null,
  grid_y bigint not null,
  grid_width bigint not null,
  grid_height bigint not null,
  revision bigint not null,
  primary key(recycle_bin_item_id,ordinality)
) on commit drop;

insert into process_map_compaction_recycle_placements(
  recycle_bin_item_id,company_id,ordinality,original_row,
  resource_type,resource_id,map_parent_folder_id,
  grid_x,grid_y,grid_width,grid_height,revision
)
select item.recycle_bin_item_id,(placement.value->>'company_id')::uuid,
       placement.ordinality,placement.value,
       placement.value->>'resource_type',(placement.value->>'resource_id')::uuid,
       nullif(placement.value->>'map_parent_folder_id','')::uuid,
       (placement.value->>'grid_x')::bigint,(placement.value->>'grid_y')::bigint,
       (placement.value->>'grid_width')::bigint,(placement.value->>'grid_height')::bigint,
       (placement.value->>'revision')::bigint
from recycle_bin_items item
cross join lateral jsonb_array_elements(
  coalesce(item.restore_payload->'process_map_placements','[]'::jsonb)
) with ordinality placement(value,ordinality);

create temporary table process_map_compaction_recycle_traces (
  recycle_bin_item_id uuid not null,
  company_id uuid not null,
  ordinality bigint not null,
  original_row jsonb not null,
  resource_operational_relationship_id uuid not null,
  route_points jsonb not null,
  revision bigint not null,
  primary key(recycle_bin_item_id,ordinality)
) on commit drop;

insert into process_map_compaction_recycle_traces(
  recycle_bin_item_id,company_id,ordinality,original_row,
  resource_operational_relationship_id,route_points,revision
)
select item.recycle_bin_item_id,(trace.value->>'company_id')::uuid,
       trace.ordinality,trace.value,
       (trace.value->>'resource_operational_relationship_id')::uuid,
       trace.value->'route_points',(trace.value->>'revision')::bigint
from recycle_bin_items item
cross join lateral jsonb_array_elements(
  coalesce(item.restore_payload->'process_map_traces','[]'::jsonb)
) with ordinality trace(value,ordinality);

create temporary table process_map_compaction_cleanup_claims (
  recycle_bin_item_id uuid not null,
  company_id uuid not null,
  ordinality bigint not null,
  original_row jsonb not null,
  resource_type text not null,
  resource_id uuid not null,
  placement_incarnation_token uuid not null,
  original_parent_folder_id uuid not null,
  cleanup_parent_folder_id uuid,
  cleanup_revision bigint not null,
  created_timestamp timestamptz not null,
  grid_x bigint not null,
  grid_y bigint not null,
  grid_width bigint not null,
  grid_height bigint not null,
  primary key(recycle_bin_item_id,ordinality)
) on commit drop;

insert into process_map_compaction_cleanup_claims(
  recycle_bin_item_id,company_id,ordinality,original_row,
  resource_type,resource_id,placement_incarnation_token,
  original_parent_folder_id,cleanup_parent_folder_id,cleanup_revision,
  created_timestamp,grid_x,grid_y,grid_width,grid_height
)
select item.recycle_bin_item_id,(cleanup.value->>'company_id')::uuid,
       cleanup.ordinality,cleanup.value,
       cleanup.value->>'resource_type',(cleanup.value->>'resource_id')::uuid,
       (cleanup.value->>'placement_incarnation_token')::uuid,
       (cleanup.value->>'original_parent_folder_id')::uuid,
       nullif(cleanup.value->>'cleanup_parent_folder_id','')::uuid,
       (cleanup.value->>'cleanup_revision')::bigint,
       (cleanup.value->>'created_timestamp')::timestamptz,
       (cleanup.value->>'grid_x')::bigint,(cleanup.value->>'grid_y')::bigint,
       (cleanup.value->>'grid_width')::bigint,(cleanup.value->>'grid_height')::bigint
from recycle_bin_items item
cross join lateral jsonb_array_elements(
  coalesce(item.restore_payload->'process_map_cleanup_child_reparents','[]'::jsonb)
) with ordinality cleanup(value,ordinality);

do $$
begin
  if exists (
    select 1
    from process_map_compaction_recycle_placements placement
    join recycle_bin_items item using(recycle_bin_item_id)
    where placement.company_id<>item.company_id
       or placement.resource_type not in ('company_explorer_folder','logic_gate')
       or placement.revision<=0
       or placement.revision=9223372036854775807
       or placement.grid_x < -1000000000
       or placement.grid_y < -1000000000
       or placement.grid_width<=0 or placement.grid_width>1000000
       or placement.grid_height<=0 or placement.grid_height>1000000
       or placement.grid_x+placement.grid_width>1000000000
       or placement.grid_y+placement.grid_height>1000000000
       or (placement.resource_type='company_explorer_folder'
         and placement.map_parent_folder_id=placement.resource_id)
  ) then
    raise exception 'STOP: Process Map geometry compaction found an invalid or cross-company recycled placement';
  end if;

  if exists (
    select 1
    from process_map_compaction_recycle_placements
    group by recycle_bin_item_id,resource_type,resource_id
    having count(*)>1
  ) then
    raise exception 'STOP: Process Map geometry compaction found a duplicate recycled placement';
  end if;

  if exists (
    select 1
    from process_map_compaction_recycle_traces trace
    join recycle_bin_items item using(recycle_bin_item_id)
    where trace.company_id<>item.company_id
       or trace.revision<=0
       or trace.revision=9223372036854775807
       or not mangorts_process_map_route_points_valid(trace.route_points)
  ) then
    raise exception 'STOP: Process Map geometry compaction found an invalid or cross-company recycled trace';
  end if;

  if exists (
    select 1
    from process_map_compaction_recycle_traces
    group by recycle_bin_item_id,resource_operational_relationship_id
    having count(*)>1
  ) then
    raise exception 'STOP: Process Map geometry compaction found a duplicate recycled trace';
  end if;

  if exists (
    select 1
    from process_map_compaction_cleanup_claims cleanup
    join recycle_bin_items item using(recycle_bin_item_id)
    where cleanup.company_id<>item.company_id
       or cleanup.resource_type not in ('company_explorer_folder','logic_gate')
       or cleanup.cleanup_revision<=0
       or cleanup.cleanup_revision=9223372036854775807
       or cleanup.grid_x < -1000000000
       or cleanup.grid_y < -1000000000
       or cleanup.grid_width<=0 or cleanup.grid_width>1000000
       or cleanup.grid_height<=0 or cleanup.grid_height>1000000
       or cleanup.grid_x+cleanup.grid_width>1000000000
       or cleanup.grid_y+cleanup.grid_height>1000000000
  ) then
    raise exception 'STOP: Process Map geometry compaction found an invalid or cross-company cleanup claim';
  end if;

  if exists (
    select 1
    from process_map_compaction_cleanup_claims
    group by recycle_bin_item_id,resource_type,resource_id
    having count(*)>1
  ) then
    raise exception 'STOP: Process Map geometry compaction found a duplicate cleanup claim';
  end if;

  if exists (
    select 1
    from process_map_compaction_cleanup_claims cleanup
    join process_map_placements placement
      on placement.company_id=cleanup.company_id
     and placement.resource_type=cleanup.resource_type
     and placement.resource_id=cleanup.resource_id
     and placement.placement_incarnation_token=cleanup.placement_incarnation_token
     and placement.created_timestamp=cleanup.created_timestamp
    where cleanup.cleanup_revision>placement.revision
       or (cleanup.cleanup_revision=placement.revision and not (
         placement.map_parent_folder_id is not distinct from cleanup.cleanup_parent_folder_id
         and placement.grid_x=cleanup.grid_x
         and placement.grid_y=cleanup.grid_y
         and placement.grid_width=cleanup.grid_width
         and placement.grid_height=cleanup.grid_height
       ))
  ) then
    raise exception 'STOP: Process Map geometry compaction found an impossible cleanup revision fence';
  end if;

  if exists (
    select 1 from process_map_placements where revision=9223372036854775807
    union all
    select 1 from process_map_traces where revision=9223372036854775807
  ) then
    raise exception 'STOP: Process Map geometry compaction cannot advance a maximum revision';
  end if;
end $$;

create temporary table process_map_compaction_coordinates (
  company_id uuid not null,
  axis text not null check(axis in ('x','y')),
  old_coordinate bigint not null,
  primary key(company_id,axis,old_coordinate)
) on commit drop;

insert into process_map_compaction_coordinates(company_id,axis,old_coordinate)
select placement.company_id,coordinate.axis,coordinate.value
from process_map_placements placement
cross join lateral (values
  ('x',placement.grid_x::bigint),
  ('x',placement.grid_x::bigint+placement.grid_width),
  ('y',placement.grid_y::bigint),
  ('y',placement.grid_y::bigint+placement.grid_height)
) coordinate(axis,value)
on conflict do nothing;

insert into process_map_compaction_coordinates(company_id,axis,old_coordinate)
select trace.company_id,coordinate.axis,coordinate.value
from process_map_traces trace
cross join lateral jsonb_array_elements(trace.route_points) point
cross join lateral (values
  ('x',(point->>'x')::bigint),
  ('y',(point->>'y')::bigint)
) coordinate(axis,value)
on conflict do nothing;

insert into process_map_compaction_coordinates(company_id,axis,old_coordinate)
select placement.company_id,coordinate.axis,coordinate.value
from process_map_compaction_recycle_placements placement
cross join lateral (values
  ('x',placement.grid_x),
  ('x',placement.grid_x+placement.grid_width),
  ('y',placement.grid_y),
  ('y',placement.grid_y+placement.grid_height)
) coordinate(axis,value)
on conflict do nothing;

insert into process_map_compaction_coordinates(company_id,axis,old_coordinate)
select trace.company_id,coordinate.axis,coordinate.value
from process_map_compaction_recycle_traces trace
cross join lateral jsonb_array_elements(trace.route_points) point
cross join lateral (values
  ('x',(point->>'x')::bigint),
  ('y',(point->>'y')::bigint)
) coordinate(axis,value)
on conflict do nothing;

insert into process_map_compaction_coordinates(company_id,axis,old_coordinate)
select cleanup.company_id,coordinate.axis,coordinate.value
from process_map_compaction_cleanup_claims cleanup
cross join lateral (values
  ('x',cleanup.grid_x),
  ('x',cleanup.grid_x+cleanup.grid_width),
  ('y',cleanup.grid_y),
  ('y',cleanup.grid_y+cleanup.grid_height)
) coordinate(axis,value)
on conflict do nothing;

create temporary table process_map_compaction_coordinate_map (
  company_id uuid not null,
  axis text not null check(axis in ('x','y')),
  old_coordinate bigint not null,
  new_coordinate bigint not null,
  primary key(company_id,axis,old_coordinate)
) on commit drop;

insert into process_map_compaction_coordinate_map(company_id,axis,old_coordinate,new_coordinate)
with lagged as (
  select coordinate.*,
         lag(old_coordinate) over(
           partition by company_id,axis order by old_coordinate
         ) previous_coordinate
  from process_map_compaction_coordinates coordinate
), mapped as (
  select lagged.*,
         sum(case
           when previous_coordinate is null then 0::bigint
           else least(old_coordinate-previous_coordinate,12::bigint)
         end) over(
           partition by company_id,axis
           order by old_coordinate
           rows between unbounded preceding and current row
         ) mapped_coordinate
  from lagged
)
select company_id,axis,old_coordinate,mapped_coordinate::bigint
from mapped;

do $$
begin
  if exists (
    select 1
    from process_map_compaction_coordinate_map
    where new_coordinate<0 or new_coordinate>1000000000
  ) then
    raise exception 'STOP: Process Map geometry compaction would exceed canonical coordinate bounds';
  end if;
end $$;

create temporary table process_map_compaction_live_placement_plan (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  old_x integer not null,
  old_y integer not null,
  old_width integer not null,
  old_height integer not null,
  new_x integer not null,
  new_y integer not null,
  new_width integer not null,
  new_height integer not null,
  changed boolean not null,
  primary key(company_id,resource_type,resource_id)
) on commit drop;

insert into process_map_compaction_live_placement_plan
select placement.company_id,placement.resource_type,placement.resource_id,
       placement.grid_x,placement.grid_y,placement.grid_width,placement.grid_height,
       left_x.new_coordinate::integer,top_y.new_coordinate::integer,
       (right_x.new_coordinate-left_x.new_coordinate)::integer,
       (bottom_y.new_coordinate-top_y.new_coordinate)::integer,
       row(left_x.new_coordinate,top_y.new_coordinate,
           right_x.new_coordinate-left_x.new_coordinate,
           bottom_y.new_coordinate-top_y.new_coordinate)
         is distinct from
       row(placement.grid_x::bigint,placement.grid_y::bigint,
           placement.grid_width::bigint,placement.grid_height::bigint)
from process_map_placements placement
join process_map_compaction_coordinate_map left_x
  on left_x.company_id=placement.company_id and left_x.axis='x'
 and left_x.old_coordinate=placement.grid_x
join process_map_compaction_coordinate_map right_x
  on right_x.company_id=placement.company_id and right_x.axis='x'
 and right_x.old_coordinate=placement.grid_x::bigint+placement.grid_width
join process_map_compaction_coordinate_map top_y
  on top_y.company_id=placement.company_id and top_y.axis='y'
 and top_y.old_coordinate=placement.grid_y
join process_map_compaction_coordinate_map bottom_y
  on bottom_y.company_id=placement.company_id and bottom_y.axis='y'
 and bottom_y.old_coordinate=placement.grid_y::bigint+placement.grid_height;

do $$
begin
  if exists (
    select 1
    from process_map_compaction_live_placement_plan plan
    where plan.new_x < -1000000000 or plan.new_y < -1000000000
       or plan.new_width<=0 or plan.new_width>1000000
       or plan.new_height<=0 or plan.new_height>1000000
       or plan.new_x::bigint+plan.new_width>1000000000
       or plan.new_y::bigint+plan.new_height>1000000000
  ) then
    raise exception 'STOP: Process Map geometry compaction would create invalid placement geometry';
  end if;

  if exists (
    select 1
    from process_map_placements child
    join process_map_compaction_live_placement_plan child_plan
      on child_plan.company_id=child.company_id
     and child_plan.resource_type=child.resource_type
     and child_plan.resource_id=child.resource_id
    join process_map_compaction_live_placement_plan parent_plan
      on parent_plan.company_id=child.company_id
     and parent_plan.resource_type='company_explorer_folder'
     and parent_plan.resource_id=child.map_parent_folder_id
    where child_plan.new_x<parent_plan.new_x
       or child_plan.new_y<parent_plan.new_y
       or child_plan.new_x::bigint+child_plan.new_width
          > parent_plan.new_x::bigint+parent_plan.new_width
       or child_plan.new_y::bigint+child_plan.new_height
          > parent_plan.new_y::bigint+parent_plan.new_height
  ) then
    raise exception 'STOP: Process Map geometry compaction would break Folder containment';
  end if;
end $$;

create temporary table process_map_compaction_live_trace_plan (
  company_id uuid not null,
  resource_operational_relationship_id uuid not null,
  new_route_points jsonb not null,
  changed boolean not null,
  primary key(company_id,resource_operational_relationship_id)
) on commit drop;

insert into process_map_compaction_live_trace_plan
select trace.company_id,trace.resource_operational_relationship_id,
       mapped.route_points,
       mapped.route_points is distinct from trace.route_points
from process_map_traces trace
cross join lateral (
  select coalesce(
    jsonb_agg(
      jsonb_build_object('x',x_map.new_coordinate,'y',y_map.new_coordinate)
      order by point.ordinality
    ),
    '[]'::jsonb
  ) route_points
  from jsonb_array_elements(trace.route_points) with ordinality point(value,ordinality)
  join process_map_compaction_coordinate_map x_map
    on x_map.company_id=trace.company_id and x_map.axis='x'
   and x_map.old_coordinate=(point.value->>'x')::bigint
  join process_map_compaction_coordinate_map y_map
    on y_map.company_id=trace.company_id and y_map.axis='y'
   and y_map.old_coordinate=(point.value->>'y')::bigint
) mapped;

create temporary table process_map_compaction_recycle_placement_plan (
  recycle_bin_item_id uuid not null,
  ordinality bigint not null,
  company_id uuid not null,
  original_row jsonb not null,
  new_x bigint not null,
  new_y bigint not null,
  new_width bigint not null,
  new_height bigint not null,
  changed boolean not null,
  primary key(recycle_bin_item_id,ordinality)
) on commit drop;

insert into process_map_compaction_recycle_placement_plan
select placement.recycle_bin_item_id,placement.ordinality,placement.company_id,
       placement.original_row,
       left_x.new_coordinate,top_y.new_coordinate,
       right_x.new_coordinate-left_x.new_coordinate,
       bottom_y.new_coordinate-top_y.new_coordinate,
       row(left_x.new_coordinate,top_y.new_coordinate,
           right_x.new_coordinate-left_x.new_coordinate,
           bottom_y.new_coordinate-top_y.new_coordinate)
         is distinct from
       row(placement.grid_x,placement.grid_y,placement.grid_width,placement.grid_height)
from process_map_compaction_recycle_placements placement
join process_map_compaction_coordinate_map left_x
  on left_x.company_id=placement.company_id and left_x.axis='x'
 and left_x.old_coordinate=placement.grid_x
join process_map_compaction_coordinate_map right_x
  on right_x.company_id=placement.company_id and right_x.axis='x'
 and right_x.old_coordinate=placement.grid_x+placement.grid_width
join process_map_compaction_coordinate_map top_y
  on top_y.company_id=placement.company_id and top_y.axis='y'
 and top_y.old_coordinate=placement.grid_y
join process_map_compaction_coordinate_map bottom_y
  on bottom_y.company_id=placement.company_id and bottom_y.axis='y'
 and bottom_y.old_coordinate=placement.grid_y+placement.grid_height;

create temporary table process_map_compaction_recycle_trace_plan (
  recycle_bin_item_id uuid not null,
  ordinality bigint not null,
  company_id uuid not null,
  original_row jsonb not null,
  new_route_points jsonb not null,
  changed boolean not null,
  primary key(recycle_bin_item_id,ordinality)
) on commit drop;

insert into process_map_compaction_recycle_trace_plan
select trace.recycle_bin_item_id,trace.ordinality,trace.company_id,trace.original_row,
       mapped.route_points,
       mapped.route_points is distinct from trace.route_points
from process_map_compaction_recycle_traces trace
cross join lateral (
  select coalesce(
    jsonb_agg(
      jsonb_build_object('x',x_map.new_coordinate,'y',y_map.new_coordinate)
      order by point.ordinality
    ),
    '[]'::jsonb
  ) route_points
  from jsonb_array_elements(trace.route_points) with ordinality point(value,ordinality)
  join process_map_compaction_coordinate_map x_map
    on x_map.company_id=trace.company_id and x_map.axis='x'
   and x_map.old_coordinate=(point.value->>'x')::bigint
  join process_map_compaction_coordinate_map y_map
    on y_map.company_id=trace.company_id and y_map.axis='y'
   and y_map.old_coordinate=(point.value->>'y')::bigint
) mapped;

create temporary table process_map_compaction_cleanup_plan (
  recycle_bin_item_id uuid not null,
  ordinality bigint not null,
  company_id uuid not null,
  original_row jsonb not null,
  new_x bigint not null,
  new_y bigint not null,
  new_width bigint not null,
  new_height bigint not null,
  matches_live_cleanup_state boolean not null,
  changed boolean not null,
  primary key(recycle_bin_item_id,ordinality)
) on commit drop;

insert into process_map_compaction_cleanup_plan
select cleanup.recycle_bin_item_id,cleanup.ordinality,cleanup.company_id,
       cleanup.original_row,
       left_x.new_coordinate,top_y.new_coordinate,
       right_x.new_coordinate-left_x.new_coordinate,
       bottom_y.new_coordinate-top_y.new_coordinate,
       placement.resource_id is not null
         and placement.map_parent_folder_id is not distinct from cleanup.cleanup_parent_folder_id
         and placement.revision=cleanup.cleanup_revision
         and placement.grid_x=cleanup.grid_x
         and placement.grid_y=cleanup.grid_y
         and placement.grid_width=cleanup.grid_width
         and placement.grid_height=cleanup.grid_height,
       row(left_x.new_coordinate,top_y.new_coordinate,
           right_x.new_coordinate-left_x.new_coordinate,
           bottom_y.new_coordinate-top_y.new_coordinate)
         is distinct from
       row(cleanup.grid_x,cleanup.grid_y,cleanup.grid_width,cleanup.grid_height)
from process_map_compaction_cleanup_claims cleanup
join process_map_compaction_coordinate_map left_x
  on left_x.company_id=cleanup.company_id and left_x.axis='x'
 and left_x.old_coordinate=cleanup.grid_x
join process_map_compaction_coordinate_map right_x
  on right_x.company_id=cleanup.company_id and right_x.axis='x'
 and right_x.old_coordinate=cleanup.grid_x+cleanup.grid_width
join process_map_compaction_coordinate_map top_y
  on top_y.company_id=cleanup.company_id and top_y.axis='y'
 and top_y.old_coordinate=cleanup.grid_y
join process_map_compaction_coordinate_map bottom_y
  on bottom_y.company_id=cleanup.company_id and bottom_y.axis='y'
 and bottom_y.old_coordinate=cleanup.grid_y+cleanup.grid_height
left join process_map_placements placement
  on placement.company_id=cleanup.company_id
 and placement.resource_type=cleanup.resource_type
 and placement.resource_id=cleanup.resource_id
 and placement.placement_incarnation_token=cleanup.placement_incarnation_token
 and placement.created_timestamp=cleanup.created_timestamp;

do $$
begin
  if exists (
    select 1
    from process_map_compaction_recycle_placement_plan
    where new_x < -1000000000 or new_y < -1000000000
       or new_width<=0 or new_width>1000000
       or new_height<=0 or new_height>1000000
       or new_x+new_width>1000000000
       or new_y+new_height>1000000000
  ) or exists (
    select 1
    from process_map_compaction_cleanup_plan
    where new_x < -1000000000 or new_y < -1000000000
       or new_width<=0 or new_width>1000000
       or new_height<=0 or new_height>1000000
       or new_x+new_width>1000000000
       or new_y+new_height>1000000000
  ) then
    raise exception 'STOP: Process Map geometry compaction would create invalid recycled geometry';
  end if;

  if exists (
    select 1 from process_map_compaction_live_trace_plan
    where not mangorts_process_map_route_points_valid(new_route_points)
    union all
    select 1 from process_map_compaction_recycle_trace_plan
    where not mangorts_process_map_route_points_valid(new_route_points)
  ) then
    raise exception 'STOP: Process Map geometry compaction would create invalid trace geometry';
  end if;
end $$;

create temporary table process_map_compaction_affected_companies (
  company_id uuid primary key
) on commit drop;

insert into process_map_compaction_affected_companies(company_id)
select company_id from process_map_compaction_live_placement_plan where changed
union
select company_id from process_map_compaction_live_trace_plan where changed
union
select company_id from process_map_compaction_recycle_placement_plan where changed
union
select company_id from process_map_compaction_recycle_trace_plan where changed
union
select company_id from process_map_compaction_cleanup_plan where changed;

do $$
begin
  if exists (
    select 1
    from workspace_read_versions version
    join process_map_compaction_affected_companies company using(company_id)
    where version.scope='process-map'
      and version.resource_key=''
      and version.version=9223372036854775807
  ) then
    raise exception 'STOP: Process Map geometry compaction cannot advance a maximum read version';
  end if;
end $$;

with rebuilt as (
  select plan.recycle_bin_item_id,
         bool_or(plan.changed) changed,
         jsonb_agg(
           case when plan.changed then
             plan.original_row || jsonb_build_object(
               'grid_x',plan.new_x,
               'grid_y',plan.new_y,
               'grid_width',plan.new_width,
               'grid_height',plan.new_height,
               'revision',(plan.original_row->>'revision')::bigint+1,
               'updated_timestamp',greatest(
                 (plan.original_row->>'updated_timestamp')::timestamptz + interval '1 microsecond',
                 statement_timestamp()
               )
             )
           else plan.original_row end
           order by plan.ordinality
         ) rows
  from process_map_compaction_recycle_placement_plan plan
  group by plan.recycle_bin_item_id
)
update recycle_bin_items item
set restore_payload=jsonb_set(item.restore_payload,'{process_map_placements}',rebuilt.rows,false)
from rebuilt
where item.recycle_bin_item_id=rebuilt.recycle_bin_item_id
  and rebuilt.changed;

with rebuilt as (
  select plan.recycle_bin_item_id,
         bool_or(plan.changed) changed,
         jsonb_agg(
           case when plan.changed then
             plan.original_row || jsonb_build_object(
               'route_points',plan.new_route_points,
               'revision',(plan.original_row->>'revision')::bigint+1,
               'updated_timestamp',greatest(
                 (plan.original_row->>'updated_timestamp')::timestamptz + interval '1 microsecond',
                 statement_timestamp()
               )
             )
           else plan.original_row end
           order by plan.ordinality
         ) rows
  from process_map_compaction_recycle_trace_plan plan
  group by plan.recycle_bin_item_id
)
update recycle_bin_items item
set restore_payload=jsonb_set(item.restore_payload,'{process_map_traces}',rebuilt.rows,false)
from rebuilt
where item.recycle_bin_item_id=rebuilt.recycle_bin_item_id
  and rebuilt.changed;

with rebuilt as (
  select plan.recycle_bin_item_id,
         bool_or(plan.changed) changed,
         jsonb_agg(
           case when plan.changed then
             plan.original_row || jsonb_build_object(
               'grid_x',plan.new_x,
               'grid_y',plan.new_y,
               'grid_width',plan.new_width,
               'grid_height',plan.new_height,
               'cleanup_revision',
                 (plan.original_row->>'cleanup_revision')::bigint
                 + case when plan.matches_live_cleanup_state then 1 else 0 end
             )
           else plan.original_row end
           order by plan.ordinality
         ) rows
  from process_map_compaction_cleanup_plan plan
  group by plan.recycle_bin_item_id
)
update recycle_bin_items item
set restore_payload=jsonb_set(
  item.restore_payload,'{process_map_cleanup_child_reparents}',rebuilt.rows,false
)
from rebuilt
where item.recycle_bin_item_id=rebuilt.recycle_bin_item_id
  and rebuilt.changed;

update process_map_placements placement
set grid_x=plan.new_x,
    grid_y=plan.new_y,
    grid_width=plan.new_width,
    grid_height=plan.new_height,
    revision=placement.revision+1,
    updated_timestamp=greatest(
      placement.updated_timestamp + interval '1 microsecond',statement_timestamp()
    )
from process_map_compaction_live_placement_plan plan
where placement.company_id=plan.company_id
  and placement.resource_type=plan.resource_type
  and placement.resource_id=plan.resource_id
  and plan.changed;

update process_map_traces trace
set route_points=plan.new_route_points,
    revision=trace.revision+1,
    updated_timestamp=greatest(
      trace.updated_timestamp + interval '1 microsecond',statement_timestamp()
    )
from process_map_compaction_live_trace_plan plan
where trace.company_id=plan.company_id
  and trace.resource_operational_relationship_id=plan.resource_operational_relationship_id
  and plan.changed;

insert into workspace_read_versions(company_id,scope,resource_key,version,updated_timestamp)
select company_id,'process-map','',1,statement_timestamp()
from process_map_compaction_affected_companies
on conflict(company_id,scope,resource_key) do update
set version=workspace_read_versions.version+1,
    updated_timestamp=greatest(
      workspace_read_versions.updated_timestamp + interval '1 microsecond',excluded.updated_timestamp
    );

commit;
