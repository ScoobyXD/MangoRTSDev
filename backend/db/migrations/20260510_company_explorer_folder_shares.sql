create table if not exists company_explorer_folder_shares (
  company_id uuid not null,
  folder_id uuid not null,
  email text not null,
  user_id uuid,
  status text not null default 'pending',
  invited_by_user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_explorer_folder_shares_email_nonblank_chk check (btrim(email) <> ''),
  constraint company_explorer_folder_shares_email_lowercase_chk check (email = lower(btrim(email))),
  constraint company_explorer_folder_shares_status_chk check (status in ('pending', 'active')),
  constraint company_explorer_folder_shares_status_user_chk check (
    (status = 'pending' and user_id is null) or
    (status = 'active' and user_id is not null)
  ),
  primary key (company_id, folder_id, email),
  foreign key (company_id, folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade,
  foreign key (invited_by_user_id) references users (user_id) on delete cascade
);

create index if not exists idx_company_explorer_folder_shares_user
  on company_explorer_folder_shares(company_id, user_id, folder_id)
  where user_id is not null;

create index if not exists idx_company_explorer_folder_shares_email_status
  on company_explorer_folder_shares(company_id, email, status);
