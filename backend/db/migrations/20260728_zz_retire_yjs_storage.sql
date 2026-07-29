-- Retire the abandoned Yjs/Hocuspocus persistence model.
--
-- Keep the earlier Yjs migrations in the append-only migration history. This
-- forward cleanup is what removes their objects from databases that already
-- applied them, and it is intentionally safe when some objects never existed.

drop trigger if exists trg_project_editor_document_yjs_cleanup on project_editor_documents;
drop trigger if exists trg_project_editor_document_yjs_epoch_cleanup on project_editor_documents;
drop trigger if exists trg_logic_gate_editor_document_yjs_cleanup on logic_gate_editor_documents;
drop trigger if exists trg_logic_gate_editor_document_yjs_epoch_cleanup on logic_gate_editor_documents;

drop function if exists delete_project_editor_yjs_history();
drop function if exists delete_logic_gate_editor_yjs_history();

drop table if exists editor_owner_yjs_updates;
drop table if exists editor_owner_yjs_checkpoints;

alter table if exists project_editor_documents
  drop constraint if exists project_editor_documents_yjs_sequences_chk,
  drop column if exists collaboration_epoch,
  drop column if exists latest_update_sequence,
  drop column if exists materialized_through_sequence;

alter table if exists logic_gate_editor_documents
  drop constraint if exists logic_gate_editor_documents_yjs_sequences_chk,
  drop column if exists collaboration_epoch,
  drop column if exists latest_update_sequence,
  drop column if exists materialized_through_sequence;

drop table if exists node_verification_update_pins;
drop table if exists node_verification_content_pins;
drop function if exists mangorts_cleanup_node_v2_yjs_retention(integer);
drop table if exists node_textbox_yjs_updates;
drop table if exists node_textbox_yjs_checkpoints;

alter table if exists node_textbox_comment_threads
  drop constraint if exists node_textbox_comment_threads_anchor_format_chk,
  drop constraint if exists node_textbox_comment_threads_anchor_payload_chk;

do $retire_yjs$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='node_textbox_comment_threads'
      and column_name='anchor_start'
  ) then
    update node_textbox_comment_threads
    set anchor_format='none',
        anchor_status='unanchored',
        anchor_start=null,
        anchor_end=null,
        legacy_start_offset=null,
        legacy_end_offset=null
    where anchor_format='yjs_relative_v1';
  end if;
end;
$retire_yjs$;

alter table if exists node_textbox_comment_threads
  drop column if exists anchor_start,
  drop column if exists anchor_end;

alter table if exists node_textbox_comment_threads
  add constraint node_textbox_comment_threads_anchor_format_chk check (
    anchor_format in ('none', 'legacy_offsets_v1')
  ),
  add constraint node_textbox_comment_threads_anchor_payload_chk check (
    (anchor_format = 'legacy_offsets_v1' and legacy_start_offset is not null and legacy_end_offset is not null
      and legacy_start_offset >= 0 and legacy_end_offset >= legacy_start_offset)
    or (anchor_format = 'none' and legacy_start_offset is null and legacy_end_offset is null)
  );

alter table if exists node_textboxes
  drop constraint if exists node_textboxes_revision_chk,
  drop column if exists collaboration_epoch,
  drop column if exists latest_update_sequence,
  drop column if exists materialized_through_sequence;

alter table if exists node_textboxes
  add constraint node_textboxes_revision_chk check (content_revision >= 0);

comment on table node_textboxes is
  'Inactive Node v2 owner-specific materialized Tiptap documents. Current editors persist revisioned Tiptap JSON snapshots.';
