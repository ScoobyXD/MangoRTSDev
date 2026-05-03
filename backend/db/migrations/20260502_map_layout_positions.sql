-- Persist shared visual layout for Node Map and Logic Gate Map.
-- These are read-model/projection tables: one latest position per entity per company.
-- The UI may keep tiny viewport/selection cache for latency, but these rows are the
-- API/database source of truth for multi-user and headless-agent workflows.

create table if not exists node_map_positions (
  company_id uuid not null,
  node_id uuid not null,
  x double precision not null,
  y double precision not null,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, node_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

create index if not exists idx_node_map_positions_company_updated
  on node_map_positions(company_id, updated_timestamp desc);

create table if not exists logic_gate_map_positions (
  company_id uuid not null,
  logic_gate_id uuid not null,
  x double precision not null,
  y double precision not null,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, logic_gate_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_logic_gate_map_positions_company_updated
  on logic_gate_map_positions(company_id, updated_timestamp desc);
