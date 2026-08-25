-- Read-only verification for the one-time Mango development schema alignment.
-- Run this complete script in DBeaver after the write script commits.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = public, pg_catalog;

SELECT
    current_database() AS connected_database,
    current_user AS connected_user,
    current_setting('server_version') AS server_version,
    current_setting('server_version_num')::integer AS server_version_num,
    current_setting('transaction_read_only') AS transaction_read_only;

WITH
expected_table_columns(table_name, column_names) AS (
    VALUES
        ('attachment_relationships', ARRAY[
            'attachment_id', 'attachment_relationship_id', 'company_id',
            'created_by_user_id', 'created_timestamp', 'deleted_timestamp',
            'editor_surface', 'information_id', 'message_id',
            'relationship_kind', 'resource_id', 'resource_type'
        ]::text[]),
        ('email_connections', ARRAY[
            'account_email', 'company_id', 'connected_by_user_id',
            'connection_type', 'created_timestamp', 'email_connection_id',
            'grant_id', 'ingestion_started_at', 'last_successful_scan_at',
            'personal_user_id', 'provider', 'status', 'updated_timestamp'
        ]::text[]),
        ('email_drafts', ARRAY[
            'bcc_recipients', 'body_editor_html', 'cc_recipients',
            'company_id', 'created_by_user_id', 'created_timestamp',
            'deleted_timestamp', 'draft_id', 'email_account_type', 'kind',
            'personal_account_email', 'personal_user_id', 'revision',
            'scheduled_send_timestamp', 'sender_account_email',
            'shared_inbox_id', 'shared_resource_id', 'shared_resource_type',
            'source_email_message_id', 'subject', 'to_recipients',
            'updated_by_user_id', 'updated_timestamp'
        ]::text[]),
        ('email_ingestion_jobs', ARRAY[
            'attempt_token', 'company_id', 'completed_timestamp',
            'created_timestamp', 'email_connection_id', 'email_thread_id',
            'enqueue_source_id', 'failed_timestamp', 'ingestion_job_id',
            'last_error', 'priority', 'provider_attempt_count',
            'provider_message_id', 'provider_thread_id',
            'sqs_accepted_timestamp', 'status', 'updated_timestamp'
        ]::text[]),
        ('email_threads', ARRAY[
            'company_id', 'created_timestamp', 'download_status',
            'email_connection_id', 'email_thread_id', 'fetched_timestamp',
            'history_complete', 'last_download_error', 'provider_thread_id',
            'provider_thread_key', 'root_provider_message_id',
            'updated_timestamp'
        ]::text[]),
        ('pins', ARRAY[
            'company_id', 'created_timestamp', 'name', 'parent_folder_id',
            'pin_id', 'position', 'resource_id', 'resource_type', 'user_id'
        ]::text[]),
        ('resource_gvic_assignments', ARRAY[
            'company_id', 'created_timestamp', 'principal_id',
            'principal_type', 'resource_id', 'resource_type', 'role',
            'updated_timestamp'
        ]::text[]),
        ('resource_permissions', ARRAY[
            'access_level', 'company_id', 'created_timestamp', 'resource_id',
            'resource_type', 'subject_id', 'subject_type', 'updated_timestamp'
        ]::text[])
),
expected_columns AS (
    SELECT expected.table_name, column_name
    FROM expected_table_columns expected
    CROSS JOIN LATERAL unnest(expected.column_names) AS columns(column_name)
),
actual_columns AS (
    SELECT c.relname::text AS table_name, a.attname::text AS column_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND c.relname IN (SELECT table_name FROM expected_table_columns)
),
expected_target_constraints(table_name, constraint_name, definition) AS (
    VALUES
        ('email_connections', 'email_connections_company_id_email_connection_id_key', 'UNIQUE (company_id, email_connection_id)'),
        ('email_connections', 'email_connections_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE'),
        ('email_connections', 'email_connections_connected_by_user_id_fkey', 'FOREIGN KEY (connected_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL'),
        ('email_connections', 'email_connections_pkey', 'PRIMARY KEY (email_connection_id)'),
        ('email_connections', 'email_connections_personal_user_id_fkey', 'FOREIGN KEY (personal_user_id) REFERENCES users(user_id) ON DELETE CASCADE'),
        ('email_drafts', 'email_drafts_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_company_id_email_connection_id_fkey', 'FOREIGN KEY (company_id, email_connection_id) REFERENCES email_connections(company_id, email_connection_id) ON DELETE CASCADE'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_company_id_email_thread_id_fkey', 'FOREIGN KEY (company_id, email_thread_id) REFERENCES email_threads(company_id, email_thread_id) ON DELETE SET NULL'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_pkey', 'PRIMARY KEY (ingestion_job_id)'),
        ('email_threads', 'email_threads_company_id_email_connection_id_fkey', 'FOREIGN KEY (company_id, email_connection_id) REFERENCES email_connections(company_id, email_connection_id) ON DELETE CASCADE'),
        ('pins', 'pins_company_id_user_id_parent_folder_id_fkey', 'FOREIGN KEY (company_id, user_id, parent_folder_id) REFERENCES pin_folders(company_id, user_id, folder_id) ON DELETE CASCADE')
),
actual_target_constraints AS (
    SELECT c.relname::text AS table_name,
           con.conname::text AS constraint_name,
           pg_get_constraintdef(con.oid, false) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (c.relname, con.conname) IN (
          SELECT table_name, constraint_name FROM expected_target_constraints
      )
),
source_constraint_names(table_name, constraint_name) AS (
    VALUES
        ('email_connections', 'company_email_connections_company_id_company_email_connecti_key'),
        ('email_connections', 'company_email_connections_company_id_fkey'),
        ('email_connections', 'company_email_connections_connected_by_user_id_fkey'),
        ('email_connections', 'company_email_connections_pkey'),
        ('email_connections', 'email_connections_personal_user_fkey'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_connection_fkey'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_thread_fkey'),
        ('email_ingestion_jobs', 'email_thread_download_jobs_pkey'),
        ('email_threads', 'email_threads_email_connection_fkey'),
        ('pins', 'pins_parent_folder_fk')
),
expected_target_defaults(table_name, column_name, default_expression) AS (
    VALUES
        ('email_connections', 'ingestion_started_at', 'now()'),
        ('email_connections', 'last_successful_scan_at', 'now()'),
        ('email_ingestion_jobs', 'priority', '30')
),
actual_target_defaults AS (
    SELECT c.relname::text AS table_name,
           a.attname::text AS column_name,
           COALESCE(pg_get_expr(d.adbin, d.adrelid), '<none>') AS default_expression
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND (c.relname, a.attname) IN (
          SELECT table_name, column_name FROM expected_target_defaults
      )
),
expected_triggers(table_name, trigger_name) AS (
    VALUES
        ('resource_gvic_assignments', 'trg_logic_gate_work_version_gvic'),
        ('resource_permissions', 'trg_logic_gate_work_version_permissions')
),
actual_triggers AS (
    SELECT c.relname::text AS table_name, t.tgname::text AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (c.relname, t.tgname) IN (
          SELECT table_name, trigger_name FROM expected_triggers
      )
      AND NOT t.tgisinternal
      AND t.tgtype = 29
      AND t.tgenabled = 'O'
      AND t.tgnargs = 0
      AND pn.nspname = 'public'
      AND p.proname = 'mangorts_trg_bump_logic_gate_work_from_resource'
      AND p.pronargs = 0
),
checks(check_name, passed, details) AS (
    SELECT
        'connected_database_is_MiraeRTSDevDatabase',
        current_database() = 'MiraeRTSDevDatabase',
        'actual=' || current_database()
    UNION ALL
    SELECT
        'postgres_major_is_17',
        current_setting('server_version_num')::integer >= 170000
            AND current_setting('server_version_num')::integer < 180000,
        'server_version=' || current_setting('server_version')
    UNION ALL
    SELECT
        'transaction_is_read_only',
        current_setting('transaction_read_only') = 'on',
        'transaction_read_only=' || current_setting('transaction_read_only')
    UNION ALL
    SELECT
        'touched_tables_have_exact_unordered_column_sets',
        (SELECT count(*) FROM expected_columns) = (SELECT count(*) FROM actual_columns)
            AND NOT EXISTS (
                (SELECT table_name, column_name FROM expected_columns
                 EXCEPT
                 SELECT table_name, column_name FROM actual_columns)
                UNION ALL
                (SELECT table_name, column_name FROM actual_columns
                 EXCEPT
                 SELECT table_name, column_name FROM expected_columns)
            ),
        'expected_columns=' || (SELECT count(*) FROM expected_columns)
            || ', actual_columns=' || (SELECT count(*) FROM actual_columns)
    UNION ALL
    SELECT
        'target_constraint_names_and_definitions_are_exact',
        (SELECT count(*) FROM expected_target_constraints) = (SELECT count(*) FROM actual_target_constraints)
            AND NOT EXISTS (
                (SELECT * FROM expected_target_constraints
                 EXCEPT
                 SELECT * FROM actual_target_constraints)
                UNION ALL
                (SELECT * FROM actual_target_constraints
                 EXCEPT
                 SELECT * FROM expected_target_constraints)
            ),
        'expected=11, actual=' || (SELECT count(*) FROM actual_target_constraints)
    UNION ALL
    SELECT
        'source_constraint_names_are_absent',
        NOT EXISTS (
            SELECT 1
            FROM source_constraint_names expected
            JOIN pg_class c ON c.relname = expected.table_name
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            JOIN pg_constraint con
              ON con.conrelid = c.oid
             AND con.conname = expected.constraint_name
        ),
        'remaining_source_names=' || (
            SELECT count(*)
            FROM source_constraint_names expected
            JOIN pg_class c ON c.relname = expected.table_name
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            JOIN pg_constraint con
              ON con.conrelid = c.oid
             AND con.conname = expected.constraint_name
        )
    UNION ALL
    SELECT
        'target_defaults_are_exact',
        (SELECT count(*) FROM expected_target_defaults) = (SELECT count(*) FROM actual_target_defaults)
            AND NOT EXISTS (
                (SELECT * FROM expected_target_defaults
                 EXCEPT
                 SELECT * FROM actual_target_defaults)
                UNION ALL
                (SELECT * FROM actual_target_defaults
                 EXCEPT
                 SELECT * FROM expected_target_defaults)
            ),
        'expected=3, actual=' || (SELECT count(*) FROM actual_target_defaults)
    UNION ALL
    SELECT
        'obsolete_indexes_are_absent',
        NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname IN (
                  'idx_logic_gate_textboxes_history_batches',
                  'idx_node_textboxes_history_batches',
                  'idx_node_textboxes_node_created',
                  'idx_project_textboxes_history_batches'
              )
        ),
        'remaining=' || (
            SELECT count(*) FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname IN (
                  'idx_logic_gate_textboxes_history_batches',
                  'idx_node_textboxes_history_batches',
                  'idx_node_textboxes_node_created',
                  'idx_project_textboxes_history_batches'
              )
        )
    UNION ALL
    SELECT
        'obsolete_functions_are_absent',
        NOT EXISTS (
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN (
                  'mangorts_legacy_project_saved_blocks',
                  'mangorts_legacy_saved_editor_body',
                  'v3_migration_try_chat_attachment_ids_v1',
                  'v3_migration_try_integer_v1',
                  'v3_migration_try_jsonb_v1',
                  'v3_migration_try_timestamptz_v1',
                  'v3_migration_try_uuid_array_v1',
                  'v3_migration_try_uuid_v1'
              )
        ),
        'remaining=' || (
            SELECT count(*)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN (
                  'mangorts_legacy_project_saved_blocks',
                  'mangorts_legacy_saved_editor_body',
                  'v3_migration_try_chat_attachment_ids_v1',
                  'v3_migration_try_integer_v1',
                  'v3_migration_try_jsonb_v1',
                  'v3_migration_try_timestamptz_v1',
                  'v3_migration_try_uuid_array_v1',
                  'v3_migration_try_uuid_v1'
              )
        )
    UNION ALL
    SELECT
        'obsolete_information_type_is_absent',
        NOT EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public'
              AND t.typname = 'information_type'
        ),
        'remaining=' || (
            SELECT count(*)
            FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public'
              AND t.typname = 'information_type'
        )
    UNION ALL
    SELECT
        'attachment_owner_validator_is_exact_target_version',
        (
            SELECT count(*) = 1
               AND bool_and(p.pronargs = 0)
               AND bool_and(l.lanname = 'plpgsql')
               AND bool_and(p.prorettype = 'pg_catalog.trigger'::regtype)
               AND bool_and(md5(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) = 'e9786efc17d2752a5b97e91513797a21')
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_language l ON l.oid = p.prolang
            WHERE n.nspname = 'public'
              AND p.proname = 'mangorts_validate_attachment_relationship_owner'
        ),
        'expected_normalized_source_md5=e9786efc17d2752a5b97e91513797a21'
    UNION ALL
    SELECT
        'logic_gate_work_trigger_function_is_exact',
        (
            SELECT count(*) = 1
               AND bool_and(p.pronargs = 0)
               AND bool_and(l.lanname = 'plpgsql')
               AND bool_and(p.prorettype = 'pg_catalog.trigger'::regtype)
               AND bool_and(md5(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) = 'e5351d94a113d3dfea053f9c892dd3cd')
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_language l ON l.oid = p.prolang
            WHERE n.nspname = 'public'
              AND p.proname = 'mangorts_trg_bump_logic_gate_work_from_resource'
        ),
        'expected_normalized_source_md5=e5351d94a113d3dfea053f9c892dd3cd'
    UNION ALL
    SELECT
        'logic_gate_work_triggers_are_exact',
        (SELECT count(*) FROM expected_triggers) = (SELECT count(*) FROM actual_triggers)
            AND NOT EXISTS (
                (SELECT * FROM expected_triggers
                 EXCEPT
                 SELECT * FROM actual_triggers)
                UNION ALL
                (SELECT * FROM actual_triggers
                 EXCEPT
                 SELECT * FROM expected_triggers)
            ),
        'expected=2, actual=' || (SELECT count(*) FROM actual_triggers)
    UNION ALL
    SELECT
        'email_draft_company_rows_have_valid_parent',
        NOT EXISTS (
            SELECT 1
            FROM public.email_drafts draft
            LEFT JOIN public.companies company ON company.company_id = draft.company_id
            WHERE company.company_id IS NULL
        ),
        'orphan_rows=' || (
            SELECT count(*)
            FROM public.email_drafts draft
            LEFT JOIN public.companies company ON company.company_id = draft.company_id
            WHERE company.company_id IS NULL
        )
)
SELECT
    CASE
        WHEN bool_and(passed) OVER () THEN 'PASS - development schema alignment is verified'
        ELSE 'STOP - development schema alignment is not verified'
    END AS overall_status,
    check_name,
    CASE WHEN passed THEN 'PASS' ELSE 'STOP' END AS check_status,
    details
FROM checks
ORDER BY check_name;

ROLLBACK;
