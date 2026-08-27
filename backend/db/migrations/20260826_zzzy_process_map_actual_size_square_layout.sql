-- Supersede the three historical Process Map layout migrations without
-- rewriting them. This migration runs first, keeps every persisted dimension,
-- captures exact recovery evidence, and records itself plus the obsolete
-- filenames only after the corrected layout succeeds.

begin;

set local timezone='UTC';

lock table schema_migrations, company_explorer_folders, company_explorer_items,
  logic_gates, process_map_placements, domain_events, workspace_read_versions
  in share row exclusive mode;

do $$
begin
  raise notice 'Process Map actual-size layout connected PostgreSQL server_version=% server_version_num=%',
    current_setting('server_version'),current_setting('server_version_num');
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: Process Map actual-size layout requires PostgreSQL 17 or newer';
  end if;
  if to_regprocedure('public.workspace_read_version_keys_for_domain_event(text,jsonb)') is null
     or to_regprocedure('public.trg_update_workspace_read_versions()') is null
     or not exists (
       select 1
       from pg_trigger trigger_row
       where trigger_row.tgrelid='public.domain_events'::regclass
         and trigger_row.tgname='trg_update_workspace_read_versions'
         and trigger_row.tgfoid=to_regprocedure('public.trg_update_workspace_read_versions()')
         and trigger_row.tgenabled in ('O','A')
         and not trigger_row.tgisinternal
     ) then
    raise exception 'STOP: Process Map actual-size layout requires the enabled read-version trigger';
  end if;
end $$;

create temporary table process_map_actual_folder_depth (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  depth integer not null,
  primary key(company_id,folder_id)
) on commit drop;

insert into process_map_actual_folder_depth(company_id,folder_id,parent_folder_id,depth)
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

create index process_map_actual_folder_depth_parent_idx
  on process_map_actual_folder_depth(company_id,parent_folder_id,depth,folder_id);

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
  ) or (select count(*) from process_map_actual_folder_depth)
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

  if exists (
    select 1
    from company_explorer_items item
    left join logic_gates process
      on process.company_id=item.company_id
     and process.logic_gate_id=item.target_id
    where item.target_type='logic_gate'
      and process.logic_gate_id is null
  ) then
    raise exception 'STOP: Company Explorer contains a missing or cross-company Process source';
  end if;

  if exists (
    select 1
    from company_explorer_items item
    where item.target_type='logic_gate'
    group by item.company_id,item.target_id
    having count(*)<>1
  ) then
    raise exception 'STOP: Company Explorer contains duplicate Process placements';
  end if;

  if exists (
    select 1
    from company_explorer_folders folder
    left join process_map_placements placement
      on placement.company_id=folder.company_id
     and placement.resource_type='company_explorer_folder'
     and placement.resource_id=folder.folder_id
    where placement.resource_id is null
  ) then
    raise exception 'STOP: Company Explorer Folder is missing its Process Map placement';
  end if;

  if exists (
    select 1
    from company_explorer_items item
    left join process_map_placements placement
      on placement.company_id=item.company_id
     and placement.resource_type='logic_gate'
     and placement.resource_id=item.target_id
    where item.target_type='logic_gate'
      and placement.resource_id is null
  ) then
    raise exception 'STOP: Company Explorer Process is missing its Process Map placement';
  end if;

  if exists (
    select 1
    from process_map_placements placement
    where (placement.resource_type='company_explorer_folder' and not exists (
      select 1
      from company_explorer_folders folder
      where folder.company_id=placement.company_id
        and folder.folder_id=placement.resource_id
    )) or (placement.resource_type='logic_gate' and not exists (
      select 1
      from company_explorer_items item
      where item.company_id=placement.company_id
        and item.target_type='logic_gate'
        and item.target_id=placement.resource_id
    )) or placement.resource_type not in ('company_explorer_folder','logic_gate')
  ) then
    raise exception 'STOP: Process Map placement has no matching Company Explorer Folder or Process';
  end if;
end $$;

create temporary table process_map_actual_layout (
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
  folder_columns integer not null default 0,
  process_columns integer not null default 0,
  folder_section_width bigint not null default 0,
  folder_section_height bigint not null default 0,
  process_section_width bigint not null default 0,
  process_section_height bigint not null default 0,
  layout_column integer not null default 0,
  layout_row integer not null default 0,
  primary key(company_id,resource_type,resource_id)
) on commit drop;

insert into process_map_actual_layout(
  company_id,resource_type,resource_id,parent_folder_id,depth,
  sort_position,sort_timestamp,sort_id,grid_width,grid_height
)
select folder.company_id,'company_explorer_folder',folder.folder_id,folder.parent_folder_id,depth.depth,
       folder.position,folder.created_timestamp,folder.folder_id,
       greatest(placement.grid_width,case when depth.depth=0 then 32 else 24 end)::bigint,
       greatest(placement.grid_height,case when depth.depth=0 then 24 else 16 end)::bigint
from company_explorer_folders folder
join process_map_actual_folder_depth depth
  on depth.company_id=folder.company_id and depth.folder_id=folder.folder_id
join process_map_placements placement
  on placement.company_id=folder.company_id
 and placement.resource_type='company_explorer_folder'
 and placement.resource_id=folder.folder_id;

insert into process_map_actual_layout(
  company_id,resource_type,resource_id,parent_folder_id,depth,
  sort_position,sort_timestamp,sort_id,grid_width,grid_height
)
select item.company_id,'logic_gate',item.target_id,item.parent_folder_id,
       case when item.parent_folder_id is null then 0 else parent.depth+1 end,
       item.position,item.created_timestamp,item.item_id,
       placement.grid_width::bigint,placement.grid_height::bigint
