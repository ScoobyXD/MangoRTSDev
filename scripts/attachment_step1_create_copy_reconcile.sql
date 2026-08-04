-- Attachment Step 1 create/copy/recount/reconcile entry point.
-- This is the Step 1 database/data operation. It is not Step 2 application
-- code and it does not perform the Step 3 legacy-table cutoff.
--
-- Open this whole file in DBeaver and execute it as one script. This transaction
-- deletes only the exact ledger-backed broken legacy relationships. It marks
-- zero-owner attachments unavailable but deliberately retains every S3 key and
-- database row needed by the separately confirmed cleanup command.
--
-- The deployed backend remains on resource_attachments,
-- attachment_upload_intents, attachment_upload_parts.upload_intent_id, and
-- attachment_variants after this transaction. Do not run the Step 2 boundary
-- rename from this maintenance operation.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '10min';
set local idle_in_transaction_session_timeout = '12min';

lock table attachments,resource_attachments,
  attachment_upload_intents,attachment_upload_parts,attachment_variants,
  attachment_migration_runs,attachment_migration_items,
  v3_email_migration_runs,v3_email_migration_items
in share row exclusive mode;

-- BEGIN INLINED ADDITIVE EXPANSION
-- Additive Attachment Step 1 expansion only.
-- This migration creates permanent destinations and safety triggers. It does
-- not copy/delete data, touch S3, rename attachment_upload_parts, or retire a
-- legacy table. Operators must use scripts/attachment_step1_* for live data.

