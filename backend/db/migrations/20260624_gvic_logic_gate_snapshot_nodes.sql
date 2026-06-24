with linked_nodes as (
  select distinct on (assignment.company_id, assignment.node_id)
    assignment.company_id,
    assignment.node_id,
    assignment.logic_gate_id
  from node_logic_gate_assignments assignment
  order by
    assignment.company_id,
    assignment.node_id,
    assignment.updated_timestamp desc,
    assignment.created_timestamp desc,
    assignment.assignment_id desc
)
delete from resource_gvic_assignments node_assignment
using linked_nodes
where node_assignment.company_id=linked_nodes.company_id
  and node_assignment.resource_type='node'
  and node_assignment.resource_id=linked_nodes.node_id;

with linked_nodes as (
  select distinct on (assignment.company_id, assignment.node_id)
    assignment.company_id,
    assignment.node_id,
    assignment.logic_gate_id
  from node_logic_gate_assignments assignment
  order by
    assignment.company_id,
    assignment.node_id,
    assignment.updated_timestamp desc,
    assignment.created_timestamp desc,
    assignment.assignment_id desc
)
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
  source.company_id,
  'node',
  linked_nodes.node_id,
  source.role,
  source.principal_type,
  source.principal_id,
  now(),
  now()
from linked_nodes
join resource_gvic_assignments source
  on source.company_id=linked_nodes.company_id
 and source.resource_type='logic_gate'
 and source.resource_id=linked_nodes.logic_gate_id
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id) do nothing;

with linked_nodes as (
  select distinct on (assignment.company_id, assignment.node_id)
    assignment.company_id,
    assignment.node_id
  from node_logic_gate_assignments assignment
  order by
    assignment.company_id,
    assignment.node_id,
    assignment.updated_timestamp desc,
    assignment.created_timestamp desc,
    assignment.assignment_id desc
)
delete from resource_gvic_effective_assignments effective
using linked_nodes
where effective.company_id=linked_nodes.company_id
  and effective.resource_type='node'
  and effective.resource_id=linked_nodes.node_id;

with linked_nodes as (
  select distinct on (assignment.company_id, assignment.node_id)
    assignment.company_id,
    assignment.node_id
  from node_logic_gate_assignments assignment
  order by
    assignment.company_id,
    assignment.node_id,
    assignment.updated_timestamp desc,
    assignment.created_timestamp desc,
    assignment.assignment_id desc
),
node_source as (
  select source.*
  from linked_nodes
  join resource_gvic_assignments source
    on source.company_id=linked_nodes.company_id
   and source.resource_type='node'
   and source.resource_id=linked_nodes.node_id
),
direct_user_rows as (
  select
    source.company_id,
    source.resource_type,
    source.resource_id,
    source.role,
    source.principal_id as user_id,
    source.resource_type as source_resource_type,
    source.resource_id as source_resource_id,
    source.principal_type as source_principal_type,
    source.principal_id as source_principal_id,
    'direct'::text as inheritance_type
  from node_source source
  join company_memberships membership
    on membership.company_id=source.company_id
   and membership.user_id=source.principal_id
  where source.principal_type='user'
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
  from node_source source
  join company_user_group_closure closure
    on closure.company_id=source.company_id
   and closure.ancestor_group_id=source.principal_id
  join company_user_group_members member
    on member.company_id=closure.company_id
   and member.group_id=closure.descendant_group_id
  join company_memberships membership
    on membership.company_id=member.company_id
   and membership.user_id=member.user_id
  where source.principal_type='group'
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
  gvic_resource_lookup(resource_type, resource_id) as (
    select
      case
        when normalized.resource_type='shared_inbox_folder' then 'shared_triage_folder'
        else normalized.resource_type
      end,
      p_resource_id
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
