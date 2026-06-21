-- Replace the half-upgraded GVIC matrix projection with the clean My Work
-- node-leaf projection shape. The old table is retained as a legacy backup
-- for debugging, and the new table is rebuilt from source tables.

do $$
declare
  current_is_clean boolean := false;
  legacy_table_name text := 'gvic_matrix_projection_table_legacy_20260621';
  fallback_legacy_table_name text;
begin
  if to_regclass('public.gvic_matrix_projection_table') is not null then
    select
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'gvic_matrix_projection_table'
          and column_name = 'projection_row_id'
      )
      and not exists (
        select 1
        from (values
          ('company_id'),
          ('projection_row_id'),
          ('user_id'),
          ('node_name'),
          ('gvic_assignment'),
          ('priority'),
          ('project_id'),
          ('project_name'),
          ('logic_gate_id'),
          ('logic_gate_name'),
          ('node_id'),
          ('status'),
          ('due_date'),
          ('accounts'),
          ('created_timestamp'),
          ('updated_timestamp'),
          ('sort_order')
        ) desired(column_name)
        where not exists (
          select 1
          from information_schema.columns actual
          where actual.table_schema = 'public'
            and actual.table_name = 'gvic_matrix_projection_table'
            and actual.column_name = desired.column_name
        )
      )
      and not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'gvic_matrix_projection_table'
          and column_name in (
            'item_id',
            'display_title',
            'resource_type',
            'resource_id',
            'depth',
            'is_container_row',
            'parent_resource_type',
            'parent_resource_id',
            'node_leaf_id',
            'resource_created_timestamp'
          )
      )
    into current_is_clean;

    if not current_is_clean then
      if to_regclass('public.' || legacy_table_name) is null then
        execute format(
          'alter table public.gvic_matrix_projection_table rename to %I',
          legacy_table_name
        );
      else
        fallback_legacy_table_name := legacy_table_name || '_' || to_char(clock_timestamp(), 'HH24MISSMS');
        execute format(
          'alter table public.gvic_matrix_projection_table rename to %I',
          fallback_legacy_table_name
        );
      end if;
    end if;
  end if;
end
$$;

