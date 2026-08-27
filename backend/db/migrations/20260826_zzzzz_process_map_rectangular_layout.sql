-- Replace the first automatic Process Map geometry once with the approved
-- rectangular layout. Company Explorer remains the parent authority, and this
-- migration does not read or change operational relationships or trace routes.

begin;

lock table company_explorer_folders, company_explorer_items, process_map_placements, domain_events in share row exclusive mode;

do $$
begin
  raise notice 'Process Map rectangular layout connected PostgreSQL server_version=% server_version_num=%',
    current_setting('server_version'),current_setting('server_version_num');
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: Process Map rectangular layout requires PostgreSQL 17 or newer';
  end if;
end $$;

create temporary table process_map_rectangular_folder_depth (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  depth integer not null,
  primary key(company_id,folder_id)
) on commit drop;

insert into process_map_rectangular_folder_depth(company_id,folder_id,parent_folder_id,depth)
with recursive folder_tree(company_id,folder_id,parent_folder_id,depth,path) as (
  select folder.company_id,folder.folder_id,folder.parent_folder_id,0,array[folder.folder_id]
  from company_explorer_folders folder
  where folder.parent_folder_id is null
  union all
  select child.company_id,child.folder_id,child.parent_folder_id,parent.depth+1,parent.path || child.folder_id
  from folder_tree parent
  join company_explorer_folders child
    on child.company_id=parent.company_id and child.parent_folder_id=parent.folder_id
  where not child.folder_id=any(parent.path) and parent.depth<999
)
select company_id,folder_id,parent_folder_id,depth
from folder_tree;

do $$
begin
  if exists (
    select 1
    from company_explorer_folders folder
    where folder.parent_folder_id is not null
      and not exists (
        select 1
        from company_explorer_folders parent
        where parent.company_id=folder.company_id
          and parent.folder_id=folder.parent_folder_id
      )
  ) or (select count(*) from process_map_rectangular_folder_depth)
       <> (select count(*) from company_explorer_folders) then
    raise exception 'STOP: Company Explorer contains a missing or cross-company Folder parent, a cycle, or a hierarchy deeper than 1000';
  end if;

  if exists (
    select 1
    from company_explorer_items item
    where item.target_type='logic_gate'
      and item.parent_folder_id is not null
      and not exists (
        select 1
        from company_explorer_folders parent
        where parent.company_id=item.company_id
          and parent.folder_id=item.parent_folder_id
      )
  ) then
    raise exception 'STOP: Company Explorer contains a Process with a missing or cross-company Folder parent';
  end if;
end $$;

create temporary table process_map_rectangular_layout (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  parent_folder_id uuid,
  depth integer not null,
  sort_position integer not null,
  sort_timestamp timestamp with time zone not null,
  sort_id uuid not null,
  grid_x bigint not null default 0,
  grid_y bigint not null default 0,
  grid_width bigint not null,
  grid_height bigint not null,
  folder_columns integer not null default 1,
  folder_lane_width bigint not null default 0,
  folder_section_height bigint not null default 0,
  process_section_width bigint not null default 0,
  process_section_height bigint not null default 0,
  primary key(company_id,resource_type,resource_id)
) on commit drop;

insert into process_map_rectangular_layout(
  company_id,resource_type,resource_id,parent_folder_id,depth,
  sort_position,sort_timestamp,sort_id,grid_width,grid_height
)
select folder.company_id,'company_explorer_folder',folder.folder_id,folder.parent_folder_id,depth.depth,
       folder.position,folder.created_timestamp,folder.folder_id,
       case when depth.depth=0 then 32 else 24 end,
       case when depth.depth=0 then 24 else 16 end
from company_explorer_folders folder
join process_map_rectangular_folder_depth depth
  on depth.company_id=folder.company_id and depth.folder_id=folder.folder_id;

insert into process_map_rectangular_layout(
  company_id,resource_type,resource_id,parent_folder_id,depth,
  sort_position,sort_timestamp,sort_id,grid_width,grid_height
)
select item.company_id,'logic_gate',item.target_id,item.parent_folder_id,
       case when item.parent_folder_id is null then 0 else parent.depth+1 end,
       item.position,item.created_timestamp,item.item_id,14,8
