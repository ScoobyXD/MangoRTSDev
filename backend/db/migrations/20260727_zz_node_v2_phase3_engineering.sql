-- Node V2 Phase 3 collaboration, conversion, rollout, and rollback controls.
-- Additive and inactive: this migration creates no rollout rows, converts no
-- content, and does not change any workspace/company editor gate.

alter table node_textboxes
  add column if not exists source_html_sha256 text,
  add column if not exists target_json_sha256 text,
  add column if not exists conversion_run_id uuid;

create table if not exists project_editor_documents (
  company_id uuid not null,
  project_id uuid not null,
  document_id text not null,
  source_document_id text,
  document_schema_version integer not null default 1,
  revision bigint not null default 0,
  document_json jsonb not null,
  plain_text text not null default '',
  canonical_annotations jsonb not null default '[]'::jsonb,
  is_deleted boolean not null default false,
  source_html text,
  source_html_sha256 text,
  target_json_sha256 text,
  conversion_run_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, project_id, document_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  constraint project_editor_documents_source_id_chk check (source_document_id is null or btrim(source_document_id) <> ''),
  constraint project_editor_documents_schema_chk check (document_schema_version = 1),
  constraint project_editor_documents_revision_chk check (revision >= 0),
  constraint project_editor_documents_source_sha_chk check (source_html_sha256 is null or source_html_sha256 ~ '^[0-9a-f]{64}$'),
  constraint project_editor_documents_target_sha_chk check (target_json_sha256 is null or target_json_sha256 ~ '^[0-9a-f]{64}$'),
  constraint project_editor_documents_json_chk check (
    document_json->>'format'='mango-tiptap-json'
    and document_json->>'schema_version'='1'
    and document_json->'document'->>'type'='doc'
    and pg_column_size(document_json) <= 2097152
  ),
  constraint project_editor_documents_annotations_chk check (
    jsonb_typeof(canonical_annotations)='array' and jsonb_array_length(canonical_annotations) <= 10000
  )
);

create index if not exists idx_project_editor_documents_project
  on project_editor_documents(company_id, project_id, updated_timestamp desc, document_id);

create table if not exists logic_gate_editor_documents (
  company_id uuid not null,
  logic_gate_id uuid not null,
  document_id text not null,
  source_document_id text,
  document_schema_version integer not null default 1,
  revision bigint not null default 0,
  document_json jsonb not null,
  plain_text text not null default '',
  canonical_annotations jsonb not null default '[]'::jsonb,
  is_deleted boolean not null default false,
  source_html text,
  source_html_sha256 text,
  target_json_sha256 text,
  conversion_run_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, logic_gate_id, document_id),
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  constraint logic_gate_editor_documents_source_id_chk check (source_document_id is null or btrim(source_document_id) <> ''),
  constraint logic_gate_editor_documents_schema_chk check (document_schema_version = 1),
  constraint logic_gate_editor_documents_revision_chk check (revision >= 0),
  constraint logic_gate_editor_documents_source_sha_chk check (source_html_sha256 is null or source_html_sha256 ~ '^[0-9a-f]{64}$'),
  constraint logic_gate_editor_documents_target_sha_chk check (target_json_sha256 is null or target_json_sha256 ~ '^[0-9a-f]{64}$'),
  constraint logic_gate_editor_documents_json_chk check (
    document_json->>'format'='mango-tiptap-json'
    and document_json->>'schema_version'='1'
    and document_json->'document'->>'type'='doc'
    and pg_column_size(document_json) <= 2097152
  ),
  constraint logic_gate_editor_documents_annotations_chk check (
    jsonb_typeof(canonical_annotations)='array' and jsonb_array_length(canonical_annotations) <= 10000
  )
);

create index if not exists idx_logic_gate_editor_documents_gate
  on logic_gate_editor_documents(company_id, logic_gate_id, updated_timestamp desc, document_id);