create table if not exists attachment_relationships (
  attachment_relationship_id uuid not null,
  company_id uuid not null,
  resource_type text not null,
  resource_id text not null,
  attachment_id uuid not null,
  information_id uuid,
  message_id text not null default '',
  editor_surface text not null default '',
  relationship_kind text not null,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (attachment_relationship_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id,attachment_id)
    references attachments(company_id,attachment_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  constraint attachment_relationships_type_chk check (
    resource_type in (
      'node','logic_gate','project','node_chat_message','logic_gate_chat_message',
      'project_chat_message','email_message','email_draft','email_signature',
      'shared_inbox','company_explorer_folder','shared_inbox_folder'
    )
  ),
  constraint attachment_relationships_resource_id_chk check (btrim(resource_id)<>''),
  constraint attachment_relationships_kind_chk check (
    relationship_kind in (
      'inline_image','file_attachment','chat_attachment','email_attachment',
      'email_inline_attachment','migrated_inline_image'
    )
  )
);
create index if not exists idx_attachment_relationships_resource
  on attachment_relationships(
    company_id,resource_type,resource_id,deleted_timestamp,created_timestamp desc
  );
create index if not exists idx_attachment_relationships_attachment
  on attachment_relationships(company_id,attachment_id,deleted_timestamp);
create unique index if not exists idx_attachment_relationships_active_unique
  on attachment_relationships(
    company_id,resource_type,resource_id,attachment_id,relationship_kind,
    coalesce(information_id::text,''),coalesce(message_id,''),coalesce(editor_surface,'')
  ) where deleted_timestamp is null;

-- Attachment Step 1 keeps the deployed backend on attachment_upload_intents
-- while copying the same durable history into the permanent upload-job name.
-- attachment_upload_parts keeps upload_intent_id until the short, separately
-- operated boundary immediately before the Step 2 backend deployment.
create table if not exists attachment_upload_jobs (
  upload_job_id uuid primary key,
  company_id uuid not null,
  actor_user_id uuid not null,
  client_request_id text not null,
  attachment_id uuid not null,
  attachment_relationship_id uuid,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  sha256_verification_method text not null default 'client_reported',
  storage_checksum_algorithm text not null default '',
  storage_checksum_value text not null default '',
  storage_checksum_type text not null default '',
  resource_type text not null,
  resource_id text not null,
  information_id uuid,
  message_id text not null default '',
  editor_surface text not null default '',
  relationship_kind text not null,
  source_kind text not null,
  source_provider text not null default '',
  original_width integer,
  original_height integer,
  storage_bucket text not null,
  storage_key text not null,
  multipart_upload_id text not null default '',
  strategy text not null,
  part_size_bytes bigint not null default 0,
  part_count integer not null default 0,
  status text not null default 'pending',
  failure_code text not null default '',
  version bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  expires_timestamp timestamptz not null,
  completed_timestamp timestamptz,
  constraint attachment_upload_jobs_client_request_nonblank_chk check (btrim(client_request_id) <> ''),
  constraint attachment_upload_jobs_filename_nonblank_chk check (btrim(original_filename) <> ''),
  constraint attachment_upload_jobs_mime_nonblank_chk check (btrim(mime_type) <> ''),
  constraint attachment_upload_jobs_size_chk check (size_bytes >= 0),
  constraint attachment_upload_jobs_sha256_chk check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint attachment_upload_jobs_sha256_method_chk check (sha256_verification_method in ('s3_full', 'server_stream', 'client_reported')),
  constraint attachment_upload_jobs_storage_checksum_provenance_chk check (
    storage_checksum_algorithm in ('', 'SHA256')
    and storage_checksum_type in ('', 'FULL_OBJECT', 'COMPOSITE')
    and ((storage_checksum_algorithm = '') = (storage_checksum_value = ''))
    and ((storage_checksum_algorithm = '') = (storage_checksum_type = ''))
  ),
  constraint attachment_upload_jobs_resource_nonblank_chk check (btrim(resource_type) <> '' and btrim(resource_id) <> ''),
  constraint attachment_upload_jobs_resource_type_chk check (resource_type in (
    'node', 'logic_gate', 'project', 'node_chat_message', 'logic_gate_chat_message', 'project_chat_message',
    'email_message', 'email_draft', 'email_signature', 'attached_email', 'shared_inbox',
    'company_explorer_folder', 'shared_inbox_folder'
  )),
  constraint attachment_upload_jobs_relationship_chk check (relationship_kind in (
    'inline_image', 'file_attachment', 'chat_attachment', 'email_attachment',
    'email_inline_attachment', 'migrated_inline_image'
  )),
  constraint attachment_upload_jobs_source_chk check (source_kind in (
    'user_upload', 'editor_paste', 'chat_upload', 'email_incoming', 'email_outgoing', 'migration_inline_image'
  )),
  constraint attachment_upload_jobs_storage_nonblank_chk check (btrim(storage_bucket) <> '' and btrim(storage_key) <> ''),
  constraint attachment_upload_jobs_strategy_chk check (
    (strategy = 'single' and size_bytes <= 67108864 and multipart_upload_id = '' and part_size_bytes = 0 and part_count = 0)
    or (strategy = 'multipart' and size_bytes > 67108864 and btrim(multipart_upload_id) <> ''
      and part_size_bytes = 16777216 and part_count = ((size_bytes + 16777215) / 16777216)::integer
      and part_count between 1 and 10000)
  ),
  constraint attachment_upload_jobs_status_chk check (status in ('pending', 'uploading', 'completing', 'completed', 'failed', 'aborted', 'expired')),
  constraint attachment_upload_jobs_completed_timestamp_chk check (
    (status = 'completed' and completed_timestamp is not null)
    or (status <> 'completed' and completed_timestamp is null)
  ),
  constraint attachment_upload_jobs_dimensions_chk check (
    (original_width is null or original_width > 0) and (original_height is null or original_height > 0)
  ),
  unique (company_id, actor_user_id, client_request_id),
  unique (attachment_id),
  unique (storage_bucket, storage_key),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (actor_user_id) references users(user_id) on delete cascade
);

create index if not exists idx_attachment_upload_jobs_expiry
  on attachment_upload_jobs(expires_timestamp, upload_job_id)
  where status in ('pending', 'uploading', 'completing', 'failed');

create index if not exists idx_attachment_upload_jobs_status_expiry
  on attachment_upload_jobs(status, expires_timestamp);

create index if not exists idx_attachment_upload_jobs_resource
  on attachment_upload_jobs(company_id, resource_type, resource_id);

create index if not exists idx_attachment_upload_jobs_actor
  on attachment_upload_jobs(company_id, actor_user_id, updated_timestamp desc);

create table if not exists attachment_previews (
  attachment_id uuid not null,
  preview_type text not null,
  mime_type text not null,
  byte_size bigint not null,
  sha256 text,
  generation_version integer,
  width integer,
  height integer,
  storage_bucket text not null,
  storage_key text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint attachment_previews_type_chk check (preview_type in ('display', 'thumbnail')),
  constraint attachment_previews_mime_type_nonblank_chk check (btrim(mime_type) <> ''),
  constraint attachment_previews_byte_size_chk check (byte_size >= 0),
  constraint attachment_previews_sha256_chk check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint attachment_previews_generation_version_chk check (generation_version is null or generation_version > 0),
  constraint attachment_previews_dimensions_chk check (
    (width is null or width > 0)
    and (height is null or height > 0)
  ),
  constraint attachment_previews_storage_bucket_nonblank_chk check (btrim(storage_bucket) <> ''),
  constraint attachment_previews_storage_key_nonblank_chk check (btrim(storage_key) <> ''),
  primary key (attachment_id, preview_type),
  unique (storage_bucket, storage_key),
  foreign key (attachment_id) references attachments(attachment_id) on delete cascade
);

-- Active links take a row lock on the attachment and reject any attachment
-- already marked for cleanup. This closes the relink-versus-cleanup race while
-- the legacy and final relationship writers coexist during Step 1.
create or replace function mangorts_reject_pending_attachment_link()
returns trigger language plpgsql as $$
begin
  if new.deleted_timestamp is not null then
    return new;
  end if;
  perform 1
  from attachments attachment
  where attachment.company_id=new.company_id
    and attachment.attachment_id=new.attachment_id
    and attachment.deleted_timestamp is null
  for update;
  if not found then
    raise exception 'attachment is missing or pending deletion' using errcode='23503';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_resource_attachments_reject_pending on resource_attachments;
create trigger trg_resource_attachments_reject_pending
before insert or update of company_id,attachment_id,deleted_timestamp
on resource_attachments for each row
execute function mangorts_reject_pending_attachment_link();

-- Final relationships additionally prove that each active owner exists. Legacy
-- structured email identifiers are normalized before they reach this table.
create or replace function mangorts_validate_attachment_relationship_owner()
returns trigger language plpgsql as $$
begin
  if new.deleted_timestamp is not null then
    return new;
  end if;

  perform 1
  from attachments attachment
  where attachment.company_id=new.company_id
    and attachment.attachment_id=new.attachment_id
    and attachment.deleted_timestamp is null
  for update;
  if not found then
    raise exception 'attachment is missing or pending deletion' using errcode='23503';
  end if;

  if new.resource_type='node' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from nodes where company_id=new.company_id
                     and node_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Node owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='logic_gate' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from logic_gates where company_id=new.company_id
                     and logic_gate_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Logic Gate owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='project' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from projects where company_id=new.company_id
                     and project_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Project owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='node_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from node_textbox_chats where company_id=new.company_id
                     and chat_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end and deleted_timestamp is null) then
      raise exception 'attachment Node chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='logic_gate_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from logic_gate_projection_table
                     where company_id=new.company_id
                       and information_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end
                       and type='Text block chat'::information_type
                       and is_deleted=false) then
      raise exception 'attachment Logic Gate chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='project_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from project_projection_table
                     where company_id=new.company_id
                       and information_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end
                       and type='Text block chat'::information_type) then
      raise exception 'attachment Project chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from email_messages where company_id=new.company_id
                     and email_message_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment email message owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_draft' then
    if not exists(select 1 from email_drafts where company_id=new.company_id
                  and draft_id=new.resource_id and deleted_timestamp is null) then
      raise exception 'attachment email draft owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_signature' then
    if not exists(select 1 from email_signatures where company_id=new.company_id
                  and signature_id=new.resource_id) then
      raise exception 'attachment email signature owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='shared_inbox' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from shared_inboxes where company_id=new.company_id
                     and shared_inbox_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment shared inbox owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='company_explorer_folder' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from company_explorer_folders where company_id=new.company_id
                     and folder_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment company folder owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='shared_inbox_folder' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from shared_inbox_folders where company_id=new.company_id
                     and folder_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment shared inbox folder owner does not exist' using errcode='23503';
    end if;
  else
    raise exception 'unsupported attachment owner type' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attachment_relationships_validate_live_owner
  on attachment_relationships;
