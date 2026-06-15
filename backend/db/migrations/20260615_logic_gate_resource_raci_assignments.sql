insert into resource_raci_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  subject_type,
  subject_id,
  created_timestamp
)
select
  company_id,
  'logic_gate',
  logic_gate_id,
  role,
  'user',
  user_id,
  created_timestamp
from logic_gate_raci_assignments
on conflict (company_id, resource_type, resource_id, role, subject_type, subject_id) do nothing;
