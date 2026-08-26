begin;

lock table process_map_placements, process_map_traces, resource_operational_relationships, recycle_bin_items in share row exclusive mode;
lock table company_explorer_folders, logic_gates in share mode;

do $$
declare
  company_row record;
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: V3 Process Map requires PostgreSQL 17 or newer';
  end if;
  if to_regclass('public.process_map_placements') is null
     or to_regclass('public.process_map_traces') is null
     or to_regclass('public.resource_operational_relationships') is null
     or to_regclass('public.recycle_bin_items') is null then
    raise exception 'STOP: V3 Process Map legacy authorities are missing';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='process_map_placements'
      and column_name in ('grid_width','grid_height')
  ) then
    raise exception 'STOP: V3 Process Map global geometry was already applied or partially drifted';
  end if;
  if exists (
    select 1
    from recycle_bin_items item
    where jsonb_typeof(item.restore_payload)<>'object'
       or (item.restore_payload ? 'process_map_placements'
         and jsonb_typeof(item.restore_payload->'process_map_placements')<>'array')
       or (item.restore_payload ? 'process_map_traces'
         and jsonb_typeof(item.restore_payload->'process_map_traces')<>'array')
       or (item.restore_payload ? 'resource_operational_relationships'
         and jsonb_typeof(item.restore_payload->'resource_operational_relationships')<>'array')
       or (item.restore_payload ? 'process_map_cleanup_child_reparents'
         and jsonb_typeof(item.restore_payload->'process_map_cleanup_child_reparents')<>'array')
  ) then
    raise exception 'STOP: V3 Process Map recycle payload has a malformed Process Map collection';
  end if;

  for company_row in select distinct company_id from process_map_placements order by company_id loop
    perform pg_advisory_xact_lock(hashtextextended('process-map-parent:' || company_row.company_id::text, 0));
  end loop;

  if exists (
    select 1
    from process_map_placements placement
    left join company_explorer_folders folder
      on placement.resource_type='company_explorer_folder'
     and folder.company_id=placement.company_id and folder.folder_id=placement.resource_id
    left join logic_gates process
      on placement.resource_type='logic_gate'
     and process.company_id=placement.company_id and process.logic_gate_id=placement.resource_id
    where (placement.resource_type='company_explorer_folder' and folder.folder_id is null)
       or (placement.resource_type='logic_gate' and process.logic_gate_id is null)
       or placement.resource_type not in ('company_explorer_folder','logic_gate')
  ) then
    raise exception 'STOP: V3 Process Map contains a missing, cross-company, communications, or unsupported source';
  end if;

  if exists (
    select 1
    from process_map_placements child
    left join process_map_placements parent
      on parent.company_id=child.company_id
     and parent.resource_type='company_explorer_folder'
     and parent.resource_id=child.map_parent_folder_id
    where child.map_parent_folder_id is not null and parent.resource_id is null
  ) then
    raise exception 'STOP: V3 Process Map contains an unmapped or cross-company map parent';
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
      where ancestry.parent_id is not null and not ancestry.cycle
    )
    select 1 from ancestry where cycle
  ) then
    raise exception 'STOP: V3 Process Map contains a map-parent cycle';
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
       or source_placement.map_parent_folder_id is distinct from target_placement.map_parent_folder_id
       or not mangorts_process_map_route_points_valid(trace.route_points)
  ) then
    raise exception 'STOP: V3 Process Map trace is invalid or its endpoints do not share one legacy layer';
  end if;
end $$;

create temporary table process_map_v3_geometry_plan (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  map_parent_folder_id uuid,
  legacy_x bigint not null,
  legacy_y bigint not null,
  global_x bigint,
  global_y bigint,
  offset_x bigint,
  offset_y bigint,
  grid_width bigint not null default 7,
  grid_height bigint not null default 5,
  primary key(company_id,resource_type,resource_id)
) on commit drop;

insert into process_map_v3_geometry_plan(
  company_id,resource_type,resource_id,map_parent_folder_id,legacy_x,legacy_y
)
select company_id,resource_type,resource_id,map_parent_folder_id,grid_x,grid_y
from process_map_placements;

do $$
declare
  changed_count integer;
  pass_count integer := 0;
  plan_count integer := (select count(*) from process_map_v3_geometry_plan);
