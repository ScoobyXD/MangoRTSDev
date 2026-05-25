create table if not exists node_projection_seen_snapshots (
  company_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  user_id uuid not null,
  information text not null,
  projection_updated_timestamp timestamptz not null,
  seen_timestamp timestamptz not null default now(),
  primary key (company_id, node_id, information_id, user_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_node_projection_seen_user
  on node_projection_seen_snapshots(company_id, user_id, node_id, information_id);
