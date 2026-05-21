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
    ) then case
      when lower(btrim(p_resource_type)) in ('node', 'logic_gate') then true
      else (select required_rank from requested) = 1
    end
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