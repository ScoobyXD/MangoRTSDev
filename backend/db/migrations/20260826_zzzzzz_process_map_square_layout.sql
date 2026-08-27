-- Normalize existing Process Map geometry once into the square-biased layout.
-- Company Explorer remains the parent authority. Operational relationships and
-- trace routes are intentionally neither read nor changed.

begin;

lock table company_explorer_folders, company_explorer_items, logic_gates, process_map_placements, domain_events in share row exclusive mode;

do $$
begin
  raise notice 'Process Map square layout connected PostgreSQL server_version=% server_version_num=%',
    current_setting('server_version'),current_setting('server_version_num');
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: Process Map square layout requires PostgreSQL 17 or newer';
  end if;
end $$;

create temporary table process_map_square_folder_depth (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  depth integer not null,
  primary key(company_id,folder_id)
) on commit drop;

insert into process_map_square_folder_depth(company_id,folder_id,parent_folder_id,depth)
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
  ) or (select count(*) from process_map_square_folder_depth)
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
end $$;

create temporary table process_map_square_layout (
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
  primary key(company_id,resource_type,resource_id)
) on commit drop;

insert into process_map_square_layout(
  company_id,resource_type,resource_id,parent_folder_id,depth,
  sort_position,sort_timestamp,sort_id,grid_width,grid_height
)
select folder.company_id,'company_explorer_folder',folder.folder_id,folder.parent_folder_id,depth.depth,
       folder.position,folder.created_timestamp,folder.folder_id,
       case when depth.depth=0 then 32 else 24 end,
       case when depth.depth=0 then 24 else 16 end
from company_explorer_folders folder
join process_map_square_folder_depth depth
  on depth.company_id=folder.company_id and depth.folder_id=folder.folder_id;

insert into process_map_square_layout(
  company_id,resource_type,resource_id,parent_folder_id,depth,
  sort_position,sort_timestamp,sort_id,grid_width,grid_height
)
select item.company_id,'logic_gate',item.target_id,item.parent_folder_id,
       case when item.parent_folder_id is null then 0 else parent.depth+1 end,
       item.position,item.created_timestamp,item.item_id,14,8
from company_explorer_items item
left join process_map_square_folder_depth parent
  on parent.company_id=item.company_id and parent.folder_id=item.parent_folder_id
where item.target_type='logic_gate';

do $$
begin
  if exists (
    select 1
    from process_map_square_layout layout
    left join process_map_placements placement
      on placement.company_id=layout.company_id
     and placement.resource_type=layout.resource_type
     and placement.resource_id=layout.resource_id
    where placement.resource_id is null
  ) or exists (
    select 1
    from process_map_placements placement
    left join process_map_square_layout layout
      on layout.company_id=placement.company_id
     and layout.resource_type=placement.resource_type
     and layout.resource_id=placement.resource_id
    where layout.resource_id is null
  ) then
    raise exception 'STOP: Process Map placements do not exactly match current Company Explorer Process Map resources';
  end if;

  if exists (
    select 1
    from process_map_square_layout layout
    join process_map_placements placement
      on placement.company_id=layout.company_id
     and placement.resource_type=layout.resource_type
     and placement.resource_id=layout.resource_id
    where placement.map_parent_folder_id is distinct from layout.parent_folder_id
  ) then
    raise exception 'STOP: Process Map parentage is not synchronized with Company Explorer';
  end if;
end $$;

-- Size each Folder after its descendants are sized. Every possible Folder-grid
-- and Process-grid column count is measured from the real child rectangles. For
-- mixed parents, the two sections are scored together so a pair of individually
-- square sections cannot create one unnecessarily wide parent.
do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((
    select max(depth)
    from process_map_square_layout
    where resource_type='company_explorer_folder'
  ),0);
