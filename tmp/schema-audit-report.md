# Schema Inventory Diff

- Status: FAIL
- Expected inventory: `canonical-schema` (1179 compared objects)
- Actual inventory: `prod` (1230 compared objects)
- Missing in actual: 0
- Extra in actual: 51
- Different definitions: 5
- Grants compared: no
- schema_migrations compared: no

## Missing In Actual

None.

## Extra In Actual

- `column` `public.communications_email_archive_job_items.archive_job_id`
- `column` `public.communications_email_archive_job_items.archived_timestamp`
- `column` `public.communications_email_archive_job_items.attempt_count`
- `column` `public.communications_email_archive_job_items.available_at`
- `column` `public.communications_email_archive_job_items.created_timestamp`
- `column` `public.communications_email_archive_job_items.failed_timestamp`
- `column` `public.communications_email_archive_job_items.job_item_id`
- `column` `public.communications_email_archive_job_items.last_error`
- `column` `public.communications_email_archive_job_items.message_id`
- `column` `public.communications_email_archive_job_items.processing_started_at`
- `column` `public.communications_email_archive_job_items.status`
- `column` `public.communications_email_archive_job_items.updated_timestamp`
- `column` `public.communications_email_archive_jobs.account_email`
- `column` `public.communications_email_archive_jobs.actor_user_id`
- `column` `public.communications_email_archive_jobs.archive_job_id`
- `column` `public.communications_email_archive_jobs.company_email_connection_id`
- `column` `public.communications_email_archive_jobs.company_id`
- `column` `public.communications_email_archive_jobs.completed_timestamp`
- `column` `public.communications_email_archive_jobs.connection_scope`
- `column` `public.communications_email_archive_jobs.created_timestamp`
- `column` `public.communications_email_archive_jobs.grant_id`
- `column` `public.communications_email_archive_jobs.provider`
- `column` `public.communications_email_archive_jobs.requested_count`
- `column` `public.communications_email_archive_jobs.shared_inbox_id`
- `column` `public.communications_email_archive_jobs.status`
- `column` `public.communications_email_archive_jobs.updated_timestamp`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job__archive_job_id_message_id_key`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job_items_archive_job_id_fkey`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job_items_message_chk`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job_items_pkey`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job_items_status_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_j_company_email_connection_id_fkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jo_company_id_shared_inbox_id_fkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_account_email_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_actor_user_id_fkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_company_id_fkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_grant_id_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_pkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_provider_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_scope_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_shared_scope_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_status_chk`
- `index` `public.communications_email_archive_job__archive_job_id_message_id_key`
- `index` `public.communications_email_archive_job_items_pkey`
- `index` `public.communications_email_archive_jobs_pkey`
- `index` `public.idx_communications_email_archive_job_items_claim`
- `index` `public.idx_communications_email_archive_job_items_job`
- `index` `public.idx_communications_email_archive_jobs_actor_created`
- `index` `public.idx_communications_email_archive_jobs_shared_inbox`
- `table` `public.communications_email_archive_job_items`
- `table` `public.communications_email_archive_jobs`

## Different Definitions

### `column` `public.projects.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.projects.default_access`

Expected:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.projects.health`

Expected:

