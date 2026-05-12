-- Logic Gate Arena persistence: attached logic-gate Kanban boards, node metadata,
-- and single active logic-gate placement per node.

alter table nodes
  add column if not exists due_date date,
  add column if not exists priority smallint,
  add column if not exists assignee_user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'nodes'::regclass
      and conname = 'nodes_priority_chk'
  ) then
    alter table nodes
      add constraint nodes_priority_chk check (priority is null or priority between 1 and 5);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'nodes'::regclass
      and conname = 'nodes_assignee_user_id_fkey'
  ) then
    alter table nodes
      add constraint nodes_assignee_user_id_fkey
      foreign key (assignee_user_id) references users (user_id);
  end if;
end $$;

alter table kanban_boards
  add column if not exists logic_gate_id uuid;

alter table kanban_cards
  add column if not exists logic_gate_id uuid,
  add column if not exists is_issue boolean not null default false;

update kanban_cards
set is_issue = false
where is_issue is null;

alter table kanban_cards
  alter column is_issue set default false,
  alter column is_issue set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kanban_boards'::regclass
      and conname = 'kanban_boards_company_logic_gate_fkey'
  ) then
    alter table kanban_boards
      add constraint kanban_boards_company_logic_gate_fkey
      foreign key (company_id, logic_gate_id)
      references logic_gates (company_id, logic_gate_id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kanban_cards'::regclass
      and conname = 'kanban_cards_company_logic_gate_fkey'
  ) then
    alter table kanban_cards
      add constraint kanban_cards_company_logic_gate_fkey
      foreign key (company_id, logic_gate_id)
      references logic_gates (company_id, logic_gate_id)
      on delete cascade;
  end if;
end $$;

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

update kanban_cards card
set logic_gate_id = board.logic_gate_id
from kanban_boards board
where card.company_id = board.company_id
  and card.board_id = board.board_id
  and board.logic_gate_id is not null
  and card.logic_gate_id is distinct from board.logic_gate_id;

with ranked_logic_gate_cards as (
  select
    ctid,
    row_number() over (
      partition by company_id, node_id
      order by updated_timestamp desc, created_timestamp desc, card_id desc
    ) as rn
  from kanban_cards
  where logic_gate_id is not null
)
delete from kanban_cards target
using ranked_logic_gate_cards ranked
where target.ctid = ranked.ctid
  and ranked.rn > 1;

create unique index if not exists idx_kanban_boards_logic_gate
  on kanban_boards(company_id, logic_gate_id)
  where logic_gate_id is not null;

create unique index if not exists idx_kanban_cards_one_logic_gate_card_per_node
  on kanban_cards(company_id, node_id)
  where logic_gate_id is not null;
