-- LOCAL EXPERIMENT ONLY.
-- This deliberately enables Tiptap JSON for the entire test company even
-- though only one editor document has been converted. Do not use this as a
-- production or shared-development migration.

begin;

do $mango_check$
declare
  target_count bigint;
  company_json_count bigint;
begin
  select count(*)
  into target_count
  from editor_json_documents
  where company_id = '11111111-1111-1111-1111-111111111111'::uuid
    and resource_type = 'node'
    and resource_id = '019f055e-c842-799b-83c9-f6adcd2375cb'
    and document_id = 'e0cf4c32-5ec2-4729-8308-8056ae4d0a9d'
    and revision = 0
    and not is_deleted
    and canonical_document->>'format' = 'mango-tiptap-json'
    and jsonb_array_length(canonical_annotations) = 6;

  if target_count <> 1 then
    raise exception 'Converted test textbox is missing or invalid';
  end if;

  select count(*)
  into company_json_count
  from editor_json_documents
  where company_id = '11111111-1111-1111-1111-111111111111'::uuid
    and not is_deleted;

  if company_json_count <> 1 then
    raise exception 'Expected exactly one JSON document, found %', company_json_count;
  end if;
end
$mango_check$;

insert into workspace_editor_formats (
  company_id,
  editor_format,
  migration_state,
  document_schema_version,
  expected_document_count,
  converted_document_count,
  validated_timestamp,
  cutover_timestamp
)
values (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'tiptap_json',
  'ready',
  1,
  1,
  1,
  now(),
  now()
)
on conflict (company_id) do update
set editor_format = 'tiptap_json',
    migration_state = 'ready',
    document_schema_version = 1,
    expected_document_count = 1,
    converted_document_count = 1,
    validated_timestamp = now(),
    cutover_timestamp = now()
where workspace_editor_formats.editor_format = 'legacy_html'
  and workspace_editor_formats.migration_state = 'not_started';

do $mango_verify$
begin
  if not exists (
    select 1
    from workspace_editor_formats
    where company_id = '11111111-1111-1111-1111-111111111111'::uuid
      and editor_format = 'tiptap_json'
      and migration_state = 'ready'
      and expected_document_count = 1
      and converted_document_count = 1
  ) then
    raise exception 'JSON cutover did not activate';
  end if;
end
$mango_verify$;

commit;
