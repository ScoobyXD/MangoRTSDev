begin;

do $$
declare
  actual_column_count integer;
  missing_column_count integer;
  extra_column_count integer;
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: Process Map requires PostgreSQL 17 or newer';
  end if;

  if to_regclass('public.logic_gate_relationships') is not null then
    if to_regclass('public.process_map_placements') is not null
       or to_regclass('public.resource_operational_relationships') is not null
       or to_regclass('public.process_map_traces') is not null then
      raise exception 'STOP: old and new Process Map authorities are both present';
    end if;

    with expected(column_name) as (
      values
        ('company_id'),
        ('logic_gate_relationship_id'),
        ('logic_gate_id_a'),
        ('logic_gate_id_b'),
        ('a_position'),
        ('b_position'),
        ('created_timestamp')
    ), actual as (
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'logic_gate_relationships'
    )
    select
      (select count(*) from actual),
      (select count(*) from expected where column_name not in (select column_name from actual)),
      (select count(*) from actual where column_name not in (select column_name from expected))
    into actual_column_count, missing_column_count, extra_column_count;

    if actual_column_count <> 7 or missing_column_count <> 0 or extra_column_count <> 0 then
      raise exception 'STOP: logic_gate_relationships exact unordered column set drifted';
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'logic_gate_relationships'
        and column_name in ('a_position', 'b_position')
        and udt_name <> 'logic_gate_relationship_position'
    ) then
      raise exception 'STOP: logic_gate_relationships position type drifted';
    end if;

    if exists (
      select 1
      from logic_gate_relationships relationship
      left join logic_gates gate_a
        on gate_a.company_id = relationship.company_id
       and gate_a.logic_gate_id = relationship.logic_gate_id_a
      left join logic_gates gate_b
        on gate_b.company_id = relationship.company_id
       and gate_b.logic_gate_id = relationship.logic_gate_id_b
      where relationship.logic_gate_id_a = relationship.logic_gate_id_b
         or gate_a.logic_gate_id is null
         or gate_b.logic_gate_id is null
         or not (
           (relationship.a_position::text = 'Output' and relationship.b_position::text = 'Input')
           or (relationship.a_position::text = 'Input' and relationship.b_position::text = 'Output')
         )
    ) then
      raise exception 'STOP: logic_gate_relationships contains an invalid or cross-company row';
    end if;

    if exists (
      select 1
      from logic_gate_relationships relationship
      group by
        relationship.company_id,
        case when relationship.a_position::text = 'Output' then relationship.logic_gate_id_a else relationship.logic_gate_id_b end,
        case when relationship.a_position::text = 'Input' then relationship.logic_gate_id_a else relationship.logic_gate_id_b end
      having count(*) > 1
    ) then
      raise exception 'STOP: logic_gate_relationships contains duplicate directed semantic pairs';
    end if;
  end if;
end $$;

create or replace function mangorts_process_map_route_points_valid(p_route_points jsonb)
returns boolean as $$
declare
  point jsonb;
  point_key_count integer;
  x_text text;
  y_text text;
begin
  if p_route_points is null or jsonb_typeof(p_route_points) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_route_points) > 256 then
    return false;
  end if;
  for point in select value from jsonb_array_elements(p_route_points) loop
    if jsonb_typeof(point) <> 'object' then
      return false;
    end if;
    select count(*) into point_key_count from jsonb_object_keys(point);
    if not (point ? 'x' and point ? 'y') or point_key_count <> 2
       or jsonb_typeof(point->'x') <> 'number'
       or jsonb_typeof(point->'y') <> 'number' then
      return false;
    end if;
    x_text := point->>'x';
    y_text := point->>'y';
    if x_text !~ '^-?(0|[1-9][0-9]*)$' or y_text !~ '^-?(0|[1-9][0-9]*)$' then
      return false;
    end if;
    if x_text::numeric not between -2147483648 and 2147483647
       or y_text::numeric not between -2147483648 and 2147483647 then
      return false;
    end if;
  end loop;
  return true;
end;
$$ language plpgsql immutable;

create table process_map_placements (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  map_parent_folder_id uuid,
  grid_x integer not null,
  grid_y integer not null,
  revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint process_map_placements_resource_type_chk check (resource_type in ('company_explorer_folder', 'logic_gate')),
  constraint process_map_placements_root_folder_chk check (map_parent_folder_id is not null or resource_type = 'company_explorer_folder'),
  constraint process_map_placements_parent_not_self_chk check (
    resource_type <> 'company_explorer_folder' or map_parent_folder_id is null or map_parent_folder_id <> resource_id
  ),
  constraint process_map_placements_revision_positive_chk check (revision > 0),
  constraint process_map_placements_timestamps_chk check (updated_timestamp >= created_timestamp),
  primary key (company_id, resource_type, resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, map_parent_folder_id) references company_explorer_folders(company_id, folder_id) on delete cascade
);

