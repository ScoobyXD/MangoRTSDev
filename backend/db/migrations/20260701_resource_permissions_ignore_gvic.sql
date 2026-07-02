begin;

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
  permission_access(access_level) as (
    select candidate.access_level
    from (
      select access.access_level, 0 as source_rank, 0 as group_depth, mangorts_access_level_rank(access.access_level) as access_rank
      from resource_permissions access
      join normalized_resource normalized
        on normalized.resource_type=access.resource_type
      where access.company_id=p_company_id
        and access.resource_id=p_resource_id
        and access.subject_type='user'
        and access.subject_id=p_user_id
      union all
      select access.access_level, 1 as source_rank, min(closure.depth) as group_depth, mangorts_access_level_rank(access.access_level) as access_rank
      from resource_permissions access
      join normalized_resource normalized
        on normalized.resource_type=access.resource_type
      join company_user_group_closure closure
        on closure.company_id=access.company_id
       and closure.ancestor_group_id=access.subject_id
      join company_user_group_members member
        on member.company_id=closure.company_id
       and member.group_id=closure.descendant_group_id
       and member.user_id=p_user_id
      where access.company_id=p_company_id
        and access.resource_id=p_resource_id
        and access.subject_type='group'
      group by access.access_level
      union all
      select default_access, 2 as source_rank, 0 as group_depth, mangorts_access_level_rank(default_access) as access_rank
      from normalized_resource_row
    ) candidate
    order by candidate.source_rank asc, candidate.group_depth asc, candidate.access_rank asc
    limit 1
  )
  select case
    when requested.required_rank = 0 then false
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false
    when (select allowed from role_admin_actor) then true
    when not exists (select 1 from permission_access) then false
    when (select mangorts_access_level_rank(access_level) from permission_access limit 1) = 0 then false
    when exists (
        select 1
        from company_memberships membership
        where membership.company_id = p_company_id
          and membership.user_id = p_user_id
      )
      and (select mangorts_access_level_rank(access_level) from permission_access limit 1) >= requested.required_rank then true
    else false
  end
  from requested, normalized_resource;
$$ language sql stable;

commit;