from company_explorer_items item
left join process_map_actual_folder_depth parent
  on parent.company_id=item.company_id and parent.folder_id=item.parent_folder_id
join process_map_placements placement
  on placement.company_id=item.company_id
 and placement.resource_type='logic_gate'
 and placement.resource_id=item.target_id
where item.target_type='logic_gate';

create index process_map_actual_layout_parent_idx
  on process_map_actual_layout(company_id,parent_folder_id,resource_type,sort_position,sort_timestamp,sort_id);
create index process_map_actual_layout_depth_idx
  on process_map_actual_layout(depth,resource_type,company_id,resource_id);

do $$
begin
  if exists (
    select 1
    from process_map_placements placement
    where placement.grid_x < -1000000000
       or placement.grid_y < -1000000000
       or placement.grid_width < 1
       or placement.grid_width > 1000000
       or placement.grid_height < 1
       or placement.grid_height > 1000000
       or placement.grid_x::bigint+placement.grid_width > 1000000000
       or placement.grid_y::bigint+placement.grid_height > 1000000000
  ) then
    raise exception 'STOP: Process Map contains invalid persisted geometry';
  end if;

  if exists (
    select 1
    from process_map_actual_layout layout
    join process_map_placements placement
      on placement.company_id=layout.company_id
     and placement.resource_type=layout.resource_type
     and placement.resource_id=layout.resource_id
    where placement.map_parent_folder_id is distinct from layout.parent_folder_id
  ) then
    raise exception 'STOP: Process Map parentage is not synchronized with Company Explorer';
  end if;
end $$;

-- Size each Folder bottom-up. Each section evaluates at most seven candidates
-- around the actual-size square estimate, so work stays bounded per child.
do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((
    select max(depth)
    from process_map_actual_layout
    where resource_type='company_explorer_folder'
  ),0);
