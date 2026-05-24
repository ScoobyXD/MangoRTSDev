create table if not exists resource_raci_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  subject_type text not null,
  subject_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint resource_raci_assignments_resource_type_chk check (resource_type in ('node', 'logic_gate', 'shared_triage_folder')),
  constraint resource_raci_assignments_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  constraint resource_raci_assignments_subject_type_chk check (subject_type in ('user', 'group')),
  primary key (company_id, resource_type, resource_id, role, subject_type, subject_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_raci_assignments_subject_role_resource
  on resource_raci_assignments(company_id, subject_type, subject_id, role, resource_type, resource_id);

create index if not exists idx_resource_raci_assignments_resource_role_subject
  on resource_raci_assignments(company_id, resource_type, resource_id, role, subject_type, subject_id);

insert into resource_raci_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  subject_type,
  subject_id,
  created_timestamp
)
select
  company_id,
  'shared_triage_folder',
  folder_id,
  role,
  'user',
  user_id,
  created_timestamp
from communications_shared_inbox_raci_assignments
on conflict (company_id, resource_type, resource_id, role, subject_type, subject_id) do nothing;

insert into resource_raci_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  subject_type,
  subject_id,
  created_timestamp
)
select
  company_id,
  'shared_triage_folder',
  folder_id,
  role,
  'group',
  group_id,
  created_timestamp
from communications_shared_inbox_raci_group_assignments
on conflict (company_id, resource_type, resource_id, role, subject_type, subject_id) do nothing;

delete from effective_resource_access
where source_type = 'shared_triage_raci';
