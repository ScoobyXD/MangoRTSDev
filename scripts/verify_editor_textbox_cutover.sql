-- Read-only verification for the editor textbox cutover.
-- Run after 20260801_editor_textbox_storage_foundation.sql and before the
-- destructive cleanup migration. Every row with status='blocker' must be zero.

with checks as (
  select 'node editor documents without a parent node'::text as check_name,
         count(*)::bigint as problem_count
    from editor_json_documents legacy
    left join nodes parent
      on parent.company_id=legacy.company_id
     and parent.node_id=legacy.resource_id::uuid
   where legacy.resource_type='node'
     and parent.node_id is null
  union all
  select 'node current rows missing or different'::text as check_name,
         count(*)::bigint as problem_count
    from editor_json_documents legacy
    join nodes parent
      on parent.company_id=legacy.company_id
     and parent.node_id=legacy.resource_id::uuid
    left join node_textboxes current
      on current.company_id=legacy.company_id
     and current.node_id=legacy.resource_id::uuid
     and current.textbox_id=legacy.document_id::uuid
   where legacy.resource_type='node'
     and (
       current.textbox_id is null
       or current.revision < legacy.revision
       or (current.revision = legacy.revision and (
         current.body_json-'annotations' is distinct from legacy.canonical_document
         or current.body_json->'annotations' is distinct from legacy.canonical_annotations
         or (current.deleted_timestamp is not null) <> legacy.is_deleted
       ))
     )
  union all
  select 'project current rows missing or different', count(*)
    from project_editor_documents legacy
    left join project_textboxes current
      on current.company_id=legacy.company_id
     and current.project_id=legacy.project_id
     and current.textbox_id=legacy.document_id
   where current.textbox_id is null
      or current.revision < legacy.revision
      or (current.revision = legacy.revision and (
        current.body_json-'annotations' is distinct from legacy.document_json
        or current.body_json->'annotations' is distinct from legacy.canonical_annotations
        or (current.deleted_timestamp is not null) <> legacy.is_deleted
      ))
  union all
  select 'logic gate current rows missing or different', count(*)
    from logic_gate_editor_documents legacy
    left join logic_gate_textboxes current
      on current.company_id=legacy.company_id
     and current.logic_gate_id=legacy.logic_gate_id
     and current.textbox_id=legacy.document_id
   where current.textbox_id is null
      or current.revision < legacy.revision
      or (current.revision = legacy.revision and (
        current.body_json-'annotations' is distinct from legacy.document_json
        or current.body_json->'annotations' is distinct from legacy.canonical_annotations
        or (current.deleted_timestamp is not null) <> legacy.is_deleted
      ))
  union all
  select 'node manual JSON save rows not copied', count(*)
    from node_information legacy
    cross join lateral (
      select mangorts_legacy_saved_editor_body(legacy.information) body_json
    ) converted
    left join node_textboxes_history current
      on current.company_id=legacy.company_id
     and current.node_id=legacy.node_id
     and current.batch_id=legacy.save_batch_id
     and current.textbox_id=coalesce(legacy.source_information_id,legacy.information_id)
   where legacy.save_batch_id is not null
     and converted.body_json is not null
     and current.textbox_id is null
  union all
  select 'logic gate manual JSON save rows not copied', count(*)
    from logic_gate_information legacy
    cross join lateral (
      select mangorts_legacy_saved_editor_body(legacy.information) body_json
    ) converted
    left join logic_gate_textboxes_history current
      on current.company_id=legacy.company_id
     and current.logic_gate_id=legacy.logic_gate_id
     and current.batch_id=legacy.save_batch_id
     and current.textbox_id=coalesce(legacy.source_information_id,legacy.information_id)::text
   where legacy.save_batch_id is not null
     and converted.body_json is not null
     and current.textbox_id is null
  union all
  select 'node legacy HTML manual saves needing conversion', count(*)
    from node_information legacy
   where legacy.save_batch_id is not null
     and mangorts_legacy_saved_editor_body(legacy.information) is null
  union all
  select 'logic gate legacy HTML manual saves needing conversion', count(*)
    from logic_gate_information legacy
   where legacy.save_batch_id is not null
     and mangorts_legacy_saved_editor_body(legacy.information) is null
  union all
  select 'project manual save blocks not copied or invalid', count(*)
    from project_information legacy
   cross join lateral jsonb_array_elements(
     mangorts_legacy_project_saved_blocks(legacy.information)
   ) block
    left join project_textboxes_history current
      on current.company_id=legacy.company_id
     and current.project_id=legacy.project_id
     and current.batch_id=legacy.information_id
     and current.textbox_id=block->>'id'
   where legacy.type::text='Saved version'
     and starts_with(legacy.information,'MANGO_PROJECT_SAVE_V1:')
     and (
       mangorts_legacy_saved_editor_body(block->>'document') is null
       or current.textbox_id is null
     )
  union all
  select 'project manual saves with invalid or empty blocks', count(*)
    from project_information legacy
   where legacy.type::text='Saved version'
     and starts_with(legacy.information,'MANGO_PROJECT_SAVE_V1:')
     and jsonb_array_length(mangorts_legacy_project_saved_blocks(legacy.information))=0
  union all
  select 'project manual save rows with an unreadable prefix', count(*)
    from project_information legacy
   where legacy.type::text='Saved version'
     and not starts_with(legacy.information,'MANGO_PROJECT_SAVE_V1:')
)
select case when problem_count=0 then 'ok' else 'blocker' end as status,
       check_name,
       problem_count
  from checks
 order by status desc,check_name;

select 'legacy automatic operation/version rows (removed only by cleanup)' as information,
       (select count(*) from editor_json_operations)
       + (select count(*) from editor_json_versions)
       + (select count(*) from project_editor_document_operations)
       + (select count(*) from project_editor_document_versions)
       + (select count(*) from logic_gate_editor_document_operations)
       + (select count(*) from logic_gate_editor_document_versions) as row_count;