begin
  loop
    with child_bounds as (
      select parent.company_id,parent.resource_id,
             min(child.legacy_x) min_x,min(child.legacy_y) min_y,
             max(child.legacy_x+child.grid_width) max_x,
             max(child.legacy_y+child.grid_height) max_y
      from process_map_v3_geometry_plan parent
      join process_map_v3_geometry_plan child
        on child.company_id=parent.company_id
       and child.map_parent_folder_id=parent.resource_id
      where parent.resource_type='company_explorer_folder'
      group by parent.company_id,parent.resource_id
    )
    update process_map_v3_geometry_plan folder
    set grid_width=greatest(7,bounds.max_x-bounds.min_x+2),
        grid_height=greatest(5,bounds.max_y-bounds.min_y+2)
    from child_bounds bounds
    where folder.company_id=bounds.company_id
      and folder.resource_type='company_explorer_folder'
      and folder.resource_id=bounds.resource_id
      and (folder.grid_width is distinct from greatest(7,bounds.max_x-bounds.min_x+2)
        or folder.grid_height is distinct from greatest(5,bounds.max_y-bounds.min_y+2));
    get diagnostics changed_count = row_count;
    pass_count := pass_count + 1;
    exit when changed_count=0;
    if pass_count > plan_count+1 then
      raise exception 'STOP: V3 Process Map Folder dimensions did not converge';
    end if;
  end loop;

  update process_map_v3_geometry_plan
  set global_x=legacy_x,global_y=legacy_y,offset_x=0,offset_y=0
  where map_parent_folder_id is null;

  pass_count := 0;
  loop
    with layer_minimums as (
      select company_id,map_parent_folder_id,min(legacy_x) min_x,min(legacy_y) min_y
      from process_map_v3_geometry_plan
      where map_parent_folder_id is not null
      group by company_id,map_parent_folder_id
    ), ready as (
      select child.company_id,child.resource_type,child.resource_id,
             parent.global_x+1+child.legacy_x-layer_minimums.min_x next_x,
             parent.global_y+1+child.legacy_y-layer_minimums.min_y next_y
      from process_map_v3_geometry_plan child
      join process_map_v3_geometry_plan parent
        on parent.company_id=child.company_id
       and parent.resource_type='company_explorer_folder'
       and parent.resource_id=child.map_parent_folder_id
      join layer_minimums
        on layer_minimums.company_id=child.company_id
       and layer_minimums.map_parent_folder_id=child.map_parent_folder_id
      where child.global_x is null and parent.global_x is not null
    )
    update process_map_v3_geometry_plan child
    set global_x=ready.next_x,global_y=ready.next_y,
        offset_x=ready.next_x-child.legacy_x,offset_y=ready.next_y-child.legacy_y
    from ready
    where child.company_id=ready.company_id
      and child.resource_type=ready.resource_type
      and child.resource_id=ready.resource_id;
    get diagnostics changed_count = row_count;
    pass_count := pass_count + 1;
    exit when changed_count=0;
    if pass_count > plan_count+1 then
      raise exception 'STOP: V3 Process Map global coordinate expansion did not converge';
    end if;
  end loop;

  if exists(select 1 from process_map_v3_geometry_plan where global_x is null or global_y is null) then
    raise exception 'STOP: V3 Process Map contains geometry unreachable from a root';
  end if;
  if exists (
    select 1 from process_map_v3_geometry_plan
    where global_x < -1000000000 or global_y < -1000000000
       or grid_width <= 0 or grid_width > 1000000
       or grid_height <= 0 or grid_height > 1000000
       or global_x+grid_width > 1000000000
       or global_y+grid_height > 1000000000
  ) then
    raise exception 'STOP: V3 Process Map placement geometry would overflow canonical bounds';
  end if;
  if exists (
    select 1
    from process_map_traces trace
    join resource_operational_relationships relationship
      on relationship.company_id=trace.company_id
     and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
    join process_map_v3_geometry_plan source_placement
      on source_placement.company_id=relationship.company_id
     and source_placement.resource_type=relationship.source_resource_type
     and source_placement.resource_id=relationship.source_resource_id
    join process_map_v3_geometry_plan target_placement
      on target_placement.company_id=relationship.company_id
     and target_placement.resource_type=relationship.target_resource_type
     and target_placement.resource_id=relationship.target_resource_id
    cross join lateral jsonb_array_elements(trace.route_points) point
    where source_placement.offset_x is distinct from target_placement.offset_x
       or source_placement.offset_y is distinct from target_placement.offset_y
       or (point->>'x')::numeric+source_placement.offset_x not between -1000000000 and 1000000000
       or (point->>'y')::numeric+source_placement.offset_y not between -1000000000 and 1000000000
  ) then
    raise exception 'STOP: V3 Process Map trace translation would be ambiguous or overflow canonical bounds';
  end if;
end $$;

create temporary table process_map_v3_recycle_items (
  recycle_bin_item_id uuid primary key,
  company_id uuid not null
) on commit drop;

insert into process_map_v3_recycle_items(recycle_bin_item_id,company_id)
select item.recycle_bin_item_id,item.company_id
from recycle_bin_items item
where coalesce(jsonb_array_length(item.restore_payload->'process_map_placements'),0)>0
   or coalesce(jsonb_array_length(item.restore_payload->'process_map_traces'),0)>0
   or coalesce(jsonb_array_length(item.restore_payload->'process_map_cleanup_child_reparents'),0)>0;

create temporary table process_map_v3_recycle_placement_rows (
  recycle_bin_item_id uuid not null,
  company_id uuid not null,
  ordinality bigint not null,
  original_row jsonb not null,
  resource_type text not null,
  resource_id uuid not null,
  map_parent_folder_id uuid,
  legacy_x bigint not null,
  legacy_y bigint not null,
  revision bigint not null,
  primary key(recycle_bin_item_id,resource_type,resource_id)
) on commit drop;

insert into process_map_v3_recycle_placement_rows(
  recycle_bin_item_id,company_id,ordinality,original_row,
  resource_type,resource_id,map_parent_folder_id,legacy_x,legacy_y,revision
)
select item.recycle_bin_item_id,(placement.value->>'company_id')::uuid,placement.ordinality,placement.value,
       placement.value->>'resource_type',(placement.value->>'resource_id')::uuid,
       nullif(placement.value->>'map_parent_folder_id','')::uuid,
       (placement.value->>'grid_x')::bigint,(placement.value->>'grid_y')::bigint,
       (placement.value->>'revision')::bigint
from process_map_v3_recycle_items item
join recycle_bin_items recycled using(recycle_bin_item_id,company_id)
cross join lateral jsonb_array_elements(recycled.restore_payload->'process_map_placements')
  with ordinality placement(value,ordinality);

