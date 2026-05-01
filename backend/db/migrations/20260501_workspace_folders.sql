-- Workspace folders provide an API-backed explorer tree for nodes and logic gates.
-- Keep the model simple: folders are an adjacency list, and each node/gate has
-- at most one folder placement row, matching Windows-file-explorer semantics.

create table if not exists workspace_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  folder_kind text not null,
  name text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint workspace_folders_kind_chk check (folder_kind in ('node', 'logic_gate')),
  constraint workspace_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint workspace_folders_parent_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id),
  primary key (company_id, folder_id),
  foreign key (company_id, parent_folder_id) references workspace_folders (company_id, folder_id) on delete cascade
);

create index if not exists idx_workspace_folders_parent_kind
  on workspace_folders(company_id, folder_kind, parent_folder_id, created_timestamp);

create table if not exists workspace_folder_items (
  company_id uuid not null,
  folder_id uuid not null,
  item_type text not null,
  item_id uuid not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint workspace_folder_items_type_chk check (item_type in ('node', 'logic_gate')),
  primary key (company_id, item_type, item_id),
  foreign key (company_id, folder_id) references workspace_folders (company_id, folder_id) on delete cascade
);

create index if not exists idx_workspace_folder_items_folder_type
  on workspace_folder_items(company_id, folder_id, item_type, created_timestamp);