create trigger trg_attachment_relationships_validate_live_owner
before insert or update of company_id,attachment_id,resource_type,resource_id,deleted_timestamp
on attachment_relationships for each row
execute function mangorts_validate_attachment_relationship_owner();
-- END INLINED ADDITIVE EXPANSION

lock table attachment_relationships,attachment_upload_jobs,attachment_previews in share row exclusive mode;

create or replace function pg_temp.attachment_step1_assert_columns(
  expected_table text,expected_columns text[]
) returns void language plpgsql as $$
declare actual_columns text[];
begin
  select array_agg(column_name order by ordinal_position) into actual_columns
  from information_schema.columns
  where table_schema=current_schema() and table_name=expected_table;
  if actual_columns is distinct from expected_columns then
    raise exception 'Attachment Step 1 column drift for %: expected %, found %',
      expected_table,expected_columns,actual_columns;
  end if;
end $$;

create or replace function pg_temp.attachment_step1_query_unescape(value text)
returns text language plpgsql immutable strict as $$
declare i integer:=1; decoded bytea:=''::bytea; ch text;
begin
  while i<=char_length(value) loop
    ch:=substr(value,i,1);
    if ch='+' then decoded:=decoded||convert_to(' ','UTF8'); i:=i+1;
    elsif ch='%' then
      if i+2>char_length(value)
         or substr(value,i+1,2)!~'^[0-9A-Fa-f]{2}$' then
        raise exception 'invalid URL escape in legacy attachment resource ID';
      end if;
      decoded:=decoded||decode(substr(value,i+1,2),'hex'); i:=i+3;
    else
      decoded:=decoded||convert_to(ch,'UTF8'); i:=i+1;
    end if;
  end loop;
  return btrim(convert_from(decoded,'UTF8'));
end $$;

select pg_temp.attachment_step1_assert_columns('attachments',array[
  'attachment_id','company_id','uploaded_by_user_id','original_filename',
  'mime_type','byte_size','sha256','sha256_verification_method',
  'storage_checksum_algorithm','storage_checksum_value','storage_checksum_type',
  'storage_bucket','storage_key','original_width','original_height','source_kind',
  'source_provider','created_timestamp','deleted_timestamp'
]);
select pg_temp.attachment_step1_assert_columns('resource_attachments',array[
  'resource_attachment_id','company_id','resource_type','resource_id',
  'attachment_id','information_id','message_id','editor_surface',
  'relationship_kind','created_by_user_id','created_timestamp','deleted_timestamp'
]);
select pg_temp.attachment_step1_assert_columns('attachment_relationships',array[
  'attachment_relationship_id','company_id','resource_type','resource_id',
  'attachment_id','information_id','message_id','editor_surface',
  'relationship_kind','created_by_user_id','created_timestamp','deleted_timestamp'
]);
select pg_temp.attachment_step1_assert_columns('attachment_upload_intents',array[
  'upload_intent_id','company_id','actor_user_id','client_request_id',
  'attachment_id','resource_attachment_id','original_filename','mime_type',
  'size_bytes','sha256','sha256_verification_method','storage_checksum_algorithm',
  'storage_checksum_value','storage_checksum_type','resource_type','resource_id',
  'information_id','message_id','editor_surface','relationship_kind','source_kind',
  'source_provider','original_width','original_height','storage_bucket','storage_key',
  'multipart_upload_id','strategy','part_size_bytes','part_count','status',
  'failure_code','version','created_timestamp','updated_timestamp',
  'expires_timestamp','completed_timestamp'
]);
select pg_temp.attachment_step1_assert_columns('attachment_upload_jobs',array[
  'upload_job_id','company_id','actor_user_id','client_request_id',
  'attachment_id','attachment_relationship_id','original_filename','mime_type',
  'size_bytes','sha256','sha256_verification_method','storage_checksum_algorithm',
  'storage_checksum_value','storage_checksum_type','resource_type','resource_id',
  'information_id','message_id','editor_surface','relationship_kind','source_kind',
  'source_provider','original_width','original_height','storage_bucket','storage_key',
  'multipart_upload_id','strategy','part_size_bytes','part_count','status',
  'failure_code','version','created_timestamp','updated_timestamp',
  'expires_timestamp','completed_timestamp'
]);
select pg_temp.attachment_step1_assert_columns('attachment_upload_parts',array[
  'upload_intent_id','part_number','expected_size_bytes','observed_size_bytes',
  'checksum_algorithm','expected_checksum','etag','s3_checksum',
  'signing_attempt_count','last_signed_timestamp','uploaded_timestamp',
  'created_timestamp','updated_timestamp'
]);
select pg_temp.attachment_step1_assert_columns('attachment_variants',array[
  'attachment_id','variant_type','mime_type','byte_size','sha256',
  'generation_version','width','height','storage_bucket','storage_key',
  'created_timestamp','updated_timestamp'
]);
select pg_temp.attachment_step1_assert_columns('attachment_previews',array[
  'attachment_id','preview_type','mime_type','byte_size','sha256',
  'generation_version','width','height','storage_bucket','storage_key',
  'created_timestamp','updated_timestamp'
]);
select pg_temp.attachment_step1_assert_columns('attachment_migration_runs',array[
  'migration_run_id','company_id','status','dry_run','started_by_user_id',
  'source_scope','summary','started_timestamp','completed_timestamp'
]);
select pg_temp.attachment_step1_assert_columns('attachment_migration_items',array[
  'migration_item_id','migration_run_id','company_id','source_table','source_pk',
  'resource_type','resource_id','information_id','message_id','attachment_id',
  'embedded_sha256','status','error','created_timestamp','updated_timestamp'
]);

