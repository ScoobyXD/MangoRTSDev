-- Normalize the first automatic Process Map layout once, after the automatic
-- Company Explorer projection migration. Later same-parent manual geometry is
-- preserved because a second run refuses to overwrite geometry changed after
-- this migration. Relationships and trace routes are not read or changed.

begin;

lock table company_explorer_folders, company_explorer_items, process_map_placements, domain_events in share row exclusive mode;

do $$
begin
  raise notice 'Process Map tidy layout connected PostgreSQL server_version=% server_version_num=%',
    current_setting('server_version'),current_setting('server_version_num');
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: Process Map tidy layout requires PostgreSQL 17 or newer';
  end if;
end $$;

create temporary table process_map_tidy_folder_depth (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  depth integer not null,
  primary key(company_id,folder_id)
) on commit drop;

insert into process_map_tidy_folder_depth(company_id,folder_id,parent_folder_id,depth)
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
  if (select count(*) from process_map_tidy_folder_depth)
     <> (select count(*) from company_explorer_folders) then
    raise exception 'STOP: Company Explorer contains a folder cycle or hierarchy deeper than 1000';
  end if;
end $$;

create temporary table process_map_tidy_layout (
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
  primary key(company_id,resource_type,resource_id)
) on commit drop;

insert into process_map_tidy_layout(
  company_id,resource_type,resource_id,parent_folder_id,depth,
  sort_position,sort_timestamp,sort_id,grid_width,grid_height
)
select folder.company_id,'company_explorer_folder',folder.folder_id,folder.parent_folder_id,depth.depth,
       folder.position,folder.created_timestamp,folder.folder_id,
       case when depth.depth=0 then 32 else 24 end,
       case when depth.depth=0 then 24 else 16 end
from company_explorer_folders folder
join process_map_tidy_folder_depth depth
  on depth.company_id=folder.company_id and depth.folder_id=folder.folder_id;

insert into process_map_tidy_layout(
  company_id,resource_type,resource_id,parent_folder_id,depth,
  sort_position,sort_timestamp,sort_id,grid_width,grid_height
)
select item.company_id,'logic_gate',item.target_id,item.parent_folder_id,
       case when item.parent_folder_id is null then 0 else parent.depth+1 end,
       item.position,item.created_timestamp,item.item_id,14,8
from company_explorer_items item
left join process_map_tidy_folder_depth parent
  on parent.company_id=item.company_id and parent.folder_id=item.parent_folder_id
where item.target_type='logic_gate';

do $$
begin
  if exists (
    select 1
    from process_map_tidy_layout layout
    left join process_map_placements placement
      on placement.company_id=layout.company_id
     and placement.resource_type=layout.resource_type
     and placement.resource_id=layout.resource_id
    where placement.resource_id is null
  ) then
    raise exception 'STOP: Run the Process Map automatic placement migration before the tidy layout migration';
  end if;

  if exists (
    select 1
    from process_map_tidy_layout layout
    join process_map_placements placement
      on placement.company_id=layout.company_id
     and placement.resource_type=layout.resource_type
     and placement.resource_id=layout.resource_id
    where placement.map_parent_folder_id is distinct from layout.parent_folder_id
  ) then
    raise exception 'STOP: Process Map parentage is not synchronized with Company Explorer';
  end if;
end $$;

-- Size every Folder from its direct children, deepest first. Children remain a
-- simple vertical list with two grid units of padding and two units of spacing.
do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((
    select max(depth) from process_map_tidy_layout
    where resource_type='company_explorer_folder'
  ),0);
begin
  for current_depth in reverse maximum_depth..0 loop
    update process_map_tidy_layout parent
    set grid_width=greatest(parent.grid_width,coalesce((
          select max(child.grid_width)+4
          from process_map_tidy_layout child
          where child.company_id=parent.company_id
            and child.parent_folder_id=parent.resource_id
        ),parent.grid_width)),
        grid_height=greatest(parent.grid_height,coalesce((
          select sum(child.grid_height)+4+greatest(count(*)-1,0)*2
          from process_map_tidy_layout child
          where child.company_id=parent.company_id
            and child.parent_folder_id=parent.resource_id
        ),parent.grid_height))
    where parent.resource_type='company_explorer_folder'
      and parent.depth=current_depth;
  end loop;
