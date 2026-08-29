-- Action Item delegation attribution and immutable typed creation provenance.
-- PostgreSQL 17.x compatible.

begin;

-- Reserve the mandated display label and system key without adopting arbitrary
-- customer fields as the canonical Assigned by field.
update entity_fields field
set name='Assigned by (custom ' || field.entity_field_id::text || ')',
    updated_timestamp=now()
from entities entity
join entity_types entity_type
  on entity_type.company_id=entity.company_id
 and entity_type.entity_type_id=entity.entity_type_id
 and entity_type.system_key='action_item'
where field.company_id=entity.company_id
  and field.entity_id=entity.entity_id
  and lower(btrim(field.name))='assigned by';

update entity_field_types template
set name='Assigned by (custom ' || template.entity_field_type_id::text || ')',
    system_key=case when template.system_key='assigned_by' then null else template.system_key end,
    updated_timestamp=now()
from entity_types entity_type
where entity_type.company_id=template.company_id
  and entity_type.entity_type_id=template.entity_type_id
  and entity_type.system_key='action_item'
  and (
    lower(btrim(template.name))='assigned by'
    or template.system_key='assigned_by'
  );

-- Keep the declared field order stable while inserting Assigned by immediately
-- after Person in charge.
update entity_field_types
set position=case entity_field_type_id
      when 'a17e0000-0000-4000-8000-000000000101'::uuid then 0
      when 'a17e0000-0000-4000-8000-000000000102'::uuid then 2
      when 'a17e0000-0000-4000-8000-000000000103'::uuid then 3
      when 'a17e0000-0000-4000-8000-000000000104'::uuid then 4
      when 'a17e0000-0000-4000-8000-000000000105'::uuid then 5
    end,
    updated_timestamp=now()
where entity_field_type_id in (
  'a17e0000-0000-4000-8000-000000000101'::uuid,
  'a17e0000-0000-4000-8000-000000000102'::uuid,
  'a17e0000-0000-4000-8000-000000000103'::uuid,
  'a17e0000-0000-4000-8000-000000000104'::uuid,
  'a17e0000-0000-4000-8000-000000000105'::uuid
);

update entity_fields
set position=case entity_field_type_id
      when 'a17e0000-0000-4000-8000-000000000101'::uuid then 0
      when 'a17e0000-0000-4000-8000-000000000102'::uuid then 2
      when 'a17e0000-0000-4000-8000-000000000103'::uuid then 3
      when 'a17e0000-0000-4000-8000-000000000104'::uuid then 4
      when 'a17e0000-0000-4000-8000-000000000105'::uuid then 5
    end,
    updated_timestamp=now()
where entity_field_type_id in (
  'a17e0000-0000-4000-8000-000000000101'::uuid,
  'a17e0000-0000-4000-8000-000000000102'::uuid,
  'a17e0000-0000-4000-8000-000000000103'::uuid,
  'a17e0000-0000-4000-8000-000000000104'::uuid,
  'a17e0000-0000-4000-8000-000000000105'::uuid
);

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
  if tg_op <> 'INSERT' then
    select coalesce(entity_type.system_key='action_item',false)
    into old_is_action_item
    from entity_types entity_type
    where entity_type.company_id=old.company_id
      and entity_type.entity_type_id=old.entity_type_id;

    old_is_required := coalesce(old_is_action_item,false)
      and old.system_key in ('person_in_charge','assigned_by','analysis_due_date','completion_due_date','status','color');

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
     or new.system_key not in ('person_in_charge','assigned_by','analysis_due_date','completion_due_date','status','color') then
    if lower(btrim(new.name)) in ('person in charge','assigned by','analysis due date','completion due date','status','color') then
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
    ('color','a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color')
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

    old_is_required := old_system_key in ('person_in_charge','assigned_by','analysis_due_date','completion_due_date','status','color');

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
         end,
         case template.system_key
           when 'person_in_charge' then 'person'
           when 'assigned_by' then 'person'
           when 'analysis_due_date' then 'date'
           when 'completion_due_date' then 'date'
           when 'status' then 'choice'
           when 'color' then 'color'
         end
  into new_system_key,new_expected_name,new_expected_field_type
  from entity_field_types template
  join entity_types entity_type
    on entity_type.company_id=template.company_id
   and entity_type.entity_type_id=template.entity_type_id
   and entity_type.system_key='action_item'
  where template.company_id=new.company_id
    and template.entity_field_type_id=new.entity_field_type_id
    and template.system_key in ('person_in_charge','assigned_by','analysis_due_date','completion_due_date','status','color');

  if found and (new.name <> new_expected_name or new.field_type <> new_expected_field_type) then
    raise exception 'action_item_entity_field_invalid:%',new_system_key using errcode='23514';
  end if;

  return new;
end;
$$;

insert into entity_field_types (
  company_id,entity_field_type_id,entity_type_id,entity_folder_id,
  name,field_type,system_key,config_jsonb,position
)
select company.company_id,
       'a17e0000-0000-4000-8000-000000000106'::uuid,
       'a17e0000-0000-4000-8000-000000000001'::uuid,
       null,'Assigned by','person','assigned_by','{}'::jsonb,1
from companies company;

-- Existing items deliberately start with no Assigned by attribution.
insert into entity_fields (
  company_id,entity_field_id,entity_id,entity_field_type_id,
  name,field_type,value_jsonb,position
)
select entity.company_id,gen_random_uuid(),entity.entity_id,
       'a17e0000-0000-4000-8000-000000000106'::uuid,
       'Assigned by','person',null,1
