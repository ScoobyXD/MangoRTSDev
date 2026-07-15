alter table node_projection_table
  add column if not exists is_deleted boolean not null default false;

alter table node_projection_table
  add column if not exists revision bigint not null default 1;

alter table node_projection_table
  drop constraint if exists node_projection_table_revision_chk;

alter table node_projection_table
  add constraint node_projection_table_revision_chk check (revision > 0);

alter table logic_gate_projection_table
  add column if not exists is_deleted boolean not null default false;

alter table logic_gate_projection_table
  add column if not exists revision bigint not null default 1;

alter table logic_gate_projection_table
  drop constraint if exists logic_gate_projection_table_revision_chk;

alter table logic_gate_projection_table
  add constraint logic_gate_projection_table_revision_chk check (revision > 0);