begin
  for current_depth in reverse maximum_depth..0 loop
    with parents as (
      select parent.company_id,parent.resource_id,parent.grid_width,parent.grid_height,
             count(child.resource_id) filter(where child.resource_type='company_explorer_folder')::integer folder_count,
             count(child.resource_id) filter(where child.resource_type='logic_gate')::integer process_count
      from process_map_actual_layout parent
      left join process_map_actual_layout child
        on child.company_id=parent.company_id and child.parent_folder_id=parent.resource_id
      where parent.resource_type='company_explorer_folder' and parent.depth=current_depth
      group by parent.company_id,parent.resource_id,parent.grid_width,parent.grid_height
    ),
    ranked as (
      select child.company_id,child.parent_folder_id,child.resource_type,
             child.grid_width,child.grid_height,
             (row_number() over(
               partition by child.company_id,child.parent_folder_id,child.resource_type
               order by child.sort_position,child.sort_timestamp,child.sort_id
             )-1)::integer child_index
      from process_map_actual_layout child
      join parents parent
        on parent.company_id=child.company_id and parent.resource_id=child.parent_folder_id
    ),
    section_stats as (
      select company_id,parent_folder_id,resource_type,count(*)::integer child_count,
             avg(grid_width::numeric) average_width,
             avg(grid_height::numeric) average_height
      from ranked
      group by company_id,parent_folder_id,resource_type
    ),
    section_options as (
      select distinct stats.company_id,stats.parent_folder_id,stats.resource_type,
             greatest(1,least(stats.child_count,
               round(sqrt(stats.child_count::numeric*stats.average_height/greatest(stats.average_width,1)))::integer
               + candidate.delta
             ))::integer columns
      from section_stats stats
      cross join (values(-3),(-2),(-1),(0),(1),(2),(3)) candidate(delta)
    ),
    cells as (
      select option.company_id,option.parent_folder_id,option.resource_type,option.columns,
             ranked.grid_width,ranked.grid_height,
             ranked.child_index%option.columns column_index,
             ranked.child_index/option.columns row_index
      from section_options option
      join ranked
        on ranked.company_id=option.company_id
       and ranked.parent_folder_id=option.parent_folder_id
       and ranked.resource_type=option.resource_type
    ),
    column_widths as (
      select company_id,parent_folder_id,resource_type,columns,column_index,max(grid_width) column_width
      from cells
      group by company_id,parent_folder_id,resource_type,columns,column_index
    ),
    candidate_widths as (
      select company_id,parent_folder_id,resource_type,columns,
             sum(column_width)+greatest(count(*)-1,0)*2 section_width
      from column_widths
      group by company_id,parent_folder_id,resource_type,columns
    ),
    row_heights as (
      select company_id,parent_folder_id,resource_type,columns,row_index,max(grid_height) row_height
      from cells
      group by company_id,parent_folder_id,resource_type,columns,row_index
    ),
    candidate_heights as (
      select company_id,parent_folder_id,resource_type,columns,
             sum(row_height)+greatest(count(*)-1,0)*2 section_height
      from row_heights
      group by company_id,parent_folder_id,resource_type,columns
    ),
    section_candidates as (
      select width.company_id,width.parent_folder_id,width.resource_type,width.columns,
             width.section_width::bigint,height.section_height::bigint
      from candidate_widths width
      join candidate_heights height
        on height.company_id=width.company_id
       and height.parent_folder_id=width.parent_folder_id
       and height.resource_type=width.resource_type
       and height.columns=width.columns
    ),
    folder_candidates as (
      select parent.company_id,parent.resource_id parent_folder_id,0::integer columns,0::bigint section_width,0::bigint section_height
      from parents parent where parent.folder_count=0
      union all
      select company_id,parent_folder_id,columns,section_width,section_height
      from section_candidates where resource_type='company_explorer_folder'
    ),
    process_candidates as (
      select parent.company_id,parent.resource_id parent_folder_id,0::integer columns,0::bigint section_width,0::bigint section_height
      from parents parent where parent.process_count=0
      union all
      select company_id,parent_folder_id,columns,section_width,section_height
      from section_candidates where resource_type='logic_gate'
    ),
    candidate_dimensions as (
      select parent.company_id,parent.resource_id,parent.folder_count,parent.process_count,
             folder.columns folder_columns,folder.section_width folder_width,folder.section_height folder_height,
             process.columns process_columns,process.section_width process_width,process.section_height process_height,
             case
               when parent.folder_count>0 and parent.process_count>0 then 2+folder.section_width+4+process.section_width+2
               when parent.folder_count>0 then 2+folder.section_width+2
               when parent.process_count>0 then 2+process.section_width+2
               else 0
             end::bigint required_width,
             case when parent.folder_count+parent.process_count>0
               then 6+greatest(folder.section_height,process.section_height)+2
               else 0
             end::bigint required_height,
             greatest(parent.grid_width,
               case
                 when parent.folder_count>0 and parent.process_count>0 then 2+folder.section_width+4+process.section_width+2
                 when parent.folder_count>0 then 2+folder.section_width+2
                 when parent.process_count>0 then 2+process.section_width+2
                 else parent.grid_width
               end
             )::bigint candidate_width,
             greatest(parent.grid_height,
               case when parent.folder_count+parent.process_count>0
                 then 6+greatest(folder.section_height,process.section_height)+2
                 else parent.grid_height
               end
             )::bigint candidate_height
      from parents parent
      join folder_candidates folder
        on folder.company_id=parent.company_id and folder.parent_folder_id=parent.resource_id
      join process_candidates process
        on process.company_id=parent.company_id and process.parent_folder_id=parent.resource_id
    ),
    ranked_candidates as (
      select candidate.*,
             row_number() over(
               partition by candidate.company_id,candidate.resource_id
               order by
                 case when greatest(candidate.required_width,candidate.required_height)::numeric
                                > 2*least(candidate.required_width,candidate.required_height)::numeric then 1 else 0 end,
                 greatest(
                   case when candidate.folder_count>1 then greatest(candidate.folder_width,candidate.folder_height)::numeric/greatest(least(candidate.folder_width,candidate.folder_height),1)::numeric else 1 end,
                   case when candidate.process_count>1 then greatest(candidate.process_width,candidate.process_height)::numeric/greatest(least(candidate.process_width,candidate.process_height),1)::numeric else 1 end
                 ),
                 greatest(candidate.required_width,candidate.required_height),
                 abs(candidate.required_width-candidate.required_height),
                 candidate.required_width::numeric*candidate.required_height::numeric,
                 candidate.folder_columns,candidate.process_columns
             ) candidate_rank
      from candidate_dimensions candidate
    )
    update process_map_actual_layout parent
    set folder_columns=candidate.folder_columns,
        process_columns=candidate.process_columns,
        folder_section_width=candidate.folder_width,
        folder_section_height=candidate.folder_height,
        process_section_width=candidate.process_width,
        process_section_height=candidate.process_height,
        grid_width=candidate.candidate_width,
        grid_height=candidate.candidate_height
    from ranked_candidates candidate
    where candidate.candidate_rank=1
      and parent.company_id=candidate.company_id
      and parent.resource_type='company_explorer_folder'
      and parent.resource_id=candidate.resource_id;
  end loop;
end $$;

create temporary table process_map_actual_root_choice (
  company_id uuid primary key,
  folder_columns integer not null,
  process_columns integer not null,
  folder_section_width bigint not null,
  folder_section_height bigint not null,
  process_section_width bigint not null,
  process_section_height bigint not null
) on commit drop;

