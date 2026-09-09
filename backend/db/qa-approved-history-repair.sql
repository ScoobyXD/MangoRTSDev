-- PROPOSAL ONLY. Requires explicit approval to adopt the existing QA data state.
-- This is not evidence that 149 historical data transformations were executed.
-- Preserves all application rows and archives the entire original migration ledger.
-- Leaves seven separately identified real migrations pending for the QA release.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE;
DO $qa_repair_guard$
DECLARE actual_inventory jsonb; actual_hash text; actual_ledger text[]; data_checks jsonb;
BEGIN
  IF current_database() <> 'mangorts_qa' OR current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'Wrong QA database or PostgreSQL major version';
  END IF;
  SELECT array_agg(version ORDER BY version) INTO actual_ledger FROM public.schema_migrations;
  IF actual_ledger IS DISTINCT FROM ARRAY['20260424_node_relationship_guards.sql','20260501_company_explorer_folders.sql','20260501_kanban_board_tables.sql','20260501_logic_gate_projection_table.sql','20260501_logic_gate_relationship_guards.sql','20260501_nonblank_information_guards.sql','20260502_company_explorer_cleanup.sql','20260502_kanban_column_width.sql','20260502_map_layout_positions.sql','20260503_company_explorer_positions.sql','20260503_item_delete_cleanup.sql','20260503_kanban_query_metadata.sql','20260503_z_kanban_column_height_and_query_cleanup.sql','20260503_zzz_kanban_column_item_color.sql','20260503_zzzz_kanban_node_only_cards.sql','20260503_zzzzz_kanban_saved_boards.sql','20260504_company_explorer_kanban_items.sql','20260504_company_explorer_move_relationship_cleanup.sql','20260504_editor_text_projection_canonical.sql','20260505_auth_identity_and_memberships.sql','20260505_company_explorer_kanban_folder_items_compat.sql','20260506_logic_gate_arena.sql','20260507_auth_accounts_mvp.sql','20260507_company_explorer_default_folder_seeds.sql','20260507_kanban_column_resize_limits.sql','20260507_latest_invitation_token.sql','20260507_lowercase_auth_emails.sql','20260507_nodes_status_and_user_display_names.sql','20260507_password_reset_codes.sql','20260507_remove_company_viewer.sql','20260507_remove_custom_resets_and_resource_assignments.sql','20260508_company_explorer_system_folders.sql','20260508_nylas_user_email_connections.sql','20260509_auth_external_identity_deletions.sql','20260509_mango_kanban_column_color_default.sql','20260510_company_explorer_folder_shares.sql','20260511_node_editor_blocks_and_email.sql','20260512_communications_shared_inbox_folders.sql','20260512_communications_triage_logic_gates.sql','20260512_drop_operations.sql','20260512_fix_triage_conversion_constraints.sql','20260512_logic_gate_arena_default_column_repair.sql','20260514_logic_gate_raci_assignments.sql','20260515_communications_shared_inbox_raci_assignments.sql','20260517_notifications.sql','20260518_communications_shared_inbox_account_email.sql','20260518_notification_type_unread_index.sql','20260518_remove_kanban_from_company_explorer.sql','20260519_domain_events_outbox.sql','20260519_hot_path_read_discipline.sql','20260519_node_logic_gate_assignments.sql','20260519_work_item_inbox_entries.sql','20260519_workspace_read_versions.sql','20260520_responsible_inbox_raci_nodes.sql','20260520_user_groups_entity_permissions.sql','20260521_node_content_changes.sql','20260521_resource_access_grants.sql','20260521_shared_inbox_raci_group_assignments.sql','20260521_z_node_logic_gate_default_full_access.sql','20260521_zz_shared_triage_default_edit_access.sql','20260521_zzz_admin_role_default_resource_access.sql','20260521_zzzz_resource_access_no_access.sql','20260521_zzzzz_assignment_edit_access.sql','20260521_zzzzzz_hot_read_visibility_versions.sql','20260521_zzzzzzz_node_content_changes_actor_display_name.sql','20260522_effective_resource_access.sql','20260522_notification_other_role.sql','20260523_drop_logic_gate_raci_access_trigger.sql','20260523_drop_node_assignee_access_trigger.sql','20260523_notification_domain_event_projection_checkpoints.sql','20260523_remove_notification_source_anchor.sql','20260523_zz_notification_information_id.sql','20260523_zzz_node_logic_gate_default_company_edit_access.sql','20260524_active_logic_gates_system_folder.sql','20260524_effective_resource_access_single_row.sql','20260524_node_logic_gate_assignment_priority_guard.sql','20260524_node_projection_seen_snapshots.sql','20260524_resource_raci_assignments.sql','20260524_zz_backfill_legacy_entity_access_permissions.sql','20260526_logic_gate_verify_status.sql','20260527_email_node_attachments.sql','20260527_invitation_onboarding_status.sql','20260529_resource_access_defaults.sql','20260602_racio_projection_sequences.sql','20260612_z_drop_project_scalar_assignments.sql','20260621_gvic_matrix_flat_my_work_projection.sql','20260621_z_gvic_matrix_projection_rebuild_relationship_rows.sql','20260810_node_textbox_metadata.sql','20260826_zzzy_process_map_actual_size_square_layout.sql','20260826_zzzz_process_map_tidy_initial_layout.sql','20260826_zzzzz_process_map_rectangular_layout.sql','20260826_zzzzzz_process_map_square_layout.sql','20260828_zz_retire_unused_operational_tables.sql','20260903_process_steps.sql','20260904_auth_claim_issue_watermark.sql','operator/20260805_retire_map_position_storage.sql','operator/20260805_retire_node_legacy_storage.sql']::text[] THEN RAISE EXCEPTION 'QA ledger changed; stop and re-audit'; END IF;
  SELECT schema_inventory_json::jsonb INTO actual_inventory FROM (
-- MangoRTS PostgreSQL schema inventory export.
--
-- Purpose:
--   Run the same read-only catalog query against a canonical database and an
--   actual database, then compare the JSON outputs with
--   scripts/compare_schema_inventory.py.
--
-- Output:
--   One row, one column: schema_inventory_json. The value is a JSON array of
--   normalized schema objects keyed by object_kind + object_identity.
--
-- Scope:
--   Includes non-system schemas, extensions, tables, columns, constraints,
--   indexes, views, materialized views, sequences, functions/procedures,
--   enum/domain types, triggers, RLS policies, and grants. Grants are included
--   as separate objects so the comparator can ignore or include them explicitly.

with included_namespaces as (
  select namespace.oid, namespace.nspname, namespace.nspowner, namespace.nspacl
  from pg_namespace namespace
  where namespace.nspname <> 'information_schema'
    and namespace.nspname !~ '^pg_'
),
schema_objects as (
  select
    'schema'::text as object_kind,
    namespace.nspname::text as object_identity,
    jsonb_build_object(
      'name', namespace.nspname
    ) as definition
  from included_namespaces namespace
),
extension_objects as (
  select
    'extension'::text as object_kind,
    extension.extname::text as object_identity,
    jsonb_build_object(
      'name', extension.extname,
      'schema', namespace.nspname,
      'version', extension.extversion
    ) as definition
  from pg_extension extension
  join pg_namespace namespace on namespace.oid = extension.extnamespace
),
relation_objects as (
  select
    'table'::text as object_kind,
    namespace.nspname || '.' || class.relname as object_identity,
    jsonb_build_object(
      'schema', namespace.nspname,
      'name', class.relname,
      'relation_type', case class.relkind
        when 'r' then 'table'
        when 'p' then 'partitioned_table'
        when 'f' then 'foreign_table'
      end,
      'persistence', case class.relpersistence
        when 'p' then 'permanent'
        when 'u' then 'unlogged'
        when 't' then 'temporary'
      end,
      'row_security_enabled', class.relrowsecurity,
      'row_security_forced', class.relforcerowsecurity
    ) as definition
  from pg_class class
  join included_namespaces namespace on namespace.oid = class.relnamespace
  where class.relkind in ('r', 'p', 'f')
),
column_objects as (
  select
    'column'::text as object_kind,
    namespace.nspname || '.' || class.relname || '.' || attribute.attname as object_identity,
    jsonb_build_object(
      'schema', namespace.nspname,
      'relation', class.relname,
      'column', attribute.attname,
      'data_type', format_type(attribute.atttypid, attribute.atttypmod),
      'not_null', attribute.attnotnull,
      'default', pg_get_expr(attrdef.adbin, attrdef.adrelid, false),
      'identity', case attribute.attidentity
        when 'a' then 'always'
        when 'd' then 'by_default'
        else ''
      end,
      'generated', case attribute.attgenerated
        when 's' then 'stored'
        else ''
      end,
      'collation', (nullif(attribute.attcollation, type.typcollation))::regcollation::text,
      'storage', attribute.attstorage
    ) as definition
  from pg_attribute attribute
  join pg_class class on class.oid = attribute.attrelid
  join included_namespaces namespace on namespace.oid = class.relnamespace
  join pg_type type on type.oid = attribute.atttypid
  left join pg_attrdef attrdef
    on attrdef.adrelid = attribute.attrelid
   and attrdef.adnum = attribute.attnum
  where class.relkind in ('r', 'p', 'f', 'v', 'm')
    and attribute.attnum > 0
    and not attribute.attisdropped
),
constraint_objects as (
  select
    'constraint'::text as object_kind,
    case
      when relation_class.oid is not null then relation_namespace.nspname || '.' || relation_class.relname || '.' || constraint_row.conname
      when type_row.oid is not null then type_namespace.nspname || '.' || type_row.typname || '.' || constraint_row.conname
      else constraint_namespace.nspname || '.' || constraint_row.conname
    end as object_identity,
    jsonb_build_object(
      'name', constraint_row.conname,
      'constraint_type', case constraint_row.contype
        when 'c' then 'check'
        when 'f' then 'foreign_key'
        when 'p' then 'primary_key'
        when 'u' then 'unique'
        when 'x' then 'exclusion'
        when 't' then 'constraint_trigger'
      end,
      'relation', case when relation_class.oid is not null then relation_namespace.nspname || '.' || relation_class.relname end,
      'type', case when type_row.oid is not null then type_namespace.nspname || '.' || type_row.typname end,
      'definition', pg_get_constraintdef(constraint_row.oid, false),
      'validated', constraint_row.convalidated,
      'deferrable', constraint_row.condeferrable,
      'initially_deferred', constraint_row.condeferred
    ) as definition
  from pg_constraint constraint_row
  join pg_namespace constraint_namespace on constraint_namespace.oid = constraint_row.connamespace
  left join pg_class relation_class on relation_class.oid = constraint_row.conrelid
  left join pg_namespace relation_namespace on relation_namespace.oid = relation_class.relnamespace
  left join pg_type type_row on type_row.oid = constraint_row.contypid
  left join pg_namespace type_namespace on type_namespace.oid = type_row.typnamespace
  where (
      relation_namespace.oid in (select oid from included_namespaces)
      or type_namespace.oid in (select oid from included_namespaces)
      or constraint_namespace.oid in (select oid from included_namespaces)
    )
    and constraint_row.contype in ('c', 'f', 'p', 'u', 'x', 't')
),
index_objects as (
  select
    'index'::text as object_kind,
    index_namespace.nspname || '.' || index_class.relname as object_identity,
    jsonb_build_object(
      'schema', index_namespace.nspname,
      'name', index_class.relname,
      'table', table_namespace.nspname || '.' || table_class.relname,
      'access_method', access_method.amname,
      'definition', pg_get_indexdef(index_row.indexrelid, 0, false),
      'unique', index_row.indisunique,
      'primary', index_row.indisprimary,
      'exclusion', index_row.indisexclusion,
      'valid', index_row.indisvalid,
      'ready', index_row.indisready,
      'predicate', pg_get_expr(index_row.indpred, index_row.indrelid, false),
      'expressions', pg_get_expr(index_row.indexprs, index_row.indrelid, false)
    ) as definition
  from pg_index index_row
  join pg_class index_class on index_class.oid = index_row.indexrelid
  join pg_namespace index_namespace on index_namespace.oid = index_class.relnamespace
  join pg_class table_class on table_class.oid = index_row.indrelid
  join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
  join pg_am access_method on access_method.oid = index_class.relam
  where index_namespace.oid in (select oid from included_namespaces)
    or table_namespace.oid in (select oid from included_namespaces)
),
trigger_objects as (
  select
    'trigger'::text as object_kind,
    namespace.nspname || '.' || class.relname || '.' || trigger_row.tgname as object_identity,
    jsonb_build_object(
      'schema', namespace.nspname,
      'table', class.relname,
      'name', trigger_row.tgname,
      'enabled', trigger_row.tgenabled,
      'definition', pg_get_triggerdef(trigger_row.oid, false)
    ) as definition
  from pg_trigger trigger_row
  join pg_class class on class.oid = trigger_row.tgrelid
  join included_namespaces namespace on namespace.oid = class.relnamespace
  where not trigger_row.tgisinternal
),
function_objects as (
  select
    'function'::text as object_kind,
    namespace.nspname || '.' || proc.proname || '(' || pg_get_function_identity_arguments(proc.oid) || ')' as object_identity,
    jsonb_build_object(
      'schema', namespace.nspname,
      'name', proc.proname,
      'arguments', pg_get_function_arguments(proc.oid),
      'identity_arguments', pg_get_function_identity_arguments(proc.oid),
      'result_type', pg_get_function_result(proc.oid),
      'kind', case proc.prokind
        when 'f' then 'function'
        when 'p' then 'procedure'
        when 'a' then 'aggregate'
        when 'w' then 'window'
      end,
      'language', language.lanname,
      'volatility', case proc.provolatile
        when 'i' then 'immutable'
        when 's' then 'stable'
        when 'v' then 'volatile'
      end,
      'strict', proc.proisstrict,
      'security_definer', proc.prosecdef,
      'parallel', proc.proparallel,
      'definition', replace(
        replace(pg_get_functiondef(proc.oid), E'\r\n', E'\n'),
        E'\r',
        E'\n'
      )
    ) as definition
  from pg_proc proc
  join included_namespaces namespace on namespace.oid = proc.pronamespace
  join pg_language language on language.oid = proc.prolang
),
enum_type_objects as (
  select
    'type'::text as object_kind,
    namespace.nspname || '.' || type.typname as object_identity,
    jsonb_build_object(
      'schema', namespace.nspname,
      'name', type.typname,
      'type_kind', 'enum',
      'labels', jsonb_agg(enum.enumlabel order by enum.enumsortorder)
    ) as definition
  from pg_type type
  join included_namespaces namespace on namespace.oid = type.typnamespace
  join pg_enum enum on enum.enumtypid = type.oid
  where type.typtype = 'e'
  group by namespace.nspname, type.typname
),
domain_type_objects as (
  select
    'type'::text as object_kind,
    namespace.nspname || '.' || type.typname as object_identity,
    jsonb_build_object(
      'schema', namespace.nspname,
      'name', type.typname,
      'type_kind', 'domain',
      'base_type', format_type(type.typbasetype, type.typtypmod),
      'not_null', type.typnotnull,
      'default', type.typdefault
    ) as definition
  from pg_type type
  join included_namespaces namespace on namespace.oid = type.typnamespace
  where type.typtype = 'd'
),
sequence_objects as (
  select
    'sequence'::text as object_kind,
    namespace.nspname || '.' || class.relname as object_identity,
    jsonb_build_object(
      'schema', namespace.nspname,
      'name', class.relname,
      'data_type', format_type(sequence.seqtypid, null::integer),
      'start_value', sequence.seqstart,
      'increment_by', sequence.seqincrement,
      'min_value', sequence.seqmin,
      'max_value', sequence.seqmax,
      'cache_size', sequence.seqcache,
      'cycle', sequence.seqcycle,
      'owned_by', (
        select owned_namespace.nspname || '.' || owned_class.relname || '.' || owned_attribute.attname
        from pg_depend depend
        join pg_class owned_class on owned_class.oid = depend.refobjid
        join pg_namespace owned_namespace on owned_namespace.oid = owned_class.relnamespace
        join pg_attribute owned_attribute
          on owned_attribute.attrelid = owned_class.oid
         and owned_attribute.attnum = depend.refobjsubid
        where depend.classid = 'pg_class'::regclass
          and depend.objid = class.oid
          and depend.refclassid = 'pg_class'::regclass
          and depend.deptype in ('a', 'i')
        order by owned_namespace.nspname, owned_class.relname, owned_attribute.attname
        limit 1
      )
    ) as definition
  from pg_class class
  join included_namespaces namespace on namespace.oid = class.relnamespace
  join pg_sequence sequence on sequence.seqrelid = class.oid
  where class.relkind = 'S'
),
view_objects as (
  select
    case class.relkind
      when 'v' then 'view'
      when 'm' then 'materialized_view'
    end::text as object_kind,
    namespace.nspname || '.' || class.relname as object_identity,
    jsonb_build_object(
      'schema', namespace.nspname,
      'name', class.relname,
      'relation_type', case class.relkind
        when 'v' then 'view'
        when 'm' then 'materialized_view'
      end,
      'definition', pg_get_viewdef(class.oid, false),
      'row_security_enabled', class.relrowsecurity,
      'row_security_forced', class.relforcerowsecurity
    ) as definition
  from pg_class class
  join included_namespaces namespace on namespace.oid = class.relnamespace
  where class.relkind in ('v', 'm')
),
policy_objects as (
  select
    'policy'::text as object_kind,
    namespace.nspname || '.' || class.relname || '.' || policy.polname as object_identity,
    jsonb_build_object(
      'schema', namespace.nspname,
      'table', class.relname,
      'name', policy.polname,
      'command', policy.polcmd,
      'permissive', policy.polpermissive,
      'roles', (
        select coalesce(jsonb_agg(role_name order by role_name), '[]'::jsonb)
        from (
          select case when role_oid = 0 then 'PUBLIC' else role.rolname end as role_name
          from unnest(policy.polroles) as role_oid
          left join pg_roles role on role.oid = role_oid
        ) role_names
      ),
      'using_expression', pg_get_expr(policy.polqual, policy.polrelid, false),
      'with_check_expression', pg_get_expr(policy.polwithcheck, policy.polrelid, false)
    ) as definition
  from pg_policy policy
  join pg_class class on class.oid = policy.polrelid
  join included_namespaces namespace on namespace.oid = class.relnamespace
),
schema_grant_objects as (
  select
    'grant'::text as object_kind,
    'schema:' || namespace.nspname || ':' || coalesce(grantee.rolname, 'PUBLIC') || ':' || acl.privilege_type as object_identity,
    jsonb_build_object(
      'object_type', 'schema',
      'object', namespace.nspname,
      'grantee', coalesce(grantee.rolname, 'PUBLIC'),
      'grantor', coalesce(grantor.rolname, 'unknown'),
      'privilege_type', acl.privilege_type,
      'is_grantable', acl.is_grantable
    ) as definition
  from included_namespaces namespace
  cross join lateral aclexplode(coalesce(namespace.nspacl, acldefault('n'::"char", namespace.nspowner))) acl
  left join pg_roles grantor on grantor.oid = acl.grantor
  left join pg_roles grantee on grantee.oid = acl.grantee
),
relation_grant_objects as (
  select
    'grant'::text as object_kind,
    case class.relkind when 'S' then 'sequence:' else 'relation:' end
      || namespace.nspname || '.' || class.relname || ':' || coalesce(grantee.rolname, 'PUBLIC') || ':' || acl.privilege_type as object_identity,
    jsonb_build_object(
      'object_type', case class.relkind when 'S' then 'sequence' else 'relation' end,
      'object', namespace.nspname || '.' || class.relname,
      'grantee', coalesce(grantee.rolname, 'PUBLIC'),
      'grantor', coalesce(grantor.rolname, 'unknown'),
      'privilege_type', acl.privilege_type,
      'is_grantable', acl.is_grantable
    ) as definition
  from pg_class class
  join included_namespaces namespace on namespace.oid = class.relnamespace
  cross join lateral aclexplode(coalesce(
    class.relacl,
    acldefault((case when class.relkind = 'S' then 'S' else 'r' end)::"char", class.relowner)
  )) acl
  left join pg_roles grantor on grantor.oid = acl.grantor
  left join pg_roles grantee on grantee.oid = acl.grantee
  where class.relkind in ('r', 'p', 'f', 'v', 'm', 'S')
),
function_grant_objects as (
  select
    'grant'::text as object_kind,
    'function:' || namespace.nspname || '.' || proc.proname || '(' || pg_get_function_identity_arguments(proc.oid) || '):' || coalesce(grantee.rolname, 'PUBLIC') || ':' || acl.privilege_type as object_identity,
    jsonb_build_object(
      'object_type', 'function',
      'object', namespace.nspname || '.' || proc.proname || '(' || pg_get_function_identity_arguments(proc.oid) || ')',
      'grantee', coalesce(grantee.rolname, 'PUBLIC'),
      'grantor', coalesce(grantor.rolname, 'unknown'),
      'privilege_type', acl.privilege_type,
      'is_grantable', acl.is_grantable
    ) as definition
  from pg_proc proc
  join included_namespaces namespace on namespace.oid = proc.pronamespace
  cross join lateral aclexplode(coalesce(proc.proacl, acldefault('f'::"char", proc.proowner))) acl
  left join pg_roles grantor on grantor.oid = acl.grantor
  left join pg_roles grantee on grantee.oid = acl.grantee
),
type_grant_objects as (
  select
    'grant'::text as object_kind,
    'type:' || namespace.nspname || '.' || type.typname || ':' || coalesce(grantee.rolname, 'PUBLIC') || ':' || acl.privilege_type as object_identity,
    jsonb_build_object(
      'object_type', 'type',
      'object', namespace.nspname || '.' || type.typname,
      'grantee', coalesce(grantee.rolname, 'PUBLIC'),
      'grantor', coalesce(grantor.rolname, 'unknown'),
      'privilege_type', acl.privilege_type,
      'is_grantable', acl.is_grantable
    ) as definition
  from pg_type type
  join included_namespaces namespace on namespace.oid = type.typnamespace
  cross join lateral aclexplode(coalesce(type.typacl, acldefault('T'::"char", type.typowner))) acl
  left join pg_roles grantor on grantor.oid = acl.grantor
  left join pg_roles grantee on grantee.oid = acl.grantee
  where type.typtype in ('e', 'd')
),
inventory as (
  select * from schema_objects
  union all select * from extension_objects
  union all select * from relation_objects
  union all select * from column_objects
  union all select * from constraint_objects
  union all select * from index_objects
  union all select * from trigger_objects
  union all select * from function_objects
  union all select * from enum_type_objects
  union all select * from domain_type_objects
  union all select * from sequence_objects
  union all select * from view_objects
  union all select * from policy_objects
  union all select * from schema_grant_objects
  union all select * from relation_grant_objects
  union all select * from function_grant_objects
  union all select * from type_grant_objects
)
select jsonb_pretty(coalesce(
  jsonb_agg(
    jsonb_build_object(
      'object_kind', object_kind,
      'object_identity', object_identity,
      'definition', definition
    )
    order by object_kind, object_identity
  ),
  '[]'::jsonb
)) as schema_inventory_json
from inventory
  ) exact_catalog;
  SELECT encode(sha256(convert_to(jsonb_agg(item ORDER BY item->>'object_kind',item->>'object_identity')::text,'UTF8')),'hex')
    INTO actual_hash FROM jsonb_array_elements(actual_inventory) item
    WHERE item->>'object_kind'<>'grant' AND position('schema_migrations' in item->>'object_identity')=0;
  IF actual_hash <> '3c9576d97d410164b76d1922847f491d104220efe06550a717f8b3d393e4c091' THEN RAISE EXCEPTION 'QA schema changed; stop and re-audit'; END IF;
  SELECT result::jsonb->0->'definition' INTO data_checks FROM (
-- Read-only QA repair evidence: counts only, no application row values.
WITH checks AS (
SELECT jsonb_build_object(
 'node_versions_missing', (SELECT count(*) FROM nodes n WHERE NOT EXISTS (SELECT 1 FROM node_view_versions v WHERE v.company_id=n.company_id AND v.node_id=n.node_id)),
 'process_versions_missing', (SELECT count(*) FROM logic_gates n WHERE NOT EXISTS (SELECT 1 FROM logic_gate_work_versions v WHERE v.company_id=n.company_id AND v.logic_gate_id=n.logic_gate_id)),
 'blank_user_names', (SELECT count(*) FROM users WHERE btrim(display_name)=''),
 'legacy_notification_roles', (SELECT count(*) FROM notifications WHERE role IN ('generated','verified','verifier','accountable_old')),
 'legacy_notification_types', (SELECT count(*) FROM notifications WHERE notification_type IN ('cvi_inbox.changed','cvi_inbox.RCVI_updated')),
 'completed_nodes_without_timestamp', (SELECT count(*) FROM nodes WHERE lower(btrim(status)) IN ('done','complete','completed') AND completion_transition_timestamp IS NULL),
 'active_nodes_with_completion_timestamp', (SELECT count(*) FROM nodes WHERE lower(btrim(status)) NOT IN ('done','complete','completed') AND completion_transition_timestamp IS NOT NULL),
 'recycled_huddle_nodes_missing_date', (SELECT count(*) FROM recycle_bin_items i CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(restore_payload->'huddle_nodes')='array' THEN restore_payload->'huddle_nodes' ELSE '[]'::jsonb END) n WHERE nullif(n->>'huddle_date','') IS NULL AND nullif(n->>'created_timestamp','') IS NOT NULL),
 'legacy_recycled_raci_roles', (SELECT count(*) FROM recycle_bin_items i CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(restore_payload->'resource_gvic_assignments')='array' THEN restore_payload->'resource_gvic_assignments' ELSE '[]'::jsonb END) n WHERE n->>'role' IN ('generated','verified','verifier')),
 'legacy_recycled_source_payloads', (SELECT count(*) FROM recycle_bin_items WHERE restore_payload ? 'action_item_sources'),
 'legacy_recycled_scorecard_payloads', (SELECT count(*) FROM recycle_bin_items WHERE restore_payload ? 'qd_ratings'),
 'invalid_empty_node_documents', (SELECT count(*) FROM node_textboxes WHERE body_json->>'format'='mango-tiptap-json' AND body_json->>'schema_version'='1' AND body_json->'document'->>'type'='doc' AND body_json->'document'->'content'='[]'::jsonb AND jsonb_typeof(body_json->'annotations')='array'),
 'invalid_empty_node_history_documents', (SELECT count(*) FROM node_textboxes_history WHERE body_json->>'format'='mango-tiptap-json' AND body_json->>'schema_version'='1' AND body_json->'document'->>'type'='doc' AND body_json->'document'->'content'='[]'::jsonb AND jsonb_typeof(body_json->'annotations')='array'),
 'action_items_missing_source_field', (SELECT count(*) FROM entities e JOIN entity_types t USING(company_id,entity_type_id) WHERE t.system_key='action_item' AND NOT EXISTS (SELECT 1 FROM entity_fields f JOIN entity_field_types ft USING(company_id,entity_field_type_id) WHERE f.company_id=e.company_id AND f.entity_id=e.entity_id AND ft.system_key='source')),
 'action_items_missing_assigned_by_field', (SELECT count(*) FROM entities e JOIN entity_types t USING(company_id,entity_type_id) WHERE t.system_key='action_item' AND NOT EXISTS (SELECT 1 FROM entity_fields f JOIN entity_field_types ft USING(company_id,entity_field_type_id) WHERE f.company_id=e.company_id AND f.entity_id=e.entity_id AND ft.system_key='assigned_by'))
) AS definition
)
SELECT jsonb_build_array(jsonb_build_object('object_kind','qa_repair_data_checks','object_identity','qa.counts_only','definition',definition))::text FROM checks
  ) exact_data_checks(result);
  IF EXISTS (SELECT 1 FROM jsonb_each_text(data_checks) check_row WHERE check_row.value::bigint<>0) THEN
    RAISE EXCEPTION 'Unresolved QA data checks: %',data_checks;
  END IF;
