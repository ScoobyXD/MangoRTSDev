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
  linked_node_logic_gate(logic_gate_id) as (
    select assignment.logic_gate_id
    from node_logic_gate_assignments assignment, normalized_resource normalized
    where normalized.resource_type='node'
      and assignment.company_id=p_company_id
      and assignment.node_id=p_resource_id
    order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
    limit 1
  ),
  gvic_resource_lookup(resource_type, resource_id) as (
    select
      case
        when normalized.resource_type='node' and exists (select 1 from linked_node_logic_gate) then 'logic_gate'
        when normalized.resource_type='shared_inbox_folder' then 'shared_triage_folder'
        else normalized.resource_type
      end,
      case
        when normalized.resource_type='node' and exists (select 1 from linked_node_logic_gate) then (select logic_gate_id from linked_node_logic_gate limit 1)
        else p_resource_id
      end
    from normalized_resource normalized
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
    join gvic_resource_lookup lookup
      on lookup.resource_type = gvic.resource_type
     and lookup.resource_id = gvic.resource_id
    where gvic.company_id=p_company_id
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