-- Restore rich HTML as Mango's only editor document representation.
-- Existing structured collaboration state is intentionally superseded by the
-- authoritative rich HTML already stored in Node/Logic Gate/Project projections.

alter table editor_collaboration_documents
  add column if not exists canonical_html text;

create or replace function pg_temp.mango_editor_projection_document(information text)
returns text
language plpgsql
as $$
declare
  marker constant text := '<!-- mango-node-text-block-v1 -->';
  payload jsonb;
begin
  if left(information, length(marker)) <> marker then
    return information;
  end if;
  payload := substring(information from length(marker) + 1)::jsonb;
  return coalesce(payload->>'document', '');
end;
$$;

update editor_collaboration_documents d
set canonical_html = pg_temp.mango_editor_projection_document(p.information)
from node_projection_table p
where d.canonical_html is null
  and d.resource_type = 'node'
  and p.company_id = d.company_id
  and p.node_id = d.resource_id
  and p.information_id = d.document_id
  and not p.is_deleted;

update editor_collaboration_documents d
set canonical_html = pg_temp.mango_editor_projection_document(p.information)
from logic_gate_projection_table p
where d.canonical_html is null
  and d.resource_type = 'logic_gate'
  and p.company_id = d.company_id
  and p.logic_gate_id = d.resource_id
  and p.information_id = d.document_id
  and not p.is_deleted;

update editor_collaboration_documents d
set canonical_html = pg_temp.mango_editor_projection_document(p.information)
from project_projection_table p
where d.canonical_html is null
  and d.resource_type = 'project'
  and p.company_id = d.company_id
  and p.project_id = d.resource_id
  and p.information_id = d.document_id;

update editor_collaboration_documents
set canonical_html = ''
where canonical_html is null and is_deleted;

do $$
begin
  if exists (
    select 1
    from editor_collaboration_documents
    where canonical_html is null and not is_deleted
  ) then
    raise exception 'active editor collaboration document has no authoritative projection HTML';
  end if;
end;
$$;

alter table editor_collaboration_documents
  alter column canonical_html set not null;

alter table editor_collaboration_documents
  drop constraint if exists editor_collaboration_documents_model_version_chk,
  drop constraint if exists editor_collaboration_documents_revision_chk,
  drop constraint if exists editor_collaboration_documents_snapshot_state_chk,
  drop constraint if exists editor_collaboration_documents_delta_bytes_chk,
  drop constraint if exists editor_collaboration_documents_html_size_chk;

alter table editor_collaboration_documents
  drop column if exists model_version,
  drop column if exists snapshot_revision,
  drop column if exists snapshot_state,
  drop column if exists accumulated_delta_bytes;

alter table editor_collaboration_documents
  add constraint editor_collaboration_documents_revision_chk check (revision >= 0),
  add constraint editor_collaboration_documents_html_size_chk check (octet_length(canonical_html) <= 2097152);

alter table editor_collaboration_operations
  add column if not exists patch jsonb,
  add column if not exists requires_snapshot boolean not null default false;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'editor_collaboration_operations'
      and column_name = 'delta'
  ) then
    update editor_collaboration_operations
    set patch = '{"start_utf8":0,"delete_utf8":0,"insert":""}'::jsonb,
        requires_snapshot = true;
  end if;
end;
$$;

alter table editor_collaboration_operations
  alter column patch set not null;

alter table editor_collaboration_operations
  drop constraint if exists editor_collaboration_operations_kind_chk,
  drop constraint if exists editor_collaboration_operations_delta_chk,
  drop constraint if exists editor_collaboration_operations_patch_chk;

alter table editor_collaboration_operations
  drop column if exists operation_kind,
  drop column if exists delta;

alter table editor_collaboration_operations
  add constraint editor_collaboration_operations_patch_chk check (
    jsonb_typeof(patch) = 'object'
    and patch ? 'start_utf8'
    and patch ? 'delete_utf8'
    and patch ? 'insert'
    and jsonb_typeof(patch->'start_utf8') = 'number'
    and jsonb_typeof(patch->'delete_utf8') = 'number'
    and jsonb_typeof(patch->'insert') = 'string'
    and (patch->>'start_utf8')::integer >= 0
    and (patch->>'delete_utf8')::integer >= 0
    and pg_column_size(patch) <= 65536
  );

drop index if exists idx_editor_collaboration_operations_replay;
create index if not exists idx_editor_collaboration_operations_rebase
  on editor_collaboration_operations(company_id, resource_type, resource_id, document_id, revision)
  where not requires_snapshot and not is_tombstone;

comment on column editor_collaboration_documents.canonical_html is
  'Canonical Mango rich HTML. Initial/recovery reads use this full document; routine collaboration uses bounded HTML text patches.';
comment on column editor_collaboration_operations.patch is
  'Bounded UTF-8 positional edit to canonical_html; not a structured rich-text document format.';