from company_explorer_items item
left join process_map_rectangular_folder_depth parent
  on parent.company_id=item.company_id and parent.folder_id=item.parent_folder_id
where item.target_type='logic_gate';

do $$
begin
  if exists (
    select 1
    from process_map_rectangular_layout layout
    left join process_map_placements placement
      on placement.company_id=layout.company_id
     and placement.resource_type=layout.resource_type
     and placement.resource_id=layout.resource_id
    where placement.resource_id is null
  ) or exists (
    select 1
    from process_map_placements placement
    left join process_map_rectangular_layout layout
      on layout.company_id=placement.company_id
     and layout.resource_type=placement.resource_type
     and layout.resource_id=placement.resource_id
    where layout.resource_id is null
  ) then
    raise exception 'STOP: Run the Process Map automatic placement migration before the rectangular layout migration';
  end if;

  if exists (
    select 1
    from process_map_rectangular_layout layout
    join process_map_placements placement
      on placement.company_id=layout.company_id
     and placement.resource_type=layout.resource_type
     and placement.resource_id=layout.resource_id
    where placement.map_parent_folder_id is distinct from layout.parent_folder_id
  ) then
    raise exception 'STOP: Process Map parentage is not synchronized with Company Explorer; run the automatic placement migration first';
  end if;
end $$;

-- Size each Folder after all of its child Folders are sized. A root with no
-- direct Processes may show child Folders in two columns. Every other Folder
-- uses one left Folder lane, while direct Processes use two columns on the
-- right. The six-unit header is kept clear above both sections.
do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((
    select max(depth)
    from process_map_rectangular_layout
    where resource_type='company_explorer_folder'
  ),0);
begin
  for current_depth in reverse maximum_depth..0 loop
    with parent_counts as (
      select parent.company_id,parent.resource_id,parent.depth,
             count(*) filter(where child.resource_type='company_explorer_folder')::integer folder_count,
             count(*) filter(where child.resource_type='logic_gate')::integer process_count
      from process_map_rectangular_layout parent
      left join process_map_rectangular_layout child
        on child.company_id=parent.company_id
       and child.parent_folder_id=parent.resource_id
      where parent.resource_type='company_explorer_folder'
        and parent.depth=current_depth
      group by parent.company_id,parent.resource_id,parent.depth
    ),
    folder_ranked as (
      select child.company_id,child.parent_folder_id,child.grid_width,child.grid_height,
             (row_number() over(
               partition by child.company_id,child.parent_folder_id
               order by child.sort_position,child.sort_timestamp,child.sort_id
             )-1)::integer child_index,
             case when counts.depth=0 and counts.process_count=0 then 2 else 1 end folder_columns
      from parent_counts counts
      join process_map_rectangular_layout child
        on child.company_id=counts.company_id
       and child.parent_folder_id=counts.resource_id
       and child.resource_type='company_explorer_folder'
    ),
    folder_cells as (
      select ranked.*,
             ranked.child_index % ranked.folder_columns column_index,
             ranked.child_index / ranked.folder_columns row_index
      from folder_ranked ranked
    ),
    folder_column_widths as (
      select company_id,parent_folder_id,column_index,max(grid_width) column_width
      from folder_cells
      group by company_id,parent_folder_id,column_index
    ),
    folder_widths as (
      select company_id,parent_folder_id,
             sum(column_width)+greatest(count(*)-1,0)*2 folder_width
      from folder_column_widths
      group by company_id,parent_folder_id
    ),
    folder_row_heights as (
      select company_id,parent_folder_id,row_index,max(grid_height) row_height
      from folder_cells
      group by company_id,parent_folder_id,row_index
    ),
    folder_heights as (
      select company_id,parent_folder_id,
             sum(row_height)+greatest(count(*)-1,0)*2 folder_height
      from folder_row_heights
      group by company_id,parent_folder_id
    ),
    metrics as (
      select counts.company_id,counts.resource_id,counts.folder_count,counts.process_count,
             case when counts.depth=0 and counts.process_count=0 then 2 else 1 end folder_columns,
             case
               when counts.process_count>0 then greatest(24::bigint,coalesce(widths.folder_width,0))
               else coalesce(widths.folder_width,0)
             end folder_lane_width,
             coalesce(heights.folder_height,0) folder_section_height,
             case
               when counts.process_count=0 then 0::bigint
               when counts.process_count=1 then 14::bigint
               else 30::bigint
             end process_section_width,
             case
               when counts.process_count=0 then 0::bigint
               else (((counts.process_count+1)/2)*8 + greatest((counts.process_count+1)/2-1,0)*2)::bigint
             end process_section_height
      from parent_counts counts
      left join folder_widths widths
        on widths.company_id=counts.company_id and widths.parent_folder_id=counts.resource_id
      left join folder_heights heights
        on heights.company_id=counts.company_id and heights.parent_folder_id=counts.resource_id
    )
    update process_map_rectangular_layout parent
    set folder_columns=metrics.folder_columns,
        folder_lane_width=metrics.folder_lane_width,
        folder_section_height=metrics.folder_section_height,
        process_section_width=metrics.process_section_width,
        process_section_height=metrics.process_section_height,
        grid_width=greatest(parent.grid_width,
          case
            when metrics.process_count>0 then
              2+metrics.folder_lane_width+4+metrics.process_section_width+2
            when metrics.folder_count>0 then 2+metrics.folder_lane_width+2
            else parent.grid_width
          end),
        grid_height=greatest(parent.grid_height,
          case
            when metrics.folder_count+metrics.process_count>0 then
              6+greatest(metrics.folder_section_height,metrics.process_section_height)+2
            else parent.grid_height
          end)
    from metrics
    where parent.company_id=metrics.company_id
      and parent.resource_type='company_explorer_folder'
      and parent.resource_id=metrics.resource_id;
  end loop;
