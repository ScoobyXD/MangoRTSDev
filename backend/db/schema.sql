-- Canonical Aurora PostgreSQL schema for MVP.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'node_relationship_position') then
    create type node_relationship_position as enum ('Parent', 'Child', 'Peer');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'logic_gate_relationship_position') then
    create type logic_gate_relationship_position as enum ('Input', 'Output');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'information_type') then
    create type information_type as enum (
      'Text box',
      'Checklist',
      'Status',
      'Due date',
      'Employee name',
      'PDF',
      'PNG',
      'MOV',
      'Hyperlink'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'operation_status') then
    create type operation_status as enum ('In Progress', 'Success', 'Failed');
  end if;
end $$;

create table if not exists nodes (
  company_id uuid not null,
  node_id uuid not null,
  title text not null,
  created_timestamp timestamptz not null,
  primary key (company_id, node_id)
);

create table if not exists node_relationships (
  company_id uuid not null,
  node_relationship_id uuid not null,
  node_id_a uuid not null,
  node_id_b uuid not null,
  a_position node_relationship_position not null,
  b_position node_relationship_position not null,
  created_timestamp timestamptz not null,
  constraint node_relationships_position_pair_chk check (
    (a_position = 'Parent' and b_position = 'Child')
    or (a_position = 'Child' and b_position = 'Parent')
    or (a_position = 'Peer' and b_position = 'Peer')
  ),
  constraint node_relationships_not_self_chk check (node_id_a <> node_id_b),
  primary key (company_id, node_relationship_id),
  foreign key (company_id, node_id_a) references nodes (company_id, node_id),
  foreign key (company_id, node_id_b) references nodes (company_id, node_id)
);

create table if not exists node_information (
  company_id uuid not null,
  information_id uuid not null,
  node_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint node_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id)
);

create table if not exists node_projection_table (
  company_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint node_projection_table_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, node_id, information_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id)
);

create table if not exists logic_gates (
  company_id uuid not null,
  logic_gate_id uuid not null,
  header text not null,
  created_timestamp timestamptz not null,
  primary key (company_id, logic_gate_id)
);

create table if not exists logic_gate_relationships (
  company_id uuid not null,
  logic_gate_relationship_id uuid not null,
  logic_gate_id_a uuid not null,
  logic_gate_id_b uuid not null,
  a_position logic_gate_relationship_position not null,
  b_position logic_gate_relationship_position not null,
  created_timestamp timestamptz not null,
  constraint logic_gate_relationships_position_pair_chk check (
    (a_position = 'Input' and b_position = 'Output')
    or (a_position = 'Output' and b_position = 'Input')
  ),
  constraint logic_gate_relationships_not_self_chk check (logic_gate_id_a <> logic_gate_id_b),
  primary key (company_id, logic_gate_relationship_id),
  foreign key (company_id, logic_gate_id_a) references logic_gates (company_id, logic_gate_id),
  foreign key (company_id, logic_gate_id_b) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_information (
  company_id uuid not null,
  information_id uuid not null,
  logic_gate_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint logic_gate_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_projection_table (
  company_id uuid not null,
  logic_gate_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint logic_gate_projection_table_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, logic_gate_id, information_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

-- Existing deployments may already have current-value logic_gate_information rows.
-- Seed the projection table once so the new hot read path can serve those rows too.
insert into logic_gate_projection_table (
  company_id,
  logic_gate_id,
  information_id,
  type,
  information,
  created_timestamp,
  updated_timestamp
)
select distinct on (company_id, logic_gate_id, information_id)
  company_id,
  logic_gate_id,
  information_id,
  type,
  information,
  created_timestamp,
  updated_timestamp
from logic_gate_information
where btrim(information) <> ''
order by company_id, logic_gate_id, information_id, updated_timestamp desc
on conflict (company_id, logic_gate_id, information_id)
do update set
  type = excluded.type,
  information = excluded.information,
  updated_timestamp = excluded.updated_timestamp
where logic_gate_projection_table.updated_timestamp <= excluded.updated_timestamp;

create table if not exists operations (
  company_id uuid not null,
  operation_id uuid not null,
  node_id uuid,
  logic_gate_id uuid,
  status operation_status not null,
  start_timestamp timestamptz not null,
  end_timestamp timestamptz,
  primary key (company_id, operation_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create index if not exists idx_node_information_node on node_information(company_id, node_id);
create index if not exists idx_node_projection_table_node_updated on node_projection_table(company_id, node_id, updated_timestamp desc);
create index if not exists idx_logic_gate_information_logic_gate on logic_gate_information(company_id, logic_gate_id);
create index if not exists idx_logic_gate_projection_table_logic_gate_updated on logic_gate_projection_table(company_id, logic_gate_id, updated_timestamp desc);
create index if not exists idx_logic_gate_relationships_a on logic_gate_relationships(company_id, logic_gate_id_a);
create index if not exists idx_logic_gate_relationships_b on logic_gate_relationships(company_id, logic_gate_id_b);
create index if not exists idx_operations_node on operations(company_id, node_id);
create index if not exists idx_operations_logic_gate on operations(company_id, logic_gate_id);

create table if not exists workspace_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  folder_kind text not null,
  name text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint workspace_folders_kind_chk check (folder_kind in ('node', 'logic_gate')),
  constraint workspace_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint workspace_folders_parent_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id),
  primary key (company_id, folder_id),
  foreign key (company_id, parent_folder_id) references workspace_folders (company_id, folder_id) on delete cascade
);

create index if not exists idx_workspace_folders_parent_kind
  on workspace_folders(company_id, folder_kind, parent_folder_id, created_timestamp);

create table if not exists workspace_folder_items (
  company_id uuid not null,
  folder_id uuid not null,
  item_type text not null,
  item_id uuid not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint workspace_folder_items_type_chk check (item_type in ('node', 'logic_gate')),
  primary key (company_id, item_type, item_id),
  foreign key (company_id, folder_id) references workspace_folders (company_id, folder_id) on delete cascade
);

create index if not exists idx_workspace_folder_items_folder_type
  on workspace_folder_items(company_id, folder_id, item_type, created_timestamp);

create table if not exists workspace_context_events (
  company_id uuid not null,
  workspace_id uuid not null,
  context_id text not null,
  source_module_id text not null,
  sequence bigint not null,
  user_action_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, workspace_id, context_id, sequence)
);

create index if not exists idx_workspace_context_events_company_workspace_context_sequence
  on workspace_context_events (company_id, workspace_id, context_id, sequence desc);

create table if not exists workspace_context_projections (
  company_id uuid not null,
  workspace_id uuid not null,
  context_id text not null,
  last_sequence bigint not null,
  last_event_timestamp timestamptz not null,
  last_payload_json jsonb not null default '{}'::jsonb,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, workspace_id, context_id)
);

create index if not exists idx_workspace_context_projections_company_workspace_context
  on workspace_context_projections (company_id, workspace_id, context_id);
