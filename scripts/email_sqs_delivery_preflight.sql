-- Read-only DEV preflight. Stop/drain old API and email writers first. Run this
-- complete file in DBeaver before the separately reviewed apply transaction.

select current_setting('server_version') as connected_server_version,
  current_setting('server_version_num')::integer as connected_server_version_num,
  case when current_setting('server_version_num')::integer >= 170000
         and current_setting('server_version_num')::integer < 180000
    then 'READY: PostgreSQL 17.x is supported'
    else 'STOP: this script supports PostgreSQL 17.x only'
  end as version_decision;

select case
  when to_regclass('public.email_connections') is null then 'STOP: email_connections is missing'
  when to_regclass('public.email_ingestion_jobs') is null then 'STOP: email_ingestion_jobs is missing'
  when to_regclass('public.communications_email_archive_job_items') is null then 'STOP: communications_email_archive_job_items is missing'
  else 'READY: required V3 email tables exist'
end as table_decision;

select 'email_connections' as table_name, actual_count, approved_count,
  case when actual_count=13 and approved_count=13
    then 'READY: exact approved 13-column shape'
    else 'STOP: expected exact approved 13-column shape'
  end as shape_decision
from (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'email_connection_id','company_id','connection_type','personal_user_id','provider','account_email',
      'grant_id','status','connected_by_user_id','ingestion_started_at','last_successful_scan_at',
      'created_timestamp','updated_timestamp'
    ]::text[])) as approved_count
  from information_schema.columns
  where table_schema='public' and table_name='email_connections'
) shape
union all
select 'email_ingestion_jobs', actual_count, greatest(legacy_count,final_count),
  case when actual_count=16 and legacy_count=16 then 'READY: exact approved legacy 16-column shape'
       when actual_count=19 and final_count=19 then 'READY: exact approved final 19-column shape'
       else 'STOP: expected exact approved legacy 16 or final 19-column shape'
  end
from (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','last_error','available_at',
      'processing_started_at','completed_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as legacy_count,
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','provider_attempt_count','attempt_token',
      'enqueue_source_id','last_error','available_at','processing_started_at','completed_timestamp',
      'failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as final_count
  from information_schema.columns
  where table_schema='public' and table_name='email_ingestion_jobs'
) shape
union all
select 'communications_email_archive_job_items', actual_count, greatest(legacy_count,final_count),
  case when actual_count=12 and legacy_count=12 then 'READY: exact approved legacy 12-column shape'
       when actual_count=13 and final_count=13 then 'READY: exact approved final 13-column shape'
       else 'STOP: expected exact approved legacy 12 or final 13-column shape'
  end
from (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','last_error','available_at',
      'processing_started_at','archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as legacy_count,
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','attempt_token','last_error',
      'available_at','processing_started_at','archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as final_count
  from information_schema.columns
  where table_schema='public' and table_name='communications_email_archive_job_items'
) shape;

with connection_shape as (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'email_connection_id','company_id','connection_type','personal_user_id','provider','account_email',
      'grant_id','status','connected_by_user_id','ingestion_started_at','last_successful_scan_at',
      'created_timestamp','updated_timestamp'
    ]::text[])) as approved_count
  from information_schema.columns
  where table_schema='public' and table_name='email_connections'
), ingestion_shape as (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','last_error','available_at',
      'processing_started_at','completed_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as legacy_count,
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','provider_attempt_count','attempt_token',
      'enqueue_source_id','last_error','available_at','processing_started_at','completed_timestamp',
      'failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as final_count
  from information_schema.columns
  where table_schema='public' and table_name='email_ingestion_jobs'
), archive_shape as (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','last_error','available_at',
      'processing_started_at','archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as legacy_count,
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','attempt_token','last_error',
      'available_at','processing_started_at','archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as final_count
  from information_schema.columns
  where table_schema='public' and table_name='communications_email_archive_job_items'
)
select case
  when connection_shape.actual_count=13 and connection_shape.approved_count=13
   and ingestion_shape.actual_count=16 and ingestion_shape.legacy_count=16
   and archive_shape.actual_count=12 and archive_shape.legacy_count=12
    then 'READY: all three email SQS tables are in the coherent legacy shape'
  when connection_shape.actual_count=13 and connection_shape.approved_count=13
   and ingestion_shape.actual_count=19 and ingestion_shape.final_count=19
   and archive_shape.actual_count=13 and archive_shape.final_count=13
    then 'READY: all three email SQS tables are in the coherent final shape'
  else 'STOP: email SQS tables must be coherently all-legacy or all-final'
end as coherent_shape_decision
from connection_shape, ingestion_shape, archive_shape;

select count(*) as duplicate_stable_identity_groups,
  case when count(*)=0 then 'READY: stable ingestion identities are unique'
       else 'STOP: duplicate ingestion identities require deliberate review'
  end as identity_decision
from (
  select company_id,email_connection_id,provider_message_id
  from email_ingestion_jobs
  group by company_id,email_connection_id,provider_message_id
  having count(*) > 1
) duplicates;

select count(*) filter (where status in ('pending','retry','processing')) as legacy_active_ingestion_jobs,
  case when count(*) filter (where status in ('pending','retry','processing'))=0
    then 'READY: no legacy database-delivered ingestion job remains active'
    else 'STOP: legacy ingestion jobs must finish or receive deliberate operator review before SQS cutover'
  end as ingestion_cutover_decision
from email_ingestion_jobs;

select count(*) filter (where status in ('pending','retry','processing')) as legacy_active_archive_items,
  case when count(*) filter (where status in ('pending','retry','processing'))=0
    then 'READY: no legacy database-delivered archive item remains active'
    else 'STOP: legacy archive items must finish or receive deliberate operator review before SQS cutover'
  end as archive_status_decision
from communications_email_archive_job_items;