create table if not exists gvic_matrix_projection_table (
  company_id uuid not null,
  projection_row_id text not null,
  user_id uuid not null,
  node_name text not null,
  gvic_assignment text not null,
  priority smallint,
  project_id uuid,
  project_name text,
  logic_gate_id uuid,
  logic_gate_name text,
  node_id uuid not null,
  status text,
  due_date date,
  accounts jsonb not null default '[]'::jsonb,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  sort_order integer not null default 1,
  constraint gvic_matrix_projection_table_clean_pkey primary key (company_id, projection_row_id),
  constraint gvic_matrix_projection_gvic_assignment_chk check (
    gvic_assignment in ('generated', 'verified', 'consulted', 'informed')
  ),
  constraint gvic_matrix_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array'),
  constraint gvic_matrix_projection_priority_chk check (priority is null or priority between 1 and 5),
  constraint gvic_matrix_projection_sort_order_positive_chk check (sort_order > 0),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

delete from gvic_matrix_projection_table;

with latest_logic_gate_assignment as (
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
    node.name as node_name,
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
    gate.header as logic_gate_name,
    gate.created_timestamp as logic_gate_created_timestamp,
    coalesce(account_snapshot.accounts_json, '[]'::jsonb) as accounts
  from nodes node
  left join latest_logic_gate_assignment assignment
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
    node_rows.node_name,
    node_rows.status,
    node_rows.due_date,
    node_rows.priority,
    node_rows.node_created_timestamp,
    node_rows.logic_gate_id,
    node_rows.logic_gate_name,
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
  select distinct on (
    assignment_rows.company_id,
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.priority,
    assignment_rows.node_id,
    assignment_rows.logic_gate_id,
    project.project_id
  )
    assignment_rows.company_id,
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.priority,
    assignment_rows.node_id,
    assignment_rows.node_name,
    assignment_rows.status,
    assignment_rows.due_date,
    assignment_rows.node_created_timestamp,
    assignment_rows.logic_gate_id,
    assignment_rows.logic_gate_name,
    assignment_rows.logic_gate_created_timestamp,
    assignment_rows.accounts,
    project.project_id,
    project.name as project_name,
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
    assignment_rows.company_id,
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.priority,
    assignment_rows.node_id,
    assignment_rows.logic_gate_id,
    project.project_id,
    relationship.position asc,
    relationship.relationship_created_timestamp asc,
    relationship.relationship_id asc
), leaf_contexts as (
  select
    company_id,
    user_id,
    gvic_assignment,
    priority,
    node_id,
    node_name,
    status,
    due_date,
    node_created_timestamp,
    logic_gate_id,
    logic_gate_name,
    logic_gate_created_timestamp,
    accounts,
    project_id,
    project_name,
    project_position,
    relationship_created_timestamp
  from project_matches
  where not project_done
  union all
  select
    assignment_rows.company_id,
    assignment_rows.user_id,
    assignment_rows.gvic_assignment,
    assignment_rows.priority,
    assignment_rows.node_id,
    assignment_rows.node_name,
    assignment_rows.status,
    assignment_rows.due_date,
    assignment_rows.node_created_timestamp,
    assignment_rows.logic_gate_id,
    assignment_rows.logic_gate_name,
    assignment_rows.logic_gate_created_timestamp,
    assignment_rows.accounts,
    null::uuid as project_id,
    null::text as project_name,
    null::integer as project_position,
    null::timestamptz as relationship_created_timestamp
  from assignment_rows
  where not exists (
    select 1
    from project_matches match
    where match.company_id = assignment_rows.company_id
      and match.user_id = assignment_rows.user_id
      and match.gvic_assignment = assignment_rows.gvic_assignment
      and match.priority is not distinct from assignment_rows.priority
      and match.node_id = assignment_rows.node_id
      and match.logic_gate_id is not distinct from assignment_rows.logic_gate_id
  )
), projected as (
  select
    company_id,
    concat_ws(
      ':',
      'my_work_node_leaf',
      company_id::text,
      user_id::text,
      gvic_assignment,
      coalesce(priority::text, 'none'),
      'node',
      node_id::text,
      'project',
      coalesce(project_id::text, 'none'),
      'logic_gate',
      coalesce(logic_gate_id::text, 'none')
    ) as projection_row_id,
    user_id,
    node_name,
    gvic_assignment,
    priority,
    project_id,
    project_name,
    logic_gate_id,
    logic_gate_name,
    node_id,
    status,
    due_date,
    accounts,
    node_created_timestamp as created_timestamp,
    now() as updated_timestamp,
    row_number() over (
      partition by company_id, user_id, gvic_assignment, priority
      order by
        coalesce(project_position, 2147483647),
        lower(coalesce(project_name, '')),
        relationship_created_timestamp nulls last,
        lower(coalesce(logic_gate_name, '')),
        logic_gate_created_timestamp nulls last,
        lower(node_name),
        node_created_timestamp,
        node_id::text,
        coalesce(project_id::text, ''),
        coalesce(logic_gate_id::text, '')
    )::integer as sort_order
  from leaf_contexts
)
insert into gvic_matrix_projection_table (
  company_id,
  projection_row_id,
  user_id,
  node_name,
  gvic_assignment,
  priority,
  project_id,
  project_name,
  logic_gate_id,
  logic_gate_name,
  node_id,
  status,
  due_date,
  accounts,
  created_timestamp,
  updated_timestamp,
  sort_order
)
select
  company_id,
  projection_row_id,
  user_id,
  node_name,
  gvic_assignment,
  priority,
  project_id,
  project_name,
  logic_gate_id,
  logic_gate_name,
  node_id,
  status,
  due_date,
  accounts,
  created_timestamp,
  updated_timestamp,
  sort_order
from projected
on conflict (company_id, projection_row_id)
do update set
  user_id = excluded.user_id,
  node_name = excluded.node_name,
  gvic_assignment = excluded.gvic_assignment,
  priority = excluded.priority,
  project_id = excluded.project_id,
  project_name = excluded.project_name,
  logic_gate_id = excluded.logic_gate_id,
  logic_gate_name = excluded.logic_gate_name,
  node_id = excluded.node_id,
  status = excluded.status,
  due_date = excluded.due_date,
  accounts = excluded.accounts,
  created_timestamp = excluded.created_timestamp,
  updated_timestamp = excluded.updated_timestamp,
  sort_order = excluded.sort_order;

create index if not exists idx_gvic_matrix_projection_leaf_user_cell
  on gvic_matrix_projection_table(company_id, user_id, gvic_assignment, priority, sort_order, projection_row_id);

create index if not exists idx_gvic_matrix_projection_leaf_node
  on gvic_matrix_projection_table(company_id, node_id);

create index if not exists idx_gvic_matrix_projection_leaf_project
  on gvic_matrix_projection_table(company_id, project_id);

create index if not exists idx_gvic_matrix_projection_leaf_logic_gate
  on gvic_matrix_projection_table(company_id, logic_gate_id);
