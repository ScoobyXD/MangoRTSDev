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