create index idx_process_map_placements_layer
  on process_map_placements(company_id, map_parent_folder_id, resource_type, resource_id);

create table resource_operational_relationships (
  company_id uuid not null,
  resource_operational_relationship_id uuid not null,
  source_resource_type text not null,
  source_resource_id uuid not null,
  target_resource_type text not null,
  target_resource_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint resource_operational_relationships_source_type_chk check (source_resource_type in ('company_explorer_folder', 'logic_gate')),
  constraint resource_operational_relationships_target_type_chk check (target_resource_type in ('company_explorer_folder', 'logic_gate')),
  constraint resource_operational_relationships_not_self_chk check (
    source_resource_type <> target_resource_type or source_resource_id <> target_resource_id
  ),
  primary key (company_id, resource_operational_relationship_id),
  unique (company_id, source_resource_type, source_resource_id, target_resource_type, target_resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade
);

create index idx_resource_operational_relationships_target
  on resource_operational_relationships(
    company_id, target_resource_type, target_resource_id, resource_operational_relationship_id
  );

create table process_map_traces (
  company_id uuid not null,
  resource_operational_relationship_id uuid not null,
  route_points jsonb not null default '[]'::jsonb,
  revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint process_map_traces_route_points_chk check (mangorts_process_map_route_points_valid(route_points)),
  constraint process_map_traces_revision_positive_chk check (revision > 0),
  constraint process_map_traces_timestamps_chk check (updated_timestamp >= created_timestamp),
  primary key (company_id, resource_operational_relationship_id),
  foreign key (company_id, resource_operational_relationship_id)
    references resource_operational_relationships(company_id, resource_operational_relationship_id) on delete cascade
);

create or replace function trg_validate_process_map_placement()
returns trigger as $$
declare
  cycle_found boolean;
  parent_changed boolean;
begin

  parent_changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    parent_changed := new.map_parent_folder_id is distinct from old.map_parent_folder_id;
  end if;

  if new.resource_type = 'company_explorer_folder' and parent_changed then
    perform pg_advisory_xact_lock(hashtextextended('process-map-parent:' || new.company_id::text, 0));
  end if;

  if new.resource_type = 'company_explorer_folder' then
    perform 1
    from company_explorer_folders folder
    where folder.company_id = new.company_id
      and folder.folder_id = new.resource_id
    for key share;
  elsif new.resource_type = 'logic_gate' then
    perform 1
    from logic_gates gate
    where gate.company_id = new.company_id
      and gate.logic_gate_id = new.resource_id
    for key share;
  else
    raise exception 'invalid_process_map_resource_type' using errcode='23514';
  end if;
  if not found then
    raise exception 'process_map_resource_not_found' using errcode='23503';
  end if;

  if new.map_parent_folder_id is not null then
    perform 1
    from company_explorer_folders folder
    where folder.company_id = new.company_id
      and folder.folder_id = new.map_parent_folder_id
    for key share;
    if not found then
      raise exception 'process_map_parent_folder_not_found' using errcode='23503';
    end if;
  end if;

  if new.resource_type = 'company_explorer_folder'
     and new.map_parent_folder_id is not null
     and parent_changed then
    with recursive ancestors(folder_id) as (
      select new.map_parent_folder_id
      union
      select placement.map_parent_folder_id
      from ancestors ancestor
      join process_map_placements placement
        on placement.company_id = new.company_id
       and placement.resource_type = 'company_explorer_folder'
       and placement.resource_id = ancestor.folder_id
      where placement.map_parent_folder_id is not null
    )
    select exists(select 1 from ancestors where folder_id = new.resource_id)
    into cycle_found;
    if cycle_found then
      raise exception 'process_map_parent_cycle' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_validate_process_map_placement
before insert or update of company_id, resource_type, resource_id, map_parent_folder_id
on process_map_placements
for each row execute function trg_validate_process_map_placement();

create or replace function trg_validate_resource_operational_relationship()
returns trigger as $$
declare
  locked_count integer;
begin
  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.resource_operational_relationship_id is distinct from old.resource_operational_relationship_id
    or new.source_resource_type is distinct from old.source_resource_type
    or new.source_resource_id is distinct from old.source_resource_id
    or new.target_resource_type is distinct from old.target_resource_type
    or new.target_resource_id is distinct from old.target_resource_id
  ) then
    raise exception 'process_map_relationship_endpoints_immutable' using errcode='23514';
  end if;

  if new.source_resource_type not in ('company_explorer_folder', 'logic_gate')
     or new.target_resource_type not in ('company_explorer_folder', 'logic_gate') then
    raise exception 'invalid_process_map_resource_type' using errcode='23514';
  end if;
  if new.source_resource_type = new.target_resource_type
     and new.source_resource_id = new.target_resource_id then
    raise exception 'process_map_relationship_self_edge' using errcode='23514';
  end if;

  if new.source_resource_type = 'company_explorer_folder'
     and new.target_resource_type = 'company_explorer_folder' then
    perform 1 from company_explorer_folders
    where company_id = new.company_id
      and folder_id in (new.source_resource_id, new.target_resource_id)
    order by folder_id for key share;
    get diagnostics locked_count = row_count;
    if locked_count <> 2 then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
  elsif new.source_resource_type = 'logic_gate'
        and new.target_resource_type = 'logic_gate' then
    perform 1 from logic_gates
    where company_id = new.company_id
      and logic_gate_id in (new.source_resource_id, new.target_resource_id)
    order by logic_gate_id for key share;
    get diagnostics locked_count = row_count;
    if locked_count <> 2 then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
  else
    perform 1 from company_explorer_folders
    where company_id = new.company_id
      and folder_id = case
        when new.source_resource_type = 'company_explorer_folder' then new.source_resource_id
        else new.target_resource_id
      end
    for key share;
    if not found then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
    perform 1 from logic_gates
    where company_id = new.company_id
      and logic_gate_id = case
        when new.source_resource_type = 'logic_gate' then new.source_resource_id
        else new.target_resource_id
      end
    for key share;
    if not found then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_validate_resource_operational_relationship
