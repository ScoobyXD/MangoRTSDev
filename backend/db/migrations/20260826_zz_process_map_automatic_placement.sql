-- Backfill the Process Map from canonical Company Explorer parentage.
-- PostgreSQL 17.x compatible. Existing coordinates are preserved when parentage already matches.
-- Operational relationships and trace geometry are never deleted.

begin;

lock table company_explorer_folders, company_explorer_items, process_map_placements, process_map_traces, domain_events in share row exclusive mode;

do $$
begin
  raise notice 'Process Map automatic placement connected PostgreSQL server_version=% server_version_num=%',
    current_setting('server_version'),current_setting('server_version_num');
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: Process Map automatic placement requires PostgreSQL 17 or newer';
  end if;
end $$;

create temporary table process_map_auto_affected_companies (
  company_id uuid primary key
) on commit drop;

insert into process_map_auto_affected_companies(company_id)
select company_id from process_map_placements
union
select company_id from company_explorer_folders
union
select company_id from company_explorer_items;

create temporary table process_map_auto_stale_processes (
  company_id uuid not null,
  logic_gate_id uuid not null,
  primary key(company_id,logic_gate_id)
) on commit drop;

insert into process_map_auto_stale_processes(company_id,logic_gate_id)
select placement.company_id,placement.resource_id
from process_map_placements placement
where placement.resource_type='logic_gate'
  and not exists (
    select 1
    from company_explorer_items item
    where item.company_id=placement.company_id
      and item.target_type='logic_gate'
      and item.target_id=placement.resource_id
  );

delete from process_map_placements placement
using process_map_auto_stale_processes stale
where placement.company_id=stale.company_id
  and placement.resource_type='logic_gate'
  and placement.resource_id=stale.logic_gate_id;

create temporary table process_map_auto_folder_depth (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  depth integer not null,
  primary key(company_id,folder_id)
) on commit drop;

create temporary table process_map_auto_repositioned (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  primary key(company_id,resource_type,resource_id)
) on commit drop;

insert into process_map_auto_folder_depth(company_id,folder_id,parent_folder_id,depth)
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
select company_id,folder_id,parent_folder_id,depth from folder_tree;

do $$
begin
  if (select count(*) from process_map_auto_folder_depth)
     <> (select count(*) from company_explorer_folders) then
    raise exception 'STOP: Company Explorer contains a folder cycle or hierarchy deeper than 1000';
  end if;
end $$;

insert into process_map_auto_repositioned(company_id,resource_type,resource_id)
select folder.company_id,'company_explorer_folder',folder.folder_id
from company_explorer_folders folder
left join process_map_placements placement
  on placement.company_id=folder.company_id
 and placement.resource_type='company_explorer_folder'
 and placement.resource_id=folder.folder_id
where folder.parent_folder_id is null
  and (placement.resource_id is null or placement.map_parent_folder_id is not null);

with candidates as (
  select folder.company_id,folder.folder_id,
         row_number() over(partition by folder.company_id order by folder.position,folder.created_timestamp,folder.folder_id) ordinal,
         greatest(coalesce(placement.grid_width,120),120)::bigint placement_width,
         greatest(coalesce(placement.grid_height,80),80)::integer placement_height
  from company_explorer_folders folder
  left join process_map_placements placement
    on placement.company_id=folder.company_id
   and placement.resource_type='company_explorer_folder'
   and placement.resource_id=folder.folder_id
  where folder.parent_folder_id is null
    and (placement.resource_id is null or placement.map_parent_folder_id is not null)
), root_bounds as (
  select company_id,coalesce(max(grid_x::bigint+grid_width),-8) max_x
  from process_map_placements
  where map_parent_folder_id is null
  group by company_id
)
insert into process_map_placements(
  company_id,resource_type,resource_id,map_parent_folder_id,
  grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp
)
select candidates.company_id,'company_explorer_folder',candidates.folder_id,null,
       (coalesce(root_bounds.max_x,-8)+8+coalesce(
         sum(candidates.placement_width+8) over(
           partition by candidates.company_id order by candidates.ordinal
           rows between unbounded preceding and 1 preceding
         ),0
       ))::integer,0,
       candidates.placement_width::integer,candidates.placement_height,1,statement_timestamp(),statement_timestamp()