END $qa_repair_guard$;
CREATE TABLE public.schema_migrations_reconciliation_audit (
  reconciliation_id text PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_commit text NOT NULL,
  schema_fingerprint text NOT NULL,
  original_ledger jsonb NOT NULL,
  reconciled_versions jsonb NOT NULL,
  rationale text NOT NULL
);
INSERT INTO public.schema_migrations_reconciliation_audit
 (reconciliation_id,source_commit,schema_fingerprint,original_ledger,reconciled_versions,rationale)
SELECT 'qa-history-20260909','1605cafee4a219c2e489959036bd43d699fbe474','3c9576d97d410164b76d1922847f491d104220efe06550a717f8b3d393e4c091',
 jsonb_agg(to_jsonb(ledger_row) ORDER BY version), '[{"version": "20260527_zz_admin_effective_access_priority.sql", "source_sha256": "5d57e4d22689ca329af8d9a67bdcd5f4336489b847df22007e4b168d353d0a4d", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260530_racio_projection_resource_permissions.sql", "source_sha256": "e6002ef51aa66ad44e7112caa7a01190b0f1a31fd5e3e62ddb7cec8c6db4936f", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260601_kanban_board_projection.sql", "source_sha256": "db4417352a36afe7b466aa9503057a1c9bf5ce841ccabd106e6637ce4ce060e6", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260601_workspace_derived_projection_checkpoints.sql", "source_sha256": "4858733cdc48b19c89ba8d9328cb035aa1f4448b059314544a45b7936674cae4", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260602_drop_legacy_kanban_tables.sql", "source_sha256": "5749e2f7ef60c5c35836456ee83930e92726fff45b21006adc931a30c80cc65c", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260602_projection_sequence_scopes.sql", "source_sha256": "6cdb99dbd0efae535cf41e129a68d5a83e6ba588c4bb8a782bc7e25c94dd86d3", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260603_event_rows.sql", "source_sha256": "fb98c5cb1f671ec8f505697c10ec47e190cb48f7658259a48aca72809d1e4a82", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260606_project_management_timeline_projection.sql", "source_sha256": "df385f791bd3310e266e04a643d3d073f69e6355a5e6120014d0a4be332a30ba", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260608_accounts.sql", "source_sha256": "fccba038c1498bba1a75b8a67a8edd107c05b19a95d2bbc92796b3fe788cec63", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260610_projects.sql", "source_sha256": "5034cbd372510608bde3296730a0317b83deba678d7684b95ab131b5ae2d6c21", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260611_communications_message_read_statuses.sql", "source_sha256": "c0a93d5923fd216d64690bb91b726eb6e8ad056bcd42fb36d06a915b8557c028", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260611_company_explorer_folder_permissions.sql", "source_sha256": "cecb07a858f6e9013437d142562046b047a193ff0df7c6ead6c728d23a3104e6", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260611_recycle_bin.sql", "source_sha256": "192572749a1c47c0f452c32bbdc5ebb4809b81fba7a20a2fbcfa76a01cf6a073", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260612_project_multi_assignments.sql", "source_sha256": "c854015ad000a466c4d724f53fd014f50a683b3e726d96888ede50b0cc7232c3", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260614_company_explorer_folder_scope.sql", "source_sha256": "ecadb1848b870e725e2cdc67872bbdd1293606b050dd1b301420342ea171dee0", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260615_aa_user_email_connection_scope.sql", "source_sha256": "eb6e6b6ea6dc7fcb15f83dcd06bd2bfe3eb7228641a74d2b834589dd3e5e1481", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260615_logic_gate_resource_raci_assignments.sql", "source_sha256": "564367be0f0918618c0dbf64610e5d72017a3438c462b55d9412dd5467b968d7", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260615_user_email_connections_per_account.sql", "source_sha256": "fd82363427c57ce2b0387acc290549b2a2b4504923dfa55a955baf066062e19e", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260615_z_ensure_user_email_connections_per_account.sql", "source_sha256": "81d5295298c08399aba255abd0060863f491a1fc7d0207a0f6d0491dd8e5d3d6", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260615_zz_shared_triage_dedicated_folders.sql", "source_sha256": "7f1b5db013d914919439110b69e471007c4a3f7899789f0494f43e7d5bb44c82", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260616_shared_inbox_split.sql", "source_sha256": "7a43f5fb91562ba2c9aafd113b5d5a5bc86a5e473d0f3fc5abbc332db2b97a66", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260617_company_explorer_v2_tables.sql", "source_sha256": "68508cb1570607609dbf1b66c39bbbd88996a482a930f3915db4d606ca17b58a", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260618_gvic_node_phase1.sql", "source_sha256": "b865012274388af3a8190160c85b703c7800e78e9f4fee42e3a3610ad4f6e5fc", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260618_z_gvic_node_phase2_cleanup.sql", "source_sha256": "dc5bbb825a4f833db36af19a5cd71d4d745b6a7a962d2adcbad219e669910326", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260619_company_explorer_single_tree_subscriptions.sql", "source_sha256": "af92448fbc405e1d7c96ba2e43c4f36efdc30c9e7f82b212b105d3793d753d82", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260619_notifications_gvic_roles.sql", "source_sha256": "f92ec53e5b8bfb4bef3a0454c8c24095bbaeeea9eb98e5169c925cb6df11dc1e", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260619_project_health_critical_path.sql", "source_sha256": "57db9510bdce8c25ea0c3cefc24a9c4555df0212e08bb6d6075a2c179c1f942c", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260620_company_explorer_final_cutover.sql", "source_sha256": "d138d87dcf0422196242c0e424eb316326214bd5a007390dd7099169c0451941", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260620_saved_views.sql", "source_sha256": "80c1ca8ea6fab11aa8f577d04776c374e2951976019936bb1dfbb65e8fc57058", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260620_z_company_explorer_access_helper_cutover.sql", "source_sha256": "eca28c81b8f3dc0315b2c92a0a880ea644d8d9e7dfe61800a82c3c0ad3113d05", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260621_zz_gvic_matrix_projection_clean_leaf_paths.sql", "source_sha256": "e462798e8615a37a65625c5b1bcee4b9824e7ab965e158ed0ec2ee92b5044c11", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260622_gvic_logic_gate_pointer_access.sql", "source_sha256": "402b0952898cc573f2ff22dd1a4beceaa68f52aaa43c4e1d028362a55be85b58", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260622_logic_gate_requested_by.sql", "source_sha256": "aad0491a8b8e1903504e532ab71932752f38c621a7a08a1a55e63c2c5fde16f6", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260624_company_email_connections.sql", "source_sha256": "4f180fc2a3d4736767baee79216cb38b30dfb0f9ff7a94a253ee420975641021", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260624_gvic_logic_gate_snapshot_nodes.sql", "source_sha256": "24d8e6e8287b15207ef7cc922a898ede755cc30f9fa739916fbd356035f307c6", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260624_pins.sql", "source_sha256": "bdcc34e520fc5206e04e9c5a5655bc95472c5ac4e2c24c355e04b2f0034b29a3", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260624_user_email_connections_personal_only.sql", "source_sha256": "49092770d65b3d6ec97debc460e558594a835fdb6cab1c7569af2fd5d8b66d50", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260626_company_explorer_no_node_items.sql", "source_sha256": "7e46b7d6571ad4bd1ead5403d09ff941a144d4bc6d3e9a7c7d83ff2bdd23a081", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260626_company_manager_role.sql", "source_sha256": "83026699e1f1d61c40524870a32de07a4e0638436822763f16cfc806a02eb8f0", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260626_hard_resource_permissions_cutover.sql", "source_sha256": "86d643b674f856e89f9482ed2f9bd09d4607c1821657a2350f71010eec6e618b", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260626_recycle_bin_user_scope.sql", "source_sha256": "87673b94b779602a6b54def0ace5310f836de635bbe39f01f72146c9cb3c9d15", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260629_communications_archive_jobs.sql", "source_sha256": "ae7ac5654cb98f337a52e09fd8c832dd99456c051a6221bc8ef0ba0c1882e2cf", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260629_logic_gate_kanban_grouping_preferences.sql", "source_sha256": "93b7e25d2b0e6f7c04c4319ee4859bdf62466077c31090e3d5b211dcc4a59dcb", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260629_require_user_display_name.sql", "source_sha256": "4fb9b9f217cce4e06c0248a4d4abc67a9527ba3241a4fbaec4f808e45ccfc69b", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260630_communications_message_read_receipt_summaries.sql", "source_sha256": "e6ff769a374cdf60f8e8843fb7eb4aede5561e70ebf58c013b38a71b3059d46a", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260630_fix_logic_gate_assignment_membership_fks.sql", "source_sha256": "ac72ad776b6c7bcab50a9416b3599c007c642a72c713efb60a04f8c68701346f", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260630_logic_gate_kanban_saved_view_singleton.sql", "source_sha256": "1d50010d80754ede6c8fe981478feafb3297df7be336fd3108d0c2d9b12953b3", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260630_resource_permission_group_subjects.sql", "source_sha256": "7f6a47f4b3e88867ae9d2f414068a549af56ef6a01ea5a3418758756abfef508", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260630_saved_view_settings.sql", "source_sha256": "8c72d296709fb6e214bb57dda49458d844430968777ad338d5fb290135aa46e9", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260630_zz_drop_saved_view_preferences.sql", "source_sha256": "fecbf5f82b2bb34da253624985150b7109a86d407118065235c6e9124b3ca2ec", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260701_resource_permissions_ignore_gvic.sql", "source_sha256": "6b06c8764e70ba640b89122477203a78ba1fecbcd68b475461df3b90b80c2f26", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260701_resource_policy_pointers.sql", "source_sha256": "0598988d88dfe04f1a8eeda7b7f33e86b3da861706b960b3581221a71cfe32f9", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260702_resource_policy_access_helper_no_gvic.sql", "source_sha256": "5b677ae44b6bbf0c204900a7e985e4cc6d615b41efeb8fbc26cf5d419afba261", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260707_editor_save_versions.sql", "source_sha256": "7040dcdfc0dfc1723227770f88f18bd7ae657f3dc6d6103b320a42b908baf23f", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260707_repair_missing_canonical_schema_objects.sql", "source_sha256": "f8ebaf9ad09a332811a8e6b151f5059bef40319e8255a1076865d1b465c0ce50", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260707_zz_align_prod_to_dev_schema.sql", "source_sha256": "a3cf027dd95e882111afdb13155e88c97f1f08baef5adbe10718f8f5a0706f12", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260709_mango_attachments.sql", "source_sha256": "de30687b590e0a5bbe06bf70c385dc8a162d14486c9c2ac20328d65c6a355c57", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260709_project_relationship_email_origin.sql", "source_sha256": "9206290c0544fc07757a3e31dd888ccc80a98226cc62c8537cf768bdb38d68f8", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260709_zz_email_drafts_signatures.sql", "source_sha256": "16e7af30140d3d21268ce8541cb438912a35f2261c3499adecb387ceb56531c5", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260710_browser_attachment_uploads.sql", "source_sha256": "ac5d1a2fb458ede61ff2aa9111cb290a8f558034bf488413e403a8b5fc4ab057", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260711_logic_gate_work_fast_path.sql", "source_sha256": "03073679b87cba1acae8b92e301d2fb15f440dc52364e101d44b8206a415773f", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260712_attachment_variant_generation_metadata.sql", "source_sha256": "a2a8bf4ad9682380dda3450a5c91cdd0cc867df3b665b7ce91e2ca40b3777643", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260712_node_view_fast_path.sql", "source_sha256": "f73e62a094e19c6cbc3b811f1ab4c8877037257a73540f498315507ea7522ad7", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260712_realtime_simplification.sql", "source_sha256": "1269aff19248f9d2f34a6b0131e622df8eff016b43135fd3c9e94e19216bc204", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260713_00_exact_account_communications_read_receipts.sql", "source_sha256": "872c5fc9dc5a7628484a1b66fa268e9140ab2d7583459515066a7e4d35aab6f4", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260713_drop_legacy_communications_message_read_statuses.sql", "source_sha256": "e07523405d478da57ca391e9c8a4e58f561e48bda19fc490b13b48fd0dd5f1b0", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260713_email_thread_collaboration.sql", "source_sha256": "31d4d458ceeeb9c750588e1384e379b4c7887945668d944504e8c75b4a46a39f", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260714_communications_message_read_receipt_signals.sql", "source_sha256": "6f61df59ebcdce15a6677217ffdcedf7e7dad6fc53bc1f69fc21b17aeae18a1d", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260714_editor_text_projection_revisions.sql", "source_sha256": "8255488cb5d64fc6f86356947eba972f9b5059fe288f2710c06ce42ef87a4d14", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260715_unified_realtime_collaboration.sql", "source_sha256": "d0abf795c7210899db18187a55383313d9b05f7affc5a17cfc37cfe3eaa44c06", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260715_zz_edit_or_no_access.sql", "source_sha256": "322f9b852eed26d90572c591caaead72e1506c9643d8d091f694048fdaf61344", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260716_restore_rich_html_collaboration.sql", "source_sha256": "e0de08a8b29695a15d47e4f581a021e5acb2ec56d3bd765ccec8095bb9a119c7", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260718_tiptap_json_foundation.sql", "source_sha256": "8c410eb47e62ea25e67f6ffacc7764a4818bf0aa914cf7b71377cad97fda47f2", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260719_persist_node_email_threads.sql", "source_sha256": "7e640e591aafe9e3bf457591695997114d4d8097fbbb317c3c86af3ddac32c61", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260719_zz_tiptap_annotation_positions.sql", "source_sha256": "1a8b042e5e2279764a3557ccbbfdef6967ea6c924bc0ebc893904b54de9a205e", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260721_entity_fields.sql", "source_sha256": "755ab49aeada4102ef244034f71a8aae553d52f1a16770a58498dec3858631bd", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260721_notification_priority_context.sql", "source_sha256": "9546a95522f411998b92fffc6279009e444de68e20a08046099e9e599b7034c2", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260722_editor_entity_search_indexes.sql", "source_sha256": "71ffb93c3bb8f44183b9d482461498a7234005f0f5947670fd1403a338ca3f80", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260722_node_timeline_verification_events.sql", "source_sha256": "6ea57af8e48faa25b479db49d0717d35aa0f1afcb117da250e384eeab4ee73cc", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260722_zz_full_descendant_policy_snapshots.sql", "source_sha256": "46b3d4937c28130ad085a6a78eef0dca82312415c8b510a540237bce644be844", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260723_project_logic_gates_many_projects.sql", "source_sha256": "dac5f68e5a74c169d1c9084d1fbaa6ec02848df1f5150e50364564d80592ea9e", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260726_node_v2_phase1_foundation.sql", "source_sha256": "121097dc3993400adf4a54926279c1edeb0e67841522f776956285b300944cb8", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260727_node_v2_phase2_product.sql", "source_sha256": "d0e769ba107421b8c4ff8ab5d82667140f12bb141d38455e2bc50ec3fd80b50a", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260727_zz_node_v2_phase3_engineering.sql", "source_sha256": "86b412704b2bb4d799a14353e296869e8b4ce10d9f41e2846954938b2256e61b", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260727_zzz_remove_tiptap_json_size_limit.sql", "source_sha256": "d68eec059dc6cbed2b8d88d6006a805546cf1e842c6f61bfce754d5ebeb52d6e", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260727_zzzz_editor_owner_text_limit.sql", "source_sha256": "0c788022489a4354faa0051de4aa91ed0caabeefa7e4d94edd5284f02210ca4c", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260728_durable_email_thread_download_jobs.sql", "source_sha256": "faddf921acff13d155f972c3244f6198c55a113e9a33ee508968dc711558c601", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260728_editor_owner_yjs_deltas.sql", "source_sha256": "51471b0de8cd5ce8ee1adcde342c64386fef91da83070db312808f0dd1ef8e13", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260728_zz_retire_yjs_storage.sql", "source_sha256": "1fe5685429f2a3e4f81137e59ed13cf434f84171a38b2440f7150ea99e90cfee", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260729_project_saved_versions.sql", "source_sha256": "83326340d3e6426952aee23b1d4b976c9a49d8f2c41392f07a2a38d7f00894dd", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260801_editor_textbox_storage_foundation.sql", "source_sha256": "987c086732422a624223adf51f101942bfcd488d0315b146e329847ee9fdb061", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260801_z_retire_legacy_editor_storage.sql", "source_sha256": "a848d4f969fe6f31790ce129f9c03f1e17b393a9c1ec764dd7b9d9092ceccbba", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260802_retire_node_v2_and_legacy_editor.sql", "source_sha256": "96214c066f672d579feee334fe78f53f89bb824f75bc5c4cf1ca77cd18e5b519", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260804_attachment_step1_expansion.sql", "source_sha256": "e8250327c9b32fda03cc0ecd9b2700fa71a93c048c14081ebccd94f27d8e5f6b", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260804_zzz_project_final_runtime_storage.sql", "source_sha256": "1b7e4705f57781f3f63d56fed19988b575ab3cde4c0e4914da1fdc6273c4e3af", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260804_zzzzzz_node_final_storage_cutover.sql", "source_sha256": "a955da7001782978705ea93ca5c4c8c46d8fefa128f9b8a184e1514077ee3df1", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_logic_gate_final_runtime_storage.sql", "source_sha256": "a6081501130b8206d27bad84d2f32bb49db835f52fe022d792343da96c3255ea", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_retire_node_legacy_storage.sql", "source_sha256": "3914216da17b4f61d6139bec16ae6730395db0855e285c9d28269cd5eb712926", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_zz_remove_map_runtime_contracts.sql", "source_sha256": "25f1c3a927fea8e3a3b30c2e8edc48fc2db661ab378407286b1de1822d236972", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_zzz_v2_gvic_permissions_step1.sql", "source_sha256": "c7e417e4d0caebafece8f170c927edf1aa872cad2547e365793c3d8b20083f15", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_zzza_v2_gvic_permissions_step1_resolvers.sql", "source_sha256": "ab763148e67dd69c88aafa99782249802d0322ed6b3d23dfe61fb9573346b683", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_zzzb_v2_gvic_permissions_step1_preflight_report.sql", "source_sha256": "6c11832c3e1c055da9ac5c8a758bd9d11f9983018943b4daec983080a3d0dfbb", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_zzzc_v2_gvic_permissions_step2_cutover.sql", "source_sha256": "2f5569b3b1547426defc6af3029ac1f974eb589f5b87372d923fdfda29363748", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_zzzd_repair_empty_node_textbox_documents.sql", "source_sha256": "b0eaa53c29b0acf425a723124d5c4eb284cee673df77dda24c43218c17d26351", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_zzzz_pinned_folders.sql", "source_sha256": "61f7594aafbe1f0a4cc2b8a2008b9b7dafdf554f3fc91c69ecbd0b072c6c1ee2", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260805_zzzzz_remove_node_unread_highlights.sql", "source_sha256": "b5d8a0629694317564ed72a4a58bc565833f1ed9578cd841bee70c148f5525f2", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260806_node_delete_policy_cascade.sql", "source_sha256": "a6bcb96096a98d732296ef6d9055f290b135f8e22063a4372e42091fdd539232", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260806_zz_remove_company_explorer_node_items.sql", "source_sha256": "c4be3f50d0ed58241e724a4de8e70cc82d64eab472da494df5b999feebe194f1", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260806_zzz_email_ingestion_engine.sql", "source_sha256": "36bc085e03e63ecc0a4a2f938c3c9b758d338b67ff59be7924b6376cebbf1aae", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260806_zzz_raci_roles.sql", "source_sha256": "0728cf0070b6dd805a2c40143b8a7674d0c843c17a73b072208c41112007ff02", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260807_node_project_assignment_timeline.sql", "source_sha256": "d507953c31025918f62caf5cbdafa2ae94b6ce7f5c706e654290419985eedb9d", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260808_node_priority_not_assigned.sql", "source_sha256": "20684f9b7a8e598e40470252acb5d453325a4380ca862b644c4dd16deab7ab30", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260809_zzz_email_sqs_delivery.sql", "source_sha256": "3efb5553d60411bbd9619fb9eb7a59d3984abd7063f5656cc573d1e6f6827ecd", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260809_zzzz_email_sqs_delivery_finalize.sql", "source_sha256": "c9aa002eaa5e41d26a5f01f9147d4abef8cec66a5442c9741c510646de3ecafd", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260810_zz_remove_retired_personal_work_surface.sql", "source_sha256": "ce3b2b94507c48aa933649b2d77fbfbfd75fa7460a5774d5e4cfb266e3eaa6fb", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260810_zzzz_raci_tabs.sql", "source_sha256": "4d259efd11b5356b2ca80cff9c57c3267f064195e181aed612bf771ac8a1f69c", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260811_huddles_kpis.sql", "source_sha256": "9cce3a7c55c04decc807718cba139d4defe9c355844119c9cc26fb5ce2c63661", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260811_z_huddle_explorer_logic_gates_only.sql", "source_sha256": "4fd551502d72a05d0d1fe7753701ba414d1f045daf1dec25a3be7ef40001236e", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260811_zz_huddle_logic_gate_relationships.sql", "source_sha256": "8176b2570f8c2bd139587a2d768a9bbd6cb33632348e56d9de6ab5aabdc0c245", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260811_zz_targeted_raci_tabs.sql", "source_sha256": "c6307ad8a9404f1302eff4ba569136340b27ef534ecf83e9c529af6b1a39bcca", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260811_zzz_email_draft_scope.sql", "source_sha256": "37081ed53662eee1977c56abe330fc4100acd60ee4b32ed377efb57824c1f2e5", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260813_email_draft_identity.sql", "source_sha256": "ddd86c4bfea0ebfa6fef948e0bdfb81635e8ec20fe666ae675d8f180ec543d28", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260814_project_email_relationships.sql", "source_sha256": "f0ffef06f0d0190913f96b324bf13ce89c0526ce298d8a8a7f02dcce0af7ca64", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260816_remove_node_email_drafts.sql", "source_sha256": "e55a2f737224db7fbf574c9a3d5f569f8c641de1d8928205795fc77f7d80ad3e", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260818_project_email_textbox_parity.sql", "source_sha256": "8c5f1df3f253f734994efa095fac6673457b440480d0ef6b97bc0a2799c31fbd", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260819_shared_email_drafts.sql", "source_sha256": "171ae6ceaaea56991d7a0a7cd3140ae06ff0d0f9335a3b99d515c21e085970f6", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260824_process_map.sql", "source_sha256": "6222f00ba675fdb89ab65f7845441ce260ae9e849447207c33f788c88cd83da4", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260825_canonical_schema_reconciliation.sql", "source_sha256": "9923685f34bfa37ac498e86ce2b706af292ed911edd3949fa3338bf4f1f7f3e7", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260825_qd_ratings.sql", "source_sha256": "9d538a81786e2f15c467e7832d404588bae9a1aeb0dd2e8c6553db17a673e48b", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260825_v3_process_map_global_canvas.sql", "source_sha256": "89973e6aed7fc22f7838028471bbb56917afadb30b7455ad7e40c53f3a76f78a", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260825_z_qd_cost_rating.sql", "source_sha256": "1abab80187704c06fde23ab5efc0dac86289cde02b00b40d57c332baa73e4fec", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260826_process_map_geometry_compaction.sql", "source_sha256": "32d21cd68eeaac08fe32d7115a9d05e998f98620e2811cc9654d2bed7492ff85", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260826_z_scorecards.sql", "source_sha256": "8733431100332975dd46b1e25b6f2b903e7055fcc9aeb520521959c956ed9a52", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260826_zz_process_map_automatic_placement.sql", "source_sha256": "ac7db8b1ab3c1a459718f6adf57c354374053b4afbbad05496b3cf4b0d3eac9f", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260826_zzz_process_map_read_invalidation.sql", "source_sha256": "a8b86363c1bde6479a43887863206f625dd548a1568f03848ef9d4147ecb0ee0", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260827_entities.sql", "source_sha256": "0369ab478e1260adb5b973451c24bf9e3a450851d203d4dd2b61389c22442022", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260828_action_items.sql", "source_sha256": "ffeda4171a39224996f059fd04843a927c4bfa9c3020b9528570c2b8a095f336", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260828_entity_relationships.sql", "source_sha256": "118d871d604f41eb53c81acc02cca3cd5066edde2e9bd198f2af649813718c31", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260828_huddle_node_workspace.sql", "source_sha256": "43aac093182e640086535e345d61c6f8c1e7ac3551bf2d48b1fe796616aec57d", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260828_z_huddle_logic_gate_attachments.sql", "source_sha256": "6add09b5cc988d81a91c132bf92e8b22ebab0048f224a2c266cdb2319357ef4b", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260828_zz_huddle_logic_gate_action_item_relationships.sql", "source_sha256": "e8c35cbadd349f237751d9ee70d3474915df76a917c63e8fba05c45639a1c7eb", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260828_zzz_my_work_person_in_charge_index.sql", "source_sha256": "653fc31dadc9c4fafd77f2d0dc6a3674519e813f1c5151b7feb98d3c58ebcf8e", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260829_action_item_delegation_source.sql", "source_sha256": "4143b57e5329a93403c642524763e3906241d9e644bfcc067f7f3f8dc174205d", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260829_my_work_node_completion_transition.sql", "source_sha256": "5a28c830eca3edb2a56b35d3b64b67994f25e69ecf00f9c0e4924ebc39de5312", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260829_z_action_item_source_entity_field.sql", "source_sha256": "36189b2ef86fe528d2d7f872d16b660903d4e9d497e5b01ce78b327b0bddcc3c", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260830_my_work_action_item_preferences.sql", "source_sha256": "9eac502a90896d5b93ea19e4fc9c8068a26d84b28b02e4cdd688e4c576c31396", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260830_z_huddle_action_item_preferences.sql", "source_sha256": "620da904d20fd08049f9b3645c6ac8e59b64dd34367089a3fa85638a52234645", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260831_huddle_node_dates_and_action_item_views.sql", "source_sha256": "3dfb93c7f0a69b2c2bd3e609f03ac361179fc2536ad2e40953915ab745fbbfe2", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}, {"version": "20260831_z_retire_raci_tabs.sql", "source_sha256": "804be92bdea5aae2691a0f8b9f7670848c59edd84bf8ac12750bf80d56a56566", "disposition": "proposed adoption of existing QA state; historical execution not asserted"}]'::jsonb,
 'Explicitly approved adoption of existing QA data and schema, with historical execution unasserted. Original rows and operator timestamps retained here. No historical data conversions replayed.'
