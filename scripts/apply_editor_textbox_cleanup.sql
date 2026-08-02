\set ON_ERROR_STOP on

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
      from node_information legacy
      left join node_textboxes_history history
        on history.company_id=legacy.company_id
       and history.node_id=legacy.node_id
       and history.batch_id=legacy.save_batch_id
       and history.textbox_id=coalesce(legacy.source_information_id,legacy.information_id)
     where legacy.save_batch_id is not null
       and (
         mangorts_legacy_saved_editor_body(legacy.information) is null
         or history.textbox_id is null
       )
  ) then
    raise exception 'editor_textbox_cleanup_blocked_node_history_mismatch';
  end if;

  if exists (
    select 1
      from logic_gate_information legacy
      left join logic_gate_textboxes_history history
        on history.company_id=legacy.company_id
       and history.logic_gate_id=legacy.logic_gate_id
       and history.batch_id=legacy.save_batch_id
       and history.textbox_id=coalesce(legacy.source_information_id,legacy.information_id)::text
     where legacy.save_batch_id is not null
       and (
         mangorts_legacy_saved_editor_body(legacy.information) is null
         or history.textbox_id is null
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
     ) block
      left join project_textboxes_history history
        on history.company_id=legacy.company_id
       and history.project_id=legacy.project_id
       and history.batch_id=legacy.information_id
       and history.textbox_id=block->>'id'
     where legacy.type::text='Saved version'
       and starts_with(legacy.information,'MANGO_PROJECT_SAVE_V1:')
       and (
         mangorts_legacy_saved_editor_body(block->>'document') is null
         or history.textbox_id is null
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
