create table if not exists workspace_read_versions (
  company_id uuid not null,
  scope text not null,
  resource_key text not null default '',
  version bigint not null default 0,
  updated_timestamp timestamptz not null default now(),
  constraint workspace_read_versions_scope_nonblank_chk check (btrim(scope) <> ''),
  constraint workspace_read_versions_version_nonnegative_chk check (version >= 0),
  primary key (company_id, scope, resource_key)
);

create index if not exists idx_workspace_read_versions_scope_company
  on workspace_read_versions(scope, company_id, resource_key);

create or replace function workspace_static_read_version_keys()
returns table(scope text, resource_key text) as $$
  select *
  from (values
    ('workspace-snapshot:full', ''),
    ('workspace-snapshot:node_map', ''),
    ('workspace-snapshot:node_map_window', ''),
    ('workspace-snapshot:logic_gate_map', ''),
    ('workspace-snapshot:logic_gate_map_window', ''),
    ('workspace-snapshot:company_explorer', ''),
    ('workspace-snapshot:company_explorer', 'folder_kind:node'),
    ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
    ('workspace-snapshot:company_explorer', 'folder_kind:communications'),
    ('nodes', ''),
    ('node-relationships', ''),
    ('logic-gates', ''),
    ('logic-gate-relationships', ''),
    ('map-layout:node', ''),
    ('map-layout:node-window', ''),
    ('map-layout:logic_gate', ''),
    ('map-layout:logic_gate-window', ''),
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
    'kanban_board_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('nodes', ''),
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:node')
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

  if p_event_type = any(array['logic_gate_created', 'logic_gate_updated', 'logic_gate_deleted', 'logic_gate_raci_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gates', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate')
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
    'communications_shared_inbox_raci_updated'
  ]::text[]) then
    if folder_kind = 'node' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:node_map', ''),
        ('workspace-snapshot:node_map_window', ''),
        ('map-layout:node-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node')
      ) as v(scope, resource_key);
    elsif folder_kind = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:logic_gate_map', ''),
        ('workspace-snapshot:logic_gate_map_window', ''),
        ('map-layout:logic_gate-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate')
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
        ('workspace-snapshot:company_explorer', 'folder_kind:node')
      ) as v(scope, resource_key);
    elsif item_type = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:logic_gate_map', ''),
        ('workspace-snapshot:logic_gate_map_window', ''),
        ('map-layout:logic_gate-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate')
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

create or replace function trg_update_workspace_read_versions()
returns trigger as $$
begin
  if new.stream_type <> 'workspace' or new.stream_id <> new.company_id::text then
    return new;
  end if;

  insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
  select new.company_id, key.scope, key.resource_key, 0, new.created_timestamp
  from workspace_static_read_version_keys() key
  on conflict (company_id, scope, resource_key) do nothing;

  insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
  select new.company_id, key.scope, key.resource_key, new.sequence, new.created_timestamp
  from (
    select distinct scope, resource_key
    from workspace_read_version_keys_for_domain_event(new.event_type, new.payload)
  ) key
  on conflict (company_id, scope, resource_key)
  do update set
    version = greatest(workspace_read_versions.version, excluded.version),
    updated_timestamp = greatest(workspace_read_versions.updated_timestamp, excluded.updated_timestamp);

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_update_workspace_read_versions on domain_events;
create trigger trg_update_workspace_read_versions
after insert on domain_events
for each row execute function trg_update_workspace_read_versions();

insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
select company.company_id, key.scope, key.resource_key, 0, now()
from companies company
cross join workspace_static_read_version_keys() key
on conflict (company_id, scope, resource_key) do nothing;

with version_events as (
  select
    event.company_id,
    key.scope,
    key.resource_key,
    max(event.sequence) as version,
    max(event.created_timestamp) as updated_timestamp
  from domain_events event
  cross join lateral (
    select distinct scope, resource_key
    from workspace_read_version_keys_for_domain_event(event.event_type, event.payload)
  ) key
  where event.stream_type = 'workspace'
    and event.stream_id = event.company_id::text
  group by event.company_id, key.scope, key.resource_key
)
insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
select company_id, scope, resource_key, version, updated_timestamp
from version_events
on conflict (company_id, scope, resource_key)
do update set
  version = greatest(workspace_read_versions.version, excluded.version),
  updated_timestamp = greatest(workspace_read_versions.updated_timestamp, excluded.updated_timestamp);
