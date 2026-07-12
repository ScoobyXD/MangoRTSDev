-- Cheap, canonical node-view validators. Do not apply from an agent session.

create table if not exists node_view_versions (
  company_id uuid not null,
  node_id uuid not null,
  version bigint not null default 1,
  updated_timestamp timestamptz not null default now(),
  constraint node_view_versions_version_positive_chk check (version > 0),
  primary key (company_id, node_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade
);

create table if not exists node_view_user_versions (
  company_id uuid not null,
  node_id uuid not null,
  user_id uuid not null,
  version bigint not null default 1,
  updated_timestamp timestamptz not null default now(),
  constraint node_view_user_versions_version_positive_chk check (version > 0),
  primary key (company_id, node_id, user_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (user_id) references users(user_id) on delete cascade
);

insert into node_view_versions(company_id, node_id)
select company_id, node_id from nodes
on conflict (company_id, node_id) do nothing;

create or replace function mangorts_bump_node_view_version(p_company_id uuid, p_node_id uuid)
returns void language sql as $$
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select company_id, node_id, 1, now()
  from nodes
  where company_id=p_company_id and node_id=p_node_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_node_view_user_version(p_company_id uuid, p_node_id uuid, p_user_id uuid)
returns void language sql as $$
  insert into node_view_user_versions(company_id, node_id, user_id, version, updated_timestamp)
  select node.company_id, node.node_id, actor.user_id, 1, now()
  from nodes node
  join users actor on actor.user_id=p_user_id
  where node.company_id=p_company_id and node.node_id=p_node_id
  on conflict (company_id, node_id, user_id) do update set
    version=node_view_user_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_node_view_versions_for_logic_gate(p_company_id uuid, p_logic_gate_id uuid)
returns void language sql as $$
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select distinct assignment.company_id, assignment.node_id, 1, now()
  from node_logic_gate_assignments assignment
  join nodes node on node.company_id=assignment.company_id and node.node_id=assignment.node_id
  where assignment.company_id=p_company_id and assignment.logic_gate_id=p_logic_gate_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_node_view_versions_for_account(p_company_id uuid, p_account_id uuid)
returns void language sql as $$
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select distinct assignment.company_id, assignment.node_id, 1, now()
  from node_account_assignments assignment
  join nodes node on node.company_id=assignment.company_id and node.node_id=assignment.node_id
  where assignment.company_id=p_company_id and assignment.account_id=p_account_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_node_view_versions_for_folder(p_company_id uuid, p_folder_id uuid)
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
  ), affected_nodes(node_id) as (
    select distinct assignment.node_id
    from folders
    join company_explorer_items item
      on item.company_id=p_company_id
     and item.parent_folder_id=folders.folder_id
     and item.target_type='logic_gate'
    join node_logic_gate_assignments assignment
      on assignment.company_id=item.company_id
     and assignment.logic_gate_id=item.target_id
  )
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select node.company_id, node.node_id, 1, now()
  from affected_nodes affected
  join nodes node on node.company_id=p_company_id and node.node_id=affected.node_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_trg_seed_node_view_version()
returns trigger language plpgsql as $$
begin
  insert into node_view_versions(company_id, node_id)
  values (new.company_id, new.node_id)
  on conflict (company_id, node_id) do nothing;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_node()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
    return new;
  elsif tg_op='DELETE' then
    return old;
  end if;
  perform mangorts_bump_node_view_version(old.company_id, old.node_id);
  if (new.company_id, new.node_id) is distinct from (old.company_id, old.node_id) then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_direct_node()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_node_view_version(old.company_id, old.node_id);
    return old;
  end if;
  perform mangorts_bump_node_view_version(old.company_id, old.node_id);
  if (new.company_id, new.node_id) is distinct from (old.company_id, old.node_id) then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_relationship()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_version(old.company_id, old.node_id_a);
    perform mangorts_bump_node_view_version(old.company_id, old.node_id_b);
  end if;
  if tg_op <> 'DELETE' then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id_a);
    perform mangorts_bump_node_view_version(new.company_id, new.node_id_b);
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_user_from_change_seen()
returns trigger language plpgsql as $$
declare
  target_node_id uuid;
begin
  if tg_op <> 'INSERT' then
    select node_id into target_node_id
    from node_content_changes
    where company_id=old.company_id and change_id=old.change_id;
    if target_node_id is not null then
      perform mangorts_bump_node_view_user_version(old.company_id, target_node_id, old.user_id);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    target_node_id := null;
    select node_id into target_node_id
    from node_content_changes
    where company_id=new.company_id and change_id=new.change_id;
    if target_node_id is not null then
      perform mangorts_bump_node_view_user_version(new.company_id, target_node_id, new.user_id);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_user_from_snapshot()