do $$
begin
  if exists (
    select 1
    from process_map_v3_recycle_placement_rows placement
    join process_map_v3_recycle_items item using(recycle_bin_item_id)
    where placement.company_id<>item.company_id
       or placement.resource_type not in ('company_explorer_folder','logic_gate')
       or placement.revision<=0
       or (placement.resource_type='company_explorer_folder'
         and placement.map_parent_folder_id=placement.resource_id)
  ) then
    raise exception 'STOP: V3 Process Map recycle payload contains an invalid or cross-company placement';
  end if;
end $$;

create temporary table process_map_v3_recycle_geometry_plan (
  recycle_bin_item_id uuid not null,
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  map_parent_folder_id uuid,
  legacy_x bigint not null,
  legacy_y bigint not null,
  global_x bigint,
  global_y bigint,
  offset_x bigint,
  offset_y bigint,
  grid_width bigint not null default 7,
  grid_height bigint not null default 5,
  primary key(recycle_bin_item_id,resource_type,resource_id)
) on commit drop;

insert into process_map_v3_recycle_geometry_plan(
  recycle_bin_item_id,company_id,resource_type,resource_id,map_parent_folder_id,legacy_x,legacy_y
)
select item.recycle_bin_item_id,plan.company_id,plan.resource_type,plan.resource_id,
       plan.map_parent_folder_id,plan.legacy_x,plan.legacy_y
from process_map_v3_recycle_items item
join process_map_v3_geometry_plan plan on plan.company_id=item.company_id;

with stable_payload_context as (
  select company_id,resource_type,resource_id,
         min(map_parent_folder_id::text)::uuid map_parent_folder_id,
         min(legacy_x) legacy_x,min(legacy_y) legacy_y
  from process_map_v3_recycle_placement_rows
  group by company_id,resource_type,resource_id
  having count(distinct jsonb_build_array(map_parent_folder_id,legacy_x,legacy_y))=1
)
insert into process_map_v3_recycle_geometry_plan(
  recycle_bin_item_id,company_id,resource_type,resource_id,map_parent_folder_id,legacy_x,legacy_y
)
select item.recycle_bin_item_id,context.company_id,context.resource_type,context.resource_id,
       context.map_parent_folder_id,context.legacy_x,context.legacy_y
from process_map_v3_recycle_items item
join stable_payload_context context on context.company_id=item.company_id
on conflict do nothing;

insert into process_map_v3_recycle_geometry_plan(
  recycle_bin_item_id,company_id,resource_type,resource_id,map_parent_folder_id,legacy_x,legacy_y
)
select recycle_bin_item_id,company_id,resource_type,resource_id,map_parent_folder_id,legacy_x,legacy_y
from process_map_v3_recycle_placement_rows
on conflict(recycle_bin_item_id,resource_type,resource_id) do update
set company_id=excluded.company_id,
    map_parent_folder_id=excluded.map_parent_folder_id,
    legacy_x=excluded.legacy_x,
    legacy_y=excluded.legacy_y;

do $$
declare
  changed_count integer;
  pass_count integer := 0;
  plan_count integer := (select count(*) from process_map_v3_recycle_geometry_plan);
