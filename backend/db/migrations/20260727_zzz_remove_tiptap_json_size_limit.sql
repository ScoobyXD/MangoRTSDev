-- Remove Mango's editor-specific two-MiB Tiptap JSON cap. Document structure,
-- schema version, annotation shape/count, and the platform request-body ceiling
-- remain enforced. Source HTML and legacy collaboration limits are unchanged.

alter table editor_json_documents
  drop constraint if exists editor_json_documents_contract_chk,
  drop constraint if exists editor_json_documents_annotations_chk;

alter table editor_json_documents
  add constraint editor_json_documents_contract_chk check (
    jsonb_typeof(canonical_document) = 'object'
    and canonical_document->>'format' = 'mango-tiptap-json'
    and canonical_document->>'schema_version' = '1'
    and jsonb_typeof(canonical_document->'document') = 'object'
    and canonical_document->'document'->>'type' = 'doc'
  ),
  add constraint editor_json_documents_annotations_chk check (
    jsonb_typeof(canonical_annotations) = 'array'
    and jsonb_array_length(canonical_annotations) <= 10000
  );

alter table editor_json_operations
  drop constraint if exists editor_json_operations_contract_chk,
  drop constraint if exists editor_json_operations_annotations_chk;

alter table editor_json_operations
  add constraint editor_json_operations_contract_chk check (
    jsonb_typeof(canonical_document) = 'object'
    and canonical_document->>'format' = 'mango-tiptap-json'
    and canonical_document->>'schema_version' = '1'
  ),
  add constraint editor_json_operations_annotations_chk check (
    jsonb_typeof(canonical_annotations) = 'array'
    and jsonb_array_length(canonical_annotations) <= 10000
  );

alter table editor_json_versions
  drop constraint if exists editor_json_versions_contract_chk,
  drop constraint if exists editor_json_versions_annotations_chk;

alter table editor_json_versions
  add constraint editor_json_versions_contract_chk check (
    jsonb_typeof(canonical_document) = 'object'
    and canonical_document->>'format' = 'mango-tiptap-json'
    and canonical_document->>'schema_version' = '1'
  ),
  add constraint editor_json_versions_annotations_chk check (
    jsonb_typeof(canonical_annotations) = 'array'
    and jsonb_array_length(canonical_annotations) <= 10000
  );

alter table project_editor_documents
  drop constraint if exists project_editor_documents_json_chk;

alter table project_editor_documents
  add constraint project_editor_documents_json_chk check (
    document_json->>'format' = 'mango-tiptap-json'
    and document_json->>'schema_version' = '1'
    and document_json->'document'->>'type' = 'doc'
  );

alter table logic_gate_editor_documents
  drop constraint if exists logic_gate_editor_documents_json_chk;

alter table logic_gate_editor_documents
  add constraint logic_gate_editor_documents_json_chk check (
    document_json->>'format' = 'mango-tiptap-json'
    and document_json->>'schema_version' = '1'
    and document_json->'document'->>'type' = 'doc'
  );

alter table project_editor_document_operations
  drop constraint if exists project_editor_document_operations_json_chk;

alter table project_editor_document_operations
  add constraint project_editor_document_operations_json_chk check (
    document_json->>'format' = 'mango-tiptap-json'
    and document_json->>'schema_version' = '1'
    and document_json->'document'->>'type' = 'doc'
    and jsonb_typeof(canonical_annotations) = 'array'
    and jsonb_array_length(canonical_annotations) <= 10000
  );

alter table project_editor_document_versions
  drop constraint if exists project_editor_document_versions_json_chk;

alter table project_editor_document_versions
  add constraint project_editor_document_versions_json_chk check (
    document_json->>'format' = 'mango-tiptap-json'
    and document_json->>'schema_version' = '1'
    and document_json->'document'->>'type' = 'doc'
    and jsonb_typeof(canonical_annotations) = 'array'
    and jsonb_array_length(canonical_annotations) <= 10000
  );

alter table logic_gate_editor_document_operations
  drop constraint if exists logic_gate_editor_document_operations_json_chk;

alter table logic_gate_editor_document_operations
  add constraint logic_gate_editor_document_operations_json_chk check (
    document_json->>'format' = 'mango-tiptap-json'
    and document_json->>'schema_version' = '1'
    and document_json->'document'->>'type' = 'doc'
    and jsonb_typeof(canonical_annotations) = 'array'
    and jsonb_array_length(canonical_annotations) <= 10000
  );

alter table logic_gate_editor_document_versions
  drop constraint if exists logic_gate_editor_document_versions_json_chk;

alter table logic_gate_editor_document_versions
  add constraint logic_gate_editor_document_versions_json_chk check (
    document_json->>'format' = 'mango-tiptap-json'
    and document_json->>'schema_version' = '1'
    and document_json->'document'->>'type' = 'doc'
    and jsonb_typeof(canonical_annotations) = 'array'
    and jsonb_array_length(canonical_annotations) <= 10000
  );
