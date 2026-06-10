-- Projects are first-class workspace entities. Source tables keep the durable
-- writes; projection tables denormalize editor blocks and project relationships
-- for hot reads.
create table if not exists projects (
  company_id uuid not null,
  project_id uuid not null,
  name text not null,
  status text not null default 'Active',
  account_id uuid,
  team_id uuid,
  default_access text not null default 'edit',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint projects_name_nonblank_chk check (btrim(name) <> ''),
  constraint projects_status_nonblank_chk check (btrim(status) <> ''),
  constraint projects_default_access_chk check (default_access in ('edit', 'no_access')),
  primary key (company_id, project_id),
  foreign key (company_id) references companies(company_id) on delete cascade
);

create index if not exists idx_projects_company_name
  on projects(company_id, lower(name), project_id);

create index if not exists idx_projects_account
  on projects(company_id, account_id, lower(name), project_id)
  where account_id is not null;

create index if not exists idx_projects_team
  on projects(company_id, team_id, lower(name), project_id)
  where team_id is not null;

create table if not exists project_information (
  company_id uuid not null,
  information_id uuid not null,
  project_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_information_project
  on project_information(company_id, project_id, created_timestamp, information_id);

create table if not exists project_projection_table (
  company_id uuid not null,
  project_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_projection_table_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, project_id, information_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_projection_table_project_created
  on project_projection_table(company_id, project_id, type, created_timestamp desc, information_id);

create table if not exists project_relationships (
  company_id uuid not null,
  relationship_id uuid not null,
  project_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_relationships_resource_type_chk check (resource_type in ('logic_gate', 'node')),
  primary key (company_id, relationship_id),
  unique (company_id, project_id, resource_type, resource_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_relationships_project_position
  on project_relationships(company_id, project_id, position, relationship_id);

create index if not exists idx_project_relationships_resource
  on project_relationships(company_id, resource_type, resource_id, project_id);

create table if not exists project_relationship_projection (
  company_id uuid not null,
  project_id uuid not null,
  relationship_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  logic_gate_id uuid,
  node_id uuid,
  display_title text not null,
  status text,
  status_color text,
  position integer not null default 0,
  resource_created_timestamp timestamptz not null,
  relationship_created_timestamp timestamptz not null,
  relationship_updated_timestamp timestamptz not null,
  projection_updated_timestamp timestamptz not null default now(),
  constraint project_relationship_projection_resource_type_chk check (resource_type in ('logic_gate', 'node')),
  constraint project_relationship_projection_title_chk check (btrim(display_title) <> ''),
  constraint project_relationship_projection_target_chk check (
    (resource_type='logic_gate' and logic_gate_id is not null and node_id is null and resource_id=logic_gate_id)
    or (resource_type='node' and node_id is not null and resource_id=node_id)
  ),
  primary key (company_id, relationship_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (company_id, relationship_id) references project_relationships(company_id, relationship_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade
);

create index if not exists idx_project_relationship_projection_project
  on project_relationship_projection(company_id, project_id, position, lower(display_title), relationship_id);

create index if not exists idx_project_relationship_projection_resource
  on project_relationship_projection(company_id, resource_type, resource_id, project_id);

alter table resource_raci_assignments drop constraint if exists resource_raci_assignments_resource_type_chk;
alter table resource_raci_assignments add constraint resource_raci_assignments_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder'));

alter table entity_access_permissions drop constraint if exists entity_access_permissions_entity_type_chk;
alter table entity_access_permissions add constraint entity_access_permissions_entity_type_chk check (entity_type in ('node', 'logic_gate', 'project'));

alter table resource_access_grants drop constraint if exists resource_access_grants_resource_type_chk;
alter table resource_access_grants add constraint resource_access_grants_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder'));

alter table resource_permissions drop constraint if exists resource_permissions_resource_type_chk;
alter table resource_permissions add constraint resource_permissions_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project'));

alter table company_explorer_folders drop constraint if exists company_explorer_folders_kind_chk;
alter table company_explorer_folders add constraint company_explorer_folders_kind_chk check (folder_kind in ('node', 'logic_gate', 'project', 'communications'));

alter table company_explorer_folder_items drop constraint if exists company_explorer_folder_items_type_chk;
alter table company_explorer_folder_items add constraint company_explorer_folder_items_type_chk check (item_type in ('node', 'logic_gate', 'project'));

insert into company_explorer_folders (
  company_id,
  folder_id,
  parent_folder_id,
  folder_kind,
  system_key,
  name,
  position,
  created_timestamp,
  updated_timestamp
)
select
  company_id,
  md5(company_id::text || ':system_folders_v3:active_projects')::uuid,
  null,
  'project',
  'active_projects',
  'Active Projects',
  200,
  now(),
  now()
from companies
on conflict (company_id, system_key) where system_key is not null do nothing;

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
    union all
    select coalesce(project.default_access, 'edit')
    from projects project, normalized_resource normalized
    where normalized.resource_type='project'
      and project.company_id=p_company_id
      and project.project_id=p_resource_id
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
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'shared_triage_folder') then false
    when (select allowed from role_admin_actor) then true
    when normalized_resource.resource_type in ('node', 'logic_gate', 'project')
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

create or replace function workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb)
returns table(scope text, resource_key text) as $$
declare
  board_id text := btrim(coalesce(p_payload->>'board_id', ''));
  folder_kind text := btrim(coalesce(p_payload->>'folder_kind', ''));
  item_type text := btrim(coalesce(p_payload->>'item_type', ''));
begin
  return query select v.scope, v.resource_key from (values
    ('workspace-snapshot:full', '')
  ) as v(scope, resource_key);

  if p_event_type = any(array[
    'node_created',
    'node_updated',
    'node_deleted',
    'kanban_card_upserted',
    'kanban_card_moved',
    'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved',
    'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed',
    'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted',
    'kanban_board_deleted',
    'node_permissions_updated'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('nodes', ''),
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:node')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['node_deleted', 'node_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('company-explorer-folder-items', ''),
      ('company-explorer-folder-items', 'item_type:node')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['relationship_created', 'relationship_deleted', 'node_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('node-relationships', ''),
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'node_map_positions_updated' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:node', ''),
      ('map-layout:node-window', ''),
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'node_deleted' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:node', ''),
      ('map-layout:node-window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_created', 'logic_gate_updated', 'logic_gate_deleted', 'logic_gate_raci_updated', 'logic_gate_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gates', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_deleted', 'logic_gate_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('company-explorer-folder-items', ''),
      ('company-explorer-folder-items', 'item_type:logic_gate')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array[
    'project_created',
    'project_updated',
    'project_deleted',
    'project_information_created',
    'project_information_deleted',
    'project_relationship_upserted',
    'project_relationship_deleted',
    'project_permissions_updated'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('projects', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:project')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['project_deleted', 'project_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('company-explorer-folder-items', ''),
      ('company-explorer-folder-items', 'item_type:project')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_relationship_created', 'logic_gate_relationship_deleted', 'logic_gate_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gate-relationships', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'logic_gate_map_positions_updated' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:logic_gate', ''),
      ('map-layout:logic_gate-window', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'logic_gate_deleted' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:logic_gate', ''),
      ('map-layout:logic_gate-window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array[
    'company_explorer_folder_created',
    'company_explorer_folder_updated',
    'company_explorer_folder_deleted',
    'communications_shared_inbox_raci_updated',
    'shared_triage_access_updated'
  ]::text[]) then
    if folder_kind = 'node' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:node_map', ''),
        ('workspace-snapshot:node_map_window', ''),
        ('map-layout:node-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif folder_kind = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:logic_gate_map', ''),
        ('workspace-snapshot:logic_gate_map_window', ''),
        ('map-layout:logic_gate-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:logic_gate')
      ) as v(scope, resource_key);
    elsif folder_kind = 'project' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:project'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:project')
      ) as v(scope, resource_key);
    elsif folder_kind = 'communications' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', 'folder_kind:communications')
      ) as v(scope, resource_key);
    end if;
  end if;

  if p_event_type = any(array['company_explorer_folder_item_assigned', 'company_explorer_folder_item_removed']::text[]) then
    if item_type = 'node' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:node_map', ''),
        ('workspace-snapshot:node_map_window', ''),
        ('map-layout:node-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif item_type = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:logic_gate_map', ''),
        ('workspace-snapshot:logic_gate_map_window', ''),
        ('map-layout:logic_gate-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:logic_gate')
      ) as v(scope, resource_key);
    elsif item_type = 'project' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:project'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:project')
      ) as v(scope, resource_key);
    end if;
  end if;

  if p_event_type = any(array['kanban_board_saved', 'kanban_board_updated', 'kanban_board_deleted', 'logic_gate_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-boards', '')
    ) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_column_created',
    'kanban_column_updated',
    'kanban_column_deleted',
    'kanban_board_deleted',
    'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-columns', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_card_upserted',
    'kanban_card_moved',
    'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved',
    'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed',
    'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted',
    'kanban_board_deleted',
    'node_deleted',
    'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-cards', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;
end;
$$ language plpgsql immutable;
