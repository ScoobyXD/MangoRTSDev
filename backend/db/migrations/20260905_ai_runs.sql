-- Single AI inspection creation migration; plain PostgreSQL SQL for DBeaver.
-- Existing installations: run scripts/reset_ai_run_inspections.sql first.
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

CREATE TABLE public.ai_runs (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    ai_runs_id uuid NOT NULL,
    inspection_json jsonb NOT NULL,
    start_time timestamp with time zone NOT NULL,
    finish_time timestamp with time zone NOT NULL,
    CONSTRAINT ai_runs_pkey PRIMARY KEY (company_id, user_id, ai_runs_id),
    CONSTRAINT ai_runs_company_fkey FOREIGN KEY (company_id)
      REFERENCES public.companies(company_id) ON DELETE CASCADE,
    CONSTRAINT ai_runs_user_fkey FOREIGN KEY (user_id)
      REFERENCES public.users(user_id) ON DELETE CASCADE,
    CONSTRAINT ai_runs_time_chk CHECK (finish_time >= start_time),
    CONSTRAINT ai_runs_inspection_chk CHECK (jsonb_typeof(inspection_json) = 'array')
);

-- Keep direct DBeaver execution recorded for the normal deployment runner.
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    INSERT INTO public.schema_migrations(version) VALUES ('20260905_ai_runs.sql')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END;
$$;
COMMIT;