begin
  if exists (
    select 1
    from process_map_v3_recycle_geometry_plan child
    left join process_map_v3_recycle_geometry_plan parent
      on parent.recycle_bin_item_id=child.recycle_bin_item_id
     and parent.company_id=child.company_id
     and parent.resource_type='company_explorer_folder'
     and parent.resource_id=child.map_parent_folder_id
    where child.map_parent_folder_id is not null and parent.resource_id is null
  ) then
    raise exception 'STOP: V3 Process Map recycle payload contains an unmapped or ambiguous map parent';
  end if;
  if exists (
    with recursive ancestry(recycle_bin_item_id,company_id,start_id,parent_id,path,cycle) as (
      select placement.recycle_bin_item_id,placement.company_id,placement.resource_id,
             placement.map_parent_folder_id,array[placement.resource_id],false
      from process_map_v3_recycle_geometry_plan placement
      where placement.resource_type='company_explorer_folder'
      union all
      select ancestry.recycle_bin_item_id,ancestry.company_id,ancestry.start_id,parent.map_parent_folder_id,
             ancestry.path || ancestry.parent_id,ancestry.parent_id=any(ancestry.path)
      from ancestry
      join process_map_v3_recycle_geometry_plan parent
        on parent.recycle_bin_item_id=ancestry.recycle_bin_item_id
       and parent.company_id=ancestry.company_id
       and parent.resource_type='company_explorer_folder'
       and parent.resource_id=ancestry.parent_id
      where ancestry.parent_id is not null and not ancestry.cycle
    )
    select 1 from ancestry where cycle
  ) then
    raise exception 'STOP: V3 Process Map recycle payload contains a map-parent cycle';
  end if;

  loop
    with child_bounds as (
      select parent.recycle_bin_item_id,parent.company_id,parent.resource_id,
             min(child.legacy_x) min_x,min(child.legacy_y) min_y,
             max(child.legacy_x+child.grid_width) max_x,
             max(child.legacy_y+child.grid_height) max_y
      from process_map_v3_recycle_geometry_plan parent
      join process_map_v3_recycle_geometry_plan child
        on child.recycle_bin_item_id=parent.recycle_bin_item_id
       and child.company_id=parent.company_id
       and child.map_parent_folder_id=parent.resource_id
      where parent.resource_type='company_explorer_folder'
      group by parent.recycle_bin_item_id,parent.company_id,parent.resource_id
    )
    update process_map_v3_recycle_geometry_plan folder
    set grid_width=greatest(7,bounds.max_x-bounds.min_x+2),
        grid_height=greatest(5,bounds.max_y-bounds.min_y+2)
    from child_bounds bounds
    where folder.recycle_bin_item_id=bounds.recycle_bin_item_id
      and folder.company_id=bounds.company_id
      and folder.resource_type='company_explorer_folder'
      and folder.resource_id=bounds.resource_id
      and (folder.grid_width is distinct from greatest(7,bounds.max_x-bounds.min_x+2)
        or folder.grid_height is distinct from greatest(5,bounds.max_y-bounds.min_y+2));
    get diagnostics changed_count = row_count;
    pass_count := pass_count+1;
    exit when changed_count=0;
    if pass_count>plan_count+1 then
      raise exception 'STOP: V3 Process Map recycle Folder dimensions did not converge';
    end if;
  end loop;

  update process_map_v3_recycle_geometry_plan
  set global_x=legacy_x,global_y=legacy_y,offset_x=0,offset_y=0
  where map_parent_folder_id is null;

  pass_count := 0;
  loop
    with layer_minimums as (
      select recycle_bin_item_id,company_id,map_parent_folder_id,
             min(legacy_x) min_x,min(legacy_y) min_y
      from process_map_v3_recycle_geometry_plan
      where map_parent_folder_id is not null
      group by recycle_bin_item_id,company_id,map_parent_folder_id
    ), ready as (
      select child.recycle_bin_item_id,child.company_id,child.resource_type,child.resource_id,
             parent.global_x+1+child.legacy_x-layer_minimums.min_x next_x,
             parent.global_y+1+child.legacy_y-layer_minimums.min_y next_y
      from process_map_v3_recycle_geometry_plan child
      join process_map_v3_recycle_geometry_plan parent
        on parent.recycle_bin_item_id=child.recycle_bin_item_id
       and parent.company_id=child.company_id
       and parent.resource_type='company_explorer_folder'
       and parent.resource_id=child.map_parent_folder_id
      join layer_minimums
        on layer_minimums.recycle_bin_item_id=child.recycle_bin_item_id
       and layer_minimums.company_id=child.company_id
       and layer_minimums.map_parent_folder_id=child.map_parent_folder_id
      where child.global_x is null and parent.global_x is not null
    )
    update process_map_v3_recycle_geometry_plan child
    set global_x=ready.next_x,global_y=ready.next_y,
        offset_x=ready.next_x-child.legacy_x,offset_y=ready.next_y-child.legacy_y
    from ready
    where child.recycle_bin_item_id=ready.recycle_bin_item_id
      and child.company_id=ready.company_id
      and child.resource_type=ready.resource_type
      and child.resource_id=ready.resource_id;
    get diagnostics changed_count = row_count;
    pass_count := pass_count+1;
    exit when changed_count=0;
    if pass_count>plan_count+1 then
      raise exception 'STOP: V3 Process Map recycle global coordinate expansion did not converge';
    end if;
  end loop;

  if exists (
    select 1 from process_map_v3_recycle_geometry_plan
    where global_x is null or global_y is null
  ) then
    raise exception 'STOP: V3 Process Map recycle payload contains geometry unreachable from a root';
  end if;
  if exists (
    select 1 from process_map_v3_recycle_geometry_plan
    where global_x < -1000000000 or global_y < -1000000000
       or grid_width<=0 or grid_width>1000000
       or grid_height<=0 or grid_height>1000000
       or global_x+grid_width>1000000000
       or global_y+grid_height>1000000000
  ) then
    raise exception 'STOP: V3 Process Map recycle placement geometry would overflow canonical bounds';
  end if;
end $$;

create temporary table process_map_v3_recycle_relationship_rows (
  recycle_bin_item_id uuid not null,
  company_id uuid not null,
  resource_operational_relationship_id uuid not null,
  source_resource_type text not null,
  source_resource_id uuid not null,
  target_resource_type text not null,
  target_resource_id uuid not null,
  primary key(recycle_bin_item_id,resource_operational_relationship_id)
) on commit drop;

insert into process_map_v3_recycle_relationship_rows(
  recycle_bin_item_id,company_id,resource_operational_relationship_id,
  source_resource_type,source_resource_id,target_resource_type,target_resource_id
)
select item.recycle_bin_item_id,(relationship.value->>'company_id')::uuid,
       (relationship.value->>'resource_operational_relationship_id')::uuid,
       relationship.value->>'source_resource_type',(relationship.value->>'source_resource_id')::uuid,
       relationship.value->>'target_resource_type',(relationship.value->>'target_resource_id')::uuid
from process_map_v3_recycle_items item
join recycle_bin_items recycled using(recycle_bin_item_id,company_id)
cross join lateral jsonb_array_elements(recycled.restore_payload->'resource_operational_relationships')
  relationship(value);

create temporary table process_map_v3_recycle_relationship_plan (
  recycle_bin_item_id uuid not null,
  company_id uuid not null,
  resource_operational_relationship_id uuid not null,
  source_resource_type text not null,
  source_resource_id uuid not null,
  target_resource_type text not null,
  target_resource_id uuid not null,
  primary key(recycle_bin_item_id,resource_operational_relationship_id)
) on commit drop;

