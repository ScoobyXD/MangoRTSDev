alter table company_explorer_folders
  add column if not exists system_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_explorer_folders_system_key_nonblank_chk'
  ) then
    alter table company_explorer_folders
      add constraint company_explorer_folders_system_key_nonblank_chk
      check (system_key is null or btrim(system_key) <> '');
  end if;
end $$;

create unique index if not exists idx_company_explorer_folders_system_key
  on company_explorer_folders(company_id, system_key)
  where system_key is not null;
