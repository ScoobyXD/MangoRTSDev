-- Create the six permanent editor storage tables before the backend cutover.
--
-- This migration is intentionally non-destructive. The legacy document,
-- operation, version, and information rows remain available for rollback until
-- the cutover verification migration proves that every current document and
-- every manual save was copied.
--
-- Legacy Node documents whose parent Node no longer exists stay in the legacy
-- table for explicit review. Verification reports them and cleanup refuses to
-- remove that table while any remain.

alter table node_textboxes
  add column if not exists body_json jsonb,
  add column if not exists revision bigint;

update node_textboxes textbox
   set body_json = coalesce(
         (
           select document.canonical_document
                  || jsonb_build_object('annotations', document.canonical_annotations)
             from editor_json_documents document
            where document.company_id = textbox.company_id
              and document.resource_type = 'node'
              and document.resource_id = textbox.node_id::text
              and document.document_id = textbox.textbox_id::text
         ),
         textbox.document_json || jsonb_build_object('annotations', '[]'::jsonb)
       ),
       revision = coalesce(
         (
           select document.revision
             from editor_json_documents document
            where document.company_id = textbox.company_id
              and document.resource_type = 'node'
              and document.resource_id = textbox.node_id::text
              and document.document_id = textbox.textbox_id::text
         ),
         textbox.content_revision
       )
 where body_json is null or revision is null;

do $$
begin
  if exists (
    select 1
      from editor_json_documents
     where resource_type = 'node'
       and (not pg_input_is_valid(resource_id, 'uuid')
         or not pg_input_is_valid(document_id, 'uuid'))
  ) then
    raise exception 'editor_textbox_cutover_invalid_node_identity';
  end if;
end $$;

insert into node_textboxes (
  company_id, node_id, textbox_id, document_schema_version, document_json,
  body_json, plain_text, content_revision, revision, display_order,
  created_timestamp, updated_timestamp, deleted_timestamp
)
select document.company_id,
       document.resource_id::uuid,
       document.document_id::uuid,
       1,
       document.canonical_document,
       document.canonical_document || jsonb_build_object('annotations', document.canonical_annotations),
       '',
       document.revision,
       document.revision,
       row_number() over (
         partition by document.company_id, document.resource_id
         order by document.created_timestamp, document.document_id
       ) - 1,
       document.created_timestamp,
       document.updated_timestamp,
       case when document.is_deleted then document.updated_timestamp end
  from editor_json_documents document
  join nodes parent
    on parent.company_id = document.company_id
   and parent.node_id = document.resource_id::uuid
 where document.resource_type = 'node'
on conflict (company_id, node_id, textbox_id) do nothing;

alter table node_textboxes
  alter column body_json set not null,
  alter column revision set not null,
  alter column revision set default 0;

alter table node_textboxes
  drop constraint if exists node_textboxes_body_json_chk,
  add constraint node_textboxes_body_json_chk check (
    body_json->>'format' = 'mango-tiptap-json'
    and body_json->>'schema_version' = '1'
    and body_json->'document'->>'type' = 'doc'
    and jsonb_typeof(body_json->'annotations') = 'array'
  ),
  drop constraint if exists node_textboxes_cutover_revision_chk,
  add constraint node_textboxes_cutover_revision_chk check (revision >= 0);

create table if not exists project_textboxes (
  company_id uuid not null,
  project_id uuid not null,
  textbox_id text not null,
  body_json jsonb not null,
  revision bigint not null default 0,
  display_order bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, project_id, textbox_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  constraint project_textboxes_id_chk check (btrim(textbox_id) <> ''),
  constraint project_textboxes_revision_chk check (revision >= 0),
  constraint project_textboxes_body_json_chk check (
    body_json->>'format' = 'mango-tiptap-json'
    and body_json->>'schema_version' = '1'
    and body_json->'document'->>'type' = 'doc'
    and jsonb_typeof(body_json->'annotations') = 'array'
  ),
  constraint project_textboxes_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  )
);

create index if not exists idx_project_textboxes_order
  on project_textboxes(company_id, project_id, display_order, textbox_id)
  where deleted_timestamp is null;

insert into project_textboxes (
  company_id, project_id, textbox_id, body_json, revision, display_order,
  created_timestamp, updated_timestamp, deleted_timestamp
)
select document.company_id,
       document.project_id,
       document.document_id,
       document.document_json || jsonb_build_object('annotations', document.canonical_annotations),
       document.revision,
       row_number() over (
         partition by document.company_id, document.project_id
         order by document.created_timestamp, document.document_id
       ) - 1,
       document.created_timestamp,
       document.updated_timestamp,
       case when document.is_deleted then document.updated_timestamp end
  from project_editor_documents document
on conflict (company_id, project_id, textbox_id) do update
  set body_json = excluded.body_json,
      revision = excluded.revision,
      updated_timestamp = excluded.updated_timestamp,
      deleted_timestamp = excluded.deleted_timestamp;

