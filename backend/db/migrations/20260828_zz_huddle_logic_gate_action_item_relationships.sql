-- Allow exact Action Item relationships from both Huddle Nodes and Huddle Logic Gates.

begin;

drop trigger if exists trg_validate_entity_relationship on entity_relationships;
drop function if exists mangorts_validate_entity_relationship();

alter table entity_relationships
  drop constraint entity_relationships_huddle_node_fkey;

alter table entity_relationships
  drop constraint entity_relationships_resource_type_chk;

alter table entity_relationships
  add constraint entity_relationships_resource_type_chk
  check (resource_type in ('huddle_node','huddle_logic_gate'));

create or replace function mangorts_validate_entity_relationship()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='UPDATE' and (
       new.company_id is distinct from old.company_id
       or new.entity_id is distinct from old.entity_id
       or new.resource_type is distinct from old.resource_type
       or new.resource_id is distinct from old.resource_id
     ) then
    raise exception 'entity_relationship_endpoints_immutable' using errcode='23514';
  end if;

  if new.resource_type='huddle_node' then
    perform 1
    from huddle_nodes
    where company_id=new.company_id and huddle_node_id=new.resource_id
    for key share;
  elsif new.resource_type='huddle_logic_gate' then
    perform 1
    from huddle_logic_gates
    where company_id=new.company_id and huddle_logic_gate_id=new.resource_id
    for key share;
  else
    raise exception 'entity_relationship_resource_type_invalid:%',new.resource_type using errcode='23514';
  end if;

  if not found then
    raise exception 'entity_relationship_resource_not_found:%:%',new.resource_type,new.resource_id using errcode='23503';
  end if;
  return new;
end;
$$;

create trigger trg_validate_entity_relationship
before insert or update on entity_relationships
for each row execute function mangorts_validate_entity_relationship();

create or replace function mangorts_delete_entity_relationships_for_huddle_resource()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_table_name='huddle_nodes' then
    delete from entity_relationships
    where company_id=old.company_id
      and resource_type='huddle_node'
      and resource_id=old.huddle_node_id;
  elsif tg_table_name='huddle_logic_gates' then
    delete from entity_relationships
    where company_id=old.company_id
      and resource_type='huddle_logic_gate'
      and resource_id=old.huddle_logic_gate_id;
  else
    raise exception 'entity_relationship_delete_source_invalid:%',tg_table_name using errcode='23514';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_delete_huddle_node_entity_relationships on huddle_nodes;
create trigger trg_delete_huddle_node_entity_relationships
after delete on huddle_nodes
for each row execute function mangorts_delete_entity_relationships_for_huddle_resource();

drop trigger if exists trg_delete_huddle_logic_gate_entity_relationships on huddle_logic_gates;
create trigger trg_delete_huddle_logic_gate_entity_relationships
after delete on huddle_logic_gates
for each row execute function mangorts_delete_entity_relationships_for_huddle_resource();

with recursive huddle_logic_gate_json(company_id,huddle_logic_gate_id,object_value) as (
  select company_id,huddle_logic_gate_id,body_json
  from huddle_logic_gates
  where deleted_timestamp is null
  union all
  select walk.company_id,walk.huddle_logic_gate_id,child.value
  from huddle_logic_gate_json walk
  cross join lateral jsonb_array_elements(
    case jsonb_typeof(walk.object_value)
      when 'object' then coalesce((
        select jsonb_agg(entry.value)
        from jsonb_each(walk.object_value) entry
      ),'[]'::jsonb)
      when 'array' then walk.object_value
      else '[]'::jsonb
    end
  ) child(value)
)
insert into entity_relationships(company_id,entity_id,resource_type,resource_id)
select distinct walk.company_id,entity.entity_id,'huddle_logic_gate',walk.huddle_logic_gate_id
from huddle_logic_gate_json walk
join entities entity
  on entity.company_id=walk.company_id
 and entity.entity_id::text=lower(btrim(walk.object_value #>> '{attrs,entityId}'))
join entity_types entity_type
  on entity_type.company_id=entity.company_id
 and entity_type.entity_type_id=entity.entity_type_id
where walk.object_value ->> 'type'='mangoEntityLink'
  and lower(btrim(walk.object_value #>> '{attrs,entityType}'))='entity'
  and entity_type.system_key='action_item'
on conflict (company_id,entity_id,resource_type,resource_id) do nothing;

commit;
