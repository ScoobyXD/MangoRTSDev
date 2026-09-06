BEGIN;

-- Existing accounts keep their mailbox access; new accounts start without it.
ALTER TABLE public.users ADD COLUMN mailbox_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.users ALTER COLUMN mailbox_enabled SET DEFAULT false;

COMMIT;