returns trigger language plpgsql as $$
begin
  if current_setting('mangorts.node_view_anchor_clean', true) = '1' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_user_version(old.company_id, old.node_id, old.user_id);
  end if;
  if tg_op <> 'DELETE' then
    if tg_op='INSERT' or (new.company_id, new.node_id, new.user_id) is distinct from (old.company_id, old.node_id, old.user_id) then
      perform mangorts_bump_node_view_user_version(new.company_id, new.node_id, new.user_id);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_account()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_versions_for_account(old.company_id, old.account_id);
  end if;
  if tg_op <> 'DELETE' then
    perform mangorts_bump_node_view_versions_for_account(new.company_id, new.account_id);
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_resource()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    if old.resource_type='node' then
      perform mangorts_bump_node_view_version(old.company_id, old.resource_id);
    elsif old.resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(old.company_id, old.resource_id);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    if new.resource_type='node' then
      perform mangorts_bump_node_view_version(new.company_id, new.resource_id);
    elsif new.resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(new.company_id, new.resource_id);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_permission_application()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    if old.ancestor_resource_type='node' then
      perform mangorts_bump_node_view_version(old.company_id, old.ancestor_resource_id);
    elsif old.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(old.company_id, old.ancestor_resource_id);
    elsif old.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_node_view_versions_for_folder(old.company_id, old.ancestor_resource_id);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    if new.ancestor_resource_type='node' then
      perform mangorts_bump_node_view_version(new.company_id, new.ancestor_resource_id);
    elsif new.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(new.company_id, new.ancestor_resource_id);
    elsif new.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_node_view_versions_for_folder(new.company_id, new.ancestor_resource_id);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_explorer_item()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' and old.target_type='logic_gate' then
    perform mangorts_bump_node_view_versions_for_logic_gate(old.company_id, old.target_id);
  end if;
  if tg_op <> 'DELETE' and new.target_type='logic_gate' then
    perform mangorts_bump_node_view_versions_for_logic_gate(new.company_id, new.target_id);
    return new;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_explorer_folder()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_versions_for_folder(old.company_id, old.folder_id);
  end if;
  if tg_op <> 'DELETE' then
    perform mangorts_bump_node_view_versions_for_folder(new.company_id, new.folder_id);
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_node_view_version_seed on nodes;
create trigger trg_node_view_version_seed after insert on nodes
for each row execute function mangorts_trg_seed_node_view_version();
drop trigger if exists trg_node_view_version_node on nodes;
create trigger trg_node_view_version_node after update on nodes
for each row execute function mangorts_trg_bump_node_view_from_node();

drop trigger if exists trg_node_view_version_information on node_information;
create trigger trg_node_view_version_information after insert or update or delete on node_information
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
drop trigger if exists trg_node_view_version_projection on node_projection_table;
create trigger trg_node_view_version_projection after insert or update or delete on node_projection_table
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
drop trigger if exists trg_node_view_version_content_changes on node_content_changes;
create trigger trg_node_view_version_content_changes after insert or update or delete on node_content_changes
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
drop trigger if exists trg_node_view_version_relationships on node_relationships;
create trigger trg_node_view_version_relationships after insert or update or delete on node_relationships
for each row execute function mangorts_trg_bump_node_view_from_relationship();
drop trigger if exists trg_node_view_version_logic_gate_assignments on node_logic_gate_assignments;
create trigger trg_node_view_version_logic_gate_assignments after insert or update or delete on node_logic_gate_assignments
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
drop trigger if exists trg_node_view_version_account_assignments on node_account_assignments;
create trigger trg_node_view_version_account_assignments after insert or update or delete on node_account_assignments
for each row execute function mangorts_trg_bump_node_view_from_direct_node();

drop trigger if exists trg_node_view_user_version_change_seen_mutation on node_content_change_seen;
create trigger trg_node_view_user_version_change_seen_mutation after insert or update on node_content_change_seen
for each row execute function mangorts_trg_bump_node_view_user_from_change_seen();
drop trigger if exists trg_node_view_user_version_change_seen_delete on node_content_change_seen;
create trigger trg_node_view_user_version_change_seen_delete before delete on node_content_change_seen
for each row execute function mangorts_trg_bump_node_view_user_from_change_seen();
drop trigger if exists trg_node_view_user_version_snapshots on node_projection_seen_snapshots;
create trigger trg_node_view_user_version_snapshots after insert or update or delete on node_projection_seen_snapshots
for each row execute function mangorts_trg_bump_node_view_user_from_snapshot();

drop trigger if exists trg_node_view_version_accounts_update on accounts;
create trigger trg_node_view_version_accounts_update after update on accounts
for each row execute function mangorts_trg_bump_node_view_from_account();
drop trigger if exists trg_node_view_version_accounts_delete on accounts;
create trigger trg_node_view_version_accounts_delete before delete on accounts
for each row execute function mangorts_trg_bump_node_view_from_account();

drop trigger if exists trg_node_view_version_gvic_assignments on resource_gvic_assignments;
create trigger trg_node_view_version_gvic_assignments after insert or update or delete on resource_gvic_assignments
for each row execute function mangorts_trg_bump_node_view_from_resource();
drop trigger if exists trg_node_view_version_permissions on resource_permissions;
create trigger trg_node_view_version_permissions after insert or update or delete on resource_permissions
for each row execute function mangorts_trg_bump_node_view_from_resource();
drop trigger if exists trg_node_view_version_permission_revisions on resource_permission_policy_revisions;
create trigger trg_node_view_version_permission_revisions after insert or update or delete on resource_permission_policy_revisions
for each row execute function mangorts_trg_bump_node_view_from_resource();
drop trigger if exists trg_node_view_version_permission_applications on resource_permission_subtree_applications;
create trigger trg_node_view_version_permission_applications after insert or update or delete on resource_permission_subtree_applications
for each row execute function mangorts_trg_bump_node_view_from_permission_application();

drop trigger if exists trg_node_view_version_explorer_items on company_explorer_items;
create trigger trg_node_view_version_explorer_items after insert or update or delete on company_explorer_items
for each row execute function mangorts_trg_bump_node_view_from_explorer_item();
drop trigger if exists trg_node_view_version_explorer_folder_update on company_explorer_folders;
create trigger trg_node_view_version_explorer_folder_update after update of parent_folder_id, default_access on company_explorer_folders
for each row execute function mangorts_trg_bump_node_view_from_explorer_folder();
drop trigger if exists trg_node_view_version_explorer_folder_delete on company_explorer_folders;
create trigger trg_node_view_version_explorer_folder_delete before delete on company_explorer_folders
for each row execute function mangorts_trg_bump_node_view_from_explorer_folder();