-- Kanban boards are Explorer items, not map/editor entities. Keep folders as
-- node or logic_gate folders, and allow board placements in either folder kind.
alter table company_explorer_folder_items
  drop constraint if exists company_explorer_folder_items_type_chk;

alter table company_explorer_folder_items
  alter column item_id type text using item_id::text;

alter table company_explorer_folder_items
  add constraint company_explorer_folder_items_type_chk
  check (item_type in ('node', 'logic_gate', 'kanban'));
