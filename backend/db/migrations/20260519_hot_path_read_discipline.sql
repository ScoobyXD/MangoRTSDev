-- Backfill Company Explorer defaults outside GET/read paths.
-- New companies are provisioned by CreateCompany; this migration covers
-- companies that existed before read-time seeding was removed.

with inserted_seed as (
  insert into company_explorer_default_folder_seeds (company_id, seed_key, created_timestamp)
  select company_id, 'system_folders_v1', now()
  from companies
  on conflict (company_id, seed_key) do nothing
  returning company_id
),
system_defaults(system_key, name, position) as (
  values
    ('active_nodes', 'Active Nodes', 200),
    ('history', 'History', 300)
)
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
  seed.company_id,
  md5(seed.company_id::text || ':system_folders_v1:' || defaults.system_key)::uuid,
  null,
  'node',
  defaults.system_key,
  defaults.name,
  defaults.position,
  now(),
  now()
from inserted_seed seed
cross join system_defaults defaults
on conflict (company_id, system_key) where system_key is not null do nothing;

with inserted_seed as (
  insert into company_explorer_default_folder_seeds (company_id, seed_key, created_timestamp)
  select company_id, 'logic_gates_v1', now()
  from companies
  on conflict (company_id, seed_key) do nothing
  returning company_id
),
root_positions as (
  select
    seed.company_id,
    coalesce((
      select max(folder.position)
      from company_explorer_folders folder
      where folder.company_id = seed.company_id
        and folder.folder_kind = 'logic_gate'
        and folder.parent_folder_id is null
    ), 0) + 1000 as root_position
  from inserted_seed seed
),
inserted_roots as (
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
    md5(company_id::text || ':logic_gates_v1:root')::uuid,
    null,
    'logic_gate',
    null,
    'Logic Gates',
    root_position,
    now(),
    now()
  from root_positions
  on conflict (company_id, folder_id) do nothing
  returning company_id, folder_id
),
logic_children(name, position) as (
  values
    ('Product', 1000),
    ('Design', 2000),
    ('Production', 3000),
    ('Supply Chain', 4000),
    ('QA', 5000)
)
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
  root.company_id,
  md5(root.company_id::text || ':logic_gates_v1:' || child.name)::uuid,
  root.folder_id,
  'logic_gate',
  null,
  child.name,
  child.position,
  now(),
  now()
from inserted_roots root
cross join logic_children child
on conflict (company_id, folder_id) do nothing;

with inserted_seed as (
  insert into company_explorer_default_folder_seeds (company_id, seed_key, created_timestamp)
  select company_id, 'communications_v1', now()
  from companies
  on conflict (company_id, seed_key) do nothing
  returning company_id
),
root_positions as (
  select
    seed.company_id,
    coalesce((
      select max(folder.position)
      from company_explorer_folders folder
      where folder.company_id = seed.company_id
        and folder.folder_kind = 'communications'
        and folder.parent_folder_id is null
    ), 0) + 1000 as root_position
  from inserted_seed seed
),
communications_tree(path, parent_path, name, position) as (
  values
    ('BM', null, 'BM', 0),
    ('BM/Product', 'BM', 'Product', 1000),
    ('BM/Product/design', 'BM/Product', 'design', 1000),
    ('BM/Product/printing', 'BM/Product', 'printing', 2000),
    ('BM/Product/suppliers', 'BM/Product', 'suppliers', 3000),
    ('BM/Account', 'BM', 'Account', 2000),
    ('BM/Commercial', 'BM', 'Commercial', 3000),
    ('BM/Project', 'BM', 'Project', 4000),
    ('Supply Chain', null, 'Supply Chain', 1000),
    ('Supply Chain/orders', 'Supply Chain', 'orders', 1000),
    ('Supply Chain/shipping', 'Supply Chain', 'shipping', 2000),
    ('Supply Chain/receiving', 'Supply Chain', 'receiving', 3000),
    ('Production', null, 'Production', 2000),
    ('Production/temps', 'Production', 'temps', 1000),
    ('QA', null, 'QA', 3000),
    ('QA/quality', 'QA', 'quality', 1000),
    ('Finance', null, 'Finance', 4000),
    ('Finance/ar', 'Finance', 'ar', 1000),
    ('Finance/ap', 'Finance', 'ap', 2000),
    ('Legal', null, 'Legal', 5000),
    ('HR', null, 'HR', 6000)
)
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
  positions.company_id,
  md5(positions.company_id::text || ':communications_v1:' || tree.path)::uuid,
  case
    when tree.parent_path is null then null
    else md5(positions.company_id::text || ':communications_v1:' || tree.parent_path)::uuid
  end,
  'communications',
  null,
  tree.name,
  case
    when tree.parent_path is null then positions.root_position + tree.position
    else tree.position
  end,
  now(),
  now()
from root_positions positions
cross join communications_tree tree
order by positions.company_id, array_length(string_to_array(tree.path, '/'), 1), tree.position
on conflict (company_id, folder_id) do nothing;
