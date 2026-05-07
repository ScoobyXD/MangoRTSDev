alter table kanban_columns
  drop constraint if exists kanban_columns_width_px_chk,
  add constraint kanban_columns_width_px_chk check (width_px between 180 and 2000);

alter table kanban_columns
  drop constraint if exists kanban_columns_height_px_chk,
  add constraint kanban_columns_height_px_chk check (height_px between 160 and 10000);
