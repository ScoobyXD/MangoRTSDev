-- Phase 1 of the V2 Company Explorer refactor.
-- This migration is intentionally non-destructive: the legacy Company Explorer
-- folder, item, share, and seed tables remain in place for Phase 2.

create or replace function mangorts_try_uuid(p_value text)
returns uuid as $$
begin
  return nullif(btrim(coalesce(p_value, '')), '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$$ language plpgsql immutable;

create or replace function mangorts_company_explorer_v2_entity_id(
  p_company_id uuid,
  p_entity_type text,
  p_resource_id uuid
)
returns uuid as $$
  select md5(
    p_company_id::text || ':company_explorer_v2_entity:' ||
    lower(btrim(p_entity_type)) || ':' ||
    p_resource_id::text
  )::uuid;
$$ language sql immutable;

create or replace function mangorts_company_explorer_v2_edge_id(
  p_company_id uuid,
  p_parent_entity_id uuid,
  p_child_entity_id uuid
)
returns uuid as $$
  select md5(
    p_company_id::text || ':company_explorer_v2_edge:' ||
    p_parent_entity_id::text || ':' ||
    p_child_entity_id::text
  )::uuid;
$$ language sql immutable;

create table if not exists company_explorer_entities (
  company_id uuid not null,
  entity_id uuid not null,
  entity_type text not null,
  resource_id uuid,
  name text,
  default_access text,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_explorer_entities_type_chk check (
    entity_type in ('company', 'user_group', 'user', 'folder', 'project', 'logic_gate', 'node')
  ),
  constraint company_explorer_entities_resource_shape_chk check (
    (entity_type = 'folder' and resource_id is null)
    or (entity_type <> 'folder' and resource_id is not null)
  ),
  constraint company_explorer_entities_name_nonblank_chk check (name is null or btrim(name) <> ''),
  constraint company_explorer_entities_default_access_chk check (default_access is null or default_access in ('edit', 'no_access')),
  constraint company_explorer_entities_folder_default_access_chk check (
    (entity_type = 'folder' and default_access is not null)
    or (entity_type <> 'folder' and default_access is null)
  ),
  primary key (company_id, entity_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create unique index if not exists idx_company_explorer_entities_native_resource
  on company_explorer_entities(company_id, entity_type, resource_id)
  where resource_id is not null;

create index if not exists idx_company_explorer_entities_type_name
  on company_explorer_entities(company_id, entity_type, lower(name), entity_id);

create table if not exists company_explorer_edges (
  company_id uuid not null,
  edge_id uuid not null,
  parent_entity_id uuid not null,
  child_entity_id uuid not null,
  position integer not null default 1000,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_explorer_edges_not_self_chk check (parent_entity_id <> child_entity_id),
  primary key (company_id, edge_id),
  unique (company_id, parent_entity_id, child_entity_id),
  foreign key (company_id, parent_entity_id) references company_explorer_entities (company_id, entity_id) on delete cascade,
  foreign key (company_id, child_entity_id) references company_explorer_entities (company_id, entity_id) on delete cascade
);

create index if not exists idx_company_explorer_edges_parent_position
  on company_explorer_edges(company_id, parent_entity_id, position, created_timestamp, edge_id);

create index if not exists idx_company_explorer_edges_child
  on company_explorer_edges(company_id, child_entity_id, parent_entity_id);

create or replace function mangorts_prevent_company_explorer_edge_cycle()
returns trigger as $$
begin
  if new.parent_entity_id = new.child_entity_id then
    raise exception 'company_explorer_edges cannot place an entity under itself';
  end if;

  if exists (
    with recursive ancestors(entity_id, path) as (
      select new.parent_entity_id, array[new.parent_entity_id]
      union all
      select edge.parent_entity_id, ancestors.path || edge.parent_entity_id
      from ancestors
      join company_explorer_edges edge
        on edge.company_id = new.company_id
       and edge.child_entity_id = ancestors.entity_id
      where edge.edge_id <> new.edge_id
        and not edge.parent_entity_id = any(ancestors.path)
    )
    select 1
    from ancestors
    where entity_id = new.child_entity_id
  ) then
    raise exception 'company_explorer_edges cycle detected for parent % and child %', new.parent_entity_id, new.child_entity_id;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_company_explorer_edges_prevent_cycle on company_explorer_edges;

create trigger trg_company_explorer_edges_prevent_cycle
  before insert or update of company_id, parent_entity_id, child_entity_id
  on company_explorer_edges
  for each row
  execute function mangorts_prevent_company_explorer_edge_cycle();

insert into company_explorer_entities (
  company_id,
  entity_id,
  entity_type,
  resource_id,
  name,
  default_access,
  created_timestamp,
  updated_timestamp
)
select company.company_id,
       mangorts_company_explorer_v2_entity_id(company.company_id, 'company', company.company_id),
       'company',
       company.company_id,
       company.name,
       null,
       company.created_timestamp,
       company.updated_timestamp
from companies company
on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
  name = excluded.name,
  updated_timestamp = greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp);

insert into company_explorer_entities (
  company_id,
  entity_id,
  entity_type,
  resource_id,
  name,
  default_access,
  created_timestamp,
  updated_timestamp
)
select membership.company_id,
       mangorts_company_explorer_v2_entity_id(membership.company_id, 'user', membership.user_id),
       'user',
       membership.user_id,
       nullif(coalesce(nullif(app_user.display_name, ''), app_user.email), ''),
       null,
       greatest(membership.created_timestamp, app_user.created_timestamp),
       greatest(membership.updated_timestamp, app_user.updated_timestamp)
from company_memberships membership
join users app_user
  on app_user.user_id = membership.user_id
on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
  name = coalesce(excluded.name, company_explorer_entities.name),
  updated_timestamp = greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp);

insert into company_explorer_entities (
  company_id,
  entity_id,
  entity_type,
  resource_id,
  name,
  default_access,
  created_timestamp,
  updated_timestamp
)
select folder.company_id,
       mangorts_company_explorer_v2_entity_id(folder.company_id, 'user', mangorts_try_uuid(folder.scope_id)),
       'user',
       mangorts_try_uuid(folder.scope_id),
       nullif(coalesce(nullif(app_user.display_name, ''), app_user.email), ''),
       null,
       folder.created_timestamp,
       folder.updated_timestamp
from company_explorer_folders folder
left join users app_user
  on app_user.user_id = mangorts_try_uuid(folder.scope_id)
where folder.parent_folder_id is null
  and folder.scope_type = 'user'
  and mangorts_try_uuid(folder.scope_id) is not null
on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
  name = coalesce(excluded.name, company_explorer_entities.name),
  updated_timestamp = greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp);