end $$;

-- Arrange every root resource into four aligned columns. Each column uses its
-- widest root and each row uses its tallest root, with an eight-unit gap.
with root_ranked as (
  select root.company_id,root.resource_type,root.resource_id,root.grid_width,root.grid_height,
         (row_number() over(
           partition by root.company_id
           order by root.sort_position,root.sort_timestamp,root.resource_type,root.sort_id
         )-1)::integer root_index
  from process_map_rectangular_layout root
  where root.parent_folder_id is null
),
root_cells as (
  select ranked.*,ranked.root_index % 4 column_index,ranked.root_index / 4 row_index
  from root_ranked ranked
),
root_column_widths as (
  select company_id,column_index,max(grid_width) column_width
  from root_cells
  group by company_id,column_index
),
root_row_heights as (
  select company_id,row_index,max(grid_height) row_height
  from root_cells
  group by company_id,row_index
),
root_positions as (
  select cell.company_id,cell.resource_type,cell.resource_id,
         coalesce((
           select sum(widths.column_width+8)
           from root_column_widths widths
           where widths.company_id=cell.company_id and widths.column_index<cell.column_index
         ),0) next_x,
         coalesce((
           select sum(heights.row_height+8)
           from root_row_heights heights
           where heights.company_id=cell.company_id and heights.row_index<cell.row_index
         ),0) next_y
  from root_cells cell
)
update process_map_rectangular_layout layout
set grid_x=positions.next_x,grid_y=positions.next_y
from root_positions positions
where layout.company_id=positions.company_id
  and layout.resource_type=positions.resource_type
  and layout.resource_id=positions.resource_id;

