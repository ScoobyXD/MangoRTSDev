-- Retire the nine editor document/operation/version tables superseded by the
-- six permanent textbox/current-history tables.
--
-- The live development database completed this guarded cleanup separately.
-- Other databases must empty these tables through the reviewed textbox cutover
-- before this migration can remove them. This migration never discards a
-- nonempty legacy table.

do $$
declare
  table_name text;
  remaining_rows bigint;
begin
  foreach table_name in array array[
    'editor_json_documents',
    'editor_json_operations',
    'editor_json_versions',
    'project_editor_documents',
    'project_editor_document_operations',
    'project_editor_document_versions',
    'logic_gate_editor_documents',
    'logic_gate_editor_document_operations',
    'logic_gate_editor_document_versions'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('select count(*) from %I', table_name) into remaining_rows;
      if remaining_rows <> 0 then
        raise exception 'legacy_editor_storage_not_empty: % has % rows', table_name, remaining_rows
          using errcode='P0001',
                hint='Complete and verify the editor textbox cutover before applying this migration.';
      end if;
    end if;
  end loop;
end;
$$;

drop table if exists project_editor_document_operations;
drop table if exists project_editor_document_versions;
drop table if exists logic_gate_editor_document_operations;
drop table if exists logic_gate_editor_document_versions;
drop table if exists editor_json_operations;
drop table if exists editor_json_versions;

drop table if exists project_editor_documents;
drop table if exists logic_gate_editor_documents;
drop table if exists editor_json_documents;

drop function if exists mangorts_enforce_generic_editor_owner_text_limit();

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
      (select count(*) from node_textboxes where company_id=new.company_id and deleted_timestamp is null)
      + (select count(*) from project_textboxes where company_id=new.company_id and deleted_timestamp is null)
      + (select count(*) from logic_gate_textboxes where company_id=new.company_id and deleted_timestamp is null)
      into stored_count;

    select count(*)
      into ready_gate_count
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

drop trigger if exists trg_validate_editor_format_cutover on workspace_editor_formats;
create trigger trg_validate_editor_format_cutover
before insert or update on workspace_editor_formats
for each row execute function mangorts_validate_editor_format_cutover();

create or replace function mangorts_enforce_node_editor_text_limit()
returns trigger
language plpgsql
as $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':node:' || new.node_id::text, 0
  ));
  select coalesce(sum(octet_length(textbox.body_json::text)),0)
    into total_bytes
    from node_textboxes textbox
   where textbox.company_id=new.company_id
     and textbox.node_id=new.node_id
     and textbox.deleted_timestamp is null
     and textbox.textbox_id<>new.textbox_id;
  if new.deleted_timestamp is null then
    total_bytes := total_bytes + octet_length(new.body_json::text);
  end if;
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode='P0001',
            detail='The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

create or replace function mangorts_enforce_project_editor_text_limit()
returns trigger
language plpgsql
as $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':project:' || new.project_id::text, 0
  ));
  select coalesce(sum(octet_length(textbox.body_json::text)),0)
    into total_bytes
    from project_textboxes textbox
   where textbox.company_id=new.company_id
     and textbox.project_id=new.project_id
     and textbox.deleted_timestamp is null
     and textbox.textbox_id<>new.textbox_id;
  if new.deleted_timestamp is null then
    total_bytes := total_bytes + octet_length(new.body_json::text);
  end if;
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode='P0001',
            detail='The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

create or replace function mangorts_enforce_logic_gate_editor_text_limit()
returns trigger
language plpgsql
as $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':logic_gate:' || new.logic_gate_id::text, 0
  ));
  select coalesce(sum(octet_length(textbox.body_json::text)),0)
    into total_bytes
    from logic_gate_textboxes textbox
   where textbox.company_id=new.company_id
     and textbox.logic_gate_id=new.logic_gate_id
     and textbox.deleted_timestamp is null
     and textbox.textbox_id<>new.textbox_id;
  if new.deleted_timestamp is null then
    total_bytes := total_bytes + octet_length(new.body_json::text);
  end if;
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode='P0001',
            detail='The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_node_editor_text_limit on node_textboxes;
create trigger trg_node_editor_text_limit
before insert or update of company_id,node_id,textbox_id,body_json,deleted_timestamp
on node_textboxes for each row execute function mangorts_enforce_node_editor_text_limit();

drop trigger if exists trg_project_editor_text_limit on project_textboxes;
create trigger trg_project_editor_text_limit
before insert or update of company_id,project_id,textbox_id,body_json,deleted_timestamp
on project_textboxes for each row execute function mangorts_enforce_project_editor_text_limit();

drop trigger if exists trg_logic_gate_editor_text_limit on logic_gate_textboxes;
create trigger trg_logic_gate_editor_text_limit
before insert or update of company_id,logic_gate_id,textbox_id,body_json,deleted_timestamp
on logic_gate_textboxes for each row execute function mangorts_enforce_logic_gate_editor_text_limit();
