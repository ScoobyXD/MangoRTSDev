-- Human-run table rename; preserves every archived inspection and column.
BEGIN;
SELECT current_setting('server_version') AS connected_postgresql_version;
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

ALTER TABLE public."AI_runs" RENAME TO ai_runs;

COMMIT;