begin
  for current_depth in reverse maximum_depth..0 loop
    with parent_counts as (
      select parent.company_id,parent.resource_id,parent.grid_width,parent.grid_height,
             count(*) filter(where child.resource_type='company_explorer_folder')::integer folder_count,
             count(*) filter(where child.resource_type='logic_gate')::integer process_count
      from process_map_square_layout parent
      left join process_map_square_layout child
        on child.company_id=parent.company_id
       and child.parent_folder_id=parent.resource_id
      where parent.resource_type='company_explorer_folder'
        and parent.depth=current_depth
      group by parent.company_id,parent.resource_id,parent.grid_width,parent.grid_height
    ),
    folder_ranked as (
      select child.company_id,child.parent_folder_id,child.grid_width,child.grid_height,
             (row_number() over(
               partition by child.company_id,child.parent_folder_id
               order by child.sort_position,child.sort_timestamp,child.sort_id
             )-1)::integer child_index
      from process_map_square_layout child
      join parent_counts parent
        on parent.company_id=child.company_id and parent.resource_id=child.parent_folder_id
      where child.resource_type='company_explorer_folder'
    ),
    folder_column_options as (
      select parent.company_id,parent.resource_id parent_folder_id,0::integer folder_columns
      from parent_counts parent
      where parent.folder_count=0
      union all
      select parent.company_id,parent.resource_id,candidate.folder_columns
      from parent_counts parent
      cross join lateral generate_series(1,parent.folder_count) candidate(folder_columns)
      where parent.folder_count>0
    ),
    folder_cells as (
      select option.company_id,option.parent_folder_id,option.folder_columns,
             ranked.grid_width,ranked.grid_height,
             ranked.child_index%option.folder_columns column_index,
             ranked.child_index/option.folder_columns row_index
      from folder_column_options option
      join folder_ranked ranked
        on ranked.company_id=option.company_id and ranked.parent_folder_id=option.parent_folder_id
      where option.folder_columns>0
    ),
    folder_column_widths as (
      select company_id,parent_folder_id,folder_columns,column_index,max(grid_width) column_width
      from folder_cells
      group by company_id,parent_folder_id,folder_columns,column_index
    ),
    folder_candidate_widths as (
      select company_id,parent_folder_id,folder_columns,
             sum(column_width)+greatest(count(*)-1,0)*2 folder_width
      from folder_column_widths
      group by company_id,parent_folder_id,folder_columns
    ),
    folder_row_heights as (
      select company_id,parent_folder_id,folder_columns,row_index,max(grid_height) row_height
      from folder_cells
      group by company_id,parent_folder_id,folder_columns,row_index
    ),
    folder_candidate_heights as (
      select company_id,parent_folder_id,folder_columns,
             sum(row_height)+greatest(count(*)-1,0)*2 folder_height
      from folder_row_heights
      group by company_id,parent_folder_id,folder_columns
    ),
    folder_candidates as (
      select option.company_id,option.parent_folder_id,option.folder_columns,
             coalesce(widths.folder_width,0)::bigint folder_width,
             coalesce(heights.folder_height,0)::bigint folder_height
      from folder_column_options option
      left join folder_candidate_widths widths
        on widths.company_id=option.company_id
       and widths.parent_folder_id=option.parent_folder_id
       and widths.folder_columns=option.folder_columns
      left join folder_candidate_heights heights
        on heights.company_id=option.company_id
       and heights.parent_folder_id=option.parent_folder_id
       and heights.folder_columns=option.folder_columns
    ),
    process_ranked as (
      select child.company_id,child.parent_folder_id,child.grid_width,child.grid_height,
             (row_number() over(
               partition by child.company_id,child.parent_folder_id
               order by child.sort_position,child.sort_timestamp,child.sort_id
             )-1)::integer child_index
      from process_map_square_layout child
      join parent_counts parent
        on parent.company_id=child.company_id and parent.resource_id=child.parent_folder_id
      where child.resource_type='logic_gate'
    ),
    process_column_options as (
      select parent.company_id,parent.resource_id parent_folder_id,0::integer process_columns
      from parent_counts parent
      where parent.process_count=0
      union all
      select parent.company_id,parent.resource_id,candidate.process_columns
      from parent_counts parent
      cross join lateral generate_series(1,parent.process_count) candidate(process_columns)
      where parent.process_count>0
    ),
    process_cells as (
      select option.company_id,option.parent_folder_id,option.process_columns,
             ranked.grid_width,ranked.grid_height,
             ranked.child_index%option.process_columns column_index,
             ranked.child_index/option.process_columns row_index
      from process_column_options option
      join process_ranked ranked
        on ranked.company_id=option.company_id and ranked.parent_folder_id=option.parent_folder_id
      where option.process_columns>0
    ),
    process_column_widths as (
      select company_id,parent_folder_id,process_columns,column_index,max(grid_width) column_width
      from process_cells
      group by company_id,parent_folder_id,process_columns,column_index
    ),
    process_candidate_widths as (
      select company_id,parent_folder_id,process_columns,
             sum(column_width)+greatest(count(*)-1,0)*2 process_width
      from process_column_widths
      group by company_id,parent_folder_id,process_columns
    ),
    process_row_heights as (
      select company_id,parent_folder_id,process_columns,row_index,max(grid_height) row_height
      from process_cells
      group by company_id,parent_folder_id,process_columns,row_index
    ),
    process_candidate_heights as (
      select company_id,parent_folder_id,process_columns,
             sum(row_height)+greatest(count(*)-1,0)*2 process_height
      from process_row_heights
      group by company_id,parent_folder_id,process_columns
    ),
    process_candidates as (
      select option.company_id,option.parent_folder_id,option.process_columns,
             coalesce(widths.process_width,0)::bigint process_width,
             coalesce(heights.process_height,0)::bigint process_height
      from process_column_options option
      left join process_candidate_widths widths
        on widths.company_id=option.company_id
       and widths.parent_folder_id=option.parent_folder_id
       and widths.process_columns=option.process_columns
      left join process_candidate_heights heights
        on heights.company_id=option.company_id
       and heights.parent_folder_id=option.parent_folder_id
       and heights.process_columns=option.process_columns
    ),
    candidate_pairs as (
      select parent.company_id,parent.resource_id,parent.grid_width current_width,parent.grid_height current_height,
             parent.folder_count,parent.process_count,
             folder.folder_columns,folder.folder_width,folder.folder_height,
             process.process_columns,process.process_width,process.process_height
      from parent_counts parent
      join folder_candidates folder
        on folder.company_id=parent.company_id and folder.parent_folder_id=parent.resource_id
      join process_candidates process
        on process.company_id=parent.company_id and process.parent_folder_id=parent.resource_id
    ),
    candidate_dimensions as (
      select candidate.*,
             greatest(candidate.current_width,
               case
                 when candidate.folder_count>0 and candidate.process_count>0 then
                   2+candidate.folder_width+4+candidate.process_width+2
                 when candidate.folder_count>0 then 2+candidate.folder_width+2
                 when candidate.process_count>0 then 2+candidate.process_width+2
                 else candidate.current_width
               end
             )::bigint candidate_width,
             greatest(candidate.current_height,
               case
                 when candidate.folder_count+candidate.process_count>0 then
                   6+greatest(candidate.folder_height,candidate.process_height)+2
                 else candidate.current_height
               end
             )::bigint candidate_height
      from candidate_pairs candidate
    ),
    section_scored_candidates as (
      select candidate.*,
             (case
                when candidate.folder_count>=4
                 and (candidate.folder_columns=1
                   or (candidate.folder_count+candidate.folder_columns-1)/candidate.folder_columns=1)
                then 1 else 0
              end
             + case
                when candidate.process_count>=4
                 and (candidate.process_columns=1
                   or (candidate.process_count+candidate.process_columns-1)/candidate.process_columns=1)
                then 1 else 0
              end) line_section_count,
             (case
                when candidate.folder_count>1
                 and greatest(candidate.folder_width,candidate.folder_height)::numeric
                     > 2*least(candidate.folder_width,candidate.folder_height)::numeric
                then 1 else 0
              end
              + case
                when candidate.process_count>1
                 and greatest(candidate.process_width,candidate.process_height)::numeric
                     > 2*least(candidate.process_width,candidate.process_height)::numeric
                then 1 else 0
              end) tower_section_count,
             case
               when greatest(candidate.candidate_width,candidate.candidate_height)::numeric
                    > 2*least(candidate.candidate_width,candidate.candidate_height)::numeric
               then 1 else 0
             end parent_tower_count,
             greatest(
               case when candidate.folder_count>1 then
                 greatest(candidate.folder_width,candidate.folder_height)::numeric
                   / greatest(least(candidate.folder_width,candidate.folder_height),1)::numeric
               else 1::numeric end,
               case when candidate.process_count>1 then
                 greatest(candidate.process_width,candidate.process_height)::numeric
                   / greatest(least(candidate.process_width,candidate.process_height),1)::numeric
               else 1::numeric end
             ) worst_section_aspect
      from candidate_dimensions candidate
    ),
    ranked_candidates as (
      select candidate.*,
             row_number() over(
               partition by candidate.company_id,candidate.resource_id
               order by candidate.line_section_count,
                        candidate.tower_section_count,
                        candidate.parent_tower_count,
                        greatest(candidate.candidate_width,candidate.candidate_height),
                        candidate.worst_section_aspect,
                        abs(candidate.candidate_width-candidate.candidate_height),
                        candidate.candidate_width::numeric*candidate.candidate_height::numeric,
                        candidate.folder_columns,candidate.process_columns
             ) candidate_rank
      from section_scored_candidates candidate
    )
    update process_map_square_layout parent
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

