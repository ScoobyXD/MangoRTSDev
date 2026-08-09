-- Human-run DEV transaction. First stop/drain old API and email writers, run
-- email_sqs_delivery_preflight.sql, verify a DEV recovery point, and continue
-- only when every decision says READY. Plain PostgreSQL for DBeaver.

begin;

-- This block is intentionally the canonical migration body. Every shape and
-- data gate runs before the first write, and any STOP rolls back all work.
do $migration$
declare
  column_count bigint;
  legacy_column_count bigint;
  final_column_count bigint;
  ingestion_is_legacy boolean;
  archive_is_legacy boolean;
  duplicate_identity_count bigint;
  redundant_identity_row_count bigint;
  unsafe_duplicate_row_count bigint;
  conflicting_email_thread_group_count bigint;
  conflicting_provider_thread_group_count bigint;
  ingestion_reference_count bigint;
  collapsed_identity_row_count bigint;
  remaining_duplicate_identity_count bigint;
  legacy_active_count bigint;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: DEV email SQS migration requires PostgreSQL 17.x; connected server is %',
      current_setting('server_version');
  end if;
  if to_regclass('public.email_connections') is null
     or to_regclass('public.email_ingestion_jobs') is null
     or to_regclass('public.communications_email_archive_job_items') is null then
    raise exception 'STOP: required V3 email tables are missing';
  end if;

  lock table public.email_connections,
    public.email_ingestion_jobs,
    public.communications_email_archive_job_items
    in share row exclusive mode;

  select count(*), count(*) filter (where column_name = any (array[
    'email_connection_id','company_id','connection_type','personal_user_id','provider','account_email',
    'grant_id','status','connected_by_user_id','ingestion_started_at','last_successful_scan_at',
    'created_timestamp','updated_timestamp'
  ]::text[])) into column_count, final_column_count
  from information_schema.columns where table_schema='public' and table_name='email_connections';
  if column_count <> 13 or final_column_count <> 13 then
    raise exception 'STOP: email_connections must have exactly the approved 13 columns; found total %, approved %', column_count, final_column_count;
  end if;

  select count(*),
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
      'provider_thread_id','priority','status','attempt_count','last_error','available_at',
      'processing_started_at','completed_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])),
    count(*) filter (where column_name = any (array[
      'ingestion_job_id','company_id','email_connection_id','email_thread_id','provider_message_id',
		'provider_thread_id','priority','status','provider_attempt_count','attempt_token',
		'sqs_accepted_timestamp','last_error','completed_timestamp',
		'failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) into column_count, legacy_column_count, final_column_count
  from information_schema.columns where table_schema='public' and table_name='email_ingestion_jobs';
  if column_count = 16 and legacy_column_count = 16 then ingestion_is_legacy := true;
	elsif column_count = 16 and final_column_count = 16 then ingestion_is_legacy := false;
	else raise exception 'STOP: email_ingestion_jobs must be exact legacy 16 or exact final 16 columns; found total %, legacy-approved %, final-approved %', column_count, legacy_column_count, final_column_count;
  end if;

  select count(*),
    count(*) filter (where column_name = any (array[
      'job_item_id','archive_job_id','message_id','status','attempt_count','last_error','available_at',
      'processing_started_at','archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])),
    count(*) filter (where column_name = any (array[
		'job_item_id','archive_job_id','message_id','status','provider_attempt_count','attempt_token','last_error',
		'archived_timestamp','failed_timestamp','created_timestamp','updated_timestamp'
    ]::text[])) into column_count, legacy_column_count, final_column_count
  from information_schema.columns where table_schema='public' and table_name='communications_email_archive_job_items';
  if column_count = 12 and legacy_column_count = 12 then archive_is_legacy := true;
	elsif column_count = 11 and final_column_count = 11 then archive_is_legacy := false;
	else raise exception 'STOP: communications_email_archive_job_items must be exact legacy 12 or exact final 11 columns; found total %, legacy-approved %, final-approved %', column_count, legacy_column_count, final_column_count;
  end if;

  if ingestion_is_legacy <> archive_is_legacy then
    raise exception 'STOP: email SQS tables must be coherently all-legacy or all-final; email_connections keeps its exact 13-column shape in both states';
  end if;

  select
    (select count(*) from email_ingestion_jobs where status in ('pending','retry','processing'))+
    (select count(*) from communications_email_archive_job_items where status in ('pending','retry','processing'))
  into legacy_active_count;
  if legacy_active_count <> 0 then
    raise exception 'STOP: % legacy database-delivered email item(s) must finish or receive deliberate operator review before SQS cutover', legacy_active_count;
  end if;
  select count(*),coalesce(sum(identity_count-1),0),
    coalesce(sum(unsafe_row_count),0),
    count(*) filter (where email_thread_variant_count>1),
    count(*) filter (where provider_thread_variant_count>1)
  into duplicate_identity_count,redundant_identity_row_count,
    unsafe_duplicate_row_count,conflicting_email_thread_group_count,
    conflicting_provider_thread_group_count
  from (
    select count(*) as identity_count,
      count(*) filter (where status is null or status not in ('completed','failed')) as unsafe_row_count,
      count(distinct email_thread_id) filter (where email_thread_id is not null) as email_thread_variant_count,
      count(distinct btrim(provider_thread_id)) filter (where nullif(btrim(provider_thread_id),'') is not null) as provider_thread_variant_count
    from email_ingestion_jobs
    group by company_id,email_connection_id,provider_message_id having count(*) > 1
  ) duplicates;

  if not ingestion_is_legacy and redundant_identity_row_count <> 0 then
    raise exception 'STOP: final email_ingestion_jobs contains % duplicate stable identity group(s) and % redundant row(s)',
      duplicate_identity_count,redundant_identity_row_count;
  end if;

  if ingestion_is_legacy and redundant_identity_row_count <> 0 then
    if unsafe_duplicate_row_count <> 0 then
      raise exception 'STOP: % duplicate stable identity row(s) are not inactive completed/failed legacy history',
        unsafe_duplicate_row_count;
    end if;
    if conflicting_email_thread_group_count <> 0 then
      raise exception 'STOP: % duplicate stable identity group(s) contain conflicting non-null email_thread_id values',
        conflicting_email_thread_group_count;
    end if;
    if conflicting_provider_thread_group_count <> 0 then
      raise exception 'STOP: % duplicate stable identity group(s) contain conflicting nonblank provider_thread_id values',
        conflicting_provider_thread_group_count;
    end if;

    select count(*) into ingestion_reference_count
    from pg_constraint
    where contype='f'
      and confrelid='public.email_ingestion_jobs'::regclass;
    if ingestion_reference_count <> 0 then
      raise exception 'STOP: cannot collapse redundant ingestion metadata because % foreign key(s) reference public.email_ingestion_jobs',
        ingestion_reference_count;
    end if;

    with ranked as (
      select ingestion_job_id,
        row_number() over (
          partition by company_id,email_connection_id,provider_message_id
          order by case
              when status='completed' and last_error is distinct from 'superseded_by_email_ingestion_cutover' then 0
              when status='failed' then 1
              else 2
            end,
            case when email_thread_id is not null then 0 else 1 end,
            case when nullif(btrim(provider_thread_id),'') is not null then 0 else 1 end,
            created_timestamp asc nulls last,
            ingestion_job_id asc
        ) as identity_rank
      from email_ingestion_jobs
    )
    delete from email_ingestion_jobs jobs
    using ranked
    where jobs.ingestion_job_id=ranked.ingestion_job_id
      and ranked.identity_rank>1;
    get diagnostics collapsed_identity_row_count = row_count;
    if collapsed_identity_row_count <> redundant_identity_row_count then
      raise exception 'STOP: expected to collapse exactly % redundant ingestion metadata row(s), deleted %',
        redundant_identity_row_count,collapsed_identity_row_count;
    end if;

    select count(*) into remaining_duplicate_identity_count
    from (
      select 1 from email_ingestion_jobs
      group by company_id,email_connection_id,provider_message_id having count(*) > 1
    ) duplicates;
    if remaining_duplicate_identity_count <> 0 then
      raise exception 'STOP: % duplicate stable ingestion identity group(s) remain after legacy metadata collapse',
        remaining_duplicate_identity_count;
    end if;
  end if;

	if ingestion_is_legacy then
		drop index if exists idx_email_ingestion_jobs_claim;
		alter table email_ingestion_jobs drop constraint if exists email_ingestion_jobs_attempt_chk;
		alter table email_ingestion_jobs
			add column provider_attempt_count integer not null default 0,
			add column attempt_token uuid,
			add column sqs_accepted_timestamp timestamptz,
			drop column attempt_count,
			drop column available_at,
			drop column processing_started_at;
	end if;
	if archive_is_legacy then
		drop index if exists idx_communications_email_archive_job_items_claim;
		alter table communications_email_archive_job_items
			add column provider_attempt_count integer not null default 0,
			add column attempt_token uuid,
			drop column attempt_count,
			drop column available_at,
			drop column processing_started_at;
  end if;

  alter table email_connections drop constraint if exists email_connections_status_chk;
  alter table email_connections add constraint email_connections_status_chk check (
    status in ('connected','disconnected','reauth_required','configuration_required')
  );
  alter table email_ingestion_jobs
    drop constraint if exists email_ingestion_jobs_status_chk,
    drop constraint if exists email_ingestion_jobs_provider_attempt_chk;
  update email_ingestion_jobs
  set status='exhausted',provider_attempt_count=0,attempt_token=null,updated_timestamp=now()
  where status='failed';
	alter table communications_email_archive_job_items
		drop constraint if exists communications_email_archive_job_items_status_chk,
		drop constraint if exists communications_email_archive_job_items_provider_attempt_chk;
	alter table communications_email_archive_job_items
		add constraint communications_email_archive_job_items_status_chk check (status in ('pending','processing','archived','failed')),
		add constraint communications_email_archive_job_items_provider_attempt_chk check (provider_attempt_count between 0 and 3);
  alter table email_ingestion_jobs
    alter column status set default 'accepted',
    add constraint email_ingestion_jobs_status_chk check (status in ('accepted','processing','completed','parked','exhausted')),
    add constraint email_ingestion_jobs_provider_attempt_chk check (provider_attempt_count between 0 and 3);
  drop index if exists idx_communications_email_archive_job_items_claim;
  drop index if exists idx_email_ingestion_jobs_active_message;
  drop index if exists idx_email_ingestion_jobs_claim;
  drop index if exists idx_email_ingestion_jobs_stable_message;
  create unique index idx_email_ingestion_jobs_stable_message
    on email_ingestion_jobs(company_id,email_connection_id,provider_message_id);
end
$migration$;

commit;

select current_setting('server_version') as connected_server_version,
  (select count(*) from email_connections where status='configuration_required') as configuration_required_connections,
  (select count(*) from email_ingestion_jobs where status='accepted') as accepted_jobs,
  (select count(*) from email_ingestion_jobs where status='processing') as processing_jobs,
  (select count(*) from email_ingestion_jobs where status='completed') as completed_jobs,
  (select count(*) from email_ingestion_jobs where status='parked') as parked_jobs,
  (select count(*) from email_ingestion_jobs where status='exhausted') as exhausted_jobs;
