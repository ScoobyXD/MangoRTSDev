-- Human-run, PostgreSQL 17+; never applied by app startup.
BEGIN;
SELECT current_setting('server_version') AS server_version,
CASE WHEN current_setting('server_version_num')::integer BETWEEN 170000 AND 189999 THEN 'READY' ELSE 'STOP' END AS preflight_status;
DO $$ BEGIN
 IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 189999 THEN
  RAISE EXCEPTION 'STOP: PostgreSQL 17 or 18 required';
 END IF;
END $$;
-- Managed OpenAI sessions: exact provider IDs and owner-local execution receipts.
CREATE TABLE public.ai_agent_sessions (
    session_id text PRIMARY KEY,
    company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    prompt text NOT NULL,
    instructions text NOT NULL DEFAULT '',
    skills jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(skills) = 'array'),
    stopped boolean NOT NULL DEFAULT false,
    awaiting_turn_after text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_agent_sessions_owner_idx ON public.ai_agent_sessions(company_id,user_id,created_at DESC);
CREATE TABLE public.ai_agent_tool_calls (
    session_id text NOT NULL REFERENCES public.ai_agent_sessions(session_id) ON DELETE CASCADE,
    turn_id text NOT NULL,
    call_id text NOT NULL,
    name text NOT NULL,
    arguments jsonb NOT NULL CHECK (jsonb_typeof(arguments) = 'object'),
    consequential boolean NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','executing','completed','failed','rejected')),
    output jsonb,
    error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(session_id,turn_id,call_id)
);
COMMIT;