insert into company_explorer_entities (
  company_id,
  entity_id,
  entity_type,
  resource_id,
  name,
  default_access,
  created_timestamp,
  updated_timestamp
)
select user_group.company_id,
       mangorts_company_explorer_v2_entity_id(user_group.company_id, 'user_group', user_group.group_id),
       'user_group',
       user_group.group_id,
       user_group.name,
       null,
       user_group.created_timestamp,
       user_group.updated_timestamp
from company_user_groups user_group
on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
  name = excluded.name,
  updated_timestamp = greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp);

insert into company_explorer_entities (
  company_id,
  entity_id,
  entity_type,
  resource_id,
  name,
  default_access,
  created_timestamp,
  updated_timestamp
)
select folder.company_id,
       mangorts_company_explorer_v2_entity_id(folder.company_id, 'user_group', mangorts_try_uuid(folder.scope_id)),
       'user_group',
       mangorts_try_uuid(folder.scope_id),
       user_group.name,
       null,
       folder.created_timestamp,
       folder.updated_timestamp
from company_explorer_folders folder
left join company_user_groups user_group
  on user_group.company_id = folder.company_id
 and user_group.group_id = mangorts_try_uuid(folder.scope_id)
where folder.parent_folder_id is null
  and folder.scope_type = 'team'
  and mangorts_try_uuid(folder.scope_id) is not null
on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
  name = coalesce(excluded.name, company_explorer_entities.name),
  updated_timestamp = greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp);

