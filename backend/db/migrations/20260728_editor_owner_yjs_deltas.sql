-- EDITOR_OWNER_YJS_DELTAS_BEGIN
-- Project and Logic Gate editors use the same checkpoint-plus-delta durability
-- model as Node V2. The migration tool pre-seeds every converted document;
-- the collaboration service can also seed an existing row during deployment.

alter table project_editor_documents
  add column if not exists collaboration_epoch uuid not null default gen_random_uuid(),
  add column if not exists latest_update_sequence bigint not null default 0,
  add column if not exists materialized_through_sequence bigint not null default 0;

alter table logic_gate_editor_documents
  add column if not exists collaboration_epoch uuid not null default gen_random_uuid(),
  add column if not exists latest_update_sequence bigint not null default 0,
  add column if not exists materialized_through_sequence bigint not null default 0;

alter table project_editor_documents
  drop constraint if exists project_editor_documents_yjs_sequences_chk;
alter table project_editor_documents
  add constraint project_editor_documents_yjs_sequences_chk check (
    latest_update_sequence >= 0
    and materialized_through_sequence >= 0
    and materialized_through_sequence <= latest_update_sequence
  );

alter table logic_gate_editor_documents
  drop constraint if exists logic_gate_editor_documents_yjs_sequences_chk;
alter table logic_gate_editor_documents
  add constraint logic_gate_editor_documents_yjs_sequences_chk check (
    latest_update_sequence >= 0
    and materialized_through_sequence >= 0
    and materialized_through_sequence <= latest_update_sequence
  );

create table if not exists editor_owner_yjs_updates (
  company_id uuid not null references companies(company_id) on delete cascade,
  owner_type text not null,
  owner_id uuid not null,
  document_id text not null,
  update_sequence bigint generated always as identity,
  update_id uuid not null,
  update_sha256 text not null,
  collaboration_epoch uuid not null,
  client_id text not null,
  actor_user_id uuid references users(user_id) on delete set null,
  update_payload bytea not null,
  created_timestamp timestamptz not null default now(),
  checkpointed_timestamp timestamptz,
  retain_until timestamptz,
  primary key (company_id, owner_type, owner_id, document_id, update_sequence),
  unique (company_id, owner_type, owner_id, document_id, update_id),
  unique (company_id, owner_type, owner_id, document_id, collaboration_epoch, update_sha256),
  constraint editor_owner_yjs_updates_owner_chk check (owner_type in ('project','logic_gate')),
  constraint editor_owner_yjs_updates_document_chk check (btrim(document_id) <> '' and length(document_id) <= 500),
  constraint editor_owner_yjs_updates_client_chk check (btrim(client_id) <> '' and octet_length(client_id) <= 160),
  constraint editor_owner_yjs_updates_sha_chk check (update_sha256 ~ '^[0-9a-f]{64}$'),
  constraint editor_owner_yjs_updates_payload_chk check (octet_length(update_payload) between 1 and 8388608)
);

create index if not exists idx_editor_owner_yjs_updates_replay
  on editor_owner_yjs_updates(company_id, owner_type, owner_id, document_id, collaboration_epoch, update_sequence);

create table if not exists editor_owner_yjs_checkpoints (
  company_id uuid not null references companies(company_id) on delete cascade,
  owner_type text not null,
  owner_id uuid not null,
  document_id text not null,
  checkpoint_id uuid not null,
  collaboration_epoch uuid not null,
  through_update_sequence bigint not null,
  checkpoint_payload bytea not null,
  state_vector bytea not null,
  document_schema_version integer not null default 1,
  document_json jsonb not null,
  plain_text text not null default '',
  canonical_annotations jsonb not null default '[]'::jsonb,
  checkpoint_reason text not null,
  created_timestamp timestamptz not null default now(),
  retain_until timestamptz not null,
  primary key (company_id, owner_type, owner_id, document_id, checkpoint_id),
  unique (company_id, owner_type, owner_id, document_id, collaboration_epoch, through_update_sequence),
  constraint editor_owner_yjs_checkpoints_owner_chk check (owner_type in ('project','logic_gate')),
  constraint editor_owner_yjs_checkpoints_document_chk check (btrim(document_id) <> '' and length(document_id) <= 500),
  constraint editor_owner_yjs_checkpoints_sequence_chk check (through_update_sequence >= 0),
  constraint editor_owner_yjs_checkpoints_schema_chk check (document_schema_version = 1),
  constraint editor_owner_yjs_checkpoints_reason_chk check (checkpoint_reason in ('migration_seed','operation_count','update_bytes','idle','manual_recovery')),
  constraint editor_owner_yjs_checkpoints_json_chk check (
    document_json->>'format'='mango-tiptap-json'
    and document_json->>'schema_version'='1'
    and document_json->'document'->>'type'='doc'
    and jsonb_typeof(canonical_annotations)='array'
    and jsonb_array_length(canonical_annotations) <= 10000
  ),
  constraint editor_owner_yjs_checkpoints_payload_chk check (octet_length(checkpoint_payload) > 0 and octet_length(state_vector) > 0)
);

create index if not exists idx_editor_owner_yjs_checkpoints_replay
  on editor_owner_yjs_checkpoints(company_id, owner_type, owner_id, document_id, collaboration_epoch, through_update_sequence desc);

create or replace function delete_project_editor_yjs_history()
returns trigger
language plpgsql
as $$
begin
  delete from editor_owner_yjs_updates
   where company_id=old.company_id and owner_type='project'
     and owner_id=old.project_id and document_id=old.document_id;
  delete from editor_owner_yjs_checkpoints
   where company_id=old.company_id and owner_type='project'
     and owner_id=old.project_id and document_id=old.document_id;
  return old;
end;
$$;

create or replace function delete_logic_gate_editor_yjs_history()
returns trigger
language plpgsql
as $$
begin
  delete from editor_owner_yjs_updates
   where company_id=old.company_id and owner_type='logic_gate'
     and owner_id=old.logic_gate_id and document_id=old.document_id;
  delete from editor_owner_yjs_checkpoints
   where company_id=old.company_id and owner_type='logic_gate'
     and owner_id=old.logic_gate_id and document_id=old.document_id;
  return old;
end;
$$;

drop trigger if exists trg_project_editor_document_yjs_cleanup on project_editor_documents;
create trigger trg_project_editor_document_yjs_cleanup
after delete on project_editor_documents
for each row execute function delete_project_editor_yjs_history();

drop trigger if exists trg_project_editor_document_yjs_epoch_cleanup on project_editor_documents;
create trigger trg_project_editor_document_yjs_epoch_cleanup
after update of collaboration_epoch on project_editor_documents
for each row when (old.collaboration_epoch is distinct from new.collaboration_epoch)
execute function delete_project_editor_yjs_history();

drop trigger if exists trg_logic_gate_editor_document_yjs_cleanup on logic_gate_editor_documents;
create trigger trg_logic_gate_editor_document_yjs_cleanup
after delete on logic_gate_editor_documents
for each row execute function delete_logic_gate_editor_yjs_history();

drop trigger if exists trg_logic_gate_editor_document_yjs_epoch_cleanup on logic_gate_editor_documents;
create trigger trg_logic_gate_editor_document_yjs_epoch_cleanup
after update of collaboration_epoch on logic_gate_editor_documents
for each row when (old.collaboration_epoch is distinct from new.collaboration_epoch)
execute function delete_logic_gate_editor_yjs_history();

-- EDITOR_OWNER_YJS_DELTAS_END
