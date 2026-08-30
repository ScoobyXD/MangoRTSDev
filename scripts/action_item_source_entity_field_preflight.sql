-- Read-only preflight for the Action Item Source table-to-Entity-field cutover.
-- Run this complete file in DBeaver before the normal migration task. It reports
-- counts and catalog state only; it never returns business identities or writes data.

begin transaction isolation level repeatable read read only;

set local lock_timeout = '5s';
set local statement_timeout = '10min';
set local search_path = public, pg_catalog;

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only;

do $preflight$
declare
  old_version constant text := '20260829_action_item_delegation_source.sql';
  new_version constant text := '20260829_z_action_item_source_entity_field.sql';
  field_kind_before constant text := $contract$check((field_type=any(array['text','number','date','boolean','choice','color','person'])))$contract$;
  field_kind_final constant text := $contract$check((field_type=any(array['text','number','date','boolean','choice','color','person','resource'])))$contract$;
  value_shape_before constant text := $contract$check(((value_jsonbisnull)or((field_type=any(array['text','date','choice','color']))and(jsonb_typeof(value_jsonb)='string'))or((field_type='person')and(jsonb_typeof(value_jsonb)='string')and((value_jsonb#>>'{}'[])~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))or((field_type='number')and(jsonb_typeof(value_jsonb)='number'))or((field_type='boolean')and(jsonb_typeof(value_jsonb)='boolean'))))$contract$;
  value_shape_final constant text := $contract$check(((value_jsonbisnull)or((field_type=any(array['text','date','choice','color']))and(jsonb_typeof(value_jsonb)='string'))or((field_type='person')and(jsonb_typeof(value_jsonb)='string')and((value_jsonb#>>'{}'[])~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))or((field_type='number')and(jsonb_typeof(value_jsonb)='number'))or((field_type='boolean')and(jsonb_typeof(value_jsonb)='boolean'))or((field_type='resource')and(jsonb_typeof(value_jsonb)='object')and(jsonb_typeof((value_jsonb->'resource_type'))='string')and(jsonb_typeof((value_jsonb->'resource_id'))='string')and(value_jsonb=jsonb_build_object('resource_type',(value_jsonb->>'resource_type'),'resource_id',(value_jsonb->>'resource_id')))and((value_jsonb->>'resource_type')=any(array['node','logic_gate','project','huddle_node','huddle_logic_gate','kpi']))and((value_jsonb->>'resource_id')~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')and((value_jsonb->>'resource_id')=(((value_jsonb->>'resource_id'))::uuid)))))$contract$;
  legacy_rel regclass := to_regclass('public.action_item_sources');
  legacy_index_rel regclass := to_regclass('public.idx_action_item_sources_source');
  ledger_rel regclass := to_regclass('public.schema_migrations');
  server_num integer := current_setting('server_version_num')::integer;
  server_supported boolean;
  read_only_transaction boolean := current_setting('transaction_read_only')::boolean;
  base_tables_present boolean;
  transition_columns_ok boolean := false;
  ledger_shape_ok boolean := true;
  old_ledger_count bigint := 0;
  new_ledger_count bigint := 0;
  old_recorded boolean := false;
  new_recorded boolean := false;
  legacy_columns_ok boolean := false;
  legacy_constraints_ok boolean := false;
  legacy_triggers_ok boolean := false;
  legacy_objects_absent boolean := false;
  legacy_unexpected_dependency_count bigint := 0;
  final_objects_present boolean := false;
  final_objects_absent boolean := false;
  resource_constraints_present boolean := false;
  resource_constraints_absent boolean := false;
  base_indexes_ok boolean := false;
  assigned_index_present boolean := false;
  assigned_index_absent boolean := false;
  action_item_type_contract_ok boolean := false;
  original_fields_contract_ok boolean := false;
  original_fields_fresh_positions_ok boolean := false;
  original_fields_post_positions_ok boolean := false;
  assigned_contract_ok boolean := false;
  source_contract_ok boolean := false;
  assigned_canonical_absent boolean := false;
  source_canonical_absent boolean := false;
  assigned_collision_count bigint := 0;
  source_collision_count bigint := 0;
  protect_field_has_assigned boolean := false;
  protect_field_has_source boolean := false;
  protect_entity_has_assigned boolean := false;
  protect_entity_has_source boolean := false;
  base_protection_present boolean := false;
  legacy_payload_key_count bigint := 0;
  candidate_safe boolean := false;
  candidate_details jsonb := '{}'::jsonb;
  final_values_safe boolean := false;
  final_value_details jsonb := '{}'::jsonb;
  fresh_ready boolean := false;
  prior_ready boolean := false;
  final_ready boolean := false;
  database_state text;
  readiness_status text;
  next_action text;
  details jsonb;
begin
  server_supported := server_num between 170000 and 189999;

  base_tables_present :=
    to_regclass('public.companies') is not null
    and to_regclass('public.entity_types') is not null
    and to_regclass('public.entity_field_types') is not null
    and to_regclass('public.entities') is not null
    and to_regclass('public.entity_fields') is not null
    and to_regclass('public.recycle_bin_items') is not null
    and to_regclass('public.nodes') is not null
    and to_regclass('public.logic_gates') is not null
    and to_regclass('public.projects') is not null
    and to_regclass('public.huddle_nodes') is not null
    and to_regclass('public.huddle_logic_gates') is not null
    and to_regclass('public.kpis') is not null
    and to_regprocedure('public.mangorts_try_uuid(text)') is not null;

  if base_tables_present then
    select not exists (
      select 1
      from (values
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
        ('recycle_bin_items',array[
          'company_id','recycle_bin_item_id','object_kind','object_id','object_label',
          'object_folder_kind','restore_payload','deleted_by_user_id','deleted_timestamp'
        ]::text[])
      ) definition(table_name,column_names)
      where (
        select count(*)
        from pg_attribute attribute
        where attribute.attrelid=to_regclass('public.' || definition.table_name)
          and attribute.attnum>0
          and not attribute.attisdropped
      )<>cardinality(definition.column_names)
      or exists (
        select unnest(definition.column_names)
        except
        select attribute.attname::text
        from pg_attribute attribute
        where attribute.attrelid=to_regclass('public.' || definition.table_name)
          and attribute.attnum>0
          and not attribute.attisdropped
      )
      or exists (
        select attribute.attname::text
        from pg_attribute attribute
        where attribute.attrelid=to_regclass('public.' || definition.table_name)
          and attribute.attnum>0
          and not attribute.attisdropped
        except
        select unnest(definition.column_names)
      )
    ) into transition_columns_ok;
  end if;

  if ledger_rel is not null then
    select (select count(*)
            from pg_attribute
            where attrelid=ledger_rel and attnum>0 and not attisdropped)=2
       and not exists (
         select attname::text
         from pg_attribute
         where attrelid=ledger_rel and attnum>0 and not attisdropped
         except values ('version'::text),('applied_at'::text)
       )
       and not exists (
         select column_name
         from (values ('version'::text),('applied_at'::text)) expected(column_name)
         except
         select attname::text
         from pg_attribute
         where attrelid=ledger_rel and attnum>0 and not attisdropped
       )
    into ledger_shape_ok;

    if ledger_shape_ok then
      execute 'select count(*) filter (where version=$1),count(*) filter (where version=$2) from public.schema_migrations'
      into old_ledger_count,new_ledger_count
      using old_version,new_version;
      old_recorded := old_ledger_count=1;
      new_recorded := new_ledger_count=1;
      ledger_shape_ok := old_ledger_count<=1 and new_ledger_count<=1;
    end if;
  end if;

  if legacy_rel is not null then
    select (select count(*)
            from pg_attribute
            where attrelid=legacy_rel and attnum>0 and not attisdropped)=5
       and not exists (
         select attname::text
         from pg_attribute
         where attrelid=legacy_rel and attnum>0 and not attisdropped
         except values
           ('company_id'::text),('entity_id'::text),('resource_type'::text),
           ('resource_id'::text),('created_timestamp'::text)
       )
       and not exists (
         select column_name
         from (values
           ('company_id'::text),('entity_id'::text),('resource_type'::text),
           ('resource_id'::text),('created_timestamp'::text)
         ) expected(column_name)
         except
         select attname::text
         from pg_attribute
         where attrelid=legacy_rel and attnum>0 and not attisdropped
       )
    into legacy_columns_ok;

    legacy_columns_ok := legacy_columns_ok and not exists (
      select 1
      from (values
        ('company_id','uuid'::regtype,true,null::text),
        ('entity_id','uuid'::regtype,true,null::text),
        ('resource_type','text'::regtype,true,null::text),
        ('resource_id','uuid'::regtype,true,null::text),
        ('created_timestamp','timestamp with time zone'::regtype,true,'now()'::text)
      ) expected(column_name,type_oid,not_null,default_expression)
      left join pg_attribute attribute
        on attribute.attrelid=legacy_rel
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
    );

    select count(*) filter (where contype in ('p','f','c'))=3
       and count(*) filter (
         where conname='action_item_sources_pkey'
           and contype='p'
           and pg_get_constraintdef(oid,false)='PRIMARY KEY (company_id, entity_id)'
       )=1
       and count(*) filter (
         where conname='action_item_sources_entity_fkey'
           and contype='f'
           and confrelid=to_regclass('public.entities')
           and confdeltype='c'
       )=1
       and count(*) filter (
         where conname='action_item_sources_resource_type_chk'
           and contype='c'
           and lower(pg_get_constraintdef(oid,false)) like '%node%'
           and lower(pg_get_constraintdef(oid,false)) like '%logic_gate%'
           and lower(pg_get_constraintdef(oid,false)) like '%project%'
           and lower(pg_get_constraintdef(oid,false)) like '%huddle_node%'
           and lower(pg_get_constraintdef(oid,false)) like '%huddle_logic_gate%'
           and lower(pg_get_constraintdef(oid,false)) like '%kpi%'
       )=1
    into legacy_constraints_ok
    from pg_constraint
    where conrelid=legacy_rel;

    if legacy_index_rel is not null then
      legacy_constraints_ok := legacy_constraints_ok
        and lower(pg_get_indexdef(legacy_index_rel))
            like '%(company_id, resource_type, resource_id, entity_id)%';
    else
      legacy_constraints_ok := false;
    end if;

    with expected(trigger_name,table_name,function_name,trigger_type) as (
      values
        ('trg_validate_action_item_source','action_item_sources','public.mangorts_validate_action_item_source()',31),
        ('trg_delete_node_action_item_sources','nodes','public.mangorts_delete_action_item_sources_for_resource()',9),
        ('trg_delete_logic_gate_action_item_sources','logic_gates','public.mangorts_delete_action_item_sources_for_resource()',9),
        ('trg_delete_project_action_item_sources','projects','public.mangorts_delete_action_item_sources_for_resource()',9),
        ('trg_delete_huddle_node_action_item_sources','huddle_nodes','public.mangorts_delete_action_item_sources_for_resource()',9),
        ('trg_delete_huddle_logic_gate_action_item_sources','huddle_logic_gates','public.mangorts_delete_action_item_sources_for_resource()',9),
        ('trg_delete_kpi_action_item_sources','kpis','public.mangorts_delete_action_item_sources_for_resource()',9)
    ), matches as (
      select expected.trigger_name,trigger_row.oid
      from expected
      left join pg_class table_row on table_row.relname=expected.table_name
      left join pg_namespace namespace_row
        on namespace_row.oid=table_row.relnamespace and namespace_row.nspname='public'
      left join pg_trigger trigger_row
        on trigger_row.tgrelid=table_row.oid
       and trigger_row.tgname=expected.trigger_name
       and trigger_row.tgfoid=to_regprocedure(expected.function_name)
       and trigger_row.tgtype=expected.trigger_type
       and trigger_row.tgenabled<>'D'
       and not trigger_row.tgisinternal
    )
    select count(*)=7 and count(oid)=7 into legacy_triggers_ok from matches;

    legacy_triggers_ok := legacy_triggers_ok
      and to_regprocedure('public.mangorts_validate_action_item_source()') is not null
      and to_regprocedure('public.mangorts_delete_action_item_sources_for_resource()') is not null;

    if legacy_triggers_ok then
      legacy_triggers_ok :=
        lower(pg_get_functiondef('public.mangorts_validate_action_item_source()'::regprocedure))
          like '%action_item_source_requires_action_item%'
        and lower(pg_get_functiondef('public.mangorts_validate_action_item_source()'::regprocedure))
          like '%action_item_source_resource_not_found%'
        and lower(pg_get_functiondef('public.mangorts_validate_action_item_source()'::regprocedure))
          like '%action_item_source_immutable%'
        and lower(pg_get_functiondef('public.mangorts_delete_action_item_sources_for_resource()'::regprocedure))
          like '%delete from action_item_sources%'
        and lower(pg_get_functiondef('public.mangorts_delete_action_item_sources_for_resource()'::regprocedure))
          like '%action_item_source_delete_resource_invalid%';
    end if;

    select
      (select count(*) from pg_constraint where confrelid=legacy_rel)
      + (select count(*)
         from pg_views
         where schemaname not in ('pg_catalog','information_schema')
           and lower(definition) like '%action_item_sources%')
      + (select count(*)
         from pg_matviews
         where schemaname not in ('pg_catalog','information_schema')
           and lower(definition) like '%action_item_sources%')
      + (select count(*)
         from pg_proc routine
         join pg_namespace namespace_row on namespace_row.oid=routine.pronamespace
         where namespace_row.nspname not in ('pg_catalog','information_schema')
           and routine.oid is distinct from to_regprocedure('public.mangorts_validate_action_item_source()')
           and routine.oid is distinct from to_regprocedure('public.mangorts_delete_action_item_sources_for_resource()')
           and lower(routine.prosrc) like '%action_item_sources%')
    into legacy_unexpected_dependency_count;
  else
    select count(*)
    into legacy_unexpected_dependency_count
    from pg_proc routine
    join pg_namespace namespace_row on namespace_row.oid=routine.pronamespace
    where namespace_row.nspname not in ('pg_catalog','information_schema')
      and lower(routine.prosrc) like '%action_item_sources%';
  end if;

  with legacy_names(trigger_name) as (
    values
      ('trg_validate_action_item_source'),
      ('trg_delete_node_action_item_sources'),
      ('trg_delete_logic_gate_action_item_sources'),
      ('trg_delete_project_action_item_sources'),
      ('trg_delete_huddle_node_action_item_sources'),
      ('trg_delete_huddle_logic_gate_action_item_sources'),
      ('trg_delete_kpi_action_item_sources')
  )
  select legacy_rel is null
     and to_regclass('public.idx_action_item_sources_source') is null
     and to_regprocedure('public.mangorts_validate_action_item_source()') is null
     and to_regprocedure('public.mangorts_delete_action_item_sources_for_resource()') is null
     and not exists (
       select 1
       from pg_trigger trigger_row
       join pg_class table_row on table_row.oid=trigger_row.tgrelid
       join pg_namespace namespace_row on namespace_row.oid=table_row.relnamespace
       where namespace_row.nspname='public'
         and not trigger_row.tgisinternal
         and trigger_row.tgname in (select trigger_name from legacy_names)
     )
  into legacy_objects_absent;

  with expected(trigger_name,table_name,function_name,trigger_type) as (
    values
      ('trg_clear_node_entity_resource_fields','nodes','public.mangorts_clear_entity_resource_fields_for_deleted_resource()',9),
      ('trg_clear_logic_gate_entity_resource_fields','logic_gates','public.mangorts_clear_entity_resource_fields_for_deleted_resource()',9),
      ('trg_clear_project_entity_resource_fields','projects','public.mangorts_clear_entity_resource_fields_for_deleted_resource()',9),
      ('trg_clear_huddle_node_entity_resource_fields','huddle_nodes','public.mangorts_clear_entity_resource_fields_for_deleted_resource()',9),
      ('trg_clear_huddle_logic_gate_entity_resource_fields','huddle_logic_gates','public.mangorts_clear_entity_resource_fields_for_deleted_resource()',9),
      ('trg_clear_kpi_entity_resource_fields','kpis','public.mangorts_clear_entity_resource_fields_for_deleted_resource()',9),
      ('trg_clear_entity_resource_fields_on_permanent_recycle_delete','recycle_bin_items','public.mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()',11)
  ), matches as (
    select expected.trigger_name,trigger_row.oid
    from expected
    left join pg_class table_row on table_row.relname=expected.table_name
    left join pg_namespace namespace_row
      on namespace_row.oid=table_row.relnamespace and namespace_row.nspname='public'
    left join pg_trigger trigger_row
      on trigger_row.tgrelid=table_row.oid
     and trigger_row.tgname=expected.trigger_name
     and trigger_row.tgfoid=to_regprocedure(expected.function_name)
     and trigger_row.tgtype=expected.trigger_type
     and trigger_row.tgenabled<>'D'
     and not trigger_row.tgisinternal
  )
  select count(*)=7 and count(oid)=7 into final_objects_present from matches;

  final_objects_present := final_objects_present
    and exists (
      select 1
      from pg_index index_row
      where index_row.indexrelid=to_regclass('public.idx_entity_fields_resource_endpoint')
        and index_row.indrelid=to_regclass('public.entity_fields')
        and index_row.indisvalid
        and index_row.indisready
        and index_row.indnatts=4
        and lower(pg_get_indexdef(index_row.indexrelid,1,true))='company_id'
        and lower(pg_get_indexdef(index_row.indexrelid,2,true)) like '%resource_type%'
        and lower(pg_get_indexdef(index_row.indexrelid,3,true)) like '%mangorts_try_uuid%'
        and lower(pg_get_indexdef(index_row.indexrelid,3,true)) like '%resource_id%'
        and lower(pg_get_indexdef(index_row.indexrelid,4,true))='entity_id'
        and lower(pg_get_expr(index_row.indpred,index_row.indrelid)) like '%field_type%resource%'
        and lower(pg_get_expr(index_row.indpred,index_row.indrelid)) like '%value_jsonb%is not null%'
    )
    and to_regprocedure('public.mangorts_entity_resource_exists(uuid,text,uuid)') is not null
    and to_regprocedure('public.mangorts_resource_is_in_recycle_payload(uuid,text,text,uuid)') is not null
    and to_regprocedure('public.mangorts_clear_entity_resource_fields_for_deleted_resource()') is not null
    and to_regprocedure('public.mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()') is not null;

  if final_objects_present
     and to_regprocedure('public.mangorts_protect_action_item_field_type()') is not null
     and to_regprocedure('public.mangorts_maintain_entity_field_template_link()') is not null
     and to_regprocedure('public.mangorts_protect_action_item_entity_field()') is not null then
    final_objects_present :=
      lower(pg_get_functiondef('public.mangorts_entity_resource_exists(uuid,text,uuid)'::regprocedure))
        like '%huddle_logic_gate%deleted_timestamp is null%'
      and lower(pg_get_functiondef('public.mangorts_entity_resource_exists(uuid,text,uuid)'::regprocedure))
        like '%kpi%deleted_timestamp is null%'
      and lower(pg_get_functiondef('public.mangorts_resource_is_in_recycle_payload(uuid,text,text,uuid)'::regprocedure))
        like '%jsonb_array_elements%restore_payload%'
      and lower(pg_get_functiondef('public.mangorts_clear_entity_resource_fields_for_deleted_resource()'::regprocedure))
        like '%mangorts_resource_is_in_recycle_payload%'
      and regexp_replace(lower(pg_get_functiondef('public.mangorts_clear_entity_resource_fields_for_deleted_resource()'::regprocedure)),'\s+','','g')
        like '%updateentity_fields%value_jsonb=null%'
      and lower(pg_get_functiondef('public.mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()'::regprocedure))
        like '%mangorts_entity_resource_exists%'
      and regexp_replace(lower(pg_get_functiondef('public.mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()'::regprocedure)),'\s+','','g')
        like '%updateentity_fields%value_jsonb=null%'
      and lower(pg_get_functiondef('public.mangorts_protect_action_item_field_type()'::regprocedure))
        like '%entity_resource_field_type_reserved%'
      and lower(pg_get_functiondef('public.mangorts_maintain_entity_field_template_link()'::regprocedure))
        like '%entity_field_resource_not_found%'
      and lower(pg_get_functiondef('public.mangorts_protect_action_item_entity_field()'::regprocedure))
        like '%action_item_source_immutable%';
  else
    final_objects_present := false;
  end if;

  with final_names(trigger_name) as (
    values
      ('trg_clear_node_entity_resource_fields'),
      ('trg_clear_logic_gate_entity_resource_fields'),
      ('trg_clear_project_entity_resource_fields'),
      ('trg_clear_huddle_node_entity_resource_fields'),
      ('trg_clear_huddle_logic_gate_entity_resource_fields'),
      ('trg_clear_kpi_entity_resource_fields'),
      ('trg_clear_entity_resource_fields_on_permanent_recycle_delete')
  )
  select to_regclass('public.idx_entity_fields_resource_endpoint') is null
     and to_regprocedure('public.mangorts_entity_resource_exists(uuid,text,uuid)') is null
     and to_regprocedure('public.mangorts_resource_is_in_recycle_payload(uuid,text,text,uuid)') is null
     and to_regprocedure('public.mangorts_clear_entity_resource_fields_for_deleted_resource()') is null
     and to_regprocedure('public.mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()') is null
     and not exists (
       select 1
       from pg_trigger trigger_row
       join pg_class table_row on table_row.oid=trigger_row.tgrelid
       join pg_namespace namespace_row on namespace_row.oid=table_row.relnamespace
       where namespace_row.nspname='public'
         and not trigger_row.tgisinternal
         and trigger_row.tgname in (select trigger_name from final_names)
     )
  into final_objects_absent;

  if base_tables_present then
    base_indexes_ok := exists (
      select 1
      from pg_index index_row
      where index_row.indexrelid=to_regclass('public.idx_entity_field_types_type_system_key_unique')
        and index_row.indrelid='public.entity_field_types'::regclass
        and index_row.indisunique and index_row.indisvalid and index_row.indisready
        and index_row.indnatts=3
        and lower(pg_get_indexdef(index_row.indexrelid,1,true))='company_id'
        and lower(pg_get_indexdef(index_row.indexrelid,2,true))='entity_type_id'
        and lower(pg_get_indexdef(index_row.indexrelid,3,true))='system_key'
        and lower(pg_get_expr(index_row.indpred,index_row.indrelid)) like '%system_key%is not null%'
    ) and exists (
      select 1
      from pg_index index_row
      where index_row.indexrelid=to_regclass('public.idx_entity_fields_entity_field_type_unique')
        and index_row.indrelid='public.entity_fields'::regclass
        and index_row.indisunique and index_row.indisvalid and index_row.indisready
        and index_row.indnatts=3
        and lower(pg_get_indexdef(index_row.indexrelid,1,true))='company_id'
        and lower(pg_get_indexdef(index_row.indexrelid,2,true))='entity_id'
        and lower(pg_get_indexdef(index_row.indexrelid,3,true))='entity_field_type_id'
        and lower(pg_get_expr(index_row.indpred,index_row.indrelid)) like '%entity_field_type_id%is not null%'
    );

    assigned_index_present := exists (
      select 1
      from pg_index index_row
      where index_row.indexrelid=to_regclass('public.idx_entity_fields_action_item_assigned_by')
        and index_row.indrelid='public.entity_fields'::regclass
        and not index_row.indisunique and index_row.indisvalid and index_row.indisready
        and index_row.indnatts=3
        and lower(pg_get_indexdef(index_row.indexrelid,1,true))='company_id'
        and lower(pg_get_indexdef(index_row.indexrelid,2,true)) like '%mangorts_try_uuid%value_jsonb%'
        and lower(pg_get_indexdef(index_row.indexrelid,3,true))='entity_id'
        and lower(pg_get_expr(index_row.indpred,index_row.indrelid))
          like '%a17e0000-0000-4000-8000-000000000106%'
    );
    assigned_index_absent := to_regclass('public.idx_entity_fields_action_item_assigned_by') is null;

    select count(*) filter (
             where constraint_row.conrelid='public.entity_field_types'::regclass
               and constraint_row.conname='entity_field_types_field_type_chk'
               and regexp_replace(lower(pg_get_constraintdef(constraint_row.oid,false)),'\s+|::text','','g')=field_kind_final
           )=1
       and count(*) filter (
             where constraint_row.conrelid='public.entity_fields'::regclass
               and constraint_row.conname='entity_fields_field_type_chk'
               and regexp_replace(lower(pg_get_constraintdef(constraint_row.oid,false)),'\s+|::text','','g')=field_kind_final
           )=1
       and count(*) filter (
             where constraint_row.conrelid='public.entity_fields'::regclass
               and constraint_row.conname='entity_fields_value_shape_chk'
               and regexp_replace(lower(pg_get_constraintdef(constraint_row.oid,false)),'\s+|::text','','g')=value_shape_final
           )=1
    into resource_constraints_present
    from pg_constraint constraint_row
    where constraint_row.conname in (
      'entity_field_types_field_type_chk',
      'entity_fields_field_type_chk',
      'entity_fields_value_shape_chk'
    )
      and constraint_row.conrelid in (
        'public.entity_field_types'::regclass,
        'public.entity_fields'::regclass
      );

    select count(*) filter (
             where constraint_row.conrelid='public.entity_field_types'::regclass
               and constraint_row.conname='entity_field_types_field_type_chk'
               and regexp_replace(lower(pg_get_constraintdef(constraint_row.oid,false)),'\s+|::text','','g')=field_kind_before
           )=1
       and count(*) filter (
             where constraint_row.conrelid='public.entity_fields'::regclass
               and constraint_row.conname='entity_fields_field_type_chk'
               and regexp_replace(lower(pg_get_constraintdef(constraint_row.oid,false)),'\s+|::text','','g')=field_kind_before
           )=1
       and count(*) filter (
             where constraint_row.conrelid='public.entity_fields'::regclass
               and constraint_row.conname='entity_fields_value_shape_chk'
               and regexp_replace(lower(pg_get_constraintdef(constraint_row.oid,false)),'\s+|::text','','g')=value_shape_before
           )=1
    into resource_constraints_absent
    from pg_constraint constraint_row
    where constraint_row.conname in (
      'entity_field_types_field_type_chk',
      'entity_fields_field_type_chk',
      'entity_fields_value_shape_chk'
    )
      and constraint_row.conrelid in (
        'public.entity_field_types'::regclass,
        'public.entity_fields'::regclass
      );

    select not exists (
      select 1
      from companies company
      left join entity_types entity_type
        on entity_type.company_id=company.company_id
       and entity_type.entity_type_id='a17e0000-0000-4000-8000-000000000001'::uuid
       and entity_type.system_key='action_item'
       and entity_type.name='Action Item'
      where entity_type.entity_type_id is null
    )
    into action_item_type_contract_ok;

    with expected(entity_field_type_id,system_key,name,field_type) as (
      values
        ('a17e0000-0000-4000-8000-000000000101'::uuid,'person_in_charge','Person in charge','person'),
        ('a17e0000-0000-4000-8000-000000000102'::uuid,'analysis_due_date','Analysis due date','date'),
        ('a17e0000-0000-4000-8000-000000000103'::uuid,'completion_due_date','Completion due date','date'),
        ('a17e0000-0000-4000-8000-000000000104'::uuid,'status','Status','choice'),
        ('a17e0000-0000-4000-8000-000000000105'::uuid,'color','Color','color')
    )
    select not exists (
      select 1
      from companies company
      cross join expected
      left join entity_field_types template
        on template.company_id=company.company_id
       and template.entity_field_type_id=expected.entity_field_type_id
       and template.entity_type_id='a17e0000-0000-4000-8000-000000000001'::uuid
       and template.entity_folder_id is null
       and template.system_key=expected.system_key
       and template.name=expected.name
       and template.field_type=expected.field_type
      where template.entity_field_type_id is null
    ) and not exists (
      select 1
      from entities entity
      cross join expected
      where entity.entity_type_id='a17e0000-0000-4000-8000-000000000001'::uuid
        and (select count(*)
             from entity_fields field
             where field.company_id=entity.company_id
               and field.entity_id=entity.entity_id
               and field.entity_field_type_id=expected.entity_field_type_id
               and field.name=expected.name
               and field.field_type=expected.field_type)<>1
    )
    into original_fields_contract_ok;

    with expected(entity_field_type_id,position) as (
      values
        ('a17e0000-0000-4000-8000-000000000101'::uuid,0),
        ('a17e0000-0000-4000-8000-000000000102'::uuid,1),
        ('a17e0000-0000-4000-8000-000000000103'::uuid,2),
        ('a17e0000-0000-4000-8000-000000000104'::uuid,3),
        ('a17e0000-0000-4000-8000-000000000105'::uuid,4)
    )
    select not exists (
      select 1
      from companies company
      cross join expected
      left join entity_field_types template
        on template.company_id=company.company_id
       and template.entity_field_type_id=expected.entity_field_type_id
       and template.position=expected.position
      where template.entity_field_type_id is null
    ) and not exists (
      select 1
      from entities entity
      cross join expected
      where entity.entity_type_id='a17e0000-0000-4000-8000-000000000001'::uuid
        and (select count(*)
             from entity_fields field
             where field.company_id=entity.company_id
               and field.entity_id=entity.entity_id
               and field.entity_field_type_id=expected.entity_field_type_id
               and field.position=expected.position)<>1
    )
    into original_fields_fresh_positions_ok;

    with expected(entity_field_type_id,position) as (
      values
        ('a17e0000-0000-4000-8000-000000000101'::uuid,0),
        ('a17e0000-0000-4000-8000-000000000102'::uuid,2),
        ('a17e0000-0000-4000-8000-000000000103'::uuid,3),
        ('a17e0000-0000-4000-8000-000000000104'::uuid,4),
        ('a17e0000-0000-4000-8000-000000000105'::uuid,5)
    )
    select not exists (
      select 1
      from companies company
      cross join expected
      left join entity_field_types template
        on template.company_id=company.company_id
       and template.entity_field_type_id=expected.entity_field_type_id
       and template.position=expected.position
      where template.entity_field_type_id is null
    ) and not exists (
      select 1
      from entities entity
      cross join expected
      where entity.entity_type_id='a17e0000-0000-4000-8000-000000000001'::uuid
        and (select count(*)
             from entity_fields field
             where field.company_id=entity.company_id
               and field.entity_id=entity.entity_id
               and field.entity_field_type_id=expected.entity_field_type_id
               and field.position=expected.position)<>1
    )
    into original_fields_post_positions_ok;

    select not exists (
      select 1
      from companies company
      left join entity_field_types template
        on template.company_id=company.company_id
       and template.entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
       and template.entity_type_id='a17e0000-0000-4000-8000-000000000001'::uuid
       and template.entity_folder_id is null
       and template.system_key='assigned_by'
       and template.name='Assigned by'
       and template.field_type='person'
       and template.config_jsonb='{}'::jsonb
       and template.position=1
      where template.entity_field_type_id is null
    ) and not exists (
      select 1
      from entities entity
      where entity.entity_type_id='a17e0000-0000-4000-8000-000000000001'::uuid
        and (select count(*)
             from entity_fields field
             where field.company_id=entity.company_id
               and field.entity_id=entity.entity_id
               and field.entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
               and field.name='Assigned by'
               and field.field_type='person'
               and field.position=1)<>1
    )
    into assigned_contract_ok;

    select not exists (
      select 1
      from companies company
      left join entity_field_types template
        on template.company_id=company.company_id
       and template.entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
       and template.entity_type_id='a17e0000-0000-4000-8000-000000000001'::uuid
       and template.entity_folder_id is null
       and template.system_key='source'
       and template.name='Source'
       and template.field_type='resource'
       and template.config_jsonb='{}'::jsonb
       and template.position=6
      where template.entity_field_type_id is null
    ) and not exists (
      select 1
      from entities entity
      where entity.entity_type_id='a17e0000-0000-4000-8000-000000000001'::uuid
        and (select count(*)
             from entity_fields field
             where field.company_id=entity.company_id
               and field.entity_id=entity.entity_id
               and field.entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
               and field.name='Source'
               and field.field_type='resource'
               and field.position=6)<>1
    ) and not exists (
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
          or template.position is distinct from 6
        )
    ) and not exists (
      select 1
      from entity_fields field
      where field.field_type='resource'
        and (
          field.entity_field_type_id is distinct from 'a17e0000-0000-4000-8000-000000000107'::uuid
          or field.name is distinct from 'Source'
          or field.position is distinct from 6
        )
    )
    into source_contract_ok;

    select not exists (
      select 1 from entity_field_types
      where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
    ) and not exists (
      select 1 from entity_fields
      where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
    ) into assigned_canonical_absent;

    select not exists (
      select 1 from entity_field_types
      where entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
    ) and not exists (
      select 1 from entity_fields
      where entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
    ) into source_canonical_absent;

    select count(*) into assigned_collision_count
    from entity_field_types template
    join entity_types entity_type
      on entity_type.company_id=template.company_id
     and entity_type.entity_type_id=template.entity_type_id
     and entity_type.system_key='action_item'
    where template.entity_field_type_id<>'a17e0000-0000-4000-8000-000000000106'::uuid
      and (template.system_key='assigned_by' or lower(btrim(template.name))='assigned by');

    select
      (select count(*)
       from entity_field_types template
       join entity_types entity_type
         on entity_type.company_id=template.company_id
        and entity_type.entity_type_id=template.entity_type_id
        and entity_type.system_key='action_item'
       where template.entity_field_type_id<>'a17e0000-0000-4000-8000-000000000107'::uuid
         and (template.system_key='source' or lower(btrim(template.name))='source'))
      +
      (select count(*)
       from entity_fields field
       join entities entity
         on entity.company_id=field.company_id and entity.entity_id=field.entity_id
       join entity_types entity_type
         on entity_type.company_id=entity.company_id
        and entity_type.entity_type_id=entity.entity_type_id
        and entity_type.system_key='action_item'
       where field.entity_field_type_id is distinct from 'a17e0000-0000-4000-8000-000000000107'::uuid
         and lower(btrim(field.name))='source')
    into source_collision_count;

    select count(*) into legacy_payload_key_count
    from recycle_bin_items
    where restore_payload ? 'action_item_sources';

    if to_regprocedure('public.mangorts_protect_action_item_field_type()') is not null
       and to_regprocedure('public.mangorts_protect_action_item_entity_field()') is not null
       and to_regprocedure('public.mangorts_maintain_entity_field_template_link()') is not null then
      base_protection_present :=
        exists (
          select 1 from pg_trigger
          where tgrelid='public.entity_field_types'::regclass
            and tgname='trg_protect_action_item_field_type'
            and tgfoid='public.mangorts_protect_action_item_field_type()'::regprocedure
            and tgtype=31 and tgenabled<>'D' and not tgisinternal
        )
        and exists (
          select 1 from pg_trigger
          where tgrelid='public.entity_fields'::regclass
            and tgname='trg_protect_action_item_entity_field'
            and tgfoid='public.mangorts_protect_action_item_entity_field()'::regprocedure
            and tgtype=31 and tgenabled<>'D' and not tgisinternal
        )
        and exists (
          select 1 from pg_trigger
          where tgrelid='public.entity_fields'::regclass
            and tgname='trg_maintain_entity_field_template_link'
            and tgfoid='public.mangorts_maintain_entity_field_template_link()'::regprocedure
            and tgtype=23 and tgenabled<>'D' and not tgisinternal
        );
      protect_field_has_assigned := position('''assigned_by''' in lower(pg_get_functiondef('public.mangorts_protect_action_item_field_type()'::regprocedure)))>0;
      protect_field_has_source := position('''source''' in lower(pg_get_functiondef('public.mangorts_protect_action_item_field_type()'::regprocedure)))>0;
      protect_entity_has_assigned := position('''assigned_by''' in lower(pg_get_functiondef('public.mangorts_protect_action_item_entity_field()'::regprocedure)))>0;
      protect_entity_has_source := position('''source''' in lower(pg_get_functiondef('public.mangorts_protect_action_item_entity_field()'::regprocedure)))>0;
    end if;
  end if;

  if legacy_rel is not null and legacy_columns_ok and base_tables_present then
    execute $candidate$
      with recycle_source_elements as (
        select recycle.company_id,recycle.recycle_bin_item_id,
               element.row_json,
               case when jsonb_typeof(element.row_json)='object'
                    then element.row_json else '{}'::jsonb end as row_object
        from public.recycle_bin_items recycle
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(recycle.restore_payload->'action_item_sources')='array'
               then recycle.restore_payload->'action_item_sources'
               else '[]'::jsonb end
        ) element(row_json)
      ), parsed_recycle_sources as (
        select *,
          coalesce(jsonb_typeof(row_json)='object'
          and row_object ?& array['company_id','entity_id','resource_type','resource_id','created_timestamp']
          and (select count(*) from jsonb_object_keys(row_object))=5
          and jsonb_typeof(row_object->'company_id')='string'
          and jsonb_typeof(row_object->'entity_id')='string'
          and jsonb_typeof(row_object->'resource_type')='string'
          and jsonb_typeof(row_object->'resource_id')='string'
          and jsonb_typeof(row_object->'created_timestamp')='string'
          and pg_input_is_valid(row_object->>'created_timestamp','timestamp with time zone')
          and public.mangorts_try_uuid(row_object->>'company_id')=company_id
          and row_object->>'company_id'=company_id::text
          and public.mangorts_try_uuid(row_object->>'entity_id') is not null
          and row_object->>'entity_id'=public.mangorts_try_uuid(row_object->>'entity_id')::text
          and row_object->>'resource_type' in ('node','logic_gate','project','huddle_node','huddle_logic_gate','kpi')
          and public.mangorts_try_uuid(row_object->>'resource_id') is not null
          and row_object->>'resource_id'=public.mangorts_try_uuid(row_object->>'resource_id')::text,
          false)
          as row_valid
        from recycle_source_elements
      ), valid_recycle_candidates as (
        select company_id,recycle_bin_item_id,
               public.mangorts_try_uuid(row_object->>'entity_id') as entity_id,
               row_object->>'resource_type' as resource_type,
               public.mangorts_try_uuid(row_object->>'resource_id') as resource_id
        from parsed_recycle_sources where row_valid
      ), all_candidates as (
        select company_id,entity_id,resource_type,resource_id,
               'live'::text as origin,null::uuid as recycle_bin_item_id
        from public.action_item_sources
        union all
        select company_id,entity_id,resource_type,resource_id,'recycle',recycle_bin_item_id
        from valid_recycle_candidates
      ), semantic_candidates as (
        select distinct company_id,entity_id,resource_type,resource_id from all_candidates
      ), live_endpoints as (
        select company_id,'node'::text as resource_type,node_id as resource_id from public.nodes
        union all select company_id,'logic_gate',logic_gate_id from public.logic_gates
        union all select company_id,'project',project_id from public.projects
        union all select company_id,'huddle_node',huddle_node_id from public.huddle_nodes
        union all select company_id,'huddle_logic_gate',huddle_logic_gate_id
          from public.huddle_logic_gates where deleted_timestamp is null
        union all select company_id,'kpi',kpi_id from public.kpis where deleted_timestamp is null
      ), recycle_endpoint_elements as (
        select recycle.company_id,recycle.recycle_bin_item_id,
               definition.resource_type,definition.id_column,element.row_json,
               case when jsonb_typeof(element.row_json)='object'
                    then element.row_json else '{}'::jsonb end as row_object
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
          case when jsonb_typeof(recycle.restore_payload->definition.table_name)='array'
               then recycle.restore_payload->definition.table_name
               else '[]'::jsonb end
        ) element(row_json)
      ), recycled_endpoints as (
        select company_id,recycle_bin_item_id,resource_type,
               public.mangorts_try_uuid(row_object->>id_column) as resource_id
        from recycle_endpoint_elements
        where jsonb_typeof(row_json)='object'
          and public.mangorts_try_uuid(row_object->>'company_id')=company_id
          and row_object->>'company_id'=company_id::text
          and public.mangorts_try_uuid(row_object->>id_column) is not null
          and row_object->>id_column=public.mangorts_try_uuid(row_object->>id_column)::text
      ), blockers as (
        select
          (select count(*) from public.recycle_bin_items
           where restore_payload ? 'action_item_sources'
             and jsonb_typeof(restore_payload->'action_item_sources') is distinct from 'array')
            as malformed_payload_container_count,
          (select count(*) from parsed_recycle_sources where not row_valid)
            as malformed_payload_row_count,
          (select count(*)
           from semantic_candidates candidate
           left join public.entities entity
             on entity.company_id=candidate.company_id and entity.entity_id=candidate.entity_id
           left join public.entity_types entity_type
             on entity_type.company_id=entity.company_id
            and entity_type.entity_type_id=entity.entity_type_id
            and entity_type.system_key='action_item'
           where entity_type.entity_type_id is null)
            as missing_action_item_count,
          (select count(*)
           from all_candidates candidate
           left join live_endpoints live_endpoint
             on live_endpoint.company_id=candidate.company_id
            and live_endpoint.resource_type=candidate.resource_type
            and live_endpoint.resource_id=candidate.resource_id
           left join recycled_endpoints recycled_endpoint
             on candidate.origin='recycle'
            and recycled_endpoint.recycle_bin_item_id=candidate.recycle_bin_item_id
            and recycled_endpoint.company_id=candidate.company_id
            and recycled_endpoint.resource_type=candidate.resource_type
            and recycled_endpoint.resource_id=candidate.resource_id
            where candidate.resource_type not in ('node','logic_gate','project','huddle_node','huddle_logic_gate','kpi')
               or (candidate.origin='live' and live_endpoint.resource_id is null)
               or (candidate.origin='recycle' and (
                 live_endpoint.resource_id is not null
                 or recycled_endpoint.resource_id is null
               )))
             as invalid_or_missing_endpoint_count,
          (select count(*) from (
             select company_id,entity_id
             from semantic_candidates
             group by company_id,entity_id
             having count(*)>1
           ) conflict)
            as conflicting_action_item_count
      )
      select jsonb_build_object(
               'live_candidate_rows',(select count(*) from public.action_item_sources),
               'recycle_candidate_rows',(select count(*) from valid_recycle_candidates),
               'semantic_candidate_rows',(select count(*) from semantic_candidates),
               'malformed_payload_container_count',malformed_payload_container_count,
               'malformed_payload_row_count',malformed_payload_row_count,
               'missing_action_item_count',missing_action_item_count,
               'invalid_or_missing_endpoint_count',invalid_or_missing_endpoint_count,
               'conflicting_action_item_count',conflicting_action_item_count
             ),
             malformed_payload_container_count=0
             and malformed_payload_row_count=0
             and missing_action_item_count=0
             and invalid_or_missing_endpoint_count=0
             and conflicting_action_item_count=0
      from blockers
    $candidate$
    into candidate_details,candidate_safe;
  end if;

  if base_tables_present and source_contract_ok then
    with source_rows as (
      select field.company_id,field.entity_id,field.value_jsonb
      from entity_fields field
      where field.entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
    ), valid_nonnull as (
      select company_id,entity_id,
             value_jsonb->>'resource_type' as resource_type,
             mangorts_try_uuid(value_jsonb->>'resource_id') as resource_id
      from source_rows
      where value_jsonb is not null
        and jsonb_typeof(value_jsonb)='object'
        and value_jsonb=jsonb_build_object(
          'resource_type',value_jsonb->>'resource_type',
          'resource_id',value_jsonb->>'resource_id'
        )
        and value_jsonb->>'resource_type' in ('node','logic_gate','project','huddle_node','huddle_logic_gate','kpi')
        and mangorts_try_uuid(value_jsonb->>'resource_id') is not null
        and value_jsonb->>'resource_id'=mangorts_try_uuid(value_jsonb->>'resource_id')::text
    ), live_endpoints as (
      select company_id,'node'::text as resource_type,node_id as resource_id from nodes
      union all select company_id,'logic_gate',logic_gate_id from logic_gates
      union all select company_id,'project',project_id from projects
      union all select company_id,'huddle_node',huddle_node_id from huddle_nodes
      union all select company_id,'huddle_logic_gate',huddle_logic_gate_id
        from huddle_logic_gates where deleted_timestamp is null
      union all select company_id,'kpi',kpi_id from kpis where deleted_timestamp is null
    ), recycle_endpoint_elements as (
      select recycle.company_id,definition.resource_type,definition.id_column,element.row_json,
             case when jsonb_typeof(element.row_json)='object'
                  then element.row_json else '{}'::jsonb end as row_object
      from recycle_bin_items recycle
      cross join (values
        ('nodes','node_id','node'),
        ('logic_gates','logic_gate_id','logic_gate'),
        ('projects','project_id','project'),
        ('huddle_nodes','huddle_node_id','huddle_node'),
        ('huddle_logic_gates','huddle_logic_gate_id','huddle_logic_gate'),
        ('kpis','kpi_id','kpi')
      ) definition(table_name,id_column,resource_type)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(recycle.restore_payload->definition.table_name)='array'
             then recycle.restore_payload->definition.table_name
             else '[]'::jsonb end
      ) element(row_json)
    ), recycled_endpoints as (
      select company_id,resource_type,mangorts_try_uuid(row_object->>id_column) as resource_id
      from recycle_endpoint_elements
      where jsonb_typeof(row_json)='object'
        and mangorts_try_uuid(row_object->>'company_id')=company_id
        and row_object->>'company_id'=company_id::text
        and mangorts_try_uuid(row_object->>id_column) is not null
        and row_object->>id_column=mangorts_try_uuid(row_object->>id_column)::text
    ), valid_endpoints as (
      select * from live_endpoints union select * from recycled_endpoints
    ), blockers as (
      select
        (select count(*) from source_rows source where source.value_jsonb is not null)
          - (select count(*) from valid_nonnull) as malformed_source_value_count,
        (select count(*)
         from valid_nonnull source
         left join valid_endpoints endpoint using(company_id,resource_type,resource_id)
         where endpoint.resource_id is null) as missing_source_endpoint_count,
        (select count(*)
         from source_rows source
         left join entities entity
           on entity.company_id=source.company_id and entity.entity_id=source.entity_id
         where entity.entity_type_id is distinct from 'a17e0000-0000-4000-8000-000000000001'::uuid)
          as non_action_item_source_field_count
    )
    select jsonb_build_object(
             'nonnull_source_rows',(select count(*) from source_rows where value_jsonb is not null),
             'malformed_source_value_count',malformed_source_value_count,
             'missing_source_endpoint_count',missing_source_endpoint_count,
             'non_action_item_source_field_count',non_action_item_source_field_count
           ),
           malformed_source_value_count=0
           and missing_source_endpoint_count=0
           and non_action_item_source_field_count=0
    into final_value_details,final_values_safe
    from blockers;
  end if;

  fresh_ready := server_supported
    and read_only_transaction
    and base_tables_present
    and transition_columns_ok
    and ledger_rel is not null
    and ledger_shape_ok
    and not old_recorded and not new_recorded
    and legacy_objects_absent
    and final_objects_absent
    and legacy_unexpected_dependency_count=0
    and resource_constraints_absent
    and base_indexes_ok and assigned_index_absent
    and action_item_type_contract_ok and original_fields_contract_ok
    and original_fields_fresh_positions_ok
    and assigned_canonical_absent and source_canonical_absent
    and base_protection_present
    and not protect_field_has_assigned and not protect_field_has_source
    and not protect_entity_has_assigned and not protect_entity_has_source
    and legacy_payload_key_count=0;

  prior_ready := server_supported
    and read_only_transaction
    and base_tables_present
    and transition_columns_ok
    and ledger_rel is not null
    and ledger_shape_ok
    and old_recorded and not new_recorded
    and legacy_rel is not null
    and legacy_columns_ok and legacy_constraints_ok and legacy_triggers_ok
    and legacy_unexpected_dependency_count=0
    and final_objects_absent
    and resource_constraints_absent
    and base_indexes_ok and assigned_index_present
    and action_item_type_contract_ok and original_fields_contract_ok and assigned_contract_ok
    and original_fields_post_positions_ok
    and source_canonical_absent
    and assigned_collision_count=0
    and base_protection_present
    and protect_field_has_assigned and not protect_field_has_source
    and protect_entity_has_assigned and not protect_entity_has_source
    and candidate_safe;

  final_ready := server_supported
    and read_only_transaction
    and base_tables_present
    and transition_columns_ok
    and ledger_rel is not null
    and ledger_shape_ok
    and old_recorded and new_recorded
    and legacy_objects_absent
    and final_objects_present
    and resource_constraints_present
    and base_indexes_ok and assigned_index_present
    and action_item_type_contract_ok and original_fields_contract_ok
    and original_fields_post_positions_ok
    and assigned_contract_ok and source_contract_ok
    and assigned_collision_count=0 and source_collision_count=0
    and base_protection_present
    and protect_field_has_assigned and protect_field_has_source
    and protect_entity_has_assigned and protect_entity_has_source
    and legacy_payload_key_count=0
    and final_values_safe
    and not exists (
      select 1
      from pg_proc routine
      join pg_namespace namespace_row on namespace_row.oid=routine.pronamespace
      where namespace_row.nspname not in ('pg_catalog','information_schema')
        and lower(routine.prosrc) like '%action_item_sources%'
    );

  if fresh_ready then
    database_state := 'FRESH';
    readiness_status := 'READY';
    next_action := 'RUN_NORMAL_MIGRATOR_OLD_THEN_NEW';
  elsif prior_ready then
    database_state := 'PRIOR_APPLIED';
    readiness_status := 'READY';
    next_action := 'RUN_NORMAL_MIGRATOR_NEW_FILE_ONLY';
  elsif final_ready then
    database_state := 'FINAL';
    readiness_status := 'READY';
    next_action := 'NO_WRITE_REQUIRED';
  else
    database_state := 'PARTIAL_DRIFT';
    readiness_status := 'STOP';
    next_action := 'STOP_AND_REVIEW_DRIFT';
  end if;

  details := jsonb_build_object(
    'server_supported',server_supported,
    'read_only_transaction',read_only_transaction,
    'base_tables_present',base_tables_present,
    'transition_exact_unordered_columns',transition_columns_ok,
    'ledger_present',ledger_rel is not null,
    'ledger_shape_ok',ledger_shape_ok,
    'old_migration_recorded',old_recorded,
    'new_migration_recorded',new_recorded,
    'legacy_table_present',legacy_rel is not null,
    'legacy_exact_unordered_columns',legacy_columns_ok,
    'legacy_constraints_and_index',legacy_constraints_ok,
    'legacy_trigger_and_function_set',legacy_triggers_ok,
    'legacy_unexpected_dependency_count',legacy_unexpected_dependency_count,
    'legacy_payload_key_count',legacy_payload_key_count,
    'resource_constraints_present',resource_constraints_present,
    'resource_constraints_absent',resource_constraints_absent,
    'base_indexes_exact',base_indexes_ok,
    'assigned_by_index_present',assigned_index_present,
    'assigned_by_index_absent',assigned_index_absent,
    'original_required_fields',original_fields_contract_ok,
    'original_required_fresh_positions',original_fields_fresh_positions_ok,
    'original_required_post_positions',original_fields_post_positions_ok,
    'assigned_by_contract',assigned_contract_ok,
    'source_contract',source_contract_ok,
    'assigned_by_custom_collision_count',assigned_collision_count,
    'source_custom_collision_count',source_collision_count,
    'candidate_validation',candidate_details,
    'final_value_validation',final_value_details
  );

  perform set_config('mangorts.action_item_source_preflight_state',database_state,true);
  perform set_config('mangorts.action_item_source_preflight_status',readiness_status,true);
  perform set_config('mangorts.action_item_source_preflight_next_action',next_action,true);
  perform set_config('mangorts.action_item_source_preflight_details',details::text,true);
end
$preflight$;

select current_setting('mangorts.action_item_source_preflight_state') as database_state,
       current_setting('mangorts.action_item_source_preflight_status') as status,
       current_setting('mangorts.action_item_source_preflight_next_action') as next_action,
       current_setting('mangorts.action_item_source_preflight_details')::jsonb as details;

rollback;