insert into process_map_actual_root_choice(
  company_id,folder_columns,process_columns,
  folder_section_width,folder_section_height,process_section_width,process_section_height
)
with ranked as (
  select root.company_id,root.resource_type,root.grid_width,root.grid_height,
         (row_number() over(
           partition by root.company_id,root.resource_type
           order by root.sort_position,root.sort_timestamp,root.sort_id
         )-1)::integer child_index
  from process_map_actual_layout root
  where root.parent_folder_id is null
),
companies as (
  select company_id,
         count(*) filter(where resource_type='company_explorer_folder')::integer folder_count,
         count(*) filter(where resource_type='logic_gate')::integer process_count
  from ranked group by company_id
),
section_stats as (
  select company_id,resource_type,count(*)::integer child_count,
         avg(grid_width::numeric) average_width,avg(grid_height::numeric) average_height
  from ranked group by company_id,resource_type
),
section_options as (
  select distinct stats.company_id,stats.resource_type,
         greatest(1,least(stats.child_count,
           round(sqrt(stats.child_count::numeric*stats.average_height/greatest(stats.average_width,1)))::integer
           + candidate.delta
         ))::integer columns
  from section_stats stats
  cross join (values(-3),(-2),(-1),(0),(1),(2),(3)) candidate(delta)
),
cells as (
  select option.company_id,option.resource_type,option.columns,ranked.grid_width,ranked.grid_height,
         ranked.child_index%option.columns column_index,ranked.child_index/option.columns row_index
  from section_options option
  join ranked using(company_id,resource_type)
),
column_widths as (
  select company_id,resource_type,columns,column_index,max(grid_width) column_width
  from cells group by company_id,resource_type,columns,column_index
),
candidate_widths as (
  select company_id,resource_type,columns,
         sum(column_width)+greatest(count(*)-1,0)*8 section_width
  from column_widths group by company_id,resource_type,columns
),
row_heights as (
  select company_id,resource_type,columns,row_index,max(grid_height) row_height
  from cells group by company_id,resource_type,columns,row_index
),
candidate_heights as (
  select company_id,resource_type,columns,
         sum(row_height)+greatest(count(*)-1,0)*8 section_height
  from row_heights group by company_id,resource_type,columns
),
section_candidates as (
  select width.company_id,width.resource_type,width.columns,
         width.section_width::bigint,height.section_height::bigint
  from candidate_widths width
  join candidate_heights height using(company_id,resource_type,columns)
),
folder_candidates as (
  select company.company_id,0::integer columns,0::bigint section_width,0::bigint section_height
  from companies company where company.folder_count=0
  union all
  select company_id,columns,section_width,section_height
  from section_candidates where resource_type='company_explorer_folder'
),
process_candidates as (
  select company.company_id,0::integer columns,0::bigint section_width,0::bigint section_height
  from companies company where company.process_count=0
  union all
  select company_id,columns,section_width,section_height
  from section_candidates where resource_type='logic_gate'
),
candidate_dimensions as (
  select company.company_id,company.folder_count,company.process_count,
         folder.columns folder_columns,folder.section_width folder_width,folder.section_height folder_height,
         process.columns process_columns,process.section_width process_width,process.section_height process_height,
         case when company.folder_count>0 and company.process_count>0
                then folder.section_width+8+process.section_width
              when company.folder_count>0 then folder.section_width
              else process.section_width end footprint_width,
         greatest(folder.section_height,process.section_height) footprint_height
  from companies company
  join folder_candidates folder using(company_id)
  join process_candidates process using(company_id)
),
ranked_candidates as (
  select candidate.*,
         row_number() over(
           partition by candidate.company_id
           order by
             case when greatest(candidate.footprint_width,candidate.footprint_height)::numeric
                            > 2*least(candidate.footprint_width,candidate.footprint_height)::numeric then 1 else 0 end,
             greatest(
               case when candidate.folder_count>1 then greatest(candidate.folder_width,candidate.folder_height)::numeric/greatest(least(candidate.folder_width,candidate.folder_height),1)::numeric else 1 end,
               case when candidate.process_count>1 then greatest(candidate.process_width,candidate.process_height)::numeric/greatest(least(candidate.process_width,candidate.process_height),1)::numeric else 1 end
             ),
             greatest(candidate.footprint_width,candidate.footprint_height),
             abs(candidate.footprint_width-candidate.footprint_height),
             candidate.footprint_width::numeric*candidate.footprint_height::numeric,
             candidate.folder_columns,candidate.process_columns
         ) candidate_rank
  from candidate_dimensions candidate
)
select company_id,folder_columns,process_columns,
       folder_width,folder_height,process_width,process_height
from ranked_candidates
where candidate_rank=1;

with ranked as (
  select root.company_id,root.resource_type,root.resource_id,root.grid_width,root.grid_height,
         (row_number() over(
           partition by root.company_id,root.resource_type
           order by root.sort_position,root.sort_timestamp,root.sort_id
         )-1)::integer child_index
  from process_map_actual_layout root
  where root.parent_folder_id is null
),
cells as (
  select ranked.*,
         case when ranked.resource_type='company_explorer_folder' then choice.folder_columns else choice.process_columns end columns,
         case when ranked.resource_type='logic_gate' and choice.folder_section_width>0
                then choice.folder_section_width+8 else 0 end section_x
  from ranked
  join process_map_actual_root_choice choice using(company_id)
),
indexed_cells as (
  select cell.*,cell.child_index%cell.columns column_index,cell.child_index/cell.columns row_index
  from cells cell
),
column_widths as (
  select company_id,resource_type,column_index,max(grid_width) column_width
  from indexed_cells group by company_id,resource_type,column_index
),
column_offsets as (
  select company_id,resource_type,column_index,
         coalesce(sum(column_width+8) over(
           partition by company_id,resource_type order by column_index
           rows between unbounded preceding and 1 preceding
         ),0) column_offset
  from column_widths
),
row_heights as (
  select company_id,resource_type,row_index,max(grid_height) row_height
  from indexed_cells group by company_id,resource_type,row_index
),
row_offsets as (
  select company_id,resource_type,row_index,
         coalesce(sum(row_height+8) over(
           partition by company_id,resource_type order by row_index
           rows between unbounded preceding and 1 preceding
         ),0) row_offset
  from row_heights
),
positions as (
  select cell.company_id,cell.resource_type,cell.resource_id,
         cell.section_x+column_position.column_offset next_x,row_position.row_offset next_y,
         cell.column_index,cell.row_index
  from indexed_cells cell
  join column_offsets column_position using(company_id,resource_type,column_index)
  join row_offsets row_position using(company_id,resource_type,row_index)
)
update process_map_actual_layout layout
set grid_x=position.next_x,grid_y=position.next_y,
    layout_column=position.column_index,layout_row=position.row_index
from positions position
where layout.company_id=position.company_id
  and layout.resource_type=position.resource_type
  and layout.resource_id=position.resource_id;