from candidates
left join root_bounds using(company_id)
on conflict(company_id,resource_type,resource_id) do update set
  map_parent_folder_id=null,
  grid_x=excluded.grid_x,
  grid_y=excluded.grid_y,
  grid_width=greatest(process_map_placements.grid_width,120),
  grid_height=greatest(process_map_placements.grid_height,80),
  revision=process_map_placements.revision+1,
  updated_timestamp=statement_timestamp();

do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((select max(depth) from process_map_auto_folder_depth),0);
begin
  for current_depth in 1..maximum_depth loop
    insert into process_map_auto_repositioned(company_id,resource_type,resource_id)
    select folder.company_id,'company_explorer_folder',folder.folder_id
    from process_map_auto_folder_depth folder
    left join process_map_placements placement
      on placement.company_id=folder.company_id
     and placement.resource_type='company_explorer_folder'
     and placement.resource_id=folder.folder_id
    where folder.depth=current_depth
      and (
        placement.resource_id is null
        or placement.map_parent_folder_id is distinct from folder.parent_folder_id
        or exists (
          select 1 from process_map_auto_repositioned moved_parent
          where moved_parent.company_id=folder.company_id
            and moved_parent.resource_type='company_explorer_folder'
            and moved_parent.resource_id=folder.parent_folder_id
        )
      )
    on conflict do nothing;

    with candidates as (
      select folder.company_id,folder.folder_id,folder.parent_folder_id,
             row_number() over(
               partition by folder.company_id,folder.parent_folder_id
               order by source.position,source.created_timestamp,source.folder_id
             ) ordinal,
             greatest(coalesce(placement.grid_width,80),80)::integer placement_width,
             greatest(coalesce(placement.grid_height,50),50)::bigint placement_height
      from process_map_auto_folder_depth folder
      join company_explorer_folders source
        on source.company_id=folder.company_id and source.folder_id=folder.folder_id
      left join process_map_placements placement
        on placement.company_id=folder.company_id
       and placement.resource_type='company_explorer_folder'
       and placement.resource_id=folder.folder_id
      join process_map_auto_repositioned moved
        on moved.company_id=folder.company_id
       and moved.resource_type='company_explorer_folder'
       and moved.resource_id=folder.folder_id
      where folder.depth=current_depth
    ), sibling_bounds as (
      select parent.company_id,parent.resource_id parent_folder_id,
             coalesce(max(child.grid_y::bigint+child.grid_height),parent.grid_y::bigint) max_y
      from process_map_placements parent
      left join process_map_placements child
        on child.company_id=parent.company_id
       and child.map_parent_folder_id=parent.resource_id
       and not exists (
         select 1 from process_map_auto_repositioned moved
         where moved.company_id=child.company_id
           and moved.resource_type=child.resource_type
           and moved.resource_id=child.resource_id
       )
      where parent.resource_type='company_explorer_folder'
      group by parent.company_id,parent.resource_id,parent.grid_y
    )
    insert into process_map_placements(
      company_id,resource_type,resource_id,map_parent_folder_id,
      grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp
    )
    select folder.company_id,'company_explorer_folder',folder.folder_id,folder.parent_folder_id,
           parent.grid_x+2,
           (sibling_bounds.max_y+2+coalesce(
             sum(folder.placement_height+2) over(
               partition by folder.company_id,folder.parent_folder_id order by folder.ordinal
               rows between unbounded preceding and 1 preceding
             ),0
           ))::integer,
           folder.placement_width,folder.placement_height::integer,1,statement_timestamp(),statement_timestamp()
    from candidates folder
    join process_map_placements parent
      on parent.company_id=folder.company_id
     and parent.resource_type='company_explorer_folder'
     and parent.resource_id=folder.parent_folder_id
    join sibling_bounds
      on sibling_bounds.company_id=folder.company_id
     and sibling_bounds.parent_folder_id=folder.parent_folder_id
    on conflict(company_id,resource_type,resource_id) do update set
      map_parent_folder_id=excluded.map_parent_folder_id,
      grid_x=case when exists (
        select 1 from process_map_auto_repositioned moved
        where moved.company_id=excluded.company_id and moved.resource_type=excluded.resource_type and moved.resource_id=excluded.resource_id
      ) then excluded.grid_x else process_map_placements.grid_x end,
      grid_y=case when exists (
        select 1 from process_map_auto_repositioned moved
        where moved.company_id=excluded.company_id and moved.resource_type=excluded.resource_type and moved.resource_id=excluded.resource_id
      ) then excluded.grid_y else process_map_placements.grid_y end,
      grid_width=case when exists (
        select 1 from process_map_auto_repositioned moved
        where moved.company_id=excluded.company_id and moved.resource_type=excluded.resource_type and moved.resource_id=excluded.resource_id
      ) then greatest(process_map_placements.grid_width,80) else process_map_placements.grid_width end,
      grid_height=case when exists (
        select 1 from process_map_auto_repositioned moved
        where moved.company_id=excluded.company_id and moved.resource_type=excluded.resource_type and moved.resource_id=excluded.resource_id
      ) then greatest(process_map_placements.grid_height,50) else process_map_placements.grid_height end,
      revision=case when process_map_placements.map_parent_folder_id is distinct from excluded.map_parent_folder_id
        or exists (
          select 1 from process_map_auto_repositioned moved
          where moved.company_id=excluded.company_id and moved.resource_type=excluded.resource_type and moved.resource_id=excluded.resource_id
        )
        then process_map_placements.revision+1 else process_map_placements.revision end,
      updated_timestamp=case when process_map_placements.map_parent_folder_id is distinct from excluded.map_parent_folder_id
        or exists (
          select 1 from process_map_auto_repositioned moved
          where moved.company_id=excluded.company_id and moved.resource_type=excluded.resource_type and moved.resource_id=excluded.resource_id
        )
        then statement_timestamp() else process_map_placements.updated_timestamp end;
  end loop;
