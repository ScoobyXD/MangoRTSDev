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
  if not exists (select 1 from pg_type where typname = 'info_type') then
    create type info_type as enum (
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
  type info_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  primary key (company_id, information_id),
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
```

## Field-by-field mapping from your sheet

### Node Schema

- Company ID (UUIDv7) (FK) -> `nodes.company_id`
- Node ID (UUIDv7) -> `nodes.node_id`
- Header (Text) -> `nodes.header`
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

### Logic Gate Information Schema

- Company ID (UUIDv7) (FK) -> `logic_gate_information.company_id`
- Information ID (UUIDv7) -> `logic_gate_information.information_id`
- Logic Gate ID (UUIDv7) (FK) -> `logic_gate_information.logic_gate_id`
- Type (Enum: text box, checklist, status, due date, employee name, pdf, png, mov, hyperlink) -> `logic_gate_information.type`
- Information (Text) -> `logic_gate_information.information`
- Created Timestamp (TIMESTAMPTZ) -> `logic_gate_information.created_timestamp`
- Updated Timestamp (TIMESTAMPTZ) -> `logic_gate_information.updated_timestamp`

### Operation

- Company ID (UUIDv7) (FK) -> `operations.company_id`
- Operation ID (UUIDv7) -> `operations.operation_id`
- Node ID (UUIDv7) (FK) -> `operations.node_id`
- Logic Gate ID (UUIDv7) (FK) -> `operations.logic_gate_id`
- Status (Enum: In Progress, Success, Failed) -> `operations.status`
- Start Timestamp (TIMESTAMPTZ) -> `operations.start_timestamp`
- End Timestamp (TIMESTAMPTZ) -> `operations.end_timestamp`
