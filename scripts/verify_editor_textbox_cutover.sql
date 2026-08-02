-- Read-only verification for the editor textbox cutover.
-- Run after 20260801_editor_textbox_storage_foundation.sql and before the
-- destructive cleanup migration. Every row with status='blocker' must be zero.

with checks as (
  select 'recyclable node current rows missing or different in recycle payload'::text as check_name,
         count(*)::bigint as problem_count
    from editor_json_documents legacy
    left join nodes parent
      on parent.company_id=legacy.company_id
     and parent.node_id=legacy.resource_id::uuid
    join lateral (
      select recycle.restore_payload
        from recycle_bin_items recycle
       where recycle.company_id=legacy.company_id
         and exists (
           select 1
             from jsonb_array_elements(coalesce(recycle.restore_payload->'nodes','[]'::jsonb)) node_row
            where node_row->>'company_id'=legacy.company_id::text
              and node_row->>'node_id'=legacy.resource_id
         )
       order by recycle.recycle_bin_item_id
       limit 1
    ) recycle on true
    left join lateral (
      select archived.value
        from jsonb_array_elements(coalesce(recycle.restore_payload->'node_textboxes','[]'::jsonb)) archived(value)
       where archived.value->>'company_id'=legacy.company_id::text
         and archived.value->>'node_id'=legacy.resource_id
         and archived.value->>'textbox_id'=legacy.document_id
       limit 1
    ) archived on true
   where legacy.resource_type='node'
     and parent.node_id is null
     and (
       archived.value is null
       or coalesce(nullif(archived.value->>'revision',''),'0')::bigint < legacy.revision
       or (archived.value->'body_json')-'annotations' is distinct from legacy.canonical_document
       or archived.value->'body_json'->'annotations' is distinct from legacy.canonical_annotations
       or ((archived.value->>'deleted_timestamp') is not null) <> legacy.is_deleted
     )
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
  select 'recycle current textbox projections not copied', count(*)
    from (
      select recycle.restore_payload,'node_textboxes'::text target_key,'node_id'::text owner_key,
             projection.value->>'company_id' company_id,projection.value->>'node_id' owner_id,
             projection.value->>'information_id' textbox_id
        from recycle_bin_items recycle
        cross join lateral jsonb_array_elements(coalesce(recycle.restore_payload->'node_projection_table','[]'::jsonb)) projection(value)
       where projection.value->>'type'='Text box'
      union all
      select recycle.restore_payload,'project_textboxes','project_id',
             projection.value->>'company_id',projection.value->>'project_id',projection.value->>'information_id'
        from recycle_bin_items recycle
        cross join lateral jsonb_array_elements(coalesce(recycle.restore_payload->'project_projection_table','[]'::jsonb)) projection(value)
       where projection.value->>'type'='Text box'
      union all
      select recycle.restore_payload,'logic_gate_textboxes','logic_gate_id',
             projection.value->>'company_id',projection.value->>'logic_gate_id',projection.value->>'information_id'
        from recycle_bin_items recycle
        cross join lateral jsonb_array_elements(coalesce(recycle.restore_payload->'logic_gate_projection_table','[]'::jsonb)) projection(value)
       where projection.value->>'type'='Text box'
    ) projection
    left join lateral (
      select target.value
        from jsonb_array_elements(coalesce(projection.restore_payload->projection.target_key,'[]'::jsonb)) target(value)
       where target.value->>'company_id'=projection.company_id
         and target.value->>projection.owner_key=projection.owner_id
         and target.value->>'textbox_id'=projection.textbox_id
       limit 1
    ) target on true
   where target.value is null
  union all
  select 'recycle legacy editor save rows not converted', count(*)
    from (
      select 1
        from recycle_bin_items recycle
        cross join lateral jsonb_array_elements(coalesce(recycle.restore_payload->'node_information','[]'::jsonb)) information(value)
       where nullif(information.value->>'save_batch_id','') is not null
      union all
      select 1
        from recycle_bin_items recycle
        cross join lateral jsonb_array_elements(coalesce(recycle.restore_payload->'logic_gate_information','[]'::jsonb)) information(value)
       where nullif(information.value->>'save_batch_id','') is not null
      union all
      select 1
        from recycle_bin_items recycle
        cross join lateral jsonb_array_elements(coalesce(recycle.restore_payload->'project_information','[]'::jsonb)) information(value)
       where information.value->>'type'='Saved version'
    ) legacy_recycle_save
  union all
  select 'node manual save rows missing or different', count(*)
    from (
      select information.*,
             row_number() over (
               partition by information.company_id,information.node_id,information.save_batch_id
               order by information.created_timestamp,information.information_id
             ) - 1 expected_display_order
        from node_information information
       where information.save_batch_id is not null
         and information.save_kind <> 'auto'
    ) legacy
    cross join lateral (
      select mangorts_legacy_saved_editor_body(legacy.information) body_json
    ) converted
    left join node_textboxes_history current
      on current.company_id=legacy.company_id
     and current.node_id=legacy.node_id
     and current.batch_id=legacy.save_batch_id
     and current.textbox_id=coalesce(legacy.source_information_id,legacy.information_id)
   where current.textbox_id is null
      or current.display_order is distinct from legacy.expected_display_order
      or coalesce(current.saved_by_user_id::text,'') is distinct from coalesce(legacy.saved_by_user_id::text,'')
      or current.saved_timestamp is distinct from legacy.updated_timestamp
      or (converted.body_json is not null and current.body_json is distinct from converted.body_json)
  union all
  select 'logic gate manual save rows missing or different', count(*)
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
     and legacy.save_kind <> 'auto'
     and (
       current.textbox_id is null
       or coalesce(current.saved_by_user_id::text,'') is distinct from coalesce(legacy.saved_by_user_id::text,'')
       or current.saved_timestamp is distinct from legacy.updated_timestamp
       or (converted.body_json is not null and current.body_json is distinct from converted.body_json)
     )
  union all
  select 'project manual save blocks missing or different', count(*)
    from project_information legacy
   cross join lateral jsonb_array_elements(
     mangorts_legacy_project_saved_blocks(legacy.information)
   ) with ordinality block(value,ordinality)
    cross join lateral (
      select mangorts_legacy_saved_editor_body(block.value->>'document') body_json,
             jsonb_build_object(
               'title',coalesce(block.value->>'title',''),
               'attachments',coalesce(block.value->'attachments','[]'::jsonb),
               'createdTimestamp',coalesce(block.value->>'createdTimestamp',''),
               'updatedTimestamp',coalesce(block.value->>'updatedTimestamp','')
             ) history_metadata
    ) converted
    left join project_textboxes_history current
      on current.company_id=legacy.company_id
     and current.project_id=legacy.project_id
     and current.batch_id=legacy.information_id
     and current.textbox_id=block.value->>'id'
   where legacy.type::text='Saved version'
     and starts_with(legacy.information,'MANGO_PROJECT_SAVE_V1:')
     and (
       current.textbox_id is null
       or current.display_order is distinct from block.ordinality - 1
       or current.saved_timestamp is distinct from legacy.updated_timestamp
       or current.body_json->'history_metadata' is distinct from converted.history_metadata
       or (converted.body_json is not null and current.body_json-'history_metadata' is distinct from converted.body_json)
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
       + (select count(*) from logic_gate_editor_document_versions) as row_count
union all
select 'legacy automatic saved snapshots (removed only by cleanup)',
       (select count(*) from node_information where save_batch_id is not null and save_kind='auto')
       + (select count(*) from logic_gate_information where save_batch_id is not null and save_kind='auto')
union all
select 'node editor documents with no live or recyclable parent (removed only by cleanup)',
       count(*)
  from editor_json_documents legacy
  left join nodes parent
    on parent.company_id=legacy.company_id
   and parent.node_id=legacy.resource_id::uuid
 where legacy.resource_type='node'
   and parent.node_id is null
   and not exists (
     select 1
       from recycle_bin_items recycle
      where recycle.company_id=legacy.company_id
        and exists (
          select 1
            from jsonb_array_elements(coalesce(recycle.restore_payload->'nodes','[]'::jsonb)) node_row
           where node_row->>'company_id'=legacy.company_id::text
             and node_row->>'node_id'=legacy.resource_id
        )
   );
