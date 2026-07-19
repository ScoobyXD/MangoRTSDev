-- Add Mango's isolated JSON-native Tiptap storage and workspace-wide format gate.
-- This migration creates no gate rows and converts no legacy HTML. Therefore
-- every existing workspace remains in legacy_html mode after this migration.

create table if not exists workspace_editor_formats (
  company_id uuid primary key,
  editor_format text not null default 'legacy_html',
  migration_state text not null default 'not_started',
  document_schema_version integer not null default 1,
  expected_document_count bigint not null default 0,
  converted_document_count bigint not null default 0,
  validated_timestamp timestamptz,
  cutover_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint workspace_editor_formats_company_fkey
    foreign key (company_id) references companies(company_id) on delete cascade,
  constraint workspace_editor_formats_format_chk
    check (editor_format in ('legacy_html', 'tiptap_json')),
  constraint workspace_editor_formats_state_chk
    check (migration_state in ('not_started', 'converting', 'validated', 'ready')),
  constraint workspace_editor_formats_schema_chk
    check (document_schema_version = 1),
  constraint workspace_editor_formats_counts_chk
    check (
      expected_document_count >= 0
      and converted_document_count >= 0
      and converted_document_count <= expected_document_count
    ),
  constraint workspace_editor_formats_ready_chk
    check (
      migration_state <> 'ready'
      or (
        expected_document_count = converted_document_count
        and validated_timestamp is not null
      )
    ),
  constraint workspace_editor_formats_json_cutover_chk
    check (
      editor_format <> 'tiptap_json'
      or (
        migration_state = 'ready'
        and expected_document_count = converted_document_count
        and cutover_timestamp is not null
      )
    )
);

create table if not exists editor_json_documents (
  company_id uuid not null,
  resource_type text not null,
  resource_id text not null,
  document_id text not null,
  document_schema_version integer not null default 1,
  revision bigint not null default 0,
  canonical_document jsonb not null,
  is_deleted boolean not null default false,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id, document_id),
  constraint editor_json_documents_company_fkey
    foreign key (company_id) references companies(company_id) on delete cascade,
  constraint editor_json_documents_resource_type_chk
    check (resource_type in ('node', 'logic_gate', 'project', 'email_draft', 'email_signature')),
  constraint editor_json_documents_resource_id_chk
    check (btrim(resource_id) <> '' and octet_length(resource_id) <= 500),
  constraint editor_json_documents_document_id_chk
    check (btrim(document_id) <> '' and octet_length(document_id) <= 500),
  constraint editor_json_documents_schema_chk check (document_schema_version = 1),
  constraint editor_json_documents_revision_chk check (revision >= 0),
  constraint editor_json_documents_contract_chk check (
    jsonb_typeof(canonical_document) = 'object'
    and canonical_document->>'format' = 'mango-tiptap-json'
    and canonical_document->>'schema_version' = '1'
    and jsonb_typeof(canonical_document->'document') = 'object'
    and canonical_document->'document'->>'type' = 'doc'
    and pg_column_size(canonical_document) <= 2097152
  )
);

create index if not exists idx_editor_json_documents_resource
  on editor_json_documents(company_id, resource_type, resource_id, updated_timestamp desc);

