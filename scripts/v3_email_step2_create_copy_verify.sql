\set ON_ERROR_STOP on
-- STEP 2: create/copy/recount/reconcile the retained V3 email data.
--
-- First run scripts/v3_email_step1_count.sql and review READY_TO_COPY.
-- Pause the API, email sync/download/archive workers, webhook consumers, and all
-- other legacy email writers while this file runs. Keep the backend on the old
-- tables after commit; backend cutover is a separate future step.
--
-- Safe failure: one outer transaction rolls back every target-table change.
-- Safe rerun: stable identities are reused and exact source rows are refreshed.
-- This script never updates or deletes a legacy table.

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';

\ir v3_email_expand_component.sql

create temp table v3_current_email_run(run_id uuid primary key) on commit drop;
insert into v3_current_email_run values(gen_random_uuid());
insert into v3_email_migration_runs(run_id,mapping_version,status)
select run_id,1,'running' from v3_current_email_run;

\ir v3_email_copy_classify.sql
\ir v3_email_copy_content.sql
\ir v3_email_copy_dependents.sql
\ir v3_email_copy_attachments.sql
\ir v3_email_copy_reconcile.sql

commit;