end $$;

insert into process_map_auto_repositioned(company_id,resource_type,resource_id)
select item.company_id,'logic_gate',item.target_id
from company_explorer_items item
left join process_map_placements placement
  on placement.company_id=item.company_id
 and placement.resource_type='logic_gate'
 and placement.resource_id=item.target_id
where item.target_type='logic_gate'
  and (
    placement.resource_id is null
    or placement.map_parent_folder_id is distinct from item.parent_folder_id
    or (item.parent_folder_id is not null and exists (
      select 1 from process_map_auto_repositioned moved_parent
      where moved_parent.company_id=item.company_id
        and moved_parent.resource_type='company_explorer_folder'
        and moved_parent.resource_id=item.parent_folder_id
    ))
  )
on conflict do nothing;

with item_rank as (
  select item.*,
         row_number() over(
           partition by item.company_id,item.parent_folder_id
           order by item.position,item.created_timestamp,item.item_id
         ) ordinal,
         greatest(coalesce(placement.grid_width,14),14)::bigint placement_width,
         greatest(coalesce(placement.grid_height,8),8)::bigint placement_height
  from company_explorer_items item
  left join process_map_placements placement
    on placement.company_id=item.company_id
   and placement.resource_type='logic_gate'
   and placement.resource_id=item.target_id
  where item.target_type='logic_gate'
    and (
      placement.resource_id is null
      or exists (
        select 1 from process_map_auto_repositioned moved
        where moved.company_id=item.company_id and moved.resource_type='logic_gate' and moved.resource_id=item.target_id
      )
    )
), sibling_bounds as (
  select parent.company_id,parent.resource_id parent_folder_id,
         coalesce(max(child.grid_y::bigint+child.grid_height),parent.grid_y::bigint) max_y
  from process_map_placements parent
  left join process_map_placements child
    on child.company_id=parent.company_id
   and child.map_parent_folder_id=parent.resource_id
   and not exists (
     select 1 from process_map_auto_repositioned moved
     where moved.company_id=child.company_id
       and moved.resource_type='logic_gate'
       and child.resource_type='logic_gate'
       and moved.resource_id=child.resource_id
   )
  where parent.resource_type='company_explorer_folder'
  group by parent.company_id,parent.resource_id,parent.grid_y
), root_bounds as (
  select company_id,coalesce(max(grid_x::bigint+grid_width),-8) max_x
  from process_map_placements
  where map_parent_folder_id is null
  group by company_id
)
insert into process_map_placements(
  company_id,resource_type,resource_id,map_parent_folder_id,
  grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp
)
select item.company_id,'logic_gate',item.target_id,item.parent_folder_id,
       case when item.parent_folder_id is null
         then (coalesce(root_bounds.max_x,-8)+8+coalesce(
           sum(item.placement_width+8) over(
             partition by item.company_id,item.parent_folder_id order by item.ordinal
             rows between unbounded preceding and 1 preceding
           ),0
         ))::integer
         else parent.grid_x+2 end,
       case when item.parent_folder_id is null then 0
         else (sibling_bounds.max_y+2+coalesce(
           sum(item.placement_height+2) over(
             partition by item.company_id,item.parent_folder_id order by item.ordinal
             rows between unbounded preceding and 1 preceding
           ),0
         ))::integer end,
       item.placement_width::integer,item.placement_height::integer,1,statement_timestamp(),statement_timestamp()
