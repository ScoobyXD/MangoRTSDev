-- Re-run Logic Gate Arena board/default-column repair with the same invariant
-- used by the application: logic_gate_id is the authoritative attachment, and
-- logic-gate:<id> is only the preferred board_id for newly materialized boards.

with ranked_attached_boards as (
  select
    company_id,
    board_id,
    logic_gate_id,
    row_number() over (
      partition by company_id, logic_gate_id
      order by (board_id = 'logic-gate:' || logic_gate_id::text) desc, created_timestamp asc, board_id asc
    ) as rn
  from kanban_boards
  where logic_gate_id is not null
)
update kanban_boards board
set logic_gate_id = null,
    updated_timestamp = now()
from ranked_attached_boards ranked
where board.company_id = ranked.company_id
  and board.board_id = ranked.board_id
  and ranked.rn > 1;

with attached_boards as (
  select distinct on (company_id, logic_gate_id)
    company_id,
    logic_gate_id,
    board_id
  from kanban_boards
  where logic_gate_id is not null
  order by company_id, logic_gate_id, (board_id = 'logic-gate:' || logic_gate_id::text) desc, created_timestamp asc, board_id asc
),
updated_attached as (
  update kanban_boards board
  set title = coalesce(nullif(btrim(logic_gate.header), ''), 'Logic Gate Kanban'),
      updated_timestamp = now()
  from logic_gates logic_gate
  join attached_boards attached
    on attached.company_id = logic_gate.company_id
   and attached.logic_gate_id = logic_gate.logic_gate_id
  where board.company_id = attached.company_id
    and board.board_id = attached.board_id
  returning board.company_id, board.board_id, board.logic_gate_id
)
insert into kanban_boards (
  company_id,
  board_id,
  logic_gate_id,
  title,
  position,
  created_timestamp,
  updated_timestamp
)
select
  logic_gate.company_id,
  'logic-gate:' || logic_gate.logic_gate_id::text,
  logic_gate.logic_gate_id,
  coalesce(nullif(btrim(logic_gate.header), ''), 'Logic Gate Kanban'),
  coalesce((
    select max(existing.position)
    from kanban_boards existing
    where existing.company_id = logic_gate.company_id
  ), 0) + row_number() over (partition by logic_gate.company_id order by logic_gate.created_timestamp, logic_gate.logic_gate_id) * 1000,
  now(),
  now()
from logic_gates logic_gate
where not exists (
  select 1
  from updated_attached attached
  where attached.company_id = logic_gate.company_id
    and attached.logic_gate_id = logic_gate.logic_gate_id
)
on conflict (company_id, board_id)
do update set
  logic_gate_id = excluded.logic_gate_id,
  title = excluded.title,
  updated_timestamp = now();

with board_targets as (
  select distinct on (logic_gate.company_id, logic_gate.logic_gate_id)
    logic_gate.company_id,
    logic_gate.logic_gate_id,
    board.board_id
  from logic_gates logic_gate
  join kanban_boards board
    on board.company_id = logic_gate.company_id
   and board.logic_gate_id = logic_gate.logic_gate_id
  order by logic_gate.company_id, logic_gate.logic_gate_id, (board.board_id = 'logic-gate:' || logic_gate.logic_gate_id::text) desc, board.created_timestamp asc, board.board_id asc
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
  target.company_id,
  target.board_id,
  md5((target.company_id::text || ':' || target.board_id || ':' || defaults.title))::uuid,
  defaults.title,
  defaults.position,
  260,
  240,
  defaults.color,
  now(),
  now()
from board_targets target
cross join (
  values
    ('Pending', 1000, '#808080'),
    ('In Progress', 2000, '#ff9500'),
    ('Done', 3000, '#39ff14')
) as defaults(title, position, color)
where not exists (
  select 1
  from kanban_columns column_row
  where column_row.company_id = target.company_id
    and column_row.board_id = target.board_id
    and lower(btrim(column_row.title)) = lower(btrim(defaults.title))
)
on conflict (company_id, board_id, column_id)
do update set
  title = excluded.title,
  updated_timestamp = now();