-- Position each level after its parent has been positioned. Folder children use
-- their parent's one- or two-column left section; Processes use two fixed-size
-- columns in the right section.
do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((select max(depth) from process_map_rectangular_layout),0);
begin
  if maximum_depth>0 then
    for current_depth in 1..maximum_depth loop
      with folder_ranked as (
        select child.company_id,child.resource_type,child.resource_id,child.parent_folder_id,child.grid_width,child.grid_height,
               parent.grid_x parent_x,parent.grid_y parent_y,parent.folder_columns,
               (row_number() over(
                 partition by child.company_id,child.parent_folder_id
                 order by child.sort_position,child.sort_timestamp,child.sort_id
               )-1)::integer child_index
        from process_map_rectangular_layout child
        join process_map_rectangular_layout parent
          on parent.company_id=child.company_id
         and parent.resource_type='company_explorer_folder'
         and parent.resource_id=child.parent_folder_id
        where child.resource_type='company_explorer_folder'
          and child.depth=current_depth
      ),
      folder_cells as (
        select ranked.*,
               ranked.child_index % ranked.folder_columns column_index,
               ranked.child_index / ranked.folder_columns row_index
        from folder_ranked ranked
      ),
      folder_column_widths as (
        select company_id,parent_folder_id,column_index,max(grid_width) column_width
        from folder_cells
        group by company_id,parent_folder_id,column_index
      ),
      folder_row_heights as (
        select company_id,parent_folder_id,row_index,max(grid_height) row_height
        from folder_cells
        group by company_id,parent_folder_id,row_index
      ),
      folder_positions as (
        select cell.company_id,cell.resource_type,cell.resource_id,
               cell.parent_x+2+coalesce((
                 select sum(widths.column_width+2)
                 from folder_column_widths widths
                 where widths.company_id=cell.company_id
                   and widths.parent_folder_id=cell.parent_folder_id
                   and widths.column_index<cell.column_index
               ),0) next_x,
               cell.parent_y+6+coalesce((
                 select sum(heights.row_height+2)
                 from folder_row_heights heights
                 where heights.company_id=cell.company_id
                   and heights.parent_folder_id=cell.parent_folder_id
                   and heights.row_index<cell.row_index
               ),0) next_y
        from folder_cells cell
      )
      update process_map_rectangular_layout layout
      set grid_x=positions.next_x,grid_y=positions.next_y
      from folder_positions positions
      where layout.company_id=positions.company_id
        and layout.resource_type=positions.resource_type
        and layout.resource_id=positions.resource_id;

      with process_ranked as (
        select child.company_id,child.resource_type,child.resource_id,
               parent.grid_x parent_x,parent.grid_y parent_y,parent.folder_lane_width,
               (row_number() over(
                 partition by child.company_id,child.parent_folder_id
                 order by child.sort_position,child.sort_timestamp,child.sort_id
               )-1)::integer child_index
        from process_map_rectangular_layout child
        join process_map_rectangular_layout parent
          on parent.company_id=child.company_id
         and parent.resource_type='company_explorer_folder'
         and parent.resource_id=child.parent_folder_id
        where child.resource_type='logic_gate'
          and child.depth=current_depth
      )
      update process_map_rectangular_layout layout
      set grid_x=ranked.parent_x+2+ranked.folder_lane_width+4+(ranked.child_index%2)*16,
          grid_y=ranked.parent_y+6+(ranked.child_index/2)*10
      from process_ranked ranked
      where layout.company_id=ranked.company_id
        and layout.resource_type=ranked.resource_type
        and layout.resource_id=ranked.resource_id;
    end loop;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from process_map_rectangular_layout layout
    where layout.grid_x < -1000000000 or layout.grid_y < -1000000000
       or layout.grid_width < 1 or layout.grid_width > 1000000
       or layout.grid_height < 1 or layout.grid_height > 1000000
       or layout.grid_x+layout.grid_width > 1000000000
       or layout.grid_y+layout.grid_height > 1000000000
  ) then
    raise exception 'STOP: Process Map rectangular layout exceeds supported geometry bounds';
  end if;

  if exists (
    select 1
    from process_map_rectangular_layout child
    join process_map_rectangular_layout parent
      on parent.company_id=child.company_id
     and parent.resource_type='company_explorer_folder'
     and parent.resource_id=child.parent_folder_id
    where child.grid_x<parent.grid_x
       or child.grid_y<parent.grid_y
       or child.grid_x+child.grid_width>parent.grid_x+parent.grid_width
       or child.grid_y+child.grid_height>parent.grid_y+parent.grid_height
  ) then
    raise exception 'STOP: Process Map rectangular layout failed Folder containment validation';
  end if;

  if exists (
    select 1
    from process_map_rectangular_layout first_item
    join process_map_rectangular_layout second_item
      on second_item.company_id=first_item.company_id
     and second_item.parent_folder_id is not distinct from first_item.parent_folder_id
     and (second_item.resource_type,second_item.resource_id)>(first_item.resource_type,first_item.resource_id)
    where first_item.grid_x<second_item.grid_x+second_item.grid_width
      and first_item.grid_x+first_item.grid_width>second_item.grid_x
      and first_item.grid_y<second_item.grid_y+second_item.grid_height
      and first_item.grid_y+first_item.grid_height>second_item.grid_y
  ) then
    raise exception 'STOP: Process Map rectangular layout produced overlapping siblings';
  end if;
