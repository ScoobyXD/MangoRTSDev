create table if not exists company_email_connections (
  company_email_connection_id uuid not null,
  company_id uuid not null,
  provider text not null,
  account_email text not null,
  grant_id text not null,
  status text not null default 'connected',
  connected_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_email_connections_provider_chk check (provider in ('google', 'microsoft')),
  constraint company_email_connections_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  constraint company_email_connections_grant_id_nonblank_chk check (btrim(grant_id) <> ''),
  constraint company_email_connections_status_chk check (status in ('connected', 'disconnected', 'reauth_required')),
  primary key (company_email_connection_id),
  unique (company_id, company_email_connection_id),
  unique (company_id, account_email),
  unique (company_id, grant_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (connected_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_company_email_connections_company_status
  on company_email_connections(company_id, status, updated_timestamp desc);

alter table shared_inboxes
  add column if not exists company_email_connection_id uuid;

with ranked_connections as (
  select
    inbox.company_id,
    inbox.account_email,
    connection.user_id as connected_by_user_id,
    connection.provider,
    connection.grant_id,
    connection.status,
    connection.created_timestamp,
    connection.updated_timestamp,
    row_number() over (
      partition by inbox.company_id, inbox.account_email
      order by
        case connection.status when 'connected' then 1 when 'reauth_required' then 2 else 3 end,
        connection.updated_timestamp desc
    ) as rn
  from shared_inboxes inbox
  join user_email_connections connection
    on connection.account_email = inbox.account_email
   and connection.connection_scope = 'shared'
)
insert into company_email_connections (
  company_email_connection_id,
  company_id,
  provider,
  account_email,
  grant_id,
  status,
  connected_by_user_id,
  created_timestamp,
  updated_timestamp
)
select
  md5('company_email_connection:' || company_id::text || ':' || account_email)::uuid,
  company_id,
  provider,
  account_email,
  grant_id,
  status,
  connected_by_user_id,
  created_timestamp,
  updated_timestamp
from ranked_connections
where rn = 1
on conflict (company_id, account_email) do update set
  provider = excluded.provider,
  grant_id = excluded.grant_id,
  status = excluded.status,
  connected_by_user_id = excluded.connected_by_user_id,
  updated_timestamp = excluded.updated_timestamp;

update shared_inboxes inbox
set company_email_connection_id = connection.company_email_connection_id,
    updated_timestamp = now()
from company_email_connections connection
where connection.company_id = inbox.company_id
  and connection.account_email = inbox.account_email
  and inbox.company_email_connection_id is null;

alter table shared_inboxes
  drop constraint if exists shared_inboxes_company_email_connection_fkey;

alter table shared_inboxes
  add constraint shared_inboxes_company_email_connection_fkey
  foreign key (company_id, company_email_connection_id)
  references company_email_connections(company_id, company_email_connection_id);

create index if not exists idx_shared_inboxes_company_email_connection
  on shared_inboxes(company_id, company_email_connection_id);
