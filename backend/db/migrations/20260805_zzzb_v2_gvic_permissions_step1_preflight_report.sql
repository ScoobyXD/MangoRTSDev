-- Read-only report function used only by the Step 1 operator preflight.

create or replace function mangorts_v2_step1_preflight_report()
returns table(
  report_order bigint,
  section text,
  identity text,
  status text,
  details jsonb
)
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive all_resources(company_id,resource_type,resource_id) as materialized (
    select company_id,'node'::text,node_id from nodes
    union all select company_id,'logic_gate',logic_gate_id from logic_gates
    union all select company_id,'project',project_id from projects
    union all select company_id,'company_explorer_folder',folder_id from company_explorer_folders
    union all select company_id,'shared_inbox_folder',folder_id from shared_inbox_folders
    union all select company_id,'shared_inbox',shared_inbox_id from shared_inboxes
  ),
  source_identities(source_name,company_id,resource_type,resource_id) as materialized (
    select 'gvic_assignment',company_id,
           case when resource_type='shared_triage_folder' then 'shared_inbox_folder' else resource_type end,
           resource_id from resource_gvic_assignments
    union all
    select 'gvic_revision',company_id,
           case when resource_type='shared_triage_folder' then 'shared_inbox_folder' else resource_type end,
           resource_id from resource_gvic_policy_revisions
    union all
    select 'gvic_application',company_id,
           case when ancestor_resource_type='shared_triage_folder' then 'shared_inbox_folder' else ancestor_resource_type end,
           ancestor_resource_id from resource_gvic_subtree_applications
    union all
    select 'gvic_effective_target',company_id,
           case when resource_type='shared_triage_folder' then 'shared_inbox_folder' else resource_type end,
           resource_id from resource_gvic_effective_assignments
    union all
    select 'gvic_effective_source',company_id,
           case when source_resource_type='shared_triage_folder' then 'shared_inbox_folder' else source_resource_type end,
           source_resource_id from resource_gvic_effective_assignments
    union all
    select 'permission_assignment',company_id,resource_type,resource_id from resource_permissions
    union all
    select 'permission_revision',company_id,resource_type,resource_id from resource_permission_policy_revisions
    union all
    select 'permission_application',company_id,ancestor_resource_type,ancestor_resource_id
    from resource_permission_subtree_applications
    union all
    select 'projection_node',company_id,'node',node_id from gvic_matrix_projection_table
    union all
    select 'projection_logic_gate',company_id,'logic_gate',logic_gate_id
    from gvic_matrix_projection_table where logic_gate_id is not null
    union all
    select 'projection_project',company_id,'project',project_id
    from gvic_matrix_projection_table where project_id is not null
  ),
  source_dispositions as materialized (
    select source.source_name,source.company_id,source.resource_type,source.resource_id,
           mangorts_v2_policy_resource_exists(source.company_id,source.resource_type,source.resource_id) as resource_exists
    from source_identities source
  ),
  resolved_gvic as materialized (
    select resource.company_id,resource.resource_type,resource.resource_id,
           edge.role,edge.principal_type,edge.principal_id
    from all_resources resource
    cross join lateral mangorts_v2_step1_resolved_gvic(
      resource.company_id,resource.resource_type,resource.resource_id
    ) edge
  ),
  resolved_permissions as materialized (
    select resource.company_id,resource.resource_type,resource.resource_id,
           edge.subject_type,edge.subject_id,edge.access_level
    from all_resources resource
    cross join lateral mangorts_v2_step1_resolved_permissions(
      resource.company_id,resource.resource_type,resource.resource_id
    ) edge
  ),
  resolved_defaults as materialized (
    select resource.*,
           mangorts_v2_step1_resolved_permission_default(
             resource.company_id,resource.resource_type,resource.resource_id
           ) as default_access
    from all_resources resource
  ),
  principal_rows(domain_name,company_id,principal_type,principal_id) as materialized (
    select 'resolved_gvic',company_id,principal_type,principal_id from resolved_gvic
    union all
    select 'resolved_permission',company_id,subject_type,subject_id from resolved_permissions
    union all
    select 'gvic_source',company_id,principal_type,principal_id from resource_gvic_assignments
    union all
    select 'gvic_application',company_id,principal_type,principal_id
    from resource_gvic_subtree_applications where principal_id is not null
    union all
    select 'permission_source',company_id,subject_type,subject_id from resource_permissions
    union all
    select 'permission_application',company_id,subject_type,subject_id
    from resource_permission_subtree_applications where subject_id is not null
  ),
  invalid_principals as materialized (
    select principal.*
    from principal_rows principal
    where (principal.principal_type='user' and not exists (
             select 1 from company_memberships membership
             where membership.company_id=principal.company_id and membership.user_id=principal.principal_id
           ))
       or (principal.principal_type='group' and not exists (
             select 1 from company_user_groups user_group
             where user_group.company_id=principal.company_id and user_group.group_id=principal.principal_id
           ))
       or principal.principal_type not in ('user','group')
  ),
  group_tree(company_id,ancestor_group_id,descendant_group_id,path) as (
    select company_id,group_id,group_id,array[group_id] from company_user_groups
    union all
    select tree.company_id,tree.ancestor_group_id,child.group_id,tree.path || child.group_id
    from group_tree tree
    join company_user_groups child
      on child.company_id=tree.company_id and child.parent_group_id=tree.descendant_group_id
    where not child.group_id=any(tree.path)
  ),
  expected_effective as materialized (
    select edge.company_id,edge.resource_type,edge.resource_id,edge.role,
           edge.principal_id as user_id,edge.principal_type as source_principal_type,
           edge.principal_id as source_principal_id
    from resolved_gvic edge
    join company_memberships membership
      on edge.principal_type='user'
     and membership.company_id=edge.company_id and membership.user_id=edge.principal_id
    union
    select edge.company_id,edge.resource_type,edge.resource_id,edge.role,
           member.user_id,edge.principal_type,edge.principal_id
    from resolved_gvic edge
    join group_tree tree
      on edge.principal_type='group'
     and tree.company_id=edge.company_id and tree.ancestor_group_id=edge.principal_id
    join company_user_group_members member
      on member.company_id=tree.company_id and member.group_id=tree.descendant_group_id
  ),
  actual_effective as materialized (
    select company_id,
           case when resource_type='shared_triage_folder' then 'shared_inbox_folder' else resource_type end as resource_type,
           resource_id,role,user_id,source_principal_type,source_principal_id
    from resource_gvic_effective_assignments
  ),
  effective_disagreements as materialized (
    (select * from expected_effective except select * from actual_effective)
    union all
    (select * from actual_effective except select * from expected_effective)
  ),
  expected_projection as materialized (
    select distinct company_id,resource_id as node_id,user_id,role
    from expected_effective where resource_type='node'
  ),
  actual_projection as materialized (
    select distinct company_id,node_id,user_id,gvic_assignment as role
    from gvic_matrix_projection_table
  ),
  projection_disagreements as materialized (
    (select * from actual_projection except select * from expected_projection)
  ),
  invalid_gvic_shape as materialized (
    select company_id,resource_type,resource_id,'generated_or_verified_group'::text as problem
    from resolved_gvic where role in ('generated','verified') and principal_type='group'
    union all
    select company_id,resource_type,resource_id,'multiple_generated_users'
    from resolved_gvic where role='generated'
    group by company_id,resource_type,resource_id having count(*) > 1
    union all
    select company_id,resource_type,resource_id,'principal_has_multiple_roles'
    from resolved_gvic
    group by company_id,resource_type,resource_id,principal_type,principal_id
    having count(distinct role) > 1
  ),
  blockers(section,identity,details) as materialized (
    select 'SOURCE_IDENTITY',source_name || ':' || company_id || ':' || resource_type || ':' || resource_id,
           jsonb_build_object('reason','missing_resource')
    from source_dispositions where not resource_exists
    union all
    select 'PRINCIPAL',domain_name || ':' || company_id || ':' || principal_type || ':' || principal_id,
           jsonb_build_object('reason','missing_same_company_principal')
    from invalid_principals
    union all
    select 'GVIC_SHAPE',company_id || ':' || resource_type || ':' || resource_id,
           jsonb_build_object('reason',problem)
    from invalid_gvic_shape
    union all
    select 'RESOURCE_CYCLE',company_id || ':' || resource_type || ':' || resource_id,
           jsonb_build_object('reason','policy_parent_cycle')
    from all_resources
    where mangorts_v2_policy_resource_has_cycle(company_id,resource_type,resource_id)
    union all
    select 'PARENT_RELATIONSHIP',resource.company_id || ':' || resource.resource_type || ':' || resource.resource_id,
           jsonb_build_object('reason','missing_required_immediate_parent')
    from all_resources resource
    left join lateral mangorts_v2_policy_parent(resource.company_id,resource.resource_type,resource.resource_id) parent on true
    where resource.resource_type in ('logic_gate','project','shared_inbox') and parent.parent_resource_id is null
    union all
    select 'PERMISSION_DEFAULT',company_id || ':' || resource_type || ':' || resource_id,
           jsonb_build_object('reason','unresolved_default_access')
    from resolved_defaults where default_access not in ('edit','no_access')
    union all
    select 'GVIC_EFFECTIVE_DISAGREEMENT',company_id || ':' || resource_type || ':' || resource_id,
           jsonb_build_object('role',role,'user_id',user_id,'source_principal_type',source_principal_type,'source_principal_id',source_principal_id)
    from effective_disagreements
    union all
    select 'GVIC_PROJECTION_DISAGREEMENT',company_id || ':node:' || node_id,
           jsonb_build_object('role',role,'user_id',user_id)
    from projection_disagreements
  ),
  information_rows(section,identity,details) as materialized (
    select 'OLD_POLICY_COUNT','gvic:' || type.resource_type,jsonb_build_object(
      'source_rows',(select count(*) from resource_gvic_assignments source
        where (case when source.resource_type='shared_triage_folder' then 'shared_inbox_folder' else source.resource_type end)=type.resource_type),
      'revision_rows',(select count(*) from resource_gvic_policy_revisions revision
        where (case when revision.resource_type='shared_triage_folder' then 'shared_inbox_folder' else revision.resource_type end)=type.resource_type),
      'subtree_application_rows',(select count(*) from resource_gvic_subtree_applications app
        where (case when app.ancestor_resource_type='shared_triage_folder' then 'shared_inbox_folder' else app.ancestor_resource_type end)=type.resource_type),
      'effective_rows',(select count(*) from resource_gvic_effective_assignments effective
        where (case when effective.resource_type='shared_triage_folder' then 'shared_inbox_folder' else effective.resource_type end)=type.resource_type),
      'projection_rows',(select count(*) from gvic_matrix_projection_table where type.resource_type='node')
    )
    from (values
      ('node'::text),('logic_gate'),('project'),('company_explorer_folder'),('shared_inbox_folder'),('shared_inbox')
    ) type(resource_type)
    union all
    select 'OLD_POLICY_COUNT','permission:' || type.resource_type,jsonb_build_object(
      'source_rows',(select count(*) from resource_permissions source where source.resource_type=type.resource_type),
      'revision_rows',(select count(*) from resource_permission_policy_revisions revision where revision.resource_type=type.resource_type),
      'subtree_application_rows',(select count(*) from resource_permission_subtree_applications app where app.ancestor_resource_type=type.resource_type)
    )
    from (values
      ('node'::text),('logic_gate'),('project'),('company_explorer_folder'),('shared_inbox_folder'),('shared_inbox')
    ) type(resource_type)
    union all
    select 'RESOURCE_COUNT','gvic:' || resource_type,
           jsonb_build_object('resource_count',count(*),'resolved_edge_count',(
             select count(*) from resolved_gvic edge where edge.resource_type=resource.resource_type
           ))
    from all_resources resource group by resource_type
    union all
    select 'RESOURCE_COUNT','permission:' || resource_type,
           jsonb_build_object('resource_count',count(*),'resolved_edge_count',(
             select count(*) from resolved_permissions edge where edge.resource_type=resource.resource_type
           ),'resolved_default_count',(
             select count(*) from resolved_defaults defaults
             where defaults.resource_type=resource.resource_type and defaults.default_access in ('edit','no_access')
           ))
    from all_resources resource group by resource_type
    union all
    select 'LEGACY_USAGE','gvic_snapshots_and_tombstones',jsonb_build_object(
      'snapshot_rows',(select count(*) from resource_gvic_subtree_applications where snapshot),
      'tombstone_rows',(select count(*) from resource_gvic_subtree_applications where deleted)
    )
    union all
    select 'LEGACY_USAGE','permission_snapshots_and_tombstones',jsonb_build_object(
      'snapshot_rows',(select count(*) from resource_permission_subtree_applications where rule_key='__snapshot__'),
      'tombstone_rows',(select count(*) from resource_permission_subtree_applications where deleted)
    )
    union all
    select 'LEGACY_USAGE','shared_triage_aliases',jsonb_build_object(
      'assignment_rows',(select count(*) from resource_gvic_assignments where resource_type='shared_triage_folder'),
      'revision_rows',(select count(*) from resource_gvic_policy_revisions where resource_type='shared_triage_folder'),
      'application_rows',(select count(*) from resource_gvic_subtree_applications where ancestor_resource_type='shared_triage_folder')
    )
    union all
    select 'TARGET_COUNT','v2_storage',jsonb_build_object(
      'gvic_settings',(select count(*) from resource_gvic_settings),
      'gvic_staging_edges',(select count(*) from resource_gvic_assignments_v2_staging),
      'permission_settings',(select count(*) from resource_permission_settings),
      'permission_staging_edges',(select count(*) from resource_permissions_v2_staging)
    )
  ),
  disposition_rows(section,identity,status,details) as materialized (
    select 'SOURCE_DISPOSITION',
           source_name || ':' || company_id || ':' || resource_type || ':' || resource_id,
           case when resource_exists then 'READY' else 'STOP' end,
           jsonb_build_object(
             'source_name',source_name,'company_id',company_id,'resource_type',resource_type,
             'resource_id',resource_id,'v2_mode',case when resource_exists then 'customized' else null end,
             'disposition',case when resource_exists then 'copy_resolved_complete_policy' else 'block_missing_resource' end
           )
    from source_dispositions
  ),
  rows_before_final(section,identity,status,details) as (
    select section,identity,'INFO',details from information_rows
    union all
    select section,identity,status,details from disposition_rows
    union all
    select section,identity,'STOP',details from blockers
  ),
  ordered as (
    select row_number() over(order by section,identity,details::text) as report_order,
           section,identity,status,details
    from rows_before_final
  )
  select report_order,section,identity,status,details from ordered
  union all
  select coalesce((select max(report_order) from ordered),0)+1,
         'FINAL','v2_gvic_permissions_step1_preflight',
         case when exists(select 1 from blockers) then 'STOP' else 'READY' end,
         jsonb_build_object(
           'blocker_count',(select count(*) from blockers),
           'resource_count',(select count(*) from all_resources),
           'resolved_gvic_edge_count',(select count(*) from resolved_gvic),
           'resolved_permission_edge_count',(select count(*) from resolved_permissions),
           'resolved_permission_default_count',(select count(*) from resolved_defaults where default_access in ('edit','no_access')),
           'effective_disagreement_count',(select count(*) from effective_disagreements),
           'projection_disagreement_count',(select count(*) from projection_disagreements)
         )
  order by report_order;
$$;
