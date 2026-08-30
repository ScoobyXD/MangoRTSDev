-- Forward-only cutover from the shipped Action Item Source table to the
-- canonical protected Source Entity Field.
-- PostgreSQL 17.x compatible.

begin;

do $$
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'STOP: Action Item Source migration requires PostgreSQL 17 or newer' using errcode='55000';
  end if;
  if to_regclass('public.schema_migrations') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.entity_types') is null
     or to_regclass('public.entities') is null
     or to_regclass('public.entity_field_types') is null
     or to_regclass('public.entity_fields') is null
     or to_regclass('public.action_item_sources') is null
     or to_regclass('public.recycle_bin_items') is null
     or to_regclass('public.nodes') is null
     or to_regclass('public.logic_gates') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.huddle_nodes') is null
     or to_regclass('public.huddle_logic_gates') is null
     or to_regclass('public.kpis') is null then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;
end;
$$;

lock table schema_migrations,companies,entity_types,entities,entity_field_types,
  entity_fields,action_item_sources,recycle_bin_items,nodes,logic_gates,
  projects,huddle_nodes,huddle_logic_gates,kpis
in share row exclusive mode;

-- Fail before persistent writes unless this is exactly the state produced by
-- the originally shipped table-based migration.
do $$
declare
  expected_table record;
  actual_column_count integer;
  matched_column_count integer;
  protection_definition text;
