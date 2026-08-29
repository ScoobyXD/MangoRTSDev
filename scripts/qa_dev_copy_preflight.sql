-- Read-only preflight for the one-time Dev -> QA cleaned data copy.
-- Run only after a raw Dev copy has been restored into an isolated QA scratch
-- database named mangorts_qa_raw_YYYYMMDD[_suffix]. This script returns counts
-- only. It never returns business rows or secret values.

begin transaction isolation level repeatable read read only;

set local lock_timeout = '5s';
set local statement_timeout = '30min';

do $guard$
declare
  missing_excluded_folder_labels text;
  source_schema_mismatch_count integer;
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
     or to_regclass('public.attachments') is null
     or to_regclass('public.entity_types') is null
     or to_regclass('public.entity_folders') is null
     or to_regclass('public.entity_field_types') is null
     or to_regclass('public.entities') is null
     or to_regclass('public.entity_fields') is null
     or to_regclass('public.entity_relationships') is null
     or to_regclass('public.huddle_node_textboxes') is null
     or to_regclass('public.huddle_node_textbox_chats') is null
     or to_regclass('public.schema_migrations') is null then
    raise exception 'STOP: required Mango tables are missing from the raw QA copy';
  end if;

  -- The one-time source bridge is deliberately narrow. Dev must have the exact
  -- audited current Entity and Huddle Node workspace columns. Physical column
  -- order is irrelevant; missing or extra columns stop the copy.
  with expected(table_name,column_name) as (
    values
      ('entity_types','company_id'),('entity_types','entity_type_id'),
      ('entity_types','name'),('entity_types','system_key'),('entity_types','created_timestamp'),
      ('entity_types','updated_timestamp'),
      ('entity_folders','company_id'),('entity_folders','entity_folder_id'),
      ('entity_folders','entity_type_id'),('entity_folders','parent_entity_folder_id'),
      ('entity_folders','name'),('entity_folders','position'),
      ('entity_folders','created_timestamp'),('entity_folders','updated_timestamp'),
      ('entity_field_types','company_id'),('entity_field_types','entity_field_type_id'),
      ('entity_field_types','entity_type_id'),('entity_field_types','entity_folder_id'),
      ('entity_field_types','name'),('entity_field_types','field_type'),
      ('entity_field_types','system_key'),('entity_field_types','config_jsonb'),
      ('entity_field_types','position'),('entity_field_types','created_timestamp'),
      ('entity_field_types','updated_timestamp'),
      ('entities','company_id'),('entities','entity_id'),('entities','entity_type_id'),
      ('entities','entity_folder_id'),('entities','name'),('entities','position'),
      ('entities','body_json'),('entities','revision'),('entities','created_by_user_id'),
      ('entities','created_timestamp'),('entities','updated_timestamp'),
      ('entity_fields','company_id'),('entity_fields','entity_field_id'),
      ('entity_fields','entity_id'),('entity_fields','entity_field_type_id'),('entity_fields','name'),
      ('entity_fields','field_type'),('entity_fields','value_jsonb'),
      ('entity_fields','position'),('entity_fields','created_timestamp'),
      ('entity_fields','updated_timestamp'),
      ('entity_relationships','company_id'),('entity_relationships','entity_id'),
      ('entity_relationships','resource_type'),('entity_relationships','resource_id'),
      ('entity_relationships','created_timestamp'),
      ('huddle_node_textboxes','company_id'),('huddle_node_textboxes','huddle_node_id'),
      ('huddle_node_textboxes','textbox_id'),('huddle_node_textboxes','created_timestamp'),
      ('huddle_node_textboxes','updated_timestamp'),('huddle_node_textboxes','deleted_timestamp'),
      ('huddle_node_textboxes','display_order'),('huddle_node_textboxes','body_json'),
      ('huddle_node_textboxes','revision'),('huddle_node_textboxes','title'),
      ('huddle_node_textbox_chats','company_id'),('huddle_node_textbox_chats','chat_id'),
      ('huddle_node_textbox_chats','huddle_node_id'),('huddle_node_textbox_chats','textbox_id'),
      ('huddle_node_textbox_chats','parent_chat_id'),('huddle_node_textbox_chats','selection_quote'),
      ('huddle_node_textbox_chats','selection_start'),('huddle_node_textbox_chats','selection_end'),
      ('huddle_node_textbox_chats','author_user_id'),('huddle_node_textbox_chats','author_display_name'),
      ('huddle_node_textbox_chats','message'),('huddle_node_textbox_chats','edited_timestamp'),
      ('huddle_node_textbox_chats','entity_links'),('huddle_node_textbox_chats','mentioned_user_ids'),
      ('huddle_node_textbox_chats','mentioned_group_ids'),('huddle_node_textbox_chats','revision'),
      ('huddle_node_textbox_chats','created_timestamp'),('huddle_node_textbox_chats','updated_timestamp'),
      ('huddle_node_textbox_chats','deleted_timestamp')
  ), actual(table_name,column_name) as (
    select table_name::text,column_name::text
    from information_schema.columns
    where table_schema='public'
      and table_name in (
        'entity_types','entity_folders','entity_field_types','entities','entity_fields',
        'entity_relationships','huddle_node_textboxes','huddle_node_textbox_chats'
      )
  ), mismatches as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select count(*) into source_schema_mismatch_count from mismatches;

  if source_schema_mismatch_count <> 0
     or to_regclass('public.action_item_huddle_relationships') is not null
     or to_regclass('public.entity_field_assignments') is not null then
    raise exception 'STOP: raw QA source is not the audited current Entity and Huddle workspace schema';
  end if;

  if exists (
    select 1 from public.schema_migrations
    where version in (
      '20260827_entities.sql',
      '20260828_action_items.sql',
      '20260828_entity_relationships.sql',
      '20260828_huddle_node_workspace.sql',
      '20260828_z_huddle_logic_gate_attachments.sql',
      '20260828_zz_huddle_logic_gate_action_item_relationships.sql',
      '20260829_action_item_delegation_source.sql',
      '20260829_my_work_node_completion_transition.sql'
    )
  ) then
    raise exception 'STOP: Dev Entity or Huddle workspace migration ledger changed after the approved read-only audit';
  end if;

  if exists (
    select 1
    from public.entity_relationships relationship
    left join public.entities entity
      on entity.company_id = relationship.company_id
     and entity.entity_id = relationship.entity_id
    left join public.huddle_nodes huddle_node
      on relationship.resource_type = 'huddle_node'
     and huddle_node.company_id = relationship.company_id
     and huddle_node.huddle_node_id = relationship.resource_id
    left join public.huddle_logic_gates huddle_logic_gate
      on relationship.resource_type = 'huddle_logic_gate'
     and huddle_logic_gate.company_id = relationship.company_id
     and huddle_logic_gate.huddle_logic_gate_id = relationship.resource_id
    where entity.entity_id is null
       or relationship.resource_type not in ('huddle_node','huddle_logic_gate')
       or (relationship.resource_type = 'huddle_node' and huddle_node.huddle_node_id is null)
       or (relationship.resource_type = 'huddle_logic_gate' and huddle_logic_gate.huddle_logic_gate_id is null)
  ) then
    raise exception 'STOP: Dev Entity relationship has a missing or unsupported exact same-company endpoint';
  end if;

  if exists (
    with live_or_recycled_resources(company_id,resource_type,resource_id) as (
      select company_id,'node'::text,node_id::text from public.nodes
      union all
      select company_id,'logic_gate',logic_gate_id::text from public.logic_gates
      union all
      select company_id,'project',project_id::text from public.projects
      union all
      select company_id,'huddle_node',huddle_node_id::text from public.huddle_nodes
      union all
      select huddle_logic_gate.company_id,'huddle_logic_gate',huddle_logic_gate.huddle_logic_gate_id::text
      from public.huddle_logic_gates huddle_logic_gate
      where huddle_logic_gate.deleted_timestamp is null
      union all
      select kpi.company_id,'kpi',kpi.kpi_id::text
      from public.kpis kpi where kpi.deleted_timestamp is null
      union all
      select recycle.company_id,definition.resource_type,
             restored.row_json->>definition.id_column
      from public.recycle_bin_items recycle
      cross join (values
        ('nodes','node_id','node'),
        ('logic_gates','logic_gate_id','logic_gate'),
        ('projects','project_id','project'),
        ('huddle_nodes','huddle_node_id','huddle_node'),
        ('huddle_logic_gates','huddle_logic_gate_id','huddle_logic_gate'),
        ('kpis','kpi_id','kpi')
      ) definition(table_name,id_column,resource_type)
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(recycle.restore_payload->definition.table_name)='array'
          then recycle.restore_payload->definition.table_name
          else '[]'::jsonb
        end
      ) restored(row_json)
    )
    select 1
    from public.entity_fields field
    where field.field_type='resource'
      and field.value_jsonb is not null
      and (
        jsonb_typeof(field.value_jsonb) is distinct from 'object'
        or jsonb_typeof(field.value_jsonb->'resource_type') is distinct from 'string'
        or jsonb_typeof(field.value_jsonb->'resource_id') is distinct from 'string'
        or field.value_jsonb is distinct from jsonb_build_object(
          'resource_type',field.value_jsonb->>'resource_type',
          'resource_id',field.value_jsonb->>'resource_id'
        )
        or field.value_jsonb->>'resource_type' not in ('node','logic_gate','project','huddle_node','huddle_logic_gate','kpi')
        or public.mangorts_try_uuid(field.value_jsonb->>'resource_id')::text
             is distinct from field.value_jsonb->>'resource_id'
        or not exists (
          select 1
          from live_or_recycled_resources endpoint
          where endpoint.company_id=field.company_id
            and endpoint.resource_type=field.value_jsonb->>'resource_type'
            and endpoint.resource_id=field.value_jsonb->>'resource_id'
        )
      )
  ) then
    raise exception 'STOP: Dev Entity resource field has an unsupported or missing exact same-company endpoint (live or recycled)';
  end if;

  with audited_excluded_folders(company_id, resource_type, resource_id, audit_label) as (
    values
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019fcceb-fc3f-7000-afe8-753caec7192d'::uuid, 'Sidebar Huddles Private'::text),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e6a1f-03c3-7000-b82f-700c63804e55'::uuid, 'TK'::text),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e481c-8883-709c-ab8a-732ab4cc905d'::uuid, 'Finance 1'::text),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fb8-0487-7000-9ea2-5e49697c9e50'::uuid, 'Finance 1.5'::text),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fb0-a1c7-7000-991a-828bde4514ee'::uuid, 'Finance 2'::text),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e6ff3-e03e-7000-80c7-bd9aaaa266ed'::uuid, 'HR 1'::text),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fbb-4e49-7000-b59e-03bc60c93772'::uuid, 'HR 1.5'::text),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fbb-2ae3-7000-ad45-92438718f024'::uuid, 'HR 2'::text),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fbe-f567-7000-b483-e855cc8f46a6'::uuid, 'Legal'::text),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e481f-3f20-767e-8c2a-5b37fca774ad'::uuid, 'FO'::text)
  )
  select string_agg(excluded.audit_label, ', ' order by excluded.audit_label)
    into missing_excluded_folder_labels
  from audited_excluded_folders excluded
  where (
    excluded.resource_type = 'company_explorer_folder'
    and not exists (
      select 1
      from public.company_explorer_folders folder
      where folder.company_id = excluded.company_id
        and folder.folder_id = excluded.resource_id
    )
  ) or (
    excluded.resource_type = 'huddle_explorer_folder'
    and not exists (
      select 1
      from public.huddle_explorer_folders folder
      where folder.company_id = excluded.company_id
        and folder.folder_id = excluded.resource_id
    )
  );

  if missing_excluded_folder_labels is not null then
    raise exception 'STOP: audited excluded Explorer folder identities are missing: %. Repeat the read-only Dev inventory before copying',
      missing_excluded_folder_labels;
  end if;
