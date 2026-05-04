create table if not exists kanban_boards (
  company_id uuid not null,
  board_id text not null,
  title text not null,
  position integer not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint kanban_boards_title_nonblank_chk check (btrim(title) <> ''),
  primary key (company_id, board_id)
);

insert into kanban_boards (
  company_id,
  board_id,
  title,
  position,
  created_timestamp,
  updated_timestamp
)
select
  company_id,
  board_id,
  board_id,
  (row_number() over (partition by company_id order by min_created_timestamp, board_id) * 1000)::integer,
  min_created_timestamp,
  max_updated_timestamp
from (
  select
    company_id,
    board_id,
    min(min_created_timestamp) as min_created_timestamp,
    max(max_updated_timestamp) as max_updated_timestamp
  from (
    select
      company_id,
      board_id,
      min(created_timestamp) as min_created_timestamp,
      max(updated_timestamp) as max_updated_timestamp
    from kanban_columns
    group by company_id, board_id
    union all
    select
      company_id,
      board_id,
      min(created_timestamp) as min_created_timestamp,
      max(updated_timestamp) as max_updated_timestamp
    from kanban_cards
    group by company_id, board_id
  ) board_sources
  group by company_id, board_id
) existing_boards
on conflict (company_id, board_id) do nothing;

update kanban_cards card
set node_title = node.title
from nodes node
where card.company_id = node.company_id
  and card.node_id = node.node_id
  and card.node_title <> node.title;

create index if not exists idx_kanban_boards_company_position
  on kanban_boards(company_id, position, board_id);
