# Aurora PostgreSQL Schema (from provided spreadsheet)

This document captures the **exact schema structure** shown in your spreadsheet so it can be used for your AWS Aurora PostgreSQL database.

## Notes

- `UUIDv7` is stored as PostgreSQL `uuid` (application/service generates UUIDv7 values).
- `TIMESTAMPTZ` is stored as PostgreSQL `timestamptz`.
- `Company ID` is present on every table and included in foreign keys where applicable.
- Position/status/info-type fields are modeled as enums.

## PostgreSQL DDL

```sql
-- ==========================================================
-- ENUMS
-- ==========================================================

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

-- ==========================================================
-- NODE SCHEMA
-- ==========================================================

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

-- ==========================================================
-- LOGIC GATE SCHEMA
-- ==========================================================

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

-- ==========================================================
-- OPERATION
-- ==========================================================

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

-- ==========================================================
-- WORKSPACE FOLDERS
-- ==========================================================

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
```

## Field-by-field mapping from your sheet

### Node Schema

- Company ID (UUIDv7) (FK) -> `nodes.company_id`
- Node ID (UUIDv7) -> `nodes.node_id`
- Title (Text) -> `nodes.title`
- Created Timestamp (TIMESTAMPTZ) -> `nodes.created_timestamp`

### Node Relationships Schema

- Company ID (UUIDv7) (FK) -> `node_relationships.company_id`
- Node Relationship ID (UUIDv7) -> `node_relationships.node_relationship_id`
- Node ID A (UUIDv7) (FK) -> `node_relationships.node_id_a`
- Node ID B (UUIDv7) (FK) -> `node_relationships.node_id_b`
- A Position (Enum: Parent, Child, Peer) -> `node_relationships.a_position`
- B Position (Enum: Parent, Child, Peer) -> `node_relationships.b_position`
- Created Timestamp (TIMESTAMPTZ) -> `node_relationships.created_timestamp`
- Constraint: `node_relationships_position_pair_chk` allows only Parent->Child, Child->Parent, or Peer<->Peer.
- Constraint: `node_relationships_not_self_chk` requires `node_id_a <> node_id_b`.

### Node Information Schema

- Company ID (UUIDv7) (FK) -> `node_information.company_id`
- Information ID (UUIDv7) -> `node_information.information_id`
- Node ID (UUIDv7) (FK) -> `node_information.node_id`
- Type (Enum: text box, checklist, status, due date, employee name, pdf, png, mov, hyperlink) -> `node_information.type`
- Information (Text) -> `node_information.information`
- Created Timestamp (TIMESTAMPTZ) -> `node_information.created_timestamp`
- Updated Timestamp (TIMESTAMPTZ) -> `node_information.updated_timestamp`
- Constraint: `node_information_nonblank_chk` rejects whitespace-only information.

### Logic Gate Schema

- Company ID (UUIDv7) (FK) -> `logic_gates.company_id`
- Logic Gate ID (UUIDv7) -> `logic_gates.logic_gate_id`
- Header (Text) -> `logic_gates.header`
- Created Timestamp (TIMESTAMPTZ) -> `logic_gates.created_timestamp`

### Logic Gate Relationships Schema

- Company ID (UUIDv7) (FK) -> `logic_gate_relationships.company_id`
- Logic Gate Relationship ID (UUIDv7) -> `logic_gate_relationships.logic_gate_relationship_id`
- Logic Gate ID A (UUIDv7) (FK) -> `logic_gate_relationships.logic_gate_id_a`
- Logic Gate ID B (UUIDv7) (FK) -> `logic_gate_relationships.logic_gate_id_b`
- A Position (Enum: Input, Output) -> `logic_gate_relationships.a_position`
- B Position (Enum: Input, Output) -> `logic_gate_relationships.b_position`
- Created Timestamp (TIMESTAMPTZ) -> `logic_gate_relationships.created_timestamp`
- Constraint: `logic_gate_relationships_position_pair_chk` allows only Input->Output or Output->Input.
- Constraint: `logic_gate_relationships_not_self_chk` requires `logic_gate_id_a <> logic_gate_id_b`.

### Logic Gate Information Schema

- Company ID (UUIDv7) (FK) -> `logic_gate_information.company_id`
- Information ID (UUIDv7) -> `logic_gate_information.information_id`
- Logic Gate ID (UUIDv7) (FK) -> `logic_gate_information.logic_gate_id`
- Type (Enum: text box, checklist, status, due date, employee name, pdf, png, mov, hyperlink) -> `logic_gate_information.type`
- Information (Text) -> `logic_gate_information.information`
- Created Timestamp (TIMESTAMPTZ) -> `logic_gate_information.created_timestamp`
- Updated Timestamp (TIMESTAMPTZ) -> `logic_gate_information.updated_timestamp`
- Constraint: `logic_gate_information_nonblank_chk` rejects whitespace-only information.

### Logic Gate Projection Schema

- Company ID (UUIDv7) (FK) -> `logic_gate_projection_table.company_id`
- Logic Gate ID (UUIDv7) (FK) -> `logic_gate_projection_table.logic_gate_id`
- Information ID (UUIDv7) -> `logic_gate_projection_table.information_id`
- Type (Enum: text box, checklist, status, due date, employee name, pdf, png, mov, hyperlink) -> `logic_gate_projection_table.type`
- Information (Text) -> `logic_gate_projection_table.information`
- Created Timestamp (TIMESTAMPTZ) -> `logic_gate_projection_table.created_timestamp`
- Updated Timestamp (TIMESTAMPTZ) -> `logic_gate_projection_table.updated_timestamp`
- Constraint: `logic_gate_projection_table_nonblank_chk` rejects whitespace-only information.
- Primary key: `(company_id, logic_gate_id, information_id)` keeps one latest row per stable text-box/info identity.

`logic_gate_information` is the durable history table. `logic_gate_projection_table` is the hot read model for current values used by UI clients and headless agents.

### Operation

- Company ID (UUIDv7) (FK) -> `operations.company_id`
- Operation ID (UUIDv7) -> `operations.operation_id`
- Node ID (UUIDv7) (FK) -> `operations.node_id`
- Logic Gate ID (UUIDv7) (FK) -> `operations.logic_gate_id`
- Status (Enum: In Progress, Success, Failed) -> `operations.status`
- Start Timestamp (TIMESTAMPTZ) -> `operations.start_timestamp`
- End Timestamp (TIMESTAMPTZ) -> `operations.end_timestamp`
