create table if not exists communications_message_state (
  company_id uuid not null,
  message_id text not null,
  shared_inbox boolean not null default false,
  status text not null default 'open',
  assigned_user_id uuid,
  linked_node_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, message_id),
  constraint communications_message_state_message_id_chk check (btrim(message_id) <> ''),
  constraint communications_message_state_status_chk check (status in ('open', 'pending', 'resolved')),
  foreign key (company_id, assigned_user_id) references company_memberships (company_id, user_id) on delete set null,
  foreign key (company_id, linked_node_id) references nodes (company_id, node_id) on delete set null
);

create index if not exists idx_communications_message_state_company_updated
  on communications_message_state(company_id, updated_timestamp desc);

create table if not exists communications_message_comments (
  company_id uuid not null,
  message_id text not null,
  comment_id uuid not null,
  user_id uuid not null,
  body text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, message_id, comment_id),
  constraint communications_message_comments_body_chk check (btrim(body) <> ''),
  foreign key (company_id, message_id) references communications_message_state (company_id, message_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_communications_message_comments_message_created
  on communications_message_comments(company_id, message_id, created_timestamp asc);

create table if not exists communications_shared_drafts (
  company_id uuid not null,
  message_id text not null,
  user_id uuid not null,
  draft_id uuid not null,
  subject text not null default '',
  body text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, message_id, user_id),
  constraint communications_shared_drafts_content_chk check (btrim(subject) <> '' or btrim(body) <> ''),
  foreign key (company_id, message_id) references communications_message_state (company_id, message_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_communications_shared_drafts_message_updated
  on communications_shared_drafts(company_id, message_id, updated_timestamp desc);

create table if not exists communications_read_receipts (
  company_id uuid not null,
  message_id text not null,
  user_id uuid not null,
  read_timestamp timestamptz not null default now(),
  primary key (company_id, message_id, user_id),
  foreign key (company_id, message_id) references communications_message_state (company_id, message_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_communications_read_receipts_message_read
  on communications_read_receipts(company_id, message_id, read_timestamp desc);
