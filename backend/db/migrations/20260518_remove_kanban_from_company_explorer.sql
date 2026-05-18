-- Kanban boards remain durable Kanban resources, but they are no longer
-- persisted as Company Explorer folder items or shown through Explorer folders.
delete from public.company_explorer_folder_items
where item_type = 'kanban';

delete from public.company_explorer_folders
where system_key = 'kanban_boards';

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

  alter table public.company_explorer_folder_items
    add constraint company_explorer_folder_items_type_chk
    check (item_type in ('node', 'logic_gate'));
end $$;
