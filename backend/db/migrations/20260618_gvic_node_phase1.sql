create table if not exists company_user_group_closure (
  company_id uuid not null,
  ancestor_group_id uuid not null,
  descendant_group_id uuid not null,
  depth integer not null,
  primary key (company_id, ancestor_group_id, descendant_group_id),
  foreign key (company_id, ancestor_group_id) references company_user_groups (company_id, group_id) on delete cascade,
  foreign key (company_id, descendant_group_id) references company_user_groups (company_id, group_id) on delete cascade
);

create table if not exists resource_gvic_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  principal_type text not null,
  principal_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint resource_gvic_assignments_resource_type_chk
    check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder', 'shared_inbox')),
  constraint resource_gvic_assignments_role_chk
    check (role in ('generated', 'verified', 'consulted', 'informed')),
  constraint resource_gvic_assignments_principal_type_chk
    check (principal_type in ('user', 'group')),
  primary key (company_id, resource_type, resource_id, role, principal_type, principal_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_gvic_assignments_principal_role_resource
  on resource_gvic_assignments(company_id, principal_type, principal_id, role, resource_type, resource_id);

create index if not exists idx_resource_gvic_assignments_resource_role_principal
  on resource_gvic_assignments(company_id, resource_type, resource_id, role, principal_type, principal_id);

create table if not exists resource_gvic_effective_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  user_id uuid not null,
  source_resource_type text not null,
  source_resource_id uuid not null,
  source_principal_type text not null,
  source_principal_id uuid not null,
  inheritance_type text not null,
  updated_timestamp timestamptz not null default now(),
  constraint resource_gvic_effective_assignments_resource_type_chk
    check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder', 'shared_inbox')),
  constraint resource_gvic_effective_assignments_role_chk
    check (role in ('generated', 'verified', 'consulted', 'informed')),
  constraint resource_gvic_effective_assignments_source_resource_type_chk
    check (source_resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder', 'shared_inbox')),
  constraint resource_gvic_effective_assignments_source_principal_type_chk
    check (source_principal_type in ('user', 'group')),
  constraint resource_gvic_effective_assignments_inheritance_type_chk
    check (inheritance_type in ('direct', 'logic_gate_inherited')),
  primary key (
    company_id,
    resource_type,
    resource_id,
    role,
    user_id,
    source_resource_type,
    source_resource_id,
    source_principal_type,
    source_principal_id,
    inheritance_type
  ),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_resource_gvic_effective_user_resource
  on resource_gvic_effective_assignments(company_id, user_id, resource_type, resource_id, role);

create index if not exists idx_resource_gvic_effective_resource_role_user
  on resource_gvic_effective_assignments(company_id, resource_type, resource_id, role, user_id);

create index if not exists idx_resource_gvic_effective_source
  on resource_gvic_effective_assignments(company_id, source_resource_type, source_resource_id);

with recursive closure(company_id, ancestor_group_id, descendant_group_id, depth, path) as (
  select company_id, group_id, group_id, 0, array[group_id]
  from company_user_groups
  union all
  select closure.company_id, closure.ancestor_group_id, child.group_id, closure.depth + 1, closure.path || child.group_id
  from closure
  join company_user_groups child
    on child.company_id = closure.company_id
   and child.parent_group_id = closure.descendant_group_id
  where not child.group_id = any(closure.path)
)
insert into company_user_group_closure (company_id, ancestor_group_id, descendant_group_id, depth)
select company_id, ancestor_group_id, descendant_group_id, min(depth)
from closure
group by company_id, ancestor_group_id, descendant_group_id
on conflict (company_id, ancestor_group_id, descendant_group_id)
do update set depth = excluded.depth;

insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
)
select
  company_id,
  case resource_type
    when 'shared_triage_folder' then 'shared_triage_folder'
    else resource_type
  end,
  resource_id,
  case role
    when 'responsible' then 'generated'
    when 'accountable' then 'verified'
    else role
  end,
  subject_type,
  subject_id,
  created_timestamp,
  created_timestamp
from resource_raci_assignments
where role in ('responsible', 'accountable', 'consulted', 'informed')
  and subject_type in ('user', 'group')
  and resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder', 'shared_inbox')
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id)
do update set updated_timestamp = excluded.updated_timestamp;

insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
)
select
  company_id,
  'logic_gate',
  logic_gate_id,
  case role
    when 'responsible' then 'generated'
    when 'accountable' then 'verified'
    else role
  end,
  'user',
  user_id,
  created_timestamp,
  created_timestamp
from logic_gate_raci_assignments
where role in ('responsible', 'accountable', 'consulted', 'informed')
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id)
do update set updated_timestamp = excluded.updated_timestamp;

insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
)
select
  company_id,
  'shared_inbox',
  shared_inbox_id,
  case role
    when 'responsible' then 'generated'
    when 'accountable' then 'verified'
    else role
  end,
  'user',
  user_id,
  created_timestamp,
  created_timestamp
from shared_inbox_raci_assignments
where role in ('responsible', 'accountable', 'consulted', 'informed')
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id)
do update set updated_timestamp = excluded.updated_timestamp;

insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
)
select
  company_id,
  'shared_inbox',
  shared_inbox_id,
  case role
    when 'responsible' then 'generated'
    when 'accountable' then 'verified'
    else role
  end,
  'group',
  group_id,
  created_timestamp,
  created_timestamp
from shared_inbox_raci_group_assignments
where role in ('responsible', 'accountable', 'consulted', 'informed')
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id)
do update set updated_timestamp = excluded.updated_timestamp;

insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
)
select
  company_id,
  'node',
  node_id,
  'generated',
  'user',
  assignee_user_id,
  created_timestamp,
  created_timestamp
from nodes
where assignee_user_id is not null
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id)
do update set updated_timestamp = excluded.updated_timestamp;

