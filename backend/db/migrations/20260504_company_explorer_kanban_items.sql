-- Kanban boards are Explorer items, not map/editor entities. Keep folders as
-- node or logic_gate folders, and allow board placements in either folder kind.
do $$
declare
  constraint_row record;
begin
  if to_regclass('public.company_explorer_folder_items') is null then
    return;
  end if;

  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.company_explorer_folder_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%item_type%'
  loop
    execute format('alter table public.company_explorer_folder_items drop constraint if exists %I', constraint_row.conname);
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'company_explorer_folder_items'
      and column_name = 'item_id'
      and data_type <> 'text'
  ) then
    alter table public.company_explorer_folder_items
      alter column item_id type text using item_id::text;
  end if;

  alter table public.company_explorer_folder_items
    add constraint company_explorer_folder_items_type_chk
    check (item_type in ('node', 'logic_gate', 'kanban'));
end $$;
