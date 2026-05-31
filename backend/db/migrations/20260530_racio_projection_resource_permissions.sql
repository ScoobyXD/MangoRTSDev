do $$
begin
  if to_regclass('public.resource_permissions') is null
     and to_regclass('public.resource_access') is not null then
    alter table public.resource_access rename to resource_permissions;
  end if;
end $$;

create table if not exists resource_permissions (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint resource_permissions_resource_type_chk check (resource_type in ('node', 'logic_gate')),
  primary key (company_id, resource_type, resource_id, user_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

do $$
begin
  if to_regclass('public.resource_access') is not null
     and to_regclass('public.resource_permissions') is not null then
    execute '
      insert into public.resource_permissions (
        company_id,
        resource_type,
        resource_id,
        user_id,
        created_timestamp,
        updated_timestamp
      )
      select company_id,
             resource_type,
             resource_id,
             user_id,
             created_timestamp,
             updated_timestamp
      from public.resource_access
      on conflict (company_id, resource_type, resource_id, user_id) do nothing';
    execute 'drop table public.resource_access';
  end if;
end $$;

drop index if exists idx_resource_access_user_resource;
drop index if exists idx_resource_access_resource_user;

alter table resource_permissions
  drop constraint if exists resource_access_resource_type_chk;

alter table resource_permissions
  drop constraint if exists resource_permissions_resource_type_chk;

alter table resource_permissions
  add constraint resource_permissions_resource_type_chk check (resource_type in ('node', 'logic_gate'));

create index if not exists idx_resource_permissions_user_resource
  on resource_permissions(company_id, user_id, resource_type, resource_id);

create index if not exists idx_resource_permissions_resource_user
  on resource_permissions(company_id, resource_type, resource_id, user_id);

drop trigger if exists trg_rebuild_work_item_inbox_entries_node on nodes;
drop trigger if exists trg_rebuild_work_item_inbox_entries_assignment on node_logic_gate_assignments;
drop trigger if exists trg_rebuild_work_item_inbox_entries_logic_gate on logic_gates;
drop trigger if exists trg_rebuild_work_item_inbox_entries_raci on logic_gate_raci_assignments;
drop trigger if exists trg_rebuild_work_item_inbox_entries_membership on company_memberships;
drop trigger if exists trg_rebuild_work_item_inbox_entries_user on users;
drop trigger if exists trg_rebuild_work_item_inbox_entries_column on kanban_columns;

drop function if exists trg_rebuild_work_item_inbox_entries_node();
drop function if exists trg_rebuild_work_item_inbox_entries_assignment();
drop function if exists trg_rebuild_work_item_inbox_entries_logic_gate();
drop function if exists trg_rebuild_work_item_inbox_entries_raci();
drop function if exists trg_rebuild_work_item_inbox_entries_membership();
drop function if exists trg_rebuild_work_item_inbox_entries_user();
drop function if exists trg_rebuild_work_item_inbox_entries_column();
drop function if exists rebuild_work_item_inbox_entries_for_node(uuid, uuid);
drop function if exists rebuild_work_item_inbox_entries_for_logic_gate(uuid, uuid);
drop function if exists rebuild_work_item_inbox_entries_for_logic_gate_nodes(uuid, uuid);
drop function if exists rebuild_work_item_inbox_entries_for_company(uuid);
drop function if exists rebuild_work_item_inbox_entries_for_membership(uuid, uuid);
drop function if exists rebuild_work_item_inbox_entries_for_user(uuid);
drop function if exists rebuild_work_item_inbox_entries_for_column(uuid, text, uuid);

drop table if exists work_item_inbox_entries;
drop table if exists effective_resource_access;

create table if not exists racio_matrix_projection_table (
  company_id uuid not null,
  user_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  logic_gate_id uuid,
  display_title text not null default '',
  status text,
  status_color text,
  due_date date,
  priority smallint,
  assignee_user_id uuid,
  assignee_display_name text,
  assignee_email text,
  resource_created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint racio_matrix_projection_resource_type_chk check (resource_type in ('node', 'logic_gate')),
  constraint racio_matrix_projection_shape_chk check (
    (resource_type = 'node')
    or (resource_type = 'logic_gate' and logic_gate_id = resource_id)
  ),
  primary key (company_id, user_id, resource_type, resource_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_racio_projection_node_read
  on racio_matrix_projection_table(company_id, user_id, resource_type, logic_gate_id, resource_created_timestamp, resource_id)
  where resource_type = 'node';

create index if not exists idx_racio_projection_logic_gate_read
  on racio_matrix_projection_table(company_id, user_id, resource_type, lower(display_title), resource_id)
  where resource_type = 'logic_gate';

create index if not exists idx_racio_projection_logic_gate_user
  on racio_matrix_projection_table(company_id, logic_gate_id, user_id);

create index if not exists idx_racio_projection_resource
  on racio_matrix_projection_table(company_id, resource_type, resource_id);

create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean as $$
  with recursive normalized_resource(resource_type) as (
    select lower(btrim(coalesce(p_resource_type, '')))
  ),
  requested(required_rank) as (
    select mangorts_access_level_rank(p_access_level)
  ),
  role_admin_actor(allowed) as (
    select exists (
      select 1
      from company_memberships membership
      where membership.user_id = p_user_id
        and (
          membership.role = 'dev_admin'
          or (membership.company_id = p_company_id and membership.role = 'company_admin')
        )
    )
  ),
  normalized_resource_row(default_access) as (
    select coalesce(node.default_access, 'edit')
    from nodes node, normalized_resource normalized
    where normalized.resource_type='node'
      and node.company_id=p_company_id
      and node.node_id=p_resource_id
    union all
    select coalesce(gate.default_access, 'edit')
    from logic_gates gate, normalized_resource normalized
    where normalized.resource_type='logic_gate'
      and gate.company_id=p_company_id
      and gate.logic_gate_id=p_resource_id
  ),
  direct_override(exists_override) as (
    select exists (
      select 1
      from resource_permissions access
      join normalized_resource normalized
        on normalized.resource_type=access.resource_type
      where access.company_id=p_company_id
        and access.resource_id=p_resource_id
        and access.user_id=p_user_id
    )
  ),
  resource_scope(resource_id, depth, path) as (
    select p_resource_id, 0, array[p_resource_id]
    union all
    select folder.parent_folder_id, resource_scope.depth + 1, resource_scope.path || folder.parent_folder_id
    from resource_scope
    join company_explorer_folders folder
      on folder.company_id = p_company_id
     and folder.folder_kind = 'communications'
     and folder.folder_id = resource_scope.resource_id
    join normalized_resource normalized
      on normalized.resource_type = 'shared_triage_folder'
    where folder.parent_folder_id is not null
      and not folder.parent_folder_id = any(resource_scope.path)
  ),
  permitted_group_scope(resource_id, depth, group_id, access_rank, path) as (
    select permission.resource_id,
           resource_scope.depth,
           permission.principal_id,
           mangorts_access_level_rank(permission.access_level),
           array[permission.principal_id]
    from resource_access_grants permission
    join resource_scope
      on resource_scope.resource_id = permission.resource_id
    join normalized_resource normalized
      on normalized.resource_type = permission.resource_type
    where permission.company_id = p_company_id
      and permission.principal_type = 'group'
    union all
    select parent.resource_id,
           parent.depth,
           child.group_id,
           parent.access_rank,
           parent.path || child.group_id
    from permitted_group_scope parent
    join company_user_groups child
      on child.company_id = p_company_id
     and child.parent_group_id = parent.group_id
    where not child.group_id = any(parent.path)
  ),
  matching_grants(depth, subject_rank, access_rank) as (
    select resource_scope.depth,
           2,
           mangorts_access_level_rank(permission.access_level)
    from resource_access_grants permission
    join resource_scope
      on resource_scope.resource_id = permission.resource_id
    join normalized_resource normalized
      on normalized.resource_type = permission.resource_type
    where permission.company_id = p_company_id
      and permission.principal_type = 'user'
      and permission.principal_id = p_user_id
    union all
    select permitted_group_scope.depth,
           1,
           permitted_group_scope.access_rank
    from company_user_group_members member
    join permitted_group_scope
      on permitted_group_scope.group_id = member.group_id
    where member.company_id = p_company_id
      and member.user_id = p_user_id
  ),
  effective_grant(access_rank) as (
    select matching_grants.access_rank
    from matching_grants
    order by matching_grants.depth asc,
             matching_grants.subject_rank desc,
             matching_grants.access_rank desc
    limit 1
  )
  select case
    when requested.required_rank = 0 then false
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'shared_triage_folder') then false
    when (select allowed from role_admin_actor) then true
    when normalized_resource.resource_type in ('node', 'logic_gate')
      and exists (
        select 1
        from company_memberships membership
        where membership.company_id = p_company_id
          and membership.user_id = p_user_id
      )
      and exists (select 1 from normalized_resource_row)
      and (
        ((select default_access from normalized_resource_row limit 1) = 'edit' and not (select exists_override from direct_override))
        or ((select default_access from normalized_resource_row limit 1) = 'no_access' and (select exists_override from direct_override))
      ) then true
    when exists (select 1 from effective_grant) then (select access_rank from effective_grant) >= requested.required_rank
    else false
  end
  from requested, normalized_resource;
$$ language sql stable;

insert into racio_matrix_projection_table (
  company_id,
  user_id,
  resource_type,
  resource_id,
  logic_gate_id,
  display_title,
  status,
  status_color,
  due_date,
  priority,
  assignee_user_id,
  assignee_display_name,
  assignee_email,
  resource_created_timestamp,
  updated_timestamp
)
select gate.company_id,
       assignment.user_id,
       'logic_gate',
       gate.logic_gate_id,
       gate.logic_gate_id,
       gate.header,
       null,
       null,
       null,
       null,
       null,
       null,
       null,
       gate.created_timestamp,
       now()
from logic_gates gate
join (
  select distinct assignment.company_id, assignment.logic_gate_id, assignment.user_id
  from logic_gate_raci_assignments assignment
  join company_memberships membership
    on membership.company_id=assignment.company_id
   and membership.user_id=assignment.user_id
) assignment
  on assignment.company_id=gate.company_id
 and assignment.logic_gate_id=gate.logic_gate_id
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  logic_gate_id=excluded.logic_gate_id,
  display_title=excluded.display_title,
  status=excluded.status,
  status_color=excluded.status_color,
  due_date=excluded.due_date,
  priority=excluded.priority,
  assignee_user_id=excluded.assignee_user_id,
  assignee_display_name=excluded.assignee_display_name,
  assignee_email=excluded.assignee_email,
  resource_created_timestamp=excluded.resource_created_timestamp,
  updated_timestamp=now();

with latest_assignment as (
  select distinct on (assignment.company_id, assignment.node_id)
    assignment.*
  from node_logic_gate_assignments assignment
  order by assignment.company_id,
           assignment.node_id,
           assignment.updated_timestamp desc,
           assignment.created_timestamp desc,
           assignment.assignment_id desc
),
node_rows as (
  select
    n.company_id,
    n.node_id,
    n.title,
    coalesce(
      case
        when assignment.is_issue then 'Issue'
        else column_row.title
      end,
      nullif(n.status, '')
    ) as status,
    coalesce(
      case
        when assignment.is_issue then '#ffd400'
        else column_row.item_color
      end,
      nullif(n.status_color, '')
    ) as status_color,
    n.due_date,
    n.priority,
    n.assignee_user_id,
    nullif(assignee.display_name, '') as assignee_display_name,
    nullif(assignee.email, '') as assignee_email,
    n.created_timestamp as resource_created_timestamp,
    assignment.logic_gate_id
  from nodes n
  left join latest_assignment assignment
    on assignment.company_id = n.company_id
   and assignment.node_id = n.node_id
  left join kanban_columns column_row
    on column_row.company_id = assignment.company_id
   and column_row.board_id = assignment.compatibility_board_id
   and column_row.column_id = assignment.column_id
  left join company_memberships assignee_membership
    on assignee_membership.company_id = n.company_id
   and assignee_membership.user_id = n.assignee_user_id
  left join users assignee
    on assignee.user_id = assignee_membership.user_id
),
projected_nodes as (
  select
    node_rows.company_id,
    raci.user_id,
    'node'::text as resource_type,
    node_rows.node_id as resource_id,
    node_rows.logic_gate_id,
    node_rows.title as display_title,
    node_rows.status,
    node_rows.status_color,
    node_rows.due_date,
    node_rows.priority,
    node_rows.assignee_user_id,
    node_rows.assignee_display_name,
    node_rows.assignee_email,
    node_rows.resource_created_timestamp
  from node_rows
  join logic_gate_raci_assignments raci
    on raci.company_id=node_rows.company_id
   and raci.logic_gate_id=node_rows.logic_gate_id
  join company_memberships membership
    on membership.company_id=raci.company_id
   and membership.user_id=raci.user_id
  where node_rows.logic_gate_id is not null
  union all
  select
    node_rows.company_id,
    node_rows.assignee_user_id,
    'node'::text,
    node_rows.node_id,
    null::uuid,
    node_rows.title,
    node_rows.status,
    node_rows.status_color,
    node_rows.due_date,
    node_rows.priority,
    node_rows.assignee_user_id,
    node_rows.assignee_display_name,
    node_rows.assignee_email,
    node_rows.resource_created_timestamp
  from node_rows
  join company_memberships membership
    on membership.company_id=node_rows.company_id
   and membership.user_id=node_rows.assignee_user_id
  where node_rows.logic_gate_id is null
    and node_rows.assignee_user_id is not null
),
deduped_projected_nodes as (
  select distinct on (company_id, user_id, resource_type, resource_id)
    company_id,
    user_id,
    resource_type,
    resource_id,
    logic_gate_id,
    display_title,
    status,
    status_color,
    due_date,
    priority,
    assignee_user_id,
    assignee_display_name,
    assignee_email,
    resource_created_timestamp
  from projected_nodes
  order by company_id,
           user_id,
           resource_type,
           resource_id,
           logic_gate_id nulls last,
           resource_created_timestamp desc
)
insert into racio_matrix_projection_table (
  company_id,
  user_id,
  resource_type,
  resource_id,
  logic_gate_id,
  display_title,
  status,
  status_color,
  due_date,
  priority,
  assignee_user_id,
  assignee_display_name,
  assignee_email,
  resource_created_timestamp,
  updated_timestamp
)
select company_id,
       user_id,
       resource_type,
       resource_id,
       logic_gate_id,
       display_title,
       status,
       status_color,
       due_date,
       priority,
       assignee_user_id,
       assignee_display_name,
       assignee_email,
       resource_created_timestamp,
       now()
from deduped_projected_nodes
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  logic_gate_id=excluded.logic_gate_id,
  display_title=excluded.display_title,
  status=excluded.status,
  status_color=excluded.status_color,
  due_date=excluded.due_date,
  priority=excluded.priority,
  assignee_user_id=excluded.assignee_user_id,
  assignee_display_name=excluded.assignee_display_name,
  assignee_email=excluded.assignee_email,
  resource_created_timestamp=excluded.resource_created_timestamp,
  updated_timestamp=now();
