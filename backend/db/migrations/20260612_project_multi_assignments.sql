create table if not exists project_account_assignments (
  company_id uuid not null,
  project_id uuid not null,
  account_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, project_id, account_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (company_id, account_id) references accounts(company_id, account_id) on delete cascade
);

create index if not exists idx_project_account_assignments_account
  on project_account_assignments(company_id, account_id, project_id);

insert into project_account_assignments (company_id, project_id, account_id, created_timestamp)
select company_id, project_id, account_id, created_timestamp
from projects
where account_id is not null
on conflict do nothing;

create table if not exists project_team_assignments (
  company_id uuid not null,
  project_id uuid not null,
  team_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, project_id, team_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (company_id, team_id) references company_user_groups(company_id, group_id) on delete cascade
);

create index if not exists idx_project_team_assignments_team
  on project_team_assignments(company_id, team_id, project_id);

insert into project_team_assignments (company_id, project_id, team_id, created_timestamp)
select company_id, project_id, team_id, created_timestamp
from projects
where team_id is not null
on conflict do nothing;