create table if not exists project_editor_document_operations (
  company_id uuid not null,
  project_id uuid not null,
  document_id text not null,
  revision bigint not null,
  operation_id text not null,
  client_id text not null,
  actor_user_id uuid references users(user_id) on delete set null,
  base_revision bigint not null,
  document_schema_version integer not null default 1,
  document_json jsonb not null,
  canonical_annotations jsonb not null default '[]'::jsonb,
  event_id uuid not null,
  is_delete boolean not null default false,
  committed_timestamp timestamptz not null default now(),
  primary key (company_id, project_id, document_id, operation_id),
  unique (company_id, project_id, document_id, revision),
  foreign key (company_id, project_id, document_id)
    references project_editor_documents(company_id, project_id, document_id) on delete cascade,
  constraint project_editor_document_operations_revision_chk check (revision > base_revision and base_revision >= 0),
  constraint project_editor_document_operations_identity_chk check (btrim(operation_id) <> '' and btrim(client_id) <> ''),
  constraint project_editor_document_operations_schema_chk check (document_schema_version = 1),
  constraint project_editor_document_operations_json_chk check (
    document_json->>'format'='mango-tiptap-json'
    and document_json->>'schema_version'='1'
    and document_json->'document'->>'type'='doc'
    and pg_column_size(document_json) <= 2097152
    and jsonb_typeof(canonical_annotations)='array'
    and jsonb_array_length(canonical_annotations) <= 10000
  )
);

create table if not exists project_editor_document_versions (
  company_id uuid not null,
  project_id uuid not null,
  document_id text not null,
  revision bigint not null,
  document_schema_version integer not null default 1,
  document_json jsonb not null,
  canonical_annotations jsonb not null default '[]'::jsonb,
  operation_id text not null,
  actor_user_id uuid references users(user_id) on delete set null,
  is_deleted boolean not null default false,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, project_id, document_id, revision),
  foreign key (company_id, project_id, document_id)
    references project_editor_documents(company_id, project_id, document_id) on delete cascade,
  constraint project_editor_document_versions_revision_chk check (revision > 0),
  constraint project_editor_document_versions_schema_chk check (document_schema_version = 1),
  constraint project_editor_document_versions_json_chk check (
    document_json->>'format'='mango-tiptap-json'
    and document_json->>'schema_version'='1'
    and document_json->'document'->>'type'='doc'
    and pg_column_size(document_json) <= 2097152
    and jsonb_typeof(canonical_annotations)='array'
    and jsonb_array_length(canonical_annotations) <= 10000
  )
);

create table if not exists logic_gate_editor_document_operations (
  company_id uuid not null,
  logic_gate_id uuid not null,
  document_id text not null,
  revision bigint not null,
  operation_id text not null,
  client_id text not null,
  actor_user_id uuid references users(user_id) on delete set null,
  base_revision bigint not null,
  document_schema_version integer not null default 1,
  document_json jsonb not null,
  canonical_annotations jsonb not null default '[]'::jsonb,
  event_id uuid not null,
  is_delete boolean not null default false,
  committed_timestamp timestamptz not null default now(),
  primary key (company_id, logic_gate_id, document_id, operation_id),
  unique (company_id, logic_gate_id, document_id, revision),
  foreign key (company_id, logic_gate_id, document_id)
    references logic_gate_editor_documents(company_id, logic_gate_id, document_id) on delete cascade,
  constraint logic_gate_editor_document_operations_revision_chk check (revision > base_revision and base_revision >= 0),
  constraint logic_gate_editor_document_operations_identity_chk check (btrim(operation_id) <> '' and btrim(client_id) <> ''),
  constraint logic_gate_editor_document_operations_schema_chk check (document_schema_version = 1),
  constraint logic_gate_editor_document_operations_json_chk check (
    document_json->>'format'='mango-tiptap-json'
    and document_json->>'schema_version'='1'
    and document_json->'document'->>'type'='doc'
    and pg_column_size(document_json) <= 2097152
    and jsonb_typeof(canonical_annotations)='array'
    and jsonb_array_length(canonical_annotations) <= 10000
  )
);

