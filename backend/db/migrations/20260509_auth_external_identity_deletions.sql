create table if not exists auth_external_identity_deletions (
  provider text not null,
  external_subject text not null,
  user_id uuid,
  email text not null default '',
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  completed_timestamp timestamptz,
  primary key (provider, external_subject),
  constraint auth_external_identity_deletions_provider_chk check (provider in ('cognito')),
  constraint auth_external_identity_deletions_subject_nonblank_chk check (btrim(external_subject) <> ''),
  constraint auth_external_identity_deletions_status_chk check (status in ('pending', 'completed')),
  constraint auth_external_identity_deletions_attempts_chk check (attempts >= 0)
);

create index if not exists idx_auth_external_identity_deletions_pending
  on auth_external_identity_deletions(updated_timestamp) where status = 'pending';