-- Position every descendant level with one indexed traversal per depth.
do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((select max(depth) from process_map_actual_layout),0);
begin
  if maximum_depth>0 then
    for current_depth in 1..maximum_depth loop
      with ranked as (
        select child.company_id,child.resource_type,child.resource_id,child.parent_folder_id,
               child.grid_width,child.grid_height,parent.grid_x parent_x,parent.grid_y parent_y,
               parent.folder_section_width,
               case when child.resource_type='company_explorer_folder' then parent.folder_columns else parent.process_columns end columns,
               (row_number() over(
                 partition by child.company_id,child.parent_folder_id,child.resource_type
                 order by child.sort_position,child.sort_timestamp,child.sort_id
               )-1)::integer child_index
        from process_map_actual_layout child
        join process_map_actual_layout parent
          on parent.company_id=child.company_id
         and parent.resource_type='company_explorer_folder'
         and parent.resource_id=child.parent_folder_id
        where child.depth=current_depth
      ),
      cells as (
        select ranked.*,ranked.child_index%ranked.columns column_index,
               ranked.child_index/ranked.columns row_index
        from ranked
      ),
      column_widths as (
        select company_id,parent_folder_id,resource_type,column_index,max(grid_width) column_width
        from cells group by company_id,parent_folder_id,resource_type,column_index
      ),
      column_offsets as (
        select company_id,parent_folder_id,resource_type,column_index,
               coalesce(sum(column_width+2) over(
                 partition by company_id,parent_folder_id,resource_type order by column_index
                 rows between unbounded preceding and 1 preceding
               ),0) column_offset
        from column_widths
      ),
      row_heights as (
        select company_id,parent_folder_id,resource_type,row_index,max(grid_height) row_height
        from cells group by company_id,parent_folder_id,resource_type,row_index
      ),
      row_offsets as (
        select company_id,parent_folder_id,resource_type,row_index,
               coalesce(sum(row_height+2) over(
                 partition by company_id,parent_folder_id,resource_type order by row_index
                 rows between unbounded preceding and 1 preceding
               ),0) row_offset
        from row_heights
      ),
      positions as (
        select cell.company_id,cell.resource_type,cell.resource_id,
               cell.parent_x+2
                 + case when cell.resource_type='logic_gate' and cell.folder_section_width>0
                          then cell.folder_section_width+4 else 0 end
                 + column_position.column_offset next_x,
               cell.parent_y+6+row_position.row_offset next_y,
               cell.column_index,cell.row_index
        from cells cell
        join column_offsets column_position using(company_id,parent_folder_id,resource_type,column_index)
        join row_offsets row_position using(company_id,parent_folder_id,resource_type,row_index)
      )
      update process_map_actual_layout layout
      set grid_x=position.next_x,grid_y=position.next_y,
          layout_column=position.column_index,layout_row=position.row_index
      from positions position
      where layout.company_id=position.company_id
        and layout.resource_type=position.resource_type
        and layout.resource_id=position.resource_id;
    end loop;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from process_map_actual_layout layout
    where layout.grid_x < -1000000000 or layout.grid_y < -1000000000
       or layout.grid_width < 1 or layout.grid_width > 1000000
       or layout.grid_height < 1 or layout.grid_height > 1000000
       or layout.grid_x+layout.grid_width > 1000000000
       or layout.grid_y+layout.grid_height > 1000000000
  ) then
    raise exception 'STOP: Process Map actual-size layout exceeds supported geometry bounds';
  end if;

  if exists (
    select 1
    from process_map_actual_layout child
    join process_map_actual_layout parent
      on parent.company_id=child.company_id
     and parent.resource_type='company_explorer_folder'
     and parent.resource_id=child.parent_folder_id
    where child.grid_x<parent.grid_x+2
       or child.grid_y<parent.grid_y+6
       or child.grid_x+child.grid_width>parent.grid_x+parent.grid_width-2
       or child.grid_y+child.grid_height>parent.grid_y+parent.grid_height-2
  ) then
    raise exception 'STOP: Process Map actual-size layout failed Folder containment validation';
  end if;

  if exists (
    select 1
    from process_map_actual_layout layout
    group by layout.company_id,layout.parent_folder_id,layout.resource_type,layout.layout_column,layout.layout_row
    having count(*)>1
  ) then
    raise exception 'STOP: Process Map actual-size layout assigned duplicate section cells';
  end if;

  if exists (
    with column_bands as (
      select company_id,parent_folder_id,resource_type,layout_column,
             min(grid_x) band_left,max(grid_x+grid_width) band_right
      from process_map_actual_layout
      group by company_id,parent_folder_id,resource_type,layout_column
    ), ordered as (
      select band.*,
             lag(band_right) over(
               partition by company_id,parent_folder_id,resource_type order by layout_column
             ) previous_right
      from column_bands band
    )
    select 1 from ordered where previous_right is not null and previous_right>band_left
  ) or exists (
    with row_bands as (
      select company_id,parent_folder_id,resource_type,layout_row,
             min(grid_y) band_top,max(grid_y+grid_height) band_bottom
      from process_map_actual_layout
      group by company_id,parent_folder_id,resource_type,layout_row
    ), ordered as (
      select band.*,
             lag(band_bottom) over(
               partition by company_id,parent_folder_id,resource_type order by layout_row
             ) previous_bottom
      from row_bands band
    )
    select 1 from ordered where previous_bottom is not null and previous_bottom>band_top
  ) then
    raise exception 'STOP: Process Map actual-size layout produced overlapping section bands';
  end if;

  if exists (
    with sections as (
      select company_id,parent_folder_id,
             max(grid_x+grid_width) filter(where resource_type='company_explorer_folder') folder_right,
             min(grid_x) filter(where resource_type='logic_gate') process_left
      from process_map_actual_layout
      group by company_id,parent_folder_id
    )
    select 1 from sections
    where folder_right is not null and process_left is not null and folder_right>process_left
  ) then
    raise exception 'STOP: Process Map actual-size layout failed Folder-left Process-right section validation';
  end if;
