-- Read-only DEV preflight for the forward-only email SQS finalizer. Stop/drain
-- old API and email writers first. Run this complete file in DBeaver before
-- the separately reviewed email_sqs_delivery_apply.sql transaction.

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
  when to_regclass('public.email_relationships') is null then 'STOP: email_relationships is missing'
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
select 'email_ingestion_jobs', actual_count, greatest(intermediate_count,final_count),
  case when actual_count=19 and intermediate_count=19 then 'READY: exact previously-applied 19-column shape'
    when actual_count=17 and final_count=17 then 'READY: exact approved final 17-column shape'
    else 'STOP: expected exact previously-applied 19 or final 17-column shape'
  end
from (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','provider_attempt_count','attempt_token',
      'enqueue_source_id','last_error','available_at','processing_started_at','completed_timestamp',
      'failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as intermediate_count,
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','provider_attempt_count','attempt_token','enqueue_source_id',
      'sqs_accepted_timestamp','last_error','completed_timestamp','failed_timestamp','created_timestamp',
      'updated_timestamp'
    ]::text[])) as final_count
  from information_schema.columns
  where table_schema='public' and table_name='email_ingestion_jobs'
) shape
union all
select 'communications_email_archive_job_items', actual_count, greatest(intermediate_count,final_count),
  case when actual_count=13 and intermediate_count=13 then 'READY: exact previously-applied 13-column shape'
    when actual_count=11 and final_count=11 then 'READY: exact approved final 11-column shape'
    else 'STOP: expected exact previously-applied 13 or final 11-column shape'
  end
from (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','attempt_token','last_error',
      'available_at','processing_started_at','archived_timestamp','failed_timestamp','created_timestamp',
      'updated_timestamp'
    ]::text[])) as intermediate_count,
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','provider_attempt_count','attempt_token','last_error',
      'archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as final_count
  from information_schema.columns
  where table_schema='public' and table_name='communications_email_archive_job_items'
) shape;

with ingestion_shape as (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','provider_attempt_count','attempt_token',
      'enqueue_source_id','last_error','available_at','processing_started_at','completed_timestamp',
      'failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as intermediate_count,
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','provider_attempt_count','attempt_token','enqueue_source_id',
      'sqs_accepted_timestamp','last_error','completed_timestamp','failed_timestamp','created_timestamp',
      'updated_timestamp'
    ]::text[])) as final_count
  from information_schema.columns
  where table_schema='public' and table_name='email_ingestion_jobs'
), archive_shape as (
  select count(*) as actual_count,
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','attempt_token','last_error',
      'available_at','processing_started_at','archived_timestamp','failed_timestamp','created_timestamp',
      'updated_timestamp'
    ]::text[])) as intermediate_count,
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','provider_attempt_count','attempt_token','last_error',
      'archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) as final_count
  from information_schema.columns
  where table_schema='public' and table_name='communications_email_archive_job_items'
), states as (
  select case
      when ingestion_shape.actual_count=19 and ingestion_shape.intermediate_count=19 then 'intermediate'
      when ingestion_shape.actual_count=17 and ingestion_shape.final_count=17 then 'final'
      else 'invalid'
    end as ingestion_state,
    case
      when archive_shape.actual_count=13 and archive_shape.intermediate_count=13 then 'intermediate'
      when archive_shape.actual_count=11 and archive_shape.final_count=11 then 'final'
      else 'invalid'
    end as archive_state
  from ingestion_shape,archive_shape
)
select ingestion_state,archive_state,
  case
    when ingestion_state='intermediate' and archive_state='intermediate'
      then 'READY: all email SQS tables are in the coherent previously-applied shape'
    when ingestion_state='final' and archive_state='final'
      then 'READY: all email SQS tables are in the coherent final shape'
    else 'STOP: email SQS tables must be coherently all previously-applied or all-final'
  end as cross_table_decision
from states;

select
  (select count(*) from email_ingestion_jobs
    where status is null or status not in ('accepted','processing','completed','parked','exhausted'))+
  (select count(*) from communications_email_archive_job_items
    where status is null or status not in ('pending','processing','archived','failed'))
  as invalid_status_rows,
  case when
    (select count(*) from email_ingestion_jobs
      where status is null or status not in ('accepted','processing','completed','parked','exhausted'))+
    (select count(*) from communications_email_archive_job_items
      where status is null or status not in ('pending','processing','archived','failed'))=0
    then 'READY: every email SQS row uses a final approved status'
    else 'STOP: one or more email SQS rows use a status outside the final approved sets'
  end as status_decision;

select count(*) as duplicate_stable_identity_groups,
  case when count(*)=0
    then 'READY: stable ingestion identities are unique'
    else 'STOP: previously-applied migration must already have collapsed duplicate stable ingestion identities'
  end as identity_decision
from (
  select 1
  from email_ingestion_jobs
  group by company_id,email_connection_id,provider_message_id
  having count(*) > 1
) duplicates;

select count(*) filter (where status in ('pending','retry','processing')) as active_ingestion_jobs,
  case when count(*) filter (where status in ('pending','retry','processing'))=0
    then 'READY: no database-delivered ingestion job remains active'
    else 'STOP: ingestion jobs must finish or receive deliberate operator review before finalizing SQS delivery'
  end as ingestion_cutover_decision
from email_ingestion_jobs;

select count(*) filter (where status in ('pending','retry','processing')) as active_archive_items,
  case when count(*) filter (where status in ('pending','retry','processing'))=0
    then 'READY: no database-delivered archive item remains active'
    else 'STOP: archive items must finish or receive deliberate operator review before finalizing SQS delivery'
  end as archive_cutover_decision
from communications_email_archive_job_items;

select count(*) as duplicate_node_textbox_message_groups,
  case when count(*)=0
    then 'READY: each exact email message is linked to at most one textbox in each Node'
    else 'STOP: one or more exact email messages are linked to multiple textboxes in the same Node; review those typed relationships before finalizing SQS delivery'
  end as node_textbox_relationship_decision
from (
  select 1
  from email_relationships
  where resource_type='node' and resource_textbox_id is not null
  group by company_id,email_message_id,resource_id
  having count(*) > 1
) duplicates;