insert into company_explorer_entities (
  company_id,
  entity_id,
  entity_type,
  resource_id,
  name,
  default_access,
  created_timestamp,
  updated_timestamp
)
select folder.company_id,
       folder.folder_id,
       'folder',
       null,
       folder.name,
       folder.default_access,
       folder.created_timestamp,
       folder.updated_timestamp
from company_explorer_folders folder
on conflict (company_id, entity_id) do update set
  entity_type = excluded.entity_type,
  resource_id = excluded.resource_id,
  name = excluded.name,
  default_access = excluded.default_access,
  updated_timestamp = greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp);

with legacy_item_resources as (
  select item.company_id,
         item.item_type as entity_type,
         mangorts_try_uuid(item.item_id) as resource_id,
         min(item.created_timestamp) as created_timestamp,
         max(item.updated_timestamp) as updated_timestamp
  from company_explorer_folder_items item
  where item.item_type in ('node', 'logic_gate', 'project')
    and mangorts_try_uuid(item.item_id) is not null
  group by item.company_id, item.item_type, mangorts_try_uuid(item.item_id)
)
insert into company_explorer_entities (
  company_id,
  entity_id,
  entity_type,
  resource_id,
  name,
  default_access,
  created_timestamp,
  updated_timestamp
)
select resource.company_id,
       mangorts_company_explorer_v2_entity_id(resource.company_id, resource.entity_type, resource.resource_id),
       resource.entity_type,
       resource.resource_id,
       case resource.entity_type
         when 'node' then node.title
         when 'logic_gate' then logic_gate.header
         when 'project' then project.name
         else null
       end,
       null,
       coalesce(node.created_timestamp, logic_gate.created_timestamp, project.created_timestamp, resource.created_timestamp),
       coalesce(project.updated_timestamp, resource.updated_timestamp)
from legacy_item_resources resource
left join nodes node
  on resource.entity_type = 'node'
 and node.company_id = resource.company_id
 and node.node_id = resource.resource_id
left join logic_gates logic_gate
  on resource.entity_type = 'logic_gate'
 and logic_gate.company_id = resource.company_id
 and logic_gate.logic_gate_id = resource.resource_id
left join projects project
  on resource.entity_type = 'project'
 and project.company_id = resource.company_id
 and project.project_id = resource.resource_id
on conflict (company_id, entity_type, resource_id) where resource_id is not null do update set
  name = coalesce(excluded.name, company_explorer_entities.name),
  updated_timestamp = greatest(company_explorer_entities.updated_timestamp, excluded.updated_timestamp);

with root_folders as (
  select folder.company_id,
         folder.folder_id,
         folder.scope_type,
         mangorts_try_uuid(folder.scope_id) as scope_resource_id,
         folder.position,
         folder.created_timestamp,
         folder.updated_timestamp
  from company_explorer_folders folder
  where folder.parent_folder_id is null
),
root_edges as (
  select root.company_id,
         coalesce(scoped_root.entity_id, company_root.entity_id) as parent_entity_id,
         root.folder_id as child_entity_id,
         root.position,
         root.created_timestamp,
         root.updated_timestamp
  from root_folders root
  join company_explorer_entities company_root
    on company_root.company_id = root.company_id
   and company_root.entity_type = 'company'
   and company_root.resource_id = root.company_id
  left join company_explorer_entities scoped_root
    on scoped_root.company_id = root.company_id
   and (
     (root.scope_type = 'user' and scoped_root.entity_type = 'user' and scoped_root.resource_id = root.scope_resource_id)
     or (root.scope_type = 'team' and scoped_root.entity_type = 'user_group' and scoped_root.resource_id = root.scope_resource_id)
   )
)
insert into company_explorer_edges (
  company_id,
  edge_id,
  parent_entity_id,
  child_entity_id,
  position,
  created_timestamp,
  updated_timestamp
)
select root_edges.company_id,
       mangorts_company_explorer_v2_edge_id(root_edges.company_id, root_edges.parent_entity_id, root_edges.child_entity_id),
       root_edges.parent_entity_id,
       root_edges.child_entity_id,
       root_edges.position,
       root_edges.created_timestamp,
       root_edges.updated_timestamp
from root_edges
where root_edges.parent_entity_id is not null
  and root_edges.parent_entity_id <> root_edges.child_entity_id
