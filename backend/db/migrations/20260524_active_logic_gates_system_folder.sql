-- Add a holding folder for newly-created Logic Gates so they do not appear as
-- loose root rows before they are moved into a functional folder.

insert into company_explorer_folders (
  company_id,
  folder_id,
  parent_folder_id,
  folder_kind,
  system_key,
  name,
  position,
  created_timestamp,
  updated_timestamp
)
select
  company_id,
  md5(company_id::text || ':system_folders_v2:active_logic_gates')::uuid,
  null,
  'logic_gate',
  'active_logic_gates',
  'Active Logic Gates',
  200,
  now(),
  now()
from companies
on conflict (company_id, system_key) where system_key is not null do nothing;