-- PostgreSQL 18 renders constraint/index/trigger definitions deterministically.
-- These signatures cover every non-NOT-NULL constraint and every index on each
-- final destination, plus both pending-delete safety triggers. A same-named but
-- drifted object therefore stops before any data copy or deletion.
do $$
declare expected record; actual_count bigint; actual_signature text;
begin
  if current_setting('server_version_num')::integer not between 180000 and 189999 then
    raise exception 'Attachment Step 1 schema signatures require PostgreSQL 18';
  end if;
  for expected in select * from (values
    ('attachment_relationships'::text,7::bigint,'7a3a3c941bceeddbdf403f11a8ec968d'::text),
    ('attachment_upload_jobs',22,'784483d957e0cdbf314f750e53de0ec6'),
    ('attachment_previews',11,'df38b998cbd4af99c872d007409f2ebb')
  ) value(table_name,expected_count,expected_signature) loop
    select count(*),md5(string_agg(
      constraint_row.conname||chr(31)||pg_get_constraintdef(constraint_row.oid,true),
      chr(30) order by constraint_row.conname))
    into actual_count,actual_signature
    from pg_constraint constraint_row
    where constraint_row.conrelid=expected.table_name::regclass
      and constraint_row.contype<>'n';
    if actual_count is distinct from expected.expected_count
       or actual_signature is distinct from expected.expected_signature then
      raise exception 'Attachment Step 1 constraint drift for %',expected.table_name;
    end if;
  end loop;
  for expected in select * from (values
    ('attachment_relationships'::text,4::bigint,'fbe1a90de89f2aa587b63cde2156c1e0'::text),
    ('attachment_upload_jobs',8,'81413f873b79550e2e95ecb874748b16'),
    ('attachment_previews',2,'cc6d5c0430ac3de810b0f39b78c10d0a')
  ) value(table_name,expected_count,expected_signature) loop
    select count(*),md5(string_agg(
      index_row.indexrelid::regclass::text||chr(31)||
        pg_get_indexdef(index_row.indexrelid,0,true),
      chr(30) order by index_row.indexrelid::regclass::text))
    into actual_count,actual_signature
    from pg_index index_row
    where index_row.indrelid=expected.table_name::regclass;
    if actual_count is distinct from expected.expected_count
       or actual_signature is distinct from expected.expected_signature then
      raise exception 'Attachment Step 1 index drift for %',expected.table_name;
    end if;
  end loop;
  for expected in select * from (values
    ('resource_attachments'::text,1::bigint,'1cd4fd35462e419a3740c0ec6d6bff1a'::text),
    ('attachment_relationships',1,'c6e6c72db4aca78a620fbce754dd6b74')
  ) value(table_name,expected_count,expected_signature) loop
    select count(*),md5(string_agg(
      trigger_row.tgname||chr(31)||pg_get_triggerdef(trigger_row.oid,true),
      chr(30) order by trigger_row.tgname))
    into actual_count,actual_signature
    from pg_trigger trigger_row
    where trigger_row.tgrelid=expected.table_name::regclass
      and not trigger_row.tgisinternal;
    if actual_count is distinct from expected.expected_count
       or actual_signature is distinct from expected.expected_signature then
      raise exception 'Attachment Step 1 trigger drift for %',expected.table_name;
    end if;
  end loop;
end $$;

do $$
begin
  if not exists(select 1 from pg_constraint
    where conrelid='attachment_upload_parts'::regclass and contype='f'
      and pg_get_constraintdef(oid) like
        '%(upload_intent_id) REFERENCES attachment_upload_intents(upload_intent_id)%')
  then
    raise exception 'Step 1 requires attachment_upload_parts to remain on the legacy FK until Step 2';
  end if;
  if to_regclass('idx_attachment_upload_jobs_expiry') is null
     or to_regclass('idx_attachment_upload_jobs_status_expiry') is null
     or to_regclass('idx_attachment_upload_jobs_resource') is null
     or to_regclass('idx_attachment_upload_jobs_actor') is null
  then
    raise exception 'attachment_upload_jobs indexes are incomplete';
  end if;
  if not exists(select 1 from pg_constraint
    where conrelid='attachment_previews'::regclass
      and conname='attachment_previews_type_chk'
      and pg_get_constraintdef(oid) like '%display%'
      and pg_get_constraintdef(oid) like '%thumbnail%')
  then
    raise exception 'attachment_previews type constraint is missing';
  end if;
end $$;

create temp table attachment_step1_desired (
  attachment_relationship_id uuid not null,
  company_id uuid not null,
  resource_type text not null,
  resource_id text not null,
  attachment_id uuid not null,
  information_id uuid,
  message_id text not null,
  editor_surface text not null,
  relationship_kind text not null,
  created_by_user_id uuid,
  created_timestamp timestamptz not null,
  deleted_timestamp timestamptz
) on commit drop;

