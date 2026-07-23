-- Apply-to-descendants is a one-shot overwrite using the parent's complete
-- current policy. Snapshot boundaries clear descendant-only/older rules while
-- keeping storage proportional to parent rules rather than descendant count.
alter table resource_permission_subtree_applications
  drop constraint if exists resource_permission_subtree_applications_rule_shape_chk;

alter table resource_permission_subtree_applications
  add constraint resource_permission_subtree_applications_rule_shape_chk check (
    (
      rule_key = '__snapshot__'
      and subject_type is null
      and subject_id is null
      and access_level is null
      and not deleted
    )
    or (
      rule_key = '__default__'
      and subject_type is null
      and subject_id is null
      and access_level in ('edit', 'no_access')
      and not deleted
    )
    or (
      rule_key not in ('__default__', '__snapshot__')
      and subject_type in ('user', 'group')
      and subject_id is not null
      and (deleted or access_level in ('no_access', 'edit'))
    )
  );

alter table resource_gvic_subtree_applications
  add column if not exists snapshot boolean not null default false;

alter table resource_gvic_subtree_applications alter column role drop not null;
alter table resource_gvic_subtree_applications alter column principal_type drop not null;
alter table resource_gvic_subtree_applications alter column principal_id drop not null;

alter table resource_gvic_subtree_applications
  drop constraint if exists resource_gvic_subtree_applications_rule_shape_chk;

alter table resource_gvic_subtree_applications
  add constraint resource_gvic_subtree_applications_rule_shape_chk check (
    (
      snapshot
      and role is null
      and principal_type is null
      and principal_id is null
      and not deleted
    )
    or (
      not snapshot
      and role in ('generated', 'verified', 'consulted', 'informed')
      and principal_type in ('user', 'group')
      and principal_id is not null
    )
  );

create index if not exists idx_resource_gvic_subtree_applications_snapshot
  on resource_gvic_subtree_applications(company_id, ancestor_resource_type, ancestor_resource_id, policy_sequence desc)
  where snapshot;

