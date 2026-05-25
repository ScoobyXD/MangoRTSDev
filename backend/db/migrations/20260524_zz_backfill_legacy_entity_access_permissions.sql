with recursive migrated as (
  insert into resource_access_grants (
    company_id,
    resource_type,
    resource_id,
    principal_type,
    principal_id,
    access_level,
    created_timestamp
  )
  select
    permission.company_id,
    permission.entity_type,
    permission.entity_id,
    permission.subject_type,
    permission.subject_id,
    lower(btrim(permission.permission)),
    permission.created_timestamp
  from entity_access_permissions permission
  where permission.entity_type in ('node', 'logic_gate')
    and permission.subject_type in ('user', 'group')
    and lower(btrim(permission.permission)) in ('view', 'edit', 'admin')
  on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do update set
    access_level = case
      when resource_access_grants.access_level = 'no_access' then resource_access_grants.access_level
      when mangorts_access_level_rank(resource_access_grants.access_level) >= mangorts_access_level_rank(excluded.access_level)
        then resource_access_grants.access_level
      else excluded.access_level
    end,
    created_timestamp = least(resource_access_grants.created_timestamp, excluded.created_timestamp)
  returning company_id, resource_type, resource_id, principal_type, principal_id, access_level
),
group_descendants as (
  select user_group.company_id,
         user_group.group_id as root_group_id,
         user_group.group_id,
         array[user_group.group_id] as path
  from company_user_groups user_group
  where user_group.company_id in (select distinct company_id from migrated)
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
effective_candidates as (
  select grant_row.company_id,
         grant_row.principal_id as user_id,
         grant_row.resource_type,
         grant_row.resource_id,
         lower(btrim(grant_row.access_level)) as access_level,
         'direct_user_grant'::text as source_type,
         grant_row.resource_type || ':' || grant_row.resource_id::text || ':user:' || grant_row.principal_id::text as source_id,
         2 as subject_rank,
         mangorts_access_level_rank(grant_row.access_level) as access_rank
  from migrated grant_row
  join company_memberships membership
    on membership.company_id=grant_row.company_id
   and membership.user_id=grant_row.principal_id
  where grant_row.principal_type='user'
  union all
  select grant_row.company_id,
         member.user_id,
         grant_row.resource_type,
         grant_row.resource_id,
         lower(btrim(grant_row.access_level)),
         'direct_group_grant'::text,
         grant_row.resource_type || ':' || grant_row.resource_id::text || ':group:' || grant_row.principal_id::text,
         3,
         mangorts_access_level_rank(grant_row.access_level)
  from migrated grant_row
  join group_descendants descendant
    on descendant.company_id=grant_row.company_id
   and descendant.root_group_id=grant_row.principal_id
  join company_user_group_members member
    on member.company_id=grant_row.company_id
   and member.group_id=descendant.group_id
  where grant_row.principal_type='group'
),
ranked_effective as (
  select effective_candidates.*,
         row_number() over (
           partition by company_id, user_id, resource_type, resource_id
           order by subject_rank desc, access_rank desc, source_type asc, source_id asc
         ) as rn
  from effective_candidates
)
insert into effective_resource_access (
  company_id,
  user_id,
  resource_type,
  resource_id,
  access_level,
  source_type,
  source_id,
  created_timestamp,
  updated_timestamp
)
select company_id,
       user_id,
       resource_type,
       resource_id,
       access_level,
       source_type,
       source_id,
       now(),
       now()
from ranked_effective
where rn=1
on conflict (company_id, user_id, resource_type, resource_id) do update set
  access_level = case
    when effective_resource_access.access_level = 'no_access' then effective_resource_access.access_level
    when mangorts_access_level_rank(effective_resource_access.access_level) >= mangorts_access_level_rank(excluded.access_level)
      then effective_resource_access.access_level
    else excluded.access_level
  end,
  source_type = case
    when effective_resource_access.access_level = 'no_access' then effective_resource_access.source_type
    when mangorts_access_level_rank(effective_resource_access.access_level) >= mangorts_access_level_rank(excluded.access_level)
      then effective_resource_access.source_type
    else excluded.source_type
  end,
  source_id = case
    when effective_resource_access.access_level = 'no_access' then effective_resource_access.source_id
    when mangorts_access_level_rank(effective_resource_access.access_level) >= mangorts_access_level_rank(excluded.access_level)
      then effective_resource_access.source_id
    else excluded.source_id
  end,
  updated_timestamp = now();
