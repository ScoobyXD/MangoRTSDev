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
      and requested.required_rank <= mangorts_access_level_rank('edit')
      and exists (
        select 1
        from company_memberships membership
        where membership.company_id = p_company_id
          and membership.user_id = p_user_id
      )
      and not exists (
        select 1
        from resource_access_grants grant_row
        where grant_row.company_id = p_company_id
          and grant_row.resource_type = normalized_resource.resource_type
          and grant_row.resource_id = p_resource_id
      ) then true
    when exists (select 1 from effective_grant) then (select access_rank from effective_grant) >= requested.required_rank
    else false
  end
  from requested, normalized_resource;
$$ language sql stable;
