-- Enforce one aggregate text-document limit per Node, Project, or Logic Gate.
-- Only current Tiptap JSON documents count. Historical versions, Yjs update
-- history, and attachment object bytes are deliberately excluded.

create or replace function mangorts_enforce_generic_editor_owner_text_limit()
returns trigger
language plpgsql
as $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':' || new.resource_type || ':' || new.resource_id,
    0
  ));
  select coalesce(sum(octet_length(document.canonical_document::text)), 0)
    into total_bytes
    from editor_json_documents document
   where document.company_id = new.company_id
     and document.resource_type = new.resource_type
     and document.resource_id = new.resource_id
     and not document.is_deleted
     and document.document_id <> new.document_id;
  if not new.is_deleted then
    total_bytes := total_bytes + octet_length(new.canonical_document::text);
  end if;
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode = 'P0001',
            detail = 'The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generic_editor_owner_text_limit on editor_json_documents;
create trigger trg_generic_editor_owner_text_limit
before insert or update of company_id, resource_type, resource_id, document_id, canonical_document, is_deleted
on editor_json_documents
for each row execute function mangorts_enforce_generic_editor_owner_text_limit();

create or replace function mangorts_enforce_node_editor_text_limit()
returns trigger
language plpgsql
as $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':node:' || new.node_id::text,
    0
  ));
  select coalesce(sum(octet_length(textbox.document_json::text)), 0)
    into total_bytes
    from node_textboxes textbox
   where textbox.company_id = new.company_id
     and textbox.node_id = new.node_id
     and textbox.deleted_timestamp is null
     and textbox.textbox_id <> new.textbox_id;
  if new.deleted_timestamp is null then
    total_bytes := total_bytes + octet_length(new.document_json::text);
  end if;
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode = 'P0001',
            detail = 'The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_node_editor_text_limit on node_textboxes;
create trigger trg_node_editor_text_limit
before insert or update of company_id, node_id, textbox_id, document_json, deleted_timestamp
on node_textboxes
for each row execute function mangorts_enforce_node_editor_text_limit();

create or replace function mangorts_enforce_project_editor_text_limit()
returns trigger
language plpgsql
as $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':project:' || new.project_id::text,
    0
  ));
  select coalesce(sum(octet_length(document.document_json::text)), 0)
    into total_bytes
    from project_editor_documents document
   where document.company_id = new.company_id
     and document.project_id = new.project_id
     and not document.is_deleted
     and document.document_id <> new.document_id;
  if not new.is_deleted then
    total_bytes := total_bytes + octet_length(new.document_json::text);
  end if;
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode = 'P0001',
            detail = 'The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_editor_text_limit on project_editor_documents;
create trigger trg_project_editor_text_limit
before insert or update of company_id, project_id, document_id, document_json, is_deleted
on project_editor_documents
for each row execute function mangorts_enforce_project_editor_text_limit();

create or replace function mangorts_enforce_logic_gate_editor_text_limit()
returns trigger
language plpgsql
as $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':logic_gate:' || new.logic_gate_id::text,
    0
  ));
  select coalesce(sum(octet_length(document.document_json::text)), 0)
    into total_bytes
    from logic_gate_editor_documents document
   where document.company_id = new.company_id
     and document.logic_gate_id = new.logic_gate_id
     and not document.is_deleted
     and document.document_id <> new.document_id;
  if not new.is_deleted then
    total_bytes := total_bytes + octet_length(new.document_json::text);
  end if;
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode = 'P0001',
            detail = 'The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_logic_gate_editor_text_limit on logic_gate_editor_documents;
create trigger trg_logic_gate_editor_text_limit
before insert or update of company_id, logic_gate_id, document_id, document_json, is_deleted
on logic_gate_editor_documents
for each row execute function mangorts_enforce_logic_gate_editor_text_limit();

comment on function mangorts_enforce_node_editor_text_limit() is
  'Caps the sum of current Node textbox Tiptap JSON at one GiB. Attachment object bytes and editor history do not count.';
comment on function mangorts_enforce_project_editor_text_limit() is
  'Caps the sum of current Project editor Tiptap JSON at one GiB. Attachment object bytes and editor history do not count.';