insert into attachment_step1_desired
select r.resource_attachment_id,r.company_id,r.resource_type,r.resource_id,
       r.attachment_id,r.information_id,r.message_id,r.editor_surface,
       r.relationship_kind,r.created_by_user_id,r.created_timestamp,
       r.deleted_timestamp
from resource_attachments r
where r.resource_type not in('email_message','email_draft','email_signature','attached_email')
  and not (r.resource_type='node'
    and r.relationship_kind in('email_attachment','email_inline_attachment')
    and btrim(r.message_id)<>'');

insert into attachment_step1_desired
select r.resource_attachment_id,r.company_id,'email_draft',
       pg_temp.attachment_step1_query_unescape(parts[array_length(parts,1)]),
       r.attachment_id,null,'','',r.relationship_kind,r.created_by_user_id,
       r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
where r.resource_type='email_draft'
  and ((parts[1]='personal' and array_length(parts,1) in(3,4))
    or (parts[1] in('shared','collaboration') and array_length(parts,1)=3))
  and exists(select 1 from email_drafts d where d.company_id=r.company_id
    and d.draft_id=pg_temp.attachment_step1_query_unescape(
      parts[array_length(parts,1)]));

insert into attachment_step1_desired
select r.resource_attachment_id,r.company_id,'email_signature',
       signature.signature_id,r.attachment_id,null,'','',r.relationship_kind,
       r.created_by_user_id,r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
join email_signatures signature on signature.company_id=r.company_id and (
  (parts[1]='personal' and array_length(parts,1)=3
    and signature.email_account_type='personal_email_account'
    and signature.personal_user_id::text=
      pg_temp.attachment_step1_query_unescape(parts[2])
    and signature.personal_account_email=lower(
      pg_temp.attachment_step1_query_unescape(parts[3])))
  or
  (parts[1]='shared' and array_length(parts,1)=2
    and signature.email_account_type='shared_email_account'
    and signature.shared_inbox_id::text=
      pg_temp.attachment_step1_query_unescape(parts[2]))
)
where r.resource_type='email_signature';

insert into attachment_step1_desired
select r.resource_attachment_id,r.company_id,'email_message',
       resolved.email_message_id::text,r.attachment_id,null,'','',
       r.relationship_kind,r.created_by_user_id,r.created_timestamp,
       r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
cross join lateral (
  select count(distinct m.email_message_id) n,
         min(m.email_message_id::text)::uuid email_message_id
  from email_messages m
  join email_threads t on t.company_id=m.company_id
    and t.email_thread_id=m.email_thread_id
  where m.company_id=r.company_id
    and m.provider_message_id=
      pg_temp.attachment_step1_query_unescape(parts[3])
    and ((parts[1]='personal' and array_length(parts,1)=3
      and t.email_account_type='personal_email_account'
      and t.personal_user_id::text=
        pg_temp.attachment_step1_query_unescape(parts[2]))
      or (parts[1]='shared' and array_length(parts,1)=3
      and t.email_account_type='shared_email_account'
      and t.shared_inbox_id::text=
        pg_temp.attachment_step1_query_unescape(parts[2])))
) resolved
where r.resource_type='email_message' and resolved.n=1;
insert into attachment_step1_desired
select r.resource_attachment_id,r.company_id,'email_message',
       resolved.email_message_id::text,r.attachment_id,null,'','',
       r.relationship_kind,r.created_by_user_id,r.created_timestamp,
       r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
cross join lateral (
  select count(distinct rel.email_message_id) n,
         min(rel.email_message_id::text)::uuid email_message_id
  from email_relationships rel
  join email_messages m on m.company_id=rel.company_id
    and m.email_message_id=rel.email_message_id
  where rel.company_id=r.company_id and rel.resource_type='node'
    and rel.resource_id::text=
      pg_temp.attachment_step1_query_unescape(parts[2])
    and m.provider_message_id=
      pg_temp.attachment_step1_query_unescape(parts[4])
) resolved
where r.resource_type='attached_email' and array_length(parts,1)=4
  and parts[1]='node' and parts[3]='message' and resolved.n=1;

insert into attachment_step1_desired
select r.resource_attachment_id,r.company_id,'email_message',
       resolved.email_message_id::text,r.attachment_id,null,'','',
       r.relationship_kind,r.created_by_user_id,r.created_timestamp,
       r.deleted_timestamp
from resource_attachments r
cross join lateral (
  select count(distinct rel.email_message_id) n,
         min(rel.email_message_id::text)::uuid email_message_id
  from email_relationships rel
  join email_messages m on m.company_id=rel.company_id
    and m.email_message_id=rel.email_message_id
  where rel.company_id=r.company_id and rel.resource_type='node'
    and rel.resource_id::text=r.resource_id
    and m.provider_message_id=r.message_id
) resolved
where r.resource_type='node'
  and r.relationship_kind in('email_attachment','email_inline_attachment')
  and btrim(r.message_id)<>'' and resolved.n=1;

