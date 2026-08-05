-- Migration-only legacy resolvers for V2 GVIC and permissions Step 1.
-- These reproduce deployed latest-snapshot and direct-revision behavior.

create or replace function mangorts_v2_step1_resolved_gvic(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  role text,
  principal_type text,
  principal_id uuid,
  created_timestamp timestamptz,
  updated_timestamp timestamptz
)
language sql
stable
set search_path=public,pg_temp
as $$
  with requested(company_id,resource_type,legacy_resource_type,resource_id) as (
    select p_company_id,
           p_resource_type,
           case when p_resource_type='shared_inbox_folder' then 'shared_triage_folder' else p_resource_type end,
           p_resource_id
  ),
  direct_sequence(policy_sequence) as (
    select coalesce((
      select revision.policy_sequence
      from resource_gvic_policy_revisions revision
      join requested req
        on revision.company_id=req.company_id
       and revision.resource_type=req.legacy_resource_type
       and revision.resource_id=req.resource_id
    ),0)
  ),
  resource_policy_ancestors(resource_type,resource_id) as (
    select 'logic_gate'::text, assignment.logic_gate_id
    from node_logic_gate_assignments assignment
    join requested req
      on req.resource_type='node'
     and assignment.company_id=req.company_id
     and assignment.node_id=req.resource_id
  ),
  latest_snapshot_application(policy_sequence) as (
    select max(app.policy_sequence)
    from resource_gvic_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.snapshot
  ),
  direct_assignments as (
    select assignment.role,
           assignment.principal_type,
           assignment.principal_id,
           assignment.created_timestamp,
           assignment.updated_timestamp,
           assignment.role || ':' || assignment.principal_type || ':' || assignment.principal_id::text as rule_key
    from resource_gvic_assignments assignment
    join requested req
      on assignment.company_id=req.company_id
     and assignment.resource_type=req.legacy_resource_type
     and assignment.resource_id=req.resource_id
  ),
  application_rules as (
    select distinct on (app.role,app.principal_type,app.principal_id)
           app.role,
           app.principal_type,
           app.principal_id,
           app.deleted,
           app.created_timestamp,
           app.created_timestamp as updated_timestamp,
           app.role || ':' || app.principal_type || ':' || app.principal_id::text as rule_key
    from resource_gvic_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where not app.snapshot
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application),0)
    order by app.role,app.principal_type,app.principal_id,app.policy_sequence desc,app.application_id desc
  ),
  merged_assignments as (
    select direct.role,direct.principal_type,direct.principal_id,direct.created_timestamp,direct.updated_timestamp
    from direct_assignments direct
    where not exists (select 1 from latest_snapshot_application where policy_sequence is not null)
      and not exists (select 1 from application_rules app where app.rule_key=direct.rule_key)
    union all
    select app.role,app.principal_type,app.principal_id,app.created_timestamp,app.updated_timestamp
    from application_rules app
    where not app.deleted
  )
  select merged.role,merged.principal_type,merged.principal_id,
         merged.created_timestamp,merged.updated_timestamp
  from merged_assignments merged
  order by merged.role,merged.principal_type,merged.principal_id;
$$;

create or replace function mangorts_v2_step1_resolved_permission_default(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns text
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive requested(company_id,resource_type,resource_id) as (
    select p_company_id,p_resource_type,p_resource_id
  ),
  direct_default(default_access) as (
    select node.default_access from nodes node,requested req
    where req.resource_type='node' and node.company_id=req.company_id and node.node_id=req.resource_id
    union all
    select gate.default_access from logic_gates gate,requested req
    where req.resource_type='logic_gate' and gate.company_id=req.company_id and gate.logic_gate_id=req.resource_id
    union all
    select project.default_access from projects project,requested req
    where req.resource_type='project' and project.company_id=req.company_id and project.project_id=req.resource_id
    union all
    select folder.default_access from company_explorer_folders folder,requested req
    where req.resource_type='company_explorer_folder' and folder.company_id=req.company_id and folder.folder_id=req.resource_id
    union all
    select folder.default_access from shared_inbox_folders folder,requested req
    where req.resource_type='shared_inbox_folder' and folder.company_id=req.company_id and folder.folder_id=req.resource_id
    union all
    select inbox.default_access from shared_inboxes inbox,requested req
    where req.resource_type='shared_inbox' and inbox.company_id=req.company_id and inbox.shared_inbox_id=req.resource_id
  ),
  direct_sequence(policy_sequence) as (
    select coalesce((
      select revision.policy_sequence from resource_permission_policy_revisions revision,requested req
      where revision.company_id=req.company_id
        and revision.resource_type=req.resource_type
        and revision.resource_id=req.resource_id
    ),0)
  ),
  node_logic_gate_ancestors(logic_gate_id) as (
    select assignment.logic_gate_id
    from node_logic_gate_assignments assignment,requested req
    where req.resource_type='node'
      and assignment.company_id=req.company_id
      and assignment.node_id=req.resource_id
  ),
  folder_seeds(folder_id) as (
    select folder.parent_folder_id
    from company_explorer_folders folder,requested req
    where req.resource_type='company_explorer_folder'
      and folder.company_id=req.company_id
      and folder.folder_id=req.resource_id
      and folder.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item,requested req
    where req.resource_type in ('project','logic_gate')
      and item.company_id=req.company_id
      and item.target_type=req.resource_type
      and item.target_id=req.resource_id
      and item.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item
    join node_logic_gate_ancestors gate
      on item.target_type='logic_gate' and item.target_id=gate.logic_gate_id
    join requested req on item.company_id=req.company_id
    where item.parent_folder_id is not null
  ),
  folder_ancestors(folder_id,path) as (
    select folder_id,array[folder_id] from folder_seeds
    union all
    select parent.parent_folder_id,ancestor.path || parent.parent_folder_id
    from folder_ancestors ancestor
    join requested req on true
    join company_explorer_folders parent
      on parent.company_id=req.company_id and parent.folder_id=ancestor.folder_id
    where parent.parent_folder_id is not null
      and not parent.parent_folder_id=any(ancestor.path)
  ),
  resource_policy_ancestors(resource_type,resource_id) as (
    select 'logic_gate'::text,logic_gate_id from node_logic_gate_ancestors
    union
    select 'company_explorer_folder'::text,folder_id from folder_ancestors
  ),
  latest_snapshot_application(policy_sequence) as (
    select max(app.policy_sequence)
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.rule_key='__snapshot__'
  ),
  latest_default_application(access_level) as (
    select app.access_level
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.rule_key='__default__'
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application),0)
    order by app.policy_sequence desc,app.application_id desc
    limit 1
  )
  select coalesce((select access_level from latest_default_application),(select default_access from direct_default limit 1));