end $$;

create temporary table process_map_actual_eligible_companies (
  company_id uuid primary key
) on commit drop;
create temporary table process_map_actual_affected_companies (
  company_id uuid primary key
) on commit drop;

insert into process_map_actual_eligible_companies(company_id)
select distinct company_id from process_map_actual_layout;

insert into process_map_actual_affected_companies(company_id)
select distinct layout.company_id
from process_map_actual_layout layout
join process_map_placements placement
  on placement.company_id=layout.company_id
 and placement.resource_type=layout.resource_type
 and placement.resource_id=layout.resource_id
where placement.grid_x::bigint is distinct from layout.grid_x
   or placement.grid_y::bigint is distinct from layout.grid_y
   or placement.grid_width::bigint is distinct from layout.grid_width
   or placement.grid_height::bigint is distinct from layout.grid_height;

-- Keep one durable exact placement before-image plus one per-company
-- recovery record. A successful compensating rollback retains both as audit
-- evidence and marks the company rolled back.
create table if not exists process_map_actual_size_layout_recovery_placements (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  placement_incarnation_token uuid not null,
  map_parent_folder_id uuid,
  before_grid_x integer not null,
  before_grid_y integer not null,
  before_grid_width integer not null,
  before_grid_height integer not null,
  before_revision bigint not null,
  before_created_timestamp timestamp with time zone not null,
  before_updated_timestamp timestamp with time zone not null,
  expected_grid_x integer not null,
  expected_grid_y integer not null,
  expected_grid_width integer not null,
  expected_grid_height integer not null,
  expected_revision bigint not null,
  expected_created_timestamp timestamp with time zone not null,
  expected_updated_timestamp timestamp with time zone not null,
  changed_by_migration boolean not null,
  constraint process_map_actual_size_layout_recovery_placements_pkey
    primary key(company_id,resource_type,resource_id)
);

create table if not exists process_map_actual_size_layout_recovery_runs (
  company_id uuid primary key,
  recovery_key text not null,
  format_version integer not null,
  status text not null,
  marker_event_id uuid not null,
  marker_sequence bigint not null,
  marker_created_timestamp timestamp with time zone not null,
  placement_count bigint not null,
  changed_placement_count bigint not null,
  placement_checksum text not null,
  created_timestamp timestamp with time zone not null,
  rollback_event_id uuid,
  rollback_sequence bigint,
  rolled_back_timestamp timestamp with time zone,
  constraint pm_actual_size_recovery_runs_format_chk check(format_version=1),
  constraint pm_actual_size_recovery_runs_status_chk check(status in ('applied','rolled_back')),
  constraint pm_actual_size_recovery_runs_counts_chk
    check(placement_count>=0 and changed_placement_count>=0 and changed_placement_count<=placement_count),
  constraint pm_actual_size_recovery_runs_rollback_state_chk
    check((status='applied' and rollback_event_id is null and rollback_sequence is null and rolled_back_timestamp is null)
       or (status='rolled_back' and rollback_event_id is not null and rollback_sequence is not null and rolled_back_timestamp is not null))
);

lock table process_map_actual_size_layout_recovery_placements,
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

create temporary table process_map_actual_recovery_mode (
  first_run boolean not null
) on commit drop;

insert into process_map_actual_recovery_mode(first_run)
select not exists(select 1 from process_map_actual_size_layout_recovery_runs);

do $$
declare
  first_run boolean;
begin
  select mode.first_run into strict first_run
  from process_map_actual_recovery_mode mode;

  if first_run then
    if exists(select 1 from process_map_actual_size_layout_recovery_placements) then
      raise exception 'STOP: Process Map actual-size recovery snapshot exists without run metadata';
    end if;
    if exists (
      select 1 from domain_events
      where idempotency_key='migration:20260826-process-map-actual-size-square-layout'
    ) then
      raise exception 'STOP: Process Map actual-size marker exists without required recovery metadata';
    end if;
    if exists (
      select 1 from schema_migrations
      where version='20260826_zzzy_process_map_actual_size_square_layout.sql'
    ) then
      raise exception 'STOP: Process Map actual-size migration is already recorded without recovery metadata; refusing direct replay after rollback';
    end if;
  else
    if exists (
      select 1 from process_map_actual_size_layout_recovery_runs
      where format_version<>1 or status='rolled_back'
    ) then
      raise exception 'STOP: Process Map actual-size migration was already rolled back; refusing direct replay';
    end if;
    if exists (
      (select company_id from process_map_actual_eligible_companies
       except
       select company_id from process_map_actual_size_layout_recovery_runs)
      union all
      (select company_id from process_map_actual_size_layout_recovery_runs
       except
       select company_id from process_map_actual_eligible_companies)
    ) then
      raise exception 'STOP: Process Map actual-size recovery company membership is missing or corrupt';
    end if;
    if exists (
      select 1
      from process_map_actual_size_layout_recovery_runs run
      where run.status<>'applied'
         or run.placement_count<>(
           select count(*) from process_map_actual_size_layout_recovery_placements snapshot
           where snapshot.company_id=run.company_id
         )
         or run.changed_placement_count<>(
           select count(*) from process_map_actual_size_layout_recovery_placements snapshot
           where snapshot.company_id=run.company_id and snapshot.changed_by_migration
         )
         or run.placement_checksum is distinct from (
           select md5(coalesce(jsonb_agg(to_jsonb(snapshot) order by resource_type,resource_id)::text,'[]'))
           from process_map_actual_size_layout_recovery_placements snapshot
           where snapshot.company_id=run.company_id
         )
    ) then
      raise exception 'STOP: Process Map actual-size recovery snapshot is missing or corrupt';
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
          select 1 from process_map_actual_size_layout_recovery_placements snapshot
          where snapshot.company_id=placement.company_id
            and snapshot.resource_type=placement.resource_type
            and snapshot.resource_id=placement.resource_id
        )
    ) then
      raise exception 'STOP: Process Map actual-size expected placement state changed after migration';
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
      raise exception 'STOP: Process Map actual-size Explorer membership or parentage changed after migration';
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
      raise exception 'STOP: Process Map relevant event state changed after actual-size migration';
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
      raise exception 'STOP: Process Map actual-size read-version state changed after migration';
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
      raise exception 'STOP: Process Map actual-size replay-safety ledger state changed after migration';
    end if;
  end if;
