-- NODE_V2_PHASE1_FOUNDATION_BEGIN
-- Additive, inactive storage for Node v2. This migration does not backfill
-- legacy HTML, change a workspace editor gate, or redirect any live reader.
begin;

create table if not exists node_textboxes (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  source_information_id uuid,
  document_schema_version integer not null default 1,
  document_json jsonb not null,
  plain_text text not null default '',
  content_revision bigint not null default 0,
  collaboration_epoch uuid not null,
  latest_update_sequence bigint not null default 0,
  materialized_through_sequence bigint not null default 0,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  constraint node_textboxes_document_schema_chk check (document_schema_version = 1),
  constraint node_textboxes_document_contract_chk check (
    jsonb_typeof(document_json) = 'object'
    and document_json->>'format' = 'mango-tiptap-json'
    and document_json->>'schema_version' = '1'
    and jsonb_typeof(document_json->'document') = 'object'
    and document_json->'document'->>'type' = 'doc'
  ),
  constraint node_textboxes_revision_chk check (
    content_revision >= 0
    and latest_update_sequence >= 0
    and materialized_through_sequence >= 0
    and materialized_through_sequence <= latest_update_sequence
  ),
  constraint node_textboxes_source_identity_chk check (
    source_information_id is null or source_information_id = textbox_id
  ),
  constraint node_textboxes_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  ),
  primary key (company_id, node_id, textbox_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (updated_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_node_textboxes_source_information
  on node_textboxes(company_id, source_information_id)
  where source_information_id is not null;

create index if not exists idx_node_textboxes_node_created
  on node_textboxes(company_id, node_id, created_timestamp desc, textbox_id desc)
  where deleted_timestamp is null;

create index if not exists idx_node_textboxes_node_deleted
  on node_textboxes(company_id, node_id, deleted_timestamp, textbox_id)
  where deleted_timestamp is not null;

create table if not exists node_textbox_yjs_updates (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  update_sequence bigint generated always as identity,
  update_id uuid not null,
  update_sha256 text not null,
  collaboration_epoch uuid not null,
  client_id text not null,
  actor_user_id uuid,
  update_payload bytea not null,
  received_timestamp timestamptz not null default now(),
  checkpointed_timestamp timestamptz,
  retain_until timestamptz,
  constraint node_textbox_yjs_updates_client_chk check (
    btrim(client_id) <> '' and octet_length(client_id) <= 160
  ),
  constraint node_textbox_yjs_updates_checksum_chk check (update_sha256 ~ '^[0-9a-f]{64}$'),
  constraint node_textbox_yjs_updates_payload_chk check (octet_length(update_payload) > 0),
  constraint node_textbox_yjs_updates_retention_chk check (
    (checkpointed_timestamp is null and retain_until is null)
    or (checkpointed_timestamp is not null and retain_until is not null and retain_until >= checkpointed_timestamp)
  ),
  primary key (company_id, node_id, textbox_id, update_sequence),
  unique (company_id, node_id, textbox_id, update_id),
  unique (company_id, node_id, textbox_id, collaboration_epoch, update_sha256),
  foreign key (company_id, node_id, textbox_id)
    references node_textboxes(company_id, node_id, textbox_id) on delete cascade,
  foreign key (actor_user_id) references users(user_id) on delete set null
);

create index if not exists idx_node_textbox_yjs_updates_replay
  on node_textbox_yjs_updates(company_id, node_id, textbox_id, collaboration_epoch, update_sequence);

create index if not exists idx_node_textbox_yjs_updates_cleanup
  on node_textbox_yjs_updates(retain_until, update_sequence)
  where checkpointed_timestamp is not null;

create table if not exists node_textbox_yjs_checkpoints (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  checkpoint_id uuid not null,
  collaboration_epoch uuid not null,
  through_update_sequence bigint not null,
  checkpoint_payload bytea not null,
  state_vector bytea not null,
  document_schema_version integer not null default 1,
  document_json jsonb not null,
  plain_text text not null default '',
  checkpoint_reason text not null,
  created_timestamp timestamptz not null default now(),
  retain_until timestamptz not null,
  constraint node_textbox_yjs_checkpoints_sequence_chk check (through_update_sequence >= 0),
  constraint node_textbox_yjs_checkpoints_payload_chk check (
    octet_length(checkpoint_payload) > 0 and octet_length(state_vector) > 0
  ),
  constraint node_textbox_yjs_checkpoints_schema_chk check (document_schema_version = 1),
  constraint node_textbox_yjs_checkpoints_document_chk check (
    jsonb_typeof(document_json) = 'object'
    and document_json->>'format' = 'mango-tiptap-json'
    and document_json->>'schema_version' = '1'
    and jsonb_typeof(document_json->'document') = 'object'
    and document_json->'document'->>'type' = 'doc'
  ),
  constraint node_textbox_yjs_checkpoints_reason_chk check (
    checkpoint_reason in ('migration_seed', 'operation_count', 'update_bytes', 'idle', 'manual_recovery')
  ),
  constraint node_textbox_yjs_checkpoints_retention_chk check (retain_until > created_timestamp),
  primary key (company_id, node_id, textbox_id, checkpoint_id),
  unique (company_id, node_id, textbox_id, collaboration_epoch, through_update_sequence),
  foreign key (company_id, node_id, textbox_id)
    references node_textboxes(company_id, node_id, textbox_id) on delete cascade
);

create index if not exists idx_node_textbox_yjs_checkpoints_latest
  on node_textbox_yjs_checkpoints(
    company_id, node_id, textbox_id, collaboration_epoch, through_update_sequence desc, checkpoint_id desc
  );

create index if not exists idx_node_textbox_yjs_checkpoints_cleanup
  on node_textbox_yjs_checkpoints(retain_until, checkpoint_id);

create table if not exists node_textbox_comment_threads (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  thread_id uuid not null,
  source_root_information_id uuid,
  selected_quote text not null default '',
  anchor_before_text text not null default '',
  anchor_after_text text not null default '',
  anchor_format text not null default 'none',
  anchor_status text not null default 'unanchored',
  anchor_start bytea,
  anchor_end bytea,
  legacy_start_offset integer,
  legacy_end_offset integer,
  created_by_user_id uuid,
  created_by_display_name text not null,
  created_timestamp timestamptz not null default now(),
  resolved_by_user_id uuid,
  resolved_timestamp timestamptz,
  constraint node_textbox_comment_threads_creator_name_chk check (btrim(created_by_display_name) <> ''),
  constraint node_textbox_comment_threads_anchor_format_chk check (
    anchor_format in ('none', 'legacy_offsets_v1', 'yjs_relative_v1')
  ),
  constraint node_textbox_comment_threads_anchor_status_chk check (
    anchor_status in ('anchored', 'uniquely_recovered', 'ambiguous', 'unanchored', 'deleted_range')
  ),
  constraint node_textbox_comment_threads_anchor_payload_chk check (
    (anchor_format = 'yjs_relative_v1' and anchor_start is not null and anchor_end is not null)
    or (anchor_format = 'legacy_offsets_v1' and legacy_start_offset is not null and legacy_end_offset is not null
      and legacy_start_offset >= 0 and legacy_end_offset >= legacy_start_offset)
    or (anchor_format = 'none' and anchor_start is null and anchor_end is null
      and legacy_start_offset is null and legacy_end_offset is null)
  ),
  constraint node_textbox_comment_threads_resolution_chk check (
    (resolved_timestamp is null and resolved_by_user_id is null)
    or resolved_timestamp is not null
  ),
  primary key (company_id, node_id, textbox_id, thread_id),
  foreign key (company_id, node_id, textbox_id)
    references node_textboxes(company_id, node_id, textbox_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (resolved_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_node_textbox_comment_threads_source
  on node_textbox_comment_threads(company_id, source_root_information_id)
  where source_root_information_id is not null;

create index if not exists idx_node_textbox_comment_threads_textbox
  on node_textbox_comment_threads(company_id, node_id, textbox_id, created_timestamp desc, thread_id desc);

create table if not exists node_textbox_comments (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  thread_id uuid not null,
  comment_id uuid not null,
  parent_comment_id uuid,
  source_information_id uuid,
  author_user_id uuid,
  author_display_name text not null,
  body_text text not null,
  created_timestamp timestamptz not null default now(),
  edited_timestamp timestamptz,
  deleted_timestamp timestamptz,
  constraint node_textbox_comments_author_name_chk check (btrim(author_display_name) <> ''),
  constraint node_textbox_comments_body_chk check (
    deleted_timestamp is not null or btrim(body_text) <> ''
  ),
  constraint node_textbox_comments_timestamps_chk check (
    (edited_timestamp is null or edited_timestamp >= created_timestamp)
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  ),
  constraint node_textbox_comments_parent_not_self_chk check (parent_comment_id is null or parent_comment_id <> comment_id),
  primary key (company_id, node_id, textbox_id, thread_id, comment_id),
  foreign key (company_id, node_id, textbox_id, thread_id)
    references node_textbox_comment_threads(company_id, node_id, textbox_id, thread_id) on delete cascade,
  foreign key (company_id, node_id, textbox_id, thread_id, parent_comment_id)
    references node_textbox_comments(company_id, node_id, textbox_id, thread_id, comment_id),
  foreign key (author_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_node_textbox_comments_source
  on node_textbox_comments(company_id, source_information_id)
  where source_information_id is not null;

create index if not exists idx_node_textbox_comments_thread_cursor
  on node_textbox_comments(
    company_id, node_id, textbox_id, thread_id, created_timestamp desc, comment_id desc
  );

create table if not exists node_textbox_comment_mentions (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  thread_id uuid not null,
  comment_id uuid not null,
  principal_type text not null,
  principal_id uuid not null,
  principal_display_name text not null,
  created_timestamp timestamptz not null default now(),
  constraint node_textbox_comment_mentions_type_chk check (principal_type in ('user', 'group')),
  constraint node_textbox_comment_mentions_name_chk check (btrim(principal_display_name) <> ''),
  primary key (company_id, node_id, textbox_id, thread_id, comment_id, principal_type, principal_id),
  foreign key (company_id, node_id, textbox_id, thread_id, comment_id)
    references node_textbox_comments(company_id, node_id, textbox_id, thread_id, comment_id) on delete cascade
);

create table if not exists node_textbox_attachment_links (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  attachment_link_id uuid not null,
  attachment_id uuid not null,
  relationship_kind text not null,
  source_resource_attachment_id uuid,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  constraint node_textbox_attachment_links_kind_chk check (
    relationship_kind in ('file_attachment', 'inline_image')
  ),
  constraint node_textbox_attachment_links_timestamps_chk check (
    deleted_timestamp is null or deleted_timestamp >= created_timestamp
  ),
  primary key (company_id, node_id, textbox_id, attachment_link_id),
  foreign key (company_id, node_id, textbox_id)
    references node_textboxes(company_id, node_id, textbox_id) on delete cascade,
  foreign key (company_id, attachment_id)
    references attachments(company_id, attachment_id) on delete restrict,
  foreign key (source_resource_attachment_id)
    references resource_attachments(resource_attachment_id) on delete set null,
  foreign key (created_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_node_textbox_attachment_links_active
  on node_textbox_attachment_links(
    company_id, node_id, textbox_id, attachment_id, relationship_kind
  ) where deleted_timestamp is null;

create unique index if not exists idx_node_textbox_attachment_links_source
  on node_textbox_attachment_links(company_id, source_resource_attachment_id)
  where source_resource_attachment_id is not null;

create index if not exists idx_node_textbox_attachment_links_node_aggregate
  on node_textbox_attachment_links(
    company_id, node_id, deleted_timestamp, created_timestamp desc, attachment_link_id desc
  );

create table if not exists node_textbox_comment_attachment_links (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  thread_id uuid not null,
  comment_id uuid not null,
  attachment_link_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, node_id, textbox_id, thread_id, comment_id, attachment_link_id),
  foreign key (company_id, node_id, textbox_id, thread_id, comment_id)
    references node_textbox_comments(company_id, node_id, textbox_id, thread_id, comment_id) on delete cascade,
  foreign key (company_id, node_id, textbox_id, attachment_link_id)
    references node_textbox_attachment_links(company_id, node_id, textbox_id, attachment_link_id) on delete restrict
);

create unique index if not exists idx_communications_email_messages_thread_message
  on communications_email_messages(company_id, email_thread_id, email_message_id);

create table if not exists node_textbox_email_links (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  email_link_id uuid not null,
  email_thread_id uuid not null,
  email_message_id uuid,
  linked_by_user_id uuid,
  linked_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  constraint node_textbox_email_links_timestamps_chk check (
    deleted_timestamp is null or deleted_timestamp >= linked_timestamp
  ),
  primary key (company_id, node_id, textbox_id, email_link_id),
  foreign key (company_id, node_id, textbox_id)
    references node_textboxes(company_id, node_id, textbox_id) on delete cascade,
  foreign key (company_id, node_id, email_thread_id)
    references communications_node_email_threads(company_id, node_id, email_thread_id) on delete restrict,
  foreign key (company_id, email_thread_id, email_message_id)
    references communications_email_messages(company_id, email_thread_id, email_message_id) on delete restrict,
  foreign key (linked_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_node_textbox_email_links_active_thread
  on node_textbox_email_links(company_id, node_id, textbox_id, email_thread_id)
  where email_message_id is null and deleted_timestamp is null;

create unique index if not exists idx_node_textbox_email_links_active_message
  on node_textbox_email_links(company_id, node_id, textbox_id, email_thread_id, email_message_id)
  where email_message_id is not null and deleted_timestamp is null;

create index if not exists idx_node_textbox_email_links_node_aggregate
  on node_textbox_email_links(company_id, node_id, deleted_timestamp, linked_timestamp desc, email_link_id desc);

create table if not exists node_movements (
  company_id uuid not null,
  node_id uuid not null,
  movement_id uuid not null,
  source_timeline_event_id uuid,
  from_logic_gate_id uuid,
  from_logic_gate_name text not null,
  from_status_id uuid,
  from_status_name text not null default '',
  to_logic_gate_id uuid not null,
  to_logic_gate_name text not null,
  to_status_id uuid,
  to_status_name text not null default '',
  actor_user_id uuid,
  actor_display_name text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint node_movements_gate_names_chk check (
    btrim(from_logic_gate_name) <> '' and btrim(to_logic_gate_name) <> ''
  ),
  constraint node_movements_actor_name_chk check (btrim(actor_display_name) <> ''),
  constraint node_movements_idempotency_chk check (
    btrim(idempotency_key) <> '' and octet_length(idempotency_key) <= 160
  ),
  constraint node_movements_different_gate_chk check (
    from_logic_gate_id is null or from_logic_gate_id <> to_logic_gate_id
  ),
  primary key (company_id, node_id, movement_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade
);

create unique index if not exists idx_node_movements_idempotency
  on node_movements(company_id, node_id, idempotency_key);

create unique index if not exists idx_node_movements_source_timeline
  on node_movements(company_id, source_timeline_event_id)
  where source_timeline_event_id is not null;

create index if not exists idx_node_movements_node_cursor
  on node_movements(company_id, node_id, occurred_at desc, movement_id desc);

create table if not exists node_verification_requests (
  company_id uuid not null,
  node_id uuid not null,
  verification_request_id uuid not null,
  verification_scope text not null,
  textbox_id uuid,
  requested_by_user_id uuid,
  requested_by_display_name text not null,
  content_manifest jsonb not null,
  content_manifest_sha256 text not null,
  current_status text not null default 'requested',
  idempotency_key text not null,
  requested_timestamp timestamptz not null default now(),
  closed_timestamp timestamptz,
  constraint node_verification_requests_scope_chk check (
    (verification_scope = 'node' and textbox_id is null)
    or (verification_scope = 'textbox' and textbox_id is not null)
  ),
  constraint node_verification_requests_requester_name_chk check (btrim(requested_by_display_name) <> ''),
  constraint node_verification_requests_manifest_chk check (
    jsonb_typeof(content_manifest) = 'array'
    and content_manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint node_verification_requests_status_chk check (
    current_status in ('requested', 'approved', 'rejected', 'cancelled', 'revoked')
  ),
  constraint node_verification_requests_idempotency_chk check (
    btrim(idempotency_key) <> '' and octet_length(idempotency_key) <= 160
  ),
  constraint node_verification_requests_closed_chk check (
    (current_status = 'requested' and closed_timestamp is null)
    or (current_status <> 'requested' and closed_timestamp is not null)
  ),
  primary key (company_id, node_id, verification_request_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, node_id, textbox_id)
    references node_textboxes(company_id, node_id, textbox_id) on delete restrict
);

create unique index if not exists idx_node_verification_requests_idempotency
  on node_verification_requests(company_id, node_id, idempotency_key);

create index if not exists idx_node_verification_requests_node_cursor
  on node_verification_requests(company_id, node_id, requested_timestamp desc, verification_request_id desc);

create table if not exists node_verification_recipients (
  company_id uuid not null,
  node_id uuid not null,
  verification_request_id uuid not null,
  user_id uuid not null,
  user_display_name text not null,
  assigned_timestamp timestamptz not null default now(),
  constraint node_verification_recipients_name_chk check (btrim(user_display_name) <> ''),
  primary key (company_id, node_id, verification_request_id, user_id),
  foreign key (company_id, node_id, verification_request_id)
    references node_verification_requests(company_id, node_id, verification_request_id) on delete cascade
);

create index if not exists idx_node_verification_recipients_user
  on node_verification_recipients(company_id, user_id, assigned_timestamp desc, verification_request_id desc);

create table if not exists node_verification_events (
  company_id uuid not null,
  node_id uuid not null,
  verification_request_id uuid not null,
  verification_event_id uuid not null,
  event_type text not null,
  recipient_user_id uuid,
  actor_user_id uuid,
  actor_display_name text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint node_verification_events_type_chk check (
    event_type in ('requested', 'approved', 'rejected', 'cancelled', 'revoked')
  ),
  constraint node_verification_events_recipient_chk check (
    (event_type in ('approved', 'rejected') and recipient_user_id is not null)
    or (event_type not in ('approved', 'rejected') and recipient_user_id is null)
  ),
  constraint node_verification_events_actor_name_chk check (btrim(actor_display_name) <> ''),
  constraint node_verification_events_idempotency_chk check (
    btrim(idempotency_key) <> '' and octet_length(idempotency_key) <= 160
  ),
  primary key (company_id, node_id, verification_event_id),
  foreign key (company_id, node_id, verification_request_id)
    references node_verification_requests(company_id, node_id, verification_request_id) on delete cascade,
  foreign key (company_id, node_id, verification_request_id, recipient_user_id)
    references node_verification_recipients(company_id, node_id, verification_request_id, user_id) on delete restrict
);

create unique index if not exists idx_node_verification_events_idempotency
  on node_verification_events(company_id, node_id, verification_request_id, idempotency_key);

create index if not exists idx_node_verification_events_request_cursor
  on node_verification_events(
    company_id, node_id, verification_request_id, occurred_at desc, verification_event_id desc
  );

create table if not exists node_timeline_items (
  company_id uuid not null,
  node_id uuid not null,
  timeline_item_id uuid not null,
  timeline_sequence bigint generated always as identity,
  item_type text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_user_id uuid,
  textbox_id uuid,
  movement_id uuid,
  verification_event_id uuid,
  summary_json jsonb not null default '{}'::jsonb,
  constraint node_timeline_items_type_chk check (
    item_type in ('textbox_created', 'node_moved', 'verification_stamp')
  ),
  constraint node_timeline_items_pointer_chk check (
    (item_type = 'textbox_created' and textbox_id is not null and movement_id is null and verification_event_id is null)
    or (item_type = 'node_moved' and textbox_id is null and movement_id is not null and verification_event_id is null)
    or (item_type = 'verification_stamp' and textbox_id is null and movement_id is null and verification_event_id is not null)
  ),
  constraint node_timeline_items_summary_chk check (
    jsonb_typeof(summary_json) = 'object' and pg_column_size(summary_json) <= 16384
  ),
  primary key (company_id, node_id, timeline_item_id),
  unique (company_id, node_id, timeline_sequence),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, node_id, textbox_id)
    references node_textboxes(company_id, node_id, textbox_id) on delete restrict,
  foreign key (company_id, node_id, movement_id)
    references node_movements(company_id, node_id, movement_id) on delete restrict,
  foreign key (company_id, node_id, verification_event_id)
    references node_verification_events(company_id, node_id, verification_event_id) on delete restrict
);

create unique index if not exists idx_node_timeline_items_textbox
  on node_timeline_items(company_id, node_id, textbox_id)
  where item_type = 'textbox_created';

create unique index if not exists idx_node_timeline_items_movement
  on node_timeline_items(company_id, node_id, movement_id)
  where item_type = 'node_moved';

create unique index if not exists idx_node_timeline_items_verification
  on node_timeline_items(company_id, node_id, verification_event_id)
  where item_type = 'verification_stamp';

create index if not exists idx_node_timeline_items_node_cursor
  on node_timeline_items(company_id, node_id, occurred_at desc, timeline_sequence desc);

create table if not exists editor_migration_runs (
  company_id uuid not null,
  migration_run_id uuid not null,
  mode text not null,
  converter_version text not null,
  status text not null default 'planned',
  backup_reference text not null default '',
  backup_verified_timestamp timestamptz,
  created_by_user_id uuid,
  started_timestamp timestamptz,
  completed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  constraint editor_migration_runs_mode_chk check (
    mode in ('dry_run', 'backfill', 'shadow_compare', 'rollback_export')
  ),
  constraint editor_migration_runs_converter_chk check (
    btrim(converter_version) <> '' and octet_length(converter_version) <= 160
  ),
  constraint editor_migration_runs_status_chk check (
    status in ('planned', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  constraint editor_migration_runs_backup_chk check (
    mode <> 'backfill'
    or status = 'planned'
    or (btrim(backup_reference) <> '' and backup_verified_timestamp is not null)
  ),
  constraint editor_migration_runs_timestamps_chk check (
    (status = 'planned' and started_timestamp is null and completed_timestamp is null)
    or (status = 'running' and started_timestamp is not null and completed_timestamp is null)
    or (status in ('succeeded', 'failed', 'cancelled') and started_timestamp is not null
      and completed_timestamp is not null and completed_timestamp >= started_timestamp)
  ),
  primary key (company_id, migration_run_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_editor_migration_runs_company
  on editor_migration_runs(company_id, created_timestamp desc, migration_run_id desc);

create table if not exists editor_document_migrations (
  company_id uuid not null,
  migration_run_id uuid not null,
  source_owner_type text not null,
  source_owner_id uuid not null,
  source_document_id uuid not null,
  source_checksum_sha256 text not null,
  source_bytes bigint not null,
  target_document_id uuid,
  target_checksum_sha256 text,
  target_bytes bigint,
  converter_version text not null,
  status text not null default 'pending',
  warning_or_error text not null default '',
  validation_report jsonb not null default '{}'::jsonb,
  plain_text_matches boolean,
  structure_matches boolean,
  attachment_references_match boolean,
  converted_timestamp timestamptz,
  validated_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint editor_document_migrations_owner_chk check (
    source_owner_type in ('node_textbox', 'project_textbox', 'logic_gate')
  ),
  constraint editor_document_migrations_source_checksum_chk check (
    source_checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint editor_document_migrations_target_checksum_chk check (
    target_checksum_sha256 is null or target_checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint editor_document_migrations_bytes_chk check (
    source_bytes >= 0 and (target_bytes is null or target_bytes >= 0)
  ),
  constraint editor_document_migrations_converter_chk check (
    btrim(converter_version) <> '' and octet_length(converter_version) <= 160
  ),
  constraint editor_document_migrations_status_chk check (
    status in ('pending', 'converted', 'validated', 'warning', 'failed', 'rolled_back')
  ),
  constraint editor_document_migrations_report_chk check (
    jsonb_typeof(validation_report) = 'object' and pg_column_size(validation_report) <= 65536
  ),
  constraint editor_document_migrations_result_chk check (
    status in ('pending', 'failed')
    or (target_document_id is not null and target_checksum_sha256 is not null and target_bytes is not null
      and converted_timestamp is not null)
  ),
  primary key (company_id, migration_run_id, source_owner_type, source_owner_id, source_document_id),
  foreign key (company_id, migration_run_id)
    references editor_migration_runs(company_id, migration_run_id) on delete cascade
);

create unique index if not exists idx_editor_document_migrations_target
  on editor_document_migrations(company_id, migration_run_id, source_owner_type, target_document_id)
  where target_document_id is not null;

create index if not exists idx_editor_document_migrations_status
  on editor_document_migrations(company_id, migration_run_id, status, source_owner_type, source_document_id);

comment on table node_textboxes is
  'Inactive Node v2 owner-specific materialized Tiptap documents. Ordinary typing persists Yjs updates, not full JSON snapshots.';
comment on table node_textbox_yjs_updates is
  'Operational Yjs update tail. Delete only after a durable checkpoint covers the update and its recovery retention has elapsed.';
comment on table node_textbox_yjs_checkpoints is
  'Operational Yjs recovery checkpoints. Retain at least the latest two valid checkpoints and honor retain_until.';
comment on table node_timeline_items is
  'Rebuildable ordered Node timeline index containing exactly textbox creation, Node movement, and verification stamps.';
comment on table editor_migration_runs is
  'Transitional conversion runs. A real backfill cannot start without recorded verified backup evidence.';
comment on table editor_document_migrations is
  'Idempotent additive HTML-to-Tiptap conversion and shadow-validation ledger. Source HTML remains untouched.';

commit;
-- NODE_V2_PHASE1_FOUNDATION_END