begin
  if not exists (
       select 1 from schema_migrations
       where version='20260829_action_item_delegation_source.sql'
     )
     or exists (
       select 1 from schema_migrations
       where version='20260829_z_action_item_source_entity_field.sql'
     ) then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  for expected_table in
    select *
    from (values
      ('schema_migrations',array['version','applied_at']::text[]),
      ('entity_field_types',array[
        'company_id','entity_field_type_id','entity_type_id','entity_folder_id',
        'name','field_type','system_key','config_jsonb','position',
        'created_timestamp','updated_timestamp'
      ]::text[]),
      ('entity_fields',array[
        'company_id','entity_field_id','entity_id','entity_field_type_id',
        'name','field_type','value_jsonb','position','created_timestamp',
        'updated_timestamp'
      ]::text[]),
      ('action_item_sources',array[
        'company_id','entity_id','resource_type','resource_id','created_timestamp'
      ]::text[]),
      ('recycle_bin_items',array[
        'company_id','recycle_bin_item_id','object_kind','object_id','object_label',
        'object_folder_kind','restore_payload','deleted_by_user_id','deleted_timestamp'
      ]::text[])
    ) definition(table_name,column_names)
  loop
    select count(*),
           count(*) filter (where attribute.attname=any(expected_table.column_names))
    into actual_column_count,matched_column_count
    from pg_attribute attribute
    where attribute.attrelid=to_regclass('public.' || expected_table.table_name)
      and attribute.attnum>0
      and not attribute.attisdropped;

    if actual_column_count<>cardinality(expected_table.column_names)
       or matched_column_count<>cardinality(expected_table.column_names) then
      raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
    end if;
  end loop;

  if exists (
       select 1
       from (values
         ('company_id','uuid'::regtype,true,null::text),
         ('entity_id','uuid'::regtype,true,null::text),
         ('resource_type','text'::regtype,true,null::text),
         ('resource_id','uuid'::regtype,true,null::text),
         ('created_timestamp','timestamp with time zone'::regtype,true,'now()'::text)
       ) expected(column_name,type_oid,not_null,default_expression)
       left join pg_attribute attribute
         on attribute.attrelid='action_item_sources'::regclass
        and attribute.attname=expected.column_name
        and attribute.attnum>0
        and not attribute.attisdropped
       left join pg_attrdef default_row
         on default_row.adrelid=attribute.attrelid
        and default_row.adnum=attribute.attnum
       where attribute.attname is null
          or attribute.atttypid is distinct from expected.type_oid
          or attribute.attnotnull is distinct from expected.not_null
          or pg_get_expr(default_row.adbin,default_row.adrelid) is distinct from expected.default_expression
     ) then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  if not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid='action_item_sources'::regclass
         and constraint_row.conname='action_item_sources_pkey'
         and constraint_row.contype='p'
     )
     or not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid='action_item_sources'::regclass
         and constraint_row.conname='action_item_sources_entity_fkey'
         and constraint_row.contype='f'
         and constraint_row.confrelid='entities'::regclass
         and constraint_row.confdeltype='c'
     )
     or not exists (
       select 1
       from pg_constraint constraint_row
       where constraint_row.conrelid='action_item_sources'::regclass
         and constraint_row.conname='action_item_sources_resource_type_chk'
         and constraint_row.contype='c'
         and lower(pg_get_constraintdef(constraint_row.oid)) like '%node%'
         and lower(pg_get_constraintdef(constraint_row.oid)) like '%logic_gate%'
         and lower(pg_get_constraintdef(constraint_row.oid)) like '%project%'
         and lower(pg_get_constraintdef(constraint_row.oid)) like '%huddle_node%'
         and lower(pg_get_constraintdef(constraint_row.oid)) like '%huddle_logic_gate%'
         and lower(pg_get_constraintdef(constraint_row.oid)) like '%kpi%'
     )
     or not exists (
       select 1
       from pg_index index_row
       join pg_class index_class on index_class.oid=index_row.indexrelid
       where index_row.indrelid='action_item_sources'::regclass
         and index_class.relname='idx_action_item_sources_source'
         and index_row.indisvalid
         and lower(pg_get_indexdef(index_row.indexrelid)) like '%company_id, resource_type, resource_id, entity_id%'
     ) then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  if to_regprocedure('public.mangorts_validate_action_item_source()') is null
     or to_regprocedure('public.mangorts_delete_action_item_sources_for_resource()') is null
     or to_regprocedure('public.mangorts_protect_action_item_field_type()') is null
     or to_regprocedure('public.mangorts_protect_action_item_entity_field()') is null
     or to_regprocedure('public.mangorts_maintain_entity_field_template_link()') is null
     or to_regprocedure('public.mangorts_entity_field_type_config_valid(text,jsonb)') is null
     or to_regprocedure('public.mangorts_try_uuid(text)') is null
     or to_regprocedure('public.mangorts_entity_resource_exists(uuid,text,uuid)') is not null
     or to_regprocedure('public.mangorts_resource_is_in_recycle_payload(uuid,text,text,uuid)') is not null
     or to_regprocedure('public.mangorts_clear_entity_resource_fields_for_deleted_resource()') is not null
     or to_regprocedure('public.mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()') is not null
     or exists (
       select 1
       from pg_proc routine
       join pg_namespace namespace_row on namespace_row.oid=routine.pronamespace
       where namespace_row.nspname not in ('pg_catalog','information_schema')
         and routine.oid is distinct from to_regprocedure('public.mangorts_validate_action_item_source()')
         and routine.oid is distinct from to_regprocedure('public.mangorts_delete_action_item_sources_for_resource()')
         and lower(routine.prosrc) like '%action_item_sources%'
     ) then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  select lower(pg_get_functiondef('mangorts_protect_action_item_field_type()'::regprocedure))
  into protection_definition;
  if protection_definition not like '%assigned_by%'
     or protection_definition like '%''source''%' then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  select lower(pg_get_functiondef('mangorts_protect_action_item_entity_field()'::regprocedure))
  into protection_definition;
  if protection_definition not like '%assigned_by%'
     or protection_definition like '%''source''%' then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  select lower(pg_get_functiondef('mangorts_maintain_entity_field_template_link()'::regprocedure))
  into protection_definition;
  if protection_definition like '%mangorts_entity_resource_exists%'
     or protection_definition like '%field_type=''resource''%' then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  if not exists (
       select 1
       from pg_trigger trigger_row
       where trigger_row.tgrelid='action_item_sources'::regclass
         and trigger_row.tgname='trg_validate_action_item_source'
         and trigger_row.tgfoid='mangorts_validate_action_item_source()'::regprocedure
         and trigger_row.tgtype=31
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled<>'D'
     ) then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  if not exists (
       select 1 from pg_trigger trigger_row
       where trigger_row.tgrelid='entity_field_types'::regclass
         and trigger_row.tgname='trg_protect_action_item_field_type'
         and trigger_row.tgfoid='mangorts_protect_action_item_field_type()'::regprocedure
         and trigger_row.tgtype=31
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled<>'D'
     )
     or not exists (
       select 1 from pg_trigger trigger_row
       where trigger_row.tgrelid='entity_fields'::regclass
         and trigger_row.tgname='trg_maintain_entity_field_template_link'
         and trigger_row.tgfoid='mangorts_maintain_entity_field_template_link()'::regprocedure
         and trigger_row.tgtype=23
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled<>'D'
     )
     or not exists (
       select 1 from pg_trigger trigger_row
       where trigger_row.tgrelid='entity_fields'::regclass
         and trigger_row.tgname='trg_protect_action_item_entity_field'
         and trigger_row.tgfoid='mangorts_protect_action_item_entity_field()'::regprocedure
         and trigger_row.tgtype=31
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled<>'D'
     ) then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  if exists (
       select 1
       from (values
         ('nodes','trg_delete_node_action_item_sources'),
         ('logic_gates','trg_delete_logic_gate_action_item_sources'),
         ('projects','trg_delete_project_action_item_sources'),
         ('huddle_nodes','trg_delete_huddle_node_action_item_sources'),
         ('huddle_logic_gates','trg_delete_huddle_logic_gate_action_item_sources'),
         ('kpis','trg_delete_kpi_action_item_sources')
       ) expected(table_name,trigger_name)
       left join pg_class table_class
         on table_class.oid=to_regclass('public.' || expected.table_name)
       left join pg_trigger trigger_row
         on trigger_row.tgrelid=table_class.oid
        and trigger_row.tgname=expected.trigger_name
        and not trigger_row.tgisinternal
       where trigger_row.oid is null
          or trigger_row.tgfoid<>'mangorts_delete_action_item_sources_for_resource()'::regprocedure
          or trigger_row.tgtype<>9
          or trigger_row.tgenabled='D'
     ) then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  if exists (
       select 1
       from pg_trigger trigger_row
       where trigger_row.tgname in (
         'trg_clear_node_entity_resource_fields',
         'trg_clear_logic_gate_entity_resource_fields',
         'trg_clear_project_entity_resource_fields',
         'trg_clear_huddle_node_entity_resource_fields',
         'trg_clear_huddle_logic_gate_entity_resource_fields',
         'trg_clear_kpi_entity_resource_fields',
         'trg_clear_entity_resource_fields_on_permanent_recycle_delete'
       )
         and not trigger_row.tgisinternal
     )
     or to_regclass('public.idx_entity_fields_resource_endpoint') is not null
     or exists (
       select 1 from entity_field_types
       where entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
     )
     or exists (
       select 1 from entity_fields
       where entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
     ) then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  if not exists (
       select 1 from pg_constraint
       where conrelid='entity_field_types'::regclass
         and conname='entity_field_types_field_type_chk'
         and position('resource' in lower(pg_get_constraintdef(oid)))=0
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid='entity_fields'::regclass
         and conname='entity_fields_field_type_chk'
         and position('resource' in lower(pg_get_constraintdef(oid)))=0
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid='entity_fields'::regclass
         and conname='entity_fields_value_shape_chk'
         and position('resource' in lower(pg_get_constraintdef(oid)))=0
     )
     or to_regclass('public.idx_entity_fields_action_item_assigned_by') is null
     or to_regclass('public.idx_entity_fields_entity_field_type_unique') is null
     or to_regclass('public.idx_entity_field_types_type_system_key_unique') is null then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;

  if exists (
       with expected(entity_field_type_id,name,field_type,system_key,position) as (
         values
           ('a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person','person_in_charge',0),
           ('a17e0000-0000-4000-8000-000000000106'::uuid,'Assigned by','person','assigned_by',1),
           ('a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date','analysis_due_date',2),
           ('a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date','completion_due_date',3),
           ('a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice','status',4),
           ('a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color','color',5)
       )
       select 1
       from companies company
       cross join expected
       left join entity_field_types template
         on template.company_id=company.company_id
        and template.entity_field_type_id=expected.entity_field_type_id
       where template.entity_field_type_id is null
           or template.entity_type_id is distinct from 'a17e0000-0000-4000-8000-000000000001'::uuid
           or template.entity_folder_id is not null
           or template.name is distinct from expected.name
           or template.field_type is distinct from expected.field_type
           or template.system_key is distinct from expected.system_key
           or template.position is distinct from expected.position
     )
     or exists (
       with expected(entity_field_type_id,name,field_type,position) as (
         values
           ('a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person',0),
           ('a17e0000-0000-4000-8000-000000000106'::uuid,'Assigned by','person',1),
           ('a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date',2),
           ('a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date',3),
           ('a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice',4),
           ('a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color',5)
       ), action_items as (
         select entity.company_id,entity.entity_id
         from entities entity
         join entity_types entity_type
           on entity_type.company_id=entity.company_id
          and entity_type.entity_type_id=entity.entity_type_id
          and entity_type.system_key='action_item'
       )
       select 1
       from action_items action_item
       cross join expected
       left join entity_fields field
         on field.company_id=action_item.company_id
        and field.entity_id=action_item.entity_id
        and field.entity_field_type_id=expected.entity_field_type_id
       where field.entity_field_id is null
           or field.name is distinct from expected.name
           or field.field_type is distinct from expected.field_type
           or field.position is distinct from expected.position
     ) then
    raise exception 'STOP: Action Item Source migration requires exact PRIOR_APPLIED state' using errcode='55000';
  end if;
end;
$$;

