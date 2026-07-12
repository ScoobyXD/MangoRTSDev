-- Logic Gate Arena/Kanban hot-read versioning. Do not apply from an agent session.

alter table if exists kanban_board_projection
  add column if not exists status_rank smallint generated always as (
    case
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('requested', 'request', 'requests', 'r') then 0
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('backlog', 'backlogs', 'b') then 1
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('pending', 'p') then 2
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 3
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) = 'review' then 4
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('done', 'd') then 5
      else 2
    end
  ) stored;

drop index if exists idx_kanban_board_projection_hot_read;
create index if not exists idx_kanban_board_projection_hot_read
  on kanban_board_projection(
    company_id, logic_gate_id, status_rank, position,
    assignment_created_timestamp, assignment_id
  );

create table if not exists logic_gate_work_versions (
  company_id uuid not null,
  logic_gate_id uuid not null,
  board_id text generated always as ('logic-gate:' || logic_gate_id::text) stored,
  version bigint not null default 1,
  updated_timestamp timestamptz not null default now(),
  constraint logic_gate_work_versions_version_positive_chk check (version > 0),
  primary key (company_id, logic_gate_id),
  constraint logic_gate_work_versions_board_key unique (company_id, board_id),
  constraint logic_gate_work_versions_logic_gate_fkey
    foreign key (company_id, logic_gate_id)
    references logic_gates(company_id, logic_gate_id) on delete cascade
);

insert into logic_gate_work_versions (company_id, logic_gate_id)
select company_id, logic_gate_id from logic_gates
on conflict (company_id, logic_gate_id) do nothing;

create or replace function mangorts_bump_logic_gate_work_version(p_company_id uuid, p_logic_gate_id uuid)
returns void language sql as $$
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select company_id, logic_gate_id, 1, now()
  from logic_gates
  where company_id=p_company_id and logic_gate_id=p_logic_gate_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_logic_gate_work_versions_for_company(p_company_id uuid)
returns void language sql as $$
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select company_id, logic_gate_id, 1, now()
  from logic_gates where company_id=p_company_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_logic_gate_work_versions_for_folder(p_company_id uuid, p_folder_id uuid)
returns void language sql as $$
  with recursive folders(folder_id, path) as (
    select folder_id, array[folder_id]
    from company_explorer_folders
    where company_id=p_company_id and folder_id=p_folder_id
    union all
    select child.folder_id, folders.path || child.folder_id
    from folders
    join company_explorer_folders child
      on child.company_id=p_company_id and child.parent_folder_id=folders.folder_id
    where not child.folder_id=any(folders.path)
  ), gates as (
    select distinct item.target_id
    from folders
    join company_explorer_items item
      on item.company_id=p_company_id
     and item.parent_folder_id=folders.folder_id
     and item.target_type='logic_gate'
  )
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select gate.company_id, gate.logic_gate_id, 1, now()
  from gates
  join logic_gates gate on gate.company_id=p_company_id and gate.logic_gate_id=gates.target_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_logic_gate_work_versions_for_node(p_company_id uuid, p_node_id uuid)
returns void language sql as $$
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select distinct assignment.company_id, assignment.logic_gate_id, 1, now()
  from node_logic_gate_assignments assignment
  join logic_gates gate
    on gate.company_id=assignment.company_id and gate.logic_gate_id=assignment.logic_gate_id
  where assignment.company_id=p_company_id and assignment.node_id=p_node_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_trg_seed_logic_gate_work_version()
