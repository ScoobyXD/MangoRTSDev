begin;

create table if not exists entity_fields (
  company_id uuid not null,
  field_id uuid not null,
  name varchar(64) not null,
  color varchar(7) not null default '#6366f1',
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entity_fields_name_nonblank_chk check (btrim(name) <> ''),
  constraint entity_fields_color_chk check (color ~ '^#[0-9a-f]{6}$'),
  primary key (company_id, field_id),
  foreign key (company_id) references companies(company_id) on delete cascade
);

create unique index if not exists idx_entity_fields_company_name_unique
  on entity_fields(company_id, lower(btrim(name)));

create index if not exists idx_entity_fields_company_position
  on entity_fields(company_id, position, lower(name), field_id);

create table if not exists entity_field_assignments (
  company_id uuid not null,
  field_id uuid not null,
  resource_type text not null,
  project_id uuid,
  node_id uuid,
  logic_gate_id uuid,
  resource_id uuid generated always as (coalesce(project_id, node_id, logic_gate_id)) stored,
  created_timestamp timestamptz not null default now(),
  constraint entity_field_assignments_target_chk check (
    (resource_type='project' and project_id is not null and node_id is null and logic_gate_id is null)
    or (resource_type='node' and project_id is null and node_id is not null and logic_gate_id is null)
    or (resource_type='logic_gate' and project_id is null and node_id is null and logic_gate_id is not null)
  ),
  primary key (company_id, field_id, resource_type, resource_id),
  foreign key (company_id, field_id) references entity_fields(company_id, field_id) on delete cascade,
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_entity_field_assignments_resource
  on entity_field_assignments(company_id, resource_type, resource_id, field_id);

create index if not exists idx_entity_field_assignments_field
  on entity_field_assignments(company_id, field_id, resource_type, resource_id);

commit;
