-- Read-only. Run directly in DBeaver against the Mango development database.
-- READY-existing checks table kinds and exact column names/counts, not every
-- constraint, type, or index. It assumes the existing tables came from the
-- reviewed migration. Never apply that CREATE TABLE migration over existing data.
WITH expected(table_name, column_names) AS (
    VALUES
        ('ai_chats', ARRAY['company_id', 'user_id', 'chat_id', 'name', 'created_timestamp']::text[]),
        ('ai_messages', ARRAY['company_id', 'user_id', 'message_id', 'chat_id', 'run_id', 'role', 'content', 'created_timestamp']::text[]),
        ('ai_runs', ARRAY['company_id', 'user_id', 'run_id', 'hermes_run_id', 'chat_id', 'status', 'pending_input', 'history', 'created_timestamp']::text[]),
        ('ai_actions', ARRAY['company_id', 'user_id', 'run_id', 'action_name', 'action_key', 'result']::text[])
), inspected AS (
    SELECT expected.table_name,
           expected.column_names AS expected_columns,
           relation.oid AS relation_oid,
           relation.relkind,
           COALESCE(array_agg(attribute.attname::text)
               FILTER (WHERE attribute.attname IS NOT NULL), ARRAY[]::text[]) AS actual_columns
      FROM expected
      LEFT JOIN pg_namespace namespace ON namespace.nspname = 'public'
      LEFT JOIN pg_class relation
        ON relation.relnamespace = namespace.oid
       AND relation.relname = expected.table_name
      LEFT JOIN pg_attribute attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     GROUP BY expected.table_name, expected.column_names, relation.oid, relation.relkind
), checked AS (
    SELECT *,
           relation_oid IS NOT NULL
           AND relkind = 'r'
           AND cardinality(actual_columns) = cardinality(expected_columns)
           AND actual_columns @> expected_columns
           AND actual_columns <@ expected_columns AS columns_match
      FROM inspected
), summary AS (
    SELECT CASE
             WHEN current_setting('server_version_num')::integer < 170000
               OR current_setting('server_version_num')::integer >= 190000
               THEN 'STOP: PostgreSQL 17.x or 18.x is required'
             WHEN to_regclass('public.users') IS NULL
               OR to_regclass('public.companies') IS NULL
               OR to_regclass('public.company_memberships') IS NULL
               THEN 'STOP: required Mango identity tables are missing; check the selected database'
             WHEN count(relation_oid) = 0
               THEN 'READY-migrate: human operator must apply 20260907_hermes_action_receipts.sql, then rerun this preflight'
             WHEN bool_and(columns_match)
               THEN 'READY-existing: all four table column sets match; do not rerun the migration'
             ELSE 'STOP: partial or conflicting AI tables; inspect before making any database changes'
           END AS storage_preflight
      FROM checked
)
SELECT current_database() AS database_name,
       current_setting('server_version') AS postgres_version,
       summary.storage_preflight,
       checked.table_name,
       CASE WHEN relation_oid IS NULL THEN 'missing'
            WHEN columns_match THEN 'columns match'
            ELSE 'conflict'
       END AS table_status,
       cardinality(expected_columns) AS expected_column_count,
       cardinality(actual_columns) AS actual_column_count,
       expected_columns,
       actual_columns
  FROM checked
 CROSS JOIN summary
 ORDER BY checked.table_name;
