-- Mandated Action Item Entity Type, live option-backed Entity fields, and exact Huddle Process rollup.
-- PostgreSQL 17.x compatible.

begin;

create or replace function mangorts_entity_field_type_config_valid(p_field_type text, p_config jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path=public,pg_temp
as $$
declare
  option_value jsonb;
begin
  if jsonb_typeof(p_config) <> 'object' then
    return false;
  end if;

  if p_field_type not in ('choice','color') then
    return p_config = '{}'::jsonb;
  end if;

  if (p_config - array['default','options']) <> '{}'::jsonb then
    return false;
  end if;
  if jsonb_typeof(p_config->'options') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_config->'options') = 0 then
    return false;
  end if;

  for option_value in select value from jsonb_array_elements(p_config->'options') loop
    if jsonb_typeof(option_value) is distinct from 'object'
       or jsonb_typeof(option_value->'key') is distinct from 'string'
       or (option_value->>'key') !~ '^[a-z][a-z0-9_]*$'
       or length(option_value->>'key') > 200
       or jsonb_typeof(option_value->'label') is distinct from 'string'
       or btrim(option_value->>'label') = ''
       or length(option_value->>'label') > 200 then
      return false;
    end if;

    if p_field_type = 'choice' then
      if (option_value - array['key','label']) <> '{}'::jsonb then
        return false;
      end if;
    elsif (option_value - array['key','label','color']) <> '{}'::jsonb
          or jsonb_typeof(option_value->'color') is distinct from 'string'
          or (option_value->>'color') !~ '^#[0-9a-f]{6}$' then
      return false;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_config->'options') item
    group by item->>'key'
    having count(*) > 1
  ) then
    return false;
  end if;

  if p_config ? 'default' and p_config->'default' <> 'null'::jsonb then
    if jsonb_typeof(p_config->'default') is distinct from 'string'
       or not exists (
         select 1
         from jsonb_array_elements(p_config->'options') item
         where item->>'key' = p_config->>'default'
       ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

alter table entity_types
  add column system_key text,
  add constraint entity_types_system_key_chk check (
    system_key is null or system_key ~ '^[a-z][a-z0-9_]*$'
  );

create unique index idx_entity_types_company_system_key_unique
  on entity_types(company_id,system_key)
  where system_key is not null;

alter table entity_field_types
  add column system_key text,
  add column config_jsonb jsonb not null default '{}'::jsonb,
  drop constraint entity_field_types_field_type_chk,
  add constraint entity_field_types_field_type_chk
    check (field_type in ('text','number','date','boolean','choice','color','person')),
  add constraint entity_field_types_system_key_chk check (
    system_key is null or system_key ~ '^[a-z][a-z0-9_]*$'
  ),
  add constraint entity_field_types_config_jsonb_chk
    check (mangorts_entity_field_type_config_valid(field_type,config_jsonb));

create unique index idx_entity_field_types_type_system_key_unique
  on entity_field_types(company_id,entity_type_id,system_key)
  where system_key is not null;

alter table entities
  add column created_by_user_id uuid,
  add constraint entities_created_by_company_member_fkey
    foreign key (company_id,created_by_user_id)
    references company_memberships(company_id,user_id)
    on delete set null (created_by_user_id);

alter table entity_fields
  add column entity_field_type_id uuid,
  drop constraint entity_fields_field_type_chk,
  add constraint entity_fields_field_type_chk
    check (field_type in ('text','number','date','boolean','choice','color','person')),
  drop constraint entity_fields_value_shape_chk,
  add constraint entity_fields_value_shape_chk check (
    value_jsonb is null
    or (field_type in ('text','date','choice','color') and jsonb_typeof(value_jsonb) = 'string')
    or (field_type = 'person'
        and jsonb_typeof(value_jsonb) = 'string'
        and (value_jsonb #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (field_type = 'number' and jsonb_typeof(value_jsonb) = 'number')
    or (field_type = 'boolean' and jsonb_typeof(value_jsonb) = 'boolean')
  ),
  add constraint entity_fields_entity_field_type_fkey
    foreign key (company_id,entity_field_type_id)
    references entity_field_types(company_id,entity_field_type_id)
    on delete set null (entity_field_type_id);

create unique index idx_entity_fields_entity_field_type_unique
  on entity_fields(company_id,entity_id,entity_field_type_id)
  where entity_field_type_id is not null;

create index idx_entity_fields_field_type_link
  on entity_fields(company_id,entity_field_type_id,entity_id)
  where entity_field_type_id is not null;

create table action_item_huddle_relationships (
  company_id uuid not null,
  entity_id uuid not null,
  huddle_logic_gate_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,entity_id),
  constraint action_item_huddle_relationships_entity_fkey
    foreign key (company_id,entity_id)
    references entities(company_id,entity_id) on delete cascade,
  constraint action_item_huddle_relationships_huddle_fkey
    foreign key (company_id,huddle_logic_gate_id)
    references huddle_logic_gates(company_id,huddle_logic_gate_id) on delete cascade
);

create index idx_action_item_huddle_relationships_huddle
  on action_item_huddle_relationships(company_id,huddle_logic_gate_id,entity_id);

-- Reserve the mandated display label without silently adopting an arbitrary customer schema.
update entity_types
set name='Action Item (custom ' || entity_type_id::text || ')',
    updated_timestamp=now()
where lower(btrim(name))='action item';

insert into entity_types (company_id,entity_type_id,name,system_key)
select company_id,'a17e0000-0000-4000-8000-000000000001'::uuid,'Action Item','action_item'
from companies;

insert into entity_field_types (
  company_id,entity_field_type_id,entity_type_id,entity_folder_id,
  name,field_type,system_key,config_jsonb,position
)
select company.company_id,definition.entity_field_type_id,
       'a17e0000-0000-4000-8000-000000000001'::uuid,null,
       definition.name,definition.field_type,definition.system_key,definition.config_jsonb,definition.position
from companies company
cross join (values
  ('a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person','person_in_charge','{}'::jsonb,0),
  ('a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date','analysis_due_date','{}'::jsonb,1),
  ('a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date','completion_due_date','{}'::jsonb,2),
  ('a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice','status',
   '{"default":"in_progress","options":[{"key":"in_progress","label":"In progress"},{"key":"pending","label":"Pending"},{"key":"done","label":"Done"}]}'::jsonb,3),
  ('a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color','color',
   '{"default":null,"options":[{"key":"yellow","label":"Yellow","color":"#facc15"},{"key":"red","label":"Red","color":"#ef4444"}]}'::jsonb,4)
) as definition(entity_field_type_id,name,field_type,system_key,config_jsonb,position);

create or replace function mangorts_protect_action_item_entity_type()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.system_key = 'action_item'
       and exists (select 1 from companies where company_id=old.company_id) then
      raise exception 'action_item_entity_type_required' using errcode='23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.system_key = 'action_item' and (
    new.company_id is distinct from old.company_id
    or new.entity_type_id is distinct from old.entity_type_id
    or new.system_key is distinct from old.system_key
    or new.name is distinct from old.name
  ) then
    raise exception 'action_item_entity_type_immutable' using errcode='23514';
  end if;

  if new.system_key = 'action_item' and (
    new.entity_type_id <> 'a17e0000-0000-4000-8000-000000000001'::uuid
    or new.name <> 'Action Item'
  ) then
    raise exception 'action_item_entity_type_invalid' using errcode='23514';
  end if;

  return new;
end;
$$;

create trigger trg_protect_action_item_entity_type
before insert or update or delete on entity_types
for each row execute function mangorts_protect_action_item_entity_type();

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
      and old.system_key in ('person_in_charge','analysis_due_date','completion_due_date','status','color');

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
     or new.system_key not in ('person_in_charge','analysis_due_date','completion_due_date','status','color') then
    if lower(btrim(new.name)) in ('person in charge','analysis due date','completion due date','status','color') then
      raise exception 'action_item_field_type_name_reserved:%',new.name using errcode='23514';
    end if;
    return new;
  end if;

  select definition.expected_id,definition.expected_name,definition.expected_field_type
  into expected_id,expected_name,expected_field_type
  from (values
    ('person_in_charge','a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person'),
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

create trigger trg_protect_action_item_field_type
before insert or update or delete on entity_field_types
for each row execute function mangorts_protect_action_item_field_type();

create or replace function mangorts_maintain_entity_field_template_link()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  template_field_type text;
  template_config jsonb;
  person_id text;
  date_text text;
  parsed_date date;
begin
  if tg_op = 'UPDATE'
     and new.field_type is distinct from old.field_type
     and new.entity_field_type_id is not distinct from old.entity_field_type_id then
    new.entity_field_type_id := null;
  end if;

  if new.entity_field_type_id is not null then
    select template.field_type,template.config_jsonb
    into template_field_type,template_config
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
    if template_field_type <> new.field_type then
      raise exception 'entity_field_type_link_kind_mismatch' using errcode='23514';
    end if;
    if new.value_jsonb is not null and new.field_type in ('choice','color')
       and not exists (
         select 1
         from jsonb_array_elements(template_config->'options') option_value
         where option_value->>'key' = (new.value_jsonb #>> '{}')
       ) then
      raise exception 'entity_field_option_invalid' using errcode='23514';
    end if;
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
    if to_char(parsed_date,'YYYY-MM-DD') <> date_text then
      raise exception 'entity_field_date_invalid' using errcode='23514';
    end if;
  end if;

  if new.value_jsonb is not null and new.field_type='person' then
    person_id := new.value_jsonb #>> '{}';
    if person_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (
         select 1 from company_memberships membership
         where membership.company_id=new.company_id
           and membership.user_id=person_id::uuid
       ) then
      raise exception 'entity_field_person_not_company_member' using errcode='23503';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_maintain_entity_field_template_link
before insert or update of company_id,entity_id,entity_field_type_id,field_type,value_jsonb on entity_fields
for each row execute function mangorts_maintain_entity_field_template_link();

create or replace function mangorts_clear_entity_person_fields_for_membership()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if exists (select 1 from companies where company_id=old.company_id) then
    update entity_fields
    set value_jsonb=null,
        updated_timestamp=now()
    where company_id=old.company_id
      and field_type='person'
      and value_jsonb=to_jsonb(old.user_id::text);
  end if;
  return old;
end;
$$;

create trigger trg_clear_entity_person_fields_for_membership
after delete on company_memberships
for each row execute function mangorts_clear_entity_person_fields_for_membership();

create or replace function mangorts_unlink_entity_fields_after_template_retype()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  update entity_fields
  set entity_field_type_id=null,
      updated_timestamp=now()
  where company_id=new.company_id
    and entity_field_type_id=new.entity_field_type_id;
  return new;
end;
$$;

create trigger trg_unlink_entity_fields_after_template_retype
after update of field_type on entity_field_types
for each row
when (old.field_type is distinct from new.field_type)
execute function mangorts_unlink_entity_fields_after_template_retype();

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

    old_is_required := old_system_key in ('person_in_charge','analysis_due_date','completion_due_date','status','color');

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
           when 'analysis_due_date' then 'Analysis due date'
           when 'completion_due_date' then 'Completion due date'
           when 'status' then 'Status'
           when 'color' then 'Color'
         end,
         case template.system_key
           when 'person_in_charge' then 'person'
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
    and template.system_key in ('person_in_charge','analysis_due_date','completion_due_date','status','color');

  if found and (new.name <> new_expected_name or new.field_type <> new_expected_field_type) then
    raise exception 'action_item_entity_field_invalid:%',new_system_key using errcode='23514';
  end if;

  return new;
end;
$$;

create trigger trg_protect_action_item_entity_field
before insert or update or delete on entity_fields
for each row execute function mangorts_protect_action_item_entity_field();

create or replace function mangorts_validate_action_item_huddle_relationship()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.entity_id is distinct from old.entity_id
    or new.huddle_logic_gate_id is distinct from old.huddle_logic_gate_id
  ) then
    raise exception 'action_item_huddle_relationship_endpoints_immutable' using errcode='23514';
  end if;

  if not exists (
    select 1
    from entities entity
    join entity_types entity_type
      on entity_type.company_id=entity.company_id
     and entity_type.entity_type_id=entity.entity_type_id
    where entity.company_id=new.company_id
      and entity.entity_id=new.entity_id
      and entity_type.system_key='action_item'
  ) then
    raise exception 'action_item_huddle_relationship_requires_action_item' using errcode='23514';
  end if;

  return new;
end;
$$;

create trigger trg_validate_action_item_huddle_relationship
before insert or update on action_item_huddle_relationships
for each row execute function mangorts_validate_action_item_huddle_relationship();

commit;
