-- ONE-TIME RESET: deletes all saved AI inspection archives in this database.
-- Pause AI Sends; run this entire script, then backend/db/migrations/20260905_ai_runs.sql.
-- Company/user rows and business resources are not deleted.
BEGIN;
SELECT current_database() AS connected_database,
       current_setting('server_version') AS connected_postgresql_version;
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 190000 THEN
    RAISE EXCEPTION 'STOP: AI run inspections require PostgreSQL 17 or 18';
  END IF;
END;
$$;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

DROP TABLE IF EXISTS public."AI_runs";
DROP TABLE IF EXISTS public.ai_runs;

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    DELETE FROM public.schema_migrations
    WHERE version IN ('20260905_ai_runs.sql', '20260905_z_lowercase_ai_runs.sql');
  END IF;
END;
$$;
COMMIT;