on conflict (company_id, parent_entity_id, child_entity_id) do update set
  position = excluded.position,
  updated_timestamp = greatest(company_explorer_edges.updated_timestamp, excluded.updated_timestamp);

insert into company_explorer_edges (
  company_id,
  edge_id,
  parent_entity_id,
  child_entity_id,
  position,
  created_timestamp,
  updated_timestamp
)
select folder.company_id,
       mangorts_company_explorer_v2_edge_id(folder.company_id, folder.parent_folder_id, folder.folder_id),
       folder.parent_folder_id,
       folder.folder_id,
       folder.position,
       folder.created_timestamp,
       folder.updated_timestamp
from company_explorer_folders folder
where folder.parent_folder_id is not null
  and folder.parent_folder_id <> folder.folder_id
on conflict (company_id, parent_entity_id, child_entity_id) do update set
  position = excluded.position,
  updated_timestamp = greatest(company_explorer_edges.updated_timestamp, excluded.updated_timestamp);

with legacy_items as (
  select item.company_id,
         item.folder_id,
         item.item_type,
         mangorts_try_uuid(item.item_id) as resource_id,
         item.position,
         item.created_timestamp,
         item.updated_timestamp
  from company_explorer_folder_items item
  where item.item_type in ('node', 'logic_gate', 'project')
    and mangorts_try_uuid(item.item_id) is not null
)
insert into company_explorer_edges (
  company_id,
  edge_id,
  parent_entity_id,
  child_entity_id,
  position,
  created_timestamp,
  updated_timestamp
)
select item.company_id,
       mangorts_company_explorer_v2_edge_id(item.company_id, item.folder_id, child.entity_id),
       item.folder_id,
       child.entity_id,
       item.position,
       item.created_timestamp,
       item.updated_timestamp
from legacy_items item
join company_explorer_entities child
  on child.company_id = item.company_id
 and child.entity_type = item.item_type
 and child.resource_id = item.resource_id
on conflict (company_id, parent_entity_id, child_entity_id) do update set
  position = excluded.position,
  updated_timestamp = greatest(company_explorer_edges.updated_timestamp, excluded.updated_timestamp);

-- Active user-bound folder shares become explicit edit grants on the same
-- folder entity. Pending email-only invitations remain in the legacy share
-- table until Phase 2 decides the replacement invitation workflow.
insert into resource_access_grants (
  company_id,
  resource_type,
  resource_id,
  principal_type,
  principal_id,
  access_level,
  created_timestamp
)
select share.company_id,
       'company_explorer_folder',
       share.folder_id,
       'user',
       share.user_id,
       'edit',
       share.created_timestamp
from company_explorer_folder_shares share
join company_explorer_entities folder_entity
  on folder_entity.company_id = share.company_id
 and folder_entity.entity_id = share.folder_id
 and folder_entity.entity_type = 'folder'
where share.status = 'active'
  and share.user_id is not null
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do nothing;

-- Default folder seeds are not copied into V2. V2 root placement is derived
-- from company/user/user_group root entities plus explicit edges; the old seed
-- table remains intact for Phase 1 and can be removed only in Phase 2.