create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean as $$
  with recursive normalized_resource(resource_type) as (
    select case lower(btrim(coalesce(p_resource_type, '')))
      when 'shared_triage_folder' then 'shared_inbox_folder'
      when 'communications_folder' then 'shared_inbox_folder'
      else lower(btrim(coalesce(p_resource_type, '')))
    end
  ),
  requested(required_rank) as (
    select mangorts_access_level_rank(p_access_level)
  ),
  role_admin_actor(allowed) as (
    select exists (
      select 1
      from company_memberships membership
      where membership.user_id = p_user_id
        and (
          membership.role = 'dev_admin'
          or (membership.company_id = p_company_id and membership.role = 'company_admin')
        )
    )
  ),
  normalized_resource_row(default_access) as (
    select coalesce(node.default_access, 'edit')
    from nodes node, normalized_resource normalized
    where normalized.resource_type='node'
      and node.company_id=p_company_id
      and node.node_id=p_resource_id
    union all
    select coalesce(gate.default_access, 'edit')
    from logic_gates gate, normalized_resource normalized
    where normalized.resource_type='logic_gate'
      and gate.company_id=p_company_id
      and gate.logic_gate_id=p_resource_id
    union all
    select coalesce(project.default_access, 'edit')
    from projects project, normalized_resource normalized
    where normalized.resource_type='project'
      and project.company_id=p_company_id
      and project.project_id=p_resource_id
    union all
    select coalesce(folder.default_access, 'edit')
    from company_explorer_folders folder, normalized_resource normalized
    where normalized.resource_type='company_explorer_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
    union all
    select coalesce(folder.default_access, 'edit')
    from shared_inbox_folders folder, normalized_resource normalized
    where normalized.resource_type='shared_inbox_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
    union all
    select coalesce(inbox.default_access, 'edit')
    from shared_inboxes inbox, normalized_resource normalized
    where normalized.resource_type='shared_inbox'
      and inbox.company_id=p_company_id
      and inbox.shared_inbox_id=p_resource_id
  ),
  group_tree(company_id, ancestor_group_id, descendant_group_id, depth) as (
    select user_group.company_id,
           user_group.group_id,
           user_group.group_id,
           0
    from company_user_groups user_group
    where user_group.company_id=p_company_id
    union all
    select parent.company_id,
           parent.ancestor_group_id,
           child.group_id,
           parent.depth + 1
    from group_tree parent
    join company_user_groups child
      on child.company_id=parent.company_id
     and child.parent_group_id=parent.descendant_group_id
    where parent.depth < 100
  ),
  direct_sequence(policy_sequence) as (
    select coalesce((
      select revision.policy_sequence
      from resource_permission_policy_revisions revision, normalized_resource normalized
      where revision.company_id=p_company_id
        and revision.resource_type=normalized.resource_type
        and revision.resource_id=p_resource_id
    ), 0)
  ),
  node_logic_gate_ancestors(logic_gate_id) as (
    select assignment.logic_gate_id
    from node_logic_gate_assignments assignment, normalized_resource normalized
    where normalized.resource_type='node'
      and assignment.company_id=p_company_id
      and assignment.node_id=p_resource_id
  ),
  folder_seeds(folder_id) as (
    select folder.parent_folder_id
    from company_explorer_folders folder, normalized_resource normalized
    where normalized.resource_type='company_explorer_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
      and folder.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item, normalized_resource normalized
    where normalized.resource_type in ('project', 'logic_gate')
      and item.company_id=p_company_id
      and item.target_type=normalized.resource_type
      and item.target_id=p_resource_id
    union
    select item.parent_folder_id
    from company_explorer_items item
    join node_logic_gate_ancestors gate
      on item.target_type='logic_gate'
     and item.target_id=gate.logic_gate_id
    where item.company_id=p_company_id
  ),
  folder_ancestors(folder_id, path) as (
    select folder_id, array[folder_id]
    from folder_seeds
    union all
    select parent.parent_folder_id, folder_ancestors.path || parent.parent_folder_id
    from folder_ancestors
    join company_explorer_folders parent
      on parent.company_id=p_company_id
     and parent.folder_id=folder_ancestors.folder_id
    where parent.parent_folder_id is not null
      and not parent.parent_folder_id = any(folder_ancestors.path)
  ),
  resource_policy_ancestors(resource_type, resource_id) as (
    select 'logic_gate'::text, logic_gate_id
    from node_logic_gate_ancestors
    union
    select 'company_explorer_folder'::text, folder_id
    from folder_ancestors
  ),
  latest_snapshot_application(policy_sequence) as (
    select max(app.policy_sequence)
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.company_id=p_company_id
      and app.rule_key='__snapshot__'
  ),
  latest_default_application(access_level) as (
    select app.access_level
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.company_id=p_company_id
      and app.rule_key='__default__'
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application), 0)
    order by app.policy_sequence desc, app.application_id desc
    limit 1
  ),
  resolved_default(default_access) as (
    select coalesce(
      (select access_level from latest_default_application),
      (select default_access from normalized_resource_row limit 1)
    )
  ),
  direct_permission_rows as (
    select access.subject_type,
           access.subject_id,
           access.access_level,
           access.subject_type || ':' || access.subject_id::text as rule_key
    from resource_permissions access
    join normalized_resource normalized
      on normalized.resource_type=access.resource_type
    where access.company_id=p_company_id
      and access.resource_id=p_resource_id
  ),
  application_permission_rows as (
    select distinct on (app.rule_key)
           app.rule_key,
           app.subject_type,
           app.subject_id,
           app.access_level,
           app.deleted
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.company_id=p_company_id
      and app.rule_key not in ('__default__', '__snapshot__')
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application), 0)
    order by app.rule_key, app.policy_sequence desc, app.application_id desc
  ),
  resolved_permission_rows as (
    select direct.subject_type, direct.subject_id, direct.access_level
    from direct_permission_rows direct
    where not exists (select 1 from latest_snapshot_application where policy_sequence is not null)
      and not exists (
        select 1
        from application_permission_rows app
        where app.rule_key=direct.rule_key
      )
    union all
    select app.subject_type, app.subject_id, app.access_level
    from application_permission_rows app
    where not app.deleted
  ),
  permission_access(access_level) as (
    select candidate.access_level
    from (
      select access.access_level, 0 as source_rank, 0 as group_depth, mangorts_access_level_rank(access.access_level) as access_rank
      from resolved_permission_rows access
      where access.subject_type='user'
        and access.subject_id=p_user_id
      union all
      select access.access_level, 1 as source_rank, min(closure.depth) as group_depth, mangorts_access_level_rank(access.access_level) as access_rank
      from resolved_permission_rows access
      join group_tree closure
        on closure.company_id=p_company_id
       and closure.ancestor_group_id=access.subject_id
      join company_user_group_members member
        on member.company_id=closure.company_id
       and member.group_id=closure.descendant_group_id
       and member.user_id=p_user_id
      where access.subject_type='group'
      group by access.access_level
      union all
      select default_access, 2 as source_rank, 0 as group_depth, mangorts_access_level_rank(default_access) as access_rank
      from resolved_default
    ) candidate
    order by candidate.source_rank asc, candidate.group_depth asc, candidate.access_rank asc
    limit 1
  )
  select case
    when requested.required_rank = 0 then false
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false
    when (select allowed from role_admin_actor) then true
    when not exists (select 1 from permission_access) then false
    when (select mangorts_access_level_rank(access_level) from permission_access limit 1) = 0 then false
    when exists (
        select 1
        from company_memberships membership
        where membership.company_id = p_company_id
          and membership.user_id = p_user_id
      )
      and (select mangorts_access_level_rank(access_level) from permission_access limit 1) >= requested.required_rank then true
    else false
  end
  from requested, normalized_resource;
$$ language sql stable;
