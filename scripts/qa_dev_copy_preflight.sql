-- Read-only preflight for the one-time Dev -> QA cleaned data copy.
-- Run only after a raw Dev copy has been restored into an isolated QA scratch
-- database named mangorts_qa_raw_YYYYMMDD[_suffix]. This script returns counts
-- only. It never returns business rows or secret values.

begin transaction isolation level repeatable read read only;

set local lock_timeout = '5s';
set local statement_timeout = '30min';

do $guard$
declare
  missing_root_count integer;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: QA copy preflight requires PostgreSQL 17.x; connected server_version=%',
      current_setting('server_version');
  end if;

  if current_database() !~ '^mangorts_qa_raw_[0-9]{8}(_[a-z0-9]+)*$'
     or lower(current_database()) ~ '(dev|prod)' then
    raise exception 'STOP: QA copy preflight requires an isolated mangorts_qa_raw_YYYYMMDD scratch database; connected database=%',
      current_database();
  end if;

  if current_setting('transaction_read_only') <> 'on' then
    raise exception 'STOP: QA copy preflight transaction is not read-only';
  end if;

  if to_regclass('public.company_explorer_folders') is null
     or to_regclass('public.huddle_explorer_folders') is null
     or to_regclass('public.company_explorer_items') is null
     or to_regclass('public.huddle_explorer_items') is null
     or to_regclass('public.users') is null
     or to_regclass('public.attachments') is null then
    raise exception 'STOP: required Mango tables are missing from the raw QA copy';
  end if;

  with excluded_root_names(name) as (
    values
      ('sidebar huddles private'),
      ('tk'),
      ('finance 1'),
      ('finance 1.5'),
      ('finance 2'),
      ('hr 1'),
      ('hr 1.5'),
      ('hr 2'),
      ('legal'),
      ('fo')
  )
  select count(*)
    into missing_root_count
  from excluded_root_names root_name
  where not exists (
    select 1
    from public.company_explorer_folders folder
    where folder.parent_folder_id is null
      and lower(btrim(folder.name)) = root_name.name
  )
    and not exists (
      select 1
      from public.huddle_explorer_folders folder
      where folder.parent_folder_id is null
        and lower(btrim(folder.name)) = root_name.name
    );

  if missing_root_count <> 0 then
    raise exception 'STOP: % required excluded root name(s) were not found at the root of either explorer',
      missing_root_count;
  end if;

  if exists (
    select 1
    from public.company_explorer_folders folder
    where folder.parent_folder_id is null
      and lower(btrim(folder.name)) in (
        'sidebar huddles private','tk','finance 1','finance 1.5','finance 2',
        'hr 1','hr 1.5','hr 2','legal','fo'
      )
    group by folder.company_id, lower(btrim(folder.name))
    having count(*) <> 1
  ) then
    raise exception 'STOP: a company explorer has duplicate excluded root names';
  end if;

  if exists (
    select 1
    from public.huddle_explorer_folders folder
    where folder.parent_folder_id is null
      and lower(btrim(folder.name)) in (
        'sidebar huddles private','tk','finance 1','finance 1.5','finance 2',
        'hr 1','hr 1.5','hr 2','legal','fo'
      )
    group by folder.company_id, lower(btrim(folder.name))
    having count(*) <> 1
  ) then
    raise exception 'STOP: a Huddle explorer has duplicate excluded root names';
  end if;
end
$guard$;

select
  current_database() as database_name,
  current_setting('server_version') as server_version,
  current_setting('transaction_read_only')::boolean as transaction_read_only;

with excluded_root_names(name) as (
  values
    ('sidebar huddles private'),('tk'),('finance 1'),('finance 1.5'),
    ('finance 2'),('hr 1'),('hr 1.5'),('hr 2'),('legal'),('fo')
), root_matches as (
  select 'company'::text as explorer, lower(btrim(folder.name)) as root_name, count(*)::bigint as root_count
  from public.company_explorer_folders folder
  join excluded_root_names root_name on root_name.name = lower(btrim(folder.name))
  where folder.parent_folder_id is null
  group by lower(btrim(folder.name))
  union all
  select 'huddle', lower(btrim(folder.name)), count(*)::bigint
  from public.huddle_explorer_folders folder
  join excluded_root_names root_name on root_name.name = lower(btrim(folder.name))
  where folder.parent_folder_id is null
  group by lower(btrim(folder.name))
)
select explorer, root_name, root_count
from root_matches
order by explorer, root_name;