end $$;

create temporary table process_map_rectangular_eligible_companies (
  company_id uuid primary key
) on commit drop;

create temporary table process_map_rectangular_affected_companies (
  company_id uuid primary key
) on commit drop;

insert into process_map_rectangular_eligible_companies(company_id)
select distinct company_id
from process_map_rectangular_layout;

insert into process_map_rectangular_affected_companies(company_id)
select distinct layout.company_id
from process_map_rectangular_layout layout
join process_map_placements placement
  on placement.company_id=layout.company_id
 and placement.resource_type=layout.resource_type
 and placement.resource_id=layout.resource_id
where placement.grid_x::bigint is distinct from layout.grid_x
   or placement.grid_y::bigint is distinct from layout.grid_y
   or placement.grid_width::bigint is distinct from layout.grid_width
   or placement.grid_height::bigint is distinct from layout.grid_height;

do $$
begin
  if exists (
    select 1
    from process_map_rectangular_eligible_companies company
    join domain_events marker
      on marker.company_id=company.company_id
     and marker.idempotency_key='migration:20260826-process-map-rectangular-layout'
    where marker.stream_type is distinct from 'workspace'
       or marker.stream_id is distinct from company.company_id::text
       or marker.event_type is distinct from 'process_map_placement_saved'
       or marker.payload->>'realtime_change_type' is distinct from 'process_map_rectangular_layout_applied'
  ) then
    raise exception 'STOP: Process Map rectangular layout marker key is already used by another event';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from process_map_rectangular_affected_companies company
    join domain_events marker
      on marker.company_id=company.company_id
     and marker.stream_type='workspace'
     and marker.stream_id=company.company_id::text
     and marker.event_type='process_map_placement_saved'
     and marker.payload->>'realtime_change_type'='process_map_rectangular_layout_applied'
     and marker.idempotency_key='migration:20260826-process-map-rectangular-layout'
  ) then
    raise exception 'STOP: Process Map rectangular layout already ran; refusing to overwrite later manual geometry';
  end if;
end $$;

update process_map_placements placement
set grid_x=layout.grid_x::integer,
    grid_y=layout.grid_y::integer,
    grid_width=layout.grid_width::integer,
    grid_height=layout.grid_height::integer,
    revision=placement.revision+1,
    updated_timestamp=statement_timestamp()
from process_map_rectangular_layout layout
where placement.company_id=layout.company_id
  and placement.resource_type=layout.resource_type
  and placement.resource_id=layout.resource_id
  and (
    placement.grid_x::bigint is distinct from layout.grid_x
    or placement.grid_y::bigint is distinct from layout.grid_y
    or placement.grid_width::bigint is distinct from layout.grid_width
    or placement.grid_height::bigint is distinct from layout.grid_height
  );

do $$
begin
  if exists (
    select 1
    from process_map_rectangular_eligible_companies company
    where coalesce((
      select max(event.sequence)
      from domain_events event
      where event.company_id=company.company_id
        and event.stream_type='workspace'
        and event.stream_id=company.company_id::text
    ),0)=9223372036854775807
      and not exists (
        select 1
        from domain_events marker
        where marker.company_id=company.company_id
          and marker.idempotency_key='migration:20260826-process-map-rectangular-layout'
      )
  ) then
    raise exception 'STOP: Process Map rectangular layout cannot advance a maximum workspace event sequence';
  end if;
end $$;

insert into domain_events(
  event_id,company_id,stream_type,stream_id,sequence,event_type,
  actor_user_id,idempotency_key,payload,created_timestamp
)
select gen_random_uuid(),company.company_id,'workspace',company.company_id::text,
       coalesce((
         select max(event.sequence)
         from domain_events event
         where event.company_id=company.company_id
           and event.stream_type='workspace'
           and event.stream_id=company.company_id::text
       ),0)+1,
       'process_map_placement_saved',null,
       'migration:20260826-process-map-rectangular-layout',
       jsonb_build_object('realtime_change_type','process_map_rectangular_layout_applied'),
       statement_timestamp()
from process_map_rectangular_eligible_companies company
where not exists (
  select 1
  from domain_events marker
  where marker.company_id=company.company_id
    and marker.idempotency_key='migration:20260826-process-map-rectangular-layout'
);

commit;