insert into process_map_v3_recycle_relationship_plan
select item.recycle_bin_item_id,relationship.company_id,
       relationship.resource_operational_relationship_id,
       relationship.source_resource_type,relationship.source_resource_id,
       relationship.target_resource_type,relationship.target_resource_id
from process_map_v3_recycle_items item
join resource_operational_relationships relationship on relationship.company_id=item.company_id;

with stable_payload_context as (
  select company_id,resource_operational_relationship_id,
         min(source_resource_type) source_resource_type,
         min(source_resource_id::text)::uuid source_resource_id,
         min(target_resource_type) target_resource_type,
         min(target_resource_id::text)::uuid target_resource_id
  from process_map_v3_recycle_relationship_rows
  group by company_id,resource_operational_relationship_id
  having count(distinct jsonb_build_array(
    source_resource_type,source_resource_id,target_resource_type,target_resource_id
  ))=1
)
insert into process_map_v3_recycle_relationship_plan
select item.recycle_bin_item_id,context.company_id,context.resource_operational_relationship_id,
       context.source_resource_type,context.source_resource_id,
       context.target_resource_type,context.target_resource_id
from process_map_v3_recycle_items item
join stable_payload_context context on context.company_id=item.company_id
on conflict do nothing;

insert into process_map_v3_recycle_relationship_plan
select recycle_bin_item_id,company_id,resource_operational_relationship_id,
       source_resource_type,source_resource_id,target_resource_type,target_resource_id
from process_map_v3_recycle_relationship_rows
on conflict(recycle_bin_item_id,resource_operational_relationship_id) do update
set company_id=excluded.company_id,
    source_resource_type=excluded.source_resource_type,
    source_resource_id=excluded.source_resource_id,
    target_resource_type=excluded.target_resource_type,
    target_resource_id=excluded.target_resource_id;

create temporary table process_map_v3_recycle_trace_rows (
  recycle_bin_item_id uuid not null,
  company_id uuid not null,
  ordinality bigint not null,
  original_row jsonb not null,
  resource_operational_relationship_id uuid not null,
  route_points jsonb not null,
  revision bigint not null,
  primary key(recycle_bin_item_id,resource_operational_relationship_id)
) on commit drop;

insert into process_map_v3_recycle_trace_rows(
  recycle_bin_item_id,company_id,ordinality,original_row,
  resource_operational_relationship_id,route_points,revision
)
select item.recycle_bin_item_id,(trace.value->>'company_id')::uuid,trace.ordinality,trace.value,
       (trace.value->>'resource_operational_relationship_id')::uuid,
       trace.value->'route_points',(trace.value->>'revision')::bigint
from process_map_v3_recycle_items item
join recycle_bin_items recycled using(recycle_bin_item_id,company_id)
cross join lateral jsonb_array_elements(recycled.restore_payload->'process_map_traces')
  with ordinality trace(value,ordinality);

do $$
begin
  if exists (
    select 1
    from process_map_v3_recycle_relationship_rows relationship
    join process_map_v3_recycle_items item using(recycle_bin_item_id)
    where relationship.company_id<>item.company_id
       or relationship.source_resource_type not in ('company_explorer_folder','logic_gate')
       or relationship.target_resource_type not in ('company_explorer_folder','logic_gate')
       or (relationship.source_resource_type=relationship.target_resource_type
         and relationship.source_resource_id=relationship.target_resource_id)
  ) then
    raise exception 'STOP: V3 Process Map recycle payload contains an invalid or cross-company relationship';
  end if;
  if exists (
    select 1
    from process_map_v3_recycle_trace_rows trace
    join process_map_v3_recycle_items item using(recycle_bin_item_id)
    left join process_map_v3_recycle_relationship_plan relationship
      on relationship.recycle_bin_item_id=trace.recycle_bin_item_id
     and relationship.company_id=trace.company_id
     and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
    left join process_map_v3_recycle_geometry_plan source_placement
      on source_placement.recycle_bin_item_id=trace.recycle_bin_item_id
     and source_placement.company_id=relationship.company_id
     and source_placement.resource_type=relationship.source_resource_type
     and source_placement.resource_id=relationship.source_resource_id
    left join process_map_v3_recycle_geometry_plan target_placement
      on target_placement.recycle_bin_item_id=trace.recycle_bin_item_id
     and target_placement.company_id=relationship.company_id
     and target_placement.resource_type=relationship.target_resource_type
     and target_placement.resource_id=relationship.target_resource_id
    where trace.company_id<>item.company_id
       or trace.revision<=0
       or relationship.resource_operational_relationship_id is null
       or source_placement.resource_id is null
       or target_placement.resource_id is null
       or source_placement.map_parent_folder_id is distinct from target_placement.map_parent_folder_id
       or source_placement.offset_x is distinct from target_placement.offset_x
       or source_placement.offset_y is distinct from target_placement.offset_y
       or not mangorts_process_map_route_points_valid(trace.route_points)
  ) then
    raise exception 'STOP: V3 Process Map recycle trace is invalid, ambiguous, or missing an endpoint';
  end if;
  if exists (
    select 1
    from process_map_v3_recycle_trace_rows trace
    join process_map_v3_recycle_relationship_plan relationship
      on relationship.recycle_bin_item_id=trace.recycle_bin_item_id
     and relationship.company_id=trace.company_id
     and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
    join process_map_v3_recycle_geometry_plan source_placement
      on source_placement.recycle_bin_item_id=trace.recycle_bin_item_id
     and source_placement.company_id=relationship.company_id
     and source_placement.resource_type=relationship.source_resource_type
     and source_placement.resource_id=relationship.source_resource_id
    cross join lateral jsonb_array_elements(trace.route_points) point
    where (point->>'x')::numeric+source_placement.offset_x not between -1000000000 and 1000000000
       or (point->>'y')::numeric+source_placement.offset_y not between -1000000000 and 1000000000
  ) then
    raise exception 'STOP: V3 Process Map recycle trace translation would overflow canonical bounds';
  end if;
