create extension if not exists pgcrypto;

create table public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table public.companies (
  company_id uuid primary key,
  name text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now()
);

create table public.company_memberships (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  user_id uuid not null,
  primary key (company_id,user_id)
);

create table public.nodes (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  node_id uuid not null,
  name text not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,node_id)
);

create table public.logic_gates (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  logic_gate_id uuid not null,
  header text not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,logic_gate_id)
);

create table public.projects (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  project_id uuid not null,
  name text not null,
  status text not null default 'Active',
  default_access text not null default 'edit',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  health text not null default 'On Track',
  primary key (company_id,project_id)
);

create table public.huddle_logic_gates (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  huddle_logic_gate_id uuid not null,
  header text not null,
  deleted_timestamp timestamptz,
  primary key (company_id,huddle_logic_gate_id)
);

create table public.huddle_nodes (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  huddle_node_id uuid not null,
  huddle_logic_gate_id uuid not null,
  name text not null,
  primary key (company_id,huddle_node_id)
);

create table public.kpis (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  kpi_id uuid not null,
  logic_gate_id uuid not null,
  name text not null,
  deleted_timestamp timestamptz,
  primary key (company_id,kpi_id)
);

create or replace function public.mangorts_try_uuid(p_value text)
returns uuid
language plpgsql
immutable
strict
set search_path=public,pg_temp
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.mangorts_entity_field_type_config_valid(
  p_field_type text,
  p_config jsonb
) returns boolean
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
    return p_config='{}'::jsonb;
  end if;
  if (p_config-array['default','options']) <> '{}'::jsonb
     or jsonb_typeof(p_config->'options') is distinct from 'array'
     or jsonb_array_length(p_config->'options')=0 then
    return false;
  end if;
  for option_value in select value from jsonb_array_elements(p_config->'options') loop
    if jsonb_typeof(option_value) is distinct from 'object'
       or jsonb_typeof(option_value->'key') is distinct from 'string'
       or jsonb_typeof(option_value->'label') is distinct from 'string' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create table public.entity_types (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  entity_type_id uuid not null,
  name varchar(200) not null,
  system_key text,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entity_types_system_key_chk check (
    system_key is null or system_key ~ '^[a-z][a-z0-9_]*$'
  ),
  primary key (company_id,entity_type_id)
);

create unique index idx_entity_types_company_system_key_unique
  on public.entity_types(company_id,system_key)
  where system_key is not null;

create table public.entities (
  company_id uuid not null,
  entity_id uuid not null,
  entity_type_id uuid not null,
  entity_folder_id uuid,
  name varchar(200) not null,
  position integer not null default 0,
  body_json jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id,entity_id),
  foreign key (company_id,entity_type_id)
    references public.entity_types(company_id,entity_type_id) on delete cascade
);

create table public.entity_field_types (
  company_id uuid not null,
  entity_field_type_id uuid not null,
  entity_type_id uuid not null,
  entity_folder_id uuid,
  name varchar(200) not null,
  field_type text not null,
  system_key text,
  config_jsonb jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entity_field_types_field_type_chk check (
    field_type in ('text','number','date','boolean','choice','color','person')
  ),
  constraint entity_field_types_config_jsonb_chk check (
    public.mangorts_entity_field_type_config_valid(field_type,config_jsonb)
  ),
  constraint entity_field_types_system_key_chk check (
    system_key is null or system_key ~ '^[a-z][a-z0-9_]*$'
  ),
  primary key (company_id,entity_field_type_id),
  foreign key (company_id,entity_type_id)
    references public.entity_types(company_id,entity_type_id) on delete cascade
);

create unique index idx_entity_field_types_type_system_key_unique
  on public.entity_field_types(company_id,entity_type_id,system_key)
  where system_key is not null;