update kanban_columns
set title = 'Review'
where lower(replace(replace(trim(title), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v');

update node_logic_gate_assignments
set status_key = 'review'
where lower(replace(replace(trim(status_key), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v');

update nodes
set status = 'Review'
where lower(replace(replace(trim(coalesce(status, '')), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v');

update kanban_board_projection
set status = 'review'
where lower(replace(replace(trim(status), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v');

update racio_matrix_projection_table
set status = 'Review'
where lower(replace(replace(trim(coalesce(status, '')), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v');

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nodes'
      and column_name = 'title'
  ) then
    alter table nodes rename column title to name;
  end if;
end
$$;

alter table nodes
  drop column if exists status_color,
  drop column if exists assignee_user_id;

delete from resource_gvic_effective_assignments;

with active_node_links as (
  select distinct on (company_id, node_id) company_id, node_id, logic_gate_id
  from node_logic_gate_assignments
  order by company_id, node_id, updated_timestamp desc, created_timestamp desc, assignment_id desc
),
direct_source as (
  select source.*
  from resource_gvic_assignments source
  left join active_node_links link
    on source.resource_type = 'node'
   and link.company_id = source.company_id
   and link.node_id = source.resource_id
  where link.node_id is null
),
direct_user_rows as (
  select
    direct_source.company_id,
    direct_source.resource_type,
    direct_source.resource_id,
    direct_source.role,
    direct_source.principal_id as user_id,
    direct_source.resource_type as source_resource_type,
    direct_source.resource_id as source_resource_id,
    direct_source.principal_type as source_principal_type,
    direct_source.principal_id as source_principal_id,
    'direct'::text as inheritance_type
  from direct_source
  join company_memberships membership
    on membership.company_id = direct_source.company_id
   and membership.user_id = direct_source.principal_id
  where direct_source.principal_type = 'user'
),
direct_group_rows as (
  select
    source.company_id,
    source.resource_type,
    source.resource_id,
    source.role,
    member.user_id,
    source.resource_type as source_resource_type,
    source.resource_id as source_resource_id,
    source.principal_type as source_principal_type,
    source.principal_id as source_principal_id,
    'direct'::text as inheritance_type
  from direct_source source
  join company_user_group_closure closure
    on closure.company_id = source.company_id
   and closure.ancestor_group_id = source.principal_id
  join company_user_group_members member
    on member.company_id = closure.company_id
   and member.group_id = closure.descendant_group_id
  join company_memberships membership
    on membership.company_id = member.company_id
   and membership.user_id = member.user_id
  where source.principal_type = 'group'
),
inherited_user_rows as (
  select
    link.company_id,
    'node'::text as resource_type,
    link.node_id as resource_id,
    source.role,
    source.principal_id as user_id,
    'logic_gate'::text as source_resource_type,
    link.logic_gate_id as source_resource_id,
    source.principal_type as source_principal_type,
    source.principal_id as source_principal_id,
    'logic_gate_inherited'::text as inheritance_type
  from active_node_links link
  join resource_gvic_assignments source
    on source.company_id = link.company_id
   and source.resource_type = 'logic_gate'
   and source.resource_id = link.logic_gate_id
  join company_memberships membership
    on membership.company_id = source.company_id
   and membership.user_id = source.principal_id
  where source.principal_type = 'user'
),
inherited_group_rows as (
  select
    link.company_id,
    'node'::text as resource_type,
    link.node_id as resource_id,
    source.role,
    member.user_id,
    'logic_gate'::text as source_resource_type,
    link.logic_gate_id as source_resource_id,
    source.principal_type as source_principal_type,
    source.principal_id as source_principal_id,
    'logic_gate_inherited'::text as inheritance_type
  from active_node_links link
  join resource_gvic_assignments source
    on source.company_id = link.company_id
   and source.resource_type = 'logic_gate'
   and source.resource_id = link.logic_gate_id
  join company_user_group_closure closure
    on closure.company_id = source.company_id
   and closure.ancestor_group_id = source.principal_id
  join company_user_group_members member
    on member.company_id = closure.company_id
   and member.group_id = closure.descendant_group_id
  join company_memberships membership
    on membership.company_id = member.company_id
   and membership.user_id = member.user_id
  where source.principal_type = 'group'
)
insert into resource_gvic_effective_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  user_id,
  source_resource_type,
  source_resource_id,
  source_principal_type,
  source_principal_id,
  inheritance_type
)
select * from direct_user_rows
union
select * from direct_group_rows
union
select * from inherited_user_rows
union
select * from inherited_group_rows
on conflict do nothing;

create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean as $$
  with normalized_resource(resource_type) as (
    select case lower(btrim(coalesce(p_resource_type, '')))
      when 'shared_triage_folder' then 'shared_inbox_folder'
      when 'communications_folder' then 'shared_inbox_folder'
      else lower(btrim(coalesce(p_resource_type, '')))
    end
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
    union all
    select coalesce(project.default_access, 'edit')
    from projects project, normalized_resource normalized
    where normalized.resource_type='project'
      and project.company_id=p_company_id
      and project.project_id=p_resource_id
    union all
    select coalesce(folder.default_access, 'edit')
    from company_explorer_folders folder, normalized_resource normalized
    where normalized.resource_type='company_explorer_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
      and folder.folder_kind <> 'communications'
    union all
    select coalesce(folder.default_access, 'edit')
    from shared_inbox_folders folder, normalized_resource normalized
    where normalized.resource_type='shared_inbox_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
    union all
    select coalesce(inbox.default_access, 'edit')
    from shared_inboxes inbox, normalized_resource normalized
    where normalized.resource_type='shared_inbox'
      and inbox.company_id=p_company_id
      and inbox.shared_inbox_id=p_resource_id
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
  gvic_access(max_rank) as (
    select coalesce(max(case gvic.role
      when 'generated' then 2
      when 'verified' then 2
      when 'consulted' then 1
      when 'informed' then 1
      else 0
    end), 0)
    from resource_gvic_effective_assignments gvic
    join normalized_resource normalized
      on normalized.resource_type = gvic.resource_type
      or (normalized.resource_type = 'shared_inbox_folder' and gvic.resource_type = 'shared_triage_folder')
    where gvic.company_id=p_company_id
      and gvic.resource_id=p_resource_id
      and gvic.user_id=p_user_id
  )
  select case
    when requested.required_rank = 0 then false
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false
    when (select allowed from role_admin_actor) then true
    when exists (select 1 from normalized_resource_row)
      and (select default_access from normalized_resource_row limit 1) = 'edit'
      and (select exists_override from direct_override) then false
    when exists (select 1 from normalized_resource_row)
      and (select default_access from normalized_resource_row limit 1) = 'no_access'
      and not (select exists_override from direct_override) then false
    when (select max_rank from gvic_access) >= requested.required_rank then true
    when exists (
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
    else false
  end
  from requested, normalized_resource;
$$ language sql stable;
