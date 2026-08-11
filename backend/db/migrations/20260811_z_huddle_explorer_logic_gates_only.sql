-- Huddle Explorer stores Huddle Logic Gate placements only. PostgreSQL 17.x compatible.

alter table huddle_explorer_items
  drop constraint if exists huddle_explorer_items_huddle_type_chk;
alter table huddle_explorer_items
  add constraint huddle_explorer_items_huddle_type_chk
  check (huddle_type = 'huddle_logic_gate') not valid;

delete from recycle_bin_items item
where item.object_kind = 'huddle_explorer_item'
  and exists (
    select 1
    from jsonb_array_elements(coalesce(item.restore_payload->'huddle_explorer_items','[]'::jsonb)) placement
    where placement->>'huddle_type' = 'huddle_node'
  );

update recycle_bin_items item
set restore_payload = item.restore_payload - 'huddle_explorer_items'
where item.object_kind = 'huddle_node'
  and exists (
    select 1
    from jsonb_array_elements(coalesce(item.restore_payload->'huddle_explorer_items','[]'::jsonb)) placement
    where placement->>'huddle_type' = 'huddle_node'
  );

delete from huddle_explorer_items
where huddle_type = 'huddle_node';

alter table huddle_explorer_items
  validate constraint huddle_explorer_items_huddle_type_chk;

create or replace function mangorts_validate_huddle_explorer_item()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.huddle_type='huddle_logic_gate' and not exists(
    select 1 from huddle_logic_gates where company_id=new.company_id and huddle_logic_gate_id=new.resource_huddle_resource_id
  ) then raise exception 'huddle_logic_gate_missing' using errcode='23503'; end if;
  return new;
end; $$;
