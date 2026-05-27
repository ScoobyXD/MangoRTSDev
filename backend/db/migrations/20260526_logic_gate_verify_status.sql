with logic_gate_boards as (
  select company_id, board_id
  from kanban_boards
  where logic_gate_id is not null
),
done_columns as (
  update kanban_columns column_row
  set position = 4000,
      updated_timestamp = now()
  from logic_gate_boards board
  where column_row.company_id = board.company_id
    and column_row.board_id = board.board_id
    and lower(btrim(column_row.title)) = 'done'
    and column_row.position <= 3000
  returning column_row.company_id, column_row.board_id
)
insert into kanban_columns (
  company_id,
  board_id,
  column_id,
  title,
  position,
  width_px,
  height_px,
  item_color,
  created_timestamp,
  updated_timestamp
)
select
  board.company_id,
  board.board_id,
  md5((board.company_id::text || ':' || board.board_id || ':Verify'))::uuid,
  'Verify',
  3000,
  260,
  240,
  '#00aaff',
  now(),
  now()
from logic_gate_boards board
where not exists (
  select 1
  from kanban_columns column_row
  where column_row.company_id = board.company_id
    and column_row.board_id = board.board_id
    and lower(btrim(column_row.title)) = 'verify'
)
on conflict (company_id, board_id, column_id)
do update set
  title = excluded.title,
  position = excluded.position,
  item_color = excluded.item_color,
  updated_timestamp = now();
