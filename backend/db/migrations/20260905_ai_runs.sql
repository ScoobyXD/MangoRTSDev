-- Human-run forward migration; plain PostgreSQL SQL suitable for DBeaver.
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

CREATE TABLE public."AI_runs" (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    "AI_runs_id" uuid NOT NULL,
    start_time timestamp with time zone NOT NULL,
    finish_time timestamp with time zone NOT NULL,
    inspection_json jsonb NOT NULL,
    CONSTRAINT "AI_runs_pkey" PRIMARY KEY (company_id, user_id, "AI_runs_id"),
    CONSTRAINT "AI_runs_company_fkey" FOREIGN KEY (company_id)
      REFERENCES public.companies(company_id) ON DELETE CASCADE,
    CONSTRAINT "AI_runs_user_fkey" FOREIGN KEY (user_id)
      REFERENCES public.users(user_id) ON DELETE CASCADE,
    CONSTRAINT "AI_runs_time_chk" CHECK (finish_time >= start_time),
    CONSTRAINT "AI_runs_inspection_chk" CHECK (jsonb_typeof(inspection_json) = 'array')
);
COMMIT;
