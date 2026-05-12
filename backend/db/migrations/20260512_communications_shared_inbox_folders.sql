alter table company_explorer_folders
  drop constraint if exists company_explorer_folders_kind_chk;

alter table company_explorer_folders
  add constraint company_explorer_folders_kind_chk
  check (folder_kind in ('node', 'logic_gate', 'communications'));