create temp table attachment_step1_broken_live on commit drop as
with unresolved as (
  select r.*,string_to_array(r.resource_id,':') parts
  from resource_attachments r
  left join attachment_step1_desired d
    on d.attachment_relationship_id=r.resource_attachment_id
  where d.attachment_relationship_id is null
),classified as (
  select u.*,case
    when u.resource_type='email_draft'
      and ((parts[1]='personal' and array_length(parts,1) in(3,4))
        or (parts[1] in('shared','collaboration')
          and array_length(parts,1)=3))
    then (select count(*) from email_drafts d
      where d.company_id=u.company_id
        and d.draft_id=pg_temp.attachment_step1_query_unescape(
          parts[array_length(parts,1)]))
    when u.resource_type='email_signature'
      and ((parts[1]='personal' and array_length(parts,1)=3)
        or (parts[1]='shared' and array_length(parts,1)=2))
    then (select count(*) from email_signatures signature
      where signature.company_id=u.company_id and (
        (parts[1]='personal'
          and signature.email_account_type='personal_email_account'
          and signature.personal_user_id::text=
            pg_temp.attachment_step1_query_unescape(parts[2])
          and signature.personal_account_email=lower(
            pg_temp.attachment_step1_query_unescape(parts[3])))
        or
        (parts[1]='shared'
          and signature.email_account_type='shared_email_account'
          and signature.shared_inbox_id::text=
            pg_temp.attachment_step1_query_unescape(parts[2]))))
    when u.resource_type='email_message'
      and parts[1] in('personal','shared') and array_length(parts,1)=3
    then (select count(distinct m.email_message_id)
      from email_messages m join email_threads t
        on t.company_id=m.company_id and t.email_thread_id=m.email_thread_id
      where m.company_id=u.company_id
        and m.provider_message_id=
          pg_temp.attachment_step1_query_unescape(parts[3])
        and ((parts[1]='personal'
          and t.email_account_type='personal_email_account'
          and t.personal_user_id::text=
            pg_temp.attachment_step1_query_unescape(parts[2]))
          or (parts[1]='shared'
          and t.email_account_type='shared_email_account'
          and t.shared_inbox_id::text=
            pg_temp.attachment_step1_query_unescape(parts[2]))))
    when u.resource_type='attached_email' and array_length(parts,1)=4
      and parts[1]='node' and parts[3]='message'
    then (select count(distinct rel.email_message_id)
      from email_relationships rel
      join email_messages m on m.company_id=rel.company_id
        and m.email_message_id=rel.email_message_id
      where rel.company_id=u.company_id and rel.resource_type='node'
        and rel.resource_id::text=
          pg_temp.attachment_step1_query_unescape(parts[2])
        and m.provider_message_id=
          pg_temp.attachment_step1_query_unescape(parts[4]))
    when u.resource_type='node'
      and u.relationship_kind in('email_attachment','email_inline_attachment')
      and btrim(u.message_id)<>''
    then (select count(distinct rel.email_message_id)
      from email_relationships rel
      join email_messages m on m.company_id=rel.company_id
        and m.email_message_id=rel.email_message_id
      where rel.company_id=u.company_id and rel.resource_type='node'
        and rel.resource_id::text=u.resource_id
        and m.provider_message_id=u.message_id)
    else -1 end resolution_count
  from unresolved u
)
select classified.resource_attachment_id,classified.company_id,
       classified.attachment_id,classified.resource_type,
       classified.relationship_kind,md5(to_jsonb(source)::text) source_checksum
from classified
join resource_attachments source
  on source.resource_attachment_id=classified.resource_attachment_id
where classified.resolution_count=0;

create temp table attachment_step1_approved_evidence on commit drop as
select distinct item.company_id,item.source_key::uuid resource_attachment_id,
       item.target_key::uuid attachment_id,item.source_checksum
from v3_email_migration_items item
where item.source_table='resource_attachments'
  and item.disposition='retained_orphan_evidence'
  and pg_input_is_valid(item.source_key,'uuid')
  and pg_input_is_valid(item.target_key,'uuid');

do $$
begin
  if exists(select 1 from attachment_step1_desired
    group by attachment_relationship_id having count(*)<>1) then
    raise exception 'legacy attachment relationship mapped more than once';
  end if;
  if (select count(*) from attachment_step1_desired)
      +(select count(*) from attachment_step1_broken_live)
      <>(select count(*) from resource_attachments) then
    raise exception 'legacy attachment relationship is malformed or ambiguous';
  end if;
  if exists(select 1 from v3_email_migration_runs)
     and (select count(*) from attachment_step1_approved_evidence)<>213 then
    raise exception 'approved broken relationship identity set is not exactly 213';
  end if;
  if not exists(select 1 from v3_email_migration_runs)
     and exists(select 1 from attachment_step1_approved_evidence) then
    raise exception 'clean database unexpectedly contains approved deletion evidence';
  end if;
  if exists(
    select 1 from attachment_step1_broken_live broken
    where not exists(
      select 1 from attachment_step1_approved_evidence evidence
      where evidence.company_id=broken.company_id
        and evidence.resource_attachment_id=broken.resource_attachment_id
        and evidence.attachment_id=broken.attachment_id
        and evidence.source_checksum=broken.source_checksum
    )
  ) then
    raise exception 'live broken relationship does not exactly match approved evidence';
  end if;
  if exists(
    select 1 from attachment_step1_approved_evidence evidence
    join resource_attachments source
      on source.resource_attachment_id=evidence.resource_attachment_id
    where not exists(
      select 1 from attachment_step1_broken_live broken
      where broken.company_id=evidence.company_id
        and broken.resource_attachment_id=evidence.resource_attachment_id
        and broken.attachment_id=evidence.attachment_id
        and broken.source_checksum=evidence.source_checksum
    )
  ) then
    raise exception 'approved identity now resolves differently or has drifted';
  end if;
  if exists(select 1 from attachment_upload_intents
    where status in('pending','uploading','completing','failed')) then
    raise exception 'unexpected unfinished attachment upload job';
  end if;
  if exists(select 1 from attachment_upload_parts part
    where not exists(select 1 from attachment_upload_intents intent
      where intent.upload_intent_id=part.upload_intent_id)) then
    raise exception 'multipart part has no legacy upload intent';
  end if;
end $$;

