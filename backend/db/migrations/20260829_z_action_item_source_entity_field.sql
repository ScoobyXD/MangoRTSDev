-- Destructive forward-only cutover from the shipped Action Item Source table
-- to the canonical protected Source Entity Field. Legacy Source values are not
-- preserved.
-- PostgreSQL 17.x compatible.

begin;

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

-- Remove custom Source collisions while the old Source-unaware guards remain
-- active. Fields linked to a conflicting template are removed before it.
delete from entity_fields field
using entities entity
join entity_types entity_type
  on entity_type.company_id=entity.company_id
 and entity_type.entity_type_id=entity.entity_type_id
 and entity_type.system_key='action_item'
where field.company_id=entity.company_id
  and field.entity_id=entity.entity_id
  and (
    lower(btrim(field.name))='source'
    or exists (
      select 1
      from entity_field_types template
      where template.company_id=field.company_id
        and template.entity_field_type_id=field.entity_field_type_id
        and (
          lower(btrim(template.name))='source'
          or template.system_key='source'
        )
    )
  );

delete from entity_field_types template
using entity_types entity_type
where entity_type.company_id=template.company_id
  and entity_type.entity_type_id=template.entity_type_id
  and entity_type.system_key='action_item'
  and (
    lower(btrim(template.name))='source'
    or template.system_key='source'
  );

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
       'Source','resource',null,6
from entities entity
join entity_types entity_type
  on entity_type.company_id=entity.company_id
 and entity_type.entity_type_id=entity.entity_type_id
 and entity_type.system_key='action_item';

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

commit;