returns trigger language plpgsql as $$
begin
  insert into logic_gate_work_versions (company_id, logic_gate_id)
  values (new.company_id, new.logic_gate_id)
  on conflict (company_id, logic_gate_id) do nothing;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_gate_row()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.logic_gate_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.logic_gate_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_version(old.company_id, old.logic_gate_id);
  if (new.company_id, new.logic_gate_id) is distinct from (old.company_id, old.logic_gate_id) then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.logic_gate_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_resource()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    if new.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.resource_id);
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id, old.resource_id);
    end if;
    return old;
  end if;
  if old.resource_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.resource_id);
  end if;
  if (new.company_id, new.resource_type, new.resource_id)
       is distinct from (old.company_id, old.resource_type, old.resource_id)
     and new.resource_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.resource_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_permission_application()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    if new.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.ancestor_resource_id);
    elsif new.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_logic_gate_work_versions_for_folder(new.company_id, new.ancestor_resource_id);
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id, old.ancestor_resource_id);
    elsif old.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_logic_gate_work_versions_for_folder(old.company_id, old.ancestor_resource_id);
    end if;
    return old;
  end if;
  if old.ancestor_resource_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.ancestor_resource_id);
  elsif old.ancestor_resource_type='company_explorer_folder' then
    perform mangorts_bump_logic_gate_work_versions_for_folder(old.company_id, old.ancestor_resource_id);
  end if;
  if (new.company_id, new.ancestor_resource_type, new.ancestor_resource_id)
       is distinct from (old.company_id, old.ancestor_resource_type, old.ancestor_resource_id) then
    if new.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.ancestor_resource_id);
    elsif new.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_logic_gate_work_versions_for_folder(new.company_id, new.ancestor_resource_id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_explorer_item()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    if new.target_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.target_id);
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.target_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id, old.target_id);
    end if;
    return old;
  end if;
  if old.target_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.target_id);
  end if;
  if (new.company_id, new.target_type, new.target_id)
       is distinct from (old.company_id, old.target_type, old.target_id)
     and new.target_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.target_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_explorer_folder()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_versions_for_folder(old.company_id, old.folder_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_versions_for_folder(new.company_id, new.folder_id);
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_for_company()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_logic_gate_work_versions_for_company(new.company_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_versions_for_company(old.company_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_versions_for_company(old.company_id);
  if new.company_id is distinct from old.company_id then
    perform mangorts_bump_logic_gate_work_versions_for_company(new.company_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_node()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_logic_gate_work_versions_for_node(new.company_id, new.node_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_versions_for_node(old.company_id, old.node_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_versions_for_node(old.company_id, old.node_id);
  if (new.company_id, new.node_id) is distinct from (old.company_id, old.node_id) then
    perform mangorts_bump_logic_gate_work_versions_for_node(new.company_id, new.node_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_projection_sequence()
returns trigger language plpgsql as $$
declare
  gate_id uuid;
  gate_text text;
begin
  if tg_op='INSERT' then
    if new.projection_name='kanban_board' and new.projection_scope like 'board:logic-gate:%' then
      gate_text := split_part(substr(new.projection_scope, length('board:logic-gate:')+1), '|', 1);
      begin gate_id := gate_text::uuid; exception when invalid_text_representation then gate_id := null; end;
      if gate_id is not null then
        perform mangorts_bump_logic_gate_work_version(new.company_id, gate_id);
      end if;
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.projection_name='kanban_board' and old.projection_scope like 'board:logic-gate:%' then
      gate_text := split_part(substr(old.projection_scope, length('board:logic-gate:')+1), '|', 1);
      begin gate_id := gate_text::uuid; exception when invalid_text_representation then gate_id := null; end;
      if gate_id is not null then
        perform mangorts_bump_logic_gate_work_version(old.company_id, gate_id);
      end if;
    end if;
    return old;
  end if;
  if old.projection_name='kanban_board' and old.projection_scope like 'board:logic-gate:%' then
    gate_text := split_part(substr(old.projection_scope, length('board:logic-gate:')+1), '|', 1);
    begin gate_id := gate_text::uuid; exception when invalid_text_representation then gate_id := null; end;
    if gate_id is not null then
      perform mangorts_bump_logic_gate_work_version(old.company_id, gate_id);
    end if;
  end if;
  if new.projection_name='kanban_board'
     and new.projection_scope like 'board:logic-gate:%'
     and (new.company_id, new.projection_name, new.projection_scope)
         is distinct from (old.company_id, old.projection_name, old.projection_scope) then
    gate_text := split_part(substr(new.projection_scope, length('board:logic-gate:')+1), '|', 1);
    begin gate_id := gate_text::uuid; exception when invalid_text_representation then gate_id := null; end;
    if gate_id is not null then
      perform mangorts_bump_logic_gate_work_version(new.company_id, gate_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_logic_gate_work_version_seed on logic_gates;
create trigger trg_logic_gate_work_version_seed after insert on logic_gates
for each row execute function mangorts_trg_seed_logic_gate_work_version();
drop trigger if exists trg_logic_gate_work_version_gate on logic_gates;
create trigger trg_logic_gate_work_version_gate after update of header, default_access on logic_gates
for each row execute function mangorts_trg_bump_logic_gate_work_from_gate_row();

drop trigger if exists trg_logic_gate_work_version_permissions on resource_permissions;
create trigger trg_logic_gate_work_version_permissions after insert or update or delete on resource_permissions
for each row execute function mangorts_trg_bump_logic_gate_work_from_resource();
drop trigger if exists trg_logic_gate_work_version_permission_revisions on resource_permission_policy_revisions;
create trigger trg_logic_gate_work_version_permission_revisions after insert or update or delete on resource_permission_policy_revisions
for each row execute function mangorts_trg_bump_logic_gate_work_from_resource();
drop trigger if exists trg_logic_gate_work_version_permission_applications on resource_permission_subtree_applications;
create trigger trg_logic_gate_work_version_permission_applications after insert or update or delete on resource_permission_subtree_applications
for each row execute function mangorts_trg_bump_logic_gate_work_from_permission_application();

drop trigger if exists trg_logic_gate_work_version_gvic on resource_gvic_assignments;
create trigger trg_logic_gate_work_version_gvic after insert or update or delete on resource_gvic_assignments
for each row execute function mangorts_trg_bump_logic_gate_work_from_resource();
drop trigger if exists trg_logic_gate_work_version_gvic_revisions on resource_gvic_policy_revisions;
create trigger trg_logic_gate_work_version_gvic_revisions after insert or update or delete on resource_gvic_policy_revisions
for each row execute function mangorts_trg_bump_logic_gate_work_from_resource();

drop trigger if exists trg_logic_gate_work_version_explorer_items on company_explorer_items;
create trigger trg_logic_gate_work_version_explorer_items after insert or update or delete on company_explorer_items
for each row execute function mangorts_trg_bump_logic_gate_work_from_explorer_item();
drop trigger if exists trg_logic_gate_work_version_explorer_folder_update on company_explorer_folders;
create trigger trg_logic_gate_work_version_explorer_folder_update after update of parent_folder_id, default_access on company_explorer_folders
for each row execute function mangorts_trg_bump_logic_gate_work_from_explorer_folder();
drop trigger if exists trg_logic_gate_work_version_explorer_folder_delete on company_explorer_folders;
create trigger trg_logic_gate_work_version_explorer_folder_delete before delete on company_explorer_folders
for each row execute function mangorts_trg_bump_logic_gate_work_from_explorer_folder();

drop trigger if exists trg_logic_gate_work_version_memberships on company_memberships;
create trigger trg_logic_gate_work_version_memberships after insert or update or delete on company_memberships
for each row execute function mangorts_trg_bump_logic_gate_work_for_company();
drop trigger if exists trg_logic_gate_work_version_group_members on company_user_group_members;
create trigger trg_logic_gate_work_version_group_members after insert or update or delete on company_user_group_members
for each row execute function mangorts_trg_bump_logic_gate_work_for_company();
drop trigger if exists trg_logic_gate_work_version_groups on company_user_groups;
create trigger trg_logic_gate_work_version_groups after insert or update or delete on company_user_groups
for each row execute function mangorts_trg_bump_logic_gate_work_for_company();

drop trigger if exists trg_logic_gate_work_version_assignments on node_logic_gate_assignments;
create trigger trg_logic_gate_work_version_assignments after insert or update or delete on node_logic_gate_assignments
for each row execute function mangorts_trg_bump_logic_gate_work_from_gate_row();
drop trigger if exists trg_logic_gate_work_version_projection on kanban_board_projection;
create trigger trg_logic_gate_work_version_projection after insert or update or delete on kanban_board_projection
for each row execute function mangorts_trg_bump_logic_gate_work_from_gate_row();
drop trigger if exists trg_logic_gate_work_version_nodes on nodes;
create trigger trg_logic_gate_work_version_nodes after update of name, due_date, priority on nodes
for each row execute function mangorts_trg_bump_logic_gate_work_from_node();
drop trigger if exists trg_logic_gate_work_version_email_origin on communications_email_nodes;
create trigger trg_logic_gate_work_version_email_origin after insert or update or delete on communications_email_nodes
for each row execute function mangorts_trg_bump_logic_gate_work_from_gate_row();
drop trigger if exists trg_logic_gate_work_version_projection_sequence on company_projection_sequences;
create trigger trg_logic_gate_work_version_projection_sequence after insert or update or delete on company_projection_sequences
for each row execute function mangorts_trg_bump_logic_gate_work_from_projection_sequence();