from item_rank item
left join process_map_placements parent
  on parent.company_id=item.company_id
 and parent.resource_type='company_explorer_folder'
 and parent.resource_id=item.parent_folder_id
left join sibling_bounds
  on sibling_bounds.company_id=item.company_id and sibling_bounds.parent_folder_id=item.parent_folder_id
left join root_bounds on root_bounds.company_id=item.company_id
on conflict(company_id,resource_type,resource_id) do update set
  map_parent_folder_id=excluded.map_parent_folder_id,
  grid_x=excluded.grid_x,
  grid_y=excluded.grid_y,
  grid_width=greatest(process_map_placements.grid_width,14),
  grid_height=greatest(process_map_placements.grid_height,8),
  revision=process_map_placements.revision+1,
  updated_timestamp=statement_timestamp();

do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((select max(depth) from process_map_auto_folder_depth),0);
begin
  for current_depth in reverse maximum_depth..0 loop
    update process_map_placements parent
    set grid_width=greatest(parent.grid_width,child_bounds.required_width),
        grid_height=greatest(parent.grid_height,child_bounds.required_height),
        revision=case when parent.grid_width<child_bounds.required_width or parent.grid_height<child_bounds.required_height
          then parent.revision+1 else parent.revision end,
        updated_timestamp=case when parent.grid_width<child_bounds.required_width or parent.grid_height<child_bounds.required_height
          then statement_timestamp() else parent.updated_timestamp end
    from process_map_auto_folder_depth folder
    join lateral (
      select coalesce(max(child.grid_x::bigint+child.grid_width-folder_placement.grid_x+2),folder_placement.grid_width)::integer required_width,
             coalesce(max(child.grid_y::bigint+child.grid_height-folder_placement.grid_y+2),folder_placement.grid_height)::integer required_height
      from process_map_placements folder_placement
      left join process_map_placements child
        on child.company_id=folder_placement.company_id and child.map_parent_folder_id=folder_placement.resource_id
      where folder_placement.company_id=folder.company_id
        and folder_placement.resource_type='company_explorer_folder'
        and folder_placement.resource_id=folder.folder_id
      group by folder_placement.grid_x,folder_placement.grid_y,folder_placement.grid_width,folder_placement.grid_height
    ) child_bounds on true
    where folder.depth=current_depth
      and parent.company_id=folder.company_id
      and parent.resource_type='company_explorer_folder'
      and parent.resource_id=folder.folder_id;
  end loop;
end $$;

do $$
begin
  if exists (
    select 1 from process_map_auto_affected_companies company
    where coalesce((
      select max(event.sequence)
      from domain_events event
      where event.company_id=company.company_id
        and event.stream_type='workspace'
        and event.stream_id=company.company_id::text
    ),0)=9223372036854775807
  ) then
    raise exception 'STOP: Process Map automatic placement cannot advance a maximum workspace event sequence';
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
       'migration:20260826-process-map-automatic-placement',
       jsonb_build_object('realtime_change_type','process_map_automatic_placement_backfilled'),
       statement_timestamp()
from process_map_auto_affected_companies company
on conflict do nothing;

commit;