create or replace view company_explorer_v2_backfill_verification as
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'old_folders_to_v2_folder_entities'::text as check_name,
         (select count(*) from company_explorer_folders)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders folder
           join company_explorer_entities entity
             on entity.company_id = folder.company_id
            and entity.entity_id = folder.folder_id
            and entity.entity_type = 'folder'
            and entity.resource_id is null
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'old_folder_items_to_v2_resource_edges'::text as check_name,
         (select count(*) from company_explorer_folder_items)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folder_items item
           join company_explorer_entities child
             on child.company_id = item.company_id
            and child.entity_type = item.item_type
            and child.resource_id = mangorts_try_uuid(item.item_id)
           join company_explorer_edges edge
             on edge.company_id = item.company_id
            and edge.parent_entity_id = item.folder_id
            and edge.child_entity_id = child.entity_id
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'old_parent_child_folder_paths_to_v2_edges'::text as check_name,
         (select count(*) from company_explorer_folders where parent_folder_id is not null)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders folder
           join company_explorer_edges edge
             on edge.company_id = folder.company_id
            and edge.parent_entity_id = folder.parent_folder_id
            and edge.child_entity_id = folder.folder_id
           where folder.parent_folder_id is not null
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'company_root_folders_to_company_root_edges'::text as check_name,
         (select count(*) from company_explorer_folders where parent_folder_id is null and scope_type = 'company')::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders folder
           join company_explorer_edges edge
             on edge.company_id = folder.company_id
            and edge.child_entity_id = folder.folder_id
           join company_explorer_entities parent
             on parent.company_id = edge.company_id
            and parent.entity_id = edge.parent_entity_id
            and parent.entity_type = 'company'
            and parent.resource_id = folder.company_id
           where folder.parent_folder_id is null
             and folder.scope_type = 'company'
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'user_root_folders_to_user_root_edges'::text as check_name,
         (
           select count(*)
           from company_explorer_folders
           where parent_folder_id is null
             and scope_type = 'user'
             and mangorts_try_uuid(scope_id) is not null
         )::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders folder
           join company_explorer_edges edge
             on edge.company_id = folder.company_id
            and edge.child_entity_id = folder.folder_id
           join company_explorer_entities parent
             on parent.company_id = edge.company_id
            and parent.entity_id = edge.parent_entity_id
            and parent.entity_type = 'user'
            and parent.resource_id = mangorts_try_uuid(folder.scope_id)
           where folder.parent_folder_id is null
             and folder.scope_type = 'user'
             and mangorts_try_uuid(folder.scope_id) is not null
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'team_root_folders_to_group_root_edges'::text as check_name,
         (
           select count(*)
           from company_explorer_folders
           where parent_folder_id is null
             and scope_type = 'team'
             and mangorts_try_uuid(scope_id) is not null
         )::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders folder
           join company_explorer_edges edge
             on edge.company_id = folder.company_id
            and edge.child_entity_id = folder.folder_id
           join company_explorer_entities parent
             on parent.company_id = edge.company_id
            and parent.entity_id = edge.parent_entity_id
            and parent.entity_type = 'user_group'
            and parent.resource_id = mangorts_try_uuid(folder.scope_id)
           where folder.parent_folder_id is null
             and folder.scope_type = 'team'
             and mangorts_try_uuid(folder.scope_id) is not null
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'folder_default_access_to_v2_entities'::text as check_name,
         (select count(*) from company_explorer_folders)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders folder
           join company_explorer_entities entity
             on entity.company_id = folder.company_id
            and entity.entity_id = folder.folder_id
            and entity.entity_type = 'folder'
            and entity.default_access = folder.default_access
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'folder_permission_rows_target_v2_folder_entities'::text as check_name,
         (
           select count(*)
           from resource_permissions permission
           join company_explorer_folders folder
             on folder.company_id = permission.company_id
            and folder.folder_id = permission.resource_id
           where permission.resource_type = 'company_explorer_folder'
         )::bigint as expected_count,
         (
           select count(*)
           from resource_permissions permission
           join company_explorer_entities entity
             on entity.company_id = permission.company_id
            and entity.entity_id = permission.resource_id
            and entity.entity_type = 'folder'
           where permission.resource_type = 'company_explorer_folder'
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'active_folder_shares_to_edit_grants'::text as check_name,
         (
           select count(*)
           from company_explorer_folder_shares share
           where share.status = 'active'
             and share.user_id is not null
         )::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folder_shares share
           join resource_access_grants grant_row
             on grant_row.company_id = share.company_id
            and grant_row.resource_type = 'company_explorer_folder'
            and grant_row.resource_id = share.folder_id
            and grant_row.principal_type = 'user'
            and grant_row.principal_id = share.user_id
            and grant_row.access_level = 'edit'
           where share.status = 'active'
             and share.user_id is not null
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'legacy_folder_item_ids_are_valid_uuids'::text as check_name,
         0::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folder_items
           where mangorts_try_uuid(item_id) is null
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'legacy_root_scope_ids_are_valid_uuids'::text as check_name,
         0::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders
           where parent_folder_id is null
             and scope_type in ('user', 'team')
             and mangorts_try_uuid(scope_id) is null
         )::bigint as actual_count
) check_row;
