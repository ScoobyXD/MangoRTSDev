-- One-time, transactional alignment of Mango's development database to
-- backend/db/schema.sql. Run only after the read-only preflight reports PASS.
-- This script intentionally has no compatibility path and uses no DROP ... CASCADE.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '2min';
SET LOCAL search_path = public, pg_catalog;

DO $guard$
BEGIN
    IF current_database() <> 'MiraeRTSDevDatabase' THEN
        RAISE EXCEPTION 'STOP: connected database is %, expected MiraeRTSDevDatabase', current_database();
    END IF;

    IF current_setting('server_version_num')::integer < 170000
       OR current_setting('server_version_num')::integer >= 180000 THEN
        RAISE EXCEPTION 'STOP: PostgreSQL % is unsupported; expected PostgreSQL 17.x', current_setting('server_version');
    END IF;

    IF current_setting('transaction_read_only') = 'on' THEN
        RAISE EXCEPTION 'STOP: the alignment requires the approved development writer connection';
    END IF;
END
$guard$;

-- Take every table lock up front. If normal development traffic prevents these
-- locks within five seconds, the transaction stops before changing the schema.
LOCK TABLE public.companies IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE
    public.attachment_relationships,
    public.email_connections,
    public.email_drafts,
    public.email_ingestion_jobs,
    public.email_threads,
    public.logic_gate_textboxes_history,
    public.node_textboxes,
    public.node_textboxes_history,
    public.pins,
    public.project_textboxes_history,
    public.resource_gvic_assignments,
    public.resource_permissions
IN ACCESS EXCLUSIVE MODE;

DO $guard$
DECLARE
    table_check record;
    mismatch boolean;