end $$;

alter table process_map_placements
  add column grid_width integer not null default 7,
  add column grid_height integer not null default 5,
  add column placement_incarnation_token uuid not null default gen_random_uuid(),
  drop constraint process_map_placements_root_folder_chk;

create or replace function mangorts_process_map_route_points_valid(p_route_points jsonb)
returns boolean as $$
declare
  point jsonb;
  point_key_count integer;
  x_text text;
  y_text text;
begin
  if p_route_points is null or jsonb_typeof(p_route_points) <> 'array' then return false; end if;
  if jsonb_array_length(p_route_points) > 256 then return false; end if;
  for point in select value from jsonb_array_elements(p_route_points) loop
    if jsonb_typeof(point) <> 'object' then return false; end if;
    select count(*) into point_key_count from jsonb_object_keys(point);
    if not (point ? 'x' and point ? 'y') or point_key_count <> 2
       or jsonb_typeof(point->'x') <> 'number' or jsonb_typeof(point->'y') <> 'number' then return false; end if;
    x_text := point->>'x'; y_text := point->>'y';
    if x_text !~ '^-?(0|[1-9][0-9]*)$' or y_text !~ '^-?(0|[1-9][0-9]*)$' then return false; end if;
    if x_text::numeric not between -1000000000 and 1000000000
       or y_text::numeric not between -1000000000 and 1000000000 then return false; end if;
  end loop;
  return true;
end;
$$ language plpgsql immutable;

create temporary table process_map_v3_recycle_cleanup_rows (
  recycle_bin_item_id uuid not null,
  company_id uuid not null,
  ordinality bigint not null,
  original_row jsonb not null,
  resource_type text not null,
  resource_id uuid not null,
  original_parent_folder_id uuid not null,
  cleanup_parent_folder_id uuid,
  cleanup_revision bigint not null,
  created_timestamp timestamptz not null,
  legacy_x bigint not null,
  legacy_y bigint not null,
  primary key(recycle_bin_item_id,resource_type,resource_id)
) on commit drop;

insert into process_map_v3_recycle_cleanup_rows(
  recycle_bin_item_id,company_id,ordinality,original_row,resource_type,resource_id,
  original_parent_folder_id,cleanup_parent_folder_id,cleanup_revision,created_timestamp,
  legacy_x,legacy_y
)
select item.recycle_bin_item_id,(cleanup.value->>'company_id')::uuid,cleanup.ordinality,cleanup.value,
       cleanup.value->>'resource_type',(cleanup.value->>'resource_id')::uuid,
       (cleanup.value->>'original_parent_folder_id')::uuid,
       nullif(cleanup.value->>'cleanup_parent_folder_id','')::uuid,
       (cleanup.value->>'cleanup_revision')::bigint,
       (cleanup.value->>'created_timestamp')::timestamptz,
       (cleanup.value->>'grid_x')::bigint,(cleanup.value->>'grid_y')::bigint
from process_map_v3_recycle_items item
join recycle_bin_items recycled using(recycle_bin_item_id,company_id)
cross join lateral jsonb_array_elements(recycled.restore_payload->'process_map_cleanup_child_reparents')
  with ordinality cleanup(value,ordinality);

do $$
begin
  if exists (
    select 1
    from process_map_v3_recycle_cleanup_rows cleanup
    join process_map_v3_recycle_items item using(recycle_bin_item_id)
    where cleanup.company_id<>item.company_id
       or cleanup.resource_type not in ('company_explorer_folder','logic_gate')
       or cleanup.cleanup_revision<=0
  ) then
    raise exception 'STOP: V3 Process Map recycle payload contains an invalid cleanup claim';
  end if;
end $$;

with converted as (
  select cleanup.recycle_bin_item_id,cleanup.ordinality,
         (cleanup.original_row - 'placement_incarnation_token') || jsonb_build_object(
           'cleanup_revision',cleanup.cleanup_revision+1,
           'grid_x',coalesce(live_plan.global_x,recycle_plan.global_x,cleanup.legacy_x),
           'grid_y',coalesce(live_plan.global_y,recycle_plan.global_y,cleanup.legacy_y),
           'grid_width',coalesce(live_plan.grid_width,recycle_plan.grid_width,7),
           'grid_height',coalesce(live_plan.grid_height,recycle_plan.grid_height,5),
           'placement_incarnation_token',coalesce(live_placement.placement_incarnation_token,gen_random_uuid())
         ) converted_row
  from process_map_v3_recycle_cleanup_rows cleanup
  left join process_map_placements live_placement
    on live_placement.company_id=cleanup.company_id
   and live_placement.resource_type=cleanup.resource_type
   and live_placement.resource_id=cleanup.resource_id
   and live_placement.map_parent_folder_id is not distinct from cleanup.cleanup_parent_folder_id
   and live_placement.revision=cleanup.cleanup_revision
   and live_placement.created_timestamp=cleanup.created_timestamp
   and live_placement.grid_x=cleanup.legacy_x
   and live_placement.grid_y=cleanup.legacy_y
  left join process_map_v3_geometry_plan live_plan
    on live_plan.company_id=live_placement.company_id
   and live_plan.resource_type=live_placement.resource_type
   and live_plan.resource_id=live_placement.resource_id
  left join process_map_v3_recycle_geometry_plan recycle_plan
    on recycle_plan.recycle_bin_item_id=cleanup.recycle_bin_item_id
   and recycle_plan.company_id=cleanup.company_id
   and recycle_plan.resource_type=cleanup.resource_type
   and recycle_plan.resource_id=cleanup.resource_id
), rebuilt as (
  select recycle_bin_item_id,
         jsonb_agg(converted_row order by ordinality) cleanup_rows
  from converted
  group by recycle_bin_item_id
)
update recycle_bin_items item
set restore_payload=jsonb_set(
  item.restore_payload,'{process_map_cleanup_child_reparents}',rebuilt.cleanup_rows,false
)
from rebuilt
where item.recycle_bin_item_id=rebuilt.recycle_bin_item_id;

