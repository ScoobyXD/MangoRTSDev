create table if not exists effective_resource_access (
  company_id uuid not null,
  user_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  access_level text not null,
  source_type text not null,
  source_id text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint effective_resource_access_resource_type_chk check (resource_type in ('node', 'logic_gate', 'shared_triage_folder')),
  constraint effective_resource_access_access_level_chk check (access_level in ('view', 'edit', 'admin')),
  constraint effective_resource_access_source_type_nonblank_chk check (btrim(source_type) <> ''),
  constraint effective_resource_access_source_id_nonblank_chk check (btrim(source_id) <> ''),
  primary key (company_id, user_id, resource_type, resource_id, source_type, source_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_effective_resource_access_user_resource
  on effective_resource_access(company_id, user_id, resource_type, resource_id);

create index if not exists idx_effective_resource_access_resource_user
  on effective_resource_access(company_id, resource_type, resource_id, user_id);

create index if not exists idx_effective_resource_access_source
  on effective_resource_access(company_id, source_type, source_id);