create table if not exists logic_gate_editor_document_versions (
  company_id uuid not null,
  logic_gate_id uuid not null,
  document_id text not null,
  revision bigint not null,
  document_schema_version integer not null default 1,
  document_json jsonb not null,
  canonical_annotations jsonb not null default '[]'::jsonb,
  operation_id text not null,
  actor_user_id uuid references users(user_id) on delete set null,
  is_deleted boolean not null default false,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, logic_gate_id, document_id, revision),
  foreign key (company_id, logic_gate_id, document_id)
    references logic_gate_editor_documents(company_id, logic_gate_id, document_id) on delete cascade,
  constraint logic_gate_editor_document_versions_revision_chk check (revision > 0),
  constraint logic_gate_editor_document_versions_schema_chk check (document_schema_version = 1),
  constraint logic_gate_editor_document_versions_json_chk check (
    document_json->>'format'='mango-tiptap-json'
    and document_json->>'schema_version'='1'
    and document_json->'document'->>'type'='doc'
    and pg_column_size(document_json) <= 2097152
    and jsonb_typeof(canonical_annotations)='array'
    and jsonb_array_length(canonical_annotations) <= 10000
  )
);

create index if not exists idx_project_editor_document_versions
  on project_editor_document_versions(company_id, project_id, document_id, revision desc);
create index if not exists idx_logic_gate_editor_document_versions
  on logic_gate_editor_document_versions(company_id, logic_gate_id, document_id, revision desc);

create table if not exists editor_conversion_runs (
  conversion_run_id uuid primary key,
  company_id uuid not null references companies(company_id) on delete cascade,
  owner_type text not null,
  mode text not null,
  status text not null default 'planned',
  batch_size integer not null,
  source_snapshot_timestamp timestamptz not null,
  backup_reference text not null,
  expected_count bigint not null default 0,
  converted_count bigint not null default 0,
  warning_count bigint not null default 0,
  failed_count bigint not null default 0,
  started_by_user_id uuid references users(user_id) on delete set null,
  started_timestamp timestamptz,
  completed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  constraint editor_conversion_runs_owner_chk check (owner_type in ('node','project','logic_gate','all')),
  constraint editor_conversion_runs_mode_chk check (mode in ('dry_run','backfill','shadow_validate','rollback_export')),
  constraint editor_conversion_runs_status_chk check (status in ('planned','running','paused','completed','failed','cancelled')),
  constraint editor_conversion_runs_batch_chk check (batch_size between 1 and 1000),
  constraint editor_conversion_runs_counts_chk check (
    expected_count >= 0 and converted_count >= 0 and warning_count >= 0 and failed_count >= 0
    and converted_count + failed_count <= expected_count
  ),
  constraint editor_conversion_runs_backup_chk check (btrim(backup_reference) <> '')
);

create index if not exists idx_editor_conversion_runs_company
  on editor_conversion_runs(company_id, owner_type, created_timestamp desc, conversion_run_id);

create table if not exists editor_conversion_items (
  conversion_run_id uuid not null references editor_conversion_runs(conversion_run_id) on delete cascade,
  company_id uuid not null,
  owner_type text not null,
  owner_id uuid not null,
  document_id text not null,
  source_revision bigint not null,
  item_identity_sha256 text not null,
  source_html_snapshot text not null,
  source_html_sha256 text not null,
  target_json_sha256 text,
  status text not null default 'pending',
  retry_count integer not null default 0,
  warning_report jsonb not null default '[]'::jsonb,
  failure_report jsonb,
  comment_anchor_report jsonb not null default '{}'::jsonb,
  attachment_reference_report jsonb not null default '{}'::jsonb,
  converted_timestamp timestamptz,
  validated_timestamp timestamptz,
  primary key (conversion_run_id, owner_type, owner_id, document_id),
  unique (conversion_run_id, item_identity_sha256),
  constraint editor_conversion_items_owner_chk check (owner_type in ('node','project','logic_gate')),
  constraint editor_conversion_items_revision_chk check (source_revision >= 0),
  constraint editor_conversion_items_identity_chk check (item_identity_sha256 ~ '^[0-9a-f]{64}$'),
  constraint editor_conversion_items_source_sha_chk check (source_html_sha256 ~ '^[0-9a-f]{64}$'),
  constraint editor_conversion_items_target_sha_chk check (target_json_sha256 is null or target_json_sha256 ~ '^[0-9a-f]{64}$'),
  constraint editor_conversion_items_status_chk check (status in ('pending','converted','warning','failed','validated','skipped')),
  constraint editor_conversion_items_reports_chk check (
    jsonb_typeof(warning_report)='array'
    and jsonb_typeof(comment_anchor_report)='object'
    and jsonb_typeof(attachment_reference_report)='object'
  )
);