with rebuilt as (
  select placement.recycle_bin_item_id,
         jsonb_agg(
           (placement.original_row - 'placement_incarnation_token') || jsonb_build_object(
             'grid_x',plan.global_x,
             'grid_y',plan.global_y,
             'grid_width',plan.grid_width,
             'grid_height',plan.grid_height,
             'revision',placement.revision+1,
             'updated_timestamp',statement_timestamp()
           ) order by placement.ordinality
         ) placement_rows
  from process_map_v3_recycle_placement_rows placement
  join process_map_v3_recycle_geometry_plan plan
    on plan.recycle_bin_item_id=placement.recycle_bin_item_id
   and plan.company_id=placement.company_id
   and plan.resource_type=placement.resource_type
   and plan.resource_id=placement.resource_id
  group by placement.recycle_bin_item_id
)
update recycle_bin_items item
set restore_payload=jsonb_set(item.restore_payload,'{process_map_placements}',rebuilt.placement_rows,false)
from rebuilt
where item.recycle_bin_item_id=rebuilt.recycle_bin_item_id;

with translated as (
  select trace.recycle_bin_item_id,trace.ordinality,trace.original_row,trace.revision,
         coalesce(
           jsonb_agg(jsonb_build_object(
             'x',(point.value->>'x')::bigint+source_placement.offset_x,
             'y',(point.value->>'y')::bigint+source_placement.offset_y
           ) order by point.ordinality) filter(where point.value is not null),
           '[]'::jsonb
         ) route_points
  from process_map_v3_recycle_trace_rows trace
  join process_map_v3_recycle_relationship_plan relationship
    on relationship.recycle_bin_item_id=trace.recycle_bin_item_id
   and relationship.company_id=trace.company_id
   and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
  join process_map_v3_recycle_geometry_plan source_placement
    on source_placement.recycle_bin_item_id=trace.recycle_bin_item_id
   and source_placement.company_id=relationship.company_id
   and source_placement.resource_type=relationship.source_resource_type
   and source_placement.resource_id=relationship.source_resource_id
  left join lateral jsonb_array_elements(trace.route_points) with ordinality point(value,ordinality) on true
  group by trace.recycle_bin_item_id,trace.ordinality,trace.original_row,trace.revision
), rebuilt as (
  select recycle_bin_item_id,
         jsonb_agg(
           original_row || jsonb_build_object(
             'route_points',route_points,
             'revision',revision+1,
             'updated_timestamp',statement_timestamp()
           ) order by ordinality
         ) trace_rows
  from translated
  group by recycle_bin_item_id
)
update recycle_bin_items item
set restore_payload=jsonb_set(item.restore_payload,'{process_map_traces}',rebuilt.trace_rows,false)
from rebuilt
where item.recycle_bin_item_id=rebuilt.recycle_bin_item_id;

update process_map_placements placement
set grid_x=plan.global_x::integer,grid_y=plan.global_y::integer,
    grid_width=plan.grid_width::integer,grid_height=plan.grid_height::integer,
    revision=placement.revision+1,updated_timestamp=statement_timestamp()
from process_map_v3_geometry_plan plan
where placement.company_id=plan.company_id
  and placement.resource_type=plan.resource_type
  and placement.resource_id=plan.resource_id;

with translated as (
  select trace.company_id,trace.resource_operational_relationship_id,
         coalesce(
           jsonb_agg(jsonb_build_object(
             'x',(point.value->>'x')::bigint+source_placement.offset_x,
             'y',(point.value->>'y')::bigint+source_placement.offset_y
           ) order by point.ordinality) filter (where point.value is not null),
           '[]'::jsonb
         ) route_points
  from process_map_traces trace
  join resource_operational_relationships relationship
    on relationship.company_id=trace.company_id
   and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
  join process_map_v3_geometry_plan source_placement
    on source_placement.company_id=relationship.company_id
   and source_placement.resource_type=relationship.source_resource_type
   and source_placement.resource_id=relationship.source_resource_id
  left join lateral jsonb_array_elements(trace.route_points) with ordinality point(value,ordinality) on true
  group by trace.company_id,trace.resource_operational_relationship_id
)
update process_map_traces trace
set route_points=translated.route_points,revision=trace.revision+1,updated_timestamp=statement_timestamp()
from translated
where trace.company_id=translated.company_id
  and trace.resource_operational_relationship_id=translated.resource_operational_relationship_id;