-- Validate every legacy recycle member before parsing it into typed candidates.
do $$
begin
  if exists (
       select 1
       from recycle_bin_items recycle
       where recycle.restore_payload ? 'action_item_sources'
         and (
           jsonb_typeof(recycle.restore_payload)<>'object'
           or jsonb_typeof(recycle.restore_payload->'action_item_sources')<>'array'
         )
     ) then
    raise exception 'STOP: malformed legacy Action Item Source recycle payload' using errcode='22023';
  end if;

  if exists (
       select 1
       from recycle_bin_items recycle
       cross join lateral jsonb_array_elements(
         case
           when jsonb_typeof(recycle.restore_payload->'action_item_sources')='array'
             then recycle.restore_payload->'action_item_sources'
           else '[]'::jsonb
         end
       ) restored(row_json)
       where jsonb_typeof(restored.row_json)<>'object'
          or not (restored.row_json ?& array[
            'company_id','entity_id','resource_type','resource_id','created_timestamp'
          ]::text[])
          or (restored.row_json-array[
            'company_id','entity_id','resource_type','resource_id','created_timestamp'
          ]::text[])<>'{}'::jsonb
          or jsonb_typeof(restored.row_json->'company_id')<>'string'
          or mangorts_try_uuid(restored.row_json->>'company_id') is null
          or mangorts_try_uuid(restored.row_json->>'company_id')::text<>restored.row_json->>'company_id'
          or jsonb_typeof(restored.row_json->'entity_id')<>'string'
          or mangorts_try_uuid(restored.row_json->>'entity_id') is null
          or mangorts_try_uuid(restored.row_json->>'entity_id')::text<>restored.row_json->>'entity_id'
          or jsonb_typeof(restored.row_json->'resource_type')<>'string'
          or restored.row_json->>'resource_type' not in (
            'node','logic_gate','project','huddle_node','huddle_logic_gate','kpi'
          )
          or jsonb_typeof(restored.row_json->'resource_id')<>'string'
          or mangorts_try_uuid(restored.row_json->>'resource_id') is null
          or mangorts_try_uuid(restored.row_json->>'resource_id')::text<>restored.row_json->>'resource_id'
          or jsonb_typeof(restored.row_json->'created_timestamp')<>'string'
          or not pg_input_is_valid(
            restored.row_json->>'created_timestamp','timestamp with time zone'
          )
     ) then
    raise exception 'STOP: malformed legacy Action Item Source row' using errcode='22023';
  end if;
end;
$$;

create temporary table mangorts_action_item_source_candidates_raw
on commit drop
as
select 'live'::text origin,
       null::uuid recycle_bin_item_id,
       source.company_id recycle_company_id,
       source.company_id,
       source.entity_id,
       source.resource_type,
       source.resource_id,
       null::jsonb restore_payload
from action_item_sources source
union all
select 'recycle'::text,
       recycle.recycle_bin_item_id,
       recycle.company_id,
       mangorts_try_uuid(restored.row_json->>'company_id'),
       mangorts_try_uuid(restored.row_json->>'entity_id'),
       restored.row_json->>'resource_type',
       mangorts_try_uuid(restored.row_json->>'resource_id'),
       recycle.restore_payload
from recycle_bin_items recycle
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(recycle.restore_payload->'action_item_sources')='array'
      then recycle.restore_payload->'action_item_sources'
    else '[]'::jsonb
  end
) restored(row_json);

do $$
begin
  if exists (
       select 1
       from mangorts_action_item_source_candidates_raw candidate
       where candidate.origin='recycle'
         and candidate.company_id is distinct from candidate.recycle_company_id
     ) then
    raise exception 'STOP: malformed legacy Action Item Source row' using errcode='22023';
  end if;

  if exists (
       select 1
       from mangorts_action_item_source_candidates_raw candidate
       left join entities entity
         on entity.company_id=candidate.company_id
        and entity.entity_id=candidate.entity_id
       left join entity_types entity_type
         on entity_type.company_id=entity.company_id
        and entity_type.entity_type_id=entity.entity_type_id
       where entity.entity_id is null
          or entity_type.system_key is distinct from 'action_item'
     ) then
    raise exception 'STOP: legacy Action Item Source requires a same-company Action Item' using errcode='23503';
  end if;

  if exists (
       select 1
       from mangorts_action_item_source_candidates_raw candidate
       where candidate.origin='live'
         and not case candidate.resource_type
           when 'node' then exists(
             select 1 from nodes
             where company_id=candidate.company_id and node_id=candidate.resource_id
           )
           when 'logic_gate' then exists(
             select 1 from logic_gates
             where company_id=candidate.company_id and logic_gate_id=candidate.resource_id
           )
           when 'project' then exists(
             select 1 from projects
             where company_id=candidate.company_id and project_id=candidate.resource_id
           )
           when 'huddle_node' then exists(
             select 1 from huddle_nodes
             where company_id=candidate.company_id and huddle_node_id=candidate.resource_id
           )
           when 'huddle_logic_gate' then exists(
             select 1 from huddle_logic_gates
             where company_id=candidate.company_id
               and huddle_logic_gate_id=candidate.resource_id
               and deleted_timestamp is null
           )
           when 'kpi' then exists(
             select 1 from kpis
             where company_id=candidate.company_id
               and kpi_id=candidate.resource_id
               and deleted_timestamp is null
           )
           else false
         end
     ) then
    raise exception 'STOP: legacy Action Item Source endpoint is unsupported, missing, or mismatched' using errcode='23503';
  end if;

  if exists (
       select 1
       from mangorts_action_item_source_candidates_raw candidate
       where candidate.origin='recycle'
         and (
           case candidate.resource_type
             when 'node' then exists(
               select 1 from nodes
               where company_id=candidate.company_id and node_id=candidate.resource_id
             )
             when 'logic_gate' then exists(
               select 1 from logic_gates
               where company_id=candidate.company_id and logic_gate_id=candidate.resource_id
             )
             when 'project' then exists(
               select 1 from projects
               where company_id=candidate.company_id and project_id=candidate.resource_id
             )
             when 'huddle_node' then exists(
               select 1 from huddle_nodes
               where company_id=candidate.company_id and huddle_node_id=candidate.resource_id
             )
             when 'huddle_logic_gate' then exists(
               select 1 from huddle_logic_gates
               where company_id=candidate.company_id
                 and huddle_logic_gate_id=candidate.resource_id
                 and deleted_timestamp is null
             )
             when 'kpi' then exists(
               select 1 from kpis
               where company_id=candidate.company_id
                 and kpi_id=candidate.resource_id
                 and deleted_timestamp is null
             )
             else true
           end
           or not case candidate.resource_type
             when 'node' then exists(
               select 1
               from jsonb_array_elements(
                 case when jsonb_typeof(candidate.restore_payload->'nodes')='array'
                   then candidate.restore_payload->'nodes' else '[]'::jsonb end
               ) endpoint(row_json)
               where endpoint.row_json->>'company_id'=candidate.company_id::text
                 and endpoint.row_json->>'node_id'=candidate.resource_id::text
             )
             when 'logic_gate' then exists(
               select 1
               from jsonb_array_elements(
                 case when jsonb_typeof(candidate.restore_payload->'logic_gates')='array'
                   then candidate.restore_payload->'logic_gates' else '[]'::jsonb end
               ) endpoint(row_json)
               where endpoint.row_json->>'company_id'=candidate.company_id::text
                 and endpoint.row_json->>'logic_gate_id'=candidate.resource_id::text
             )
             when 'project' then exists(
               select 1
               from jsonb_array_elements(
                 case when jsonb_typeof(candidate.restore_payload->'projects')='array'
                   then candidate.restore_payload->'projects' else '[]'::jsonb end
               ) endpoint(row_json)
               where endpoint.row_json->>'company_id'=candidate.company_id::text
                 and endpoint.row_json->>'project_id'=candidate.resource_id::text
             )
             when 'huddle_node' then exists(
               select 1
               from jsonb_array_elements(
                 case when jsonb_typeof(candidate.restore_payload->'huddle_nodes')='array'
                   then candidate.restore_payload->'huddle_nodes' else '[]'::jsonb end
               ) endpoint(row_json)
               where endpoint.row_json->>'company_id'=candidate.company_id::text
                 and endpoint.row_json->>'huddle_node_id'=candidate.resource_id::text
             )
             when 'huddle_logic_gate' then exists(
               select 1
               from jsonb_array_elements(
                 case when jsonb_typeof(candidate.restore_payload->'huddle_logic_gates')='array'
                   then candidate.restore_payload->'huddle_logic_gates' else '[]'::jsonb end
               ) endpoint(row_json)
               where endpoint.row_json->>'company_id'=candidate.company_id::text
                 and endpoint.row_json->>'huddle_logic_gate_id'=candidate.resource_id::text
             )
             when 'kpi' then exists(
               select 1
               from jsonb_array_elements(
                 case when jsonb_typeof(candidate.restore_payload->'kpis')='array'
                   then candidate.restore_payload->'kpis' else '[]'::jsonb end
               ) endpoint(row_json)
               where endpoint.row_json->>'company_id'=candidate.company_id::text
                 and endpoint.row_json->>'kpi_id'=candidate.resource_id::text
             )
             else false
           end
         )
     ) then
    raise exception 'STOP: legacy Action Item Source endpoint is unsupported, missing, or mismatched' using errcode='23503';
  end if;

  if exists (
       select 1
       from mangorts_action_item_source_candidates_raw
       group by company_id,entity_id
       having count(distinct (resource_type,resource_id))>1
     ) then
    raise exception 'STOP: conflicting legacy Action Item Source pairs' using errcode='23514';
  end if;
