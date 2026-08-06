-- DBeaver-safe, read-only readiness check. Run after the Step 2 cutover migration and matching application deploy.
begin transaction read only;

with expected(table_name, columns) as (
  values
    ('resource_gvic_settings', array['company_id','resource_type','resource_id','assignment_mode','customized_sequence','parent_link_sequence','descendant_reset_sequence','created_timestamp','updated_timestamp']::text[]),
    ('resource_gvic_assignments', array['company_id','resource_type','resource_id','role','principal_type','principal_id','created_timestamp','updated_timestamp']::text[]),
    ('resource_permission_settings', array['company_id','resource_type','resource_id','permission_mode','default_access','customized_sequence','parent_link_sequence','descendant_reset_sequence','created_timestamp','updated_timestamp']::text[]),
    ('resource_permissions', array['company_id','resource_type','resource_id','subject_type','subject_id','access_level','created_timestamp','updated_timestamp']::text[])
), actual as (
  select table_name, array_agg(column_name order by column_name) columns, count(*) column_count
  from information_schema.columns
  where table_schema='public' and table_name in (select table_name from expected)
  group by table_name
), shape_checks as (
  select expected.table_name,
         case when actual.column_count=array_length(expected.columns,1)
                   and not exists(select 1 from unnest(expected.columns) c where not (c=any(actual.columns)))
                   and not exists(select 1 from unnest(actual.columns) c where not (c=any(expected.columns)))
              then 'READY' else 'STOP' end status
  from expected left join actual using(table_name)
), resources as (
  select count(*) total from (
    select company_id,'node' resource_type,node_id resource_id from nodes union all
    select company_id,'logic_gate',logic_gate_id from logic_gates union all
    select company_id,'project',project_id from projects union all
    select company_id,'company_explorer_folder',folder_id from company_explorer_folders union all
    select company_id,'shared_inbox_folder',folder_id from shared_inbox_folders union all
    select company_id,'shared_inbox',shared_inbox_id from shared_inboxes
  ) r
), checks(section,identity,status,details) as (
  select 'SERVER_VERSION',current_setting('server_version'),case when current_setting('server_version_num')::integer between 170000 and 189999 then 'READY' else 'STOP' end,
         jsonb_build_object('server_version_num',current_setting('server_version_num')::integer)
  union all select 'FINAL_TABLE_SHAPE',table_name,status,'{}'::jsonb from shape_checks
  union all select 'LEGACY_EVIDENCE','resource_gvic_assignments_step2_legacy',case when to_regclass('public.resource_gvic_assignments_step2_legacy') is not null then 'READY' else 'STOP' end,'{}'
  union all select 'LEGACY_EVIDENCE','resource_permissions_step2_legacy',case when to_regclass('public.resource_permissions_step2_legacy') is not null then 'READY' else 'STOP' end,'{}'
  union all select 'STAGING_RETIRED','resource_gvic_assignments_v2_staging',case when to_regclass('public.resource_gvic_assignments_v2_staging') is null then 'READY' else 'STOP' end,'{}'
  union all select 'STAGING_RETIRED','resource_permissions_v2_staging',case when to_regclass('public.resource_permissions_v2_staging') is null then 'READY' else 'STOP' end,'{}'
  union all select 'SETTINGS_COVERAGE','gvic',case when (select count(*) from resource_gvic_settings)=(select total from resources) then 'READY' else 'STOP' end,
         jsonb_build_object('settings',(select count(*) from resource_gvic_settings),'resources',(select total from resources))
  union all select 'SETTINGS_COVERAGE','permissions',case when (select count(*) from resource_permission_settings)=(select total from resources) then 'READY' else 'STOP' end,
         jsonb_build_object('settings',(select count(*) from resource_permission_settings),'resources',(select total from resources))
), final as (
  select case when exists(select 1 from checks where status='STOP') then 'STOP' else 'READY' end status,
         count(*) filter(where status='STOP') blocker_count from checks
)
select section,identity,status,details from checks
union all select 'FINAL','v2_gvic_permissions_step2_readiness',status,jsonb_build_object('blocker_count',blocker_count) from final
order by section,identity;

rollback;