BEGIN
    -- Exact unordered column-set checks. Physical column order is irrelevant.
    FOR table_check IN
        SELECT *
        FROM (VALUES
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
        ) AS expected(table_name, column_names)
    LOOP
        SELECT
            count(*) <> cardinality(table_check.column_names)
            OR EXISTS (
                (SELECT unnest(table_check.column_names)
                 EXCEPT
                 SELECT a.attname::text
                 FROM pg_attribute a
                 JOIN pg_class c ON c.oid = a.attrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public'
                   AND c.relname = table_check.table_name
                   AND c.relkind IN ('r', 'p')
                   AND a.attnum > 0
                   AND NOT a.attisdropped)
                UNION ALL
                (SELECT a.attname::text
                 FROM pg_attribute a
                 JOIN pg_class c ON c.oid = a.attrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public'
                   AND c.relname = table_check.table_name
                   AND c.relkind IN ('r', 'p')
                   AND a.attnum > 0
                   AND NOT a.attisdropped
                 EXCEPT
                 SELECT unnest(table_check.column_names))
            )
        INTO mismatch
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = table_check.table_name
          AND c.relkind IN ('r', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped;

        IF mismatch THEN
            RAISE EXCEPTION 'STOP: %.% does not have the exact expected unordered column set', 'public', table_check.table_name;
        END IF;
    END LOOP;

    WITH expected(table_name, constraint_name, definition) AS (
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
    actual AS (
        SELECT c.relname::text AS table_name,
               con.conname::text AS constraint_name,
               pg_get_constraintdef(con.oid, false) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND (c.relname, con.conname) IN (
              SELECT table_name, constraint_name FROM expected
          )
    )
    SELECT count(*) <> 10
        OR EXISTS (
            (SELECT * FROM expected EXCEPT SELECT * FROM actual)
            UNION ALL
            (SELECT * FROM actual EXCEPT SELECT * FROM expected)
        )
    INTO mismatch
    FROM actual;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: source constraint names or definitions are not exact';
    END IF;

    WITH target_names(table_name, constraint_name) AS (
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
    )
    SELECT EXISTS (
        SELECT 1
        FROM target_names expected
        JOIN pg_class c ON c.relname = expected.table_name
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_constraint con
          ON con.conrelid = c.oid
         AND con.conname = expected.constraint_name
    )
    INTO mismatch;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: one or more target constraints already exist';
    END IF;

    WITH expected(table_name, column_name, default_expression) AS (
        VALUES
            ('email_connections', 'ingestion_started_at', '<none>'),
            ('email_connections', 'last_successful_scan_at', '<none>'),
            ('email_ingestion_jobs', 'priority', '20')
    ),
    actual AS (
        SELECT c.relname::text AS table_name,
               a.attname::text AS column_name,
               COALESCE(pg_get_expr(d.adbin, d.adrelid), '<none>') AS default_expression
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = 'public'
          AND (c.relname, a.attname) IN (
              SELECT table_name, column_name FROM expected
          )
    )
    SELECT count(*) <> 3
        OR EXISTS (
            (SELECT * FROM expected EXCEPT SELECT * FROM actual)
            UNION ALL
            (SELECT * FROM actual EXCEPT SELECT * FROM expected)
        )
    INTO mismatch
    FROM actual;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: source column defaults are not exact';
    END IF;

    WITH expected(index_name, definition) AS (
        VALUES
            ('idx_logic_gate_textboxes_history_batches', 'CREATE INDEX idx_logic_gate_textboxes_history_batches ON public.logic_gate_textboxes_history USING btree (company_id, logic_gate_id, saved_timestamp DESC, batch_id)'),
            ('idx_node_textboxes_history_batches', 'CREATE INDEX idx_node_textboxes_history_batches ON public.node_textboxes_history USING btree (company_id, node_id, saved_timestamp DESC, batch_id)'),
            ('idx_node_textboxes_node_created', 'CREATE INDEX idx_node_textboxes_node_created ON public.node_textboxes USING btree (company_id, node_id, created_timestamp DESC, textbox_id DESC) WHERE (deleted_timestamp IS NULL)'),
            ('idx_project_textboxes_history_batches', 'CREATE INDEX idx_project_textboxes_history_batches ON public.project_textboxes_history USING btree (company_id, project_id, saved_timestamp DESC, batch_id)')
    ),
    actual AS (
        SELECT indexname::text AS index_name, indexdef::text AS definition
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (SELECT index_name FROM expected)
    )
    SELECT count(*) <> 4
        OR EXISTS (
            (SELECT * FROM expected EXCEPT SELECT * FROM actual)
            UNION ALL
            (SELECT * FROM actual EXCEPT SELECT * FROM expected)
        )
    INTO mismatch
    FROM actual;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: obsolete indexes are not in the exact expected state';
    END IF;

    WITH expected(function_name, identity_arguments, return_type, language_name) AS (
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
    actual AS (
        SELECT p.proname::text AS function_name,
               pg_get_function_identity_arguments(p.oid) AS identity_arguments,
               p.prorettype::regtype::text AS return_type,
               l.lanname::text AS language_name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public'
          AND p.proname IN (SELECT function_name FROM expected)
    )
    SELECT count(*) <> 8
        OR EXISTS (
            (SELECT * FROM expected EXCEPT SELECT * FROM actual)
            UNION ALL
            (SELECT * FROM actual EXCEPT SELECT * FROM expected)
        )
    INTO mismatch
    FROM actual;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: obsolete functions are not in the exact expected state';
    END IF;

    WITH expected(enum_label) AS (
        VALUES
            ('Text box'), ('Checklist'), ('Status'), ('Due date'),
            ('Employee name'), ('PDF'), ('PNG'), ('MOV'), ('Hyperlink'),
            ('Text block chat'), ('Attached email'), ('Saved version')
    ),
    actual AS (
        SELECT e.enumlabel::text AS enum_label
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'public'
          AND t.typname = 'information_type'
          AND t.typtype = 'e'
    )
    SELECT
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typname = 'information_type' AND t.typtype = 'e') <> 1
        OR count(*) <> 12
        OR EXISTS (
            (SELECT * FROM expected EXCEPT SELECT * FROM actual)
            UNION ALL
            (SELECT * FROM actual EXCEPT SELECT * FROM expected)
        )
    INTO mismatch
    FROM actual;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: obsolete information_type is not in the exact expected state';
    END IF;

    SELECT NOT (
        count(*) = 1
        AND bool_and(p.pronargs = 0)
        AND bool_and(l.lanname = 'plpgsql')
        AND bool_and(p.prorettype = 'pg_catalog.trigger'::regtype)
        AND bool_and(md5(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) = '0d8d2edc0cf9bbbcbaec25fe784ab763')
    )
    INTO mismatch
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.proname = 'mangorts_validate_attachment_relationship_owner';
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: attachment owner validator is not the exact source version';
    END IF;

    SELECT NOT (
        count(*) = 1
        AND bool_and(p.pronargs = 0)
        AND bool_and(l.lanname = 'plpgsql')
        AND bool_and(p.prorettype = 'pg_catalog.trigger'::regtype)
        AND bool_and(md5(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) = 'e5351d94a113d3dfea053f9c892dd3cd')
    )
    INTO mismatch
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.proname = 'mangorts_trg_bump_logic_gate_work_from_resource';
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: Logic Gate work invalidation function is not exact';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND t.tgname IN (
              'trg_logic_gate_work_version_gvic',
              'trg_logic_gate_work_version_permissions'
          )
    )
    INTO mismatch;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: one or more target Logic Gate work triggers already exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.email_drafts draft
        LEFT JOIN public.companies company ON company.company_id = draft.company_id
        WHERE company.company_id IS NULL
    ) THEN
        RAISE EXCEPTION 'STOP: email_drafts contains a company_id without a matching companies row';
    END IF;