alter table process_map_placements
  add constraint process_map_placements_geometry_chk check (
    grid_x >= -1000000000 and grid_y >= -1000000000
    and grid_width > 0 and grid_width <= 1000000
    and grid_height > 0 and grid_height <= 1000000
    and grid_x::bigint+grid_width <= 1000000000
    and grid_y::bigint+grid_height <= 1000000000
  ),
  drop constraint process_map_placements_company_id_map_parent_folder_id_fkey,
  add constraint process_map_placements_company_id_map_parent_folder_id_fkey
    foreign key(company_id,map_parent_folder_id)
    references company_explorer_folders(company_id,folder_id);

drop index idx_process_map_placements_layer;
create index idx_process_map_placements_parent
  on process_map_placements(company_id,map_parent_folder_id,resource_type,resource_id);
create index idx_process_map_placements_spatial
  on process_map_placements using gist (
    box(
      point(grid_x::double precision,grid_y::double precision),
      point((grid_x::bigint+grid_width)::double precision,(grid_y::bigint+grid_height)::double precision)
    )
  );

create or replace function trg_validate_process_map_placement()
returns trigger as $$
declare
  cycle_found boolean;
  parent_changed boolean;
begin
  parent_changed := tg_op='INSERT';
  if tg_op='UPDATE' then parent_changed := new.map_parent_folder_id is distinct from old.map_parent_folder_id; end if;
  if parent_changed then
    perform pg_advisory_xact_lock(hashtextextended('process-map-parent:' || new.company_id::text,0));
  end if;
  if new.resource_type='company_explorer_folder' then
    perform 1 from company_explorer_folders folder
    where folder.company_id=new.company_id and folder.folder_id=new.resource_id
    for key share;
  elsif new.resource_type='logic_gate' then
    perform 1 from logic_gates gate
    where gate.company_id=new.company_id and gate.logic_gate_id=new.resource_id
    for key share;
  else
    raise exception 'invalid_process_map_resource_type' using errcode='23514';
  end if;
  if not found then raise exception 'process_map_resource_not_found' using errcode='23503'; end if;
  if new.map_parent_folder_id is not null then
    perform 1 from company_explorer_folders folder
    where folder.company_id=new.company_id and folder.folder_id=new.map_parent_folder_id
    for key share;
    if not found then raise exception 'process_map_parent_folder_not_found' using errcode='23503'; end if;
    perform 1 from process_map_placements parent_placement
    where parent_placement.company_id=new.company_id
      and parent_placement.resource_type='company_explorer_folder'
      and parent_placement.resource_id=new.map_parent_folder_id
    for key share;
    if not found then raise exception 'process_map_parent_folder_not_mapped' using errcode='23503'; end if;
  end if;
  if new.resource_type='company_explorer_folder' and new.map_parent_folder_id is not null and parent_changed then
    with recursive ancestors(folder_id) as (
      select new.map_parent_folder_id
      union
      select placement.map_parent_folder_id
      from ancestors ancestor
      join process_map_placements placement
        on placement.company_id=new.company_id
       and placement.resource_type='company_explorer_folder'
       and placement.resource_id=ancestor.folder_id
      where placement.map_parent_folder_id is not null
    )
    select exists(select 1 from ancestors where folder_id=new.resource_id) into cycle_found;
    if cycle_found then raise exception 'process_map_parent_cycle' using errcode='23514'; end if;
  end if;
  return new;
end;
$$ language plpgsql;

create or replace function trg_cleanup_process_map_source_delete()
returns trigger as $$
declare
  deleted_company_id uuid := (to_jsonb(old)->>'company_id')::uuid;
  deleted_resource_type text;
  deleted_resource_id uuid;
  replacement_parent_id uuid;
begin
  if tg_table_name='company_explorer_folders' then
    deleted_resource_type := 'company_explorer_folder';
    deleted_resource_id := (to_jsonb(old)->>'folder_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('process-map-parent:' || deleted_company_id::text,0));
    select placement.map_parent_folder_id into replacement_parent_id
    from process_map_placements placement
    where placement.company_id=deleted_company_id
      and placement.resource_type=deleted_resource_type and placement.resource_id=deleted_resource_id
    for update;
    update process_map_placements placement
    set map_parent_folder_id=replacement_parent_id,
        revision=placement.revision+1,updated_timestamp=statement_timestamp()
    where placement.company_id=deleted_company_id and placement.map_parent_folder_id=deleted_resource_id;
  elsif tg_table_name='logic_gates' then
    deleted_resource_type := 'logic_gate';
    deleted_resource_id := (to_jsonb(old)->>'logic_gate_id')::uuid;
  else
    raise exception 'unsupported_process_map_cleanup_source' using errcode='23514';
  end if;
  delete from resource_operational_relationships relationship
  where relationship.company_id=deleted_company_id
    and ((relationship.source_resource_type=deleted_resource_type and relationship.source_resource_id=deleted_resource_id)
      or (relationship.target_resource_type=deleted_resource_type and relationship.target_resource_id=deleted_resource_id));
  delete from process_map_placements placement
  where placement.company_id=deleted_company_id
    and placement.resource_type=deleted_resource_type and placement.resource_id=deleted_resource_id;
  return old;
end;
$$ language plpgsql;

insert into workspace_read_versions(company_id,scope,resource_key,version,updated_timestamp)
select company_id,'process-map','',1,statement_timestamp()
from (select distinct company_id from process_map_v3_geometry_plan) company
on conflict(company_id,scope,resource_key) do update
set version=workspace_read_versions.version+1,updated_timestamp=excluded.updated_timestamp;

commit;