-- Search every possible root column count with the real, fully-computed root
-- rectangles. Root-level Processes participate in the same search.
create temporary table process_map_square_root_choice (
  company_id uuid primary key,
  root_columns integer not null,
  footprint_width bigint not null,
  footprint_height bigint not null
) on commit drop;

insert into process_map_square_root_choice(company_id,root_columns,footprint_width,footprint_height)
with root_ranked as (
  select root.company_id,root.resource_type,root.resource_id,root.grid_width,root.grid_height,
         (row_number() over(
           partition by root.company_id
           order by root.sort_position,root.sort_timestamp,root.resource_type,root.sort_id
         )-1)::integer root_index
  from process_map_square_layout root
  where root.parent_folder_id is null
),
root_counts as (
  select company_id,count(*)::integer root_count
  from root_ranked
  group by company_id
),
root_options as (
  select count.company_id,candidate.root_columns
  from root_counts count
  cross join lateral generate_series(1,count.root_count) candidate(root_columns)
),
root_cells as (
  select option.company_id,option.root_columns,root.resource_type,root.resource_id,
         root.grid_width,root.grid_height,
         root.root_index%option.root_columns column_index,
         root.root_index/option.root_columns row_index
  from root_options option
  join root_ranked root on root.company_id=option.company_id
),
root_column_widths as (
  select company_id,root_columns,column_index,max(grid_width) column_width
  from root_cells
  group by company_id,root_columns,column_index
),
root_candidate_widths as (
  select company_id,root_columns,
         sum(column_width)+greatest(count(*)-1,0)*8 footprint_width
  from root_column_widths
  group by company_id,root_columns
),
root_row_heights as (
  select company_id,root_columns,row_index,max(grid_height) row_height
  from root_cells
  group by company_id,root_columns,row_index
),
root_candidate_heights as (
  select company_id,root_columns,
         sum(row_height)+greatest(count(*)-1,0)*8 footprint_height
  from root_row_heights
  group by company_id,root_columns
),
root_candidates as (
  select widths.company_id,widths.root_columns,widths.footprint_width,heights.footprint_height,
         row_number() over(
           partition by widths.company_id
           order by case
                      when counts.root_count>=4
                       and (widths.root_columns=1
                         or (counts.root_count+widths.root_columns-1)/widths.root_columns=1)
                      then 1 else 0
                    end,
                    case
                      when greatest(widths.footprint_width,heights.footprint_height)::numeric
                           > 2*least(widths.footprint_width,heights.footprint_height)::numeric
                      then 1 else 0
                    end,
                    greatest(widths.footprint_width,heights.footprint_height),
                    abs(widths.footprint_width-heights.footprint_height),
                    widths.footprint_width::numeric*heights.footprint_height::numeric,
                    widths.root_columns
         ) candidate_rank
  from root_candidate_widths widths
  join root_candidate_heights heights
    on heights.company_id=widths.company_id and heights.root_columns=widths.root_columns
  join root_counts counts on counts.company_id=widths.company_id
)
select company_id,root_columns,footprint_width,footprint_height
from root_candidates
where candidate_rank=1;

