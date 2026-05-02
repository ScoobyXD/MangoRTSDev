create table if not exists kanban_columns (
  company_id uuid not null,
  board_id text not null,
  column_id uuid not null,
  title text not null,
  position integer not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint kanban_columns_title_nonblank_chk check (btrim(title) <> ''),
  primary key (company_id, board_id, column_id)
);

create table if not exists kanban_cards (
  company_id uuid not null,
  board_id text not null,
  card_id uuid not null,
  column_id uuid not null,
  item_type text not null,
  node_id uuid,
  logic_gate_id uuid,
  title_snapshot text not null,
  position integer not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint kanban_cards_title_snapshot_nonblank_chk check (btrim(title_snapshot) <> ''),
  constraint kanban_cards_item_type_chk check (item_type in ('node', 'logic_gate')),
  constraint kanban_cards_one_item_chk check (
    (item_type = 'node' and node_id is not null and logic_gate_id is null)
    or (item_type = 'logic_gate' and logic_gate_id is not null and node_id is null)
  ),
  primary key (company_id, board_id, card_id),
  foreign key (company_id, board_id, column_id) references kanban_columns (company_id, board_id, column_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create index if not exists idx_kanban_columns_board_position
  on kanban_columns(company_id, board_id, position);

create index if not exists idx_kanban_cards_column_position
  on kanban_cards(company_id, board_id, column_id, position);

create unique index if not exists idx_kanban_cards_unique_node
  on kanban_cards(company_id, board_id, node_id)
  where node_id is not null;

create unique index if not exists idx_kanban_cards_unique_logic_gate
  on kanban_cards(company_id, board_id, logic_gate_id)
  where logic_gate_id is not null;
