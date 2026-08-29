create index idx_entity_fields_action_item_person_in_charge
on entity_fields (
  company_id,
  mangorts_try_uuid(value_jsonb #>> '{}'),
  entity_id
)
where entity_field_type_id='a17e0000-0000-4000-8000-000000000101'::uuid;