do $$
begin
  if exists(
    select 1
    from attachment_relationships target
    join attachment_step1_desired desired
      on desired.attachment_relationship_id=target.attachment_relationship_id
    where row(target.company_id,target.resource_type,target.resource_id,
              target.attachment_id,target.information_id,target.message_id,
              target.editor_surface,target.relationship_kind,
              target.created_by_user_id,target.created_timestamp,
              target.deleted_timestamp)
      is distinct from
          row(desired.company_id,desired.resource_type,desired.resource_id,
              desired.attachment_id,desired.information_id,desired.message_id,
              desired.editor_surface,desired.relationship_kind,
              desired.created_by_user_id,desired.created_timestamp,
              desired.deleted_timestamp)
  ) then
    raise exception 'conflicting existing attachment_relationships target';
  end if;
  if exists(
    select 1 from attachment_relationships target
    left join attachment_step1_desired desired
      on desired.attachment_relationship_id=target.attachment_relationship_id
    where desired.attachment_relationship_id is null
  ) then
    raise exception 'attachment_relationships contains an unexpected target row';
  end if;
end $$;

insert into attachment_relationships(
  attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,
  information_id,message_id,editor_surface,relationship_kind,created_by_user_id,
  created_timestamp,deleted_timestamp
)
select attachment_relationship_id,company_id,resource_type,resource_id,
       attachment_id,information_id,message_id,editor_surface,relationship_kind,
       created_by_user_id,created_timestamp,deleted_timestamp
from attachment_step1_desired
on conflict(attachment_relationship_id) do nothing;

create temp table attachment_step1_invalid_owners on commit drop as
select d.attachment_relationship_id
from attachment_step1_desired d
where d.deleted_timestamp is null and not (
  case
    when d.resource_type='node' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from nodes n where n.company_id=d.company_id
        and n.node_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='logic_gate' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from logic_gates g where g.company_id=d.company_id
        and g.logic_gate_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='project' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from projects p where p.company_id=d.company_id
        and p.project_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='node_chat_message' then
      pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from node_textbox_chats chat
        where chat.company_id=d.company_id
          and chat.chat_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end and chat.deleted_timestamp is null)
    when d.resource_type='logic_gate_chat_message' then
      pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from logic_gate_projection_table projection
        where projection.company_id=d.company_id
          and projection.information_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end
          and projection.type='Text block chat'::information_type
          and projection.is_deleted=false)
    when d.resource_type='project_chat_message' then
      pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from project_projection_table projection
        where projection.company_id=d.company_id
          and projection.information_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end
          and projection.type='Text block chat'::information_type)
    when d.resource_type='email_message' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from email_messages m where m.company_id=d.company_id
        and m.email_message_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='email_draft' then exists(select 1 from email_drafts draft
      where draft.company_id=d.company_id and draft.draft_id=d.resource_id
        and draft.deleted_timestamp is null)
    when d.resource_type='email_signature' then exists(select 1 from email_signatures signature
      where signature.company_id=d.company_id and signature.signature_id=d.resource_id)
    when d.resource_type='shared_inbox' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from shared_inboxes inbox where inbox.company_id=d.company_id
        and inbox.shared_inbox_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='company_explorer_folder' then
      pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from company_explorer_folders folder
        where folder.company_id=d.company_id
          and folder.folder_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end)
    when d.resource_type='shared_inbox_folder' then
      pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from shared_inbox_folders folder
        where folder.company_id=d.company_id
          and folder.folder_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end)
    else false end
);

do $$
begin
  if exists(select 1 from attachment_step1_invalid_owners) then
    raise exception 'retained attachment relationship has no live exact owner';
  end if;
end $$;
insert into attachment_upload_jobs(
  upload_job_id,company_id,actor_user_id,client_request_id,attachment_id,
  attachment_relationship_id,original_filename,mime_type,size_bytes,sha256,
  sha256_verification_method,storage_checksum_algorithm,storage_checksum_value,
  storage_checksum_type,resource_type,resource_id,information_id,message_id,
  editor_surface,relationship_kind,source_kind,source_provider,original_width,
  original_height,storage_bucket,storage_key,multipart_upload_id,strategy,
  part_size_bytes,part_count,status,failure_code,version,created_timestamp,
  updated_timestamp,expires_timestamp,completed_timestamp
)
select upload_intent_id,company_id,actor_user_id,client_request_id,attachment_id,
       resource_attachment_id,original_filename,mime_type,size_bytes,sha256,
       sha256_verification_method,storage_checksum_algorithm,
       storage_checksum_value,storage_checksum_type,resource_type,resource_id,
       information_id,message_id,editor_surface,relationship_kind,source_kind,
       source_provider,original_width,original_height,storage_bucket,storage_key,
       multipart_upload_id,strategy,part_size_bytes,part_count,status,failure_code,
       version,created_timestamp,updated_timestamp,expires_timestamp,
       completed_timestamp
from attachment_upload_intents
on conflict(upload_job_id) do nothing;

insert into attachment_previews(
  attachment_id,preview_type,mime_type,byte_size,sha256,generation_version,
  width,height,storage_bucket,storage_key,created_timestamp,updated_timestamp
)
select attachment_id,variant_type,mime_type,byte_size,sha256,generation_version,
       width,height,storage_bucket,storage_key,created_timestamp,updated_timestamp
from attachment_variants
where variant_type in('display','thumbnail')
on conflict(attachment_id,preview_type) do nothing;

