-- Read-only verification for the one-time Dev -> QA cleaned data copy.
--
-- Allowed targets:
--   mangorts_qa_raw_YYYYMMDD[_suffix]  sanitized raw scratch database
--   mangorts_qa_next_YYYYMMDDHHMMSS     fresh canonical target after data restore
--   mangorts_qa                       final post-cutover QA database
--
-- Run before enabling the QA API. Run again after mapping Jonat's QA Cognito
-- subject. The email worker must remain disabled until separate QA Nylas
-- staging credentials and controlled mailboxes are configured.

begin transaction isolation level repeatable read read only;

set local lock_timeout = '5s';
set local statement_timeout = '30min';

do $guard$
declare
  entity_schema_mismatch_count integer;
begin
  if not exists (select 1 from public.companies) then
    raise exception 'STOP: QA copy contains no surviving company; do not invent TF_QA_COMPANY_ID';
  end if;

  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: QA copy verification requires PostgreSQL 17.x; connected server_version=%',
      current_setting('server_version');
  end if;

  if current_database() !~ '^(mangorts_qa_raw_[0-9]{8}(_[a-z0-9]+)*|mangorts_qa_next_[0-9]{14}|mangorts_qa)$'
     or lower(current_database()) ~ '(dev|prod)' then
    raise exception 'STOP: QA copy verification permits only guarded QA raw, QA next, or exact mangorts_qa databases; connected database=%',
      current_database();
  end if;

  if current_setting('transaction_read_only') <> 'on' then
    raise exception 'STOP: QA copy verification transaction is not read-only';
  end if;

  if to_regclass('public.company_explorer_folders') is null
     or to_regclass('public.huddle_explorer_folders') is null
     or to_regclass('public.users') is null
     or to_regclass('public.attachments') is null
     or to_regclass('public.entity_types') is null
     or to_regclass('public.entity_folders') is null
     or to_regclass('public.entity_field_types') is null
     or to_regclass('public.entities') is null
     or to_regclass('public.entity_fields') is null
     or to_regclass('public.action_item_huddle_relationships') is null
     or to_regclass('public.schema_migrations') is null then
    raise exception 'STOP: required canonical Mango tables are missing';
  end if;

  with expected(table_name,column_name) as (
    values
      ('entity_types','company_id'),('entity_types','entity_type_id'),
      ('entity_types','name'),('entity_types','system_key'),
      ('entity_types','created_timestamp'),('entity_types','updated_timestamp'),
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
      ('entity_fields','entity_id'),('entity_fields','entity_field_type_id'),
      ('entity_fields','name'),('entity_fields','field_type'),
      ('entity_fields','value_jsonb'),('entity_fields','position'),
      ('entity_fields','created_timestamp'),('entity_fields','updated_timestamp')
  ), actual(table_name,column_name) as (
    select table_name::text,column_name::text
    from information_schema.columns
    where table_schema='public'
      and table_name in ('entity_types','entity_folders','entity_field_types','entities','entity_fields')
  ), mismatches as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select count(*) into entity_schema_mismatch_count from mismatches;

  if entity_schema_mismatch_count <> 0 then
    raise exception 'STOP: current Entity schema columns do not match the exact unordered canonical sets';
  end if;
end
$guard$;

do $verify$
declare
  migration_count bigint;
  non_inert_user_count bigint;
  foreign_key_row record;
  foreign_key_has_orphan boolean;
  foreign_key_count integer := 0;