create table if not exists editor_json_operations (
  company_id uuid not null,
  resource_type text not null,
  resource_id text not null,
  document_id text not null,
  revision bigint not null,
  operation_id text not null,
  client_id text not null,
  actor_user_id uuid,
  base_revision bigint not null,
  document_schema_version integer not null default 1,
  canonical_document jsonb not null,
  event_id uuid not null unique,
  is_delete boolean not null default false,
  committed_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id, document_id, revision),
  unique (company_id, resource_type, resource_id, document_id, operation_id),
  constraint editor_json_operations_document_fkey
    foreign key (company_id, resource_type, resource_id, document_id)
    references editor_json_documents(company_id, resource_type, resource_id, document_id)
    on delete cascade,
  constraint editor_json_operations_actor_fkey
    foreign key (actor_user_id) references users(user_id) on delete set null,
  constraint editor_json_operations_revision_chk
    check (revision > 0 and base_revision >= 0 and revision = base_revision + 1),
  constraint editor_json_operations_id_chk
    check (btrim(operation_id) <> '' and octet_length(operation_id) <= 160),
  constraint editor_json_operations_client_chk
    check (btrim(client_id) <> '' and octet_length(client_id) <= 160),
  constraint editor_json_operations_schema_chk check (document_schema_version = 1),
  constraint editor_json_operations_contract_chk check (
    jsonb_typeof(canonical_document) = 'object'
    and canonical_document->>'format' = 'mango-tiptap-json'
    and canonical_document->>'schema_version' = '1'
    and pg_column_size(canonical_document) <= 2097152
  )
);

create table if not exists editor_json_versions (
  company_id uuid not null,
  resource_type text not null,
  resource_id text not null,
  document_id text not null,
  revision bigint not null,
  document_schema_version integer not null default 1,
  canonical_document jsonb not null,
  operation_id text not null,
  actor_user_id uuid,
  is_deleted boolean not null default false,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id, document_id, revision),
  constraint editor_json_versions_document_fkey
    foreign key (company_id, resource_type, resource_id, document_id)
    references editor_json_documents(company_id, resource_type, resource_id, document_id)
    on delete cascade,
  constraint editor_json_versions_actor_fkey
    foreign key (actor_user_id) references users(user_id) on delete set null,
  constraint editor_json_versions_schema_chk check (document_schema_version = 1),
  constraint editor_json_versions_contract_chk check (
    jsonb_typeof(canonical_document) = 'object'
    and canonical_document->>'format' = 'mango-tiptap-json'
    and canonical_document->>'schema_version' = '1'
    and pg_column_size(canonical_document) <= 2097152
  )
);

create index if not exists idx_editor_json_versions_recent
  on editor_json_versions(company_id, resource_type, resource_id, document_id, revision desc);

create or replace function mangorts_validate_editor_format_cutover()
returns trigger
language plpgsql
as $$
declare
  stored_count bigint;
begin
  if new.migration_state = 'ready' or new.editor_format = 'tiptap_json' then
    select count(*) into stored_count
    from editor_json_documents
    where company_id = new.company_id and not is_deleted;
    if new.expected_document_count <> new.converted_document_count
      or stored_count <> new.converted_document_count
      or new.validated_timestamp is null then
      raise exception 'workspace editor conversion is incomplete';
    end if;
  end if;
  new.updated_timestamp = now();
  return new;
end;
$$;

drop trigger if exists trg_validate_editor_format_cutover on workspace_editor_formats;
create trigger trg_validate_editor_format_cutover
before insert or update on workspace_editor_formats
for each row execute function mangorts_validate_editor_format_cutover();

create or replace function mangorts_reject_legacy_editor_write_after_cutover()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from workspace_editor_formats
    where company_id = new.company_id and editor_format = 'tiptap_json'
  ) then
    raise exception 'legacy editor write rejected after Tiptap cutover';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_legacy_editor_document_write on editor_collaboration_documents;
create trigger trg_reject_legacy_editor_document_write
before insert or update on editor_collaboration_documents
for each row execute function mangorts_reject_legacy_editor_write_after_cutover();

drop trigger if exists trg_reject_legacy_editor_operation_write on editor_collaboration_operations;
create trigger trg_reject_legacy_editor_operation_write
before insert or update on editor_collaboration_operations
for each row execute function mangorts_reject_legacy_editor_write_after_cutover();

comment on table workspace_editor_formats is
  'Atomic company-wide editor data-format gate. No application endpoint mutates this table.';
comment on column editor_json_documents.canonical_document is
  'Strict Mango Tiptap JSON envelope. Never contains legacy HTML or transient attachment URLs.';