END
$guard$;

ALTER TABLE public.email_connections
    RENAME CONSTRAINT company_email_connections_company_id_company_email_connecti_key
    TO email_connections_company_id_email_connection_id_key;
ALTER TABLE public.email_connections
    RENAME CONSTRAINT company_email_connections_company_id_fkey
    TO email_connections_company_id_fkey;
ALTER TABLE public.email_connections
    RENAME CONSTRAINT company_email_connections_connected_by_user_id_fkey
    TO email_connections_connected_by_user_id_fkey;
ALTER TABLE public.email_connections
    RENAME CONSTRAINT company_email_connections_pkey
    TO email_connections_pkey;
ALTER TABLE public.email_connections
    RENAME CONSTRAINT email_connections_personal_user_fkey
    TO email_connections_personal_user_id_fkey;

ALTER TABLE public.email_ingestion_jobs
    RENAME CONSTRAINT email_ingestion_jobs_connection_fkey
    TO email_ingestion_jobs_company_id_email_connection_id_fkey;
ALTER TABLE public.email_ingestion_jobs
    RENAME CONSTRAINT email_ingestion_jobs_thread_fkey
    TO email_ingestion_jobs_company_id_email_thread_id_fkey;
ALTER TABLE public.email_ingestion_jobs
    RENAME CONSTRAINT email_thread_download_jobs_pkey
    TO email_ingestion_jobs_pkey;

ALTER TABLE public.email_threads
    RENAME CONSTRAINT email_threads_email_connection_fkey
    TO email_threads_company_id_email_connection_id_fkey;
ALTER TABLE public.pins
    RENAME CONSTRAINT pins_parent_folder_fk
    TO pins_company_id_user_id_parent_folder_id_fkey;

ALTER TABLE public.email_connections
    ALTER COLUMN ingestion_started_at SET DEFAULT now(),
    ALTER COLUMN last_successful_scan_at SET DEFAULT now();
ALTER TABLE public.email_ingestion_jobs
    ALTER COLUMN priority SET DEFAULT 30;

ALTER TABLE public.email_drafts
    ADD CONSTRAINT email_drafts_company_id_fkey
    FOREIGN KEY (company_id)
    REFERENCES public.companies(company_id)
    ON DELETE CASCADE;

DROP INDEX public.idx_logic_gate_textboxes_history_batches;
DROP INDEX public.idx_node_textboxes_history_batches;
DROP INDEX public.idx_node_textboxes_node_created;
DROP INDEX public.idx_project_textboxes_history_batches;

DROP FUNCTION public.mangorts_legacy_project_saved_blocks(text);
DROP FUNCTION public.mangorts_legacy_saved_editor_body(text);
DROP FUNCTION public.v3_migration_try_chat_attachment_ids_v1(jsonb);
DROP FUNCTION public.v3_migration_try_integer_v1(text);
DROP FUNCTION public.v3_migration_try_jsonb_v1(text);
DROP FUNCTION public.v3_migration_try_timestamptz_v1(text);
DROP FUNCTION public.v3_migration_try_uuid_array_v1(jsonb);
DROP FUNCTION public.v3_migration_try_uuid_v1(text);

