-- Remove the runtime read-version contracts that existed only for Node Map and Logic Gate Map.
-- The shipped migrations that introduced those contracts remain immutable history.
-- Position-table retirement is deliberately separate and human-gated in
-- scripts/retire_map_position_storage.sql.
create or replace function workspace_static_read_version_keys()
returns table(scope text, resource_key text) as $$
  select *
  from (values
    ('workspace-snapshot:full', ''),
    ('workspace-snapshot:company_explorer', ''),
    ('workspace-snapshot:company_explorer', 'folder_kind:node'),
    ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
    ('workspace-snapshot:company_explorer', 'folder_kind:communications'),
    ('company-explorer-folder-items', ''),
    ('company-explorer-folder-items', 'item_type:node'),
    ('company-explorer-folder-items', 'item_type:logic_gate'),
    ('nodes', ''),
    ('node-relationships', ''),
    ('logic-gates', ''),
    ('logic-gate-relationships', ''),
    ('kanban-boards', '')
  ) as keys(scope, resource_key)
$$ language sql immutable;

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
      ('node-relationships', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_created', 'logic_gate_updated', 'logic_gate_deleted', 'logic_gate_raci_updated', 'logic_gate_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gates', ''),
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
      ('logic-gate-relationships', '')
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
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif folder_kind = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
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
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif item_type = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
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
-- Remove only obsolete map-specific read-version rows. Retained scopes are left intact.
delete from workspace_read_versions
where scope in (
  'workspace-snapshot:node_map',
  'workspace-snapshot:node_map_window',
  'workspace-snapshot:logic_gate_map',
  'workspace-snapshot:logic_gate_map_window',
  'map-layout:node',
  'map-layout:node-window',
  'map-layout:logic_gate',
  'map-layout:logic_gate-window'
);

insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
select company.company_id, key.scope, key.resource_key, 0, now()
from companies company
cross join workspace_static_read_version_keys() key
on conflict (company_id, scope, resource_key) do nothing;