end $$;

insert into process_map_actual_size_layout_recovery_placements(
  company_id,resource_type,resource_id,placement_incarnation_token,map_parent_folder_id,
  before_grid_x,before_grid_y,before_grid_width,before_grid_height,before_revision,
  before_created_timestamp,before_updated_timestamp,
  expected_grid_x,expected_grid_y,expected_grid_width,expected_grid_height,expected_revision,
  expected_created_timestamp,expected_updated_timestamp,changed_by_migration
)
select placement.company_id,placement.resource_type,placement.resource_id,
       placement.placement_incarnation_token,placement.map_parent_folder_id,
       placement.grid_x,placement.grid_y,placement.grid_width,placement.grid_height,placement.revision,
       placement.created_timestamp,placement.updated_timestamp,
       placement.grid_x,placement.grid_y,placement.grid_width,placement.grid_height,placement.revision,
       placement.created_timestamp,placement.updated_timestamp,false
from process_map_placements placement
join process_map_actual_eligible_companies company using(company_id)
join process_map_actual_recovery_mode mode on mode.first_run;

do $$
begin
  if exists (
    select 1
    from process_map_actual_eligible_companies company
    join domain_events marker
      on marker.company_id=company.company_id
     and marker.idempotency_key='migration:20260826-process-map-actual-size-square-layout'
    where marker.stream_type is distinct from 'workspace'
       or marker.stream_id is distinct from company.company_id::text
       or marker.event_type is distinct from 'process_map_placement_saved'
       or marker.payload->>'realtime_change_type' is distinct from 'process_map_actual_size_square_layout_applied'
  ) then
    raise exception 'STOP: Process Map actual-size layout marker key is already used by another event';
  end if;

  if exists (
    select 1
    from process_map_actual_affected_companies company
    join domain_events marker
      on marker.company_id=company.company_id
     and marker.stream_type='workspace'
     and marker.stream_id=company.company_id::text
     and marker.event_type='process_map_placement_saved'
     and marker.payload->>'realtime_change_type'='process_map_actual_size_square_layout_applied'
     and marker.idempotency_key='migration:20260826-process-map-actual-size-square-layout'
  ) then
    raise exception 'STOP: Process Map actual-size layout already ran; refusing to overwrite later manual geometry';
  end if;

  if exists (
    select 1
    from process_map_actual_layout layout
    join process_map_placements placement
      on placement.company_id=layout.company_id
     and placement.resource_type=layout.resource_type
     and placement.resource_id=layout.resource_id
    where placement.revision=9223372036854775807
      and (placement.grid_x::bigint is distinct from layout.grid_x
        or placement.grid_y::bigint is distinct from layout.grid_y
        or placement.grid_width::bigint is distinct from layout.grid_width
        or placement.grid_height::bigint is distinct from layout.grid_height)
  ) then
    raise exception 'STOP: Process Map actual-size layout cannot advance a maximum placement revision';
  end if;

  if exists (
    select 1
    from process_map_actual_eligible_companies company
    where greatest(
      coalesce((
        select max(event.sequence) from domain_events event
        where event.company_id=company.company_id
          and event.stream_type='workspace'
          and event.stream_id=company.company_id::text
      ),0),
      coalesce((
        select read_version.version from workspace_read_versions read_version
        where read_version.company_id=company.company_id
          and read_version.scope='process-map' and read_version.resource_key=''
      ),0),
      coalesce((
        select read_version.version from workspace_read_versions read_version
        where read_version.company_id=company.company_id
          and read_version.scope='workspace-snapshot:full' and read_version.resource_key=''
      ),0)
    )=9223372036854775807
      and not exists (
        select 1 from domain_events marker
        where marker.company_id=company.company_id
          and marker.idempotency_key='migration:20260826-process-map-actual-size-square-layout'
      )
  ) then
    raise exception 'STOP: Process Map actual-size layout cannot advance a maximum workspace event sequence';
  end if;
end $$;

update process_map_placements placement
set grid_x=layout.grid_x::integer,
    grid_y=layout.grid_y::integer,
    grid_width=layout.grid_width::integer,
    grid_height=layout.grid_height::integer,
    revision=placement.revision+1,
    updated_timestamp=statement_timestamp()