DROP TYPE public.information_type;

CREATE OR REPLACE FUNCTION public.mangorts_validate_attachment_relationship_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if new.deleted_timestamp is not null then
    return new;
  end if;

  perform 1
  from attachments attachment
  where attachment.company_id=new.company_id
    and attachment.attachment_id=new.attachment_id
    and attachment.deleted_timestamp is null
  for update;
  if not found then
    raise exception 'attachment is missing or pending deletion' using errcode='23503';
  end if;

  if new.resource_type='node' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from nodes where company_id=new.company_id
                     and node_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Node owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='logic_gate' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from logic_gates where company_id=new.company_id
                     and logic_gate_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Logic Gate owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='project' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from projects where company_id=new.company_id
                     and project_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Project owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='node_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from node_textbox_chats where company_id=new.company_id
                     and chat_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end and deleted_timestamp is null) then
      raise exception 'attachment Node chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='project_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from project_textbox_chats
                     where company_id=new.company_id
                       and chat_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end
                       and deleted_timestamp is null) then
      raise exception 'attachment Project chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from email_messages where company_id=new.company_id
                     and email_message_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment email message owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_draft' then
    if not exists(select 1 from email_drafts where company_id=new.company_id
                  and draft_id=new.resource_id and deleted_timestamp is null) then
      raise exception 'attachment email draft owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_signature' then
    if not exists(select 1 from email_signatures where company_id=new.company_id
                  and signature_id=new.resource_id) then
      raise exception 'attachment email signature owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='shared_inbox' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from shared_inboxes where company_id=new.company_id
                     and shared_inbox_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment shared inbox owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='company_explorer_folder' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from company_explorer_folders where company_id=new.company_id
                     and folder_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment company folder owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='shared_inbox_folder' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from shared_inbox_folders where company_id=new.company_id
                     and folder_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment shared inbox folder owner does not exist' using errcode='23503';
    end if;
  else
    raise exception 'unsupported attachment owner type' using errcode='23514';
  end if;
  return new;
end;
$function$;

CREATE TRIGGER trg_logic_gate_work_version_gvic
AFTER INSERT OR DELETE OR UPDATE ON public.resource_gvic_assignments
FOR EACH ROW
EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_resource();

CREATE TRIGGER trg_logic_gate_work_version_permissions
AFTER INSERT OR DELETE OR UPDATE ON public.resource_permissions
FOR EACH ROW
EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_resource();

DO $guard$
DECLARE
    table_check record;
    mismatch boolean;
