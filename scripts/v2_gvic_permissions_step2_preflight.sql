-- DBeaver-safe, read-only Step 2 cutover preflight. PostgreSQL 17.x and 18.x are supported.
begin transaction read only;

with expected(table_name, columns) as (
  values
    ('resource_gvic_assignments', array['company_id','resource_type','resource_id','role','principal_type','principal_id','created_timestamp','updated_timestamp']::text[]),
    ('resource_permissions', array['company_id','resource_type','resource_id','subject_type','subject_id','user_id','access_level','created_timestamp','updated_timestamp']::text[]),
    ('resource_gvic_settings', array['company_id','resource_type','resource_id','assignment_mode','customized_sequence','parent_link_sequence','descendant_reset_sequence','created_timestamp','updated_timestamp']::text[]),
    ('resource_permission_settings', array['company_id','resource_type','resource_id','permission_mode','default_access','customized_sequence','parent_link_sequence','descendant_reset_sequence','created_timestamp','updated_timestamp']::text[]),
    ('resource_gvic_assignments_v2_staging', array['company_id','resource_type','resource_id','role','principal_type','principal_id','created_timestamp','updated_timestamp']::text[]),
    ('resource_permissions_v2_staging', array['company_id','resource_type','resource_id','subject_type','subject_id','access_level','created_timestamp','updated_timestamp']::text[])
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
              then 'READY' else 'STOP' end status,
         jsonb_build_object('expected_column_count',array_length(expected.columns,1),'actual_column_count',coalesce(actual.column_count,0)) details
  from expected left join actual using(table_name)
), step1 as (
  select status,details from mangorts_v2_step1_preflight_report() where section='FINAL'
), checks as (
  select 'SERVER_VERSION' section, current_setting('server_version') identity,
         case when current_setting('server_version_num')::integer between 170000 and 189999 then 'READY' else 'STOP' end status,
         jsonb_build_object('server_version_num',current_setting('server_version_num')::integer) details
  union all
  select 'TABLE_SHAPE',table_name,status,details from shape_checks
  union all
  select 'STEP1_RECONCILIATION','final',status,details from step1
), final as (
  select case when exists(select 1 from checks where status='STOP') then 'STOP' else 'READY' end status,
         count(*) filter(where status='STOP') blocker_count
  from checks
)
select section,identity,status,details from checks
union all
select 'FINAL','v2_gvic_permissions_step2_preflight',status,jsonb_build_object('blocker_count',blocker_count) from final
order by section,identity;

rollback;