$$;

create or replace function mangorts_v2_step1_resolved_permissions(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  subject_type text,
  subject_id uuid,
  access_level text,
  created_timestamp timestamptz,
  updated_timestamp timestamptz
)
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive requested(company_id,resource_type,resource_id) as (
    select p_company_id,p_resource_type,p_resource_id
  ),
  direct_sequence(policy_sequence) as (
    select coalesce((
      select revision.policy_sequence from resource_permission_policy_revisions revision,requested req
      where revision.company_id=req.company_id
        and revision.resource_type=req.resource_type
        and revision.resource_id=req.resource_id
    ),0)
  ),
  node_logic_gate_ancestors(logic_gate_id) as (
    select assignment.logic_gate_id
    from node_logic_gate_assignments assignment,requested req
    where req.resource_type='node'
      and assignment.company_id=req.company_id
      and assignment.node_id=req.resource_id
  ),
  folder_seeds(folder_id) as (
    select folder.parent_folder_id
    from company_explorer_folders folder,requested req
    where req.resource_type='company_explorer_folder'
      and folder.company_id=req.company_id
      and folder.folder_id=req.resource_id
      and folder.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item,requested req
    where req.resource_type in ('project','logic_gate')
      and item.company_id=req.company_id
      and item.target_type=req.resource_type
      and item.target_id=req.resource_id
      and item.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item
    join node_logic_gate_ancestors gate
      on item.target_type='logic_gate' and item.target_id=gate.logic_gate_id
    join requested req on item.company_id=req.company_id
    where item.parent_folder_id is not null
  ),
  folder_ancestors(folder_id,path) as (
    select folder_id,array[folder_id] from folder_seeds
    union all
    select parent.parent_folder_id,ancestor.path || parent.parent_folder_id
    from folder_ancestors ancestor
    join requested req on true
    join company_explorer_folders parent
      on parent.company_id=req.company_id and parent.folder_id=ancestor.folder_id
    where parent.parent_folder_id is not null
      and not parent.parent_folder_id=any(ancestor.path)
  ),
  resource_policy_ancestors(resource_type,resource_id) as (
    select 'logic_gate'::text,logic_gate_id from node_logic_gate_ancestors
    union
    select 'company_explorer_folder'::text,folder_id from folder_ancestors
  ),
  latest_snapshot_application(policy_sequence) as (
    select max(app.policy_sequence)
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.rule_key='__snapshot__'
  ),
  direct_assignments as (
    select access.subject_type,access.subject_id,access.access_level,
           access.created_timestamp,access.updated_timestamp,
           access.subject_type || ':' || access.subject_id::text as rule_key
    from resource_permissions access,requested req
    where access.company_id=req.company_id
      and access.resource_type=req.resource_type
      and access.resource_id=req.resource_id
  ),
  application_rules as (
    select distinct on (app.rule_key)
           app.rule_key,app.subject_type,app.subject_id,app.access_level,app.deleted,
           app.created_timestamp,app.created_timestamp as updated_timestamp
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.rule_key not in ('__default__','__snapshot__')
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application),0)
    order by app.rule_key,app.policy_sequence desc,app.application_id desc
  ),
  merged_assignments as (
    select direct.subject_type,direct.subject_id,direct.access_level,direct.created_timestamp,direct.updated_timestamp
    from direct_assignments direct
    where not exists (select 1 from latest_snapshot_application where policy_sequence is not null)
      and not exists (select 1 from application_rules app where app.rule_key=direct.rule_key)
    union all
    select app.subject_type,app.subject_id,app.access_level,app.created_timestamp,app.updated_timestamp
    from application_rules app
    where not app.deleted
  )
  select merged.subject_type,merged.subject_id,merged.access_level,
         merged.created_timestamp,merged.updated_timestamp
  from merged_assignments merged
  order by merged.subject_type,merged.subject_id;
$$;