create index if not exists idx_editor_conversion_items_resume
  on editor_conversion_items(conversion_run_id, status, owner_id, document_id);

create table if not exists editor_shadow_comparisons (
  comparison_id uuid primary key,
  conversion_run_id uuid not null references editor_conversion_runs(conversion_run_id) on delete cascade,
  company_id uuid not null,
  owner_type text not null,
  owner_id uuid not null,
  document_id text not null,
  legacy_sha256 text not null,
  json_sha256 text not null,
  rendered_text_sha256 text not null,
  equivalent boolean not null,
  differences jsonb not null default '[]'::jsonb,
  latency_ms numeric(12,3) not null,
  compared_timestamp timestamptz not null default now(),
  constraint editor_shadow_comparisons_owner_chk check (owner_type in ('node','project','logic_gate')),
  constraint editor_shadow_comparisons_identity_uq
    unique (conversion_run_id, owner_type, owner_id, document_id),
  constraint editor_shadow_comparisons_hashes_chk check (
    legacy_sha256 ~ '^[0-9a-f]{64}$'
    and json_sha256 ~ '^[0-9a-f]{64}$'
    and rendered_text_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint editor_shadow_comparisons_differences_chk check (jsonb_typeof(differences)='array')
);

create index if not exists idx_editor_shadow_comparisons_failures
  on editor_shadow_comparisons(company_id, owner_type, compared_timestamp desc)
  where not equivalent;

create table if not exists editor_rollout_gates (
  company_id uuid not null references companies(company_id) on delete cascade,
  owner_type text not null,
  rollout_state text not null default 'inactive',
  expected_count bigint not null default 0,
  converted_count bigint not null default 0,
  failed_count bigint not null default 0,
  shadow_mismatch_count bigint not null default 0,
  validation_run_id uuid references editor_conversion_runs(conversion_run_id) on delete restrict,
  validated_timestamp timestamptz,
  activated_timestamp timestamptz,
  rollback_requested_timestamp timestamptz,
  rollback_export_completed_timestamp timestamptz,
  rolled_back_timestamp timestamptz,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, owner_type),
  constraint editor_rollout_gates_owner_chk check (owner_type in ('node','project','logic_gate')),
  constraint editor_rollout_gates_state_chk check (rollout_state in ('inactive','shadow','ready','active','rollback_pending','rolled_back')),
  constraint editor_rollout_gates_counts_chk check (
    expected_count >= 0 and converted_count >= 0 and failed_count >= 0 and shadow_mismatch_count >= 0
    and converted_count <= expected_count
  ),
  constraint editor_rollout_gates_ready_chk check (
    rollout_state not in ('ready','active')
    or (
      expected_count=converted_count and failed_count=0 and shadow_mismatch_count=0
      and validation_run_id is not null and validated_timestamp is not null
    )
  ),
  constraint editor_rollout_gates_active_chk check (rollout_state <> 'active' or activated_timestamp is not null),
  constraint editor_rollout_gates_rolled_back_chk check (
    rollout_state <> 'rolled_back'
    or (rollback_export_completed_timestamp is not null and rolled_back_timestamp is not null)
  )
);

