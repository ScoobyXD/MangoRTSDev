alter table attachments
  add column if not exists sha256_verification_method text not null default 'server_stream',
  add column if not exists storage_checksum_algorithm text not null default '',
  add column if not exists storage_checksum_value text not null default '',
  add column if not exists storage_checksum_type text not null default '';

alter table resource_attachments drop constraint if exists resource_attachments_type_chk;
alter table resource_attachments add constraint resource_attachments_type_chk check (
  resource_type in (
    'node', 'logic_gate', 'project', 'node_chat_message', 'logic_gate_chat_message',
    'project_chat_message', 'email_message', 'email_draft', 'email_signature',
    'attached_email', 'shared_inbox', 'company_explorer_folder', 'shared_inbox_folder'
  )
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attachments_sha256_verification_method_chk'
  ) then
    alter table attachments add constraint attachments_sha256_verification_method_chk
      check (sha256_verification_method in ('s3_full', 'server_stream', 'client_reported'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'attachments_sha256_format_chk'
  ) then
    alter table attachments add constraint attachments_sha256_format_chk
      check (sha256 ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'attachments_storage_checksum_provenance_chk'
  ) then
    alter table attachments add constraint attachments_storage_checksum_provenance_chk check (
      storage_checksum_algorithm in ('', 'SHA256')
      and storage_checksum_type in ('', 'FULL_OBJECT', 'COMPOSITE')
      and ((storage_checksum_algorithm = '') = (storage_checksum_value = ''))
      and ((storage_checksum_algorithm = '') = (storage_checksum_type = ''))
    );
  end if;
end $$;

create table if not exists attachment_upload_intents (
  upload_intent_id uuid primary key,
  company_id uuid not null,
  actor_user_id uuid not null,
  client_request_id text not null,
  attachment_id uuid not null,
  resource_attachment_id uuid,
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
  constraint attachment_upload_intents_client_request_nonblank_chk check (btrim(client_request_id) <> ''),
  constraint attachment_upload_intents_filename_nonblank_chk check (btrim(original_filename) <> ''),
  constraint attachment_upload_intents_mime_nonblank_chk check (btrim(mime_type) <> ''),
  constraint attachment_upload_intents_size_chk check (size_bytes >= 0),
  constraint attachment_upload_intents_sha256_chk check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint attachment_upload_intents_sha256_method_chk check (sha256_verification_method in ('s3_full', 'server_stream', 'client_reported')),
  constraint attachment_upload_intents_storage_checksum_provenance_chk check (
    storage_checksum_algorithm in ('', 'SHA256')
    and storage_checksum_type in ('', 'FULL_OBJECT', 'COMPOSITE')
    and ((storage_checksum_algorithm = '') = (storage_checksum_value = ''))
    and ((storage_checksum_algorithm = '') = (storage_checksum_type = ''))
  ),
  constraint attachment_upload_intents_resource_nonblank_chk check (btrim(resource_type) <> '' and btrim(resource_id) <> ''),
  constraint attachment_upload_intents_resource_type_chk check (resource_type in (
    'node', 'logic_gate', 'project', 'node_chat_message', 'logic_gate_chat_message', 'project_chat_message',
    'email_message', 'email_draft', 'email_signature', 'attached_email', 'shared_inbox',
    'company_explorer_folder', 'shared_inbox_folder'
  )),
  constraint attachment_upload_intents_relationship_chk check (relationship_kind in (
    'inline_image', 'file_attachment', 'chat_attachment', 'email_attachment',
    'email_inline_attachment', 'migrated_inline_image'
  )),
  constraint attachment_upload_intents_source_chk check (source_kind in (
    'user_upload', 'editor_paste', 'chat_upload', 'email_incoming', 'email_outgoing', 'migration_inline_image'
  )),
  constraint attachment_upload_intents_storage_nonblank_chk check (btrim(storage_bucket) <> '' and btrim(storage_key) <> ''),
  constraint attachment_upload_intents_strategy_chk check (
    (strategy = 'single' and size_bytes <= 67108864 and multipart_upload_id = '' and part_size_bytes = 0 and part_count = 0)
    or (strategy = 'multipart' and size_bytes > 67108864 and btrim(multipart_upload_id) <> ''
      and part_size_bytes = 16777216 and part_count = ((size_bytes + 16777215) / 16777216)::integer
      and part_count between 1 and 10000)
  ),
  constraint attachment_upload_intents_status_chk check (status in ('pending', 'uploading', 'completing', 'completed', 'failed', 'aborted', 'expired')),
  constraint attachment_upload_intents_completed_timestamp_chk check (
    (status = 'completed' and completed_timestamp is not null)
    or (status <> 'completed' and completed_timestamp is null)
  ),
  constraint attachment_upload_intents_dimensions_chk check (
    (original_width is null or original_width > 0) and (original_height is null or original_height > 0)
  ),
  unique (company_id, actor_user_id, client_request_id),
  unique (attachment_id),
  unique (storage_bucket, storage_key),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (actor_user_id) references users(user_id) on delete cascade
);

create index if not exists idx_attachment_upload_intents_expiry
  on attachment_upload_intents(expires_timestamp, upload_intent_id)
  where status in ('pending', 'uploading', 'completing', 'failed');

create index if not exists idx_attachment_upload_intents_status_expiry
  on attachment_upload_intents(status, expires_timestamp);

create index if not exists idx_attachment_upload_intents_resource
  on attachment_upload_intents(company_id, resource_type, resource_id);

create index if not exists idx_attachment_upload_intents_actor
  on attachment_upload_intents(company_id, actor_user_id, updated_timestamp desc);

create table if not exists attachment_upload_parts (
  upload_intent_id uuid not null,
  part_number integer not null,
  expected_size_bytes bigint not null,
  observed_size_bytes bigint not null default 0,
  checksum_algorithm text not null,
  expected_checksum text not null,
  etag text not null default '',
  s3_checksum text not null default '',
  signing_attempt_count integer not null default 0,
  last_signed_timestamp timestamptz,
  uploaded_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint attachment_upload_parts_number_chk check (part_number between 1 and 10000),
  constraint attachment_upload_parts_size_chk check (expected_size_bytes > 0 and observed_size_bytes >= 0),
  constraint attachment_upload_parts_algorithm_chk check (checksum_algorithm = 'SHA256'),
  constraint attachment_upload_parts_checksum_nonblank_chk check (btrim(expected_checksum) <> ''),
  constraint attachment_upload_parts_signing_attempt_chk check (signing_attempt_count >= 0),
  primary key (upload_intent_id, part_number),
  foreign key (upload_intent_id) references attachment_upload_intents(upload_intent_id) on delete cascade
);