with root_ranked as (
  select root.company_id,root.resource_type,root.resource_id,root.grid_width,root.grid_height,
         (row_number() over(
           partition by root.company_id
           order by root.sort_position,root.sort_timestamp,root.resource_type,root.sort_id
         )-1)::integer root_index
  from process_map_square_layout root
  where root.parent_folder_id is null
),
root_cells as (
  select root.*,root.root_index%choice.root_columns column_index,
         root.root_index/choice.root_columns row_index
  from root_ranked root
  join process_map_square_root_choice choice using(company_id)
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
update process_map_square_layout layout
set grid_x=position.next_x,grid_y=position.next_y
from root_positions position
where layout.company_id=position.company_id
  and layout.resource_type=position.resource_type
  and layout.resource_id=position.resource_id;

-- Position each descendant level after its parents have been positioned.
do $$
declare
  current_depth integer;
  maximum_depth integer := coalesce((select max(depth) from process_map_square_layout),0);
begin
  if maximum_depth>0 then
    for current_depth in 1..maximum_depth loop
      with folder_ranked as (
        select child.company_id,child.resource_type,child.resource_id,child.parent_folder_id,
               child.grid_width,child.grid_height,
               parent.grid_x parent_x,parent.grid_y parent_y,parent.folder_columns,
               (row_number() over(
                 partition by child.company_id,child.parent_folder_id
                 order by child.sort_position,child.sort_timestamp,child.sort_id
               )-1)::integer child_index
        from process_map_square_layout child
        join process_map_square_layout parent
          on parent.company_id=child.company_id
         and parent.resource_type='company_explorer_folder'
         and parent.resource_id=child.parent_folder_id
        where child.resource_type='company_explorer_folder'
          and child.depth=current_depth
      ),
      folder_cells as (
        select ranked.*,
               ranked.child_index%ranked.folder_columns column_index,
               ranked.child_index/ranked.folder_columns row_index
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
      update process_map_square_layout layout
      set grid_x=position.next_x,grid_y=position.next_y
      from folder_positions position
      where layout.company_id=position.company_id
        and layout.resource_type=position.resource_type
        and layout.resource_id=position.resource_id;

      with process_ranked as (
        select child.company_id,child.resource_type,child.resource_id,child.parent_folder_id,
               child.grid_width,child.grid_height,
               parent.grid_x parent_x,parent.grid_y parent_y,
               parent.folder_section_width,parent.process_columns,
               case when parent.folder_section_width>0 then 4 else 0 end section_gap,
               (row_number() over(
                 partition by child.company_id,child.parent_folder_id
                 order by child.sort_position,child.sort_timestamp,child.sort_id
               )-1)::integer child_index
        from process_map_square_layout child
        join process_map_square_layout parent
          on parent.company_id=child.company_id
         and parent.resource_type='company_explorer_folder'
         and parent.resource_id=child.parent_folder_id
        where child.resource_type='logic_gate'
          and child.depth=current_depth
      ),
      process_cells as (
        select ranked.*,
               ranked.child_index%ranked.process_columns column_index,
               ranked.child_index/ranked.process_columns row_index
        from process_ranked ranked
      ),
      process_column_widths as (
        select company_id,parent_folder_id,column_index,max(grid_width) column_width
        from process_cells
        group by company_id,parent_folder_id,column_index
      ),
      process_row_heights as (
        select company_id,parent_folder_id,row_index,max(grid_height) row_height
        from process_cells
        group by company_id,parent_folder_id,row_index
      ),
      process_positions as (
        select cell.company_id,cell.resource_type,cell.resource_id,
               cell.parent_x+2+cell.folder_section_width+cell.section_gap+coalesce((
                 select sum(widths.column_width+2)
                 from process_column_widths widths
                 where widths.company_id=cell.company_id
                   and widths.parent_folder_id=cell.parent_folder_id
                   and widths.column_index<cell.column_index
               ),0) next_x,
               cell.parent_y+6+coalesce((
                 select sum(heights.row_height+2)
                 from process_row_heights heights
                 where heights.company_id=cell.company_id
                   and heights.parent_folder_id=cell.parent_folder_id
                   and heights.row_index<cell.row_index
               ),0) next_y
        from process_cells cell
      )
      update process_map_square_layout layout
      set grid_x=position.next_x,grid_y=position.next_y
      from process_positions position
      where layout.company_id=position.company_id
        and layout.resource_type=position.resource_type
        and layout.resource_id=position.resource_id;
    end loop;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from process_map_square_layout layout
    where layout.grid_x < -1000000000 or layout.grid_y < -1000000000
       or layout.grid_width < 1 or layout.grid_width > 1000000
       or layout.grid_height < 1 or layout.grid_height > 1000000
       or layout.grid_x+layout.grid_width > 1000000000
       or layout.grid_y+layout.grid_height > 1000000000
  ) then
    raise exception 'STOP: Process Map square layout exceeds supported geometry bounds';
  end if;

  if exists (
    select 1
    from process_map_square_layout child
    join process_map_square_layout parent
      on parent.company_id=child.company_id
     and parent.resource_type='company_explorer_folder'
     and parent.resource_id=child.parent_folder_id
    where child.grid_x<parent.grid_x+2
       or child.grid_y<parent.grid_y+6
       or child.grid_x+child.grid_width>parent.grid_x+parent.grid_width-2
       or child.grid_y+child.grid_height>parent.grid_y+parent.grid_height-2
  ) then
    raise exception 'STOP: Process Map square layout failed Folder containment validation';
  end if;

  if exists (
    select 1
    from process_map_square_layout first_item
    join process_map_square_layout second_item
      on second_item.company_id=first_item.company_id
     and second_item.parent_folder_id is not distinct from first_item.parent_folder_id
     and (second_item.resource_type,second_item.resource_id)>(first_item.resource_type,first_item.resource_id)
    where first_item.grid_x<second_item.grid_x+second_item.grid_width
      and first_item.grid_x+first_item.grid_width>second_item.grid_x
      and first_item.grid_y<second_item.grid_y+second_item.grid_height
      and first_item.grid_y+first_item.grid_height>second_item.grid_y
  ) then
    raise exception 'STOP: Process Map square layout produced overlapping siblings';
  end if;

  if exists (
    with sections as (
      select parent.company_id,parent.resource_id,
             max(child.grid_x+child.grid_width) filter(where child.resource_type='company_explorer_folder') folder_right,
             min(child.grid_x) filter(where child.resource_type='logic_gate') process_left
      from process_map_square_layout parent
      join process_map_square_layout child
        on child.company_id=parent.company_id and child.parent_folder_id=parent.resource_id
      where parent.resource_type='company_explorer_folder'
      group by parent.company_id,parent.resource_id
    )
    select 1
    from sections
    where folder_right is not null and process_left is not null
      and folder_right+4>process_left
  ) then
    raise exception 'STOP: Process Map square layout failed Folder-left Process-right section validation';
  end if;
end $$;

create temporary table process_map_square_eligible_companies (
  company_id uuid primary key
) on commit drop;

create temporary table process_map_square_affected_companies (
  company_id uuid primary key
) on commit drop;

insert into process_map_square_eligible_companies(company_id)
select distinct company_id
from process_map_square_layout;

insert into process_map_square_affected_companies(company_id)
select distinct layout.company_id
from process_map_square_layout layout
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
    from process_map_square_eligible_companies company
    join domain_events marker
      on marker.company_id=company.company_id
     and marker.idempotency_key='migration:20260826-process-map-square-layout'
    where marker.stream_type is distinct from 'workspace'
       or marker.stream_id is distinct from company.company_id::text
       or marker.event_type is distinct from 'process_map_placement_saved'
       or marker.payload->>'realtime_change_type' is distinct from 'process_map_square_layout_applied'
  ) then
    raise exception 'STOP: Process Map square layout marker key is already used by another event';
  end if;

  if exists (
    select 1
    from process_map_square_affected_companies company
    join domain_events marker
      on marker.company_id=company.company_id
     and marker.stream_type='workspace'
     and marker.stream_id=company.company_id::text
     and marker.event_type='process_map_placement_saved'
     and marker.payload->>'realtime_change_type'='process_map_square_layout_applied'
     and marker.idempotency_key='migration:20260826-process-map-square-layout'
  ) then
    raise exception 'STOP: Process Map square layout already ran; refusing to overwrite later manual geometry';
  end if;

  if exists (
    select 1
    from process_map_square_layout layout
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
    raise exception 'STOP: Process Map square layout cannot advance a maximum placement revision';
  end if;

  if exists (
    select 1
    from process_map_square_eligible_companies company
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
          and marker.idempotency_key='migration:20260826-process-map-square-layout'
      )
  ) then
    raise exception 'STOP: Process Map square layout cannot advance a maximum workspace event sequence';
  end if;
end $$;

update process_map_placements placement
set grid_x=layout.grid_x::integer,
    grid_y=layout.grid_y::integer,
    grid_width=layout.grid_width::integer,
    grid_height=layout.grid_height::integer,
    revision=placement.revision+1,
    updated_timestamp=statement_timestamp()
from process_map_square_layout layout
where placement.company_id=layout.company_id
  and placement.resource_type=layout.resource_type
  and placement.resource_id=layout.resource_id
  and (
    placement.grid_x::bigint is distinct from layout.grid_x
    or placement.grid_y::bigint is distinct from layout.grid_y
    or placement.grid_width::bigint is distinct from layout.grid_width
    or placement.grid_height::bigint is distinct from layout.grid_height
  );

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
       'migration:20260826-process-map-square-layout',
       jsonb_build_object('realtime_change_type','process_map_square_layout_applied'),
       statement_timestamp()
from process_map_square_eligible_companies company
where not exists (
  select 1
  from domain_events marker
  where marker.company_id=company.company_id
    and marker.idempotency_key='migration:20260826-process-map-square-layout'
);

commit;