create table if not exists editor_rollback_exports (
  rollback_export_id uuid primary key,
  company_id uuid not null references companies(company_id) on delete cascade,
  owner_type text not null,
  owner_id uuid not null,
  document_id text not null,
  source_revision bigint not null,
  source_update_sequence bigint,
  source_is_deleted boolean not null default false,
  source_json_sha256 text not null,
  exported_html text not null,
  exported_html_sha256 text not null,
  export_run_id uuid not null references editor_conversion_runs(conversion_run_id) on delete restrict,
  exported_timestamp timestamptz not null default now(),
  unique (company_id, owner_type, owner_id, document_id, source_revision),
  constraint editor_rollback_exports_owner_chk check (owner_type in ('node','project','logic_gate')),
  constraint editor_rollback_exports_revision_chk check (source_revision >= 0),
  constraint editor_rollback_exports_hashes_chk check (
    source_json_sha256 ~ '^[0-9a-f]{64}$' and exported_html_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create index if not exists idx_editor_rollback_exports_latest
  on editor_rollback_exports(company_id, owner_type, owner_id, document_id, source_revision desc);

create table if not exists node_verification_content_pins (
  company_id uuid not null,
  node_id uuid not null,
  verification_request_id uuid not null,
  textbox_id uuid not null,
  collaboration_epoch uuid not null,
  checkpoint_id uuid not null,
  checkpoint_through_sequence bigint not null,
  head_update_sequence bigint not null,
  content_revision bigint not null,
  pinned_timestamp timestamptz not null default now(),
  primary key (company_id, node_id, verification_request_id, textbox_id),
  foreign key (company_id, node_id, verification_request_id)
    references node_verification_requests(company_id, node_id, verification_request_id) on delete cascade,
  foreign key (company_id, node_id, textbox_id, checkpoint_id)
    references node_textbox_yjs_checkpoints(company_id, node_id, textbox_id, checkpoint_id) on delete restrict,
  constraint node_verification_content_pins_sequence_chk check (
    checkpoint_through_sequence >= 0 and head_update_sequence >= checkpoint_through_sequence and content_revision >= 0
  )
);

create table if not exists node_verification_update_pins (
  company_id uuid not null,
  node_id uuid not null,
  verification_request_id uuid not null,
  textbox_id uuid not null,
  update_sequence bigint not null,
  primary key (company_id, node_id, verification_request_id, textbox_id, update_sequence),
  foreign key (company_id, node_id, verification_request_id, textbox_id)
    references node_verification_content_pins(company_id, node_id, verification_request_id, textbox_id) on delete cascade,
  foreign key (company_id, node_id, textbox_id, update_sequence)
    references node_textbox_yjs_updates(company_id, node_id, textbox_id, update_sequence) on delete restrict
);

create or replace function mangorts_cleanup_node_v2_yjs_retention(p_limit integer default 1000)
returns jsonb
language plpgsql
as $$
declare
  deleted_updates integer := 0;
  deleted_checkpoints integer := 0;
begin
  if p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid Node V2 cleanup limit';
  end if;

  with candidates as (
    select update_row.company_id, update_row.node_id, update_row.textbox_id, update_row.update_sequence
    from node_textbox_yjs_updates update_row
    where update_row.checkpointed_timestamp is not null
      and update_row.retain_until < clock_timestamp()
      and not exists (
        select 1 from node_verification_update_pins pin
        where (pin.company_id,pin.node_id,pin.textbox_id,pin.update_sequence)
          =(update_row.company_id,update_row.node_id,update_row.textbox_id,update_row.update_sequence)
      )
    order by update_row.retain_until, update_row.update_sequence
    limit p_limit
  )
  delete from node_textbox_yjs_updates update_row
  using candidates candidate
  where (update_row.company_id,update_row.node_id,update_row.textbox_id,update_row.update_sequence)
    =(candidate.company_id,candidate.node_id,candidate.textbox_id,candidate.update_sequence);
  get diagnostics deleted_updates = row_count;

  with candidates as (
    select checkpoint.company_id, checkpoint.node_id, checkpoint.textbox_id, checkpoint.checkpoint_id
    from node_textbox_yjs_checkpoints checkpoint
    where checkpoint.retain_until < clock_timestamp()
      and not exists (
        select 1 from node_verification_content_pins pin
        where (pin.company_id,pin.node_id,pin.textbox_id,pin.checkpoint_id)
          =(checkpoint.company_id,checkpoint.node_id,checkpoint.textbox_id,checkpoint.checkpoint_id)
      )
      and exists (
        select 1 from node_textbox_yjs_checkpoints newer
        where (newer.company_id,newer.node_id,newer.textbox_id,newer.collaboration_epoch)
          =(checkpoint.company_id,checkpoint.node_id,checkpoint.textbox_id,checkpoint.collaboration_epoch)
          and newer.through_update_sequence > checkpoint.through_update_sequence
      )
    order by checkpoint.retain_until, checkpoint.checkpoint_id
    limit p_limit
  )
  delete from node_textbox_yjs_checkpoints checkpoint
  using candidates candidate
  where (checkpoint.company_id,checkpoint.node_id,checkpoint.textbox_id,checkpoint.checkpoint_id)
    =(candidate.company_id,candidate.node_id,candidate.textbox_id,candidate.checkpoint_id);
  get diagnostics deleted_checkpoints = row_count;

  return jsonb_build_object('deleted_updates',deleted_updates,'deleted_checkpoints',deleted_checkpoints);
end;
$$;

create or replace function mangorts_prepare_company_editor_purge(p_company_id uuid)
returns jsonb
language plpgsql
as $$
declare
  comment_attachment_links integer := 0;
  email_links integer := 0;
  attachment_links integer := 0;
begin
  delete from node_textbox_comment_attachment_links where company_id=p_company_id;
  get diagnostics comment_attachment_links = row_count;
  delete from node_textbox_email_links where company_id=p_company_id;
  get diagnostics email_links = row_count;
  delete from node_textbox_attachment_links where company_id=p_company_id;
  get diagnostics attachment_links = row_count;
  return jsonb_build_object(
    'node_textbox_comment_attachment_links',comment_attachment_links,
    'node_textbox_email_links',email_links,
    'node_textbox_attachment_links',attachment_links
  );
end;
$$;

create or replace function mangorts_validate_editor_format_cutover()
returns trigger
language plpgsql
as $$
declare
  stored_count bigint;
  ready_gate_count integer;
begin
  if new.migration_state = 'ready' or new.editor_format = 'tiptap_json' then
    select
      (select count(*) from node_textboxes where company_id=new.company_id and source_information_id is not null and deleted_timestamp is null)
      + (select count(*) from project_editor_documents where company_id=new.company_id)
      + (select count(*) from logic_gate_editor_documents where company_id=new.company_id)
    into stored_count;
    select count(*) into ready_gate_count
    from editor_rollout_gates
    where company_id=new.company_id
      and owner_type in ('node','project','logic_gate')
      and rollout_state in ('ready','active')
      and expected_count=converted_count
      and failed_count=0
      and shadow_mismatch_count=0
      and validated_timestamp is not null;
    if new.expected_document_count <> new.converted_document_count
      or stored_count <> new.converted_document_count
      or ready_gate_count <> 3
      or new.validated_timestamp is null then
      raise exception 'workspace editor conversion is incomplete';
    end if;
  end if;
  new.updated_timestamp = clock_timestamp();
  return new;
end;
$$;

comment on function mangorts_prepare_company_editor_purge(uuid) is
  'First, explicit step in company deletion: removes Node V2 typed ownership links in restrictive dependency order. The caller must keep this call and company deletion in one transaction.';
comment on table editor_rollout_gates is
  'Inactive-by-default owner-specific rollout gate. Only reviewed migration tooling may mutate it.';
comment on table editor_rollback_exports is
  'Post-cutover JSON-to-HTML exports. Rollback cannot proceed until current revisions are exported.';
comment on table node_verification_content_pins is
  'Pins the checkpoint and exact tail boundary needed to reconstruct verified content despite retention.';
