-- LOCAL EXPERIMENT ONLY.
-- Restores the legacy HTML reader and writer. The shadow JSON test row is
-- intentionally retained for comparison and later frontend retesting.

begin;

update workspace_editor_formats
set editor_format = 'legacy_html',
    migration_state = 'not_started',
    expected_document_count = 0,
    converted_document_count = 0,
    validated_timestamp = null,
    cutover_timestamp = null
where company_id = '11111111-1111-1111-1111-111111111111'::uuid;

commit;
