create table if not exists company_projection_sequences (
  company_id uuid not null,
  projection_name text not null,
  sequence bigint not null default 0,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, projection_name),
  foreign key (company_id) references companies (company_id) on delete cascade,
  constraint company_projection_sequences_name_nonblank_chk check (btrim(projection_name) <> ''),
  constraint company_projection_sequences_sequence_nonnegative_chk check (sequence >= 0)
);
