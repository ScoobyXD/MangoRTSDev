begin;

-- These objects are retired, so missing objects are treated as schema drift.
-- Every drop is intentionally strict.

drop table editor_collaboration_operations;
drop table editor_collaboration_documents;
drop table editor_rollout_gates;
drop table editor_rollback_exports;
drop table editor_shadow_comparisons;
drop table editor_conversion_items;
drop table editor_conversion_runs;
drop table editor_document_migrations;
drop table editor_migration_runs;
drop table workspace_editor_formats;
drop function mangorts_validate_editor_format_cutover();
drop function mangorts_reject_legacy_editor_write_after_cutover();
drop function mangorts_prepare_company_editor_purge(uuid);

drop table node_timeline_items;
drop table node_textbox_comment_attachment_links;
drop table node_textbox_comment_mentions;
drop table node_textbox_comments;
drop table node_textbox_comment_threads;
drop table node_textbox_email_links;
drop table node_textbox_attachment_links;
drop table node_verification_events;
drop table node_verification_recipients;
drop table node_verification_requests;
drop table node_movements;

drop index idx_node_textboxes_source_information;
drop index idx_node_textboxes_creation_idempotency;

alter table node_textboxes
  drop constraint node_textboxes_document_schema_chk,
  drop constraint node_textboxes_document_contract_chk,
  drop constraint node_textboxes_revision_chk,
  drop constraint node_textboxes_source_identity_chk,
  drop constraint node_textboxes_creation_idempotency_chk,
  drop constraint node_textboxes_cutover_revision_chk,
  drop column source_information_id,
  drop column document_schema_version,
  drop column document_json,
  drop column plain_text,
  drop column content_revision,
  drop column created_by_user_id,
  drop column updated_by_user_id,
  drop column creation_idempotency_key,
  drop column source_html_sha256,
  drop column target_json_sha256,
  drop column conversion_run_id,
  add constraint node_textboxes_revision_chk check (revision >= 0);

comment on table node_textboxes is
  'Permanent current TipTap JSON document storage for Node text boxes.';
comment on column node_textboxes.display_order is
  'User-controlled Node workspace order.';

commit;
