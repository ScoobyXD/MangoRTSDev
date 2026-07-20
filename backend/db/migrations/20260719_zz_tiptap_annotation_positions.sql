begin;

alter table editor_json_documents
  add column if not exists canonical_annotations jsonb not null default '[]'::jsonb;
alter table editor_json_operations
  add column if not exists canonical_annotations jsonb not null default '[]'::jsonb;
alter table editor_json_versions
  add column if not exists canonical_annotations jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'editor_json_documents_annotations_chk') then
    alter table editor_json_documents add constraint editor_json_documents_annotations_chk check (
      jsonb_typeof(canonical_annotations) = 'array'
      and jsonb_array_length(canonical_annotations) <= 10000
      and pg_column_size(canonical_annotations) <= 2097152
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'editor_json_operations_annotations_chk') then
    alter table editor_json_operations add constraint editor_json_operations_annotations_chk check (
      jsonb_typeof(canonical_annotations) = 'array'
      and jsonb_array_length(canonical_annotations) <= 10000
      and pg_column_size(canonical_annotations) <= 2097152
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'editor_json_versions_annotations_chk') then
    alter table editor_json_versions add constraint editor_json_versions_annotations_chk check (
      jsonb_typeof(canonical_annotations) = 'array'
      and jsonb_array_length(canonical_annotations) <= 10000
      and pg_column_size(canonical_annotations) <= 2097152
    );
  end if;
end $$;

comment on column editor_json_documents.canonical_annotations is
  'Authoritative ProseMirror annotation positions accepted atomically with this document revision.';

commit;
