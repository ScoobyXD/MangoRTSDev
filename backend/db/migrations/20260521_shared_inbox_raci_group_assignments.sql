create table if not exists communications_shared_inbox_raci_group_assignments (
  company_id uuid not null,
  folder_id uuid not null,
  role text not null,
  group_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint communications_shared_inbox_raci_group_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  primary key (company_id, folder_id, role, group_id),
  foreign key (company_id, folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade,
  foreign key (company_id, group_id) references company_user_groups (company_id, group_id) on delete cascade
);

create index if not exists idx_communications_shared_inbox_raci_group_role_folder
  on communications_shared_inbox_raci_group_assignments(company_id, group_id, role, folder_id);

create index if not exists idx_communications_shared_inbox_raci_folder_role_group
  on communications_shared_inbox_raci_group_assignments(company_id, folder_id, role, group_id);
