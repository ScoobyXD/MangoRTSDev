delete from resource_access_grants grant_row
using company_memberships membership
where grant_row.company_id = membership.company_id
  and grant_row.principal_type = 'user'
  and grant_row.principal_id = membership.user_id
  and grant_row.resource_type in ('node', 'logic_gate')
  and grant_row.access_level = 'no_access'
  and membership.role in ('dev_admin', 'company_admin');

with resources as (
  select company_id, 'node'::text as resource_type, node_id as resource_id
  from nodes
  union all
  select company_id, 'logic_gate'::text, logic_gate_id
  from logic_gates
  union all
  select company_id, 'shared_triage_folder'::text, folder_id
  from company_explorer_folders
  where folder_kind = 'communications'
),
admin_source_candidates as (
  select resources.company_id as target_company_id,
         membership.user_id,
         'membership:' || membership.company_id::text || ':' || membership.user_id::text as source_id,
         row_number() over (
           partition by resources.company_id, membership.user_id
           order by case when membership.company_id = resources.company_id then 0 else 1 end,
                    membership.company_id::text
         ) as rn
  from resources
  join company_memberships membership
    on membership.role = 'dev_admin'
    or (membership.company_id = resources.company_id and membership.role = 'company_admin')
  group by resources.company_id, membership.company_id, membership.user_id
),
admin_sources as (
  select target_company_id, user_id, source_id
  from admin_source_candidates
  where rn = 1
)
insert into effective_resource_access (
  company_id,
  user_id,
  resource_type,
  resource_id,
  access_level,
  source_type,
  source_id,
  created_timestamp,
  updated_timestamp
)
select resources.company_id,
       admin_sources.user_id,
       resources.resource_type,
       resources.resource_id,
       'admin',
       'company_admin',
       admin_sources.source_id,
       now(),
       now()
from resources
join admin_sources
  on admin_sources.target_company_id = resources.company_id
on conflict (company_id, user_id, resource_type, resource_id)
do update set
  access_level = excluded.access_level,
  source_type = excluded.source_type,
  source_id = excluded.source_id,
  updated_timestamp = now();
