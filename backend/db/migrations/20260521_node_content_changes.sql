create table if not exists node_content_changes (
  company_id uuid not null,
  change_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  change_type text not null,
  text text not null,
  start_offset integer not null,
  end_offset integer not null,
  actor_user_id uuid,
  actor_display_name text not null default '',
  created_timestamp timestamptz not null default now(),
  constraint node_content_changes_type_chk check (change_type in ('addition', 'deletion')),
  constraint node_content_changes_text_nonblank_chk check (btrim(text) <> ''),
  constraint node_content_changes_offsets_chk check (start_offset >= 0 and end_offset >= start_offset),
  primary key (company_id, change_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (actor_user_id) references users (user_id) on delete set null
);

create table if not exists node_content_change_seen (
  company_id uuid not null,
  change_id uuid not null,
  user_id uuid not null,
  seen_timestamp timestamptz not null default now(),
  primary key (company_id, change_id, user_id),
  foreign key (company_id, change_id) references node_content_changes (company_id, change_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_node_content_changes_node_created
  on node_content_changes(company_id, node_id, created_timestamp, change_id);

create index if not exists idx_node_content_change_seen_user
  on node_content_change_seen(company_id, user_id, change_id);