```json
{
  "collation": null,
  "column": "health",
  "data_type": "text",
  "default": "'On Track'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "health",
  "data_type": "text",
  "default": "'On Track'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.projects.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

### `function` `public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text)`

Expected:

```json
{
  "arguments": "p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text",
  "definition": "CREATE OR REPLACE FUNCTION public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text)\n RETURNS boolean\n LANGUAGE sql\n STABLE\nAS $function$\r\n  with recursive normalized_resource(resource_type) as (\r\n    select case lower(btrim(coalesce(p_resource_type, '')))\r\n      when 'shared_triage_folder' then 'shared_inbox_folder'\r\n      when 'communications_folder' then 'shared_inbox_folder'\r\n      else lower(btrim(coalesce(p_resource_type, '')))\r\n    end\r\n  ),\r\n  requested(required_rank) as (\r\n    select mangorts_access_level_rank(p_access_level)\r\n  ),\r\n  role_admin_actor(allowed) as (\r\n    select exists (\r\n      select 1\r\n      from company_memberships membership\r\n      where membership.user_id = p_user_id\r\n        and (\r\n          membership.role = 'dev_admin'\r\n          or (membership.company_id = p_company_id and membership.role = 'company_admin')\r\n        )\r\n    )\r\n  ),\r\n  normalized_resource_row(default_access) as (\r\n    select coalesce(node.default_access, 'edit')\r\n    from nodes node, normalized_resource normalized\r\n    where normalized.resource_type='node'\r\n      and node.company_id=p_company_id\r\n      and node.node_id=p_resource_id\r\n    union all\r\n    select coalesce(gate.default_access, 'edit')\r\n    from logic_gates gate, normalized_resource normalized\r\n    where normalized.resource_type='logic_gate'\r\n      and gate.company_id=p_company_id\r\n      and gate.logic_gate_id=p_resource_id\r\n    union all\r\n    select coalesce(project.default_access, 'edit')\r\n    from projects project, normalized_resource normalized\r\n    where normalized.resource_type='project'\r\n      and project.company_id=p_company_id\r\n      and project.project_id=p_resource_id\r\n    union all\r\n    select coalesce(folder.default_access, 'edit')\r\n    from company_explorer_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='company_explorer_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n    union all\r\n    select coalesce(folder.default_access, 'edit')\r\n    from shared_inbox_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='shared_inbox_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n    union all\r\n    select coalesce(inbox.default_access, 'edit')\r\n    from shared_inboxes inbox, normalized_resource normalized\r\n    where normalized.resource_type='shared_inbox'\r\n      and inbox.company_id=p_company_id\r\n      and inbox.shared_inbox_id=p_resource_id\r\n  ),\r\n  group_tree(company_id, ancestor_group_id, descendant_group_id, depth) as (\r\n    select user_group.company_id,\r\n           user_group.group_id,\r\n           user_group.group_id,\r\n           0\r\n    from company_user_groups user_group\r\n    where user_group.company_id=p_company_id\r\n    union all\r\n    select parent.company_id,\r\n           parent.ancestor_group_id,\r\n           child.group_id,\r\n           parent.depth + 1\r\n    from group_tree parent\r\n    join company_user_groups child\r\n      on child.company_id=parent.company_id\r\n     and child.parent_group_id=parent.descendant_group_id\r\n    where parent.depth < 100\r\n  ),\r\n  direct_sequence(policy_sequence) as (\r\n    select coalesce((\r\n      select revision.policy_sequence\r\n      from resource_permission_policy_revisions revision, normalized_resource normalized\r\n      where revision.company_id=p_company_id\r\n        and revision.resource_type=normalized.resource_type\r\n        and revision.resource_id=p_resource_id\r\n    ), 0)\r\n  ),\r\n  node_logic_gate_ancestors(logic_gate_id) as (\r\n    select assignment.logic_gate_id\r\n    from node_logic_gate_assignments assignment, normalized_resource normalized\r\n    where normalized.resource_type='node'\r\n      and assignment.company_id=p_company_id\r\n      and assignment.node_id=p_resource_id\r\n  ),\r\n  folder_seeds(folder_id) as (\r\n    select folder.parent_folder_id\r\n    from company_explorer_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='company_explorer_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n      and folder.parent_folder_id is not null\r\n    union\r\n    select item.parent_folder_id\r\n    from company_explorer_items item, normalized_resource normalized\r\n    where normalized.resource_type in ('project', 'logic_gate')\n      and item.company_id=p_company_id\r\n      and item.target_type=normalized.resource_type\r\n      and item.target_id=p_resource_id\r\n    union\r\n    select item.parent_folder_id\r\n    from company_explorer_items item\r\n    join node_logic_gate_ancestors gate\r\n      on item.target_type='logic_gate'\r\n     and item.target_id=gate.logic_gate_id\r\n    where item.company_id=p_company_id\r\n  ),\r\n  folder_ancestors(folder_id, path) as (\r\n    select folder_id, array[folder_id]\r\n    from folder_seeds\r\n    union all\r\n    select parent.parent_folder_id, folder_ancestors.path || parent.parent_folder_id\r\n    from folder_ancestors\r\n    join company_explorer_folders parent\r\n      on parent.company_id=p_company_id\r\n     and parent.folder_id=folder_ancestors.folder_id\r\n    where parent.parent_folder_id is not null\r\n      and not parent.parent_folder_id = any(folder_ancestors.path)\r\n  ),\r\n  resource_policy_ancestors(resource_type, resource_id) as (\r\n    select 'logic_gate'::text, logic_gate_id\r\n    from node_logic_gate_ancestors\r\n    union\r\n    select 'company_explorer_folder'::text, folder_id\r\n    from folder_ancestors\r\n  ),\r\n  latest_default_application(access_level) as (\r\n    select app.access_level\r\n    from resource_permission_subtree_applications app\r\n    join resource_policy_ancestors ancestor\r\n      on ancestor.resource_type=app.ancestor_resource_type\r\n     and ancestor.resource_id=app.ancestor_resource_id\r\n    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence\r\n    where app.company_id=p_company_id\r\n      and app.rule_key='__default__'\r\n    order by app.policy_sequence desc, app.application_id desc\r\n    limit 1\r\n  ),\r\n  resolved_default(default_access) as (\r\n    select coalesce(\r\n      (select access_level from latest_default_application),\r\n      (select default_access from normalized_resource_row limit 1)\r\n    )\r\n  ),\r\n  direct_permission_rows as (\r\n    select access.subject_type,\r\n           access.subject_id,\r\n           access.access_level,\r\n           access.subject_type || ':' || access.subject_id::text as rule_key\r\n    from resource_permissions access\r\n    join normalized_resource normalized\r\n      on normalized.resource_type=access.resource_type\r\n    where access.company_id=p_company_id\r\n      and access.resource_id=p_resource_id\r\n  ),\r\n  application_permission_rows as (\r\n    select distinct on (app.rule_key)\r\n           app.rule_key,\r\n           app.subject_type,\r\n           app.subject_id,\r\n           app.access_level,\r\n           app.deleted\r\n    from resource_permission_subtree_applications app\r\n    join resource_policy_ancestors ancestor\r\n      on ancestor.resource_type=app.ancestor_resource_type\r\n     and ancestor.resource_id=app.ancestor_resource_id\r\n    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence\r\n    where app.company_id=p_company_id\r\n      and app.rule_key<>'__default__'\r\n    order by app.rule_key, app.policy_sequence desc, app.application_id desc\r\n  ),\r\n  resolved_permission_rows as (\r\n    select direct.subject_type, direct.subject_id, direct.access_level\r\n    from direct_permission_rows direct\r\n    where not exists (\r\n      select 1\r\n      from application_permission_rows app\r\n      where app.rule_key=direct.rule_key\r\n    )\r\n    union all\r\n    select app.subject_type, app.subject_id, app.access_level\r\n    from application_permission_rows app\r\n    where not app.deleted\r\n  ),\r\n  permission_access(access_level) as (\r\n    select candidate.access_level\r\n    from (\r\n      select access.access_level, 0 as source_rank, 0 as group_depth, mangorts_access_level_rank(access.access_level) as access_rank\r\n      from resolved_permission_rows access\r\n      where access.subject_type='user'\r\n        and access.subject_id=p_user_id\r\n      union all\r\n      select access.access_level, 1 as source_rank, min(closure.depth) as group_depth, mangorts_access_level_rank(access.access_level) as access_rank\r\n      from resolved_permission_rows access\r\n      join group_tree closure\r\n        on closure.company_id=p_company_id\r\n       and closure.ancestor_group_id=access.subject_id\r\n      join company_user_group_members member\r\n        on member.company_id=closure.company_id\r\n       and member.group_id=closure.descendant_group_id\r\n       and member.user_id=p_user_id\r\n      where access.subject_type='group'\r\n      group by access.access_level\r\n      union all\r\n      select default_access, 2 as source_rank, 0 as group_depth, mangorts_access_level_rank(default_access) as access_rank\r\n      from resolved_default\r\n    ) candidate\r\n    order by candidate.source_rank asc, candidate.group_depth asc, candidate.access_rank asc\r\n    limit 1\r\n  )\r\n  select case\r\n    when requested.required_rank = 0 then false\r\n    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false\r\n    when (select allowed from role_admin_actor) then true\r\n    when not exists (select 1 from permission_access) then false\r\n    when (select mangorts_access_level_rank(access_level) from permission_access limit 1) = 0 then false\r\n    when exists (\r\n        select 1\r\n        from company_memberships membership\r\n        where membership.company_id = p_company_id\r\n          and membership.user_id = p_user_id\r\n      )\r\n      and (select mangorts_access_level_rank(access_level) from permission_access limit 1) >= requested.required_rank then true\r\n    else false\r\n  end\r\n  from requested, normalized_resource;\r\n$function$\n",
  "identity_arguments": "p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text",
  "kind": "function",
  "language": "sql",
  "name": "mangorts_user_can_access_resource",
  "parallel": "u",
  "result_type": "boolean",
  "schema": "public",
  "security_definer": false,
  "strict": false,
  "volatility": "stable"
}
```

Actual:

```json
{
  "arguments": "p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text",
  "definition": "CREATE OR REPLACE FUNCTION public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text)\n RETURNS boolean\n LANGUAGE sql\n STABLE\nAS $function$\r\n  with recursive normalized_resource(resource_type) as (\r\n    select case lower(btrim(coalesce(p_resource_type, '')))\r\n      when 'shared_triage_folder' then 'shared_inbox_folder'\r\n      when 'communications_folder' then 'shared_inbox_folder'\r\n      else lower(btrim(coalesce(p_resource_type, '')))\r\n    end\r\n  ),\r\n  requested(required_rank) as (\r\n    select mangorts_access_level_rank(p_access_level)\r\n  ),\r\n  role_admin_actor(allowed) as (\r\n    select exists (\r\n      select 1\r\n      from company_memberships membership\r\n      where membership.user_id = p_user_id\r\n        and (\r\n          membership.role = 'dev_admin'\r\n          or (membership.company_id = p_company_id and membership.role = 'company_admin')\r\n        )\r\n    )\r\n  ),\r\n  normalized_resource_row(default_access) as (\r\n    select coalesce(node.default_access, 'edit')\r\n    from nodes node, normalized_resource normalized\r\n    where normalized.resource_type='node'\r\n      and node.company_id=p_company_id\r\n      and node.node_id=p_resource_id\r\n    union all\r\n    select coalesce(gate.default_access, 'edit')\r\n    from logic_gates gate, normalized_resource normalized\r\n    where normalized.resource_type='logic_gate'\r\n      and gate.company_id=p_company_id\r\n      and gate.logic_gate_id=p_resource_id\r\n    union all\r\n    select coalesce(project.default_access, 'edit')\r\n    from projects project, normalized_resource normalized\r\n    where normalized.resource_type='project'\r\n      and project.company_id=p_company_id\r\n      and project.project_id=p_resource_id\r\n    union all\r\n    select coalesce(folder.default_access, 'edit')\r\n    from company_explorer_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='company_explorer_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n    union all\r\n    select coalesce(folder.default_access, 'edit')\r\n    from shared_inbox_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='shared_inbox_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n    union all\r\n    select coalesce(inbox.default_access, 'edit')\r\n    from shared_inboxes inbox, normalized_resource normalized\r\n    where normalized.resource_type='shared_inbox'\r\n      and inbox.company_id=p_company_id\r\n      and inbox.shared_inbox_id=p_resource_id\r\n  ),\r\n  group_tree(company_id, ancestor_group_id, descendant_group_id, depth) as (\r\n    select user_group.company_id,\r\n           user_group.group_id,\r\n           user_group.group_id,\r\n           0\r\n    from company_user_groups user_group\r\n    where user_group.company_id=p_company_id\r\n    union all\r\n    select parent.company_id,\r\n           parent.ancestor_group_id,\r\n           child.group_id,\r\n           parent.depth + 1\r\n    from group_tree parent\r\n    join company_user_groups child\r\n      on child.company_id=parent.company_id\r\n     and child.parent_group_id=parent.descendant_group_id\r\n    where parent.depth < 100\r\n  ),\r\n  direct_sequence(policy_sequence) as (\r\n    select coalesce((\r\n      select revision.policy_sequence\r\n      from resource_permission_policy_revisions revision, normalized_resource normalized\r\n      where revision.company_id=p_company_id\r\n        and revision.resource_type=normalized.resource_type\r\n        and revision.resource_id=p_resource_id\r\n    ), 0)\r\n  ),\r\n  node_logic_gate_ancestors(logic_gate_id) as (\r\n    select assignment.logic_gate_id\r\n    from node_logic_gate_assignments assignment, normalized_resource normalized\r\n    where normalized.resource_type='node'\r\n      and assignment.company_id=p_company_id\r\n      and assignment.node_id=p_resource_id\r\n  ),\r\n  folder_seeds(folder_id) as (\r\n    select folder.parent_folder_id\r\n    from company_explorer_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='company_explorer_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n      and folder.parent_folder_id is not null\r\n    union\r\n    select item.parent_folder_id\r\n    from company_explorer_items item, normalized_resource normalized\r\n    where normalized.resource_type in ('project', 'logic_gate')\r\n      and item.company_id=p_company_id\r\n      and item.target_type=normalized.resource_type\r\n      and item.target_id=p_resource_id\r\n    union\r\n    select item.parent_folder_id\r\n    from company_explorer_items item\r\n    join node_logic_gate_ancestors gate\r\n      on item.target_type='logic_gate'\r\n     and item.target_id=gate.logic_gate_id\r\n    where item.company_id=p_company_id\r\n  ),\r\n  folder_ancestors(folder_id, path) as (\r\n    select folder_id, array[folder_id]\r\n    from folder_seeds\r\n    union all\r\n    select parent.parent_folder_id, folder_ancestors.path || parent.parent_folder_id\r\n    from folder_ancestors\r\n    join company_explorer_folders parent\r\n      on parent.company_id=p_company_id\r\n     and parent.folder_id=folder_ancestors.folder_id\r\n    where parent.parent_folder_id is not null\r\n      and not parent.parent_folder_id = any(folder_ancestors.path)\r\n  ),\r\n  resource_policy_ancestors(resource_type, resource_id) as (\r\n    select 'logic_gate'::text, logic_gate_id\r\n    from node_logic_gate_ancestors\r\n    union\r\n    select 'company_explorer_folder'::text, folder_id\r\n    from folder_ancestors\r\n  ),\r\n  latest_default_application(access_level) as (\r\n    select app.access_level\r\n    from resource_permission_subtree_applications app\r\n    join resource_policy_ancestors ancestor\r\n      on ancestor.resource_type=app.ancestor_resource_type\r\n     and ancestor.resource_id=app.ancestor_resource_id\r\n    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence\r\n    where app.company_id=p_company_id\r\n      and app.rule_key='__default__'\r\n    order by app.policy_sequence desc, app.application_id desc\r\n    limit 1\r\n  ),\r\n  resolved_default(default_access) as (\r\n    select coalesce(\r\n      (select access_level from latest_default_application),\r\n      (select default_access from normalized_resource_row limit 1)\r\n    )\r\n  ),\r\n  direct_permission_rows as (\r\n    select access.subject_type,\r\n           access.subject_id,\r\n           access.access_level,\r\n           access.subject_type || ':' || access.subject_id::text as rule_key\r\n    from resource_permissions access\r\n    join normalized_resource normalized\r\n      on normalized.resource_type=access.resource_type\r\n    where access.company_id=p_company_id\r\n      and access.resource_id=p_resource_id\r\n  ),\r\n  application_permission_rows as (\r\n    select distinct on (app.rule_key)\r\n           app.rule_key,\r\n           app.subject_type,\r\n           app.subject_id,\r\n           app.access_level,\r\n           app.deleted\r\n    from resource_permission_subtree_applications app\r\n    join resource_policy_ancestors ancestor\r\n      on ancestor.resource_type=app.ancestor_resource_type\r\n     and ancestor.resource_id=app.ancestor_resource_id\r\n    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence\r\n    where app.company_id=p_company_id\r\n      and app.rule_key<>'__default__'\r\n    order by app.rule_key, app.policy_sequence desc, app.application_id desc\r\n  ),\r\n  resolved_permission_rows as (\r\n    select direct.subject_type, direct.subject_id, direct.access_level\r\n    from direct_permission_rows direct\r\n    where not exists (\r\n      select 1\r\n      from application_permission_rows app\r\n      where app.rule_key=direct.rule_key\r\n    )\r\n    union all\r\n    select app.subject_type, app.subject_id, app.access_level\r\n    from application_permission_rows app\r\n    where not app.deleted\r\n  ),\r\n  permission_access(access_level) as (\r\n    select candidate.access_level\r\n    from (\r\n      select access.access_level, 0 as source_rank, 0 as group_depth, mangorts_access_level_rank(access.access_level) as access_rank\r\n      from resolved_permission_rows access\r\n      where access.subject_type='user'\r\n        and access.subject_id=p_user_id\r\n      union all\r\n      select access.access_level, 1 as source_rank, min(closure.depth) as group_depth, mangorts_access_level_rank(access.access_level) as access_rank\r\n      from resolved_permission_rows access\r\n      join group_tree closure\r\n        on closure.company_id=p_company_id\r\n       and closure.ancestor_group_id=access.subject_id\r\n      join company_user_group_members member\r\n        on member.company_id=closure.company_id\r\n       and member.group_id=closure.descendant_group_id\r\n       and member.user_id=p_user_id\r\n      where access.subject_type='group'\r\n      group by access.access_level\r\n      union all\r\n      select default_access, 2 as source_rank, 0 as group_depth, mangorts_access_level_rank(default_access) as access_rank\r\n      from resolved_default\r\n    ) candidate\r\n    order by candidate.source_rank asc, candidate.group_depth asc, candidate.access_rank asc\r\n    limit 1\r\n  )\r\n  select case\r\n    when requested.required_rank = 0 then false\r\n    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false\r\n    when (select allowed from role_admin_actor) then true\r\n    when not exists (select 1 from permission_access) then false\r\n    when (select mangorts_access_level_rank(access_level) from permission_access limit 1) = 0 then false\r\n    when exists (\r\n        select 1\r\n        from company_memberships membership\r\n        where membership.company_id = p_company_id\r\n          and membership.user_id = p_user_id\r\n      )\r\n      and (select mangorts_access_level_rank(access_level) from permission_access limit 1) >= requested.required_rank then true\r\n    else false\r\n  end\r\n  from requested, normalized_resource;\r\n$function$\n",
  "identity_arguments": "p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text",
  "kind": "function",
  "language": "sql",
  "name": "mangorts_user_can_access_resource",
  "parallel": "u",
  "result_type": "boolean",
  "schema": "public",
  "security_definer": false,
  "strict": false,
  "volatility": "stable"
}
```
