-- Project management timeline source table plus bounded read projection.
-- Source truth is the timeline item row. The projection denormalizes the
-- node/logic-gate title and status fields so weekly reads avoid joins.
create table if not exists project_management_timeline_items (
  company_id uuid not null,
  item_id uuid not null,
  user_id uuid not null,
  node_id uuid,
  logic_gate_id uuid,
  start_date date not null,
  duration_days smallint not null,
  position integer not null default 0,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, item_id),
  constraint project_management_timeline_item_target_chk check (
    (node_id is not null and logic_gate_id is null)
    or (node_id is null and logic_gate_id is not null)
  ),
  constraint project_management_timeline_duration_chk check (duration_days between 1 and 90),
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id)
);

create unique index if not exists idx_project_management_timeline_user_node
  on project_management_timeline_items(company_id, user_id, node_id)
  where node_id is not null;

create unique index if not exists idx_project_management_timeline_user_logic_gate
  on project_management_timeline_items(company_id, user_id, logic_gate_id)
  where logic_gate_id is not null;

create index if not exists idx_project_management_timeline_hot_read
  on project_management_timeline_items(company_id, user_id, start_date, position, item_id);

create table if not exists project_management_timeline_projection (
  company_id uuid not null,
  item_id uuid not null,
  user_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  node_id uuid,
  logic_gate_id uuid,
  display_title text not null,
  status text,
  status_color text,
  due_date date,
  priority smallint,
  assignee_user_id uuid,
  assignee_display_name text,
  assignee_email text,
  start_date date not null,
  end_date date not null,
  duration_days smallint not null,
  position integer not null default 0,
  resource_created_timestamp timestamptz not null,
  timeline_created_timestamp timestamptz not null,
  timeline_updated_timestamp timestamptz not null,
  projection_updated_timestamp timestamptz not null default now(),
  primary key (company_id, user_id, item_id),
  constraint project_management_timeline_projection_resource_type_chk check (resource_type in ('node', 'logic_gate')),
  constraint project_management_timeline_projection_title_chk check (btrim(display_title) <> ''),
  constraint project_management_timeline_projection_duration_chk check (duration_days between 1 and 90),
  constraint project_management_timeline_projection_target_chk check (
    (resource_type='node' and node_id is not null and logic_gate_id is null and resource_id=node_id)
    or (resource_type='logic_gate' and logic_gate_id is not null and node_id is null and resource_id=logic_gate_id)
  ),
  foreign key (company_id, item_id) references project_management_timeline_items(company_id, item_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (assignee_user_id) references users(user_id)
);

create index if not exists idx_project_management_timeline_projection_hot_read
  on project_management_timeline_projection(company_id, user_id, start_date, position, item_id);

create index if not exists idx_project_management_timeline_projection_node
  on project_management_timeline_projection(company_id, node_id);

create index if not exists idx_project_management_timeline_projection_logic_gate
  on project_management_timeline_projection(company_id, logic_gate_id);