end $$;

-- Shelf every root from left to right only after final Folder sizes are known.
-- Root widths plus this fixed gap make root overlap impossible.
with roots as (
  select root.company_id,root.resource_type,root.resource_id,
         coalesce(sum(root.grid_width+8) over(
           partition by root.company_id
           order by root.sort_position,root.sort_timestamp,root.resource_type,root.sort_id
           rows between unbounded preceding and 1 preceding
         ),0) next_x
  from process_map_tidy_layout root
  where root.parent_folder_id is null
)
update process_map_tidy_layout layout
set grid_x=roots.next_x,grid_y=0
from roots
where layout.company_id=roots.company_id
  and layout.resource_type=roots.resource_type
  and layout.resource_id=roots.resource_id;

-- Position each hierarchy level from its already-positioned parent. This moves
-- descendants with their root while keeping their canonical Explorer parent.
do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((select max(depth) from process_map_tidy_layout),0);
begin
  if maximum_depth > 0 then
    for current_depth in 1..maximum_depth loop
      with children as (
        select child.company_id,child.resource_type,child.resource_id,
               parent.grid_x+2 next_x,
               parent.grid_y+2+coalesce(sum(child.grid_height+2) over(
                 partition by child.company_id,child.parent_folder_id
                 order by child.sort_position,child.sort_timestamp,child.resource_type,child.sort_id
                 rows between unbounded preceding and 1 preceding
               ),0) next_y
        from process_map_tidy_layout child
        join process_map_tidy_layout parent
          on parent.company_id=child.company_id
         and parent.resource_type='company_explorer_folder'
         and parent.resource_id=child.parent_folder_id
        where child.depth=current_depth
      )
      update process_map_tidy_layout layout
      set grid_x=children.next_x,grid_y=children.next_y
      from children
      where layout.company_id=children.company_id
        and layout.resource_type=children.resource_type
        and layout.resource_id=children.resource_id;
    end loop;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from process_map_tidy_layout
    where grid_x < -1000000000 or grid_y < -1000000000
       or grid_width < 1 or grid_width > 1000000
       or grid_height < 1 or grid_height > 1000000
       or grid_x+grid_width > 1000000000
       or grid_y+grid_height > 1000000000
  ) then
    raise exception 'STOP: Process Map tidy layout exceeds supported geometry bounds';
  end if;
end $$;

create temporary table process_map_tidy_affected_companies (
  company_id uuid primary key
) on commit drop;

create temporary table process_map_tidy_eligible_companies (
  company_id uuid primary key
) on commit drop;

insert into process_map_tidy_eligible_companies(company_id)
select distinct company_id
from process_map_tidy_layout;

insert into process_map_tidy_affected_companies(company_id)
select distinct layout.company_id
from process_map_tidy_layout layout
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
    from process_map_tidy_affected_companies company
    join domain_events event
      on event.company_id=company.company_id
     and event.stream_type='workspace'
     and event.stream_id=company.company_id::text
     and event.idempotency_key='migration:20260826-process-map-tidy-initial-layout'
  ) then
    raise exception 'STOP: Process Map tidy layout already ran; refusing to overwrite later manual geometry';
  end if;
end $$;

update process_map_placements placement
set grid_x=layout.grid_x::integer,
    grid_y=layout.grid_y::integer,
    grid_width=layout.grid_width::integer,
    grid_height=layout.grid_height::integer,
    revision=placement.revision+1,
    updated_timestamp=statement_timestamp()
from process_map_tidy_layout layout
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
    select 1 from process_map_tidy_eligible_companies company
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
          and marker.idempotency_key='migration:20260826-process-map-tidy-initial-layout'
      )
  ) then
    raise exception 'STOP: Process Map tidy layout cannot advance a maximum workspace event sequence';
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
       'migration:20260826-process-map-tidy-initial-layout',
       jsonb_build_object('realtime_change_type','process_map_initial_layout_tidied'),
       statement_timestamp()
from process_map_tidy_eligible_companies company
where not exists (
  select 1
  from domain_events marker
  where marker.company_id=company.company_id
    and marker.idempotency_key='migration:20260826-process-map-tidy-initial-layout'
);

commit;
