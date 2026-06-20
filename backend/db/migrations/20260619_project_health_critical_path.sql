alter table projects
  add column if not exists health text not null default 'On Track';

alter table projects
  drop constraint if exists projects_health_chk;

alter table projects
  add constraint projects_health_chk check (health in ('On Track', 'AT RISK', 'Off Track'));

create table if not exists project_critical_path_steps (
  company_id uuid not null,
  project_id uuid not null,
  step_id uuid not null,
  name text not null default '',
  relationship_id uuid,
  due_date date,
  owner_type text not null default '',
  owner_id uuid,
  position integer not null default 0,
  is_current boolean not null default false,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_critical_path_owner_chk check (
    (owner_type = '' and owner_id is null)
    or (owner_type in ('user', 'group') and owner_id is not null)
  ),
  primary key (company_id, project_id, step_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_critical_path_project_position
  on project_critical_path_steps(company_id, project_id, position, step_id);

create unique index if not exists idx_project_critical_path_one_current
  on project_critical_path_steps(company_id, project_id)
  where is_current;
