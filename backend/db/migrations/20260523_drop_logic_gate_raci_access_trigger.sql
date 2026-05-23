drop trigger if exists trg_grant_node_assignee_edit_access on nodes;
drop function if exists trg_grant_node_assignee_edit_access();
drop trigger if exists trg_grant_logic_gate_raci_edit_access on logic_gate_raci_assignments;
drop function if exists trg_grant_logic_gate_raci_edit_access();
drop function if exists mangorts_grant_resource_access_at_least(uuid, text, uuid, text, uuid, text);
