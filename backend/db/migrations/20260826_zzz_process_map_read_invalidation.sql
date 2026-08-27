-- Keep Process Map tile versions current when automatic placements or card summaries change.
-- PostgreSQL 17.x compatible.

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
    'node_created', 'node_updated', 'node_deleted',
    'kanban_card_upserted', 'kanban_card_moved', 'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved', 'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed', 'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted', 'kanban_board_deleted', 'node_permissions_updated'
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
    return query select v.scope, v.resource_key from (values ('node-relationships', '')) as v(scope, resource_key);
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
    'project_created', 'project_updated', 'project_deleted', 'project_information_created',
    'project_information_deleted', 'project_relationship_upserted', 'project_relationship_deleted',
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

  if p_event_type = any(array[
    'process_map_placement_saved', 'process_map_placement_deleted',
    'resource_operational_relationship_created', 'resource_operational_relationship_deleted',
    'process_map_trace_saved', 'logic_gate_updated', 'logic_gate_deleted',
    'logic_gate_gvic_updated', 'logic_gate_qd_rating_updated',
    'logic_gate_permissions_updated', 'company_explorer_folder_created',
    'company_explorer_folder_updated', 'company_explorer_folder_deleted',
    'company_explorer_folder_permissions_updated',
    'company_explorer_item_placed', 'company_explorer_item_removed',
    'company_user_group_updated', 'company_user_group_deleted', 'company_user_group_members_updated',
    'company_membership_saved', 'company_membership_deleted', 'company_user_profile_updated'
  ]::text[])
  or (
    p_event_type='logic_gate_created'
    and btrim(coalesce(p_payload->>'realtime_change_type', ''))='resource_restored'
  )
  or (
    p_event_type='resource_gvic_policy_updated'
    and btrim(coalesce(p_payload->>'resource_type', ''))='company_explorer_folder'
  ) then
    return query select v.scope, v.resource_key from (values ('process-map', '')) as v(scope, resource_key);
  end if;

  if p_event_type = any(array[
    'company_explorer_folder_created', 'company_explorer_folder_updated',
    'company_explorer_folder_deleted', 'communications_shared_inbox_raci_updated',
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
    return query select v.scope, v.resource_key from (values ('kanban-boards', '')) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_column_created', 'kanban_column_updated', 'kanban_column_deleted',
    'kanban_board_deleted', 'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-columns', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_card_upserted', 'kanban_card_moved', 'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved', 'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed', 'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted', 'kanban_board_deleted', 'node_deleted', 'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-cards', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;
end;
$$ language plpgsql immutable;
