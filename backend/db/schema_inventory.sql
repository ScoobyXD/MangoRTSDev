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
from inventory;