end
$guard$;

select
  current_database() as database_name,
  current_setting('server_version') as server_version,
  current_setting('transaction_read_only')::boolean as transaction_read_only;

with audited_excluded_folders(company_id, resource_type, resource_id, audit_label) as (
  values
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019fcceb-fc3f-7000-afe8-753caec7192d'::uuid, 'Sidebar Huddles Private'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e6a1f-03c3-7000-b82f-700c63804e55'::uuid, 'TK'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e481c-8883-709c-ab8a-732ab4cc905d'::uuid, 'Finance 1'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fb8-0487-7000-9ea2-5e49697c9e50'::uuid, 'Finance 1.5'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fb0-a1c7-7000-991a-828bde4514ee'::uuid, 'Finance 2'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e6ff3-e03e-7000-80c7-bd9aaaa266ed'::uuid, 'HR 1'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fbb-4e49-7000-b59e-03bc60c93772'::uuid, 'HR 1.5'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fbb-2ae3-7000-ad45-92438718f024'::uuid, 'HR 2'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fbe-f567-7000-b483-e855cc8f46a6'::uuid, 'Legal'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e481f-3f20-767e-8c2a-5b37fca774ad'::uuid, 'FO'::text)
), placements as (
  select excluded.audit_label, excluded.resource_type,
         case when folder.parent_folder_id is null then 'root' else 'nested' end as placement
  from audited_excluded_folders excluded
  join public.company_explorer_folders folder
    on excluded.resource_type = 'company_explorer_folder'
   and folder.company_id = excluded.company_id
   and folder.folder_id = excluded.resource_id
  union all
  select excluded.audit_label, excluded.resource_type,
         case when folder.parent_folder_id is null then 'root' else 'nested' end
  from audited_excluded_folders excluded
  join public.huddle_explorer_folders folder
    on excluded.resource_type = 'huddle_explorer_folder'
   and folder.company_id = excluded.company_id
   and folder.folder_id = excluded.resource_id
)
select audit_label, resource_type, placement
from placements
order by audit_label;

