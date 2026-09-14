-- Human-run PostgreSQL 17+ schema change. Never run automatically at startup.
BEGIN;
DO $$ BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'STOP: CTRL Loop requires PostgreSQL 17 or later';
  END IF;
END $$;

CREATE TABLE ctrl_loop_jobs (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email_connection_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  instructions text NOT NULL CHECK (length(btrim(instructions)) BETWEEN 1 AND 12000),
  time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'Awaiting file' CHECK (status IN ('Awaiting file','Listening','Processing','Error')),
  last_error text NOT NULL DEFAULT '',
  original_attachment_id uuid,
  current_attachment_id uuid,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_updated timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY(company_id,job_id),
  FOREIGN KEY(company_id,user_id) REFERENCES company_memberships(company_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,email_connection_id) REFERENCES email_connections(company_id,email_connection_id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,original_attachment_id) REFERENCES attachments(company_id,attachment_id),
  FOREIGN KEY(company_id,current_attachment_id) REFERENCES attachments(company_id,attachment_id),
  CHECK ((original_attachment_id IS NULL) = (current_attachment_id IS NULL))
);
CREATE INDEX ctrl_loop_jobs_mailbox ON ctrl_loop_jobs(company_id,email_connection_id,activated_at);
CREATE INDEX ctrl_loop_jobs_owner ON ctrl_loop_jobs(company_id,user_id,job_id);

CREATE TABLE ctrl_loop_runs (
  company_id uuid NOT NULL,
  run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  email_connection_id uuid NOT NULL,
  email_thread_id uuid,
  email_message_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','saving','completed','error')),
  last_error text NOT NULL DEFAULT '',
  arrival_at timestamptz NOT NULL,
  source_url text NOT NULL DEFAULT '',
  session_id text NOT NULL DEFAULT '',
  token_hash text NOT NULL DEFAULT '',
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  changed_cells integer NOT NULL DEFAULT 0 CHECK (changed_cells >= 0),
  PRIMARY KEY(company_id,run_id),
  UNIQUE(company_id,email_connection_id,email_message_id),
  FOREIGN KEY(company_id,email_connection_id) REFERENCES email_connections(company_id,email_connection_id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,email_thread_id,email_message_id) REFERENCES email_messages(company_id,email_thread_id,email_message_id) ON DELETE SET NULL (email_thread_id,email_message_id)
);
CREATE UNIQUE INDEX ctrl_loop_run_token ON ctrl_loop_runs(token_hash) WHERE token_hash <> '';
CREATE INDEX ctrl_loop_runs_queue ON ctrl_loop_runs(company_id,status,created_at);

CREATE TABLE ctrl_loop_run_jobs (
  company_id uuid NOT NULL,
  run_id uuid NOT NULL,
  job_id uuid NOT NULL,
  base_attachment_id uuid NOT NULL,
  base_revision bigint NOT NULL,
  targets jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(targets)='array' AND jsonb_array_length(targets)<=500),
  PRIMARY KEY(company_id,run_id,job_id),
  FOREIGN KEY(company_id,run_id) REFERENCES ctrl_loop_runs(company_id,run_id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,job_id) REFERENCES ctrl_loop_jobs(company_id,job_id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,base_attachment_id) REFERENCES attachments(company_id,attachment_id)
);
CREATE INDEX ctrl_loop_run_jobs_job ON ctrl_loop_run_jobs(company_id,job_id,run_id);

CREATE TABLE ctrl_loop_changes (
  change_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  run_id uuid NOT NULL,
  job_id uuid NOT NULL,
  sheet text NOT NULL,
  cell text NOT NULL,
  previous_text text NOT NULL,
  display_text text NOT NULL,
  source_url text NOT NULL,
  arrival_at timestamptz NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  seen boolean NOT NULL DEFAULT false,
  UNIQUE(company_id,run_id,job_id,sheet,cell),
  FOREIGN KEY(company_id,run_id,job_id) REFERENCES ctrl_loop_run_jobs(company_id,run_id,job_id) ON DELETE CASCADE
);
CREATE INDEX ctrl_loop_changes_unseen ON ctrl_loop_changes(company_id,job_id,change_id) WHERE NOT seen;
CREATE INDEX ctrl_loop_changes_history ON ctrl_loop_changes(company_id,job_id,change_id DESC);

-- One current personal mailbox and membership authorize each automation. The
-- relationship grants neither mailbox access nor access to another owner's job.
CREATE FUNCTION mangorts_validate_ctrl_loop_job() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF (TG_OP='INSERT' OR NEW.email_connection_id IS DISTINCT FROM OLD.email_connection_id) AND NOT EXISTS(SELECT 1 FROM email_connections c JOIN users u ON u.user_id=NEW.user_id
    WHERE c.company_id=NEW.company_id AND c.email_connection_id=NEW.email_connection_id
      AND c.connection_type='personal' AND c.personal_user_id=NEW.user_id AND u.mailbox_enabled) THEN
    RAISE EXCEPTION 'CTRL Loop mailbox owner is unavailable' USING ERRCODE='23503';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.company_id<>OLD.company_id OR NEW.job_id<>OLD.job_id OR NEW.user_id<>OLD.user_id
    OR (OLD.original_attachment_id IS NOT NULL AND NEW.original_attachment_id IS DISTINCT FROM OLD.original_attachment_id)) THEN
    RAISE EXCEPTION 'CTRL Loop owner and original workbook are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ctrl_loop_job_owner BEFORE INSERT OR UPDATE ON ctrl_loop_jobs FOR EACH ROW EXECUTE FUNCTION mangorts_validate_ctrl_loop_job();
COMMIT;
