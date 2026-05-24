alter table effective_resource_access drop constraint if exists effective_resource_access_access_level_chk;

alter table effective_resource_access
  add constraint effective_resource_access_access_level_chk check (access_level in ('no_access', 'view', 'edit', 'admin'));

with ranked as (
  select ctid,
         row_number() over (
           partition by company_id, user_id, resource_type, resource_id
           order by updated_timestamp desc,
                    created_timestamp desc,
                    mangorts_access_level_rank(access_level) desc,
                    source_type desc,
                    source_id desc
         ) as rn
  from effective_resource_access
)
delete from effective_resource_access access
using ranked
where access.ctid = ranked.ctid
  and ranked.rn > 1;

alter table effective_resource_access drop constraint if exists effective_resource_access_pkey;

alter table effective_resource_access
  add primary key (company_id, user_id, resource_type, resource_id);