begin
  if exists (
    select 1 from public.company_explorer_folders
    where parent_folder_id is null
      and lower(btrim(name)) in (
        'sidebar huddles private','tk','finance 1','finance 1.5','finance 2',
        'hr 1','hr 1.5','hr 2','legal','fo'
      )
  ) or exists (
    select 1 from public.huddle_explorer_folders
    where parent_folder_id is null
      and lower(btrim(name)) in (
        'sidebar huddles private','tk','finance 1','finance 1.5','finance 2',
        'hr 1','hr 1.5','hr 2','legal','fo'
      )
  ) then
    raise exception 'STOP: an excluded explorer root remains';
  end if;

  if exists (select 1 from public.attachments)
     or exists (select 1 from public.attachment_previews)
     or exists (select 1 from public.attachment_relationships)
     or exists (select 1 from public.attachment_upload_jobs)
     or exists (select 1 from public.attachment_upload_parts) then
    raise exception 'STOP: attachment state remains';
  end if;

  if exists (
    select 1 from public.node_textboxes where body_json::text ~ 'mangoAttachmentImage|attachmentId|attachment_id'
    union all
    select 1 from public.node_textboxes_history where body_json::text ~ 'mangoAttachmentImage|attachmentId|attachment_id'
    union all
    select 1 from public.logic_gate_textboxes where body_json::text ~ 'mangoAttachmentImage|attachmentId|attachment_id'
    union all
    select 1 from public.logic_gate_textboxes_history where body_json::text ~ 'mangoAttachmentImage|attachmentId|attachment_id'
    union all
    select 1 from public.project_textboxes where body_json::text ~ 'mangoAttachmentImage|attachmentId|attachment_id'
    union all
    select 1 from public.project_textboxes_history where body_json::text ~ 'mangoAttachmentImage|attachmentId|attachment_id'
    union all
    select 1 from public.huddle_logic_gates where body_json::text ~ 'mangoAttachmentImage|attachmentId|attachment_id'
    union all
    select 1 from public.entities where body_json::text ~ 'mangoAttachmentImage|attachmentId|attachment_id'
  ) then
    raise exception 'STOP: a durable editor document still references an omitted attachment';
  end if;

  if exists (
    select 1 from public.email_messages
    where attachment_metadata <> '[]'::jsonb
       or folder_id_snapshot <> '[]'::jsonb
       or rich_html_body ~* 'mango-attachment:'
       or provider_message_id <> 'qa-copy-message:' || email_message_id::text
  ) then
    raise exception 'STOP: a retained email still has attachment/provider identifier state';
  end if;

  if exists (
    select 1 from public.email_threads
    where provider_thread_key <> 'qa-copy-thread:' || email_thread_id::text
       or provider_thread_id <> 'qa-copy-thread:' || email_thread_id::text
       or root_provider_message_id <> 'qa-copy-root:' || email_thread_id::text
  ) then
    raise exception 'STOP: a retained email thread still has imported provider identifiers';
  end if;

  if exists (select 1 from public.auth_external_identity_deletions)
     or exists (select 1 from public.invitations) then
    raise exception 'STOP: imported identity workflow state remains';
  end if;

  select count(*) into non_inert_user_count
  from public.users
  where cognito_subject <> 'qa-disabled:' || user_id::text;

  if current_database() ~ '^mangorts_qa_raw_' and non_inert_user_count <> 0 then
    raise exception 'STOP: a raw imported Cognito subject is not inert';
  end if;

  if current_database() !~ '^mangorts_qa_raw_' and (
    non_inert_user_count > 1
    or exists (
      select 1 from public.users
      where cognito_subject <> 'qa-disabled:' || user_id::text
        and lower(btrim(email)) <> 'jonathankim829@gmail.com'
    )
  ) then
    raise exception 'STOP: final QA contains an unapproved active Cognito mapping';
  end if;

  if exists (
    select 1 from public.email_connections
    where status <> 'configuration_required'
       or grant_id <> 'qa-disabled:' || email_connection_id::text
  ) then
    raise exception 'STOP: imported Nylas/provider connection state is active';
  end if;

  if exists (select 1 from public.email_ingestion_jobs)
     or exists (select 1 from public.communications_email_archive_job_items)
     or exists (select 1 from public.communications_email_archive_jobs)
     or exists (select 1 from public.communications_message_read_receipt_signals)
     or exists (select 1 from public.communications_message_read_receipt_summaries)
     or exists (select 1 from public.communications_triage_items)
     or exists (select 1 from public.email_drafts)
     or exists (select 1 from public.email_signatures)
     or exists (select 1 from public.notifications)
     or exists (select 1 from public.realtime_outbox)
     or exists (select 1 from public.domain_events)
     or exists (select 1 from public.recycle_bin_items)
     or exists (select 1 from public.workspace_derived_domain_event_projection_checkpoints)
     or exists (select 1 from public.workspace_read_versions)
     or exists (select 1 from public.process_map_actual_size_layout_recovery_placements)
     or exists (select 1 from public.process_map_actual_size_layout_recovery_runs) then
    raise exception 'STOP: imported job/event/delivery/recycle/checkpoint state remains';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.connamespace = 'public'::regnamespace
      and constraint_row.contype = 'f'
      and not constraint_row.convalidated
  ) then
    raise exception 'STOP: an unvalidated public foreign key remains';
  end if;

  -- A validated catalog flag does not prove imported data is valid. Inspect
  -- every public foreign key and anti-join its real child rows to the exact
  -- referenced key, including composite keys.
  for foreign_key_row in
    select constraint_row.conname,
           child_namespace.nspname as child_schema,
           child_table.relname as child_table,
           parent_namespace.nspname as parent_schema,
           parent_table.relname as parent_table,
           case constraint_row.confmatchtype
             when 'f' then '(' || string_agg(
               format('child.%I is not null', child_attribute.attname),
               ' or ' order by key_column.position
             ) || ')'
             else '(' || string_agg(
               format('child.%I is not null', child_attribute.attname),
               ' and ' order by key_column.position
             ) || ')'
           end as reference_required_predicate,
           string_agg(
             format('parent.%I = child.%I', parent_attribute.attname, child_attribute.attname),
             ' and ' order by key_column.position
           ) as parent_match_predicate
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class child_table
      on child_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace child_namespace
      on child_namespace.oid = child_table.relnamespace
    join pg_catalog.pg_class parent_table
      on parent_table.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace parent_namespace
      on parent_namespace.oid = parent_table.relnamespace
    cross join lateral unnest(constraint_row.conkey, constraint_row.confkey)
      with ordinality as key_column(child_attnum, parent_attnum, position)
    join pg_catalog.pg_attribute child_attribute
      on child_attribute.attrelid = constraint_row.conrelid
     and child_attribute.attnum = key_column.child_attnum
     and not child_attribute.attisdropped
    join pg_catalog.pg_attribute parent_attribute
      on parent_attribute.attrelid = constraint_row.confrelid
     and parent_attribute.attnum = key_column.parent_attnum
     and not parent_attribute.attisdropped
    where constraint_row.contype = 'f'
      and child_namespace.nspname = 'public'
    group by constraint_row.oid,
             constraint_row.conname,
             child_namespace.nspname,
             child_table.relname,
             parent_namespace.nspname,
             parent_table.relname,
             constraint_row.confmatchtype
    order by child_table.relname, constraint_row.conname
  loop
    foreign_key_count := foreign_key_count + 1;
    execute format(
      'select exists (' ||
      'select 1 from %I.%I child ' ||
      'where %s and not exists (' ||
      'select 1 from %I.%I parent where %s))',
      foreign_key_row.child_schema,
      foreign_key_row.child_table,
      foreign_key_row.reference_required_predicate,
      foreign_key_row.parent_schema,
      foreign_key_row.parent_table,
      foreign_key_row.parent_match_predicate
    ) into foreign_key_has_orphan;

    if foreign_key_has_orphan then
      raise exception 'STOP: public foreign key %.% (%) has orphaned child data',
        foreign_key_row.child_schema,
        foreign_key_row.child_table,
        foreign_key_row.conname;
    end if;
  end loop;

  if foreign_key_count = 0 then
    raise exception 'STOP: no public foreign keys were found for the data anti-join audit';
  end if;

  if exists (
    select 1
    from public.entity_fields field
    where field.field_type = 'person'
      and field.value_jsonb is not null
      and case
        when jsonb_typeof(field.value_jsonb) is distinct from 'string' then true
        when (field.value_jsonb #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
        else not exists (
          select 1
          from public.company_memberships membership
          where membership.company_id = field.company_id
            and membership.user_id::text = lower(field.value_jsonb #>> '{}')
        )
      end
  ) then
    raise exception 'STOP: an Entity person field has no exact same-company membership';
  end if;

  if exists (
    select 1
    from public.companies company
    where not exists (
      select 1
      from public.entity_types entity_type
      where entity_type.company_id = company.company_id
        and entity_type.entity_type_id = 'a17e0000-0000-4000-8000-000000000001'::uuid
        and entity_type.system_key = 'action_item'
        and entity_type.name = 'Action Item'
    )
  ) or exists (
    select 1
    from public.entity_types entity_type
    where entity_type.system_key = 'action_item'
      and (
        entity_type.entity_type_id <> 'a17e0000-0000-4000-8000-000000000001'::uuid
        or entity_type.name <> 'Action Item'
      )
  ) then
    raise exception 'STOP: a company is missing its exact required Action Item Entity Type';
  end if;

  if exists (
    with required(entity_field_type_id,system_key,name,field_type) as (
      values
        ('a17e0000-0000-4000-8000-000000000101'::uuid,'person_in_charge','Person in charge','person'),
        ('a17e0000-0000-4000-8000-000000000102'::uuid,'analysis_due_date','Analysis due date','date'),
        ('a17e0000-0000-4000-8000-000000000103'::uuid,'completion_due_date','Completion due date','date'),
        ('a17e0000-0000-4000-8000-000000000104'::uuid,'status','Status','choice'),
        ('a17e0000-0000-4000-8000-000000000105'::uuid,'color','Color','color')
    )
    select 1
    from public.companies company
    cross join required
    where not exists (
      select 1
      from public.entity_field_types field_type
      where field_type.company_id = company.company_id
        and field_type.entity_field_type_id = required.entity_field_type_id
        and field_type.entity_type_id = 'a17e0000-0000-4000-8000-000000000001'::uuid
        and field_type.entity_folder_id is null
        and field_type.system_key = required.system_key
        and field_type.name = required.name
        and field_type.field_type = required.field_type
        and case required.system_key
          when 'status' then
            field_type.config_jsonb ? 'default'
            and field_type.config_jsonb->>'default' = 'in_progress'
            and case
              when jsonb_typeof(field_type.config_jsonb->'options') = 'array'
              then jsonb_array_length(field_type.config_jsonb->'options')
              else -1
            end = 3
            and not exists (
              select 1
              from jsonb_array_elements(
                case when jsonb_typeof(field_type.config_jsonb->'options') = 'array'
                  then field_type.config_jsonb->'options' else '[]'::jsonb end
              ) option_value
              where option_value->>'key' not in ('in_progress','pending','done')
            )
            and (
              select count(distinct option_value->>'key')
              from jsonb_array_elements(
                case when jsonb_typeof(field_type.config_jsonb->'options') = 'array'
                  then field_type.config_jsonb->'options' else '[]'::jsonb end
              ) option_value
              where option_value->>'key' in ('in_progress','pending','done')
            ) = 3
          when 'color' then
            field_type.config_jsonb ? 'default'
            and field_type.config_jsonb->'default' = 'null'::jsonb
            and exists (
              select 1
              from jsonb_array_elements(
                case when jsonb_typeof(field_type.config_jsonb->'options') = 'array'
                  then field_type.config_jsonb->'options' else '[]'::jsonb end
              ) option_value
              where option_value->>'key' = 'yellow'
            )
            and exists (
              select 1
              from jsonb_array_elements(
                case when jsonb_typeof(field_type.config_jsonb->'options') = 'array'
                  then field_type.config_jsonb->'options' else '[]'::jsonb end
              ) option_value
              where option_value->>'key' = 'red'
            )
          else field_type.config_jsonb = '{}'::jsonb
        end
    )
  ) then
    raise exception 'STOP: a company is missing an exact required Action Item field template';
  end if;

  if exists (
    with required(entity_field_type_id,name,field_type) as (
      values
        ('a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person'),
        ('a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date'),
        ('a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date'),
        ('a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice'),
        ('a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color')
    )
    select 1
    from public.entities entity
    join public.entity_types entity_type
      on entity_type.company_id = entity.company_id
     and entity_type.entity_type_id = entity.entity_type_id
     and entity_type.system_key = 'action_item'
    cross join required
    where not exists (
      select 1
      from public.entity_fields field
      where field.company_id = entity.company_id
        and field.entity_id = entity.entity_id
        and field.entity_field_type_id = required.entity_field_type_id
        and field.name = required.name
        and field.field_type = required.field_type
    )
  ) then
    raise exception 'STOP: an Action Item Entity is missing a required linked field';
  end if;

  if exists (
    select 1
    from public.action_item_huddle_relationships relationship
    join public.entities entity
      on entity.company_id = relationship.company_id
     and entity.entity_id = relationship.entity_id
    join public.entity_types entity_type
      on entity_type.company_id = entity.company_id
     and entity_type.entity_type_id = entity.entity_type_id
    where entity_type.system_key is distinct from 'action_item'
  ) then
    raise exception 'STOP: an Action Item Huddle relationship points to a non-Action-Item Entity';
  end if;

  if exists (
    with generic_references(reference_kind, company_id, resource_type, resource_id) as (
      select 'resource_gvic_assignment', company_id, resource_type, resource_id
      from public.resource_gvic_assignments
      union all
      select 'resource_gvic_setting', company_id, resource_type, resource_id
      from public.resource_gvic_settings
      union all
      select 'resource_permission', company_id, resource_type, resource_id
      from public.resource_permissions
      union all
      select 'resource_permission_setting', company_id, resource_type, resource_id
      from public.resource_permission_settings
      union all
      select 'pin', company_id, resource_type, resource_id
      from public.pins
      union all
      select 'process_map_resource', company_id, resource_type, resource_id
      from public.process_map_placements
      union all
      select 'process_map_parent', company_id, 'company_explorer_folder', map_parent_folder_id
      from public.process_map_placements
      where map_parent_folder_id is not null
      union all
      select 'operational_source', company_id, source_resource_type, source_resource_id
      from public.resource_operational_relationships
      union all
      select 'operational_target', company_id, target_resource_type, target_resource_id
      from public.resource_operational_relationships
    )
    select 1
    from generic_references typed_reference
    where case typed_reference.resource_type
      when 'node' then not exists (
        select 1 from public.nodes endpoint
        where endpoint.company_id = typed_reference.company_id
          and endpoint.node_id = typed_reference.resource_id
      )
      when 'logic_gate' then not exists (
        select 1 from public.logic_gates endpoint
        where endpoint.company_id = typed_reference.company_id
          and endpoint.logic_gate_id = typed_reference.resource_id
      )
      when 'project' then not exists (
        select 1 from public.projects endpoint
        where endpoint.company_id = typed_reference.company_id
          and endpoint.project_id = typed_reference.resource_id
      )
      when 'company_explorer_folder' then not exists (
        select 1 from public.company_explorer_folders endpoint
        where endpoint.company_id = typed_reference.company_id
          and endpoint.folder_id = typed_reference.resource_id
      )
      when 'shared_inbox_folder' then not exists (
        select 1 from public.shared_inbox_folders endpoint
        where endpoint.company_id = typed_reference.company_id
          and endpoint.folder_id = typed_reference.resource_id
      )
      when 'shared_inbox' then not exists (
        select 1 from public.shared_inboxes endpoint
        where endpoint.company_id = typed_reference.company_id
          and endpoint.shared_inbox_id = typed_reference.resource_id
      )
      when 'huddle_logic_gate' then not exists (
        select 1 from public.huddle_logic_gates endpoint
        where endpoint.company_id = typed_reference.company_id
          and endpoint.huddle_logic_gate_id = typed_reference.resource_id
      )
      when 'huddle_node' then not exists (
        select 1 from public.huddle_nodes endpoint
        where endpoint.company_id = typed_reference.company_id
          and endpoint.huddle_node_id = typed_reference.resource_id
      )
      when 'email_message' then not exists (
        select 1 from public.email_messages endpoint
        where endpoint.company_id = typed_reference.company_id
          and endpoint.email_message_id = typed_reference.resource_id
      )
      else true
    end
  ) then
    raise exception 'STOP: a generic policy/GVIC, pin, process-map, or operational row has no exact same-company typed endpoint';
  end if;

  if exists (
    select 1
    from public.resource_gvic_assignments assignment
    where (assignment.principal_type = 'user' and not exists (
      select 1 from public.company_memberships membership
      where membership.company_id = assignment.company_id
        and membership.user_id = assignment.principal_id
    ))
    or (assignment.principal_type = 'group' and not exists (
      select 1 from public.company_user_groups user_group
      where user_group.company_id = assignment.company_id
        and user_group.group_id = assignment.principal_id
    ))
    or assignment.principal_type not in ('user', 'group')
    union all
    select 1
    from public.resource_permissions permission
    where (permission.subject_type = 'user' and not exists (
      select 1 from public.company_memberships membership
      where membership.company_id = permission.company_id
        and membership.user_id = permission.subject_id
    ))
    or (permission.subject_type = 'group' and not exists (
      select 1 from public.company_user_groups user_group
      where user_group.company_id = permission.company_id
        and user_group.group_id = permission.subject_id
    ))
    or permission.subject_type not in ('user', 'group')
  ) then
    raise exception 'STOP: a generic permission/GVIC principal has no exact same-company user or group';
  end if;

  if exists (
    with recursive
    imported_json_sources(company_id, source_kind, payload) as (
      select company_id, 'editor'::text, body_json from public.node_textboxes
      union all
      select company_id, 'editor', body_json from public.node_textboxes_history
      union all
      select company_id, 'editor', body_json from public.logic_gate_textboxes
      union all
      select company_id, 'editor', body_json from public.logic_gate_textboxes_history
      union all
      select company_id, 'editor', body_json from public.project_textboxes
      union all
      select company_id, 'editor', body_json from public.project_textboxes_history
      union all
      select company_id, 'editor', body_json from public.huddle_logic_gates
      union all
      select company_id, 'editor', body_json from public.entities
      union all
      select company_id, 'chat', entity_links from public.node_textbox_chats
      union all
      select company_id, 'chat', entity_links from public.project_textbox_chats
    ), imported_json_walk(company_id, source_kind, object_value) as (
      select company_id, source_kind, payload
      from imported_json_sources
      union all
      select walk.company_id, walk.source_kind, child.value
      from imported_json_walk walk
      cross join lateral jsonb_array_elements(
        case jsonb_typeof(walk.object_value)
          when 'object' then coalesce((
            select jsonb_agg(entry.value)
            from jsonb_each(walk.object_value) entry
          ), '[]'::jsonb)
          when 'array' then walk.object_value
          else '[]'::jsonb
        end
      ) child(value)
    ), normalized_links as (
      select walk.company_id,
             walk.source_kind,
             coalesce(
               nullif(lower(btrim(walk.object_value #>> '{attrs,entityType}')), ''),
               nullif(lower(btrim(walk.object_value ->> 'entity_type')), ''),
               nullif(lower(btrim(walk.object_value ->> 'entityType')), '')
             ) as entity_type,
             coalesce(
               nullif(lower(btrim(walk.object_value #>> '{attrs,entityId}')), ''),
               nullif(lower(btrim(walk.object_value ->> 'entity_id')), ''),
               nullif(lower(btrim(walk.object_value ->> 'entityID')), ''),
               nullif(lower(btrim(walk.object_value ->> 'entityId')), '')
             ) as entity_id,
             coalesce(
               nullif(lower(btrim(walk.object_value #>> '{attrs,emailMessageId}')), ''),
               nullif(lower(btrim(walk.object_value ->> 'email_message_id')), ''),
               nullif(lower(btrim(walk.object_value ->> 'emailMessageID')), ''),
               nullif(lower(btrim(walk.object_value ->> 'emailMessageId')), '')
             ) as email_message_id,
             coalesce(
               nullif(lower(btrim(walk.object_value #>> '{attrs,emailThreadId}')), ''),
               nullif(lower(btrim(walk.object_value ->> 'email_thread_id')), ''),
               nullif(lower(btrim(walk.object_value ->> 'emailThreadID')), ''),
               nullif(lower(btrim(walk.object_value ->> 'emailThreadId')), '')
             ) as email_thread_id
      from imported_json_walk walk
      where (walk.source_kind = 'editor' and walk.object_value ->> 'type' = 'mangoEntityLink')
         or (walk.source_kind = 'chat' and (
           walk.object_value ? 'entity_type' or walk.object_value ? 'entityType'
         ))
    )
    select 1
    from normalized_links link
    where link.entity_type is null
       or link.entity_id is null
       or case link.entity_type
         when 'node' then not exists (
           select 1 from public.nodes endpoint
           where endpoint.company_id = link.company_id
             and endpoint.node_id::text = link.entity_id
         )
         when 'logic_gate' then not exists (
           select 1 from public.logic_gates endpoint
           where endpoint.company_id = link.company_id
             and endpoint.logic_gate_id::text = link.entity_id
         )
          when 'project' then not exists (
            select 1 from public.projects endpoint
            where endpoint.company_id = link.company_id
              and endpoint.project_id::text = link.entity_id
          )
          when 'entity' then not exists (
            select 1 from public.entities endpoint
            where endpoint.company_id = link.company_id
              and endpoint.entity_id::text = link.entity_id
          )
          when 'email_message' then
           (link.email_message_id is not null and link.email_message_id <> link.entity_id)
           or (link.source_kind = 'editor' and (
             link.email_message_id is null or link.email_thread_id is null
           ))
           or not exists (
             select 1
             from public.email_messages message
             join public.email_threads thread
               on thread.company_id = message.company_id
              and thread.email_thread_id = message.email_thread_id
             where message.company_id = link.company_id
               and message.email_message_id::text = link.entity_id
               and (link.email_thread_id is null or message.email_thread_id::text = link.email_thread_id)
           )
         else true
       end
  ) then
    raise exception 'STOP: a retained TipTap/chat entity link has no exact same-company typed endpoint';
  end if;

  if exists (
    select 1
    from public.company_explorer_items item
    where (item.target_type = 'project' and not exists (
      select 1 from public.projects endpoint
      where endpoint.company_id = item.company_id and endpoint.project_id = item.target_id
    ))
    or (item.target_type = 'logic_gate' and not exists (
      select 1 from public.logic_gates endpoint
      where endpoint.company_id = item.company_id and endpoint.logic_gate_id = item.target_id
    ))
  ) then
    raise exception 'STOP: a company explorer item has no exact typed target';
  end if;

  if exists (
    select 1
    from public.huddle_explorer_items item
    where not exists (
      select 1 from public.huddle_logic_gates endpoint
      where endpoint.company_id = item.company_id
        and endpoint.huddle_logic_gate_id = item.resource_huddle_resource_id
    )
  ) then
    raise exception 'STOP: a Huddle explorer item has no exact typed target';
  end if;

  if exists (
    select 1
    from public.project_relationships relationship
    where (relationship.resource_type = 'node' and not exists (
      select 1 from public.nodes endpoint
      where endpoint.company_id = relationship.company_id and endpoint.node_id = relationship.resource_id
    ))
    or (relationship.resource_type = 'logic_gate' and not exists (
      select 1 from public.logic_gates endpoint
      where endpoint.company_id = relationship.company_id and endpoint.logic_gate_id = relationship.resource_id
    ))
  ) then
    raise exception 'STOP: a Project relationship has no exact typed target';
  end if;

  if exists (
    select 1
    from public.email_relationships relationship
    where (relationship.resource_type = 'node' and not exists (
      select 1 from public.nodes endpoint
      where endpoint.company_id = relationship.company_id and endpoint.node_id = relationship.resource_id
    ))
    or (relationship.resource_type = 'project' and not exists (
      select 1 from public.projects endpoint
      where endpoint.company_id = relationship.company_id and endpoint.project_id = relationship.resource_id
    ))
    or (relationship.resource_type = 'logic_gate' and not exists (
      select 1 from public.logic_gates endpoint
      where endpoint.company_id = relationship.company_id and endpoint.logic_gate_id = relationship.resource_id
    ))
  ) then
    raise exception 'STOP: an email relationship has no exact typed target';
  end if;

  if exists (
    select 1 from public.node_textbox_chats chat
    where chat.selection_source = 'email'
      and not exists (
        select 1 from public.email_messages message
        where message.company_id = chat.company_id
          and message.email_message_id = chat.selection_email_message_id
      )
    union all
    select 1 from public.project_textbox_chats chat
    where chat.selection_source = 'email'
      and not exists (
        select 1 from public.email_messages message
        where message.company_id = chat.company_id
          and message.email_message_id = chat.selection_email_message_id
      )
  ) then
    raise exception 'STOP: a retained chat points to an omitted email message';
  end if;

  if exists (
    select 1 from public.logic_gate_textboxes textbox
    where textbox.email_message_id <> ''
      and not exists (
        select 1 from public.email_messages message
        where message.company_id = textbox.company_id
          and message.email_message_id::text = textbox.email_message_id
      )
  ) then
    raise exception 'STOP: a retained Logic Gate textbox points to an omitted email message';
  end if;

  select count(*) into migration_count from public.schema_migrations;
  if current_database() ~ '^mangorts_qa_raw_' and migration_count <> 0 then
    raise exception 'STOP: raw sanitized data still carries the Dev migration ledger';
  end if;
  if current_database() !~ '^mangorts_qa_raw_' and migration_count = 0 then
    raise exception 'STOP: final canonical QA target has an empty migration ledger; the same-commit migration audit must verify exact filenames/count';
  end if;
end
$verify$;

select
  current_database() as database_name,
  current_setting('server_version') as server_version,
  current_setting('transaction_read_only')::boolean as transaction_read_only,
  (select count(*)::bigint from public.schema_migrations) as migration_ledger_rows;

select
  company.company_id,
  (select count(*)::bigint from public.company_memberships membership where membership.company_id = company.company_id) as membership_count,
  (select count(*)::bigint from public.projects endpoint where endpoint.company_id = company.company_id) as project_count,
  (select count(*)::bigint from public.logic_gates endpoint where endpoint.company_id = company.company_id) as logic_gate_count,
  (select count(*)::bigint from public.nodes endpoint where endpoint.company_id = company.company_id) as node_count,
  (select count(*)::bigint from public.entities endpoint where endpoint.company_id = company.company_id) as entity_count
from public.companies company
order by company.company_id;

select check_name, row_count
from (values
  ('companies', (select count(*)::bigint from public.companies)),
  ('users', (select count(*)::bigint from public.users)),
  ('memberships', (select count(*)::bigint from public.company_memberships)),
  ('projects', (select count(*)::bigint from public.projects)),
  ('logic_gates', (select count(*)::bigint from public.logic_gates)),
  ('nodes', (select count(*)::bigint from public.nodes)),
  ('entities', (select count(*)::bigint from public.entities)),
  ('email_threads', (select count(*)::bigint from public.email_threads)),
  ('email_messages', (select count(*)::bigint from public.email_messages)),
  ('permissions', (select count(*)::bigint from public.resource_permissions)),
  ('gvic_assignments', (select count(*)::bigint from public.resource_gvic_assignments)),
  ('attachments', (select count(*)::bigint from public.attachments)),
  ('domain_events', (select count(*)::bigint from public.domain_events)),
  ('realtime_outbox', (select count(*)::bigint from public.realtime_outbox)),
  ('notifications', (select count(*)::bigint from public.notifications)),
  ('recycle_bin_items', (select count(*)::bigint from public.recycle_bin_items))
) checks(check_name, row_count)
order by check_name;

commit;