before insert or update
on resource_operational_relationships
for each row execute function trg_validate_resource_operational_relationship();

create or replace function trg_cleanup_process_map_source_delete()
returns trigger as $$
declare
  deleted_company_id uuid := (to_jsonb(old)->>'company_id')::uuid;
  deleted_resource_type text;
  deleted_resource_id uuid;
begin
  if tg_table_name = 'company_explorer_folders' then
    deleted_resource_type := 'company_explorer_folder';
    deleted_resource_id := (to_jsonb(old)->>'folder_id')::uuid;

    delete from process_map_traces trace
    using resource_operational_relationships relationship
    where trace.company_id = deleted_company_id
      and trace.company_id = relationship.company_id
      and trace.resource_operational_relationship_id = relationship.resource_operational_relationship_id
      and exists (
        select 1
        from process_map_placements placement
        where placement.company_id = deleted_company_id
          and placement.map_parent_folder_id = deleted_resource_id
          and (
            (relationship.source_resource_type = placement.resource_type
             and relationship.source_resource_id = placement.resource_id)
            or
            (relationship.target_resource_type = placement.resource_type
             and relationship.target_resource_id = placement.resource_id)
          )
      );
  elsif tg_table_name = 'logic_gates' then
    deleted_resource_type := 'logic_gate';
    deleted_resource_id := (to_jsonb(old)->>'logic_gate_id')::uuid;
  else
    raise exception 'unsupported_process_map_cleanup_source' using errcode='23514';
  end if;

  delete from resource_operational_relationships relationship
  where relationship.company_id = deleted_company_id
    and (
      (relationship.source_resource_type = deleted_resource_type
       and relationship.source_resource_id = deleted_resource_id)
      or
      (relationship.target_resource_type = deleted_resource_type
       and relationship.target_resource_id = deleted_resource_id)
    );

  delete from process_map_placements placement
  where placement.company_id = deleted_company_id
    and (
      (placement.resource_type = deleted_resource_type
       and placement.resource_id = deleted_resource_id)
      or
      (deleted_resource_type = 'company_explorer_folder'
       and placement.map_parent_folder_id = deleted_resource_id)
    );
  return old;
end;
$$ language plpgsql;

create trigger trg_cleanup_process_map_folder_delete
before delete on company_explorer_folders
for each row execute function trg_cleanup_process_map_source_delete();

create trigger trg_cleanup_process_map_logic_gate_delete
before delete on logic_gates
for each row execute function trg_cleanup_process_map_source_delete();

do $$
begin
  if to_regclass('public.logic_gate_relationships') is not null then
    insert into resource_operational_relationships (
      company_id,
      resource_operational_relationship_id,
      source_resource_type,
      source_resource_id,
      target_resource_type,
      target_resource_id,
      created_timestamp
    )
    select
      relationship.company_id,
      relationship.logic_gate_relationship_id,
      'logic_gate',
      case when relationship.a_position::text = 'Output' then relationship.logic_gate_id_a else relationship.logic_gate_id_b end,
      'logic_gate',
      case when relationship.a_position::text = 'Input' then relationship.logic_gate_id_a else relationship.logic_gate_id_b end,
      relationship.created_timestamp
    from logic_gate_relationships relationship;

    drop table logic_gate_relationships;
  end if;
  if exists (select 1 from pg_type where typname = 'logic_gate_relationship_position') then
    drop type logic_gate_relationship_position;
  end if;
