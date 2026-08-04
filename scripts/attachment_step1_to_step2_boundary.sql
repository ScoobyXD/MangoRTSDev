-- Attachment Step 1 -> Step 2 maintenance boundary.
-- DO NOT RUN DURING STEP 1. Run this whole file only after all application and
-- attachment workers are paused and immediately before deploying the Step 2
-- backend. The current legacy backend cannot use upload_job_id.
--
-- Step 2 prerequisite: pause writers, rerun the Step 1 preflight and exact
-- create/copy/reconcile script, complete its guarded cleanup, and rerun the
-- preflight. This file handles only the unavoidable multipart column/FK switch.
--
-- This is the shortest unavoidable contract switch for the one table name that
-- is already permanent: attachment_upload_parts.

begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local idle_in_transaction_session_timeout='3min';

lock table attachment_upload_intents,attachment_upload_jobs,
  attachment_upload_parts in access exclusive mode;

do $$
begin
  if exists(select 1 from attachment_upload_intents
    where status in('pending','uploading','completing','failed')) then
    raise exception 'cannot switch multipart FK while an upload is unfinished';
  end if;
  if (select count(*) from attachment_upload_jobs)
     <>(select count(*) from attachment_upload_intents) then
    raise exception 'upload-job copy is not reconciled';
  end if;
  if exists(
    select 1
    from attachment_upload_jobs job
    full join attachment_upload_intents intent
      on intent.upload_intent_id=job.upload_job_id
    where intent.upload_intent_id is null or job.upload_job_id is null
  ) then
    raise exception 'upload-job identity set is not reconciled';
  end if;
  if exists(
    select 1 from attachment_upload_parts part
    where not exists(select 1 from attachment_upload_jobs job
      where job.upload_job_id=coalesce(
        case when pg_input_is_valid(to_jsonb(part)->>'upload_job_id','uuid')
          then (to_jsonb(part)->>'upload_job_id')::uuid end,
        case when pg_input_is_valid(to_jsonb(part)->>'upload_intent_id','uuid')
          then (to_jsonb(part)->>'upload_intent_id')::uuid end
      ))
  ) then
    raise exception 'multipart part has no exact upload job';
  end if;
end $$;

do $$
declare legacy_column boolean;
declare final_column boolean;
declare legacy_fk text;
begin
  select exists(select 1 from information_schema.columns
    where table_schema=current_schema()
      and table_name='attachment_upload_parts'
      and column_name='upload_intent_id') into legacy_column;
  select exists(select 1 from information_schema.columns
    where table_schema=current_schema()
      and table_name='attachment_upload_parts'
      and column_name='upload_job_id') into final_column;

  if legacy_column and not final_column then
    select conname into legacy_fk
    from pg_constraint
    where conrelid='attachment_upload_parts'::regclass
      and contype='f'
      and pg_get_constraintdef(oid) like
        '%(upload_intent_id) REFERENCES attachment_upload_intents(upload_intent_id)%';
    if legacy_fk is null then
      raise exception 'legacy multipart foreign key is missing or drifted';
    end if;
    execute format('alter table attachment_upload_parts drop constraint %I',legacy_fk);
    alter table attachment_upload_parts rename column upload_intent_id to upload_job_id;
    alter table attachment_upload_parts
      add constraint attachment_upload_parts_upload_job_id_fkey
      foreign key(upload_job_id) references attachment_upload_jobs(upload_job_id)
      on delete cascade;
  elsif final_column and not legacy_column then
    if not exists(select 1 from pg_constraint
      where conrelid='attachment_upload_parts'::regclass
        and contype='f'
        and pg_get_constraintdef(oid) like
          '%(upload_job_id) REFERENCES attachment_upload_jobs(upload_job_id)%')
    then
      raise exception 'final multipart foreign key is missing or drifted';
    end if;
  else
    raise exception 'multipart columns are ambiguous: legacy %, final %',
      legacy_column,final_column;
  end if;
end $$;

select 'READY_FOR_IMMEDIATE_STEP2_BACKEND_DEPLOY' status,
       count(*) multipart_parts
from attachment_upload_parts;

commit;