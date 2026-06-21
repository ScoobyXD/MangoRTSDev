-- Rebuild already-upgraded GVIC matrix projection rows into the flat My Work relationship shape.
-- This repairs databases that ran the first 20260621 migration before it rebuilt legacy rows.
delete from resource_gvic_assignments loser
using resource_gvic_assignments winner
where loser.resource_type in ('node', 'logic_gate')
  and winner.resource_type = loser.resource_type
  and winner.company_id = loser.company_id
  and winner.resource_id = loser.resource_id
  and winner.principal_type = loser.principal_type
  and winner.principal_id = loser.principal_id
  and (
    case winner.role
      when 'generated' then 1
      when 'verified' then 2
      when 'consulted' then 3
      when 'informed' then 4
      else 5
    end,
    winner.updated_timestamp,
    winner.created_timestamp,
    winner.ctid
  ) > (
    case loser.role
      when 'generated' then 1
      when 'verified' then 2
      when 'consulted' then 3
      when 'informed' then 4
      else 5
    end,
    loser.updated_timestamp,
    loser.created_timestamp,
    loser.ctid
  );

create unique index if not exists idx_resource_gvic_assignments_one_role_per_principal
  on resource_gvic_assignments(company_id, resource_type, resource_id, principal_type, principal_id)
  where resource_type in ('node', 'logic_gate');

delete from gvic_matrix_projection_table;

