create table if not exists company_projection_sequences (
  company_id uuid not null,
  projection_name text not null,
  projection_scope text not null default '',
  sequence bigint not null default 0,
  updated_timestamp timestamptz not null default now(),
  foreign key (company_id) references companies (company_id) on delete cascade,
  constraint company_projection_sequences_name_nonblank_chk check (btrim(projection_name) <> ''),
  constraint company_projection_sequences_scope_not_null_chk check (projection_scope is not null),
  constraint company_projection_sequences_sequence_nonnegative_chk check (sequence >= 0)
);

alter table if exists company_projection_sequences
  add column if not exists projection_scope text not null default '';

alter table if exists company_projection_sequences
  alter column projection_scope set default '';

alter table if exists company_projection_sequences
  drop constraint if exists company_projection_sequences_scope_not_null_chk;

alter table if exists company_projection_sequences
  add constraint company_projection_sequences_scope_not_null_chk
  check (projection_scope is not null);

alter table if exists company_projection_sequences
  drop constraint if exists company_projection_sequences_pkey;

alter table if exists company_projection_sequences
  add constraint company_projection_sequences_pkey
  primary key (company_id, projection_name, projection_scope);
