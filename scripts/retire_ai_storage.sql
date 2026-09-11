-- Human-run, one-time cleanup. Run the whole script in DBeaver after deploying
-- the app version with AI removed. Permanently deletes all data in these four
-- AI tables and only the named migration record. On error, run ROLLBACK.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT current_database() AS database_name,
       current_setting('server_version') AS server_version,
       current_setting('server_version_num')::integer AS server_version_num,
       CASE
         WHEN current_setting('server_version_num')::integer >= 170000
          AND current_setting('server_version_num')::integer < 190000
         THEN 'READY'
         ELSE 'STOP: requires PostgreSQL 17 or 18'
       END AS preflight_status;

DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 190000 THEN
    RAISE EXCEPTION 'STOP: requires PostgreSQL 17 or 18';
  END IF;

  IF NOT pg_try_advisory_xact_lock(4855156563379734401::bigint) THEN
    RAISE EXCEPTION 'STOP: another migration is running; retry after it finishes';
  END IF;

  -- RESTRICT stops cleanup if other database objects depend on these tables.
  DROP TABLE IF EXISTS public.ai_actions RESTRICT;
  DROP TABLE IF EXISTS public.ai_messages RESTRICT;
  DROP TABLE IF EXISTS public.ai_runs RESTRICT;
  DROP TABLE IF EXISTS public.ai_chats RESTRICT;

  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    DELETE FROM public.schema_migrations
    WHERE version = '20260907_hermes_action_receipts.sql';
  END IF;
END;
$$;

COMMIT;
