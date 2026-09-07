BEGIN;

CREATE TABLE public.ai_runs (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_id text NOT NULL,
    conversation_id text NOT NULL,
    message text NOT NULL DEFAULT '',
    payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
    run_id text NOT NULL DEFAULT '',
    cancelled boolean NOT NULL DEFAULT false,
    settled boolean NOT NULL DEFAULT false,
    created_timestamp timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, user_id, request_id),
    FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX ai_runs_one_active ON public.ai_runs(company_id, user_id) WHERE NOT settled;
CREATE UNIQUE INDEX ai_runs_native_id ON public.ai_runs(company_id, user_id, run_id) WHERE run_id <> '';

-- A receipt records a committed command, not a live resource relationship.
-- All AI mutations share this table; retain outcomes after resource deletion.
CREATE TABLE public.ai_actions (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_id text NOT NULL,
    action_name text NOT NULL,
    action_key text NOT NULL,
    outcome jsonb NOT NULL,
    PRIMARY KEY (company_id, user_id, request_id, action_name, action_key),
    FOREIGN KEY (company_id, user_id, request_id) REFERENCES public.ai_runs(company_id, user_id, request_id) ON DELETE CASCADE
);

COMMIT;