with latest_assignment as (
  select distinct on (assignment.company_id, assignment.node_id)
    assignment.*
  from node_logic_gate_assignments assignment
  order by
    assignment.company_id,
    assignment.node_id,
    assignment.updated_timestamp desc,
    assignment.created_timestamp desc,
    assignment.assignment_id desc
), node_rows as (
  select
    node.company_id,
    node.node_id,
    node.name as title,
    coalesce(
      case
        when assignment.is_issue then 'Issue'
        when assignment.assignment_id is not null then case
          when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('requested', 'request', 'requests', 'r') then 'Requested'
          when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('backlog', 'backlogs', 'b') then 'Backlogs'
          when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 'In Progress'
          when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) = 'review' then 'Review'
          when lower(replace(replace(trim(assignment.status_key), '_', ' '), '-', ' ')) in ('done', 'd') then 'Done'
          else 'Pending'
        end
      end,
      nullif(node.status, '')
    ) as status,
    node.due_date,
    node.priority,
    node.created_timestamp as node_created_timestamp,
    assignment.logic_gate_id,
    gate.header as logic_gate_title,
    gate.created_timestamp as logic_gate_created_timestamp,
    coalesce(account_snapshot.accounts_json, '[]'::jsonb) as accounts
  from nodes node
  left join latest_assignment assignment
    on assignment.company_id = node.company_id
   and assignment.node_id = node.node_id
  left join logic_gates gate
    on gate.company_id = node.company_id
   and gate.logic_gate_id = assignment.logic_gate_id
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
      'company_id', account.company_id::text,
      'account_id', account.account_id::text,
      'name', account.name,
      'folder_id', account.folder_id::text,
      'position', account.position,
      'created_timestamp', account.created_timestamp,
      'updated_timestamp', account.updated_timestamp
    ) order by account.position asc, lower(account.name) asc, account.account_id::text asc), '[]'::jsonb) as accounts_json
    from node_account_assignments node_account
    join accounts account
      on account.company_id = node_account.company_id
     and account.account_id = node_account.account_id
    where node_account.company_id = node.company_id
      and node_account.node_id = node.node_id
  ) account_snapshot on true
), assignment_rows as (
  select distinct
    node_rows.company_id,
    effective.user_id,
    effective.role as gvic_assignment,
    node_rows.node_id,
    node_rows.title,
    node_rows.status,
    node_rows.due_date,
    node_rows.priority,
    node_rows.node_created_timestamp,
    node_rows.logic_gate_id,
    node_rows.logic_gate_title,
    node_rows.logic_gate_created_timestamp,
    node_rows.accounts
  from node_rows
  join resource_gvic_effective_assignments effective
    on effective.company_id = node_rows.company_id
   and (
     (node_rows.logic_gate_id is not null and effective.resource_type = 'logic_gate' and effective.resource_id = node_rows.logic_gate_id)
     or (node_rows.logic_gate_id is null and effective.resource_type = 'node' and effective.resource_id = node_rows.node_id)
   )
  where effective.role in ('generated', 'verified', 'consulted', 'informed')
    and lower(regexp_replace(coalesce(node_rows.status, ''), '[\s_-]+', '_', 'g')) not in ('done', 'complete', 'completed', 'closed', 'archived')
), project_matches as (
  select distinct on (assignment_rows.user_id, assignment_rows.gvic_assignment, assignment_rows.node_id, project.project_id)
    assignment_rows.*,
    project.project_id,
    project.name as project_name,
    project.created_timestamp as project_created_timestamp,
    relationship.position as project_position,
    relationship.relationship_created_timestamp,
    lower(regexp_replace(coalesce(project.status, ''), '[\s_-]+', '_', 'g')) in ('done', 'complete', 'completed', 'closed', 'archived') as project_done
  from assignment_rows
  join project_relationship_projection relationship
    on relationship.company_id = assignment_rows.company_id
   and (
     relationship.node_id = assignment_rows.node_id
     or (assignment_rows.logic_gate_id is not null and relationship.logic_gate_id = assignment_rows.logic_gate_id)
   )
  join projects project
    on project.company_id = relationship.company_id
   and project.project_id = relationship.project_id
  order by
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.node_id,
    project.project_id,
    relationship.position asc,
    relationship.relationship_created_timestamp asc
), leaf_contexts as (
  select *
  from project_matches
  where not project_done
  union all
  select
    assignment_rows.*,
    null::uuid as project_id,
    null::text as project_name,
    null::timestamptz as project_created_timestamp,
    0 as project_position,
    assignment_rows.node_created_timestamp as relationship_created_timestamp,
    false as project_done
  from assignment_rows
  where not exists (
    select 1
    from project_matches match
    where match.user_id = assignment_rows.user_id
      and match.gvic_assignment = assignment_rows.gvic_assignment
      and match.node_id = assignment_rows.node_id
  )
), path_rows as (
  select
    company_id,
    user_id,
    gvic_assignment,
    concat(gvic_assignment, ':', coalesce(priority::text, 'none'), ':', node_id::text, ':project:', project_id::text) as item_id,
    'project'::text as resource_type,
    project_id as resource_id,
    project_id,
    logic_gate_id,
    node_id as node_leaf_id,
    null::text as parent_resource_type,
    null::uuid as parent_resource_id,
    project_name as display_title,
    null::text as status,
    null::date as due_date,
    priority,
    '[]'::jsonb as accounts,
    project_created_timestamp as resource_created_timestamp,
    0::smallint as depth,
    true as is_container_row,
    lower(coalesce(project_name, '')) as project_sort,
    lower(coalesce(logic_gate_title, '')) as gate_sort,
    lower(coalesce(title, '')) as node_sort
  from leaf_contexts
  where project_id is not null
  union all
  select
    company_id,
    user_id,
    gvic_assignment,
    concat(gvic_assignment, ':', coalesce(priority::text, 'none'), ':', node_id::text, ':', coalesce('project:' || project_id::text, 'no_project'), ':logic_gate:', logic_gate_id::text) as item_id,
    'logic_gate'::text as resource_type,
    logic_gate_id as resource_id,
    project_id,
    logic_gate_id,
    node_id as node_leaf_id,
    case when project_id is not null then 'project'::text end as parent_resource_type,
    project_id as parent_resource_id,
    logic_gate_title as display_title,
    null::text as status,
    null::date as due_date,
    priority,
    '[]'::jsonb as accounts,
    logic_gate_created_timestamp as resource_created_timestamp,
    case when project_id is not null then 1 else 0 end::smallint as depth,
    true as is_container_row,
    lower(coalesce(project_name, '')) as project_sort,
    lower(coalesce(logic_gate_title, '')) as gate_sort,
    lower(coalesce(title, '')) as node_sort
  from leaf_contexts
  where logic_gate_id is not null
  union all
  select
    company_id,
    user_id,
    gvic_assignment,
    concat(gvic_assignment, ':', coalesce(priority::text, 'none'), ':', node_id::text, ':', coalesce('project:' || project_id::text, 'no_project'), ':', coalesce('logic_gate:' || logic_gate_id::text, 'no_gate'), ':node:', node_id::text) as item_id,
    'node'::text as resource_type,
    node_id as resource_id,
    project_id,
    logic_gate_id,
    node_id as node_leaf_id,
    case
      when logic_gate_id is not null then 'logic_gate'::text
      when project_id is not null then 'project'::text
    end as parent_resource_type,
    coalesce(logic_gate_id, project_id) as parent_resource_id,
    title as display_title,
    status,
    due_date,
    priority,
    accounts,
    node_created_timestamp as resource_created_timestamp,
    case
      when project_id is not null and logic_gate_id is not null then 2
      when project_id is not null or logic_gate_id is not null then 1
      else 0
    end::smallint as depth,
    false as is_container_row,
    lower(coalesce(project_name, '')) as project_sort,
    lower(coalesce(logic_gate_title, '')) as gate_sort,
    lower(coalesce(title, '')) as node_sort
  from leaf_contexts
), projected as (
  select
    company_id,
    user_id,
    item_id,
    gvic_assignment,
    resource_type,
    resource_id,
    project_id,
    logic_gate_id,
    node_leaf_id,
    parent_resource_type,
    parent_resource_id,
    display_title,
    status,
    due_date,
    priority,
    accounts,
    resource_created_timestamp,
    depth,
    is_container_row,
    row_number() over (
      partition by company_id, user_id
      order by
        case gvic_assignment
          when 'generated' then 1
          when 'verified' then 2
          when 'consulted' then 3
          when 'informed' then 4
          else 5
        end,
        coalesce(priority, 6),
        project_sort,
        gate_sort,
        node_sort,
        node_leaf_id::text,
        depth,
        resource_type,
        resource_id::text
    )::integer as sort_order
  from path_rows
)
insert into gvic_matrix_projection_table (
  company_id,
  user_id,
  item_id,
  gvic_assignment,
  resource_type,
  resource_id,
  project_id,
  logic_gate_id,
  node_leaf_id,
  parent_resource_type,
  parent_resource_id,
  display_title,
  status,
  due_date,
  priority,
  accounts,
  resource_created_timestamp,
  depth,
  sort_order,
  is_container_row,
  updated_timestamp
)
select
  company_id,
  user_id,
  item_id,
  gvic_assignment,
  resource_type,
  resource_id,
  project_id,
  logic_gate_id,
  node_leaf_id,
  parent_resource_type,
  parent_resource_id,
  display_title,
  status,
  due_date,
  priority,
  accounts,
  resource_created_timestamp,
  depth,
  sort_order,
  is_container_row,
  now()
from projected;