end;
$$;

create temporary table mangorts_action_item_source_candidates
on commit drop
as
select distinct company_id,entity_id,resource_type,resource_id
from mangorts_action_item_source_candidates_raw;

create unique index mangorts_action_item_source_candidates_identity
  on mangorts_action_item_source_candidates(company_id,entity_id);

create temporary table mangorts_assigned_by_templates_before
on commit drop
as
select company_id,entity_field_type_id,to_jsonb(template) row_json
from entity_field_types template
where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid;

create temporary table mangorts_assigned_by_fields_before
on commit drop
as
select company_id,entity_field_id,to_jsonb(field) row_json
from entity_fields field
where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid;

-- Resource is reserved for the one canonical Source field.
alter table entity_field_types
  drop constraint entity_field_types_field_type_chk,
  add constraint entity_field_types_field_type_chk
    check (field_type in ('text','number','date','boolean','choice','color','person','resource'));

alter table entity_fields
  drop constraint entity_fields_field_type_chk,
  add constraint entity_fields_field_type_chk
    check (field_type in ('text','number','date','boolean','choice','color','person','resource')),
  drop constraint entity_fields_value_shape_chk,
  add constraint entity_fields_value_shape_chk check (
    value_jsonb is null
    or (field_type in ('text','date','choice','color') and jsonb_typeof(value_jsonb)='string')
    or (field_type='person'
        and jsonb_typeof(value_jsonb)='string'
        and (value_jsonb #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (field_type='number' and jsonb_typeof(value_jsonb)='number')
    or (field_type='boolean' and jsonb_typeof(value_jsonb)='boolean')
    or (field_type='resource'
        and jsonb_typeof(value_jsonb)='object'
        and jsonb_typeof(value_jsonb->'resource_type')='string'
        and jsonb_typeof(value_jsonb->'resource_id')='string'
        and value_jsonb=jsonb_build_object(
          'resource_type',value_jsonb->>'resource_type',
          'resource_id',value_jsonb->>'resource_id'
        )
        and (value_jsonb->>'resource_type') in ('node','logic_gate','project','huddle_node','huddle_logic_gate','kpi')
        and (value_jsonb->>'resource_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and (value_jsonb->>'resource_id')=(value_jsonb->>'resource_id')::uuid::text)
  );

-- Only custom Source collisions are renamed. Assigned by is already canonical
-- in PRIOR_APPLIED state and is deliberately never touched here.
update entity_fields field
set name='Source (custom ' || field.entity_field_id::text || ')',
    updated_timestamp=now()
from entities entity
join entity_types entity_type
  on entity_type.company_id=entity.company_id
 and entity_type.entity_type_id=entity.entity_type_id
 and entity_type.system_key='action_item'
where field.company_id=entity.company_id
  and field.entity_id=entity.entity_id
  and field.entity_field_type_id is distinct from 'a17e0000-0000-4000-8000-000000000107'::uuid
  and lower(btrim(field.name))='source';

update entity_field_types template
set name=case
      when lower(btrim(template.name))='source'
        then 'Source (custom ' || template.entity_field_type_id::text || ')'
      else template.name
    end,
    system_key=case when template.system_key='source' then null else template.system_key end,
    updated_timestamp=now()
from entity_types entity_type
where entity_type.company_id=template.company_id
  and entity_type.entity_type_id=template.entity_type_id
  and entity_type.system_key='action_item'
  and template.entity_field_type_id<>'a17e0000-0000-4000-8000-000000000107'::uuid
  and (lower(btrim(template.name))='source' or template.system_key='source');

-- The old Entity-field guards are intentionally still active for this copy.
insert into entity_field_types (
  company_id,entity_field_type_id,entity_type_id,entity_folder_id,
  name,field_type,system_key,config_jsonb,position
)
select company.company_id,
       'a17e0000-0000-4000-8000-000000000107'::uuid,
       'a17e0000-0000-4000-8000-000000000001'::uuid,
       null,'Source','resource','source','{}'::jsonb,6
from companies company;

insert into entity_fields (
  company_id,entity_field_id,entity_id,entity_field_type_id,
  name,field_type,value_jsonb,position
)
select entity.company_id,gen_random_uuid(),entity.entity_id,
       'a17e0000-0000-4000-8000-000000000107'::uuid,
       'Source','resource',
       case when candidate.entity_id is null then null
            else jsonb_build_object(
              'resource_type',candidate.resource_type,
              'resource_id',candidate.resource_id::text
            )
       end,
       6
from entities entity
join entity_types entity_type
  on entity_type.company_id=entity.company_id
 and entity_type.entity_type_id=entity.entity_type_id
 and entity_type.system_key='action_item'
left join mangorts_action_item_source_candidates candidate
  on candidate.company_id=entity.company_id
 and candidate.entity_id=entity.entity_id;

do $$
begin
  if exists (
       select 1
       from mangorts_action_item_source_candidates candidate
       left join entity_fields field
         on field.company_id=candidate.company_id
        and field.entity_id=candidate.entity_id
        and field.entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
       where field.entity_field_id is null
          or field.value_jsonb is distinct from jsonb_build_object(
            'resource_type',candidate.resource_type,
            'resource_id',candidate.resource_id::text
          )
     )
     or exists (
       select 1
       from entity_fields field
       left join mangorts_action_item_source_candidates candidate
         on candidate.company_id=field.company_id
        and candidate.entity_id=field.entity_id
       where field.entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
         and candidate.entity_id is null
         and field.value_jsonb is not null
     )
     or exists (
       select 1
       from entities entity
       join entity_types entity_type
         on entity_type.company_id=entity.company_id
        and entity_type.entity_type_id=entity.entity_type_id
        and entity_type.system_key='action_item'
       left join entity_fields field
         on field.company_id=entity.company_id
        and field.entity_id=entity.entity_id
        and field.entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
       group by entity.company_id,entity.entity_id
       having count(field.entity_field_id)<>1
     ) then
    raise exception 'STOP: Action Item Source copy verification failed' using errcode='23514';
  end if;

  if exists (
       (select company_id,entity_field_type_id,row_json from mangorts_assigned_by_templates_before
        except
        select company_id,entity_field_type_id,to_jsonb(template)
        from entity_field_types template
        where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid)
       union all
       (select company_id,entity_field_type_id,to_jsonb(template)
        from entity_field_types template
        where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
        except
        select company_id,entity_field_type_id,row_json from mangorts_assigned_by_templates_before)
     )
     or exists (
       (select company_id,entity_field_id,row_json from mangorts_assigned_by_fields_before
        except
        select company_id,entity_field_id,to_jsonb(field)
        from entity_fields field
        where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid)
       union all
       (select company_id,entity_field_id,to_jsonb(field)
        from entity_fields field
        where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
        except
        select company_id,entity_field_id,row_json from mangorts_assigned_by_fields_before)
     ) then
    raise exception 'STOP: Assigned by changed during Action Item Source migration' using errcode='23514';
  end if;
end;
$$;

update recycle_bin_items
set restore_payload=restore_payload-'action_item_sources'
where restore_payload ? 'action_item_sources';

drop trigger trg_delete_node_action_item_sources on nodes;
drop trigger trg_delete_logic_gate_action_item_sources on logic_gates;
drop trigger trg_delete_project_action_item_sources on projects;
drop trigger trg_delete_huddle_node_action_item_sources on huddle_nodes;
drop trigger trg_delete_huddle_logic_gate_action_item_sources on huddle_logic_gates;
drop trigger trg_delete_kpi_action_item_sources on kpis;

drop table action_item_sources;

drop function mangorts_validate_action_item_source();
drop function mangorts_delete_action_item_sources_for_resource();

create index idx_entity_fields_resource_endpoint
  on entity_fields(
    company_id,
    (value_jsonb->>'resource_type'),
    mangorts_try_uuid(value_jsonb->>'resource_id'),
    entity_id
  )
  where field_type='resource' and value_jsonb is not null;

create or replace function mangorts_entity_resource_exists(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
) returns boolean
language sql
stable
set search_path=public,pg_temp
as $$
  select case p_resource_type
    when 'node' then exists(
      select 1 from nodes where company_id=p_company_id and node_id=p_resource_id
    )
    when 'logic_gate' then exists(
      select 1 from logic_gates where company_id=p_company_id and logic_gate_id=p_resource_id
    )
    when 'project' then exists(
      select 1 from projects where company_id=p_company_id and project_id=p_resource_id
    )
    when 'huddle_node' then exists(
      select 1 from huddle_nodes where company_id=p_company_id and huddle_node_id=p_resource_id
    )
    when 'huddle_logic_gate' then exists(
      select 1 from huddle_logic_gates
      where company_id=p_company_id and huddle_logic_gate_id=p_resource_id and deleted_timestamp is null
    )
    when 'kpi' then exists(
      select 1 from kpis
      where company_id=p_company_id and kpi_id=p_resource_id and deleted_timestamp is null
    )
    else false
  end
$$;

create or replace function mangorts_protect_action_item_field_type()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  old_is_action_item boolean := false;
  new_is_action_item boolean := false;
  old_is_required boolean := false;
  expected_id uuid;
  expected_name text;
  expected_field_type text;
begin
  if tg_op <> 'DELETE'
     and new.field_type='resource'
     and (
       new.entity_field_type_id <> 'a17e0000-0000-4000-8000-000000000107'::uuid
       or new.entity_type_id <> 'a17e0000-0000-4000-8000-000000000001'::uuid
       or new.entity_folder_id is not null
       or new.system_key is distinct from 'source'
       or new.name <> 'Source'
     ) then
    raise exception 'entity_resource_field_type_reserved' using errcode='23514';
  end if;

  if tg_op <> 'INSERT' then
    select coalesce(entity_type.system_key='action_item',false)
    into old_is_action_item
    from entity_types entity_type
    where entity_type.company_id=old.company_id
      and entity_type.entity_type_id=old.entity_type_id;

    old_is_required := coalesce(old_is_action_item,false)
      and old.system_key in ('person_in_charge','assigned_by','analysis_due_date','completion_due_date','status','color','source');

    if tg_op = 'DELETE' then
      if old_is_required
         and exists (select 1 from companies where company_id=old.company_id) then
        raise exception 'action_item_field_type_required:%',old.system_key using errcode='23514';
      end if;
      return old;
    end if;

    if old_is_required and (
      new.company_id is distinct from old.company_id
      or new.entity_field_type_id is distinct from old.entity_field_type_id
      or new.entity_type_id is distinct from old.entity_type_id
      or new.entity_folder_id is distinct from old.entity_folder_id
      or new.system_key is distinct from old.system_key
      or new.name is distinct from old.name
      or new.field_type is distinct from old.field_type
    ) then
      raise exception 'action_item_field_type_immutable:%',old.system_key using errcode='23514';
    end if;
  end if;

  select coalesce(entity_type.system_key='action_item',false)
  into new_is_action_item
  from entity_types entity_type
  where entity_type.company_id=new.company_id
    and entity_type.entity_type_id=new.entity_type_id;

  if not coalesce(new_is_action_item,false) then
    return new;
  end if;

  if new.system_key is null
     or new.system_key not in ('person_in_charge','assigned_by','analysis_due_date','completion_due_date','status','color','source') then
    if lower(btrim(new.name)) in ('person in charge','assigned by','analysis due date','completion due date','status','color','source') then
      raise exception 'action_item_field_type_name_reserved:%',new.name using errcode='23514';
    end if;
    return new;
  end if;

  select definition.expected_id,definition.expected_name,definition.expected_field_type
  into expected_id,expected_name,expected_field_type
  from (values
    ('person_in_charge','a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person'),
    ('assigned_by','a17e0000-0000-4000-8000-000000000106'::uuid,'Assigned by','person'),
    ('analysis_due_date','a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date'),
    ('completion_due_date','a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date'),
    ('status','a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice'),
    ('color','a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color'),
    ('source','a17e0000-0000-4000-8000-000000000107'::uuid,'Source','resource')
  ) as definition(system_key,expected_id,expected_name,expected_field_type)
  where definition.system_key=new.system_key;

  if new.entity_field_type_id <> expected_id
     or new.entity_folder_id is not null
     or new.name <> expected_name
     or new.field_type <> expected_field_type then
    raise exception 'action_item_field_type_invalid:%',new.system_key using errcode='23514';
  end if;

  if not mangorts_entity_field_type_config_valid(new.field_type,new.config_jsonb) then
    raise exception 'action_item_field_type_config_invalid:%',new.system_key using errcode='23514';
  end if;

  if new.system_key='status' and (
    not (new.config_jsonb ? 'default')
    or new.config_jsonb->>'default' is distinct from 'in_progress'
    or jsonb_array_length(new.config_jsonb->'options') <> 3
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='in_progress')
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='pending')
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='done')
  ) then
    raise exception 'action_item_status_config_required' using errcode='23514';
  end if;

  if new.system_key='color' and (
    not (new.config_jsonb ? 'default')
    or new.config_jsonb->'default' is distinct from 'null'::jsonb
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='yellow')
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='red')
  ) then
    raise exception 'action_item_color_config_required' using errcode='23514';
  end if;

  return new;
