-- Re-run Logic Gate Arena board/default-column repair with idempotent default
-- column inserts. This cleans up gates that were created before their attached
-- arena board was fully materialized, and it avoids duplicate-key failures when
-- the stable default column IDs already exist.

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
  lg.company_id,
  'logic-gate:' || lg.logic_gate_id::text,
  lg.logic_gate_id,
  coalesce(nullif(btrim(lg.header), ''), 'Logic Gate Kanban'),
  coalesce((
    select max(existing.position)
    from kanban_boards existing
    where existing.company_id = lg.company_id
  ), 0) + row_number() over (partition by lg.company_id order by lg.created_timestamp, lg.logic_gate_id) * 1000,
  now(),
  now()
from logic_gates lg
on conflict (company_id, board_id)
do update set
  logic_gate_id = excluded.logic_gate_id,
  title = excluded.title,
  updated_timestamp = now();

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
  lg.company_id,
  'logic-gate:' || lg.logic_gate_id::text,
  md5((lg.company_id::text || ':logic-gate:' || lg.logic_gate_id::text || ':' || defaults.title))::uuid,
  defaults.title,
  defaults.position,
  260,
  240,
  defaults.color,
  now(),
  now()
from logic_gates lg
cross join (
  values
    ('Pending', 1000, '#808080'),
    ('In Progress', 2000, '#ff9500'),
    ('Done', 3000, '#39ff14')
) as defaults(title, position, color)
where exists (
  select 1
  from kanban_boards kb
  where kb.company_id = lg.company_id
    and kb.board_id = 'logic-gate:' || lg.logic_gate_id::text
)
and not exists (
  select 1
  from kanban_columns kc
  where kc.company_id = lg.company_id
    and kc.board_id = 'logic-gate:' || lg.logic_gate_id::text
    and lower(btrim(kc.title)) = lower(btrim(defaults.title))
)
on conflict (company_id, board_id, column_id)
do update set
  title = excluded.title,
  updated_timestamp = now();
