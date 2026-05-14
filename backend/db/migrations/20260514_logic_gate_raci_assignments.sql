-- Logic Gate RACI matrix. Nodes inherit RACI through their current Logic Gate
-- cards; the assignments live on the gate and reference company members.

create table if not exists logic_gate_raci_assignments (
  company_id uuid not null,
  logic_gate_id uuid not null,
  role text not null,
  user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint logic_gate_raci_assignments_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  primary key (company_id, logic_gate_id, role, user_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_logic_gate_raci_user_role_gate
  on logic_gate_raci_assignments(company_id, user_id, role, logic_gate_id);

create index if not exists idx_logic_gate_raci_gate_role_user
  on logic_gate_raci_assignments(company_id, logic_gate_id, role, user_id);
