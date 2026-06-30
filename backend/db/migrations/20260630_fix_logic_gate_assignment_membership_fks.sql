alter table if exists node_logic_gate_assignments
  drop constraint if exists node_logic_gate_assignments_requested_by_user_id_fkey,
  drop constraint if exists node_logic_gate_assignments_placed_by_user_id_fkey;

alter table node_logic_gate_assignments
  add constraint node_logic_gate_assignments_requested_by_user_id_fkey
  foreign key (company_id, requested_by_user_id)
  references company_memberships (company_id, user_id)
  on delete set null (requested_by_user_id);

alter table node_logic_gate_assignments
  add constraint node_logic_gate_assignments_placed_by_user_id_fkey
  foreign key (company_id, placed_by_user_id)
  references company_memberships (company_id, user_id)
  on delete set null (placed_by_user_id);
