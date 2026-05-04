-- Supports fast relationship cleanup when a node or logic gate is moved to
-- another Company Explorer folder level.

create index if not exists idx_node_relationships_a
  on node_relationships(company_id, node_id_a);

create index if not exists idx_node_relationships_b
  on node_relationships(company_id, node_id_b);

create index if not exists idx_logic_gate_relationships_a
  on logic_gate_relationships(company_id, logic_gate_id_a);

create index if not exists idx_logic_gate_relationships_b
  on logic_gate_relationships(company_id, logic_gate_id_b);
