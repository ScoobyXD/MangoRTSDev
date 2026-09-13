-- Read-only, plain PostgreSQL SQL; paste directly into DBeaver.
-- Run before the two human-controlled CTRL Loop migrations.
SELECT current_database() AS database_name,
       current_setting('server_version') AS server_version,
       current_setting('server_version_num')::integer AS server_version_num,
       CASE
         WHEN current_setting('server_version_num')::integer < 170000
           OR current_setting('server_version_num')::integer >= 190000
           THEN 'STOP: this rollout supports PostgreSQL 17 and 18 only'
         WHEN to_regclass('public.email_connections') IS NULL
           OR to_regclass('public.email_messages') IS NULL
           OR to_regclass('public.attachments') IS NULL
           OR to_regclass('public.attachment_relationships') IS NULL
           OR to_regclass('public.company_memberships') IS NULL
           THEN 'STOP: apply the existing canonical mailbox/attachment schema first'
         WHEN to_regclass('public.ctrl_loop_jobs') IS NOT NULL
           THEN 'STOP: CTRL Loop already exists; inspect the migration ledger before applying again'
         ELSE 'READY: review and apply 20260913_ctrl_loop.sql, then 20260913_z_ctrl_loop_attachments.sql'
       END AS rollout_status;
