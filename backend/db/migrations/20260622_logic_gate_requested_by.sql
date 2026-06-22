alter table node_logic_gate_assignments
  add column if not exists requested_by_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_logic_gate_assignments_requested_by_user_id_fkey'
  ) then
    alter table node_logic_gate_assignments
      add constraint node_logic_gate_assignments_requested_by_user_id_fkey
      foreign key (company_id, requested_by_user_id)
      references company_memberships(company_id, user_id)
      on delete set null;
  end if;
end $$;

alter table kanban_board_projection
  add column if not exists requested_by_user_id uuid;

update kanban_board_projection projection
set requested_by_user_id = assignment.requested_by_user_id
from node_logic_gate_assignments assignment
where projection.company_id = assignment.company_id
  and projection.logic_gate_id = assignment.logic_gate_id
  and projection.node_id = assignment.node_id
  and projection.requested_by_user_id is distinct from assignment.requested_by_user_id;
