alter table company_explorer_folders
  add column if not exists account_email text;

alter table company_explorer_folders
  drop constraint if exists company_explorer_folders_account_email_chk;

alter table company_explorer_folders
  add constraint company_explorer_folders_account_email_chk
  check (
    account_email is null or (
      folder_kind = 'communications'
      and btrim(account_email) <> ''
      and account_email = lower(btrim(account_email))
    )
  );

create index if not exists idx_company_explorer_folders_account_email
  on company_explorer_folders(company_id, account_email)
  where account_email is not null;
