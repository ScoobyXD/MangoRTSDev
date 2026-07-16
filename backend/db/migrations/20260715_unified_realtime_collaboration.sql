-- Unified realtime collaboration durable spine.
-- Apply before deploying application instances that publish collaboration deltas.

create table if not exists realtime_outbox (
  outbox_sequence bigserial primary key,
  event_id uuid not null unique,
  company_id uuid not null,
  scope text not null,
  event_type text not null,
  resource_type text,
  resource_id text,
  permission text,
  resource_revision bigint not null default 0,
  payload jsonb not null,
  allowed_user_ids jsonb not null default '[]'::jsonb,
  audience_restricted boolean not null default false,
  attempt_count integer not null default 0,
  claim_token uuid,
  claim_expires_at timestamptz,
  published_timestamp timestamptz,
  last_error_category text,
  created_timestamp timestamptz not null default now(),
  constraint realtime_outbox_company_fkey foreign key (company_id) references companies(company_id) on delete cascade,
  constraint realtime_outbox_scope_nonblank_chk check (btrim(scope) <> '' and octet_length(scope) <= 384),
  constraint realtime_outbox_event_type_nonblank_chk check (btrim(event_type) <> ''),
  constraint realtime_outbox_resource_revision_chk check (resource_revision >= 0),
  constraint realtime_outbox_payload_size_chk check (pg_column_size(payload) <= 262144),
  constraint realtime_outbox_allowed_user_ids_array_chk check (jsonb_typeof(allowed_user_ids) = 'array'),
  constraint realtime_outbox_attempt_count_chk check (attempt_count >= 0)
);

create index if not exists idx_realtime_outbox_claim
  on realtime_outbox(outbox_sequence)
  where published_timestamp is null;

create index if not exists idx_realtime_outbox_published_sequence
  on realtime_outbox(outbox_sequence)
  where published_timestamp is not null;

create index if not exists idx_realtime_outbox_scope_sequence
  on realtime_outbox(company_id, scope, outbox_sequence);

create table if not exists editor_collaboration_documents (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  document_id uuid not null,
  model_version smallint not null default 2,
  revision bigint not null default 0,
  snapshot_revision bigint not null default 0,
  snapshot_state jsonb not null,
  accumulated_delta_bytes integer not null default 0,
  is_deleted boolean not null default false,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id, document_id),
  constraint editor_collaboration_documents_company_fkey foreign key (company_id) references companies(company_id) on delete cascade,
  constraint editor_collaboration_documents_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project')),
  constraint editor_collaboration_documents_model_version_chk check (model_version = 2),
  constraint editor_collaboration_documents_revision_chk check (revision >= 0 and snapshot_revision >= 0 and snapshot_revision <= revision),
  constraint editor_collaboration_documents_snapshot_state_chk check (
    jsonb_typeof(snapshot_state) = 'object'
    and snapshot_state ? 'ops'
    and jsonb_typeof(snapshot_state->'ops') = 'array'
  ),
  constraint editor_collaboration_documents_delta_bytes_chk check (accumulated_delta_bytes >= 0)
);

create index if not exists idx_editor_collaboration_documents_resource
  on editor_collaboration_documents(company_id, resource_type, resource_id, updated_timestamp desc);

create table if not exists editor_collaboration_operations (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  document_id uuid not null,
  revision bigint not null,
  operation_id text not null,
  client_id text not null,
  actor_user_id uuid,
  base_revision bigint not null,
  operation_kind text not null default 'quill_delta_v2',
  delta jsonb not null,
  event_id uuid not null unique,
  is_tombstone boolean not null default false,
  committed_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id, document_id, revision),
  unique (company_id, resource_type, resource_id, document_id, operation_id),
  constraint editor_collaboration_operations_document_fkey
    foreign key (company_id, resource_type, resource_id, document_id)
    references editor_collaboration_documents(company_id, resource_type, resource_id, document_id)
    on delete cascade,
  constraint editor_collaboration_operations_actor_fkey foreign key (actor_user_id) references users(user_id) on delete set null,
  constraint editor_collaboration_operations_revision_chk check (revision > 0 and base_revision >= 0),
  constraint editor_collaboration_operations_kind_chk check (operation_kind = 'quill_delta_v2'),
  constraint editor_collaboration_operations_operation_id_chk check (btrim(operation_id) <> '' and octet_length(operation_id) <= 160),
  constraint editor_collaboration_operations_client_id_chk check (btrim(client_id) <> '' and octet_length(client_id) <= 160),
  constraint editor_collaboration_operations_delta_chk check (
    jsonb_typeof(delta) = 'object'
    and pg_column_size(delta) <= 65536
    and (is_tombstone or (delta ? 'ops' and jsonb_typeof(delta->'ops') = 'array'))
  )
);

create index if not exists idx_editor_collaboration_operations_replay
  on editor_collaboration_operations(company_id, resource_type, resource_id, document_id, revision)
  where not is_tombstone;

-- Logic Gate collaboration treats every independently editable text body as an
-- exact document. Remove the historical one-text-box-per-gate uniqueness rule.
drop index if exists idx_logic_gate_projection_table_one_text_box;
create index if not exists idx_logic_gate_projection_table_text_boxes
  on logic_gate_projection_table(company_id, logic_gate_id, created_timestamp, information_id)
  where type = 'Text box'::information_type;