BEGIN
    FOR table_check IN
        SELECT *
        FROM (VALUES
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
        ) AS expected(table_name, column_names)
    LOOP
        SELECT
            count(*) <> cardinality(table_check.column_names)
            OR EXISTS (
                (SELECT unnest(table_check.column_names)
                 EXCEPT
                 SELECT a.attname::text
                 FROM pg_attribute a
                 JOIN pg_class c ON c.oid = a.attrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public'
                   AND c.relname = table_check.table_name
                   AND c.relkind IN ('r', 'p')
                   AND a.attnum > 0
                   AND NOT a.attisdropped)
                UNION ALL
                (SELECT a.attname::text
                 FROM pg_attribute a
                 JOIN pg_class c ON c.oid = a.attrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public'
                   AND c.relname = table_check.table_name
                   AND c.relkind IN ('r', 'p')
                   AND a.attnum > 0
                   AND NOT a.attisdropped
                 EXCEPT
                 SELECT unnest(table_check.column_names))
            )
        INTO mismatch
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = table_check.table_name
          AND c.relkind IN ('r', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped;

        IF mismatch THEN
            RAISE EXCEPTION 'STOP: post-state column set mismatch on public.%', table_check.table_name;
        END IF;
    END LOOP;

    WITH expected(table_name, constraint_name, definition) AS (
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
    actual AS (
        SELECT c.relname::text AS table_name,
               con.conname::text AS constraint_name,
               pg_get_constraintdef(con.oid, false) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND (c.relname, con.conname) IN (
              SELECT table_name, constraint_name FROM expected
          )
    )
    SELECT count(*) <> 11
        OR EXISTS (
            (SELECT * FROM expected EXCEPT SELECT * FROM actual)
            UNION ALL
            (SELECT * FROM actual EXCEPT SELECT * FROM expected)
        )
    INTO mismatch
    FROM actual;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: post-state target constraints are not exact';
    END IF;

    WITH source_names(table_name, constraint_name) AS (
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
    )
    SELECT EXISTS (
        SELECT 1
        FROM source_names expected
        JOIN pg_class c ON c.relname = expected.table_name
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_constraint con
          ON con.conrelid = c.oid
         AND con.conname = expected.constraint_name
    )
    INTO mismatch;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: a source constraint name survived the alignment';
    END IF;

    WITH expected(table_name, column_name, default_expression) AS (
        VALUES
            ('email_connections', 'ingestion_started_at', 'now()'),
            ('email_connections', 'last_successful_scan_at', 'now()'),
            ('email_ingestion_jobs', 'priority', '30')
    ),
    actual AS (
        SELECT c.relname::text AS table_name,
               a.attname::text AS column_name,
               COALESCE(pg_get_expr(d.adbin, d.adrelid), '<none>') AS default_expression
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = 'public'
          AND (c.relname, a.attname) IN (
              SELECT table_name, column_name FROM expected
          )
    )
    SELECT count(*) <> 3
        OR EXISTS (
            (SELECT * FROM expected EXCEPT SELECT * FROM actual)
            UNION ALL
            (SELECT * FROM actual EXCEPT SELECT * FROM expected)
        )
    INTO mismatch
    FROM actual;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: post-state column defaults are not exact';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
              'idx_logic_gate_textboxes_history_batches',
              'idx_node_textboxes_history_batches',
              'idx_node_textboxes_node_created',
              'idx_project_textboxes_history_batches'
          )
    ) THEN
        RAISE EXCEPTION 'STOP: an obsolete index survived the alignment';
    END IF;

    IF EXISTS (
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
    ) THEN
        RAISE EXCEPTION 'STOP: an obsolete function survived the alignment';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'information_type'
    ) THEN
        RAISE EXCEPTION 'STOP: obsolete information_type survived the alignment';
    END IF;

    SELECT NOT (
        count(*) = 1
        AND bool_and(p.pronargs = 0)
        AND bool_and(l.lanname = 'plpgsql')
        AND bool_and(p.prorettype = 'pg_catalog.trigger'::regtype)
        AND bool_and(md5(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) = 'e9786efc17d2752a5b97e91513797a21')
    )
    INTO mismatch
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.proname = 'mangorts_validate_attachment_relationship_owner';
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: post-state attachment owner validator is not exact';
    END IF;

    WITH expected(table_name, trigger_name) AS (
        VALUES
            ('resource_gvic_assignments', 'trg_logic_gate_work_version_gvic'),
            ('resource_permissions', 'trg_logic_gate_work_version_permissions')
    ),
    actual AS (
        SELECT c.relname::text AS table_name, t.tgname::text AS trigger_name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        JOIN pg_namespace pn ON pn.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (c.relname, t.tgname) IN (
              SELECT table_name, trigger_name FROM expected
          )
          AND NOT t.tgisinternal
          AND t.tgtype = 29
          AND t.tgenabled = 'O'
          AND t.tgnargs = 0
          AND pn.nspname = 'public'
          AND p.proname = 'mangorts_trg_bump_logic_gate_work_from_resource'
          AND p.pronargs = 0
    )
    SELECT count(*) <> 2
        OR EXISTS (
            (SELECT * FROM expected EXCEPT SELECT * FROM actual)
            UNION ALL
            (SELECT * FROM actual EXCEPT SELECT * FROM expected)
        )
    INTO mismatch
    FROM actual;
    IF mismatch THEN
        RAISE EXCEPTION 'STOP: post-state Logic Gate work triggers are not exact';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.email_drafts draft
        LEFT JOIN public.companies company ON company.company_id = draft.company_id
        WHERE company.company_id IS NULL
    ) THEN
        RAISE EXCEPTION 'STOP: post-state email draft company relationship is invalid';
    END IF;

    RAISE NOTICE 'PASS: Mango development schema alignment post-state is exact';
END
$guard$;

COMMIT;
