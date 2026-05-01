-- Add the same low-level safety guards to logic gate relationships that node
-- relationships already have. Keeping this in the database protects API clients,
-- UI users, and future headless agents from writing invalid graph edges.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'logic_gate_relationships_position_pair_chk'
  ) then
    alter table logic_gate_relationships
      add constraint logic_gate_relationships_position_pair_chk check (
        (a_position = 'Input' and b_position = 'Output')
        or (a_position = 'Output' and b_position = 'Input')
      ) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'logic_gate_relationships_not_self_chk'
  ) then
    alter table logic_gate_relationships
      add constraint logic_gate_relationships_not_self_chk check (logic_gate_id_a <> logic_gate_id_b) not valid;
  end if;
end $$;

create index if not exists idx_logic_gate_information_logic_gate
  on logic_gate_information(company_id, logic_gate_id);

create index if not exists idx_logic_gate_relationships_a
  on logic_gate_relationships(company_id, logic_gate_id_a);

create index if not exists idx_logic_gate_relationships_b
  on logic_gate_relationships(company_id, logic_gate_id_b);
