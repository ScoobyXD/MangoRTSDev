alter table kanban_columns
  add column if not exists width_px integer not null default 260;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kanban_columns_width_px_chk'
  ) then
    alter table kanban_columns
      add constraint kanban_columns_width_px_chk check (width_px between 180 and 520);
  end if;
end $$;
