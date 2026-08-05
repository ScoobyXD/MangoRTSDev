-- V2 GVIC and permissions Step 1 read-only preflight.
-- Run in DBeaver after the additive Step 1 migrations. The last row is READY or STOP.

begin transaction read only;

with expected(table_name,column_names) as materialized (
  values
    ('companies',array['company_id','name','created_timestamp','updated_timestamp']),
    ('users',array['user_id','cognito_subject','email','display_name','created_timestamp','updated_timestamp']),
    ('company_memberships',array['company_id','user_id','role','created_timestamp','updated_timestamp']),
    ('company_user_groups',array['company_id','group_id','parent_group_id','name','position','created_timestamp','updated_timestamp']),
    ('company_user_group_members',array['company_id','group_id','user_id','created_timestamp','updated_timestamp']),
    ('nodes',array['company_id','node_id','name','status','due_date','priority','default_access','created_timestamp']),
    ('logic_gates',array['company_id','logic_gate_id','header','default_access','created_timestamp']),
    ('projects',array['company_id','project_id','name','status','health','default_access','created_timestamp','updated_timestamp']),
    ('company_explorer_folders',array['company_id','folder_id','parent_folder_id','name','default_access','position','created_by_user_id','created_timestamp','updated_timestamp']),
    ('company_explorer_items',array['company_id','item_id','parent_folder_id','target_type','target_id','position','created_by_user_id','created_timestamp','updated_timestamp']),
    ('shared_inbox_folders',array['company_id','folder_id','parent_folder_id','name','default_access','position','created_timestamp','updated_timestamp']),
    ('shared_inboxes',array['company_id','shared_inbox_id','parent_folder_id','name','account_email','company_email_connection_id','default_access','position','created_timestamp','updated_timestamp']),
    ('node_logic_gate_assignments',array['assignment_id','company_id','node_id','logic_gate_id','status_key','column_id','is_issue','position','compatibility_board_id','compatibility_card_id','requested_by_user_id','placed_by_user_id','version','created_timestamp','updated_timestamp']),
    ('resource_gvic_assignments',array['company_id','resource_type','resource_id','role','principal_type','principal_id','created_timestamp','updated_timestamp']),
    ('resource_gvic_effective_assignments',array['company_id','resource_type','resource_id','role','user_id','source_resource_type','source_resource_id','source_principal_type','source_principal_id','inheritance_type','updated_timestamp']),
    ('resource_gvic_policy_revisions',array['company_id','resource_type','resource_id','policy_sequence','updated_timestamp']),
    ('resource_gvic_subtree_applications',array['application_id','policy_sequence','company_id','ancestor_resource_type','ancestor_resource_id','role','principal_type','principal_id','deleted','snapshot','created_timestamp']),
    ('resource_permissions',array['company_id','resource_type','resource_id','subject_type','subject_id','user_id','access_level','created_timestamp','updated_timestamp']),
    ('resource_permission_policy_revisions',array['company_id','resource_type','resource_id','policy_sequence','updated_timestamp']),
    ('resource_permission_subtree_applications',array['application_id','policy_sequence','company_id','ancestor_resource_type','ancestor_resource_id','rule_key','subject_type','subject_id','access_level','deleted','created_timestamp']),
    ('gvic_matrix_projection_table',array['company_id','projection_row_id','user_id','node_name','gvic_assignment','priority','project_id','project_name','logic_gate_id','logic_gate_name','node_id','status','due_date','accounts','created_timestamp','updated_timestamp','sort_order']),
    ('resource_gvic_settings',array['company_id','resource_type','resource_id','assignment_mode','customized_sequence','parent_link_sequence','descendant_reset_sequence','created_timestamp','updated_timestamp']),
    ('resource_permission_settings',array['company_id','resource_type','resource_id','permission_mode','default_access','customized_sequence','parent_link_sequence','descendant_reset_sequence','created_timestamp','updated_timestamp']),
    ('resource_gvic_assignments_v2_staging',array['company_id','resource_type','resource_id','role','principal_type','principal_id','created_timestamp','updated_timestamp']),
    ('resource_permissions_v2_staging',array['company_id','resource_type','resource_id','subject_type','subject_id','access_level','created_timestamp','updated_timestamp'])
),
column_drift as materialized (
  select expected.table_name,
         cardinality(expected.column_names) as expected_count,
         (select count(*) from information_schema.columns actual
          where actual.table_schema='public' and actual.table_name=expected.table_name) as actual_count,
         (select count(*) from unnest(expected.column_names) required(column_name)
          where not exists (
            select 1 from information_schema.columns actual
            where actual.table_schema='public' and actual.table_name=expected.table_name
              and actual.column_name=required.column_name
          )) as missing_count,
         (select count(*) from information_schema.columns actual
          where actual.table_schema='public' and actual.table_name=expected.table_name
            and not actual.column_name=any(expected.column_names)) as extra_count
  from expected
),
object_drift(object_name,object_exists) as materialized (
  values
    ('resource_gvic_change_sequence',(to_regclass('public.resource_gvic_change_sequence') is not null)),
    ('resource_permission_change_sequence',(to_regclass('public.resource_permission_change_sequence') is not null)),
    ('mangorts_v2_policy_resource_exists',(to_regprocedure('public.mangorts_v2_policy_resource_exists(uuid,text,uuid)') is not null)),
    ('mangorts_v2_policy_parent',(to_regprocedure('public.mangorts_v2_policy_parent(uuid,text,uuid)') is not null)),
    ('mangorts_v2_policy_resource_has_cycle',(to_regprocedure('public.mangorts_v2_policy_resource_has_cycle(uuid,text,uuid)') is not null)),
    ('mangorts_v2_step1_resolved_gvic',(to_regprocedure('public.mangorts_v2_step1_resolved_gvic(uuid,text,uuid)') is not null)),
    ('mangorts_v2_step1_resolved_permission_default',(to_regprocedure('public.mangorts_v2_step1_resolved_permission_default(uuid,text,uuid)') is not null)),
    ('mangorts_v2_step1_resolved_permissions',(to_regprocedure('public.mangorts_v2_step1_resolved_permissions(uuid,text,uuid)') is not null)),
    ('mangorts_v2_step1_preflight_report',(to_regprocedure('public.mangorts_v2_step1_preflight_report()') is not null))
),
readiness as materialized (
  select current_setting('server_version_num')::integer between 170000 and 189999 as version_ready,
         not exists (
           select 1 from column_drift
           where expected_count<>actual_count or missing_count<>0 or extra_count<>0
         ) and not exists(select 1 from object_drift where not object_exists) as schema_ready
),
data_report as materialized (
  select report.*
  from readiness ready
  cross join lateral mangorts_v2_step1_preflight_report() report
  where ready.version_ready and ready.schema_ready
),
preflight_rows(report_order,section,identity,status,details) as (
  select 1::bigint,'SERVER','postgresql',
         case when readiness.version_ready then 'READY' else 'STOP' end,
         jsonb_build_object(
           'server_version',current_setting('server_version'),
           'server_version_num',current_setting('server_version_num')::integer,
           'supported_versions','17.x or 18.x; production target is 17.x',
           'transaction_read_only',current_setting('transaction_read_only')
         )
  from readiness
  union all
  select 10+row_number() over(order by table_name),
         'SCHEMA',table_name,
         case when expected_count=actual_count and missing_count=0 and extra_count=0 then 'READY' else 'STOP' end,
         jsonb_build_object(
           'expected_column_count',expected_count,'actual_column_count',actual_count,
           'missing_column_count',missing_count,'extra_column_count',extra_count,
           'comparison','exact unordered column-name set plus exact count'
         )
  from column_drift
  union all
  select 100+row_number() over(order by object_name),
         'SCHEMA_OBJECT',object_name,case when object_exists then 'READY' else 'STOP' end,
         jsonb_build_object('exists',object_exists)
  from object_drift
  union all
  select 1000+report_order,section,identity,status,details from data_report
  union all
  select 999999999::bigint,'FINAL','v2_gvic_permissions_step1_preflight','STOP',
         jsonb_build_object(
           'reason',case when not version_ready then 'unsupported_postgresql_version' else 'schema_drift' end
         )
  from readiness
  where not version_ready or not schema_ready
)
select section,identity,status,details
from preflight_rows
order by report_order;

commit;
