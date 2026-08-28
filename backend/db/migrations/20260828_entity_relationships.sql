-- Replace the retired Action-Item-specific Huddle edge with one exact Entity-to-resource edge.
-- No legacy rows are carried forward because this feature has not shipped and the database is rebuilt cleanly.

begin;

drop trigger if exists trg_validate_action_item_huddle_relationship on action_item_huddle_relationships;
drop function if exists mangorts_validate_action_item_huddle_relationship();
drop table action_item_huddle_relationships;

create table entity_relationships (
  company_id uuid not null,
  entity_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,entity_id,resource_type,resource_id),
  constraint entity_relationships_resource_type_chk
    check (resource_type='huddle_node'),
  constraint entity_relationships_entity_fkey
    foreign key (company_id,entity_id)
    references entities(company_id,entity_id) on delete cascade,
  constraint entity_relationships_huddle_node_fkey
    foreign key (company_id,resource_id)
    references huddle_nodes(company_id,huddle_node_id) on delete cascade
);

create index idx_entity_relationships_resource
  on entity_relationships(company_id,resource_id,resource_type,entity_id);

create or replace function mangorts_validate_entity_relationship()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.company_id is distinct from old.company_id
     or new.entity_id is distinct from old.entity_id
     or new.resource_type is distinct from old.resource_type
     or new.resource_id is distinct from old.resource_id then
    raise exception 'entity_relationship_endpoints_immutable' using errcode='23514';
  end if;
  return new;
end;
$$;

create trigger trg_validate_entity_relationship
before update on entity_relationships
for each row execute function mangorts_validate_entity_relationship();

commit;
