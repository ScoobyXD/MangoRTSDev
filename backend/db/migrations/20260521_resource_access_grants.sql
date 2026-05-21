create table if not exists resource_access_grants (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  principal_type text not null,
  principal_id uuid not null,
  access_level text not null default 'view',
  created_timestamp timestamptz not null default now(),
  constraint resource_access_grants_resource_type_chk check (resource_type in ('node', 'logic_gate', 'shared_triage_folder')),
  constraint resource_access_grants_principal_type_chk check (principal_type in ('user', 'group')),
  constraint resource_access_grants_access_level_chk check (access_level in ('view', 'edit', 'admin')),
  primary key (company_id, resource_type, resource_id, principal_type, principal_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_access_grants_principal
  on resource_access_grants(company_id, principal_type, principal_id, resource_type, resource_id);

create index if not exists idx_resource_access_grants_resource
  on resource_access_grants(company_id, resource_type, resource_id);

create or replace function mangorts_access_level_rank(p_access_level text)
returns integer as $$
  select case lower(btrim(coalesce(p_access_level, '')))
    when 'view' then 1
    when 'edit' then 2
    when 'admin' then 3
    else 0
  end;
$$ language sql immutable;

insert into resource_access_grants (company_id, resource_type, resource_id, principal_type, principal_id, access_level, created_timestamp)
select permission.company_id,
       permission.entity_type,
       permission.entity_id,
       permission.subject_type,
       permission.subject_id,
       case when permission.permission in ('view', 'edit', 'admin') then permission.permission else 'view' end,
       permission.created_timestamp
from entity_access_permissions permission
where permission.entity_type in ('node', 'logic_gate')
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do update set
  access_level = case
    when mangorts_access_level_rank(excluded.access_level) > mangorts_access_level_rank(resource_access_grants.access_level) then excluded.access_level
    else resource_access_grants.access_level
  end;

insert into resource_access_grants (company_id, resource_type, resource_id, principal_type, principal_id, access_level, created_timestamp)
select assignment.company_id,
       'shared_triage_folder',
       assignment.folder_id,
       'user',
       assignment.user_id,
       case when bool_or(assignment.role in ('responsible', 'accountable')) then 'edit' else 'view' end,
       min(assignment.created_timestamp)
from communications_shared_inbox_raci_assignments assignment
group by assignment.company_id, assignment.folder_id, assignment.user_id
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do update set
  access_level = case
    when mangorts_access_level_rank(excluded.access_level) > mangorts_access_level_rank(resource_access_grants.access_level) then excluded.access_level
    else resource_access_grants.access_level
  end;

create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean as $$
  with recursive requested(required_rank) as (
    select mangorts_access_level_rank(p_access_level)
  ),
  permitted_group_scope(group_id, access_rank) as (
    select permission.principal_id, mangorts_access_level_rank(permission.access_level)
    from resource_access_grants permission
    where permission.company_id = p_company_id
      and permission.resource_type = p_resource_type
      and permission.resource_id = p_resource_id
      and permission.principal_type = 'group'
    union all
    select child.group_id, parent.access_rank
    from company_user_groups child
    join permitted_group_scope parent
      on parent.group_id = child.parent_group_id
    where child.company_id = p_company_id
  )
  select case
    when (select required_rank from requested) = 0 then false
    when not exists (
      select 1
      from resource_access_grants permission
      where permission.company_id = p_company_id
        and permission.resource_type = p_resource_type
        and permission.resource_id = p_resource_id
    ) then (select required_rank from requested) = 1
    when exists (
      select 1
      from resource_access_grants permission, requested
      where permission.company_id = p_company_id
        and permission.resource_type = p_resource_type
        and permission.resource_id = p_resource_id
        and permission.principal_type = 'user'
        and permission.principal_id = p_user_id
        and mangorts_access_level_rank(permission.access_level) >= requested.required_rank
    ) then true
    when exists (
      select 1
      from company_user_group_members member
      join permitted_group_scope scope
        on scope.group_id = member.group_id
      cross join requested
      where member.company_id = p_company_id
        and member.user_id = p_user_id
        and scope.access_rank >= requested.required_rank
    ) then true
    else false
  end;
$$ language sql stable;

create or replace function mangorts_user_can_view_entity(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_user_id uuid
)
returns boolean as $$
  select mangorts_user_can_access_resource(p_company_id, p_entity_type, p_entity_id, p_user_id, 'view');
$$ language sql stable;