end;
$$;

create or replace function mangorts_maintain_entity_field_template_link()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  template_field_type text;
  template_config jsonb;
  template_system_key text;
  template_entity_type_id uuid;
  person_id text;
  resource_type text;
  resource_id_text text;
  resource_id uuid;
  date_text text;
  parsed_date date;
begin
  if tg_op='UPDATE'
     and new.field_type is distinct from old.field_type
     and new.entity_field_type_id is not distinct from old.entity_field_type_id then
    new.entity_field_type_id := null;
  end if;

  if new.entity_field_type_id is not null then
    select template.field_type,template.config_jsonb,template.system_key,template.entity_type_id
    into template_field_type,template_config,template_system_key,template_entity_type_id
    from entity_field_types template
    join entities entity
      on entity.company_id=new.company_id
     and entity.entity_id=new.entity_id
     and entity.entity_type_id=template.entity_type_id
    where template.company_id=new.company_id
      and template.entity_field_type_id=new.entity_field_type_id;
    if not found then
      raise exception 'entity_field_type_link_invalid' using errcode='23503';
    end if;
    if template_field_type<>new.field_type then
      raise exception 'entity_field_type_link_kind_mismatch' using errcode='23514';
    end if;
    if new.value_jsonb is not null and new.field_type in ('choice','color')
       and not exists(
         select 1 from jsonb_array_elements(template_config->'options') option_value
          where option_value->>'key'=(new.value_jsonb #>> '{}')
       ) then
      raise exception 'entity_field_option_invalid' using errcode='23514';
    end if;
  end if;

  if new.field_type='resource' and (
    new.entity_field_type_id is null
    or new.entity_field_type_id <> 'a17e0000-0000-4000-8000-000000000107'::uuid
    or template_entity_type_id is distinct from 'a17e0000-0000-4000-8000-000000000001'::uuid
    or template_system_key is distinct from 'source'
    or new.name <> 'Source'
  ) then
    raise exception 'entity_resource_field_reserved' using errcode='23514';
  end if;

  if new.value_jsonb is not null and new.field_type='date' then
    date_text := new.value_jsonb #>> '{}';
    if jsonb_typeof(new.value_jsonb) is distinct from 'string'
       or date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'entity_field_date_invalid' using errcode='23514';
    end if;
    begin
      parsed_date := date_text::date;
    exception when others then
      raise exception 'entity_field_date_invalid' using errcode='23514';
    end;
    if to_char(parsed_date,'YYYY-MM-DD')<>date_text then
      raise exception 'entity_field_date_invalid' using errcode='23514';
    end if;
  end if;

  if new.value_jsonb is not null and new.field_type='person' then
    person_id := new.value_jsonb #>> '{}';
    if person_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists(
         select 1 from company_memberships membership
         where membership.company_id=new.company_id and membership.user_id=person_id::uuid
       ) then
      raise exception 'entity_field_person_not_company_member' using errcode='23503';
    end if;
  end if;

  if new.value_jsonb is not null and new.field_type='resource' then
    resource_type := new.value_jsonb->>'resource_type';
    resource_id_text := new.value_jsonb->>'resource_id';
    resource_id := mangorts_try_uuid(resource_id_text);
    if resource_type not in ('node','logic_gate','project','huddle_node','huddle_logic_gate','kpi')
       or resource_id is null
       or resource_id::text<>resource_id_text
       or not mangorts_entity_resource_exists(new.company_id,resource_type,resource_id) then
      raise exception 'entity_field_resource_not_found' using errcode='23503';
    end if;
  end if;

  return new;
end;
$$;

create or replace function mangorts_protect_action_item_entity_field()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  old_system_key text;
  old_is_required boolean := false;
  new_system_key text;
  new_expected_name text;
  new_expected_field_type text;
begin
  if tg_op <> 'INSERT' and old.entity_field_type_id is not null then
    select template.system_key
    into old_system_key
    from entity_field_types template
    join entity_types entity_type
      on entity_type.company_id=template.company_id
     and entity_type.entity_type_id=template.entity_type_id
     and entity_type.system_key='action_item'
    where template.company_id=old.company_id
      and template.entity_field_type_id=old.entity_field_type_id;

    old_is_required := old_system_key in ('person_in_charge','assigned_by','analysis_due_date','completion_due_date','status','color','source');

    if tg_op = 'DELETE' then
      if old_is_required
         and exists (
           select 1 from entities entity
           where entity.company_id=old.company_id and entity.entity_id=old.entity_id
         ) then
        raise exception 'action_item_entity_field_required:%',old_system_key using errcode='23514';
      end if;
      return old;
    end if;

    if old_is_required and (
      new.company_id is distinct from old.company_id
      or new.entity_field_id is distinct from old.entity_field_id
      or new.entity_id is distinct from old.entity_id
      or new.entity_field_type_id is distinct from old.entity_field_type_id
      or new.name is distinct from old.name
      or new.field_type is distinct from old.field_type
    ) then
      raise exception 'action_item_entity_field_immutable:%',old_system_key using errcode='23514';
    end if;

    if old_system_key='source'
       and new.value_jsonb is distinct from old.value_jsonb
       and not (
         pg_trigger_depth()>1
         and new.value_jsonb is null
         and old.value_jsonb is not null
         and not mangorts_entity_resource_exists(
           old.company_id,
           old.value_jsonb->>'resource_type',
           mangorts_try_uuid(old.value_jsonb->>'resource_id')
         )
       ) then
      raise exception 'action_item_source_immutable' using errcode='23514';
    end if;
  elsif tg_op = 'DELETE' then
    return old;
  end if;

  if new.entity_field_type_id is null then
    return new;
  end if;

  select template.system_key,
         case template.system_key
           when 'person_in_charge' then 'Person in charge'
           when 'assigned_by' then 'Assigned by'
           when 'analysis_due_date' then 'Analysis due date'
           when 'completion_due_date' then 'Completion due date'
           when 'status' then 'Status'
           when 'color' then 'Color'
           when 'source' then 'Source'
         end,
         case template.system_key
           when 'person_in_charge' then 'person'
           when 'assigned_by' then 'person'
           when 'analysis_due_date' then 'date'
           when 'completion_due_date' then 'date'
           when 'status' then 'choice'
           when 'color' then 'color'
           when 'source' then 'resource'
         end
  into new_system_key,new_expected_name,new_expected_field_type
  from entity_field_types template
  join entity_types entity_type
    on entity_type.company_id=template.company_id
   and entity_type.entity_type_id=template.entity_type_id
   and entity_type.system_key='action_item'
  where template.company_id=new.company_id
    and template.entity_field_type_id=new.entity_field_type_id
    and template.system_key in ('person_in_charge','assigned_by','analysis_due_date','completion_due_date','status','color','source');

  if found and (new.name <> new_expected_name or new.field_type <> new_expected_field_type) then
    raise exception 'action_item_entity_field_invalid:%',new_system_key using errcode='23514';
  end if;

  return new;
end;
$$;

create or replace function mangorts_resource_is_in_recycle_payload(
  p_company_id uuid,
  p_table_name text,
  p_id_column text,
  p_resource_id uuid
) returns boolean
language sql
stable
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from recycle_bin_items recycle
    cross join lateral jsonb_array_elements(
      coalesce(recycle.restore_payload->p_table_name,'[]'::jsonb)
    ) restored(row_json)
    where recycle.company_id=p_company_id
      and restored.row_json->>p_id_column=p_resource_id::text
  )
