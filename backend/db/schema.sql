-- PostgreSQL-first schema for Case source-of-truth backend.

create table if not exists cases (
  id text primary key,
  parent_id text references cases(id) on delete cascade,
  title text not null,
  owner text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists case_artifacts (
  id text primary key,
  case_id text not null references cases(id) on delete cascade,
  type text not null,
  source_ref text not null default '',
  content text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists case_activities (
  id text primary key,
  case_id text not null references cases(id) on delete cascade,
  event_type text not null,
  payload text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_cases_parent_id on cases(parent_id);
create index if not exists idx_case_artifacts_case_id on case_artifacts(case_id);
create index if not exists idx_case_activities_case_id on case_activities(case_id);
