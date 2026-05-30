alter table nodes
  add column if not exists default_access text not null default 'edit';

alter table nodes
  drop constraint if exists nodes_default_access_chk;

alter table nodes
  add constraint nodes_default_access_chk check (default_access in ('edit', 'no_access'));

alter table logic_gates
  add column if not exists default_access text not null default 'edit';

alter table logic_gates
  drop constraint if exists logic_gates_default_access_chk;

alter table logic_gates
  add constraint logic_gates_default_access_chk check (default_access in ('edit', 'no_access'));

create table if not exists resource_access (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint resource_access_resource_type_chk check (resource_type in ('node', 'logic_gate')),
  primary key (company_id, resource_type, resource_id, user_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_resource_access_user_resource
  on resource_access(company_id, user_id, resource_type, resource_id);

create index if not exists idx_resource_access_resource_user
  on resource_access(company_id, resource_type, resource_id, user_id);

with legacy_resources as (
  select distinct company_id, resource_type, resource_id
  from resource_access_grants
  where resource_type in ('node', 'logic_gate')
)
update nodes node
set default_access='no_access'
from legacy_resources legacy
where legacy.company_id=node.company_id
  and legacy.resource_type='node'
  and legacy.resource_id=node.node_id;

with legacy_resources as (
  select distinct company_id, resource_type, resource_id
  from resource_access_grants
  where resource_type in ('node', 'logic_gate')
)
update logic_gates gate
set default_access='no_access'
from legacy_resources legacy
where legacy.company_id=gate.company_id
  and legacy.resource_type='logic_gate'
  and legacy.resource_id=gate.logic_gate_id;

with recursive group_descendants as (
  select user_group.company_id,
         user_group.group_id as root_group_id,
         user_group.group_id,
         array[user_group.group_id] as path
  from company_user_groups user_group
  union all
  select parent.company_id,
         parent.root_group_id,
         child.group_id,
         parent.path || child.group_id
  from group_descendants parent
  join company_user_groups child
    on child.company_id=parent.company_id
   and child.parent_group_id=parent.group_id
  where not child.group_id = any(parent.path)
),
legacy_user_overrides as (
  select grant_row.company_id,
         grant_row.resource_type,
         grant_row.resource_id,
         grant_row.principal_id as user_id,
         grant_row.created_timestamp
  from resource_access_grants grant_row
  where grant_row.resource_type in ('node', 'logic_gate')
    and grant_row.principal_type='user'
    and lower(btrim(grant_row.access_level)) in ('view', 'edit', 'admin')
  union all
  select grant_row.company_id,
         grant_row.resource_type,
         grant_row.resource_id,
         member.user_id,
         greatest(grant_row.created_timestamp, member.created_timestamp)
  from resource_access_grants grant_row
  join group_descendants descendant
    on descendant.company_id=grant_row.company_id
   and descendant.root_group_id=grant_row.principal_id
  join company_user_group_members member
    on member.company_id=grant_row.company_id
   and member.group_id=descendant.group_id
  where grant_row.resource_type in ('node', 'logic_gate')
    and grant_row.principal_type='group'
    and lower(btrim(grant_row.access_level)) in ('view', 'edit', 'admin')
),
ranked_overrides as (
  select legacy_user_overrides.*,
         row_number() over (
           partition by company_id, resource_type, resource_id, user_id
           order by created_timestamp asc
         ) as rn
  from legacy_user_overrides
  join company_memberships membership
    on membership.company_id=legacy_user_overrides.company_id
   and membership.user_id=legacy_user_overrides.user_id
  where membership.role <> 'company_admin'
    and not exists (
      select 1
      from company_memberships dev_membership
      where dev_membership.user_id=legacy_user_overrides.user_id
        and dev_membership.role='dev_admin'
    )
)
insert into resource_access (
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
       now()
from ranked_overrides
where rn=1
on conflict (company_id, resource_type, resource_id, user_id) do nothing;

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
      from resource_access access
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
