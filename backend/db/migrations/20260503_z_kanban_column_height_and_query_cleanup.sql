alter table kanban_columns
  add column if not exists height_px integer not null default 240;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kanban_columns_height_px_chk'
  ) then
    alter table kanban_columns
      add constraint kanban_columns_height_px_chk check (height_px between 160 and 720);
  end if;
end $$;

drop index if exists idx_kanban_cards_status_position;
drop index if exists idx_kanban_cards_assigned_to_position;
drop index if exists idx_kanban_cards_work_type_position;
drop index if exists idx_kanban_cards_item_type_position;
drop index if exists idx_kanban_cards_status_entered;
drop index if exists idx_kanban_cards_title_prefix;