do $$
begin
  if exists(
    select 1 from attachment_upload_jobs target
    full join attachment_upload_intents source
      on source.upload_intent_id=target.upload_job_id
    where source.upload_intent_id is null or target.upload_job_id is null
      or row(target.company_id,target.actor_user_id,target.client_request_id,
             target.attachment_id,target.attachment_relationship_id,
             target.original_filename,target.mime_type,target.size_bytes,
             target.sha256,target.sha256_verification_method,
             target.storage_checksum_algorithm,target.storage_checksum_value,
             target.storage_checksum_type,target.resource_type,target.resource_id,
             target.information_id,target.message_id,target.editor_surface,
             target.relationship_kind,target.source_kind,target.source_provider,
             target.original_width,target.original_height,target.storage_bucket,
             target.storage_key,target.multipart_upload_id,target.strategy,
             target.part_size_bytes,target.part_count,target.status,
             target.failure_code,target.version,target.created_timestamp,
             target.updated_timestamp,target.expires_timestamp,
             target.completed_timestamp)
        is distinct from
           row(source.company_id,source.actor_user_id,source.client_request_id,
             source.attachment_id,source.resource_attachment_id,
             source.original_filename,source.mime_type,source.size_bytes,
             source.sha256,source.sha256_verification_method,
             source.storage_checksum_algorithm,source.storage_checksum_value,
             source.storage_checksum_type,source.resource_type,source.resource_id,
             source.information_id,source.message_id,source.editor_surface,
             source.relationship_kind,source.source_kind,source.source_provider,
             source.original_width,source.original_height,source.storage_bucket,
             source.storage_key,source.multipart_upload_id,source.strategy,
             source.part_size_bytes,source.part_count,source.status,
             source.failure_code,source.version,source.created_timestamp,
             source.updated_timestamp,source.expires_timestamp,
             source.completed_timestamp)
  ) then
    raise exception 'attachment_upload_jobs copy conflict or count mismatch';
  end if;
  if exists(
    select 1 from attachment_previews target
    full join (
      select * from attachment_variants
      where variant_type in('display','thumbnail')
    ) source
      on source.attachment_id=target.attachment_id
      and source.variant_type=target.preview_type
    where source.attachment_id is null or target.attachment_id is null
      or row(target.mime_type,target.byte_size,target.sha256,
             target.generation_version,target.width,target.height,
             target.storage_bucket,target.storage_key,target.created_timestamp,
             target.updated_timestamp)
        is distinct from
           row(source.mime_type,source.byte_size,source.sha256,
             source.generation_version,source.width,source.height,
             source.storage_bucket,source.storage_key,source.created_timestamp,
             source.updated_timestamp)
  ) then
    raise exception 'attachment_previews copy conflict or count mismatch';
  end if;
  if exists(
    select 1 from attachment_relationships target
    full join attachment_step1_desired desired
      on desired.attachment_relationship_id=target.attachment_relationship_id
    where desired.attachment_relationship_id is null
       or target.attachment_relationship_id is null
       or row(target.company_id,target.resource_type,target.resource_id,
              target.attachment_id,target.information_id,target.message_id,
              target.editor_surface,target.relationship_kind,
              target.created_by_user_id,target.created_timestamp,
              target.deleted_timestamp)
         is distinct from
            row(desired.company_id,desired.resource_type,desired.resource_id,
              desired.attachment_id,desired.information_id,desired.message_id,
              desired.editor_surface,desired.relationship_kind,
              desired.created_by_user_id,desired.created_timestamp,
              desired.deleted_timestamp)
  ) then
    raise exception 'attachment_relationships final reconciliation failed';
  end if;
  if exists(
    select 1 from attachment_upload_parts part
    where not exists(select 1 from attachment_upload_jobs job
      where job.upload_job_id=part.upload_intent_id)
  ) then
    raise exception 'multipart part has no exact copied upload job';
  end if;
end $$;

delete from resource_attachments source
using attachment_step1_broken_live approved
where source.resource_attachment_id=approved.resource_attachment_id
  and source.company_id=approved.company_id
  and source.attachment_id=approved.attachment_id
  and md5(to_jsonb(source)::text)=approved.source_checksum;

update attachments attachment
set deleted_timestamp=coalesce(attachment.deleted_timestamp,clock_timestamp())
where not exists(
  select 1 from attachment_relationships relationship
  where relationship.company_id=attachment.company_id
    and relationship.attachment_id=attachment.attachment_id
    and relationship.deleted_timestamp is null
);

do $$
begin
  if exists(
    select 1 from resource_attachments source
    join attachment_step1_approved_evidence evidence
      on evidence.company_id=source.company_id
      and evidence.resource_attachment_id=source.resource_attachment_id
  ) then
    raise exception 'approved broken legacy relationship remains after exact delete';
  end if;
  if exists(
    select 1 from attachments attachment
    where attachment.deleted_timestamp is null
      and not exists(select 1 from attachment_relationships relationship
        where relationship.company_id=attachment.company_id
          and relationship.attachment_id=attachment.attachment_id
          and relationship.deleted_timestamp is null)
  ) then
    raise exception 'zero-owner attachment was not marked pending deletion';
  end if;
  if exists(
    select 1 from attachments attachment
    where attachment.deleted_timestamp is not null
      and exists(select 1 from attachment_relationships relationship
        where relationship.company_id=attachment.company_id
          and relationship.attachment_id=attachment.attachment_id
          and relationship.deleted_timestamp is null)
  ) then
    raise exception 'pending-deletion attachment still has a live relationship';
  end if;
end $$;

select 'retained_attachment_relationships' metric,count(*)::bigint value
from attachment_relationships
union all
select 'copied_upload_jobs',count(*) from attachment_upload_jobs
union all
select 'multipart_parts_preserved',count(*) from attachment_upload_parts
union all
select 'copied_display_thumbnail_previews',count(*) from attachment_previews
union all
select 'approved_broken_relationships_proven',
       count(*) from attachment_step1_approved_evidence
union all
select 'attachments_pending_s3_cleanup',count(*) from attachments
  where deleted_timestamp is not null
union all
select 'email_send_rows_pending_cleanup',count(*) from attachment_variants
  where variant_type='email_send'
union all
select 'READY_FOR_GUARDED_S3_CLEANUP',null::bigint
order by metric;

commit;