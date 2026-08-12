-- Typed Huddle Logic Gate membership and Huddle Node relationship snapshots.
-- PostgreSQL 17.x compatible.

alter table huddle_nodes drop constraint if exists huddle_nodes_body_chk;
alter table huddle_nodes drop constraint if exists huddle_nodes_revision_chk;
alter table huddle_nodes drop column if exists body_json;
alter table huddle_nodes drop column if exists revision;
alter table huddle_nodes drop column if exists deleted_timestamp;

create unique index if not exists uq_kpis_owner_identity
  on kpis(company_id,logic_gate_id,kpi_id);

create table if not exists huddle_logic_gate_relationships (
  company_id uuid not null,
  huddle_logic_gate_id uuid not null,
  logic_gate_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,huddle_logic_gate_id,logic_gate_id),
  foreign key (company_id,huddle_logic_gate_id)
    references huddle_logic_gates(company_id,huddle_logic_gate_id) on delete cascade,
  foreign key (company_id,logic_gate_id)
    references logic_gates(company_id,logic_gate_id) on delete cascade
);

create index if not exists idx_huddle_logic_gate_relationships_logic_gate
  on huddle_logic_gate_relationships(company_id,logic_gate_id,huddle_logic_gate_id);

create table if not exists huddle_node_logic_gate_relationships (
  company_id uuid not null,
  huddle_node_id uuid not null,
  logic_gate_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,huddle_node_id,logic_gate_id),
  foreign key (company_id,huddle_node_id)
    references huddle_nodes(company_id,huddle_node_id) on delete cascade,
  foreign key (company_id,logic_gate_id)
    references logic_gates(company_id,logic_gate_id) on delete cascade
);

create index if not exists idx_huddle_node_logic_gate_relationships_logic_gate
  on huddle_node_logic_gate_relationships(company_id,logic_gate_id,huddle_node_id);

create table if not exists huddle_node_kpi_relationships (
  company_id uuid not null,
  huddle_node_id uuid not null,
  logic_gate_id uuid not null,
  kpi_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,huddle_node_id,logic_gate_id,kpi_id),
  foreign key (company_id,huddle_node_id,logic_gate_id)
    references huddle_node_logic_gate_relationships(company_id,huddle_node_id,logic_gate_id) on delete cascade,
  foreign key (company_id,logic_gate_id,kpi_id)
    references kpis(company_id,logic_gate_id,kpi_id) on delete cascade
);

create index if not exists idx_huddle_node_kpi_relationships_kpi
  on huddle_node_kpi_relationships(company_id,kpi_id,huddle_node_id);