create table if not exists logic_gate_textboxes (
  company_id uuid not null,
  logic_gate_id uuid not null,
  textbox_id text not null,
  body_json jsonb not null,
  revision bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, logic_gate_id, textbox_id),
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  constraint logic_gate_textboxes_id_chk check (btrim(textbox_id) <> ''),
  constraint logic_gate_textboxes_revision_chk check (revision >= 0),
  constraint logic_gate_textboxes_body_json_chk check (
    body_json->>'format' = 'mango-tiptap-json'
    and body_json->>'schema_version' = '1'
    and body_json->'document'->>'type' = 'doc'
    and jsonb_typeof(body_json->'annotations') = 'array'
  ),
  constraint logic_gate_textboxes_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  )
);

create index if not exists idx_logic_gate_textboxes_gate
  on logic_gate_textboxes(company_id, logic_gate_id, updated_timestamp desc, textbox_id)
  where deleted_timestamp is null;

insert into logic_gate_textboxes (
  company_id, logic_gate_id, textbox_id, body_json, revision,
  created_timestamp, updated_timestamp, deleted_timestamp
)
select document.company_id,
       document.logic_gate_id,
       document.document_id,
       document.document_json || jsonb_build_object('annotations', document.canonical_annotations),
       document.revision,
       document.created_timestamp,
       document.updated_timestamp,
       case when document.is_deleted then document.updated_timestamp end
  from logic_gate_editor_documents document
on conflict (company_id, logic_gate_id, textbox_id) do update
  set body_json = excluded.body_json,
      revision = excluded.revision,
      updated_timestamp = excluded.updated_timestamp,
      deleted_timestamp = excluded.deleted_timestamp;

