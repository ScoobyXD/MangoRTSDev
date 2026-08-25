-- Read-only preflight for the one-time Mango development schema alignment.
-- Run this complete script in DBeaver while connected to MiraeRTSDevDatabase.
-- Do not run the write script unless every row reports PASS.

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
expected_columns(table_name, column_name) AS (
    VALUES
        ('attachment_relationships', 'attachment_id'),
        ('attachment_relationships', 'attachment_relationship_id'),
        ('attachment_relationships', 'company_id'),
        ('attachment_relationships', 'created_by_user_id'),
        ('attachment_relationships', 'created_timestamp'),
        ('attachment_relationships', 'deleted_timestamp'),
        ('attachment_relationships', 'editor_surface'),
        ('attachment_relationships', 'information_id'),
        ('attachment_relationships', 'message_id'),
        ('attachment_relationships', 'relationship_kind'),
        ('attachment_relationships', 'resource_id'),
        ('attachment_relationships', 'resource_type'),
        ('email_connections', 'account_email'),
        ('email_connections', 'company_id'),
        ('email_connections', 'connected_by_user_id'),
        ('email_connections', 'connection_type'),
        ('email_connections', 'created_timestamp'),
        ('email_connections', 'email_connection_id'),
        ('email_connections', 'grant_id'),
        ('email_connections', 'ingestion_started_at'),
        ('email_connections', 'last_successful_scan_at'),
        ('email_connections', 'personal_user_id'),
        ('email_connections', 'provider'),
        ('email_connections', 'status'),
        ('email_connections', 'updated_timestamp'),
        ('email_drafts', 'bcc_recipients'),
        ('email_drafts', 'body_editor_html'),
        ('email_drafts', 'cc_recipients'),
        ('email_drafts', 'company_id'),
        ('email_drafts', 'created_by_user_id'),
        ('email_drafts', 'created_timestamp'),
        ('email_drafts', 'deleted_timestamp'),
        ('email_drafts', 'draft_id'),
        ('email_drafts', 'email_account_type'),
        ('email_drafts', 'kind'),
        ('email_drafts', 'personal_account_email'),
        ('email_drafts', 'personal_user_id'),
        ('email_drafts', 'revision'),
        ('email_drafts', 'scheduled_send_timestamp'),
        ('email_drafts', 'sender_account_email'),
        ('email_drafts', 'shared_inbox_id'),
        ('email_drafts', 'shared_resource_id'),
        ('email_drafts', 'shared_resource_type'),
        ('email_drafts', 'source_email_message_id'),
        ('email_drafts', 'subject'),
        ('email_drafts', 'to_recipients'),
        ('email_drafts', 'updated_by_user_id'),
        ('email_drafts', 'updated_timestamp'),
        ('email_ingestion_jobs', 'attempt_token'),
        ('email_ingestion_jobs', 'company_id'),
        ('email_ingestion_jobs', 'completed_timestamp'),
        ('email_ingestion_jobs', 'created_timestamp'),
        ('email_ingestion_jobs', 'email_connection_id'),
        ('email_ingestion_jobs', 'email_thread_id'),
        ('email_ingestion_jobs', 'enqueue_source_id'),
        ('email_ingestion_jobs', 'failed_timestamp'),
        ('email_ingestion_jobs', 'ingestion_job_id'),
        ('email_ingestion_jobs', 'last_error'),
        ('email_ingestion_jobs', 'priority'),
        ('email_ingestion_jobs', 'provider_attempt_count'),
        ('email_ingestion_jobs', 'provider_message_id'),
        ('email_ingestion_jobs', 'provider_thread_id'),
        ('email_ingestion_jobs', 'sqs_accepted_timestamp'),
        ('email_ingestion_jobs', 'status'),
        ('email_ingestion_jobs', 'updated_timestamp'),
        ('email_threads', 'company_id'),
        ('email_threads', 'created_timestamp'),
        ('email_threads', 'download_status'),
        ('email_threads', 'email_connection_id'),
        ('email_threads', 'email_thread_id'),
        ('email_threads', 'fetched_timestamp'),
        ('email_threads', 'history_complete'),
        ('email_threads', 'last_download_error'),
        ('email_threads', 'provider_thread_id'),
        ('email_threads', 'provider_thread_key'),
        ('email_threads', 'root_provider_message_id'),
        ('email_threads', 'updated_timestamp'),
        ('pins', 'company_id'),
        ('pins', 'created_timestamp'),
        ('pins', 'name'),
        ('pins', 'parent_folder_id'),
        ('pins', 'pin_id'),
        ('pins', 'position'),
        ('pins', 'resource_id'),
        ('pins', 'resource_type'),
        ('pins', 'user_id'),
        ('resource_gvic_assignments', 'company_id'),
        ('resource_gvic_assignments', 'created_timestamp'),
        ('resource_gvic_assignments', 'principal_id'),
        ('resource_gvic_assignments', 'principal_type'),
        ('resource_gvic_assignments', 'resource_id'),
        ('resource_gvic_assignments', 'resource_type'),
        ('resource_gvic_assignments', 'role'),
        ('resource_gvic_assignments', 'updated_timestamp'),
        ('resource_permissions', 'access_level'),
        ('resource_permissions', 'company_id'),
        ('resource_permissions', 'created_timestamp'),
        ('resource_permissions', 'resource_id'),
        ('resource_permissions', 'resource_type'),
        ('resource_permissions', 'subject_id'),
        ('resource_permissions', 'subject_type'),
        ('resource_permissions', 'updated_timestamp')
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
      AND c.relname IN (
          'attachment_relationships',
          'email_connections',
          'email_drafts',
          'email_ingestion_jobs',
          'email_threads',
          'pins',
          'resource_gvic_assignments',
          'resource_permissions'
      )
),
expected_source_constraints(table_name, constraint_name, definition) AS (
    VALUES
        ('email_connections', 'company_email_connections_company_id_company_email_connecti_key', 'UNIQUE (company_id, email_connection_id)'),
        ('email_connections', 'company_email_connections_company_id_fkey', 'FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE'),
        ('email_connections', 'company_email_connections_connected_by_user_id_fkey', 'FOREIGN KEY (connected_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL'),
        ('email_connections', 'company_email_connections_pkey', 'PRIMARY KEY (email_connection_id)'),
        ('email_connections', 'email_connections_personal_user_fkey', 'FOREIGN KEY (personal_user_id) REFERENCES users(user_id) ON DELETE CASCADE'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_connection_fkey', 'FOREIGN KEY (company_id, email_connection_id) REFERENCES email_connections(company_id, email_connection_id) ON DELETE CASCADE'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_thread_fkey', 'FOREIGN KEY (company_id, email_thread_id) REFERENCES email_threads(company_id, email_thread_id) ON DELETE SET NULL'),
        ('email_ingestion_jobs', 'email_thread_download_jobs_pkey', 'PRIMARY KEY (ingestion_job_id)'),
        ('email_threads', 'email_threads_email_connection_fkey', 'FOREIGN KEY (company_id, email_connection_id) REFERENCES email_connections(company_id, email_connection_id) ON DELETE CASCADE'),
        ('pins', 'pins_parent_folder_fk', 'FOREIGN KEY (company_id, user_id, parent_folder_id) REFERENCES pin_folders(company_id, user_id, folder_id) ON DELETE CASCADE')
),
actual_source_constraints AS (
    SELECT c.relname::text AS table_name,
           con.conname::text AS constraint_name,
           pg_get_constraintdef(con.oid, false) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN expected_source_constraints expected
      ON expected.table_name = c.relname
     AND expected.constraint_name = con.conname
    WHERE n.nspname = 'public'
),
target_constraint_names(table_name, constraint_name) AS (
    VALUES
        ('email_connections', 'email_connections_company_id_email_connection_id_key'),
        ('email_connections', 'email_connections_company_id_fkey'),
        ('email_connections', 'email_connections_connected_by_user_id_fkey'),
        ('email_connections', 'email_connections_pkey'),
        ('email_connections', 'email_connections_personal_user_id_fkey'),
        ('email_drafts', 'email_drafts_company_id_fkey'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_company_id_email_connection_id_fkey'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_company_id_email_thread_id_fkey'),
        ('email_ingestion_jobs', 'email_ingestion_jobs_pkey'),
        ('email_threads', 'email_threads_company_id_email_connection_id_fkey'),
        ('pins', 'pins_company_id_user_id_parent_folder_id_fkey')
),
expected_source_defaults(table_name, column_name, default_expression) AS (
    VALUES
        ('email_connections', 'ingestion_started_at', '<none>'),
        ('email_connections', 'last_successful_scan_at', '<none>'),
        ('email_ingestion_jobs', 'priority', '20')
),
actual_source_defaults AS (
    SELECT c.relname::text AS table_name,
           a.attname::text AS column_name,
           COALESCE(pg_get_expr(d.adbin, d.adrelid), '<none>') AS default_expression
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    JOIN expected_source_defaults expected
      ON expected.table_name = c.relname
     AND expected.column_name = a.attname
    WHERE n.nspname = 'public'
      AND a.attnum > 0
      AND NOT a.attisdropped
),
expected_obsolete_indexes(index_name, definition) AS (
    VALUES
        ('idx_logic_gate_textboxes_history_batches', 'CREATE INDEX idx_logic_gate_textboxes_history_batches ON public.logic_gate_textboxes_history USING btree (company_id, logic_gate_id, saved_timestamp DESC, batch_id)'),
        ('idx_node_textboxes_history_batches', 'CREATE INDEX idx_node_textboxes_history_batches ON public.node_textboxes_history USING btree (company_id, node_id, saved_timestamp DESC, batch_id)'),
        ('idx_node_textboxes_node_created', 'CREATE INDEX idx_node_textboxes_node_created ON public.node_textboxes USING btree (company_id, node_id, created_timestamp DESC, textbox_id DESC) WHERE (deleted_timestamp IS NULL)'),
        ('idx_project_textboxes_history_batches', 'CREATE INDEX idx_project_textboxes_history_batches ON public.project_textboxes_history USING btree (company_id, project_id, saved_timestamp DESC, batch_id)')
),
actual_obsolete_indexes AS (
    SELECT indexname::text AS index_name, indexdef::text AS definition
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (SELECT index_name FROM expected_obsolete_indexes)
),
expected_obsolete_functions(function_name, identity_arguments, return_type, language_name) AS (
    VALUES
        ('mangorts_legacy_project_saved_blocks', 'information text', 'jsonb', 'plpgsql'),
        ('mangorts_legacy_saved_editor_body', 'information text', 'jsonb', 'plpgsql'),
        ('v3_migration_try_chat_attachment_ids_v1', 'value jsonb', 'uuid[]', 'plpgsql'),
        ('v3_migration_try_integer_v1', 'value text', 'integer', 'plpgsql'),
        ('v3_migration_try_jsonb_v1', 'value text', 'jsonb', 'plpgsql'),
        ('v3_migration_try_timestamptz_v1', 'value text', 'timestamp with time zone', 'plpgsql'),
        ('v3_migration_try_uuid_array_v1', 'value jsonb', 'uuid[]', 'plpgsql'),
        ('v3_migration_try_uuid_v1', 'value text', 'uuid', 'plpgsql')
),
actual_obsolete_functions AS (
    SELECT p.proname::text AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           p.prorettype::regtype::text AS return_type,
           l.lanname::text AS language_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.proname IN (SELECT function_name FROM expected_obsolete_functions)
),
expected_enum_labels(enum_label) AS (
    VALUES
        ('Text box'),
        ('Checklist'),
        ('Status'),
        ('Due date'),
        ('Employee name'),
        ('PDF'),
        ('PNG'),
        ('MOV'),
        ('Hyperlink'),
        ('Text block chat'),
        ('Attached email'),
        ('Saved version')
),
actual_enum_labels AS (
    SELECT e.enumlabel::text AS enum_label
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
      AND t.typname = 'information_type'
      AND t.typtype = 'e'
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
        'source_constraint_names_and_definitions_are_exact',
        (SELECT count(*) FROM expected_source_constraints) = (SELECT count(*) FROM actual_source_constraints)
            AND NOT EXISTS (
                (SELECT * FROM expected_source_constraints
                 EXCEPT
                 SELECT * FROM actual_source_constraints)
                UNION ALL
                (SELECT * FROM actual_source_constraints
                 EXCEPT
                 SELECT * FROM expected_source_constraints)
            ),
        'expected=10, actual=' || (SELECT count(*) FROM actual_source_constraints)
    UNION ALL
    SELECT
        'target_constraint_names_are_absent',
        NOT EXISTS (
            SELECT 1
            FROM target_constraint_names expected
            JOIN pg_class c ON c.relname = expected.table_name
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            JOIN pg_constraint con
              ON con.conrelid = c.oid
             AND con.conname = expected.constraint_name
        ),
        'existing_target_names=' || (
            SELECT count(*)
            FROM target_constraint_names expected
            JOIN pg_class c ON c.relname = expected.table_name
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            JOIN pg_constraint con
              ON con.conrelid = c.oid
             AND con.conname = expected.constraint_name
        )
    UNION ALL
    SELECT
        'source_defaults_are_exact',
        (SELECT count(*) FROM expected_source_defaults) = (SELECT count(*) FROM actual_source_defaults)
            AND NOT EXISTS (
                (SELECT * FROM expected_source_defaults
                 EXCEPT
                 SELECT * FROM actual_source_defaults)
                UNION ALL
                (SELECT * FROM actual_source_defaults
                 EXCEPT
                 SELECT * FROM expected_source_defaults)
            ),
        'expected=3, actual=' || (SELECT count(*) FROM actual_source_defaults)
    UNION ALL
    SELECT
        'obsolete_indexes_are_exact',
        (SELECT count(*) FROM expected_obsolete_indexes) = (SELECT count(*) FROM actual_obsolete_indexes)
            AND NOT EXISTS (
                (SELECT * FROM expected_obsolete_indexes
                 EXCEPT
                 SELECT * FROM actual_obsolete_indexes)
                UNION ALL
                (SELECT * FROM actual_obsolete_indexes
                 EXCEPT
                 SELECT * FROM expected_obsolete_indexes)
            ),
        'expected=4, actual=' || (SELECT count(*) FROM actual_obsolete_indexes)
    UNION ALL
    SELECT
        'obsolete_functions_are_exact',
        (SELECT count(*) FROM expected_obsolete_functions) = (SELECT count(*) FROM actual_obsolete_functions)
            AND NOT EXISTS (
                (SELECT * FROM expected_obsolete_functions
                 EXCEPT
                 SELECT * FROM actual_obsolete_functions)
                UNION ALL
                (SELECT * FROM actual_obsolete_functions
                 EXCEPT
                 SELECT * FROM expected_obsolete_functions)
            ),
        'expected=8, actual=' || (SELECT count(*) FROM actual_obsolete_functions)
    UNION ALL
    SELECT
        'obsolete_information_type_is_exact',
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typname = 'information_type' AND t.typtype = 'e') = 1
            AND (SELECT count(*) FROM expected_enum_labels) = (SELECT count(*) FROM actual_enum_labels)
            AND NOT EXISTS (
                (SELECT * FROM expected_enum_labels
                 EXCEPT
                 SELECT * FROM actual_enum_labels)
                UNION ALL
                (SELECT * FROM actual_enum_labels
                 EXCEPT
                 SELECT * FROM expected_enum_labels)
            ),
        'expected_labels=12, actual_labels=' || (SELECT count(*) FROM actual_enum_labels)
    UNION ALL
    SELECT
        'attachment_owner_validator_is_exact_source_version',
        (
            SELECT count(*) = 1
               AND bool_and(p.pronargs = 0)
               AND bool_and(l.lanname = 'plpgsql')
               AND bool_and(p.prorettype = 'pg_catalog.trigger'::regtype)
               AND bool_and(md5(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) = '0d8d2edc0cf9bbbcbaec25fe784ab763')
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_language l ON l.oid = p.prolang
            WHERE n.nspname = 'public'
              AND p.proname = 'mangorts_validate_attachment_relationship_owner'
        ),
        'expected_normalized_source_md5=0d8d2edc0cf9bbbcbaec25fe784ab763'
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
        'new_logic_gate_work_triggers_are_absent',
        NOT EXISTS (
            SELECT 1
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND t.tgname IN (
                  'trg_logic_gate_work_version_gvic',
                  'trg_logic_gate_work_version_permissions'
              )
        ),
        'existing_new_trigger_names=' || (
            SELECT count(*)
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND t.tgname IN (
                  'trg_logic_gate_work_version_gvic',
                  'trg_logic_gate_work_version_permissions'
              )
        )
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
        WHEN bool_and(passed) OVER () THEN 'PASS - safe to run scripts/dev_canonical_schema_alignment.sql'
        ELSE 'STOP - do not run the write script'
    END AS overall_status,
    check_name,
    CASE WHEN passed THEN 'PASS' ELSE 'STOP' END AS check_status,
    details
FROM checks
ORDER BY check_name;

ROLLBACK;
