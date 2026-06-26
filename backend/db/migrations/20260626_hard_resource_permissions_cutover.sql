do $$
begin
  if to_regclass('public.resource_access_grants') is not null then
    with recursive normalized_legacy_grants as (
      select grant_row.company_id,
             case lower(btrim(grant_row.resource_type))
               when 'shared_triage_folder' then 'shared_inbox_folder'
               when 'communications_folder' then 'shared_inbox_folder'
               else lower(btrim(grant_row.resource_type))
             end as resource_type,
             grant_row.resource_id,
             lower(btrim(grant_row.principal_type)) as principal_type,
             grant_row.principal_id,
             lower(btrim(grant_row.access_level)) as access_level,
             grant_row.created_timestamp
      from resource_access_grants grant_row
      where lower(btrim(grant_row.access_level)) in ('no_access', 'view', 'edit', 'admin')
    ),
    resource_defaults as (
      select company_id, 'node'::text as resource_type, node_id as resource_id, default_access
      from nodes
      union all
      select company_id, 'logic_gate', logic_gate_id, default_access
      from logic_gates
      union all
      select company_id, 'project', project_id, default_access
      from projects
      union all
      select company_id, 'company_explorer_folder', folder_id, default_access
      from company_explorer_folders
      union all
      select company_id, 'shared_inbox_folder', folder_id, default_access
      from shared_inbox_folders
      union all
      select company_id, 'shared_inbox', shared_inbox_id, default_access
      from shared_inboxes
    ),
    group_descendants as (
      select company_id,
             group_id as ancestor_group_id,
             group_id as descendant_group_id,
             0 as depth
      from company_user_groups
      union all
      select parent.company_id,
             parent.ancestor_group_id,
             child.group_id,
             parent.depth + 1
      from group_descendants parent
      join company_user_groups child
        on child.company_id = parent.company_id
       and child.parent_group_id = parent.descendant_group_id
      where parent.depth < 100
    ),
    expanded_grants as (
      select legacy.company_id,
             legacy.resource_type,
             legacy.resource_id,
             legacy.principal_id as user_id,
             2 as subject_rank,
             mangorts_access_level_rank(legacy.access_level) as access_rank,
             legacy.created_timestamp
      from normalized_legacy_grants legacy
      join company_memberships membership
        on membership.company_id = legacy.company_id
       and membership.user_id = legacy.principal_id
      where legacy.principal_type = 'user'
        and not exists (
          select 1
          from company_memberships admin_membership
          where admin_membership.user_id = legacy.principal_id
            and (
              admin_membership.role = 'dev_admin'
              or (admin_membership.company_id = legacy.company_id and admin_membership.role = 'company_admin')
            )
        )
      union all
      select legacy.company_id,
             legacy.resource_type,
             legacy.resource_id,
             member.user_id,
             1 as subject_rank,
             mangorts_access_level_rank(legacy.access_level) as access_rank,
             legacy.created_timestamp
      from normalized_legacy_grants legacy
      join group_descendants closure
        on closure.company_id = legacy.company_id
       and closure.ancestor_group_id = legacy.principal_id
      join company_user_group_members member
        on member.company_id = closure.company_id
       and member.group_id = closure.descendant_group_id
      join company_memberships membership
        on membership.company_id = legacy.company_id
       and membership.user_id = member.user_id
      where legacy.principal_type = 'group'
        and not exists (
          select 1
          from company_memberships admin_membership
          where admin_membership.user_id = member.user_id
            and (
              admin_membership.role = 'dev_admin'
              or (admin_membership.company_id = legacy.company_id and admin_membership.role = 'company_admin')
            )
        )
    ),
    ranked_grants as (
      select expanded.*,
             row_number() over (
               partition by expanded.company_id, expanded.resource_type, expanded.resource_id, expanded.user_id
               order by expanded.subject_rank desc,
                        expanded.access_rank desc,
                        expanded.created_timestamp desc
             ) as rank
      from expanded_grants expanded
    ),
    legacy_effective as (
      select ranked.company_id,
             ranked.resource_type,
             ranked.resource_id,
             ranked.user_id,
             ranked.access_rank > 0 as has_access,
             ranked.created_timestamp
      from ranked_grants ranked
      where ranked.rank = 1
    ),
    required_overrides as (
      select legacy.company_id,
             legacy.resource_type,
             legacy.resource_id,
             legacy.user_id,
             legacy.created_timestamp
      from legacy_effective legacy
      join resource_defaults resource
        on resource.company_id = legacy.company_id
       and resource.resource_type = legacy.resource_type
       and resource.resource_id = legacy.resource_id
      where (
          coalesce(resource.default_access, 'edit') = 'edit'
          and not legacy.has_access
        )
        or (
          coalesce(resource.default_access, 'edit') = 'no_access'
          and legacy.has_access
        )
    )
    insert into resource_permissions (
      company_id,
      resource_type,
      resource_id,
      user_id,
      created_timestamp,
      updated_timestamp
    )
    select required.company_id,
           required.resource_type,
           required.resource_id,
           required.user_id,
           required.created_timestamp,
           now()
    from required_overrides required
    on conflict (company_id, resource_type, resource_id, user_id) do nothing;
  end if;
end $$;

drop table if exists entity_access_permissions;
drop table if exists resource_access_grants;
