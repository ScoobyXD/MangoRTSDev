-- Logic-gate information now follows the same history/projection split as nodes:
-- logic_gate_information keeps every save, while this table serves latest values
-- for hot editor/API reads keyed by stable information_id.

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

create index if not exists idx_logic_gate_projection_table_logic_gate_updated
  on logic_gate_projection_table(company_id, logic_gate_id, updated_timestamp desc);

-- Backfill existing current-value rows from the pre-projection contract. This is
-- safe to re-run and only moves the projection forward when source data is newer.
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