with recursive
excluded_root_names(name) as (
  values
    ('sidebar huddles private'),('tk'),('finance 1'),('finance 1.5'),
    ('finance 2'),('hr 1'),('hr 1.5'),('hr 2'),('legal'),('fo')
), seeds(company_id, resource_type, resource_id) as (
  select folder.company_id, 'company_explorer_folder'::text, folder.folder_id
  from public.company_explorer_folders folder
  join excluded_root_names root_name on root_name.name = lower(btrim(folder.name))
  where folder.parent_folder_id is null
  union
  select folder.company_id, 'huddle_explorer_folder', folder.folder_id
  from public.huddle_explorer_folders folder
  join excluded_root_names root_name on root_name.name = lower(btrim(folder.name))
  where folder.parent_folder_id is null
), edges(from_company_id, from_type, from_id, to_company_id, to_type, to_id) as (
  select parent.company_id, 'company_explorer_folder', parent.folder_id,
         child.company_id, 'company_explorer_folder', child.folder_id
  from public.company_explorer_folders child
  join public.company_explorer_folders parent
    on parent.company_id = child.company_id and parent.folder_id = child.parent_folder_id
  union
  select folder.company_id, 'company_explorer_folder', folder.folder_id,
         item.company_id, item.target_type, item.target_id
  from public.company_explorer_items item
  join public.company_explorer_folders folder
    on folder.company_id = item.company_id and folder.folder_id = item.parent_folder_id
  union
  select parent.company_id, 'huddle_explorer_folder', parent.folder_id,
         child.company_id, 'huddle_explorer_folder', child.folder_id
  from public.huddle_explorer_folders child
  join public.huddle_explorer_folders parent
    on parent.company_id = child.company_id and parent.folder_id = child.parent_folder_id
  union
  select folder.company_id, 'huddle_explorer_folder', folder.folder_id,
         item.company_id, 'huddle_logic_gate', item.resource_huddle_resource_id
  from public.huddle_explorer_items item
  join public.huddle_explorer_folders folder
    on folder.company_id = item.company_id and folder.folder_id = item.parent_folder_id
  union
  select assignment.company_id, 'logic_gate', assignment.logic_gate_id,
         assignment.company_id, 'node', assignment.node_id
  from public.node_logic_gate_assignments assignment
  union
  select node.company_id, 'huddle_logic_gate', node.huddle_logic_gate_id,
         node.company_id, 'huddle_node', node.huddle_node_id
  from public.huddle_nodes node
  union
  select kpi.company_id, 'logic_gate', kpi.logic_gate_id,
         kpi.company_id, 'kpi', kpi.kpi_id
  from public.kpis kpi
  union
  select scorecard.company_id, 'logic_gate', scorecard.logic_gate_id,
         scorecard.company_id, 'scorecard', scorecard.qd_rating_id
  from public.scorecards scorecard
), excluded_resources(company_id, resource_type, resource_id) as (
  select company_id, resource_type, resource_id from seeds
  union
  select edge.to_company_id, edge.to_type, edge.to_id
  from excluded_resources excluded
  join edges edge
    on edge.from_company_id = excluded.company_id
   and edge.from_type = excluded.resource_type
   and edge.from_id = excluded.resource_id
)
select resource_type, count(*)::bigint as excluded_count
from excluded_resources
group by resource_type
order by resource_type;

select check_name, row_count
from (values
  ('attachments', (select count(*)::bigint from public.attachments)),
  ('attachment_relationships', (select count(*)::bigint from public.attachment_relationships)),
  ('attachment_upload_jobs', (select count(*)::bigint from public.attachment_upload_jobs)),
  ('email_connections', (select count(*)::bigint from public.email_connections)),
  ('email_ingestion_jobs', (select count(*)::bigint from public.email_ingestion_jobs)),
  ('email_archive_jobs', (select count(*)::bigint from public.communications_email_archive_jobs)),
  ('domain_events', (select count(*)::bigint from public.domain_events)),
  ('realtime_outbox', (select count(*)::bigint from public.realtime_outbox)),
  ('notifications', (select count(*)::bigint from public.notifications)),
  ('recycle_bin_items', (select count(*)::bigint from public.recycle_bin_items))
) checks(check_name, row_count)
order by check_name;

commit;
