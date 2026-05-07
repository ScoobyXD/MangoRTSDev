alter table company_memberships
  drop constraint if exists company_memberships_role_chk;

update company_memberships
set role = case role
  when 'owner' then 'company_admin'
  when 'admin' then 'company_admin'
  when 'member' then 'company_user'
  when 'agent' then 'company_user'
  when 'dev_admin' then 'dev_admin'
  when 'company_admin' then 'company_admin'
  when 'company_user' then 'company_user'
  when 'company_viewer' then 'company_user'
  else 'company_user'
end;

alter table company_memberships
  add constraint company_memberships_role_chk
  check (role in ('dev_admin', 'company_admin', 'company_user'));

create table if not exists invitations (
  invitation_id uuid not null,
  company_id uuid not null,
  email text not null,
  role text not null,
  token_hash text not null,
  status text not null default 'pending',
  invited_by_user_id uuid not null,
  accepted_by_user_id uuid,
  expires_timestamp timestamptz not null,
  accepted_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint invitations_email_nonblank_chk check (btrim(email) <> ''),
  constraint invitations_token_hash_nonblank_chk check (btrim(token_hash) <> ''),
  constraint invitations_role_chk check (role in ('company_admin', 'company_user')),
  constraint invitations_status_chk check (status in ('pending', 'accepted', 'revoked')),
  primary key (invitation_id),
  unique (token_hash),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (invited_by_user_id) references users (user_id),
  foreign key (accepted_by_user_id) references users (user_id)
);

create index if not exists idx_invitations_company_email_status
  on invitations(company_id, email, status, created_timestamp desc);

with ranked_pending_invitations as (
  select
    invitation_id,
    row_number() over (
      partition by company_id, email
      order by created_timestamp desc, invitation_id desc
    ) as rn
  from invitations
  where status = 'pending'
)
update invitations i
set status = 'revoked',
    updated_timestamp = now()
from ranked_pending_invitations ranked
where i.invitation_id = ranked.invitation_id
  and ranked.rn > 1;

create unique index if not exists idx_invitations_one_pending_company_email
  on invitations(company_id, email)
  where status = 'pending';

create table if not exists resource_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id text not null,
  user_id uuid not null,
  assigned_by_user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint resource_assignments_type_chk check (resource_type in ('folder', 'node', 'logic_gate', 'kanban_board')),
  constraint resource_assignments_resource_id_nonblank_chk check (btrim(resource_id) <> ''),
  primary key (company_id, resource_type, resource_id, user_id),
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade,
  foreign key (assigned_by_user_id) references users (user_id)
);

create index if not exists idx_resource_assignments_company_user_resource
  on resource_assignments(company_id, user_id, resource_type, resource_id);

create index if not exists idx_resource_assignments_company_resource
  on resource_assignments(company_id, resource_type, resource_id);