from process_map_actual_layout layout
where placement.company_id=layout.company_id
  and placement.resource_type=layout.resource_type
  and placement.resource_id=layout.resource_id
  and (placement.grid_x::bigint is distinct from layout.grid_x
    or placement.grid_y::bigint is distinct from layout.grid_y
    or placement.grid_width::bigint is distinct from layout.grid_width
    or placement.grid_height::bigint is distinct from layout.grid_height);

update process_map_actual_size_layout_recovery_placements snapshot
set expected_grid_x=placement.grid_x,
    expected_grid_y=placement.grid_y,
    expected_grid_width=placement.grid_width,
    expected_grid_height=placement.grid_height,
    expected_revision=placement.revision,
    expected_created_timestamp=placement.created_timestamp,
    expected_updated_timestamp=placement.updated_timestamp,
    changed_by_migration=(
      placement.grid_x is distinct from snapshot.before_grid_x
      or placement.grid_y is distinct from snapshot.before_grid_y
      or placement.grid_width is distinct from snapshot.before_grid_width
      or placement.grid_height is distinct from snapshot.before_grid_height
    )
from process_map_placements placement,process_map_actual_recovery_mode mode
where mode.first_run
  and placement.company_id=snapshot.company_id
  and placement.resource_type=snapshot.resource_type
  and placement.resource_id=snapshot.resource_id;

with company_sequence as (
  select company.company_id,
         greatest(
           coalesce((
             select max(event.sequence) from domain_events event
             where event.company_id=company.company_id
               and event.stream_type='workspace'
               and event.stream_id=company.company_id::text
           ),0),
           coalesce((
             select read_version.version from workspace_read_versions read_version
             where read_version.company_id=company.company_id
               and read_version.scope='process-map' and read_version.resource_key=''
           ),0),
           coalesce((
             select read_version.version from workspace_read_versions read_version
             where read_version.company_id=company.company_id
               and read_version.scope='workspace-snapshot:full' and read_version.resource_key=''
           ),0)
         ) maximum_sequence
  from process_map_actual_eligible_companies company
)
insert into domain_events(
  event_id,company_id,stream_type,stream_id,sequence,event_type,
  actor_user_id,idempotency_key,payload,created_timestamp
)
select gen_random_uuid(),company.company_id,'workspace',company.company_id::text,
       company.maximum_sequence+1,'process_map_placement_saved',null,
       'migration:20260826-process-map-actual-size-square-layout',
       jsonb_build_object('realtime_change_type','process_map_actual_size_square_layout_applied'),
       statement_timestamp()
from company_sequence company
cross join process_map_actual_recovery_mode mode
where mode.first_run and not exists (
  select 1 from domain_events marker
  where marker.company_id=company.company_id
    and marker.idempotency_key='migration:20260826-process-map-actual-size-square-layout'
);

do $$
begin
  if exists (
    select 1
    from process_map_actual_eligible_companies company
    cross join process_map_actual_recovery_mode mode
    left join domain_events marker
      on marker.company_id=company.company_id
     and marker.idempotency_key='migration:20260826-process-map-actual-size-square-layout'
    where mode.first_run
      and (marker.event_id is null
       or not exists (
         select 1 from workspace_read_versions read_version
         where read_version.company_id=company.company_id
           and read_version.scope='process-map' and read_version.resource_key=''
           and read_version.version=marker.sequence
       )
       or not exists (
         select 1 from workspace_read_versions read_version
         where read_version.company_id=company.company_id
           and read_version.scope='workspace-snapshot:full' and read_version.resource_key=''
           and read_version.version=marker.sequence
       ))
  ) then
    raise exception 'STOP: Process Map actual-size marker did not advance required read versions';
  end if;
end $$;

-- Keep the corrected row and all three obsolete-layout tombstones permanently.
-- The canonical runner's duplicate insert is harmless, while direct DBeaver
-- execution is now equally replay-safe.
insert into schema_migrations(version)
values
  ('20260826_zzzy_process_map_actual_size_square_layout.sql'),
  ('20260826_zzzz_process_map_tidy_initial_layout.sql'),
  ('20260826_zzzzz_process_map_rectangular_layout.sql'),
  ('20260826_zzzzzz_process_map_square_layout.sql')
on conflict(version) do nothing;

insert into process_map_actual_size_layout_recovery_runs(
  company_id,recovery_key,format_version,status,
  marker_event_id,marker_sequence,marker_created_timestamp,
  placement_count,changed_placement_count,placement_checksum,
  created_timestamp,rollback_event_id,rollback_sequence,rolled_back_timestamp
)
select company.company_id,
       'migration:20260826-process-map-actual-size-square-layout',1,'applied',
       marker.event_id,marker.sequence,marker.created_timestamp,
       (select count(*) from process_map_actual_size_layout_recovery_placements snapshot
        where snapshot.company_id=company.company_id),
       (select count(*) from process_map_actual_size_layout_recovery_placements snapshot
        where snapshot.company_id=company.company_id and snapshot.changed_by_migration),
       (select md5(coalesce(jsonb_agg(to_jsonb(snapshot) order by resource_type,resource_id)::text,'[]'))
        from process_map_actual_size_layout_recovery_placements snapshot
        where snapshot.company_id=company.company_id),
       statement_timestamp(),null,null,null
from process_map_actual_eligible_companies company
join process_map_actual_recovery_mode mode on mode.first_run
join domain_events marker
  on marker.company_id=company.company_id
 and marker.idempotency_key='migration:20260826-process-map-actual-size-square-layout';


commit;
