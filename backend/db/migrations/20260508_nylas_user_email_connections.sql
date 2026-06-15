create table if not exists user_email_connections (
  user_id uuid not null,
  provider text not null,
  account_email text not null,
  connection_scope text not null default 'personal',
  grant_id text not null,
  status text not null default 'connected',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint user_email_connections_provider_chk check (provider in ('google', 'microsoft')),
  constraint user_email_connections_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  constraint user_email_connections_scope_chk check (connection_scope in ('personal', 'shared')),
  constraint user_email_connections_grant_id_nonblank_chk check (btrim(grant_id) <> ''),
  constraint user_email_connections_status_chk check (status in ('connected', 'disconnected', 'reauth_required')),
  primary key (user_id),
  foreign key (user_id) references users (user_id) on delete cascade
);

create unique index if not exists idx_user_email_connections_grant_id
  on user_email_connections(grant_id);
