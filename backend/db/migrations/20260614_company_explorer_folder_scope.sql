alter table company_explorer_folders
  add column if not exists scope_type text not null default 'company';

alter table company_explorer_folders
  add column if not exists scope_id text;

update company_explorer_folders
set scope_type = 'company',
    scope_id = null
where scope_type is null or btrim(scope_type) = '';

alter table company_explorer_folders
  drop constraint if exists company_explorer_folders_scope_chk;

alter table company_explorer_folders
  add constraint company_explorer_folders_scope_chk check (
    scope_type in ('company', 'user', 'team')
    and (
      (scope_type = 'company' and scope_id is null)
      or (scope_type in ('user', 'team') and scope_id is not null and btrim(scope_id) <> '')
    )
  );

create index if not exists idx_company_explorer_folders_scope
  on company_explorer_folders(company_id, scope_type, scope_id);