from entities entity
join entity_types entity_type
  on entity_type.company_id=entity.company_id
 and entity_type.entity_type_id=entity.entity_type_id
 and entity_type.system_key='action_item';

create index idx_entity_fields_action_item_assigned_by
  on entity_fields(
    company_id,
    mangorts_try_uuid(value_jsonb #>> '{}'),
    entity_id
  )
  where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid;

create table action_item_sources (
  company_id uuid not null,
  entity_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,entity_id),
  constraint action_item_sources_resource_type_chk check (
    resource_type in (
      'node','logic_gate','project','huddle_node','huddle_logic_gate','kpi'
    )
  ),
  constraint action_item_sources_entity_fkey
    foreign key (company_id,entity_id)
    references entities(company_id,entity_id) on delete cascade
);

create index idx_action_item_sources_source
  on action_item_sources(
    company_id,resource_type,resource_id,entity_id
  );

create or replace function mangorts_validate_action_item_source()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='UPDATE' then
    raise exception 'action_item_source_immutable' using errcode='23514';
  end if;

  if tg_op='DELETE' then
    if pg_trigger_depth()>1 then
      return old;
    end if;
    raise exception 'action_item_source_immutable' using errcode='23514';
  end if;

  perform 1
  from entities entity
  join entity_types entity_type
    on entity_type.company_id=entity.company_id
   and entity_type.entity_type_id=entity.entity_type_id
   and entity_type.system_key='action_item'
  where entity.company_id=new.company_id
    and entity.entity_id=new.entity_id
  for key share of entity;

  if not found then
    raise exception 'action_item_source_requires_action_item' using errcode='23514';
  end if;

  if new.resource_type='node' then
    perform 1 from nodes
    where company_id=new.company_id and node_id=new.resource_id
    for key share;
  elsif new.resource_type='logic_gate' then
    perform 1 from logic_gates
    where company_id=new.company_id and logic_gate_id=new.resource_id
    for key share;
  elsif new.resource_type='project' then
    perform 1 from projects
    where company_id=new.company_id and project_id=new.resource_id
    for key share;
  elsif new.resource_type='huddle_node' then
    perform 1 from huddle_nodes
    where company_id=new.company_id and huddle_node_id=new.resource_id
    for key share;
  elsif new.resource_type='huddle_logic_gate' then
    perform 1 from huddle_logic_gates
    where company_id=new.company_id
      and huddle_logic_gate_id=new.resource_id
      and deleted_timestamp is null
    for key share;
  elsif new.resource_type='kpi' then
    perform 1 from kpis
    where company_id=new.company_id
      and kpi_id=new.resource_id
      and deleted_timestamp is null
    for key share;
  else
    raise exception 'action_item_source_resource_type_invalid:%',new.resource_type using errcode='23514';
  end if;

  if not found then
    raise exception 'action_item_source_resource_not_found:%:%',new.resource_type,new.resource_id using errcode='23503';
  end if;

  return new;
end;
$$;

create trigger trg_validate_action_item_source
before insert or update or delete on action_item_sources
for each row execute function mangorts_validate_action_item_source();

create or replace function mangorts_delete_action_item_sources_for_resource()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_table_name='nodes' then
    delete from action_item_sources
    where company_id=old.company_id
      and resource_type='node'
      and resource_id=old.node_id;
  elsif tg_table_name='logic_gates' then
    delete from action_item_sources
    where company_id=old.company_id
      and resource_type='logic_gate'
      and resource_id=old.logic_gate_id;
  elsif tg_table_name='projects' then
    delete from action_item_sources
    where company_id=old.company_id
      and resource_type='project'
      and resource_id=old.project_id;
  elsif tg_table_name='huddle_nodes' then
    delete from action_item_sources
    where company_id=old.company_id
      and resource_type='huddle_node'
      and resource_id=old.huddle_node_id;
  elsif tg_table_name='huddle_logic_gates' then
    delete from action_item_sources
    where company_id=old.company_id
      and resource_type='huddle_logic_gate'
      and resource_id=old.huddle_logic_gate_id;
  elsif tg_table_name='kpis' then
    delete from action_item_sources
    where company_id=old.company_id
      and resource_type='kpi'
      and resource_id=old.kpi_id;
  else
    raise exception 'action_item_source_delete_resource_invalid:%',tg_table_name using errcode='23514';
  end if;
  return old;
end;
$$;

create trigger trg_delete_node_action_item_sources
after delete on nodes
for each row execute function mangorts_delete_action_item_sources_for_resource();

create trigger trg_delete_logic_gate_action_item_sources
after delete on logic_gates
for each row execute function mangorts_delete_action_item_sources_for_resource();

create trigger trg_delete_project_action_item_sources
after delete on projects
for each row execute function mangorts_delete_action_item_sources_for_resource();

create trigger trg_delete_huddle_node_action_item_sources
after delete on huddle_nodes
for each row execute function mangorts_delete_action_item_sources_for_resource();

create trigger trg_delete_huddle_logic_gate_action_item_sources
after delete on huddle_logic_gates
for each row execute function mangorts_delete_action_item_sources_for_resource();

create trigger trg_delete_kpi_action_item_sources
after delete on kpis
for each row execute function mangorts_delete_action_item_sources_for_resource();

commit;