FROM public.schema_migrations ledger_row;
INSERT INTO public.schema_migrations(version,applied_at)
SELECT version,CASE WHEN version='20260805_retire_node_legacy_storage.sql'
 THEN (SELECT applied_at FROM public.schema_migrations WHERE version='operator/20260805_retire_node_legacy_storage.sql')
 ELSE now() END
FROM unnest(ARRAY['20260527_zz_admin_effective_access_priority.sql','20260530_racio_projection_resource_permissions.sql','20260601_kanban_board_projection.sql','20260601_workspace_derived_projection_checkpoints.sql','20260602_drop_legacy_kanban_tables.sql','20260602_projection_sequence_scopes.sql','20260603_event_rows.sql','20260606_project_management_timeline_projection.sql','20260608_accounts.sql','20260610_projects.sql','20260611_communications_message_read_statuses.sql','20260611_company_explorer_folder_permissions.sql','20260611_recycle_bin.sql','20260612_project_multi_assignments.sql','20260614_company_explorer_folder_scope.sql','20260615_aa_user_email_connection_scope.sql','20260615_logic_gate_resource_raci_assignments.sql','20260615_user_email_connections_per_account.sql','20260615_z_ensure_user_email_connections_per_account.sql','20260615_zz_shared_triage_dedicated_folders.sql','20260616_shared_inbox_split.sql','20260617_company_explorer_v2_tables.sql','20260618_gvic_node_phase1.sql','20260618_z_gvic_node_phase2_cleanup.sql','20260619_company_explorer_single_tree_subscriptions.sql','20260619_notifications_gvic_roles.sql','20260619_project_health_critical_path.sql','20260620_company_explorer_final_cutover.sql','20260620_saved_views.sql','20260620_z_company_explorer_access_helper_cutover.sql','20260621_zz_gvic_matrix_projection_clean_leaf_paths.sql','20260622_gvic_logic_gate_pointer_access.sql','20260622_logic_gate_requested_by.sql','20260624_company_email_connections.sql','20260624_gvic_logic_gate_snapshot_nodes.sql','20260624_pins.sql','20260624_user_email_connections_personal_only.sql','20260626_company_explorer_no_node_items.sql','20260626_company_manager_role.sql','20260626_hard_resource_permissions_cutover.sql','20260626_recycle_bin_user_scope.sql','20260629_communications_archive_jobs.sql','20260629_logic_gate_kanban_grouping_preferences.sql','20260629_require_user_display_name.sql','20260630_communications_message_read_receipt_summaries.sql','20260630_fix_logic_gate_assignment_membership_fks.sql','20260630_logic_gate_kanban_saved_view_singleton.sql','20260630_resource_permission_group_subjects.sql','20260630_saved_view_settings.sql','20260630_zz_drop_saved_view_preferences.sql','20260701_resource_permissions_ignore_gvic.sql','20260701_resource_policy_pointers.sql','20260702_resource_policy_access_helper_no_gvic.sql','20260707_editor_save_versions.sql','20260707_repair_missing_canonical_schema_objects.sql','20260707_zz_align_prod_to_dev_schema.sql','20260709_mango_attachments.sql','20260709_project_relationship_email_origin.sql','20260709_zz_email_drafts_signatures.sql','20260710_browser_attachment_uploads.sql','20260711_logic_gate_work_fast_path.sql','20260712_attachment_variant_generation_metadata.sql','20260712_node_view_fast_path.sql','20260712_realtime_simplification.sql','20260713_00_exact_account_communications_read_receipts.sql','20260713_drop_legacy_communications_message_read_statuses.sql','20260713_email_thread_collaboration.sql','20260714_communications_message_read_receipt_signals.sql','20260714_editor_text_projection_revisions.sql','20260715_unified_realtime_collaboration.sql','20260715_zz_edit_or_no_access.sql','20260716_restore_rich_html_collaboration.sql','20260718_tiptap_json_foundation.sql','20260719_persist_node_email_threads.sql','20260719_zz_tiptap_annotation_positions.sql','20260721_entity_fields.sql','20260721_notification_priority_context.sql','20260722_editor_entity_search_indexes.sql','20260722_node_timeline_verification_events.sql','20260722_zz_full_descendant_policy_snapshots.sql','20260723_project_logic_gates_many_projects.sql','20260726_node_v2_phase1_foundation.sql','20260727_node_v2_phase2_product.sql','20260727_zz_node_v2_phase3_engineering.sql','20260727_zzz_remove_tiptap_json_size_limit.sql','20260727_zzzz_editor_owner_text_limit.sql','20260728_durable_email_thread_download_jobs.sql','20260728_editor_owner_yjs_deltas.sql','20260728_zz_retire_yjs_storage.sql','20260729_project_saved_versions.sql','20260801_editor_textbox_storage_foundation.sql','20260801_z_retire_legacy_editor_storage.sql','20260802_retire_node_v2_and_legacy_editor.sql','20260804_attachment_step1_expansion.sql','20260804_zzz_project_final_runtime_storage.sql','20260804_zzzzzz_node_final_storage_cutover.sql','20260805_logic_gate_final_runtime_storage.sql','20260805_retire_node_legacy_storage.sql','20260805_zz_remove_map_runtime_contracts.sql','20260805_zzz_v2_gvic_permissions_step1.sql','20260805_zzza_v2_gvic_permissions_step1_resolvers.sql','20260805_zzzb_v2_gvic_permissions_step1_preflight_report.sql','20260805_zzzc_v2_gvic_permissions_step2_cutover.sql','20260805_zzzd_repair_empty_node_textbox_documents.sql','20260805_zzzz_pinned_folders.sql','20260805_zzzzz_remove_node_unread_highlights.sql','20260806_node_delete_policy_cascade.sql','20260806_zz_remove_company_explorer_node_items.sql','20260806_zzz_email_ingestion_engine.sql','20260806_zzz_raci_roles.sql','20260807_node_project_assignment_timeline.sql','20260808_node_priority_not_assigned.sql','20260809_zzz_email_sqs_delivery.sql','20260809_zzzz_email_sqs_delivery_finalize.sql','20260810_zz_remove_retired_personal_work_surface.sql','20260810_zzzz_raci_tabs.sql','20260811_huddles_kpis.sql','20260811_z_huddle_explorer_logic_gates_only.sql','20260811_zz_huddle_logic_gate_relationships.sql','20260811_zz_targeted_raci_tabs.sql','20260811_zzz_email_draft_scope.sql','20260813_email_draft_identity.sql','20260814_project_email_relationships.sql','20260816_remove_node_email_drafts.sql','20260818_project_email_textbox_parity.sql','20260819_shared_email_drafts.sql','20260824_process_map.sql','20260825_canonical_schema_reconciliation.sql','20260825_qd_ratings.sql','20260825_v3_process_map_global_canvas.sql','20260825_z_qd_cost_rating.sql','20260826_process_map_geometry_compaction.sql','20260826_z_scorecards.sql','20260826_zz_process_map_automatic_placement.sql','20260826_zzz_process_map_read_invalidation.sql','20260827_entities.sql','20260828_action_items.sql','20260828_entity_relationships.sql','20260828_huddle_node_workspace.sql','20260828_z_huddle_logic_gate_attachments.sql','20260828_zz_huddle_logic_gate_action_item_relationships.sql','20260828_zzz_my_work_person_in_charge_index.sql','20260829_action_item_delegation_source.sql','20260829_my_work_node_completion_transition.sql','20260829_z_action_item_source_entity_field.sql','20260830_my_work_action_item_preferences.sql','20260830_z_huddle_action_item_preferences.sql','20260831_huddle_node_dates_and_action_item_views.sql','20260831_z_retire_raci_tabs.sql']::text[]) version;
DELETE FROM public.schema_migrations WHERE version IN ('operator/20260805_retire_map_position_storage.sql','operator/20260805_retire_node_legacy_storage.sql');
DO $qa_repair_verify$
BEGIN
 IF (SELECT count(*) FROM public.schema_migrations)<>244 THEN RAISE EXCEPTION 'Unexpected reconciled ledger count'; END IF;
END $qa_repair_verify$;
COMMIT;