with recursive
audited_excluded_folders(company_id, resource_type, resource_id, audit_label) as (
  values
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019fcceb-fc3f-7000-afe8-753caec7192d'::uuid, 'Sidebar Huddles Private'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e6a1f-03c3-7000-b82f-700c63804e55'::uuid, 'TK'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e481c-8883-709c-ab8a-732ab4cc905d'::uuid, 'Finance 1'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fb8-0487-7000-9ea2-5e49697c9e50'::uuid, 'Finance 1.5'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fb0-a1c7-7000-991a-828bde4514ee'::uuid, 'Finance 2'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e6ff3-e03e-7000-80c7-bd9aaaa266ed'::uuid, 'HR 1'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fbb-4e49-7000-b59e-03bc60c93772'::uuid, 'HR 1.5'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fbb-2ae3-7000-ad45-92438718f024'::uuid, 'HR 2'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e8fbe-f567-7000-b483-e855cc8f46a6'::uuid, 'Legal'::text),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'company_explorer_folder'::text, '019e481f-3f20-767e-8c2a-5b37fca774ad'::uuid, 'FO'::text)
), excluded_folder_names(name) as (
  values
    ('sidebar huddles private'),('tk'),('finance 1'),('finance 1.5'),
    ('finance 2'),('hr 1'),('hr 1.5'),('hr 2'),('legal'),('fo')
), seeds(company_id, resource_type, resource_id) as (
  select company_id, resource_type, resource_id
  from audited_excluded_folders
  union
  select folder.company_id, 'company_explorer_folder', folder.folder_id
  from public.company_explorer_folders folder
  join excluded_folder_names excluded on excluded.name = lower(btrim(folder.name))
  union
  select folder.company_id, 'huddle_explorer_folder', folder.folder_id
  from public.huddle_explorer_folders folder
  join excluded_folder_names excluded on excluded.name = lower(btrim(folder.name))
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
  ('entity_types', (select count(*)::bigint from public.entity_types)),
  ('action_item_entities', (
    select count(*)::bigint
    from public.entities entity
    join public.entity_types entity_type
      on entity_type.company_id = entity.company_id
     and entity_type.entity_type_id = entity.entity_type_id
    where entity_type.system_key = 'action_item'
  )),
  ('entity_fields', (select count(*)::bigint from public.entity_fields)),
  ('entity_relationships', (select count(*)::bigint from public.entity_relationships)),
  ('huddle_node_textboxes', (select count(*)::bigint from public.huddle_node_textboxes)),
  ('huddle_node_textbox_chats', (select count(*)::bigint from public.huddle_node_textbox_chats)),
  ('domain_events', (select count(*)::bigint from public.domain_events)),
  ('realtime_outbox', (select count(*)::bigint from public.realtime_outbox)),
  ('notifications', (select count(*)::bigint from public.notifications)),
  ('recycle_bin_items', (select count(*)::bigint from public.recycle_bin_items))
) checks(check_name, row_count)
order by check_name;

commit;
