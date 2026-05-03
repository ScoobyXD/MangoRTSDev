alter table kanban_columns
  add column if not exists item_color text not null default '#2f7d62';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kanban_columns_item_color_chk'
  ) then
    alter table kanban_columns
      add constraint kanban_columns_item_color_chk check (item_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;