$$;

create or replace function mangorts_clear_entity_resource_fields_for_deleted_resource()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  resource_type text;
  resource_id uuid;
  id_column text;
begin
  if tg_table_name='nodes' then
    resource_type := 'node'; resource_id := old.node_id; id_column := 'node_id';
  elsif tg_table_name='logic_gates' then
    resource_type := 'logic_gate'; resource_id := old.logic_gate_id; id_column := 'logic_gate_id';
  elsif tg_table_name='projects' then
    resource_type := 'project'; resource_id := old.project_id; id_column := 'project_id';
  elsif tg_table_name='huddle_nodes' then
    resource_type := 'huddle_node'; resource_id := old.huddle_node_id; id_column := 'huddle_node_id';
  elsif tg_table_name='huddle_logic_gates' then
    resource_type := 'huddle_logic_gate'; resource_id := old.huddle_logic_gate_id; id_column := 'huddle_logic_gate_id';
  elsif tg_table_name='kpis' then
    resource_type := 'kpi'; resource_id := old.kpi_id; id_column := 'kpi_id';
  else
    raise exception 'entity_resource_cleanup_type_invalid:%',tg_table_name using errcode='23514';
  end if;

  if mangorts_resource_is_in_recycle_payload(old.company_id,tg_table_name,id_column,resource_id) then
    return old;
  end if;

  update entity_fields
  set value_jsonb=null,updated_timestamp=clock_timestamp()
  where company_id=old.company_id
    and field_type='resource'
    and value_jsonb->>'resource_type'=resource_type
    and mangorts_try_uuid(value_jsonb->>'resource_id')=resource_id;
  return old;
