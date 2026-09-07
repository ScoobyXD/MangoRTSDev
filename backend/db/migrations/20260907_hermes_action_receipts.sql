BEGIN;

CREATE TABLE public.ai_chats (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    chat_id text NOT NULL CHECK (btrim(chat_id) <> ''),
    name text NOT NULL DEFAULT '',
    created_timestamp timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, user_id, chat_id),
    FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

CREATE TABLE public.ai_runs (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    run_id uuid NOT NULL,
    hermes_run_id text,
    chat_id text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','stopping','completed','failed','cancelled','interrupted')),
    pending_input text,
    history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array'),
    created_timestamp timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, user_id, run_id),
    FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (company_id, user_id, chat_id) REFERENCES public.ai_chats(company_id, user_id, chat_id),
    CHECK (hermes_run_id IS NULL OR btrim(hermes_run_id) <> '')
);

CREATE UNIQUE INDEX ai_runs_one_active ON public.ai_runs(company_id, user_id) WHERE status IN ('pending','running','stopping');
CREATE UNIQUE INDEX ai_runs_native_id ON public.ai_runs(company_id, user_id, hermes_run_id) WHERE hermes_run_id IS NOT NULL;

CREATE TABLE public.ai_messages (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    message_id bigint NOT NULL CHECK (message_id > 0),
    chat_id text NOT NULL,
    run_id uuid,
    role text NOT NULL CHECK (role IN ('user','ai')),
    content text NOT NULL,
    created_timestamp timestamptz NOT NULL,
    PRIMARY KEY (company_id, user_id, message_id),
    FOREIGN KEY (company_id, user_id, chat_id) REFERENCES public.ai_chats(company_id, user_id, chat_id) ON DELETE CASCADE,
    FOREIGN KEY (company_id, user_id, run_id) REFERENCES public.ai_runs(company_id, user_id, run_id)
);

CREATE INDEX ai_messages_chat_order ON public.ai_messages(company_id, user_id, chat_id, message_id);

-- Historical command results survive business-resource deletion and grant no access.
CREATE TABLE public.ai_actions (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    run_id uuid NOT NULL,
    action_name text NOT NULL CHECK (btrim(action_name) <> ''),
    action_key text NOT NULL CHECK (btrim(action_key) <> ''),
    result jsonb NOT NULL,
    PRIMARY KEY (company_id, user_id, run_id, action_name, action_key),
    FOREIGN KEY (company_id, user_id, run_id) REFERENCES public.ai_runs(company_id, user_id, run_id) ON DELETE CASCADE
);


COMMIT;
