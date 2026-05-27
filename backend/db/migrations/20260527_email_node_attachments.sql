create table if not exists communications_email_node_attachments (
  company_id uuid not null,
  user_id uuid not null,
  message_id text not null,
  node_id uuid not null,
  board_id text not null default '',
  card_id uuid not null,
  logic_gate_id uuid not null,
  message jsonb not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_node_attachments_message_id_nonblank_chk check (btrim(message_id) <> ''),
  primary key (company_id, user_id, message_id, node_id),
  foreign key (user_id) references users (user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_communications_email_node_attachments_user_message
  on communications_email_node_attachments(user_id, message_id);

create index if not exists idx_communications_email_node_attachments_node
  on communications_email_node_attachments(company_id, node_id, updated_timestamp desc);

create index if not exists idx_communications_email_node_attachments_logic_gate
  on communications_email_node_attachments(company_id, logic_gate_id, updated_timestamp desc);