end;
$$;

create trigger trg_clear_node_entity_resource_fields after delete on nodes
for each row execute function mangorts_clear_entity_resource_fields_for_deleted_resource();
create trigger trg_clear_logic_gate_entity_resource_fields after delete on logic_gates
for each row execute function mangorts_clear_entity_resource_fields_for_deleted_resource();
create trigger trg_clear_project_entity_resource_fields after delete on projects
for each row execute function mangorts_clear_entity_resource_fields_for_deleted_resource();
create trigger trg_clear_huddle_node_entity_resource_fields after delete on huddle_nodes
for each row execute function mangorts_clear_entity_resource_fields_for_deleted_resource();
create trigger trg_clear_huddle_logic_gate_entity_resource_fields after delete on huddle_logic_gates
for each row execute function mangorts_clear_entity_resource_fields_for_deleted_resource();
create trigger trg_clear_kpi_entity_resource_fields after delete on kpis
for each row execute function mangorts_clear_entity_resource_fields_for_deleted_resource();

create or replace function mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  endpoint record;
begin
  for endpoint in
    select definition.resource_type,restored.row_json->>definition.id_column resource_id
    from (values
      ('nodes','node_id','node'),
      ('logic_gates','logic_gate_id','logic_gate'),
      ('projects','project_id','project'),
      ('huddle_nodes','huddle_node_id','huddle_node'),
      ('huddle_logic_gates','huddle_logic_gate_id','huddle_logic_gate'),
      ('kpis','kpi_id','kpi')
    ) definition(table_name,id_column,resource_type)
    cross join lateral jsonb_array_elements(
      coalesce(old.restore_payload->definition.table_name,'[]'::jsonb)
    ) restored(row_json)
  loop
    if not mangorts_entity_resource_exists(old.company_id,endpoint.resource_type,mangorts_try_uuid(endpoint.resource_id)) then
      update entity_fields
      set value_jsonb=null,updated_timestamp=clock_timestamp()
      where company_id=old.company_id
        and field_type='resource'
        and value_jsonb->>'resource_type'=endpoint.resource_type
        and value_jsonb->>'resource_id'=endpoint.resource_id;
    end if;
  end loop;
  return old;
end;
$$;

create trigger trg_clear_entity_resource_fields_on_permanent_recycle_delete
before delete on recycle_bin_items
for each row execute function mangorts_clear_entity_resource_fields_for_permanent_recycle_delete();

