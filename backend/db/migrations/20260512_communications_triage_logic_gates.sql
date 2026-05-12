create table if not exists communications_triage_items (
  user_id uuid not null,
  message_id text not null,
  message jsonb not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_triage_items_message_id_nonblank_chk check (btrim(message_id) <> ''),
  primary key (user_id, message_id),
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_communications_triage_items_user_created
  on communications_triage_items(user_id, created_timestamp desc, message_id);

create table if not exists user_logic_gate_shortcuts (
  user_id uuid not null,
  company_id uuid not null,
  logic_gate_id uuid not null,
  position integer not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (user_id, company_id, logic_gate_id),
  foreign key (user_id) references users (user_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_user_logic_gate_shortcuts_user_company_position
  on user_logic_gate_shortcuts(user_id, company_id, position, logic_gate_id);

create table if not exists communications_email_nodes (
  company_id uuid not null,
  user_id uuid not null,
  message_id text not null,
  node_id uuid not null,
  board_id text not null,
  card_id uuid not null,
  logic_gate_id uuid not null,
  message jsonb not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_nodes_message_id_nonblank_chk check (btrim(message_id) <> ''),
  primary key (company_id, node_id),
  unique (company_id, board_id, card_id),
  foreign key (user_id) references users (user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, board_id, card_id) references kanban_cards (company_id, board_id, card_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_communications_email_nodes_user_message
  on communications_email_nodes(user_id, message_id);

create index if not exists idx_communications_email_nodes_logic_gate
  on communications_email_nodes(company_id, logic_gate_id, created_timestamp desc);
