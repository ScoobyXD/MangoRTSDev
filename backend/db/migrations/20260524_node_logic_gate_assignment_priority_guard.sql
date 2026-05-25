create or replace function enforce_node_logic_gate_assignment_priority()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from nodes n
    where n.company_id = new.company_id
      and n.node_id = new.node_id
      and n.priority between 1 and 5
  ) then
    raise exception 'node_logic_gate_assignment_priority_required'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_node_logic_gate_assignment_priority on node_logic_gate_assignments;
create trigger trg_node_logic_gate_assignment_priority
before insert or update of company_id, node_id on node_logic_gate_assignments
for each row
execute function enforce_node_logic_gate_assignment_priority();