do $$
begin
  if to_regclass('public.action_item_sources') is not null
     or to_regprocedure('public.mangorts_validate_action_item_source()') is not null
     or to_regprocedure('public.mangorts_delete_action_item_sources_for_resource()') is not null
     or exists (
       select 1 from recycle_bin_items
       where restore_payload ? 'action_item_sources'
     )
     or exists (
       select 1 from pg_trigger
       where tgname in (
         'trg_delete_node_action_item_sources',
         'trg_delete_logic_gate_action_item_sources',
         'trg_delete_project_action_item_sources',
         'trg_delete_huddle_node_action_item_sources',
         'trg_delete_huddle_logic_gate_action_item_sources',
         'trg_delete_kpi_action_item_sources'
       )
         and not tgisinternal
     )
     or exists (
       select 1
       from pg_proc routine
       join pg_namespace namespace_row on namespace_row.oid=routine.pronamespace
       where namespace_row.nspname not in ('pg_catalog','information_schema')
         and lower(routine.prosrc) like '%action_item_sources%'
     ) then
    raise exception 'STOP: Action Item Source final-state verification failed' using errcode='23514';
  end if;

  if to_regprocedure('public.mangorts_entity_resource_exists(uuid,text,uuid)') is null
     or to_regprocedure('public.mangorts_resource_is_in_recycle_payload(uuid,text,text,uuid)') is null
     or to_regprocedure('public.mangorts_clear_entity_resource_fields_for_deleted_resource()') is null
     or to_regprocedure('public.mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()') is null
     or to_regclass('public.idx_entity_fields_resource_endpoint') is null
     or not exists (
       select 1 from pg_constraint
       where conrelid='entity_field_types'::regclass
         and conname='entity_field_types_field_type_chk'
         and position('resource' in lower(pg_get_constraintdef(oid)))>0
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid='entity_fields'::regclass
         and conname='entity_fields_field_type_chk'
         and position('resource' in lower(pg_get_constraintdef(oid)))>0
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid='entity_fields'::regclass
         and conname='entity_fields_value_shape_chk'
         and position('resource_type' in lower(pg_get_constraintdef(oid)))>0
         and position('resource_id' in lower(pg_get_constraintdef(oid)))>0
     ) then
    raise exception 'STOP: Action Item Source final-state verification failed' using errcode='23514';
  end if;

  if exists (
       select 1
       from (values
         ('nodes','trg_clear_node_entity_resource_fields'),
         ('logic_gates','trg_clear_logic_gate_entity_resource_fields'),
         ('projects','trg_clear_project_entity_resource_fields'),
         ('huddle_nodes','trg_clear_huddle_node_entity_resource_fields'),
         ('huddle_logic_gates','trg_clear_huddle_logic_gate_entity_resource_fields'),
         ('kpis','trg_clear_kpi_entity_resource_fields')
       ) expected(table_name,trigger_name)
       left join pg_class table_class
         on table_class.oid=to_regclass('public.' || expected.table_name)
       left join pg_trigger trigger_row
         on trigger_row.tgrelid=table_class.oid
        and trigger_row.tgname=expected.trigger_name
        and not trigger_row.tgisinternal
       where trigger_row.oid is null
          or trigger_row.tgfoid<>'mangorts_clear_entity_resource_fields_for_deleted_resource()'::regprocedure
          or trigger_row.tgtype<>9
          or trigger_row.tgenabled='D'
     )
     or not exists (
       select 1 from pg_trigger trigger_row
       where trigger_row.tgrelid='recycle_bin_items'::regclass
         and trigger_row.tgname='trg_clear_entity_resource_fields_on_permanent_recycle_delete'
         and trigger_row.tgfoid='mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()'::regprocedure
         and trigger_row.tgtype=11
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled<>'D'
     ) then
    raise exception 'STOP: Action Item Source final-state verification failed' using errcode='23514';
  end if;

  if exists (
       with expected(entity_field_type_id,name,field_type,system_key,position) as (
         values
           ('a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person','person_in_charge',0),
           ('a17e0000-0000-4000-8000-000000000106'::uuid,'Assigned by','person','assigned_by',1),
           ('a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date','analysis_due_date',2),
           ('a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date','completion_due_date',3),
           ('a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice','status',4),
           ('a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color','color',5),
           ('a17e0000-0000-4000-8000-000000000107'::uuid,'Source','resource','source',6)
       )
       select 1
       from companies company
       cross join expected
       left join entity_field_types template
         on template.company_id=company.company_id
        and template.entity_field_type_id=expected.entity_field_type_id
       where template.entity_field_type_id is null
           or template.entity_type_id is distinct from 'a17e0000-0000-4000-8000-000000000001'::uuid
           or template.entity_folder_id is not null
           or template.name is distinct from expected.name
           or template.field_type is distinct from expected.field_type
           or template.system_key is distinct from expected.system_key
           or template.position is distinct from expected.position
           or (expected.system_key='source' and template.config_jsonb is distinct from '{}'::jsonb)
     )
     or exists (
       select 1
       from entity_field_types template
       where template.field_type='resource'
         and (
            template.entity_field_type_id is distinct from 'a17e0000-0000-4000-8000-000000000107'::uuid
            or template.entity_type_id is distinct from 'a17e0000-0000-4000-8000-000000000001'::uuid
            or template.entity_folder_id is not null
            or template.name is distinct from 'Source'
            or template.system_key is distinct from 'source'
            or template.config_jsonb is distinct from '{}'::jsonb
         )
     ) then
    raise exception 'STOP: Action Item Source final-state verification failed' using errcode='23514';
  end if;

  if exists (
       with expected(entity_field_type_id,name,field_type,position) as (
         values
           ('a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person',0),
           ('a17e0000-0000-4000-8000-000000000106'::uuid,'Assigned by','person',1),
           ('a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date',2),
           ('a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date',3),
           ('a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice',4),
           ('a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color',5),
           ('a17e0000-0000-4000-8000-000000000107'::uuid,'Source','resource',6)
       ), action_items as (
         select entity.company_id,entity.entity_id
         from entities entity
         join entity_types entity_type
           on entity_type.company_id=entity.company_id
          and entity_type.entity_type_id=entity.entity_type_id
          and entity_type.system_key='action_item'
       )
       select 1
       from action_items action_item
       cross join expected
       left join entity_fields field
         on field.company_id=action_item.company_id
        and field.entity_id=action_item.entity_id
        and field.entity_field_type_id=expected.entity_field_type_id
       where field.entity_field_id is null
           or field.name is distinct from expected.name
           or field.field_type is distinct from expected.field_type
           or field.position is distinct from expected.position
     )
     or exists (
       select 1
       from entity_fields field
       where field.field_type='resource'
         and (
           field.entity_field_type_id is distinct from 'a17e0000-0000-4000-8000-000000000107'::uuid
            or field.name is distinct from 'Source'
         )
     )
     or exists (
       select 1
       from mangorts_action_item_source_candidates candidate
       left join entity_fields field
         on field.company_id=candidate.company_id
        and field.entity_id=candidate.entity_id
        and field.entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
       where field.value_jsonb is distinct from jsonb_build_object(
         'resource_type',candidate.resource_type,
         'resource_id',candidate.resource_id::text
       )
     ) then
    raise exception 'STOP: Action Item Source final-state verification failed' using errcode='23514';
  end if;

  if exists (
       (select company_id,entity_field_type_id,row_json from mangorts_assigned_by_templates_before
        except
        select company_id,entity_field_type_id,to_jsonb(template)
        from entity_field_types template
        where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid)
       union all
       (select company_id,entity_field_type_id,to_jsonb(template)
        from entity_field_types template
        where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
        except
        select company_id,entity_field_type_id,row_json from mangorts_assigned_by_templates_before)
     )
     or exists (
       (select company_id,entity_field_id,row_json from mangorts_assigned_by_fields_before
        except
        select company_id,entity_field_id,to_jsonb(field)
        from entity_fields field
        where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid)
       union all
       (select company_id,entity_field_id,to_jsonb(field)
        from entity_fields field
        where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
        except
        select company_id,entity_field_id,row_json from mangorts_assigned_by_fields_before)
     ) then
    raise exception 'STOP: Assigned by changed during Action Item Source migration' using errcode='23514';
  end if;
end;
$$;

commit;
