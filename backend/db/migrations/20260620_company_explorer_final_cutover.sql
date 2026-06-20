-- Phase 4 hard cutover: Company Explorer stores only company-wide folders and
-- manual references to canonical resources. Native project and logic-gate
-- relationships stay in their source-of-truth tables.

create table if not exists company_explorer_items (
  company_id uuid not null,
  item_id uuid not null,
  parent_folder_id uuid,
  target_type text not null,
  target_id uuid not null,
  position integer not null default 1000,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_explorer_items_target_type_chk check (target_type in ('project', 'logic_gate', 'node')),
  primary key (company_id, item_id),
  unique (company_id, target_type, target_id),
  foreign key (company_id, parent_folder_id) references company_explorer_folders(company_id, folder_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_company_explorer_items_parent_position
  on company_explorer_items(company_id, parent_folder_id, position, created_timestamp, item_id);

create index if not exists idx_company_explorer_items_target
  on company_explorer_items(company_id, target_type, target_id);

insert into company_explorer_folders (
  company_id,
  folder_id,
  parent_folder_id,
  folder_kind,
  system_key,
  name,
  default_access,
  scope_type,
  scope_id,
  position,
  created_timestamp,
  updated_timestamp
)
select folder_entity.company_id,
       folder_entity.entity_id,
       parent_entity.entity_id as parent_folder_id,
       'project' as folder_kind,
       null as system_key,
       folder_entity.name,
       coalesce(folder_entity.default_access, 'edit') as default_access,
       'company' as scope_type,
       null as scope_id,
       coalesce(edge.position, 1000) as position,
       folder_entity.created_timestamp,
       folder_entity.updated_timestamp
from company_explorer_entities folder_entity
left join company_explorer_edges edge
  on edge.company_id = folder_entity.company_id
 and edge.child_entity_id = folder_entity.entity_id
left join company_explorer_entities parent_entity
  on parent_entity.company_id = edge.company_id
 and parent_entity.entity_id = edge.parent_entity_id
 and parent_entity.entity_type = 'folder'
where folder_entity.entity_type = 'folder'
on conflict (company_id, folder_id) do update set
  parent_folder_id = coalesce(excluded.parent_folder_id, company_explorer_folders.parent_folder_id),
  name = excluded.name,
  default_access = excluded.default_access,
  updated_timestamp = greatest(company_explorer_folders.updated_timestamp, excluded.updated_timestamp);

with legacy_items as (
  select item.company_id,
         md5(item.company_id::text || ':company_explorer_item:legacy:' || item.item_type || ':' || item.item_id)::uuid as item_id,
         item.folder_id as parent_folder_id,
         item.item_type as target_type,
         mangorts_try_uuid(item.item_id) as target_id,
         item.position,
         item.created_timestamp,
         item.updated_timestamp
  from company_explorer_folder_items item
  where item.item_type in ('project', 'logic_gate', 'node')
    and mangorts_try_uuid(item.item_id) is not null
), valid_legacy_items as (
  select legacy.*
  from legacy_items legacy
  left join projects project
    on legacy.target_type='project'
   and project.company_id=legacy.company_id
   and project.project_id=legacy.target_id
  left join logic_gates logic_gate
    on legacy.target_type='logic_gate'
   and logic_gate.company_id=legacy.company_id
   and logic_gate.logic_gate_id=legacy.target_id
  left join nodes node
    on legacy.target_type='node'
   and node.company_id=legacy.company_id
   and node.node_id=legacy.target_id
  where (legacy.target_type='project' and project.project_id is not null)
     or (legacy.target_type='logic_gate' and logic_gate.logic_gate_id is not null)
     or (legacy.target_type='node' and node.node_id is not null)
)
insert into company_explorer_items (
  company_id,
  item_id,
  parent_folder_id,
  target_type,
  target_id,
  position,
  created_timestamp,
  updated_timestamp
)
select company_id,
       item_id,
       parent_folder_id,
       target_type,
       target_id,
       position,
       created_timestamp,
       updated_timestamp
from valid_legacy_items
on conflict (company_id, target_type, target_id) do update set
  parent_folder_id = excluded.parent_folder_id,
  position = excluded.position,
  updated_timestamp = greatest(company_explorer_items.updated_timestamp, excluded.updated_timestamp);

with manual_resource_edges as (
  select edge.company_id,
         edge.edge_id as item_id,
         case when parent.entity_type = 'folder' then parent.entity_id else null end as parent_folder_id,
         child.entity_type as target_type,
         child.resource_id as target_id,
         edge.position,
         edge.created_timestamp,
         edge.updated_timestamp
  from company_explorer_edges edge
  join company_explorer_entities parent
    on parent.company_id=edge.company_id
   and parent.entity_id=edge.parent_entity_id
   and parent.entity_type in ('company', 'folder')
  join company_explorer_entities child
    on child.company_id=edge.company_id
   and child.entity_id=edge.child_entity_id
   and child.entity_type in ('project', 'logic_gate', 'node')
   and child.resource_id is not null
), valid_manual_resource_edges as (
  select edge.*
  from manual_resource_edges edge
  left join projects project
    on edge.target_type='project'
   and project.company_id=edge.company_id
   and project.project_id=edge.target_id
  left join logic_gates logic_gate
    on edge.target_type='logic_gate'
   and logic_gate.company_id=edge.company_id
   and logic_gate.logic_gate_id=edge.target_id
  left join nodes node
    on edge.target_type='node'
   and node.company_id=edge.company_id
   and node.node_id=edge.target_id
  where (edge.target_type='project' and project.project_id is not null)
     or (edge.target_type='logic_gate' and logic_gate.logic_gate_id is not null)
     or (edge.target_type='node' and node.node_id is not null)
)
insert into company_explorer_items (
  company_id,
  item_id,
  parent_folder_id,
  target_type,
  target_id,
  position,
  created_timestamp,
  updated_timestamp
)
select company_id,
       item_id,
       parent_folder_id,
       target_type,
       target_id,
       position,
       created_timestamp,
       updated_timestamp
from valid_manual_resource_edges
on conflict (company_id, target_type, target_id) do update set
  parent_folder_id = excluded.parent_folder_id,
  position = excluded.position,
  updated_timestamp = greatest(company_explorer_items.updated_timestamp, excluded.updated_timestamp);

with project_parent_edges as (
  select edge.company_id,
         edge.edge_id as relationship_id,
         parent.resource_id as project_id,
         child.entity_type as resource_type,
         child.resource_id,
         edge.position,
         edge.created_timestamp,
         edge.updated_timestamp
  from company_explorer_edges edge
  join company_explorer_entities parent
    on parent.company_id=edge.company_id
   and parent.entity_id=edge.parent_entity_id
   and parent.entity_type='project'
   and parent.resource_id is not null
  join company_explorer_entities child
    on child.company_id=edge.company_id
   and child.entity_id=edge.child_entity_id
   and child.entity_type in ('logic_gate', 'node')
   and child.resource_id is not null
)
insert into project_relationships (
  company_id,
  relationship_id,
  project_id,
  resource_type,
  resource_id,
  position,
  created_timestamp,
  updated_timestamp
)
select edge.company_id,
       edge.relationship_id,
       edge.project_id,
       edge.resource_type,
       edge.resource_id,
       edge.position,
       edge.created_timestamp,
       edge.updated_timestamp
from project_parent_edges edge
on conflict (company_id, resource_type, resource_id) do nothing;

with logic_gate_parent_edges as (
  select edge.company_id,
         edge.edge_id as assignment_id,
         parent.resource_id as logic_gate_id,
         child.resource_id as node_id,
         edge.position,
         edge.created_timestamp,
         edge.updated_timestamp
  from company_explorer_edges edge
  join company_explorer_entities parent
    on parent.company_id=edge.company_id
   and parent.entity_id=edge.parent_entity_id
   and parent.entity_type='logic_gate'
   and parent.resource_id is not null
  join company_explorer_entities child
    on child.company_id=edge.company_id
   and child.entity_id=edge.child_entity_id
   and child.entity_type='node'
   and child.resource_id is not null
  join nodes node
    on node.company_id=edge.company_id
   and node.node_id=child.resource_id
   and node.priority between 1 and 5
)
insert into node_logic_gate_assignments (
  assignment_id,
  company_id,
  node_id,
  logic_gate_id,
  status_key,
  column_id,
  is_issue,
  position,
  compatibility_board_id,
  compatibility_card_id,
  created_timestamp,
  updated_timestamp
)
select edge.assignment_id,
       edge.company_id,
       edge.node_id,
       edge.logic_gate_id,
       'pending',
       'pending',
       false,
       edge.position,
       'logic-gate:' || edge.logic_gate_id::text,
       edge.assignment_id,
       edge.created_timestamp,
       edge.updated_timestamp
from logic_gate_parent_edges edge
on conflict (company_id, node_id) do nothing;

drop view if exists company_explorer_v2_backfill_verification;
drop trigger if exists trg_company_explorer_edges_prevent_cycle on company_explorer_edges;
drop function if exists mangorts_prevent_company_explorer_edge_cycle();

alter table company_explorer_folders drop constraint if exists company_explorer_folders_kind_chk;
alter table company_explorer_folders drop constraint if exists company_explorer_folders_scope_chk;
alter table company_explorer_folders drop constraint if exists company_explorer_folders_system_key_nonblank_chk;

drop index if exists idx_company_explorer_folders_system_key;
drop index if exists idx_company_explorer_folders_parent_kind;
drop index if exists idx_company_explorer_folders_scope;

alter table company_explorer_folders
  add column if not exists created_by_user_id uuid;

alter table company_explorer_folders
  alter column created_timestamp set default now(),
  alter column updated_timestamp set default now();

alter table company_explorer_folders
  drop column if exists folder_kind,
  drop column if exists system_key,
  drop column if exists scope_type,
  drop column if exists scope_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_explorer_folders_created_by_user_id_fkey'
  ) then
    alter table company_explorer_folders
      add constraint company_explorer_folders_created_by_user_id_fkey
      foreign key (created_by_user_id) references users(user_id) on delete set null;
  end if;
end $$;

create index if not exists idx_company_explorer_folders_parent_position
  on company_explorer_folders(company_id, parent_folder_id, position, created_timestamp, folder_id);

drop table if exists company_explorer_subscriptions;
drop table if exists company_explorer_edges;
drop table if exists company_explorer_entities;
drop table if exists company_explorer_folder_items;
drop table if exists company_explorer_folder_shares;
drop table if exists company_explorer_default_folder_seeds;

drop function if exists mangorts_company_explorer_v2_edge_id(uuid, uuid, uuid);
drop function if exists mangorts_company_explorer_v2_entity_id(uuid, text, uuid);

create or replace view company_explorer_final_backfill_verification as
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'manual_references_have_existing_targets'::text as check_name,
         (select count(*) from company_explorer_items)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_items item
           left join projects project
             on item.target_type='project'
            and project.company_id=item.company_id
            and project.project_id=item.target_id
           left join logic_gates logic_gate
             on item.target_type='logic_gate'
            and logic_gate.company_id=item.company_id
            and logic_gate.logic_gate_id=item.target_id
           left join nodes node
             on item.target_type='node'
            and node.company_id=item.company_id
            and node.node_id=item.target_id
           where (item.target_type='project' and project.project_id is not null)
              or (item.target_type='logic_gate' and logic_gate.logic_gate_id is not null)
              or (item.target_type='node' and node.node_id is not null)
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'folders_have_valid_parents'::text as check_name,
         (select count(*) from company_explorer_folders where parent_folder_id is not null)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders child
           join company_explorer_folders parent
             on parent.company_id=child.company_id
            and parent.folder_id=child.parent_folder_id
           where child.parent_folder_id is not null
         )::bigint as actual_count
) check_row;
