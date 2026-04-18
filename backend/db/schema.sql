-- Canonical Aurora PostgreSQL schema for MVP.

create type if not exists node_relationship_position as enum ('Parent', 'Child', 'Peer');
create type if not exists logic_gate_relationship_position as enum ('Input', 'Output');
create type if not exists info_type as enum (
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
create type if not exists operation_status as enum ('In Progress', 'Success', 'Failed');

create table if not exists nodes (
  company_id uuid not null,
  node_id uuid not null,
  header text not null,
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
  primary key (company_id, node_relationship_id),
  foreign key (company_id, node_id_a) references nodes (company_id, node_id),
  foreign key (company_id, node_id_b) references nodes (company_id, node_id)
);

create table if not exists node_information (
  company_id uuid not null,
  information_id uuid not null,
  node_id uuid not null,
  type info_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  primary key (company_id, information_id),
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
  primary key (company_id, logic_gate_relationship_id),
  foreign key (company_id, logic_gate_id_a) references logic_gates (company_id, logic_gate_id),
  foreign key (company_id, logic_gate_id_b) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_information (
  company_id uuid not null,
  information_id uuid not null,
  logic_gate_id uuid not null,
  type info_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  primary key (company_id, information_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

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
create index if not exists idx_operations_node on operations(company_id, node_id);
create index if not exists idx_operations_logic_gate on operations(company_id, logic_gate_id);