create table if not exists node_textboxes_history (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  batch_id uuid not null,
  body_json jsonb not null,
  display_order bigint not null default 0,
  saved_by_user_id uuid,
  saved_timestamp timestamptz not null default now(),
  primary key (company_id, node_id, batch_id, textbox_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (saved_by_user_id) references users(user_id) on delete set null,
  constraint node_textboxes_history_body_json_chk check (
    body_json->>'format' = 'mango-tiptap-json'
    and body_json->>'schema_version' = '1'
    and body_json->'document'->>'type' = 'doc'
    and jsonb_typeof(body_json->'annotations') = 'array'
  )
);

create table if not exists project_textboxes_history (
  company_id uuid not null,
  project_id uuid not null,
  textbox_id text not null,
  batch_id uuid not null,
  body_json jsonb not null,
  display_order bigint not null default 0,
  saved_by_user_id uuid,
  saved_timestamp timestamptz not null default now(),
  primary key (company_id, project_id, batch_id, textbox_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (saved_by_user_id) references users(user_id) on delete set null,
  constraint project_textboxes_history_id_chk check (btrim(textbox_id) <> ''),
  constraint project_textboxes_history_body_json_chk check (
    body_json->>'format' = 'mango-tiptap-json'
    and body_json->>'schema_version' = '1'
    and body_json->'document'->>'type' = 'doc'
    and jsonb_typeof(body_json->'annotations') = 'array'
  )
);

create table if not exists logic_gate_textboxes_history (
  company_id uuid not null,
  logic_gate_id uuid not null,
  textbox_id text not null,
  batch_id uuid not null,
  body_json jsonb not null,
  saved_by_user_id uuid,
  saved_timestamp timestamptz not null default now(),
  primary key (company_id, logic_gate_id, batch_id, textbox_id),
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (saved_by_user_id) references users(user_id) on delete set null,
  constraint logic_gate_textboxes_history_id_chk check (btrim(textbox_id) <> ''),
  constraint logic_gate_textboxes_history_body_json_chk check (
    body_json->>'format' = 'mango-tiptap-json'
    and body_json->>'schema_version' = '1'
    and body_json->'document'->>'type' = 'doc'
    and jsonb_typeof(body_json->'annotations') = 'array'
  )
);

create index if not exists idx_node_textboxes_history_batches
  on node_textboxes_history(company_id, node_id, saved_timestamp desc, batch_id);
create index if not exists idx_project_textboxes_history_batches
  on project_textboxes_history(company_id, project_id, saved_timestamp desc, batch_id);
create index if not exists idx_logic_gate_textboxes_history_batches
  on logic_gate_textboxes_history(company_id, logic_gate_id, saved_timestamp desc, batch_id);

comment on table node_textboxes_history is
  'Manual Node editor saves. One batch_id groups every textbox captured by one button press.';
comment on table project_textboxes_history is
  'Manual Project editor saves. One batch_id groups every textbox captured by one button press.';
comment on table logic_gate_textboxes_history is
  'Manual Logic Gate editor saves. One batch_id groups every textbox captured by one button press.';

create or replace function mangorts_legacy_saved_editor_body(information text)
returns jsonb
language plpgsql
immutable
as $$
declare
  prefix constant text := '<!-- mango-node-text-block-v1 -->';
  document_text text;
  body jsonb;
begin
  if starts_with(information, prefix) then
    document_text := (substring(information from char_length(prefix) + 1)::jsonb)->>'document';
  else
    document_text := information;
  end if;
  body := document_text::jsonb;
  if body->>'format' <> 'mango-tiptap-json'
     or body->>'schema_version' <> '1'
     or body->'document'->>'type' <> 'doc' then
    return null;
  end if;
  return body || jsonb_build_object(
    'annotations', coalesce(body->'annotations', '[]'::jsonb)
  );
exception
  when others then
    return null;
end;
$$;

insert into node_textboxes_history(
  company_id,node_id,textbox_id,batch_id,body_json,display_order,saved_by_user_id,saved_timestamp
)
select information.company_id,
       information.node_id,
       coalesce(information.source_information_id, information.information_id),
       information.save_batch_id,
       converted.body_json,
       row_number() over (
         partition by information.company_id, information.node_id, information.save_batch_id
         order by information.created_timestamp, information.information_id
       ) - 1,
       information.saved_by_user_id,
       information.updated_timestamp
  from node_information information
 cross join lateral (
   select mangorts_legacy_saved_editor_body(information.information) as body_json
 ) converted
 where information.save_batch_id is not null
   and information.save_kind <> 'auto'
   and converted.body_json is not null
on conflict (company_id,node_id,batch_id,textbox_id) do nothing;

insert into logic_gate_textboxes_history(
  company_id,logic_gate_id,textbox_id,batch_id,body_json,saved_by_user_id,saved_timestamp
)
select information.company_id,
       information.logic_gate_id,
       coalesce(information.source_information_id, information.information_id)::text,
       information.save_batch_id,
       converted.body_json,
       information.saved_by_user_id,
       information.updated_timestamp
  from logic_gate_information information
 cross join lateral (
   select mangorts_legacy_saved_editor_body(information.information) as body_json
 ) converted
 where information.save_batch_id is not null
   and information.save_kind <> 'auto'
   and converted.body_json is not null
on conflict (company_id,logic_gate_id,batch_id,textbox_id) do nothing;

create or replace function mangorts_legacy_project_saved_blocks(information text)
returns jsonb
language plpgsql
immutable
as $$
declare
  payload jsonb;
begin
  if not starts_with(information, 'MANGO_PROJECT_SAVE_V1:') then
    return '[]'::jsonb;
  end if;
  payload := substring(information from char_length('MANGO_PROJECT_SAVE_V1:') + 1)::jsonb;
  if jsonb_typeof(payload->'blocks') <> 'array' then
    return '[]'::jsonb;
  end if;
  return payload->'blocks';
exception
  when others then
    return '[]'::jsonb;
end;
$$;

insert into project_textboxes_history(
  company_id,project_id,textbox_id,batch_id,body_json,display_order,saved_timestamp
)
select information.company_id,
       information.project_id,
       block.value->>'id',
       information.information_id,
       converted.body_json || jsonb_build_object(
         'history_metadata', jsonb_build_object(
           'title', coalesce(block.value->>'title',''),
           'attachments', coalesce(block.value->'attachments','[]'::jsonb),
           'createdTimestamp', coalesce(block.value->>'createdTimestamp',''),
           'updatedTimestamp', coalesce(block.value->>'updatedTimestamp','')
         )
       ),
       block.ordinality - 1,
       information.updated_timestamp
  from project_information information
 cross join lateral jsonb_array_elements(
   mangorts_legacy_project_saved_blocks(information.information)
 ) with ordinality as block(value, ordinality)
 cross join lateral (
   select mangorts_legacy_saved_editor_body(block.value->>'document') as body_json
 ) converted
 where information.type::text = 'Saved version'
   and starts_with(information.information, 'MANGO_PROJECT_SAVE_V1:')
   and nullif(btrim(block.value->>'id'),'') is not null
   and converted.body_json is not null
on conflict (company_id,project_id,batch_id,textbox_id) do nothing;

comment on function mangorts_legacy_saved_editor_body(text) is
  'Cutover-only parser for manual JSON saves. Invalid or legacy HTML rows remain in their old table and block cleanup.';

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
    raise exception 'editor_owner_text_limit_exceeded' using errcode='P0001';
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
    raise exception 'editor_owner_text_limit_exceeded' using errcode='P0001';
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
    raise exception 'editor_owner_text_limit_exceeded' using errcode='P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_node_editor_text_limit on node_textboxes;
create trigger trg_node_editor_text_limit
before insert or update of company_id,node_id,textbox_id,body_json,deleted_timestamp
on node_textboxes for each row execute function mangorts_enforce_node_editor_text_limit();

drop trigger if exists trg_project_editor_text_limit on project_editor_documents;
drop trigger if exists trg_project_editor_text_limit on project_textboxes;
create trigger trg_project_editor_text_limit
before insert or update of company_id,project_id,textbox_id,body_json,deleted_timestamp
on project_textboxes for each row execute function mangorts_enforce_project_editor_text_limit();

drop trigger if exists trg_logic_gate_editor_text_limit on logic_gate_editor_documents;
drop trigger if exists trg_logic_gate_editor_text_limit on logic_gate_textboxes;
create trigger trg_logic_gate_editor_text_limit
before insert or update of company_id,logic_gate_id,textbox_id,body_json,deleted_timestamp
on logic_gate_textboxes for each row execute function mangorts_enforce_logic_gate_editor_text_limit();
