create table if not exists account_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint account_folders_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, folder_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_account_folders_parent_position
  on account_folders(company_id, parent_folder_id, position, lower(name), folder_id);

create table if not exists accounts (
  company_id uuid not null,
  account_id uuid not null,
  name text not null,
  folder_id uuid,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint accounts_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, account_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_accounts_company_name
  on accounts(company_id, lower(name), account_id);

create index if not exists idx_accounts_folder_position
  on accounts(company_id, folder_id, position, lower(name), account_id);

create table if not exists node_account_assignments (
  company_id uuid not null,
  node_id uuid not null,
  account_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, node_id, account_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, account_id) references accounts (company_id, account_id) on delete cascade
);

create index if not exists idx_node_account_assignments_account
  on node_account_assignments(company_id, account_id, node_id);

alter table if exists kanban_board_projection
  add column if not exists accounts jsonb not null default '[]'::jsonb;

alter table if exists racio_matrix_projection_table
  add column if not exists accounts jsonb not null default '[]'::jsonb;

alter table if exists project_management_timeline_projection
  add column if not exists accounts jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kanban_board_projection_accounts_array_chk'
  ) then
    alter table kanban_board_projection
      add constraint kanban_board_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'racio_matrix_projection_accounts_array_chk'
  ) then
    alter table racio_matrix_projection_table
      add constraint racio_matrix_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_management_timeline_projection_accounts_array_chk'
  ) then
    alter table project_management_timeline_projection
      add constraint project_management_timeline_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array');
  end if;
end $$;
