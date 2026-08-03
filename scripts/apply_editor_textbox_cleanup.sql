-- Destructive phase of the editor textbox cutover.
-- Run only after the new backend is deployed and
-- scripts/verify_editor_textbox_cutover.sql reports no blockers.

begin;

select pg_advisory_xact_lock(hashtextextended('mangorts-editor-textbox-cleanup',0));

do $$
begin
  if exists (
    select 1
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
  ) then
    raise exception 'editor_textbox_cleanup_blocked_recyclable_node_document';
  end if;

  if exists (
    select 1
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
  ) then
    raise exception 'editor_textbox_cleanup_blocked_recycle_current_rows';
  end if;

  if exists (
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
  ) then
    raise exception 'editor_textbox_cleanup_blocked_recycle_history_rows';
  end if;
  if exists (
    select 1
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
         or current.revision<legacy.revision
         or (current.revision=legacy.revision and (
           current.body_json-'annotations' is distinct from legacy.canonical_document
           or current.body_json->'annotations' is distinct from legacy.canonical_annotations
           or (current.deleted_timestamp is not null)<>legacy.is_deleted
         ))
       )
  ) then
    raise exception 'editor_textbox_cleanup_blocked_node_current_mismatch';
  end if;

  if exists (
    select 1
      from project_editor_documents legacy
      left join project_textboxes current
        on current.company_id=legacy.company_id
       and current.project_id=legacy.project_id
       and current.textbox_id=legacy.document_id
     where current.textbox_id is null
        or current.revision<legacy.revision
        or (current.revision=legacy.revision and (
          current.body_json-'annotations' is distinct from legacy.document_json
          or current.body_json->'annotations' is distinct from legacy.canonical_annotations
          or (current.deleted_timestamp is not null)<>legacy.is_deleted
        ))
  ) then
    raise exception 'editor_textbox_cleanup_blocked_project_current_mismatch';
  end if;

  if exists (
    select 1
      from logic_gate_editor_documents legacy
      left join logic_gate_textboxes current
        on current.company_id=legacy.company_id
       and current.logic_gate_id=legacy.logic_gate_id
       and current.textbox_id=legacy.document_id
     where current.textbox_id is null
        or current.revision<legacy.revision
        or (current.revision=legacy.revision and (
          current.body_json-'annotations' is distinct from legacy.document_json
          or current.body_json->'annotations' is distinct from legacy.canonical_annotations
          or (current.deleted_timestamp is not null)<>legacy.is_deleted
        ))
  ) then
    raise exception 'editor_textbox_cleanup_blocked_logic_gate_current_mismatch';
  end if;

  if exists (
    select 1
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
      left join node_textboxes_history history
        on history.company_id=legacy.company_id
       and history.node_id=legacy.node_id
       and history.batch_id=legacy.save_batch_id
       and history.textbox_id=coalesce(legacy.source_information_id,legacy.information_id)
     where history.textbox_id is null
        or history.display_order is distinct from legacy.expected_display_order
        or coalesce(history.saved_by_user_id::text,'') is distinct from coalesce(legacy.saved_by_user_id::text,'')
        or history.saved_timestamp is distinct from legacy.updated_timestamp
        or (converted.body_json is not null and history.body_json is distinct from converted.body_json)
  ) then
    raise exception 'editor_textbox_cleanup_blocked_node_history_mismatch';
  end if;

  if exists (
    select 1
      from logic_gate_information legacy
      cross join lateral (
        select mangorts_legacy_saved_editor_body(legacy.information) body_json
      ) converted
      left join logic_gate_textboxes_history history
        on history.company_id=legacy.company_id
       and history.logic_gate_id=legacy.logic_gate_id
       and history.batch_id=legacy.save_batch_id
       and history.textbox_id=coalesce(legacy.source_information_id,legacy.information_id)::text
     where legacy.save_batch_id is not null
       and legacy.save_kind <> 'auto'
       and (
         history.textbox_id is null
         or coalesce(history.saved_by_user_id::text,'') is distinct from coalesce(legacy.saved_by_user_id::text,'')
         or history.saved_timestamp is distinct from legacy.updated_timestamp
         or (converted.body_json is not null and history.body_json is distinct from converted.body_json)
       )
  ) then
    raise exception 'editor_textbox_cleanup_blocked_logic_gate_history_mismatch';
  end if;

  if exists (
    select 1
      from project_information legacy
     where legacy.type::text='Saved version'
       and not starts_with(legacy.information,'MANGO_PROJECT_SAVE_V1:')
  ) then
    raise exception 'editor_textbox_cleanup_blocked_project_history_unreadable';
  end if;

  if exists (
    select 1
      from project_information legacy
     where legacy.type::text='Saved version'
       and starts_with(legacy.information,'MANGO_PROJECT_SAVE_V1:')
       and jsonb_array_length(mangorts_legacy_project_saved_blocks(legacy.information))=0
  ) then
    raise exception 'editor_textbox_cleanup_blocked_project_history_invalid';
  end if;

  if exists (
    select 1
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
      left join project_textboxes_history history
        on history.company_id=legacy.company_id
       and history.project_id=legacy.project_id
       and history.batch_id=legacy.information_id
       and history.textbox_id=block.value->>'id'
     where legacy.type::text='Saved version'
       and starts_with(legacy.information,'MANGO_PROJECT_SAVE_V1:')
       and (
         history.textbox_id is null
         or history.display_order is distinct from block.ordinality - 1
         or history.saved_timestamp is distinct from legacy.updated_timestamp
         or history.body_json->'history_metadata' is distinct from converted.history_metadata
         or (converted.body_json is not null and history.body_json-'history_metadata' is distinct from converted.body_json)
       )
  ) then
    raise exception 'editor_textbox_cleanup_blocked_project_history_mismatch';
  end if;
end;
$$;

delete from node_information where save_batch_id is not null;
delete from logic_gate_information where save_batch_id is not null;
delete from project_information
 where type::text='Saved version'
   and starts_with(information,'MANGO_PROJECT_SAVE_V1:');

drop table project_editor_document_operations;
drop table project_editor_document_versions;
drop table logic_gate_editor_document_operations;
drop table logic_gate_editor_document_versions;
drop table editor_json_operations;
drop table editor_json_versions;

drop table project_editor_documents;
drop table logic_gate_editor_documents;
drop table editor_json_documents;

drop function if exists mangorts_enforce_generic_editor_owner_text_limit();

commit;
