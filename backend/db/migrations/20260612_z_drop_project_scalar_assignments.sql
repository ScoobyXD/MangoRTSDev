drop index if exists idx_projects_account;
drop index if exists idx_projects_team;

alter table projects
  drop column if exists account_id,
  drop column if exists team_id;