create table public.entity_fields (
  company_id uuid not null,
  entity_field_id uuid not null,
  entity_id uuid not null,
  entity_field_type_id uuid,
  name varchar(200) not null,
  field_type text not null,
  value_jsonb jsonb,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entity_fields_field_type_chk check (
    field_type in ('text','number','date','boolean','choice','color','person')
  ),
  constraint entity_fields_value_shape_chk check (
    value_jsonb is null
    or (field_type in ('text','date','choice','color') and jsonb_typeof(value_jsonb)='string')
    or (field_type='person'
        and jsonb_typeof(value_jsonb)='string'
        and (value_jsonb #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (field_type='number' and jsonb_typeof(value_jsonb)='number')
    or (field_type='boolean' and jsonb_typeof(value_jsonb)='boolean')
  ),
  primary key (company_id,entity_field_id),
  foreign key (company_id,entity_id)
    references public.entities(company_id,entity_id) on delete cascade,
  foreign key (company_id,entity_field_type_id)
    references public.entity_field_types(company_id,entity_field_type_id) on delete set null
);

create unique index idx_entity_fields_entity_field_type_unique
  on public.entity_fields(company_id,entity_id,entity_field_type_id)
  where entity_field_type_id is not null;

create table public.recycle_bin_items (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  recycle_bin_item_id uuid not null,
  object_kind text not null,
  object_id text not null,
  object_label text not null,
  object_folder_kind text,
  restore_payload jsonb not null,
  deleted_by_user_id uuid,
  deleted_timestamp timestamptz not null default now(),
  primary key (company_id,recycle_bin_item_id)
);

create or replace function public.mangorts_maintain_entity_field_template_link()
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
  if tg_op='UPDATE'
     and new.field_type is distinct from old.field_type
     and new.entity_field_type_id is not distinct from old.entity_field_type_id then
    new.entity_field_type_id := null;
  end if;
  if new.entity_field_type_id is not null then
    select template.field_type,template.config_jsonb
    into template_field_type,template_config
    from public.entity_field_types template
    join public.entities entity
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
         where option_value->>'key'=new.value_jsonb #>> '{}'
       ) then
      raise exception 'entity_field_option_invalid' using errcode='23514';
    end if;
  end if;
  if new.value_jsonb is not null and new.field_type='date' then
    date_text := new.value_jsonb #>> '{}';
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
         select 1 from public.company_memberships membership
         where membership.company_id=new.company_id and membership.user_id=person_id::uuid
       ) then
      raise exception 'entity_field_person_not_company_member' using errcode='23503';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.mangorts_protect_action_item_field_type()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.mangorts_protect_action_item_entity_field()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create trigger trg_protect_action_item_field_type
before insert or update or delete on public.entity_field_types
for each row execute function public.mangorts_protect_action_item_field_type();

create trigger trg_maintain_entity_field_template_link
before insert or update of company_id,entity_id,entity_field_type_id,field_type,value_jsonb
on public.entity_fields
for each row execute function public.mangorts_maintain_entity_field_template_link();

create trigger trg_protect_action_item_entity_field
before insert or update or delete on public.entity_fields
for each row execute function public.mangorts_protect_action_item_entity_field();

insert into public.companies(company_id,name) values
  ('10000000-0000-4000-8000-000000000001','Source transition A'),
  ('10000000-0000-4000-8000-000000000002','Source transition B');

insert into public.company_memberships(company_id,user_id) values
  ('10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001');

insert into public.entity_types(company_id,entity_type_id,name,system_key) values
  ('10000000-0000-4000-8000-000000000001','a17e0000-0000-4000-8000-000000000001','Action Item','action_item'),
  ('10000000-0000-4000-8000-000000000002','a17e0000-0000-4000-8000-000000000001','Action Item','action_item');

insert into public.entities(company_id,entity_id,entity_type_id,name) values
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','a17e0000-0000-4000-8000-000000000001','Live Source Action'),
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','a17e0000-0000-4000-8000-000000000001','Recycled Source Action');

insert into public.entity_field_types(
  company_id,entity_field_type_id,entity_type_id,name,field_type,system_key,config_jsonb,position
)
select company.company_id,definition.entity_field_type_id,
       'a17e0000-0000-4000-8000-000000000001'::uuid,
       definition.name,definition.field_type,definition.system_key,definition.config_jsonb,definition.position
from public.companies company
cross join (values
  ('a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person','person_in_charge','{}'::jsonb,0),
  ('a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date','analysis_due_date','{}'::jsonb,1),
  ('a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date','completion_due_date','{}'::jsonb,2),
  ('a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice','status','{"default":"in_progress","options":[{"key":"in_progress","label":"In progress"},{"key":"pending","label":"Pending"},{"key":"done","label":"Done"}]}'::jsonb,3),
  ('a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color','color','{"default":null,"options":[{"key":"yellow","label":"Yellow","color":"#facc15"},{"key":"red","label":"Red","color":"#ef4444"}]}'::jsonb,4)
) definition(entity_field_type_id,name,field_type,system_key,config_jsonb,position);

insert into public.entity_fields(
  company_id,entity_field_id,entity_id,entity_field_type_id,name,field_type,value_jsonb,position
)
select entity.company_id,gen_random_uuid(),entity.entity_id,template.entity_field_type_id,
       template.name,template.field_type,
       case template.system_key
         when 'status' then '"in_progress"'::jsonb
         else null
       end,
       template.position
from public.entities entity
join public.entity_field_types template
  on template.company_id=entity.company_id
 and template.entity_type_id=entity.entity_type_id;

insert into public.entity_field_types(
  company_id,entity_field_type_id,entity_type_id,name,field_type,config_jsonb,position
) values
  ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','a17e0000-0000-4000-8000-000000000001','Source','text','{}',20),
  ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','a17e0000-0000-4000-8000-000000000001','Assigned by','text','{}',21);

insert into public.entity_fields(
  company_id,entity_field_id,entity_id,entity_field_type_id,name,field_type,value_jsonb,position
) values
  ('10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','Source','text','"custom source"',20),
  ('10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','Assigned by','text','"custom assigned"',21);

insert into public.nodes(company_id,node_id,name) values
  ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Live Source Node');

insert into public.projects(company_id,project_id,name) values
  ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Recycled Source Project');