end $$;

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
    ('process-map', ''),
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
    'logic_gate_permissions_updated', 'company_explorer_folder_updated',
    'company_explorer_folder_deleted', 'company_explorer_folder_permissions_updated',
	'company_explorer_item_placed', 'company_explorer_item_removed',
    'company_user_group_updated', 'company_user_group_deleted', 'company_user_group_members_updated',
    'company_membership_saved', 'company_membership_deleted'
  ]::text[])
  or (
    p_event_type in ('logic_gate_created', 'company_explorer_folder_created')
    and btrim(coalesce(p_payload->>'realtime_change_type', '')) = 'resource_restored'
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

-- Company Explorer item parentage is policy parentage. A root item has no
-- parent link, while detaching an inherited item must first preserve its
-- effective policy as a root customization.
create or replace function mangorts_v2_company_item_parent_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.target_type in ('logic_gate','project') then
    if tg_op='DELETE' then
      perform mangorts_v2_materialize_detached_policy(old.company_id,old.target_type,old.target_id);
    elsif old.parent_folder_id is not null and new.parent_folder_id is null then
      perform mangorts_v2_materialize_detached_policy(old.company_id,old.target_type,old.target_id);
    end if;
  end if;
  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_company_item_parent_saved()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.target_type in ('logic_gate','project') and tg_op='INSERT' then
    perform mangorts_v2_advance_parent_link(
      new.company_id,new.target_type,new.target_id,new.parent_folder_id is null
    );
  elsif new.target_type in ('logic_gate','project')
     and old.parent_folder_id is distinct from new.parent_folder_id then
    perform mangorts_v2_advance_parent_link(
      new.company_id,new.target_type,new.target_id,new.parent_folder_id is null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_v2_company_item_policy_parent_before_update on company_explorer_items;
create trigger trg_v2_company_item_policy_parent_before_update
before update of parent_folder_id on company_explorer_items
for each row execute function mangorts_v2_company_item_parent_changed();

-- Resource defaults apply only to current company members. A UUID that has no
-- membership must never gain access merely because a policy default is Edit.
create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive resolved as (
    select * from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id)
  ),
  company_actor as (
    select exists (
      select 1 from company_memberships membership
      where membership.user_id=p_user_id
        and (membership.role='dev_admin' or membership.company_id=p_company_id)
    ) as allowed
  ),
  admin_actor as (
    select exists (
      select 1 from company_memberships membership
      where membership.user_id=p_user_id
        and (
          membership.role='dev_admin'
          or (membership.company_id=p_company_id and membership.role='company_admin')
        )
    ) as allowed
  ),
  direct_rule as (
    select access.access_level
    from resolved
    join resource_permissions access
      on access.company_id=p_company_id
     and access.resource_type=resolved.source_resource_type
     and access.resource_id=resolved.source_resource_id
     and access.subject_type='user'
     and access.subject_id=p_user_id
    limit 1
  ),
  member_groups(group_id,depth,path) as (
    select member.group_id,0,array[member.group_id]
    from company_user_group_members member
    where member.company_id=p_company_id and member.user_id=p_user_id
    union all
    select parent.parent_group_id,member.depth+1,member.path || parent.parent_group_id
    from member_groups member
    join company_user_groups parent
      on parent.company_id=p_company_id and parent.group_id=member.group_id
    where parent.parent_group_id is not null
      and member.depth<100
      and not parent.parent_group_id=any(member.path)
  ),
  group_rule as (
    select access.access_level
    from resolved
    join resource_permissions access
      on access.company_id=p_company_id
     and access.resource_type=resolved.source_resource_type
     and access.resource_id=resolved.source_resource_id
     and access.subject_type='group'
    join member_groups membership on membership.group_id=access.subject_id
    order by membership.depth,
             case access.access_level when 'no_access' then 0 else 1 end,
             access.subject_id
    limit 1
  ),
  selected_access as (
    select coalesce(
      (select access_level from direct_rule),
      (select access_level from group_rule),
      (select setting.default_access
       from resolved
       join resource_permission_settings setting
         on setting.company_id=p_company_id
        and setting.resource_type=resolved.source_resource_type
        and setting.resource_id=resolved.source_resource_id)
    ) as access_level
  )
  select case
    when p_access_level<>'edit' then false
    when not (select allowed from company_actor) then false
    when (select allowed from admin_actor) then true
    else coalesce((select access_level='edit' from selected_access),false)
  end;
$$;

delete from workspace_read_versions where scope = 'logic-gate-relationships';
insert into workspace_read_versions(company_id, scope, resource_key, version, updated_timestamp)
select company_id, 'process-map', '', 0, now()
from companies
on conflict (company_id, scope, resource_key) do nothing;

commit;
