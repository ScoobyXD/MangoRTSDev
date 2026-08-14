-- Canonical Aurora PostgreSQL schema for MVP.

create extension if not exists pg_trgm;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'node_relationship_position') then
    create type node_relationship_position as enum ('Parent', 'Child', 'Peer');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'logic_gate_relationship_position') then
    create type logic_gate_relationship_position as enum ('Input', 'Output');
  end if;
end $$;

create table if not exists users (
  user_id uuid not null,
  cognito_subject text not null,
  email text not null default '',
  display_name text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint users_cognito_subject_nonblank_chk check (btrim(cognito_subject) <> ''),
  constraint users_display_name_nonblank_chk check (btrim(display_name) <> ''),
  constraint users_email_lowercase_chk check (email = lower(btrim(email))),
  primary key (user_id),
  unique (cognito_subject)
);

create table if not exists companies (
  company_id uuid not null,
  name text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint companies_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id)
);

create table if not exists company_memberships (
  company_id uuid not null,
  user_id uuid not null,
  role text not null default 'member',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
    constraint company_memberships_role_chk check (role in ('dev_admin', 'company_admin', 'company_manager', 'company_user')),
  primary key (company_id, user_id),
  constraint company_memberships_company_id_fkey foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_company_memberships_user_company
  on company_memberships(user_id, company_id);

create table if not exists company_user_groups (
  company_id uuid not null,
  group_id uuid not null,
  parent_group_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_user_groups_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, group_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, parent_group_id) references company_user_groups (company_id, group_id) on delete cascade
);

create index if not exists idx_company_user_groups_parent_position
  on company_user_groups(company_id, parent_group_id, position, group_id);

create table if not exists company_user_group_members (
  company_id uuid not null,
  group_id uuid not null,
  user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, group_id, user_id),
  foreign key (company_id, group_id) references company_user_groups (company_id, group_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_company_user_group_members_user
  on company_user_group_members(company_id, user_id, group_id);

create table if not exists saved_views (
  company_id uuid not null,
  saved_view_id uuid not null,
  surface text not null,
  principal text not null,
  principal_id uuid not null,
  name text not null,
  groupings jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint saved_views_surface_chk check (surface in ('updates', 'logic_gate_kanban')),
  constraint saved_views_principal_chk check (principal in ('user', 'group')),
  constraint saved_views_name_nonblank_chk check (btrim(name) <> ''),
  constraint saved_views_groupings_array_chk check (jsonb_typeof(groupings) = 'array'),
  constraint saved_views_settings_object_chk check (jsonb_typeof(settings) = 'object'),
  primary key (company_id, saved_view_id),
  foreign key (company_id) references companies(company_id) on delete cascade
);

create index if not exists idx_saved_views_surface_principal_position
  on saved_views(company_id, surface, principal, principal_id, position, saved_view_id);

create unique index if not exists idx_saved_views_logic_gate_kanban_user_single
  on saved_views(company_id, surface, principal, principal_id)
  where surface = 'logic_gate_kanban' and principal = 'user';

create index if not exists idx_saved_views_group_principal
  on saved_views(company_id, principal_id)
  where principal = 'group';

create table if not exists pin_folders (
  folder_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint pin_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint pin_folders_not_self_parent_chk check (parent_folder_id is distinct from folder_id),
  primary key (folder_id),
  unique (company_id, user_id, folder_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, user_id, parent_folder_id) references pin_folders(company_id, user_id, folder_id) on delete cascade
);

create index if not exists idx_pin_folders_owner_parent_position
  on pin_folders(company_id, user_id, parent_folder_id, position, created_timestamp, folder_id);

create table if not exists pins (
  pin_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
  parent_folder_id uuid,
  resource_type text not null,
  resource_id uuid not null,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  constraint pins_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project')),
  constraint pins_name_nonblank_chk check (btrim(name) <> ''),
  primary key (pin_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, user_id, parent_folder_id) references pin_folders(company_id, user_id, folder_id) on delete cascade,
  unique (company_id, user_id, resource_type, resource_id)
);

create index if not exists idx_pins_owner_parent_position
  on pins(company_id, user_id, parent_folder_id, position, created_timestamp, pin_id);

create table if not exists company_user_group_closure (
  company_id uuid not null,
  ancestor_group_id uuid not null,
  descendant_group_id uuid not null,
  depth integer not null,
  primary key (company_id, ancestor_group_id, descendant_group_id),
  foreign key (company_id, ancestor_group_id) references company_user_groups (company_id, group_id) on delete cascade,
  foreign key (company_id, descendant_group_id) references company_user_groups (company_id, group_id) on delete cascade
);

create table if not exists invitations (
  invitation_id uuid not null,
  company_id uuid not null,
  email text not null,
  role text not null,
  token_hash text not null,
  status text not null default 'pending',
  invited_by_user_id uuid not null,
  accepted_by_user_id uuid,
  cognito_status text not null default 'not_started',
  cognito_error text not null default '',
  invite_email_status text not null default 'not_started',
  invite_email_error text not null default '',
  invite_email_sent_timestamp timestamptz,
  expires_timestamp timestamptz not null,
  accepted_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint invitations_email_nonblank_chk check (btrim(email) <> ''),
  constraint invitations_email_lowercase_chk check (email = lower(btrim(email))),
  constraint invitations_token_hash_nonblank_chk check (btrim(token_hash) <> ''),
    constraint invitations_role_chk check (role in ('company_admin', 'company_manager', 'company_user')),
  constraint invitations_status_chk check (status in ('pending', 'accepted', 'revoked')),
  constraint invitations_cognito_status_chk check (cognito_status in ('not_started', 'not_configured', 'created', 'resent', 'existing_mango_user', 'failed')),
  constraint invitations_invite_email_status_chk check (invite_email_status in ('not_started', 'not_configured', 'sent', 'failed')),
  primary key (invitation_id),
  unique (token_hash),
  constraint invitations_company_id_fkey foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (invited_by_user_id) references users (user_id),
  foreign key (accepted_by_user_id) references users (user_id)
);

create index if not exists idx_invitations_company_email_status
  on invitations(company_id, email, status, created_timestamp desc);

create unique index if not exists idx_invitations_one_pending_company_email
  on invitations(company_id, email)
  where status = 'pending';

create index if not exists idx_invitations_company_status_updated
  on invitations(company_id, status, updated_timestamp desc);

create table if not exists email_connections (
  email_connection_id uuid not null,
  company_id uuid not null,
  connection_type text not null,
  personal_user_id uuid,
  provider text not null,
  account_email text not null,
  grant_id text not null,
  status text not null default 'connected',
  connected_by_user_id uuid,
  ingestion_started_at timestamptz not null default now(),
  last_successful_scan_at timestamptz not null default now(),
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint email_connections_type_chk check (connection_type in ('personal', 'shared')),
  constraint email_connections_scope_chk check (
    (connection_type='personal' and personal_user_id is not null)
    or (connection_type='shared' and personal_user_id is null)
  ),
  constraint email_connections_provider_chk check (provider in ('google', 'microsoft')),
  constraint email_connections_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  constraint email_connections_grant_id_nonblank_chk check (btrim(grant_id) <> ''),
  constraint email_connections_status_chk check (status in ('connected', 'disconnected', 'reauth_required', 'configuration_required')),
  constraint email_connections_checkpoint_chk check (last_successful_scan_at >= ingestion_started_at),
  primary key (email_connection_id),
  unique (company_id, email_connection_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (personal_user_id) references users(user_id) on delete cascade,
  foreign key (connected_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_email_connections_grant_id
  on email_connections(grant_id);
create unique index if not exists idx_email_connections_personal
  on email_connections(company_id,personal_user_id,account_email)
  where connection_type='personal';
create unique index if not exists idx_email_connections_shared
  on email_connections(company_id,account_email)
  where connection_type='shared';
create index if not exists idx_email_connections_company_status
  on email_connections(company_id,status,last_successful_scan_at);

create table if not exists communications_message_read_receipt_summaries (
  receipt_scope_type varchar not null,
  receipt_scope_id varchar not null,
  user_id uuid references users(user_id) on delete cascade,
  company_id uuid references companies(company_id) on delete cascade,
  company_email_connection_id uuid references email_connections(email_connection_id) on delete cascade,
  shared_inbox_id uuid,
  message_id text not null,
  thread_id text not null default '',
  status text not null default 'likely_read',
  signal_count integer not null default 0,
  first_signal_timestamp timestamptz not null,
  last_signal_timestamp timestamptz not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (receipt_scope_type, receipt_scope_id, message_id),
  constraint communications_message_read_receipt_summaries_scope_chk check (receipt_scope_type in ('personal', 'shared')),
  constraint communications_message_read_receipt_summaries_message_id_chk check (btrim(message_id) <> ''),
  constraint communications_message_read_receipt_summaries_status_chk check (status in ('likely_read', 'read')),
  constraint communications_message_read_receipt_summaries_signal_count_chk check (signal_count >= 0),
  constraint communications_message_read_receipt_summaries_personal_chk check (
    (
      receipt_scope_type = 'personal'
      and user_id is not null
      and company_email_connection_id is null
      and receipt_scope_id like user_id::text || ':%'
      and length(receipt_scope_id) > length(user_id::text) + 1
    )
    or (
      receipt_scope_type = 'shared'
      and company_id is not null
      and company_email_connection_id is not null
    )
  )
);

create table if not exists communications_message_read_receipt_signals (
  receipt_scope_type varchar not null,
  receipt_scope_id varchar not null,
  message_id text not null,
  signal_timestamp timestamptz not null,
  created_timestamp timestamptz not null default now(),
  primary key (receipt_scope_type, receipt_scope_id, message_id, signal_timestamp),
  foreign key (receipt_scope_type, receipt_scope_id, message_id)
    references communications_message_read_receipt_summaries(receipt_scope_type, receipt_scope_id, message_id) on delete cascade
);

insert into communications_message_read_receipt_signals (receipt_scope_type, receipt_scope_id, message_id, signal_timestamp)
select receipt_scope_type, receipt_scope_id, message_id, last_signal_timestamp from communications_message_read_receipt_summaries on conflict do nothing;

create index if not exists idx_communications_message_read_receipt_summaries_user_latest
  on communications_message_read_receipt_summaries(user_id, last_signal_timestamp desc)
  where receipt_scope_type = 'personal';

create index if not exists idx_communications_message_read_receipt_summaries_shared_latest
  on communications_message_read_receipt_summaries(company_email_connection_id, last_signal_timestamp desc)
  where receipt_scope_type = 'shared';

create index if not exists idx_communications_message_read_receipt_summaries_thread
  on communications_message_read_receipt_summaries(receipt_scope_type, receipt_scope_id, thread_id)
  where thread_id <> '';

create table if not exists auth_external_identity_deletions (
  provider text not null,
  external_subject text not null,
  user_id uuid,
  email text not null default '',
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  completed_timestamp timestamptz,
  primary key (provider, external_subject),
  constraint auth_external_identity_deletions_provider_chk check (provider in ('cognito')),
  constraint auth_external_identity_deletions_subject_nonblank_chk check (btrim(external_subject) <> ''),
  constraint auth_external_identity_deletions_status_chk check (status in ('pending', 'completed')),
  constraint auth_external_identity_deletions_attempts_chk check (attempts >= 0)
);

create index if not exists idx_auth_external_identity_deletions_pending
  on auth_external_identity_deletions(updated_timestamp) where status = 'pending';

create table if not exists communications_triage_items (
  user_id uuid not null,
  message_id text not null,
  message jsonb not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_triage_items_message_id_nonblank_chk check (btrim(message_id) <> ''),
  primary key (user_id, message_id),
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_communications_triage_items_user_created
  on communications_triage_items(user_id, created_timestamp desc, message_id);

create table if not exists attachments (
  attachment_id uuid not null,
  company_id uuid not null,
  uploaded_by_user_id uuid,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null,
  sha256 text not null,
  sha256_verification_method text not null default 'server_stream',
  storage_checksum_algorithm text not null default '',
  storage_checksum_value text not null default '',
  storage_checksum_type text not null default '',
  storage_bucket text not null,
  storage_key text not null,
  original_width integer,
  original_height integer,
  source_kind text not null,
  source_provider text not null default '',
  created_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  constraint attachments_filename_nonblank_chk check (btrim(original_filename) <> ''),
  constraint attachments_mime_type_nonblank_chk check (btrim(mime_type) <> ''),
  constraint attachments_byte_size_chk check (byte_size >= 0),
  constraint attachments_sha256_nonblank_chk check (btrim(sha256) <> ''),
	constraint attachments_sha256_format_chk check (sha256 ~ '^[0-9a-f]{64}$'),
	constraint attachments_sha256_verification_method_chk check (sha256_verification_method in ('s3_full', 'server_stream', 'client_reported')),
	constraint attachments_storage_checksum_provenance_chk check (
	  storage_checksum_algorithm in ('', 'SHA256')
	  and storage_checksum_type in ('', 'FULL_OBJECT', 'COMPOSITE')
	  and ((storage_checksum_algorithm = '') = (storage_checksum_value = ''))
	  and ((storage_checksum_algorithm = '') = (storage_checksum_type = ''))
	),
  constraint attachments_storage_bucket_nonblank_chk check (btrim(storage_bucket) <> ''),
  constraint attachments_storage_key_nonblank_chk check (btrim(storage_key) <> ''),
  constraint attachments_dimensions_chk check (
    (original_width is null or original_width > 0)
    and (original_height is null or original_height > 0)
  ),
  constraint attachments_source_kind_chk check (
    source_kind in (
      'user_upload',
      'editor_paste',
      'chat_upload',
      'email_incoming',
      'email_outgoing',
      'migration_inline_image'
    )
  ),
  primary key (attachment_id),
  unique (company_id, attachment_id),
  unique (storage_bucket, storage_key),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (uploaded_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_attachments_company_created
  on attachments(company_id, created_timestamp desc, attachment_id);

create index if not exists idx_attachments_company_sha256
  on attachments(company_id, sha256);

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

create table if not exists attachment_upload_parts (
  upload_job_id uuid not null,
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
  primary key (upload_job_id, part_number),
  foreign key (upload_job_id) references attachment_upload_jobs(upload_job_id) on delete cascade
);

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

create table if not exists nodes (
  company_id uuid not null,
  node_id uuid not null,
  name text not null,
  status text,
  due_date date,
  priority smallint,
  default_access text not null default 'edit',
  created_timestamp timestamptz not null,
  constraint nodes_default_access_chk check (default_access in ('edit', 'no_access')),
  constraint nodes_priority_chk check (priority is null or priority between 1 and 5),
  primary key (company_id, node_id)
);

create index if not exists idx_nodes_name_trgm
  on nodes using gin (lower(name) gin_trgm_ops);

create table if not exists account_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint account_folders_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, folder_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_account_folders_parent_position
  on account_folders(company_id, parent_folder_id, position, lower(name), folder_id);

create table if not exists accounts (
  company_id uuid not null,
  account_id uuid not null,
  name text not null,
  folder_id uuid,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint accounts_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, account_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_accounts_company_name
  on accounts(company_id, lower(name), account_id);

create index if not exists idx_accounts_folder_position
  on accounts(company_id, folder_id, position, lower(name), account_id);

create table if not exists node_account_assignments (
  company_id uuid not null,
  node_id uuid not null,
  account_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, node_id, account_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, account_id) references accounts (company_id, account_id) on delete cascade
);

create index if not exists idx_node_account_assignments_account
  on node_account_assignments(company_id, account_id, node_id);

create table if not exists node_relationships (
  company_id uuid not null,
  node_relationship_id uuid not null,
  node_id_a uuid not null,
  node_id_b uuid not null,
  a_position node_relationship_position not null,
  b_position node_relationship_position not null,
  created_timestamp timestamptz not null,
  constraint node_relationships_position_pair_chk check (
    (a_position = 'Parent' and b_position = 'Child')
    or (a_position = 'Child' and b_position = 'Parent')
    or (a_position = 'Peer' and b_position = 'Peer')
  ),
  constraint node_relationships_not_self_chk check (node_id_a <> node_id_b),
  primary key (company_id, node_relationship_id),
  foreign key (company_id, node_id_a) references nodes (company_id, node_id),
  foreign key (company_id, node_id_b) references nodes (company_id, node_id)
);

create table if not exists node_timeline_events (
  company_id uuid not null,
  event_id uuid not null,
  node_id uuid not null,
  event_type text not null,
  actor_user_id uuid,
  actor_display_name text not null,
  from_logic_gate_id uuid,
  from_logic_gate_name text not null default '',
  to_logic_gate_id uuid,
  to_logic_gate_name text not null default '',
  project_id uuid,
  project_name text not null default '',
  idempotency_key text not null default '',
  created_timestamp timestamptz not null default now(),
  constraint node_timeline_events_type_chk check (event_type in ('logic_gate_transfer', 'project_assignment', 'verification_request')),
  constraint node_timeline_events_actor_name_chk check (btrim(actor_display_name) <> ''),
  constraint node_timeline_events_payload_chk check (
    (event_type='logic_gate_transfer' and from_logic_gate_id is not null and to_logic_gate_id is not null and from_logic_gate_id<>to_logic_gate_id and btrim(from_logic_gate_name)<>'' and btrim(to_logic_gate_name)<>'' and project_id is null and btrim(project_name)='')
    or (event_type='project_assignment' and from_logic_gate_id is null and btrim(from_logic_gate_name)='' and to_logic_gate_id is null and btrim(to_logic_gate_name)='' and project_id is not null and btrim(project_name)<>'')
    or (event_type='verification_request' and from_logic_gate_id is null and btrim(from_logic_gate_name)='' and to_logic_gate_id is null and btrim(to_logic_gate_name)='' and project_id is null and btrim(project_name)='')
  ),
  primary key (company_id, event_id),
  unique (company_id, node_id, event_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

create unique index if not exists idx_node_timeline_events_idempotency
  on node_timeline_events(company_id, node_id, event_type, idempotency_key)
  where btrim(idempotency_key)<>'';

create index if not exists idx_node_timeline_events_node_created
  on node_timeline_events(company_id, node_id, created_timestamp desc, event_id desc);

create table if not exists node_timeline_verification_recipients (
  company_id uuid not null,
  node_id uuid not null,
  event_id uuid not null,
  user_id uuid not null,
  user_display_name text not null,
  completed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  constraint node_timeline_verification_recipients_name_chk check (btrim(user_display_name)<>''),
  primary key (company_id, event_id, user_id),
  foreign key (company_id, node_id, event_id) references node_timeline_events(company_id, node_id, event_id) on delete cascade
);

create index if not exists idx_node_timeline_verification_recipient_user
  on node_timeline_verification_recipients(company_id, user_id, completed_timestamp, created_timestamp desc);

create table if not exists logic_gates (
  company_id uuid not null,
  logic_gate_id uuid not null,
  header text not null,
  default_access text not null default 'edit',
  created_timestamp timestamptz not null,
  constraint logic_gates_default_access_chk check (default_access in ('edit', 'no_access')),
  primary key (company_id, logic_gate_id)
);

create index if not exists idx_logic_gates_header_trgm
  on logic_gates using gin (lower(header) gin_trgm_ops);

create table if not exists projects (
  company_id uuid not null,
  project_id uuid not null,
  name text not null,
  status text not null default 'Active',
  health text not null default 'On Track',
  default_access text not null default 'edit',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint projects_name_nonblank_chk check (btrim(name) <> ''),
  constraint projects_status_nonblank_chk check (btrim(status) <> ''),
  constraint projects_health_chk check (health in ('On Track', 'AT RISK', 'Off Track')),
  constraint projects_default_access_chk check (default_access in ('edit', 'no_access')),
  primary key (company_id, project_id),
  foreign key (company_id) references companies(company_id) on delete cascade
);

create index if not exists idx_projects_company_name
  on projects(company_id, lower(name), project_id);

create index if not exists idx_projects_name_trgm
  on projects using gin (lower(name) gin_trgm_ops);

create table if not exists project_critical_path_steps (
  company_id uuid not null,
  project_id uuid not null,
  step_id uuid not null,
  name text not null default '',
  relationship_id uuid,
  due_date date,
  owner_type text not null default '',
  owner_id uuid,
  position integer not null default 0,
  is_current boolean not null default false,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_critical_path_owner_chk check (
    (owner_type = '' and owner_id is null)
    or (owner_type in ('user', 'group') and owner_id is not null)
  ),
  primary key (company_id, project_id, step_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_critical_path_project_position
  on project_critical_path_steps(company_id, project_id, position, step_id);

create unique index if not exists idx_project_critical_path_one_current
  on project_critical_path_steps(company_id, project_id)
  where is_current;

create table if not exists project_account_assignments (
  company_id uuid not null,
  project_id uuid not null,
  account_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, project_id, account_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (company_id, account_id) references accounts(company_id, account_id) on delete cascade
);

create index if not exists idx_project_account_assignments_account
  on project_account_assignments(company_id, account_id, project_id);

create table if not exists project_team_assignments (
  company_id uuid not null,
  project_id uuid not null,
  team_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, project_id, team_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (company_id, team_id) references company_user_groups(company_id, group_id) on delete cascade
);

create index if not exists idx_project_team_assignments_team
  on project_team_assignments(company_id, team_id, project_id);

create table if not exists entity_fields (
  company_id uuid not null,
  field_id uuid not null,
  name varchar(64) not null,
  color varchar(7) not null default '#6366f1',
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entity_fields_name_nonblank_chk check (btrim(name) <> ''),
  constraint entity_fields_color_chk check (color ~ '^#[0-9a-f]{6}$'),
  primary key (company_id, field_id),
  foreign key (company_id) references companies(company_id) on delete cascade
);

create unique index if not exists idx_entity_fields_company_name_unique
  on entity_fields(company_id, lower(btrim(name)));

create index if not exists idx_entity_fields_company_position
  on entity_fields(company_id, position, lower(name), field_id);

create table if not exists entity_field_assignments (
  company_id uuid not null,
  field_id uuid not null,
  resource_type text not null,
  project_id uuid,
  node_id uuid,
  logic_gate_id uuid,
  resource_id uuid generated always as (coalesce(project_id, node_id, logic_gate_id)) stored,
  created_timestamp timestamptz not null default now(),
  constraint entity_field_assignments_target_chk check (
    (resource_type='project' and project_id is not null and node_id is null and logic_gate_id is null)
    or (resource_type='node' and project_id is null and node_id is not null and logic_gate_id is null)
    or (resource_type='logic_gate' and project_id is null and node_id is null and logic_gate_id is not null)
  ),
  primary key (company_id, field_id, resource_type, resource_id),
  foreign key (company_id, field_id) references entity_fields(company_id, field_id) on delete cascade,
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_entity_field_assignments_resource
  on entity_field_assignments(company_id, resource_type, resource_id, field_id);

create index if not exists idx_entity_field_assignments_field
  on entity_field_assignments(company_id, field_id, resource_type, resource_id);

create table if not exists project_relationships (
  company_id uuid not null,
  relationship_id uuid not null,
  project_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_relationships_resource_type_chk check (resource_type in ('logic_gate', 'node')),
  primary key (company_id, relationship_id),
  unique (company_id, project_id, resource_type, resource_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_relationships_project_position
  on project_relationships(company_id, project_id, position, relationship_id);

create index if not exists idx_project_relationships_resource
  on project_relationships(company_id, resource_type, resource_id, project_id);
create unique index if not exists idx_project_relationships_one_project_per_node
  on project_relationships(company_id, resource_id)
  where resource_type='node';

create table if not exists project_relationship_projection (
  company_id uuid not null,
  project_id uuid not null,
  relationship_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  logic_gate_id uuid,
  node_id uuid,
  assignment_id uuid,
  display_title text not null,
  status text,
  created_from_email boolean not null default false,
  position integer not null default 0,
  resource_created_timestamp timestamptz not null,
  relationship_created_timestamp timestamptz not null,
  relationship_updated_timestamp timestamptz not null,
  projection_updated_timestamp timestamptz not null default now(),
  constraint project_relationship_projection_resource_type_chk check (resource_type in ('logic_gate', 'node')),
  constraint project_relationship_projection_title_chk check (btrim(display_title) <> ''),
  constraint project_relationship_projection_target_chk check (
    (resource_type='logic_gate' and logic_gate_id is not null and node_id is null and assignment_id is null and resource_id=logic_gate_id)
    or (resource_type='node' and node_id is not null and resource_id=node_id)
  ),
  primary key (company_id, relationship_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (company_id, relationship_id) references project_relationships(company_id, relationship_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade
);

create index if not exists idx_project_relationship_projection_project
  on project_relationship_projection(company_id, project_id, position, lower(display_title), relationship_id);

create index if not exists idx_project_relationship_projection_relationship
  on project_relationship_projection(company_id, relationship_id);

create index if not exists idx_project_relationship_projection_resource
  on project_relationship_projection(company_id, resource_type, resource_id);

create index if not exists idx_project_relationship_projection_node
  on project_relationship_projection(company_id, node_id);

create index if not exists idx_project_relationship_projection_logic_gate
  on project_relationship_projection(company_id, logic_gate_id);

create index if not exists idx_project_relationship_projection_assignment
  on project_relationship_projection(company_id, assignment_id);

create table if not exists project_management_timeline_items (
  company_id uuid not null,
  item_id uuid not null,
  user_id uuid not null,
  node_id uuid,
  logic_gate_id uuid,
  start_date date not null,
  duration_days smallint not null,
  position integer not null default 0,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, item_id),
  constraint project_management_timeline_item_target_chk check (
    (node_id is not null and logic_gate_id is null)
    or (node_id is null and logic_gate_id is not null)
  ),
  constraint project_management_timeline_duration_chk check (duration_days between 1 and 90),
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id)
);

create unique index if not exists idx_project_management_timeline_user_node
  on project_management_timeline_items(company_id, user_id, node_id)
  where node_id is not null;

create unique index if not exists idx_project_management_timeline_user_logic_gate
  on project_management_timeline_items(company_id, user_id, logic_gate_id)
  where logic_gate_id is not null;

create index if not exists idx_project_management_timeline_hot_read
  on project_management_timeline_items(company_id, user_id, start_date, position, item_id);

create table if not exists project_management_timeline_projection (
  company_id uuid not null,
  item_id uuid not null,
  user_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  node_id uuid,
  logic_gate_id uuid,
  display_title text not null,
  status text,
  due_date date,
  priority smallint,
  start_date date not null,
  end_date date not null,
  duration_days smallint not null,
  position integer not null default 0,
  resource_created_timestamp timestamptz not null,
  timeline_created_timestamp timestamptz not null,
  timeline_updated_timestamp timestamptz not null,
  projection_updated_timestamp timestamptz not null default now(),
  accounts jsonb not null default '[]'::jsonb,
  primary key (company_id, user_id, item_id),
  constraint project_management_timeline_projection_resource_type_chk check (resource_type in ('node', 'logic_gate')),
  constraint project_management_timeline_projection_title_chk check (btrim(display_title) <> ''),
  constraint project_management_timeline_projection_duration_chk check (duration_days between 1 and 90),
  constraint project_management_timeline_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array'),
  constraint project_management_timeline_projection_target_chk check (
    (resource_type='node' and node_id is not null and logic_gate_id is null and resource_id=node_id)
    or (resource_type='logic_gate' and logic_gate_id is not null and node_id is null and resource_id=logic_gate_id)
  ),
  foreign key (company_id, item_id) references project_management_timeline_items(company_id, item_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_project_management_timeline_projection_hot_read
  on project_management_timeline_projection(company_id, user_id, start_date, position, item_id);

create index if not exists idx_project_management_timeline_projection_node
  on project_management_timeline_projection(company_id, node_id);

create index if not exists idx_project_management_timeline_projection_logic_gate
  on project_management_timeline_projection(company_id, logic_gate_id);

create table if not exists resource_gvic_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  principal_type text not null,
  principal_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint resource_gvic_assignments_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder', 'shared_inbox')),
  constraint resource_gvic_assignments_role_chk check (role in ('generated', 'verified', 'consulted', 'informed')),
  constraint resource_gvic_assignments_principal_type_chk check (principal_type in ('user', 'group')),
  primary key (company_id, resource_type, resource_id, role, principal_type, principal_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_gvic_assignments_principal_role_resource
  on resource_gvic_assignments(company_id, principal_type, principal_id, role, resource_type, resource_id);

create index if not exists idx_resource_gvic_assignments_resource_role_principal
  on resource_gvic_assignments(company_id, resource_type, resource_id, role, principal_type, principal_id);

create unique index if not exists idx_resource_gvic_assignments_one_role_per_principal
  on resource_gvic_assignments(company_id, resource_type, resource_id, principal_type, principal_id)
  where resource_type in ('node', 'logic_gate');

create table if not exists resource_gvic_effective_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  user_id uuid not null,
  source_resource_type text not null,
  source_resource_id uuid not null,
  source_principal_type text not null,
  source_principal_id uuid not null,
  inheritance_type text not null,
  updated_timestamp timestamptz not null default now(),
  constraint resource_gvic_effective_assignments_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder', 'shared_inbox')),
  constraint resource_gvic_effective_assignments_role_chk check (role in ('generated', 'verified', 'consulted', 'informed')),
  constraint resource_gvic_effective_assignments_source_resource_type_chk check (source_resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder', 'shared_inbox')),
  constraint resource_gvic_effective_assignments_source_principal_type_chk check (source_principal_type in ('user', 'group')),
  constraint resource_gvic_effective_assignments_inheritance_type_chk check (inheritance_type in ('direct', 'logic_gate_inherited')),
  primary key (
    company_id,
    resource_type,
    resource_id,
    role,
    user_id,
    source_resource_type,
    source_resource_id,
    source_principal_type,
    source_principal_id,
    inheritance_type
  ),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_resource_gvic_effective_user_resource
  on resource_gvic_effective_assignments(company_id, user_id, resource_type, resource_id, role);

create index if not exists idx_resource_gvic_effective_resource_role_user
  on resource_gvic_effective_assignments(company_id, resource_type, resource_id, role, user_id);

create index if not exists idx_resource_gvic_effective_source
  on resource_gvic_effective_assignments(company_id, source_resource_type, source_resource_id);

create table if not exists resource_permissions (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  subject_type text not null default 'user',
  subject_id uuid not null,
  user_id uuid,
  access_level text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint resource_permissions_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox')),
  constraint resource_permissions_subject_type_chk check (subject_type in ('user', 'group')),
  constraint resource_permissions_access_level_chk check (access_level in ('no_access', 'edit')),
  constraint resource_permissions_user_subject_chk check ((subject_type = 'user' and user_id = subject_id) or (subject_type = 'group' and user_id is null)),
  primary key (company_id, resource_type, resource_id, subject_type, subject_id),
  constraint resource_access_company_id_fkey foreign key (company_id) references companies (company_id) on delete cascade,
  constraint resource_access_user_id_fkey foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_resource_permissions_user_resource
  on resource_permissions(company_id, user_id, resource_type, resource_id);

create index if not exists idx_resource_permissions_resource_user
  on resource_permissions(company_id, resource_type, resource_id, user_id);

create index if not exists idx_resource_permissions_subject_resource
  on resource_permissions(company_id, subject_type, subject_id, resource_type, resource_id);

create index if not exists idx_resource_permissions_resource_subject
  on resource_permissions(company_id, resource_type, resource_id, subject_type, subject_id);

create or replace function mangorts_access_level_rank(p_access_level text)
returns integer as $$
  select case lower(btrim(coalesce(p_access_level, '')))
    when 'no_access' then 0
    when 'edit' then 1
    else 0
  end;
$$ language sql immutable;
set check_function_bodies = off;
create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean as $$
  with recursive normalized_resource(resource_type) as (
    select case lower(btrim(coalesce(p_resource_type, '')))
      when 'shared_triage_folder' then 'shared_inbox_folder'
      when 'communications_folder' then 'shared_inbox_folder'
      else lower(btrim(coalesce(p_resource_type, '')))
    end
  ),
  requested(required_rank) as (
    select mangorts_access_level_rank(p_access_level)
  ),
  role_admin_actor(allowed) as (
    select exists (
      select 1
      from company_memberships membership
      where membership.user_id = p_user_id
        and (
          membership.role = 'dev_admin'
          or (membership.company_id = p_company_id and membership.role = 'company_admin')
        )
    )
  ),
  normalized_resource_row(default_access) as (
    select coalesce(node.default_access, 'edit')
    from nodes node, normalized_resource normalized
    where normalized.resource_type='node'
      and node.company_id=p_company_id
      and node.node_id=p_resource_id
    union all
    select coalesce(gate.default_access, 'edit')
    from logic_gates gate, normalized_resource normalized
    where normalized.resource_type='logic_gate'
      and gate.company_id=p_company_id
      and gate.logic_gate_id=p_resource_id
    union all
    select coalesce(project.default_access, 'edit')
    from projects project, normalized_resource normalized
    where normalized.resource_type='project'
      and project.company_id=p_company_id
      and project.project_id=p_resource_id
    union all
    select coalesce(folder.default_access, 'edit')
    from company_explorer_folders folder, normalized_resource normalized
    where normalized.resource_type='company_explorer_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
    union all
    select coalesce(folder.default_access, 'edit')
    from shared_inbox_folders folder, normalized_resource normalized
    where normalized.resource_type='shared_inbox_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
    union all
    select coalesce(inbox.default_access, 'edit')
    from shared_inboxes inbox, normalized_resource normalized
    where normalized.resource_type='shared_inbox'
      and inbox.company_id=p_company_id
      and inbox.shared_inbox_id=p_resource_id
  ),
  group_tree(company_id, ancestor_group_id, descendant_group_id, depth) as (
    select user_group.company_id,
           user_group.group_id,
           user_group.group_id,
           0
    from company_user_groups user_group
    where user_group.company_id=p_company_id
    union all
    select parent.company_id,
           parent.ancestor_group_id,
           child.group_id,
           parent.depth + 1
    from group_tree parent
    join company_user_groups child
      on child.company_id=parent.company_id
     and child.parent_group_id=parent.descendant_group_id
    where parent.depth < 100
  ),
  permission_access(access_level) as (
    select candidate.access_level
    from (
      select access.access_level, 0 as source_rank, 0 as group_depth, mangorts_access_level_rank(access.access_level) as access_rank
      from resource_permissions access
      join normalized_resource normalized
        on normalized.resource_type=access.resource_type
      where access.company_id=p_company_id
        and access.resource_id=p_resource_id
        and access.subject_type='user'
        and access.subject_id=p_user_id
      union all
      select access.access_level, 1 as source_rank, min(closure.depth) as group_depth, mangorts_access_level_rank(access.access_level) as access_rank
      from resource_permissions access
      join normalized_resource normalized
        on normalized.resource_type=access.resource_type
      join group_tree closure
        on closure.company_id=access.company_id
       and closure.ancestor_group_id=access.subject_id
      join company_user_group_members member
        on member.company_id=closure.company_id
       and member.group_id=closure.descendant_group_id
       and member.user_id=p_user_id
      where access.company_id=p_company_id
        and access.resource_id=p_resource_id
        and access.subject_type='group'
      group by access.access_level
      union all
      select default_access, 2 as source_rank, 0 as group_depth, mangorts_access_level_rank(default_access) as access_rank
      from normalized_resource_row
    ) candidate
    order by candidate.source_rank asc, candidate.group_depth asc, candidate.access_rank asc
    limit 1
  )
  select case
    when requested.required_rank = 0 then false
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false
    when (select allowed from role_admin_actor) then true
    when not exists (select 1 from permission_access) then false
    when (select mangorts_access_level_rank(access_level) from permission_access limit 1) = 0 then false
    when exists (
        select 1
        from company_memberships membership
        where membership.company_id = p_company_id
          and membership.user_id = p_user_id
      )
      and (select mangorts_access_level_rank(access_level) from permission_access limit 1) >= requested.required_rank then true
    else false
  end
  from requested, normalized_resource;
$$ language sql stable;
set check_function_bodies = on;

create table if not exists logic_gate_relationships (
  company_id uuid not null,
  logic_gate_relationship_id uuid not null,
  logic_gate_id_a uuid not null,
  logic_gate_id_b uuid not null,
  a_position logic_gate_relationship_position not null,
  b_position logic_gate_relationship_position not null,
  created_timestamp timestamptz not null,
  constraint logic_gate_relationships_position_pair_chk check (
    (a_position = 'Input' and b_position = 'Output')
    or (a_position = 'Output' and b_position = 'Input')
  ),
  constraint logic_gate_relationships_not_self_chk check (logic_gate_id_a <> logic_gate_id_b),
  primary key (company_id, logic_gate_relationship_id),
  foreign key (company_id, logic_gate_id_a) references logic_gates (company_id, logic_gate_id),
  foreign key (company_id, logic_gate_id_b) references logic_gates (company_id, logic_gate_id)
);

create table if not exists user_logic_gate_shortcuts (
  user_id uuid not null,
  company_id uuid not null,
  logic_gate_id uuid not null,
  position integer not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (user_id, company_id, logic_gate_id),
  foreign key (user_id) references users (user_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_user_logic_gate_shortcuts_user_company_position
  on user_logic_gate_shortcuts(user_id, company_id, position, logic_gate_id);

-- Source table for node-to-Logic-Gate work assignment.
-- Kanban board/card API shapes are synthesized from this source and kanban_board_projection.
create table if not exists node_logic_gate_assignments (
  assignment_id uuid not null,
  company_id uuid not null,
  node_id uuid not null,
  logic_gate_id uuid not null,
  status_key text not null,
  column_id text not null,
  is_issue boolean not null default false,
  position integer not null,
  compatibility_board_id text not null,
  compatibility_card_id uuid not null,
  requested_by_user_id uuid,
  placed_by_user_id uuid,
  version bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint node_logic_gate_assignments_status_key_chk check (btrim(status_key) <> ''),
  constraint node_logic_gate_assignments_version_positive_chk check (version > 0),
  primary key (company_id, assignment_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  constraint node_logic_gate_assignments_requested_by_user_id_fkey foreign key (company_id, requested_by_user_id) references company_memberships (company_id, user_id) on delete set null (requested_by_user_id),
  constraint node_logic_gate_assignments_placed_by_user_id_fkey foreign key (company_id, placed_by_user_id) references company_memberships (company_id, user_id) on delete set null (placed_by_user_id)
);

create unique index if not exists idx_node_logic_gate_assignments_one_active_node
  on node_logic_gate_assignments(company_id, node_id);

create index if not exists idx_node_logic_gate_assignments_logic_gate_position
  on node_logic_gate_assignments(company_id, logic_gate_id, column_id, position, updated_timestamp desc);

create unique index if not exists idx_node_logic_gate_assignments_compat_card
  on node_logic_gate_assignments(company_id, compatibility_board_id, compatibility_card_id);

-- Disposable Logic Gate Kanban read model. Source truth remains nodes,
-- logic_gates, node_logic_gate_assignments, and access/GVIC tables.
create table if not exists kanban_board_projection (
  company_id uuid not null,
  logic_gate_id uuid not null,
  node_id uuid not null,
  status text not null,
  status_rank smallint generated always as (
    case
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('requested', 'request', 'requests', 'r') then 0
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('backlog', 'backlogs', 'b') then 1
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('pending', 'p') then 2
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 3
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) = 'review' then 4
      when lower(replace(replace(btrim(status), '_', ' '), '-', ' ')) in ('done', 'd') then 5
      else 2
    end
  ) stored,
  column_id text not null,
  position integer not null,
  title text not null,
  priority smallint,
  is_issue boolean not null default false,
  due_date date,
  node_created_timestamp timestamptz not null,
  node_updated_timestamp timestamptz not null,
  assignment_id uuid not null,
  assignment_created_timestamp timestamptz not null,
  assignment_updated_timestamp timestamptz not null,
  compatibility_board_id text not null,
  compatibility_card_id uuid not null,
  requested_by_user_id uuid,
  placed_by_user_id uuid,
  accounts jsonb not null default '[]'::jsonb,
  projection_updated_timestamp timestamptz not null default now(),
  constraint kanban_board_projection_status_nonblank_chk check (btrim(status) <> ''),
  constraint kanban_board_projection_title_nonblank_chk check (btrim(title) <> ''),
  constraint kanban_board_projection_priority_chk check (priority is null or priority between 1 and 5),
  constraint kanban_board_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array'),
  primary key (company_id, logic_gate_id, node_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

insert into kanban_board_projection (
  company_id,
  logic_gate_id,
  node_id,
  status,
  column_id,
  position,
  title,
  priority,
  is_issue,
  due_date,
  node_created_timestamp,
  node_updated_timestamp,
  assignment_id,
  assignment_created_timestamp,
  assignment_updated_timestamp,
  compatibility_board_id,
  compatibility_card_id,
  requested_by_user_id,
  placed_by_user_id,
  accounts,
  projection_updated_timestamp
)
select
  assignment.company_id,
  assignment.logic_gate_id,
  assignment.node_id,
  assignment.status_key,
  assignment.column_id,
  assignment.position,
  node_row.name,
  node_row.priority,
  assignment.is_issue,
  node_row.due_date,
  node_row.created_timestamp,
  greatest(node_row.created_timestamp, assignment.updated_timestamp),
  assignment.assignment_id,
  assignment.created_timestamp,
  assignment.updated_timestamp,
  assignment.compatibility_board_id,
  assignment.compatibility_card_id,
  assignment.requested_by_user_id,
  assignment.placed_by_user_id,
  coalesce(account_snapshot.accounts_json, '[]'::jsonb),
  now()
from node_logic_gate_assignments assignment
join nodes node_row
  on node_row.company_id = assignment.company_id
 and node_row.node_id = assignment.node_id
join logic_gates logic_gate
  on logic_gate.company_id = assignment.company_id
 and logic_gate.logic_gate_id = assignment.logic_gate_id
left join lateral (
  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', account.company_id::text,
    'account_id', account.account_id::text,
    'name', account.name,
    'folder_id', account.folder_id::text,
    'position', account.position,
    'created_timestamp', account.created_timestamp,
    'updated_timestamp', account.updated_timestamp
  ) order by account.position asc, lower(account.name) asc, account.account_id::text asc), '[]'::jsonb) as accounts_json
  from node_account_assignments node_account
  join accounts account
    on account.company_id=node_account.company_id
   and account.account_id=node_account.account_id
  where node_account.company_id=assignment.company_id
    and node_account.node_id=assignment.node_id
) account_snapshot on true
on conflict (company_id, logic_gate_id, node_id)
do update set
  status = excluded.status,
  column_id = excluded.column_id,
  position = excluded.position,
  title = excluded.title,
  priority = excluded.priority,
  is_issue = excluded.is_issue,
  due_date = excluded.due_date,
  node_created_timestamp = excluded.node_created_timestamp,
  node_updated_timestamp = excluded.node_updated_timestamp,
  assignment_id = excluded.assignment_id,
  assignment_created_timestamp = excluded.assignment_created_timestamp,
  assignment_updated_timestamp = excluded.assignment_updated_timestamp,
  compatibility_board_id = excluded.compatibility_board_id,
  compatibility_card_id = excluded.compatibility_card_id,
  requested_by_user_id = excluded.requested_by_user_id,
  placed_by_user_id = excluded.placed_by_user_id,
  accounts = excluded.accounts,
  projection_updated_timestamp = now();


create table if not exists logic_gate_work_versions (
  company_id uuid not null,
  logic_gate_id uuid not null,
  board_id text generated always as ('logic-gate:' || logic_gate_id::text) stored,
  version bigint not null default 1,
  updated_timestamp timestamptz not null default now(),
  constraint logic_gate_work_versions_version_positive_chk check (version > 0),
  primary key (company_id, logic_gate_id),
  constraint logic_gate_work_versions_board_key unique (company_id, board_id),
  constraint logic_gate_work_versions_logic_gate_fkey
    foreign key (company_id, logic_gate_id)
    references logic_gates(company_id, logic_gate_id) on delete cascade
);

insert into logic_gate_work_versions (company_id, logic_gate_id)
select company_id, logic_gate_id from logic_gates
on conflict (company_id, logic_gate_id) do nothing;

create index if not exists idx_node_relationships_a on node_relationships(company_id, node_id_a);
create index if not exists idx_node_relationships_b on node_relationships(company_id, node_id_b);
create index if not exists idx_logic_gate_relationships_a on logic_gate_relationships(company_id, logic_gate_id_a);
create index if not exists idx_logic_gate_relationships_b on logic_gate_relationships(company_id, logic_gate_id_b);
create index if not exists idx_kanban_board_projection_hot_read
  on kanban_board_projection(
    company_id, logic_gate_id, status_rank, position,
    assignment_created_timestamp, assignment_id
  );
create index if not exists idx_kanban_board_projection_node
  on kanban_board_projection(company_id, node_id);
create index if not exists idx_kanban_board_projection_updated
  on kanban_board_projection(company_id, logic_gate_id, projection_updated_timestamp desc, node_id);

create table if not exists company_explorer_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  default_access text not null default 'edit',
  position integer not null default 1000,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_explorer_folders_default_access_chk check (default_access in ('edit', 'no_access')),
  constraint company_explorer_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint company_explorer_folders_parent_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id),
  primary key (company_id, folder_id),
  foreign key (company_id, parent_folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade,
  foreign key (created_by_user_id) references users (user_id) on delete set null
);

create index if not exists idx_company_explorer_folders_parent_position
  on company_explorer_folders(company_id, parent_folder_id, position, created_timestamp, folder_id);

create table if not exists shared_inbox_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  default_access text not null default 'edit',
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint shared_inbox_folders_default_access_chk check (default_access in ('edit', 'no_access')),
  constraint shared_inbox_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint shared_inbox_folders_parent_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id),
  primary key (company_id, folder_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, parent_folder_id) references shared_inbox_folders (company_id, folder_id) on delete cascade
);

create index if not exists idx_shared_inbox_folders_parent
  on shared_inbox_folders(company_id, parent_folder_id, position, created_timestamp);

create table if not exists shared_inboxes (
  company_id uuid not null,
  shared_inbox_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  account_email text not null,
  company_email_connection_id uuid,
  default_access text not null default 'edit',
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint shared_inboxes_default_access_chk check (default_access in ('edit', 'no_access')),
  constraint shared_inboxes_name_nonblank_chk check (btrim(name) <> ''),
  constraint shared_inboxes_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  primary key (company_id, shared_inbox_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, parent_folder_id) references shared_inbox_folders (company_id, folder_id),
  constraint shared_inboxes_company_email_connection_fkey foreign key (company_id, company_email_connection_id) references email_connections(company_id, email_connection_id)
);

create index if not exists idx_shared_inboxes_parent
  on shared_inboxes(company_id, parent_folder_id, position, created_timestamp);

create index if not exists idx_shared_inboxes_account_email
  on shared_inboxes(company_id, account_email);

create index if not exists idx_shared_inboxes_company_email_connection
  on shared_inboxes(company_id, company_email_connection_id);
create table if not exists communications_email_archive_jobs (
  archive_job_id uuid primary key,
  actor_user_id uuid not null references users(user_id) on delete cascade,
  company_id uuid references companies(company_id) on delete cascade,
  shared_inbox_id uuid,
  connection_scope text not null,
  provider text not null,
  account_email text not null,
  grant_id text not null,
  company_email_connection_id uuid,
  status text not null default 'pending',
  requested_count integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  completed_timestamp timestamptz,
  constraint communications_email_archive_jobs_scope_chk check (connection_scope in ('personal', 'shared')),
  constraint communications_email_archive_jobs_provider_chk check (provider in ('google', 'microsoft')),
  constraint communications_email_archive_jobs_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  constraint communications_email_archive_jobs_grant_id_chk check (btrim(grant_id) <> ''),
  constraint communications_email_archive_jobs_status_chk check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint communications_email_archive_jobs_shared_scope_chk check (
    (connection_scope = 'personal' and shared_inbox_id is null)
    or
    (connection_scope = 'shared' and company_id is not null and shared_inbox_id is not null)
  ),
  foreign key (company_id, shared_inbox_id) references shared_inboxes(company_id, shared_inbox_id) on delete cascade,
  foreign key (company_email_connection_id) references email_connections(email_connection_id) on delete set null
);

create index if not exists idx_communications_email_archive_jobs_actor_created
  on communications_email_archive_jobs(actor_user_id, created_timestamp desc);

create index if not exists idx_communications_email_archive_jobs_shared_inbox
  on communications_email_archive_jobs(company_id, shared_inbox_id, created_timestamp desc)
  where shared_inbox_id is not null;

create table if not exists communications_email_archive_job_items (
  job_item_id uuid primary key,
  archive_job_id uuid not null references communications_email_archive_jobs(archive_job_id) on delete cascade,
  message_id text not null,
  status text not null default 'pending',
	provider_attempt_count integer not null default 0,
	attempt_token uuid,
	last_error text not null default '',
  archived_timestamp timestamptz,
  failed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_archive_job_items_message_chk check (btrim(message_id) <> ''),
	constraint communications_email_archive_job_items_status_chk check (status in ('pending', 'processing', 'archived', 'failed')),
	constraint communications_email_archive_job_items_provider_attempt_chk check (provider_attempt_count between 0 and 3),
  unique (archive_job_id, message_id)
);

create index if not exists idx_communications_email_archive_job_items_job
  on communications_email_archive_job_items(archive_job_id, created_timestamp, job_item_id);

create table if not exists company_explorer_items (
  company_id uuid not null,
  item_id uuid not null,
  parent_folder_id uuid,
  target_type text not null,
  target_id uuid not null,
  position integer not null default 1000,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_explorer_items_target_type_chk check (target_type in ('project', 'logic_gate')),
  primary key (company_id, item_id),
  unique (company_id, target_type, target_id),
  foreign key (company_id, parent_folder_id) references company_explorer_folders(company_id, folder_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_company_explorer_items_parent_position
  on company_explorer_items(company_id, parent_folder_id, position, created_timestamp, item_id);

create index if not exists idx_company_explorer_items_target
  on company_explorer_items(company_id, target_type, target_id);

create or replace function mangorts_try_uuid(p_value text)
returns uuid as $$
begin
  return nullif(btrim(coalesce(p_value, '')), '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$$ language plpgsql immutable;

create or replace view company_explorer_final_backfill_verification as
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'manual_references_have_existing_targets'::text as check_name,
         (select count(*) from company_explorer_items)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_items item
           left join projects project
             on item.target_type='project'
            and project.company_id=item.company_id
            and project.project_id=item.target_id
           left join logic_gates logic_gate
             on item.target_type='logic_gate'
            and logic_gate.company_id=item.company_id
            and logic_gate.logic_gate_id=item.target_id
           where (item.target_type='project' and project.project_id is not null)
              or (item.target_type='logic_gate' and logic_gate.logic_gate_id is not null)
         )::bigint as actual_count
) check_row
union all
select check_name, expected_count, actual_count, expected_count = actual_count as ok
from (
  select 'folders_have_valid_parents'::text as check_name,
         (select count(*) from company_explorer_folders where parent_folder_id is not null)::bigint as expected_count,
         (
           select count(*)
           from company_explorer_folders child
           join company_explorer_folders parent
             on parent.company_id=child.company_id
            and parent.folder_id=child.parent_folder_id
           where child.parent_folder_id is not null
         )::bigint as actual_count
) check_row;
create table if not exists recycle_bin_items (
  company_id uuid not null,
  recycle_bin_item_id uuid not null,
  object_kind text not null,
  object_id text not null,
  object_label text not null,
  object_folder_kind text,
  restore_payload jsonb not null,
  deleted_by_user_id uuid,
  deleted_timestamp timestamptz not null default now(),
  constraint recycle_bin_items_kind_chk check (object_kind in ('folder', 'node', 'logic_gate', 'project', 'kanban')),
  constraint recycle_bin_items_object_id_nonblank_chk check (btrim(object_id) <> ''),
  constraint recycle_bin_items_object_label_nonblank_chk check (btrim(object_label) <> ''),
  constraint recycle_bin_items_folder_kind_chk check (
    object_folder_kind is null
    or object_folder_kind in ('node', 'logic_gate', 'project')
  ),
  primary key (company_id, recycle_bin_item_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (deleted_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_recycle_bin_items_company_deleted
  on recycle_bin_items(company_id, deleted_timestamp desc, recycle_bin_item_id desc);

create index if not exists idx_recycle_bin_items_company_user_deleted
  on recycle_bin_items(company_id, deleted_by_user_id, deleted_timestamp desc, recycle_bin_item_id desc)
  where deleted_by_user_id is not null;

-- Domain event outbox, notification outbox, and recipient feed.
create table if not exists domain_events (
  event_id uuid not null,
  company_id uuid not null,
  stream_type text not null,
  stream_id text not null,
  sequence bigint not null,
  event_type text not null,
  actor_user_id uuid,
  idempotency_key text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_timestamp timestamptz not null default now(),
  constraint domain_events_stream_type_nonblank_chk check (btrim(stream_type) <> ''),
  constraint domain_events_stream_id_nonblank_chk check (btrim(stream_id) <> ''),
  constraint domain_events_event_type_nonblank_chk check (btrim(event_type) <> ''),
  constraint domain_events_sequence_positive_chk check (sequence > 0),
  primary key (company_id, event_id),
  unique (company_id, stream_type, stream_id, sequence),
  foreign key (actor_user_id) references users (user_id) on delete set null
);

create unique index if not exists idx_domain_events_idempotency_key
  on domain_events(company_id, idempotency_key)
  where btrim(idempotency_key) <> '';

create index if not exists idx_domain_events_stream_sequence
  on domain_events(company_id, stream_type, stream_id, sequence);


create index if not exists idx_domain_events_company_created
  on domain_events(company_id, created_timestamp desc, event_id desc);


create table if not exists workspace_read_versions (
  company_id uuid not null,
  scope text not null,
  resource_key text not null default '',
  version bigint not null default 0,
  updated_timestamp timestamptz not null default now(),
  constraint workspace_read_versions_scope_nonblank_chk check (btrim(scope) <> ''),
  constraint workspace_read_versions_version_nonnegative_chk check (version >= 0),
  primary key (company_id, scope, resource_key)
);

create index if not exists idx_workspace_read_versions_scope_company
  on workspace_read_versions(scope, company_id, resource_key);

alter table logic_gate_relationships
  drop constraint if exists logic_gate_relationships_not_self_chk;
alter table logic_gate_relationships
  add constraint logic_gate_relationships_not_self_chk check (logic_gate_id_a <> logic_gate_id_b) not valid;

alter table logic_gate_relationships
  drop constraint if exists logic_gate_relationships_position_pair_chk;
alter table logic_gate_relationships
  add constraint logic_gate_relationships_position_pair_chk check (
    (a_position = 'Input'::logic_gate_relationship_position and b_position = 'Output'::logic_gate_relationship_position)
    or (a_position = 'Output'::logic_gate_relationship_position and b_position = 'Input'::logic_gate_relationship_position)
  ) not valid;

create or replace function workspace_static_read_version_keys()
returns table(scope text, resource_key text) as $$
  select *
  from (values
    ('workspace-snapshot:full', ''),
    ('workspace-snapshot:company_explorer', ''),
    ('workspace-snapshot:company_explorer', 'folder_kind:node'),
    ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
    ('workspace-snapshot:company_explorer', 'folder_kind:communications'),
    ('company-explorer-folder-items', ''),
    ('company-explorer-folder-items', 'item_type:node'),
    ('company-explorer-folder-items', 'item_type:logic_gate'),
    ('nodes', ''),
    ('node-relationships', ''),
    ('logic-gates', ''),
    ('logic-gate-relationships', ''),
    ('kanban-boards', '')
  ) as keys(scope, resource_key)
$$ language sql immutable;

create or replace function workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb)
returns table(scope text, resource_key text) as $$
declare
  board_id text := btrim(coalesce(p_payload->>'board_id', ''));
  folder_kind text := btrim(coalesce(p_payload->>'folder_kind', ''));
  item_type text := btrim(coalesce(p_payload->>'item_type', ''));
begin
  return query select v.scope, v.resource_key from (values
    ('workspace-snapshot:full', '')
  ) as v(scope, resource_key);

  if p_event_type = any(array[
    'node_created',
    'node_updated',
    'node_deleted',
    'kanban_card_upserted',
    'kanban_card_moved',
    'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved',
    'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed',
    'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted',
    'kanban_board_deleted',
    'node_permissions_updated'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('nodes', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:node')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['node_deleted', 'node_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('company-explorer-folder-items', ''),
      ('company-explorer-folder-items', 'item_type:node')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['relationship_created', 'relationship_deleted', 'node_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('node-relationships', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_created', 'logic_gate_updated', 'logic_gate_deleted', 'logic_gate_raci_updated', 'logic_gate_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gates', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_deleted', 'logic_gate_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('company-explorer-folder-items', ''),
      ('company-explorer-folder-items', 'item_type:logic_gate')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array[
    'project_created',
    'project_updated',
    'project_deleted',
    'project_information_created',
    'project_information_deleted',
    'project_relationship_upserted',
    'project_relationship_deleted',
    'project_permissions_updated'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('projects', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:project')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['project_deleted', 'project_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('company-explorer-folder-items', ''),
      ('company-explorer-folder-items', 'item_type:project')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_relationship_created', 'logic_gate_relationship_deleted', 'logic_gate_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gate-relationships', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array[
    'company_explorer_folder_created',
    'company_explorer_folder_updated',
    'company_explorer_folder_deleted',
    'communications_shared_inbox_raci_updated',
    'shared_triage_access_updated'
  ]::text[]) then
    if folder_kind = 'node' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif folder_kind = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:logic_gate')
      ) as v(scope, resource_key);
    elsif folder_kind = 'project' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:project'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:project')
      ) as v(scope, resource_key);
    elsif folder_kind = 'communications' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', 'folder_kind:communications')
      ) as v(scope, resource_key);
    end if;
  end if;

  if p_event_type = any(array['company_explorer_folder_item_assigned', 'company_explorer_folder_item_removed']::text[]) then
    if item_type = 'node' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif item_type = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:logic_gate')
      ) as v(scope, resource_key);
    elsif item_type = 'project' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:project'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:project')
      ) as v(scope, resource_key);
    end if;
  end if;

  if p_event_type = any(array['kanban_board_saved', 'kanban_board_updated', 'kanban_board_deleted', 'logic_gate_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-boards', '')
    ) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_column_created',
    'kanban_column_updated',
    'kanban_column_deleted',
    'kanban_board_deleted',
    'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-columns', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_card_upserted',
    'kanban_card_moved',
    'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved',
    'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed',
    'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted',
    'kanban_board_deleted',
    'node_deleted',
    'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-cards', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;
end;
$$ language plpgsql immutable;
create or replace function trg_update_workspace_read_versions()
returns trigger as $$
begin
  if new.stream_type <> 'workspace' or new.stream_id <> new.company_id::text then
    return new;
  end if;

  insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
  select new.company_id, key.scope, key.resource_key, 0, new.created_timestamp
  from workspace_static_read_version_keys() key
  on conflict (company_id, scope, resource_key) do nothing;

  insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
  select new.company_id, key.scope, key.resource_key, new.sequence, new.created_timestamp
  from (
    select distinct scope, resource_key
    from workspace_read_version_keys_for_domain_event(new.event_type, new.payload)
  ) key
  on conflict (company_id, scope, resource_key)
  do update set
    version = greatest(workspace_read_versions.version, excluded.version),
    updated_timestamp = greatest(workspace_read_versions.updated_timestamp, excluded.updated_timestamp);

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_update_workspace_read_versions on domain_events;
create trigger trg_update_workspace_read_versions
after insert on domain_events
for each row execute function trg_update_workspace_read_versions();

insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
select company.company_id, key.scope, key.resource_key, 0, now()
from companies company
cross join workspace_static_read_version_keys() key
on conflict (company_id, scope, resource_key) do nothing;

with version_events as (
  select
    event.company_id,
    key.scope,
    key.resource_key,
    max(event.sequence) as version,
    max(event.created_timestamp) as updated_timestamp
  from domain_events event
  cross join lateral (
    select distinct scope, resource_key
    from workspace_read_version_keys_for_domain_event(event.event_type, event.payload)
  ) key
  where event.stream_type = 'workspace'
    and event.stream_id = event.company_id::text
  group by event.company_id, key.scope, key.resource_key
)
insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
select company_id, scope, resource_key, version, updated_timestamp
from version_events
on conflict (company_id, scope, resource_key)
do update set
  version = greatest(workspace_read_versions.version, excluded.version),
  updated_timestamp = greatest(workspace_read_versions.updated_timestamp, excluded.updated_timestamp);


create table if not exists workspace_derived_domain_event_projection_checkpoints (
  company_id uuid primary key,
  checkpoint_timestamp timestamptz not null,
  checkpoint_event_id uuid not null,
  updated_timestamp timestamptz not null default now()
);

create table if not exists notifications (
  notification_id uuid not null,
  company_id uuid,
  recipient_user_id uuid not null,
  actor_user_id uuid,
  notification_type text not null,
  source_event_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  title text not null,
  body_preview text not null default '',
  surface text not null default '',
  role text not null default '',
  logic_gate_id text not null default '',
  node_id text not null default '',
  information_id text not null default '',
  priority smallint,
  read_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  constraint notifications_type_nonblank_chk check (btrim(notification_type) <> ''),
  constraint notifications_entity_type_nonblank_chk check (btrim(entity_type) <> ''),
  constraint notifications_entity_id_nonblank_chk check (btrim(entity_id) <> ''),
  constraint notifications_title_nonblank_chk check (btrim(title) <> ''),
  constraint notifications_surface_chk check (surface = '' or surface in ('r_inbox', 'aci_inbox', 'my_triage', 'shared_triage')),
  constraint notifications_role_chk check (role = '' or role in ('generated', 'verified', 'consulted', 'informed', 'other')),
  constraint notifications_priority_chk check (priority is null or priority between 1 and 5),
  primary key (notification_id),
  foreign key (recipient_user_id) references users (user_id) on delete cascade,
  foreign key (actor_user_id) references users (user_id) on delete set null
);

comment on column notifications.source_event_id is
  'Notification source UUID. Notifications V1 writes committed domain_events event_id values for new projected rows, but this column is intentionally not foreign-key constrained so existing historical source UUIDs remain valid.';

create unique index if not exists idx_notifications_dedupe
  on notifications(recipient_user_id, source_event_id, notification_type, entity_type, entity_id);

create index if not exists idx_notifications_source_event_id
  on notifications(source_event_id);

create index if not exists idx_notifications_recipient_created
  on notifications(recipient_user_id, created_timestamp desc, notification_id desc);

create index if not exists idx_notifications_recipient_company_created
  on notifications(recipient_user_id, company_id, created_timestamp desc, notification_id desc);

create index if not exists idx_notifications_recipient_unread
  on notifications(recipient_user_id, created_timestamp desc, notification_id desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_company_unread
  on notifications(recipient_user_id, company_id, created_timestamp desc, notification_id desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_summary_unread
  on notifications(recipient_user_id, company_id, surface, role, created_timestamp desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_type_unread
  on notifications(recipient_user_id, company_id, notification_type, created_timestamp desc, notification_id desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_logic_gate_unread
  on notifications(recipient_user_id, company_id, logic_gate_id, node_id, role, created_timestamp desc)
  where read_timestamp is null and btrim(logic_gate_id) <> '';

-- Pointer-scaled resource permission and GVIC descendant applications.
create sequence if not exists resource_policy_sequence;

create table if not exists resource_permission_policy_revisions (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  policy_sequence bigint not null,
  updated_timestamp timestamptz not null default now(),
  constraint resource_permission_policy_revisions_resource_type_chk
    check (resource_type in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox')),
  primary key (company_id, resource_type, resource_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_permission_policy_revisions_sequence
  on resource_permission_policy_revisions(company_id, resource_type, resource_id, policy_sequence);

create table if not exists resource_permission_subtree_applications (
  application_id bigserial primary key,
  policy_sequence bigint not null,
  company_id uuid not null,
  ancestor_resource_type text not null,
  ancestor_resource_id uuid not null,
  rule_key text not null,
  subject_type text,
  subject_id uuid,
  access_level text,
  deleted boolean not null default false,
  created_timestamp timestamptz not null default now(),
  constraint resource_permission_subtree_applications_ancestor_type_chk
    check (ancestor_resource_type in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox')),
  constraint resource_permission_subtree_applications_subject_type_chk
    check (subject_type is null or subject_type in ('user', 'group')),
  constraint resource_permission_subtree_applications_access_level_chk
    check (access_level is null or access_level in ('no_access', 'edit')),
  constraint resource_permission_subtree_applications_rule_shape_chk check (
    (
      rule_key = '__snapshot__'
      and subject_type is null
      and subject_id is null
      and access_level is null
      and not deleted
    )
    or (
      rule_key = '__default__'
      and subject_type is null
      and subject_id is null
      and access_level in ('edit', 'no_access')
      and not deleted
    )
    or (
      rule_key not in ('__default__', '__snapshot__')
      and subject_type in ('user', 'group')
      and subject_id is not null
      and (deleted or access_level in ('no_access', 'edit'))
    )
  ),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_permission_subtree_applications_ancestor
  on resource_permission_subtree_applications(company_id, ancestor_resource_type, ancestor_resource_id, policy_sequence desc, application_id desc);

create index if not exists idx_resource_permission_subtree_applications_rule
  on resource_permission_subtree_applications(company_id, rule_key, policy_sequence desc, application_id desc);

create index if not exists idx_resource_permission_subtree_applications_subject
  on resource_permission_subtree_applications(company_id, subject_type, subject_id, policy_sequence desc);

create table if not exists resource_gvic_policy_revisions (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  policy_sequence bigint not null,
  updated_timestamp timestamptz not null default now(),
  constraint resource_gvic_policy_revisions_resource_type_chk
    check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder', 'shared_inbox')),
  primary key (company_id, resource_type, resource_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_gvic_policy_revisions_sequence
  on resource_gvic_policy_revisions(company_id, resource_type, resource_id, policy_sequence);

create table if not exists resource_gvic_subtree_applications (
  application_id bigserial primary key,
  policy_sequence bigint not null,
  company_id uuid not null,
  ancestor_resource_type text not null,
  ancestor_resource_id uuid not null,
  role text,
  principal_type text,
  principal_id uuid,
  deleted boolean not null default false,
  snapshot boolean not null default false,
  created_timestamp timestamptz not null default now(),
  constraint resource_gvic_subtree_applications_ancestor_type_chk
    check (ancestor_resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder', 'shared_inbox')),
  constraint resource_gvic_subtree_applications_role_chk
    check (role in ('generated', 'verified', 'consulted', 'informed')),
  constraint resource_gvic_subtree_applications_principal_type_chk
    check (principal_type in ('user', 'group')),
  constraint resource_gvic_subtree_applications_rule_shape_chk check (
    (
      snapshot
      and role is null
      and principal_type is null
      and principal_id is null
      and not deleted
    )
    or (
      not snapshot
      and role in ('generated', 'verified', 'consulted', 'informed')
      and principal_type in ('user', 'group')
      and principal_id is not null
    )
  ),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_gvic_subtree_applications_ancestor
  on resource_gvic_subtree_applications(company_id, ancestor_resource_type, ancestor_resource_id, policy_sequence desc, application_id desc);

create index if not exists idx_resource_gvic_subtree_applications_snapshot
  on resource_gvic_subtree_applications(company_id, ancestor_resource_type, ancestor_resource_id, policy_sequence desc)
  where snapshot;

create index if not exists idx_resource_gvic_subtree_applications_principal
  on resource_gvic_subtree_applications(company_id, principal_type, principal_id, policy_sequence desc);

create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean as $$
  with recursive normalized_resource(resource_type) as (
    select case lower(btrim(coalesce(p_resource_type, '')))
      when 'shared_triage_folder' then 'shared_inbox_folder'
      when 'communications_folder' then 'shared_inbox_folder'
      else lower(btrim(coalesce(p_resource_type, '')))
    end
  ),
  requested(required_rank) as (
    select mangorts_access_level_rank(p_access_level)
  ),
  role_admin_actor(allowed) as (
    select exists (
      select 1
      from company_memberships membership
      where membership.user_id = p_user_id
        and (
          membership.role = 'dev_admin'
          or (membership.company_id = p_company_id and membership.role = 'company_admin')
        )
    )
  ),
  normalized_resource_row(default_access) as (
    select coalesce(node.default_access, 'edit')
    from nodes node, normalized_resource normalized
    where normalized.resource_type='node'
      and node.company_id=p_company_id
      and node.node_id=p_resource_id
    union all
    select coalesce(gate.default_access, 'edit')
    from logic_gates gate, normalized_resource normalized
    where normalized.resource_type='logic_gate'
      and gate.company_id=p_company_id
      and gate.logic_gate_id=p_resource_id
    union all
    select coalesce(project.default_access, 'edit')
    from projects project, normalized_resource normalized
    where normalized.resource_type='project'
      and project.company_id=p_company_id
      and project.project_id=p_resource_id
    union all
    select coalesce(folder.default_access, 'edit')
    from company_explorer_folders folder, normalized_resource normalized
    where normalized.resource_type='company_explorer_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
    union all
    select coalesce(folder.default_access, 'edit')
    from shared_inbox_folders folder, normalized_resource normalized
    where normalized.resource_type='shared_inbox_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
    union all
    select coalesce(inbox.default_access, 'edit')
    from shared_inboxes inbox, normalized_resource normalized
    where normalized.resource_type='shared_inbox'
      and inbox.company_id=p_company_id
      and inbox.shared_inbox_id=p_resource_id
  ),
  group_tree(company_id, ancestor_group_id, descendant_group_id, depth) as (
    select user_group.company_id,
           user_group.group_id,
           user_group.group_id,
           0
    from company_user_groups user_group
    where user_group.company_id=p_company_id
    union all
    select parent.company_id,
           parent.ancestor_group_id,
           child.group_id,
           parent.depth + 1
    from group_tree parent
    join company_user_groups child
      on child.company_id=parent.company_id
     and child.parent_group_id=parent.descendant_group_id
    where parent.depth < 100
  ),
  direct_sequence(policy_sequence) as (
    select coalesce((
      select revision.policy_sequence
      from resource_permission_policy_revisions revision, normalized_resource normalized
      where revision.company_id=p_company_id
        and revision.resource_type=normalized.resource_type
        and revision.resource_id=p_resource_id
    ), 0)
  ),
  node_logic_gate_ancestors(logic_gate_id) as (
    select assignment.logic_gate_id
    from node_logic_gate_assignments assignment, normalized_resource normalized
    where normalized.resource_type='node'
      and assignment.company_id=p_company_id
      and assignment.node_id=p_resource_id
  ),
  folder_seeds(folder_id) as (
    select folder.parent_folder_id
    from company_explorer_folders folder, normalized_resource normalized
    where normalized.resource_type='company_explorer_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
      and folder.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item, normalized_resource normalized
    where normalized.resource_type in ('project', 'logic_gate')
      and item.company_id=p_company_id
      and item.target_type=normalized.resource_type
      and item.target_id=p_resource_id
    union
    select item.parent_folder_id
    from company_explorer_items item
    join node_logic_gate_ancestors gate
      on item.target_type='logic_gate'
     and item.target_id=gate.logic_gate_id
    where item.company_id=p_company_id
  ),
  folder_ancestors(folder_id, path) as (
    select folder_id, array[folder_id]
    from folder_seeds
    union all
    select parent.parent_folder_id, folder_ancestors.path || parent.parent_folder_id
    from folder_ancestors
    join company_explorer_folders parent
      on parent.company_id=p_company_id
     and parent.folder_id=folder_ancestors.folder_id
    where parent.parent_folder_id is not null
      and not parent.parent_folder_id = any(folder_ancestors.path)
  ),
  resource_policy_ancestors(resource_type, resource_id) as (
    select 'logic_gate'::text, logic_gate_id
    from node_logic_gate_ancestors
    union
    select 'company_explorer_folder'::text, folder_id
    from folder_ancestors
  ),
  latest_snapshot_application(policy_sequence) as (
    select max(app.policy_sequence)
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.company_id=p_company_id
      and app.rule_key='__snapshot__'
  ),
  latest_default_application(access_level) as (
    select app.access_level
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.company_id=p_company_id
      and app.rule_key='__default__'
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application), 0)
    order by app.policy_sequence desc, app.application_id desc
    limit 1
  ),
  resolved_default(default_access) as (
    select coalesce(
      (select access_level from latest_default_application),
      (select default_access from normalized_resource_row limit 1)
    )
  ),
  direct_permission_rows as (
    select access.subject_type,
           access.subject_id,
           access.access_level,
           access.subject_type || ':' || access.subject_id::text as rule_key
    from resource_permissions access
    join normalized_resource normalized
      on normalized.resource_type=access.resource_type
    where access.company_id=p_company_id
      and access.resource_id=p_resource_id
  ),
  application_permission_rows as (
    select distinct on (app.rule_key)
           app.rule_key,
           app.subject_type,
           app.subject_id,
           app.access_level,
           app.deleted
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.company_id=p_company_id
      and app.rule_key not in ('__default__', '__snapshot__')
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application), 0)
    order by app.rule_key, app.policy_sequence desc, app.application_id desc
  ),
  resolved_permission_rows as (
    select direct.subject_type, direct.subject_id, direct.access_level
    from direct_permission_rows direct
    where not exists (select 1 from latest_snapshot_application where policy_sequence is not null)
      and not exists (
        select 1
        from application_permission_rows app
        where app.rule_key=direct.rule_key
      )
    union all
    select app.subject_type, app.subject_id, app.access_level
    from application_permission_rows app
    where not app.deleted
  ),
  permission_access(access_level) as (
    select candidate.access_level
    from (
      select access.access_level, 0 as source_rank, 0 as group_depth, mangorts_access_level_rank(access.access_level) as access_rank
      from resolved_permission_rows access
      where access.subject_type='user'
        and access.subject_id=p_user_id
      union all
      select access.access_level, 1 as source_rank, min(closure.depth) as group_depth, mangorts_access_level_rank(access.access_level) as access_rank
      from resolved_permission_rows access
      join group_tree closure
        on closure.company_id=p_company_id
       and closure.ancestor_group_id=access.subject_id
      join company_user_group_members member
        on member.company_id=closure.company_id
       and member.group_id=closure.descendant_group_id
       and member.user_id=p_user_id
      where access.subject_type='group'
      group by access.access_level
      union all
      select default_access, 2 as source_rank, 0 as group_depth, mangorts_access_level_rank(default_access) as access_rank
      from resolved_default
    ) candidate
    order by candidate.source_rank asc, candidate.group_depth asc, candidate.access_rank asc
    limit 1
  )
  select case
    when requested.required_rank = 0 then false
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false
    when (select allowed from role_admin_actor) then true
    when not exists (select 1 from permission_access) then false
    when (select mangorts_access_level_rank(access_level) from permission_access limit 1) = 0 then false
    when exists (
        select 1
        from company_memberships membership
        where membership.company_id = p_company_id
          and membership.user_id = p_user_id
      )
      and (select mangorts_access_level_rank(access_level) from permission_access limit 1) >= requested.required_rank then true
    else false
  end
  from requested, normalized_resource;
$$ language sql stable;

create or replace function mangorts_bump_logic_gate_work_version(p_company_id uuid, p_logic_gate_id uuid)
returns void language sql as $$
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select company_id, logic_gate_id, 1, now()
  from logic_gates
  where company_id=p_company_id and logic_gate_id=p_logic_gate_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_logic_gate_work_versions_for_company(p_company_id uuid)
returns void language sql as $$
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select company_id, logic_gate_id, 1, now()
  from logic_gates where company_id=p_company_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_logic_gate_work_versions_for_folder(p_company_id uuid, p_folder_id uuid)
returns void language sql as $$
  with recursive folders(folder_id, path) as (
    select folder_id, array[folder_id]
    from company_explorer_folders
    where company_id=p_company_id and folder_id=p_folder_id
    union all
    select child.folder_id, folders.path || child.folder_id
    from folders
    join company_explorer_folders child
      on child.company_id=p_company_id and child.parent_folder_id=folders.folder_id
    where not child.folder_id=any(folders.path)
  ), gates as (
    select distinct item.target_id
    from folders
    join company_explorer_items item
      on item.company_id=p_company_id
     and item.parent_folder_id=folders.folder_id
     and item.target_type='logic_gate'
  )
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select gate.company_id, gate.logic_gate_id, 1, now()
  from gates
  join logic_gates gate on gate.company_id=p_company_id and gate.logic_gate_id=gates.target_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_logic_gate_work_versions_for_node(p_company_id uuid, p_node_id uuid)
returns void language sql as $$
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select distinct assignment.company_id, assignment.logic_gate_id, 1, now()
  from node_logic_gate_assignments assignment
  join logic_gates gate
    on gate.company_id=assignment.company_id and gate.logic_gate_id=assignment.logic_gate_id
  where assignment.company_id=p_company_id and assignment.node_id=p_node_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_trg_seed_logic_gate_work_version()
returns trigger language plpgsql as $$
begin
  insert into logic_gate_work_versions (company_id, logic_gate_id)
  values (new.company_id, new.logic_gate_id)
  on conflict (company_id, logic_gate_id) do nothing;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_gate_row()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.logic_gate_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.logic_gate_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_version(old.company_id, old.logic_gate_id);
  if (new.company_id, new.logic_gate_id) is distinct from (old.company_id, old.logic_gate_id) then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.logic_gate_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_resource()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    if new.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.resource_id);
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id, old.resource_id);
    end if;
    return old;
  end if;
  if old.resource_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.resource_id);
  end if;
  if (new.company_id, new.resource_type, new.resource_id)
       is distinct from (old.company_id, old.resource_type, old.resource_id)
     and new.resource_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.resource_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_permission_application()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    if new.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.ancestor_resource_id);
    elsif new.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_logic_gate_work_versions_for_folder(new.company_id, new.ancestor_resource_id);
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id, old.ancestor_resource_id);
    elsif old.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_logic_gate_work_versions_for_folder(old.company_id, old.ancestor_resource_id);
    end if;
    return old;
  end if;
  if old.ancestor_resource_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.ancestor_resource_id);
  elsif old.ancestor_resource_type='company_explorer_folder' then
    perform mangorts_bump_logic_gate_work_versions_for_folder(old.company_id, old.ancestor_resource_id);
  end if;
  if (new.company_id, new.ancestor_resource_type, new.ancestor_resource_id)
       is distinct from (old.company_id, old.ancestor_resource_type, old.ancestor_resource_id) then
    if new.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.ancestor_resource_id);
    elsif new.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_logic_gate_work_versions_for_folder(new.company_id, new.ancestor_resource_id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_explorer_item()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    if new.target_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.target_id);
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.target_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id, old.target_id);
    end if;
    return old;
  end if;
  if old.target_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.target_id);
  end if;
  if (new.company_id, new.target_type, new.target_id)
       is distinct from (old.company_id, old.target_type, old.target_id)
     and new.target_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.target_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_explorer_folder()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_versions_for_folder(old.company_id, old.folder_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_versions_for_folder(new.company_id, new.folder_id);
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_for_company()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_logic_gate_work_versions_for_company(new.company_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_versions_for_company(old.company_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_versions_for_company(old.company_id);
  if new.company_id is distinct from old.company_id then
    perform mangorts_bump_logic_gate_work_versions_for_company(new.company_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_node()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_logic_gate_work_versions_for_node(new.company_id, new.node_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_versions_for_node(old.company_id, old.node_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_versions_for_node(old.company_id, old.node_id);
  if (new.company_id, new.node_id) is distinct from (old.company_id, old.node_id) then
    perform mangorts_bump_logic_gate_work_versions_for_node(new.company_id, new.node_id);
  end if;
  return new;
end;
$$;


drop trigger if exists trg_logic_gate_work_version_seed on logic_gates;
create trigger trg_logic_gate_work_version_seed after insert on logic_gates
for each row execute function mangorts_trg_seed_logic_gate_work_version();
drop trigger if exists trg_logic_gate_work_version_gate on logic_gates;
create trigger trg_logic_gate_work_version_gate after update of header, default_access on logic_gates
for each row execute function mangorts_trg_bump_logic_gate_work_from_gate_row();

drop trigger if exists trg_logic_gate_work_version_permissions on resource_permissions;
create trigger trg_logic_gate_work_version_permissions after insert or update or delete on resource_permissions
for each row execute function mangorts_trg_bump_logic_gate_work_from_resource();
drop trigger if exists trg_logic_gate_work_version_permission_revisions on resource_permission_policy_revisions;
create trigger trg_logic_gate_work_version_permission_revisions after insert or update or delete on resource_permission_policy_revisions
for each row execute function mangorts_trg_bump_logic_gate_work_from_resource();
drop trigger if exists trg_logic_gate_work_version_permission_applications on resource_permission_subtree_applications;
create trigger trg_logic_gate_work_version_permission_applications after insert or update or delete on resource_permission_subtree_applications
for each row execute function mangorts_trg_bump_logic_gate_work_from_permission_application();

drop trigger if exists trg_logic_gate_work_version_gvic on resource_gvic_assignments;
create trigger trg_logic_gate_work_version_gvic after insert or update or delete on resource_gvic_assignments
for each row execute function mangorts_trg_bump_logic_gate_work_from_resource();
drop trigger if exists trg_logic_gate_work_version_gvic_revisions on resource_gvic_policy_revisions;
create trigger trg_logic_gate_work_version_gvic_revisions after insert or update or delete on resource_gvic_policy_revisions
for each row execute function mangorts_trg_bump_logic_gate_work_from_resource();

drop trigger if exists trg_logic_gate_work_version_explorer_items on company_explorer_items;
create trigger trg_logic_gate_work_version_explorer_items after insert or update or delete on company_explorer_items
for each row execute function mangorts_trg_bump_logic_gate_work_from_explorer_item();
drop trigger if exists trg_logic_gate_work_version_explorer_folder_update on company_explorer_folders;
create trigger trg_logic_gate_work_version_explorer_folder_update after update of parent_folder_id, default_access on company_explorer_folders
for each row execute function mangorts_trg_bump_logic_gate_work_from_explorer_folder();
drop trigger if exists trg_logic_gate_work_version_explorer_folder_delete on company_explorer_folders;
create trigger trg_logic_gate_work_version_explorer_folder_delete before delete on company_explorer_folders
for each row execute function mangorts_trg_bump_logic_gate_work_from_explorer_folder();

drop trigger if exists trg_logic_gate_work_version_memberships on company_memberships;
create trigger trg_logic_gate_work_version_memberships after insert or update or delete on company_memberships
for each row execute function mangorts_trg_bump_logic_gate_work_for_company();
drop trigger if exists trg_logic_gate_work_version_group_members on company_user_group_members;
create trigger trg_logic_gate_work_version_group_members after insert or update or delete on company_user_group_members
for each row execute function mangorts_trg_bump_logic_gate_work_for_company();
drop trigger if exists trg_logic_gate_work_version_groups on company_user_groups;
create trigger trg_logic_gate_work_version_groups after insert or update or delete on company_user_groups
for each row execute function mangorts_trg_bump_logic_gate_work_for_company();

drop trigger if exists trg_logic_gate_work_version_assignments on node_logic_gate_assignments;
create trigger trg_logic_gate_work_version_assignments after insert or update or delete on node_logic_gate_assignments
for each row execute function mangorts_trg_bump_logic_gate_work_from_gate_row();
drop trigger if exists trg_logic_gate_work_version_projection on kanban_board_projection;
create trigger trg_logic_gate_work_version_projection after insert or update or delete on kanban_board_projection
for each row execute function mangorts_trg_bump_logic_gate_work_from_gate_row();
drop trigger if exists trg_logic_gate_work_version_nodes on nodes;
create trigger trg_logic_gate_work_version_nodes after update of name, due_date, priority on nodes
for each row execute function mangorts_trg_bump_logic_gate_work_from_node();

-- Cheap, canonical node-view validators. Do not apply from an agent session.

create table if not exists node_view_versions (
  company_id uuid not null,
  node_id uuid not null,
  version bigint not null default 1,
  updated_timestamp timestamptz not null default now(),
  constraint node_view_versions_version_positive_chk check (version > 0),
  primary key (company_id, node_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade
);

create table if not exists node_view_user_versions (
  company_id uuid not null,
  node_id uuid not null,
  user_id uuid not null,
  version bigint not null default 1,
  updated_timestamp timestamptz not null default now(),
  constraint node_view_user_versions_version_positive_chk check (version > 0),
  primary key (company_id, node_id, user_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (user_id) references users(user_id) on delete cascade
);

insert into node_view_versions(company_id, node_id)
select company_id, node_id from nodes
on conflict (company_id, node_id) do nothing;

create or replace function mangorts_bump_node_view_version(p_company_id uuid, p_node_id uuid)
returns void language sql as $$
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select company_id, node_id, 1, now()
  from nodes
  where company_id=p_company_id and node_id=p_node_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_node_view_user_version(p_company_id uuid, p_node_id uuid, p_user_id uuid)
returns void language sql as $$
  insert into node_view_user_versions(company_id, node_id, user_id, version, updated_timestamp)
  select node.company_id, node.node_id, actor.user_id, 1, now()
  from nodes node
  join users actor on actor.user_id=p_user_id
  where node.company_id=p_company_id and node.node_id=p_node_id
  on conflict (company_id, node_id, user_id) do update set
    version=node_view_user_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_node_view_versions_for_logic_gate(p_company_id uuid, p_logic_gate_id uuid)
returns void language sql as $$
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select distinct assignment.company_id, assignment.node_id, 1, now()
  from node_logic_gate_assignments assignment
  join nodes node on node.company_id=assignment.company_id and node.node_id=assignment.node_id
  where assignment.company_id=p_company_id and assignment.logic_gate_id=p_logic_gate_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_node_view_versions_for_account(p_company_id uuid, p_account_id uuid)
returns void language sql as $$
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select distinct assignment.company_id, assignment.node_id, 1, now()
  from node_account_assignments assignment
  join nodes node on node.company_id=assignment.company_id and node.node_id=assignment.node_id
  where assignment.company_id=p_company_id and assignment.account_id=p_account_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_bump_node_view_versions_for_folder(p_company_id uuid, p_folder_id uuid)
returns void language sql as $$
  with recursive folders(folder_id, path) as (
    select folder_id, array[folder_id]
    from company_explorer_folders
    where company_id=p_company_id and folder_id=p_folder_id
    union all
    select child.folder_id, folders.path || child.folder_id
    from folders
    join company_explorer_folders child
      on child.company_id=p_company_id and child.parent_folder_id=folders.folder_id
    where not child.folder_id=any(folders.path)
  ), affected_nodes(node_id) as (
    select distinct assignment.node_id
    from folders
    join company_explorer_items item
      on item.company_id=p_company_id
     and item.parent_folder_id=folders.folder_id
     and item.target_type='logic_gate'
    join node_logic_gate_assignments assignment
      on assignment.company_id=item.company_id
     and assignment.logic_gate_id=item.target_id
  )
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select node.company_id, node.node_id, 1, now()
  from affected_nodes affected
  join nodes node on node.company_id=p_company_id and node.node_id=affected.node_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;

create or replace function mangorts_trg_seed_node_view_version()
returns trigger language plpgsql as $$
begin
  insert into node_view_versions(company_id, node_id)
  values (new.company_id, new.node_id)
  on conflict (company_id, node_id) do nothing;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_node()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
    return new;
  elsif tg_op='DELETE' then
    return old;
  end if;
  perform mangorts_bump_node_view_version(old.company_id, old.node_id);
  if (new.company_id, new.node_id) is distinct from (old.company_id, old.node_id) then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_direct_node()
returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_node_view_version(old.company_id, old.node_id);
    return old;
  end if;
  perform mangorts_bump_node_view_version(old.company_id, old.node_id);
  if (new.company_id, new.node_id) is distinct from (old.company_id, old.node_id) then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_relationship()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_version(old.company_id, old.node_id_a);
    perform mangorts_bump_node_view_version(old.company_id, old.node_id_b);
  end if;
  if tg_op <> 'DELETE' then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id_a);
    perform mangorts_bump_node_view_version(new.company_id, new.node_id_b);
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_account()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_versions_for_account(old.company_id, old.account_id);
  end if;
  if tg_op <> 'DELETE' then
    perform mangorts_bump_node_view_versions_for_account(new.company_id, new.account_id);
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_resource()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    if old.resource_type='node' then
      perform mangorts_bump_node_view_version(old.company_id, old.resource_id);
    elsif old.resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(old.company_id, old.resource_id);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    if new.resource_type='node' then
      perform mangorts_bump_node_view_version(new.company_id, new.resource_id);
    elsif new.resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(new.company_id, new.resource_id);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_permission_application()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    if old.ancestor_resource_type='node' then
      perform mangorts_bump_node_view_version(old.company_id, old.ancestor_resource_id);
    elsif old.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(old.company_id, old.ancestor_resource_id);
    elsif old.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_node_view_versions_for_folder(old.company_id, old.ancestor_resource_id);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    if new.ancestor_resource_type='node' then
      perform mangorts_bump_node_view_version(new.company_id, new.ancestor_resource_id);
    elsif new.ancestor_resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(new.company_id, new.ancestor_resource_id);
    elsif new.ancestor_resource_type='company_explorer_folder' then
      perform mangorts_bump_node_view_versions_for_folder(new.company_id, new.ancestor_resource_id);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_explorer_item()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' and old.target_type='logic_gate' then
    perform mangorts_bump_node_view_versions_for_logic_gate(old.company_id, old.target_id);
  end if;
  if tg_op <> 'DELETE' and new.target_type='logic_gate' then
    perform mangorts_bump_node_view_versions_for_logic_gate(new.company_id, new.target_id);
    return new;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_node_view_from_explorer_folder()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_versions_for_folder(old.company_id, old.folder_id);
  end if;
  if tg_op <> 'DELETE' then
    perform mangorts_bump_node_view_versions_for_folder(new.company_id, new.folder_id);
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_node_view_version_seed on nodes;
create trigger trg_node_view_version_seed after insert on nodes
for each row execute function mangorts_trg_seed_node_view_version();
drop trigger if exists trg_node_view_version_node on nodes;
create trigger trg_node_view_version_node after update on nodes
for each row execute function mangorts_trg_bump_node_view_from_node();

drop trigger if exists trg_node_view_version_timeline_events on node_timeline_events;
create trigger trg_node_view_version_timeline_events after insert or update or delete on node_timeline_events
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
drop trigger if exists trg_node_view_version_timeline_recipients on node_timeline_verification_recipients;
create trigger trg_node_view_version_timeline_recipients after insert or update or delete on node_timeline_verification_recipients
for each row execute function mangorts_trg_bump_node_view_from_direct_node();


drop trigger if exists trg_node_view_version_relationships on node_relationships;
create trigger trg_node_view_version_relationships after insert or update or delete on node_relationships
for each row execute function mangorts_trg_bump_node_view_from_relationship();
drop trigger if exists trg_node_view_version_logic_gate_assignments on node_logic_gate_assignments;
create trigger trg_node_view_version_logic_gate_assignments after insert or update or delete on node_logic_gate_assignments
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
drop trigger if exists trg_node_view_version_account_assignments on node_account_assignments;
create trigger trg_node_view_version_account_assignments after insert or update or delete on node_account_assignments
for each row execute function mangorts_trg_bump_node_view_from_direct_node();

drop trigger if exists trg_node_view_version_accounts_update on accounts;
create trigger trg_node_view_version_accounts_update after update on accounts
for each row execute function mangorts_trg_bump_node_view_from_account();
drop trigger if exists trg_node_view_version_accounts_delete on accounts;
create trigger trg_node_view_version_accounts_delete before delete on accounts
for each row execute function mangorts_trg_bump_node_view_from_account();

drop trigger if exists trg_node_view_version_gvic_assignments on resource_gvic_assignments;
create trigger trg_node_view_version_gvic_assignments after insert or update or delete on resource_gvic_assignments
for each row execute function mangorts_trg_bump_node_view_from_resource();
drop trigger if exists trg_node_view_version_permissions on resource_permissions;
create trigger trg_node_view_version_permissions after insert or update or delete on resource_permissions
for each row execute function mangorts_trg_bump_node_view_from_resource();
drop trigger if exists trg_node_view_version_permission_revisions on resource_permission_policy_revisions;
create trigger trg_node_view_version_permission_revisions after insert or update or delete on resource_permission_policy_revisions
for each row execute function mangorts_trg_bump_node_view_from_resource();
drop trigger if exists trg_node_view_version_permission_applications on resource_permission_subtree_applications;
create trigger trg_node_view_version_permission_applications after insert or update or delete on resource_permission_subtree_applications
for each row execute function mangorts_trg_bump_node_view_from_permission_application();

drop trigger if exists trg_node_view_version_explorer_items on company_explorer_items;
create trigger trg_node_view_version_explorer_items after insert or update or delete on company_explorer_items
for each row execute function mangorts_trg_bump_node_view_from_explorer_item();
drop trigger if exists trg_node_view_version_explorer_folder_update on company_explorer_folders;
create trigger trg_node_view_version_explorer_folder_update after update of parent_folder_id, default_access on company_explorer_folders
for each row execute function mangorts_trg_bump_node_view_from_explorer_folder();
drop trigger if exists trg_node_view_version_explorer_folder_delete on company_explorer_folders;
create trigger trg_node_view_version_explorer_folder_delete before delete on company_explorer_folders
for each row execute function mangorts_trg_bump_node_view_from_explorer_folder();

alter table company_explorer_items
  drop constraint if exists company_explorer_items_target_type_chk;
alter table company_explorer_items
  add constraint company_explorer_items_target_type_chk
  check (target_type in ('project', 'logic_gate'));

-- Unified realtime collaboration durable spine.
-- Apply before deploying application instances that publish collaboration deltas.

create table if not exists realtime_outbox (
  outbox_sequence bigserial primary key,
  event_id uuid not null unique,
  company_id uuid not null,
  scope text not null,
  event_type text not null,
  resource_type text,
  resource_id text,
  permission text,
  resource_revision bigint not null default 0,
  payload jsonb not null,
  allowed_user_ids jsonb not null default '[]'::jsonb,
  audience_restricted boolean not null default false,
  attempt_count integer not null default 0,
  claim_token uuid,
  claim_expires_at timestamptz,
  published_timestamp timestamptz,
  last_error_category text,
  created_timestamp timestamptz not null default now(),
  constraint realtime_outbox_company_fkey foreign key (company_id) references companies(company_id) on delete cascade,
  constraint realtime_outbox_scope_nonblank_chk check (btrim(scope) <> '' and octet_length(scope) <= 384),
  constraint realtime_outbox_event_type_nonblank_chk check (btrim(event_type) <> ''),
  constraint realtime_outbox_resource_revision_chk check (resource_revision >= 0),
  constraint realtime_outbox_payload_size_chk check (pg_column_size(payload) <= 262144),
  constraint realtime_outbox_allowed_user_ids_array_chk check (jsonb_typeof(allowed_user_ids) = 'array'),
  constraint realtime_outbox_attempt_count_chk check (attempt_count >= 0)
);

create index if not exists idx_realtime_outbox_claim
  on realtime_outbox(outbox_sequence)
  where published_timestamp is null;

create index if not exists idx_realtime_outbox_published_sequence
  on realtime_outbox(outbox_sequence)
  where published_timestamp is not null;

create index if not exists idx_realtime_outbox_scope_sequence
  on realtime_outbox(company_id, scope, outbox_sequence);


-- Permanent TipTap JSON storage for Node text boxes.
create table if not exists node_textboxes (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  body_json jsonb not null,
  title text not null default '',
  color text,
  revision bigint not null default 0,
  display_order bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, node_id, textbox_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  constraint node_textboxes_body_json_chk check (
    body_json->>'format' = 'mango-tiptap-json'
    and body_json->>'schema_version' = '1'
    and body_json->'document'->>'type' = 'doc'
    and jsonb_typeof(body_json->'annotations') = 'array'
  ),
  constraint node_textboxes_revision_chk check (revision >= 0),
  constraint node_textboxes_title_chk check (length(title) <= 500),
  constraint node_textboxes_color_chk check (color is null or color in (
    '#0EA5E9', '#14B8A6', '#8B5CF6', '#F59E0B', '#22C55E', '#6366F1',
    '#06B6D4', '#84CC16', '#A855F7', '#10B981', '#EAB308', '#3B82F6'
  )),
  constraint node_textboxes_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  )
);

create index if not exists idx_node_textboxes_node_order
  on node_textboxes(company_id, node_id, display_order, textbox_id)
  where deleted_timestamp is null;

create index if not exists idx_node_textboxes_node_deleted
  on node_textboxes(company_id, node_id, deleted_timestamp, textbox_id)
  where deleted_timestamp is not null;

comment on table node_textboxes is
  'Permanent current TipTap JSON document storage for Node text boxes.';
comment on column node_textboxes.display_order is
  'User-controlled Node workspace order.';
comment on column node_textboxes.color is
  'Optional non-red RGB color used only when this exact Node text box has an email relationship.';

-- Permanent comments owned by an exact Node textbox.
create table if not exists node_textbox_chats (
  company_id uuid not null,
  chat_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  parent_chat_id uuid,
  selection_source text not null default 'text',
  selection_textbox_id uuid,
  selection_email_message_id uuid,
  selection_quote text not null default '',
  selection_start integer,
  selection_end integer,
  author_user_id uuid,
  author_display_name text not null default '',
  message text not null default '',
  edited_timestamp timestamptz,
  entity_links jsonb not null default '[]'::jsonb,
  mentioned_user_ids uuid[] not null default '{}'::uuid[],
  mentioned_group_ids uuid[] not null default '{}'::uuid[],
  revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, chat_id),
  unique (company_id, node_id, textbox_id, chat_id),
  foreign key (company_id, node_id, textbox_id)
    references node_textboxes(company_id, node_id, textbox_id) on delete cascade,
  foreign key (company_id, node_id, textbox_id, parent_chat_id)
    references node_textbox_chats(company_id, node_id, textbox_id, chat_id) on delete cascade,
  foreign key (author_user_id) references users(user_id) on delete set null,
  constraint node_textbox_chats_selection_source_chk
    check (selection_source in ('text', 'email')),
  constraint node_textbox_chats_selection_target_chk check (
    (selection_source = 'text' and selection_email_message_id is null)
    or (selection_source = 'email' and selection_email_message_id is not null)
  ),
  constraint node_textbox_chats_selection_offsets_chk check (
    (selection_start is null and selection_end is null)
    or (selection_start >= 0 and selection_end >= selection_start)
  ),
  constraint node_textbox_chats_entity_links_chk
    check (jsonb_typeof(entity_links) = 'array'),
  constraint node_textbox_chats_revision_chk check (revision > 0),
  constraint node_textbox_chats_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (edited_timestamp is null or edited_timestamp >= created_timestamp)
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  )
);

create index if not exists idx_node_textbox_chats_textbox_created
  on node_textbox_chats(company_id, node_id, textbox_id, created_timestamp, chat_id)
  where deleted_timestamp is null;

create index if not exists idx_node_textbox_chats_parent
  on node_textbox_chats(company_id, node_id, textbox_id, parent_chat_id)
  where parent_chat_id is not null and deleted_timestamp is null;

create index if not exists idx_node_textbox_chats_email_selection
  on node_textbox_chats(company_id, selection_email_message_id)
  where selection_email_message_id is not null and deleted_timestamp is null;

comment on table node_textbox_chats is
  'Permanent Node textbox chats, keyed by the preserved legacy chat identity.';



create table if not exists project_textboxes (
  company_id uuid not null,
  project_id uuid not null,
  textbox_id text not null,
  body_json jsonb not null,
  revision bigint not null default 0,
  display_order bigint not null default 0,
  title text not null default '',
  email_message_id text not null default '',
  email_accent text not null default '',
  metadata_revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, project_id, textbox_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  constraint project_textboxes_id_chk check (btrim(textbox_id) <> ''),
  constraint project_textboxes_revision_chk check (revision >= 0),
  constraint project_textboxes_metadata_revision_chk check (metadata_revision > 0),
  constraint project_textboxes_title_chk check (length(title) <= 500),
  constraint project_textboxes_email_accent_chk check (
    email_accent='' or email_accent ~ '^#[0-9A-Fa-f]{6}$'
  ),
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

create table if not exists project_textbox_chats (
  company_id uuid not null,
  chat_id uuid not null,
  project_id uuid not null,
  textbox_id text not null,
  parent_chat_id uuid,
  selection_source text not null default 'text',
  selection_textbox_id text,
  selection_email_message_id uuid,
  selection_quote text not null default '',
  selection_start integer,
  selection_end integer,
  author_user_id uuid,
  author_display_name text not null default '',
  message text not null default '',
  edited_timestamp timestamptz,
  entity_links jsonb not null default '[]'::jsonb,
  mentioned_user_ids uuid[] not null default '{}'::uuid[],
  mentioned_group_ids uuid[] not null default '{}'::uuid[],
  revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, chat_id),
  unique (company_id, project_id, textbox_id, chat_id),
  foreign key (company_id, project_id, textbox_id)
    references project_textboxes(company_id, project_id, textbox_id) on delete cascade,
  foreign key (company_id, project_id, textbox_id, parent_chat_id)
    references project_textbox_chats(company_id, project_id, textbox_id, chat_id) on delete cascade,
  foreign key (author_user_id) references users(user_id) on delete set null,
  constraint project_textbox_chats_textbox_id_chk check (btrim(textbox_id) <> ''),
  constraint project_textbox_chats_selection_source_chk check (selection_source in ('text','email')),
  constraint project_textbox_chats_selection_target_chk check (
    (selection_source='text' and selection_email_message_id is null)
    or (selection_source='email' and selection_email_message_id is not null)
  ),
  constraint project_textbox_chats_selection_offsets_chk check (
    (selection_start is null and selection_end is null)
    or (selection_start >= 0 and selection_end >= selection_start)
  ),
  constraint project_textbox_chats_entity_links_chk check (jsonb_typeof(entity_links)='array'),
  constraint project_textbox_chats_revision_chk check (revision > 0),
  constraint project_textbox_chats_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (edited_timestamp is null or edited_timestamp >= created_timestamp)
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  )
);

create index if not exists idx_project_textbox_chats_textbox_created
  on project_textbox_chats(company_id,project_id,textbox_id,created_timestamp,chat_id)
  where deleted_timestamp is null;
create index if not exists idx_project_textbox_chats_parent
  on project_textbox_chats(company_id,project_id,textbox_id,parent_chat_id)
  where parent_chat_id is not null and deleted_timestamp is null;
create index if not exists idx_project_textbox_chats_email_selection
  on project_textbox_chats(company_id,selection_email_message_id)
  where selection_email_message_id is not null and deleted_timestamp is null;

comment on table project_textbox_chats is
  'Permanent Project textbox chats keyed by the preserved legacy projection information_id.';

create table if not exists logic_gate_textboxes (
  company_id uuid not null,
  logic_gate_id uuid not null,
  textbox_id text not null,
  body_json jsonb not null,
  revision bigint not null default 0,
  title text not null default '',
  email_message_id text not null default '',
  email_accent text not null default '',
  metadata_revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, logic_gate_id, textbox_id),
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  constraint logic_gate_textboxes_id_chk check (btrim(textbox_id) <> ''),
  constraint logic_gate_textboxes_revision_chk check (revision >= 0),
  constraint logic_gate_textboxes_metadata_revision_chk check (metadata_revision > 0),
  constraint logic_gate_textboxes_title_chk check (length(title) <= 500),
  constraint logic_gate_textboxes_email_accent_chk check (email_accent='' or email_accent ~ '^#[0-9A-Fa-f]{6}$'),
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
-- Final provider-independent email storage.
create table if not exists email_threads (
  company_id uuid not null,
  email_thread_id uuid not null,
  email_connection_id uuid not null,
  provider_thread_key text not null,
  provider_thread_id text not null default '',
  root_provider_message_id text not null,
  download_status text not null default 'partial',
  history_complete boolean not null default false,
  fetched_timestamp timestamptz,
  last_download_error text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, email_thread_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id,email_connection_id)
    references email_connections(company_id,email_connection_id) on delete cascade,
  constraint email_threads_provider_key_chk check (btrim(provider_thread_key) <> ''),
  constraint email_threads_root_message_chk check (btrim(root_provider_message_id) <> ''),
  constraint email_threads_download_status_chk check (
    download_status in ('partial', 'downloading', 'complete', 'failed')
    and (not history_complete or download_status in ('downloading', 'complete', 'failed'))
  )
);

create unique index if not exists idx_email_threads_connection_provider
  on email_threads(company_id,email_connection_id,provider_thread_key);

create table if not exists email_messages (
  company_id uuid not null,
  email_message_id uuid not null,
  email_thread_id uuid not null,
  provider_message_id text not null,
  message_order integer not null,
  subject text not null default '',
  sender_snapshot jsonb not null default '[]'::jsonb,
  to_snapshot jsonb not null default '[]'::jsonb,
  cc_snapshot jsonb not null default '[]'::jsonb,
  bcc_snapshot jsonb not null default '[]'::jsonb,
  reply_to_snapshot jsonb not null default '[]'::jsonb,
  message_timestamp timestamptz,
  rich_html_body text not null default '',
  text_fallback text not null default '',
  snippet text not null default '',
  unread boolean not null default false,
  starred boolean not null default false,
  folder_snapshot jsonb not null default '[]'::jsonb,
  folder_id_snapshot jsonb not null default '[]'::jsonb,
  attachment_metadata jsonb not null default '[]'::jsonb,
  download_complete boolean not null default false,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, email_message_id),
  unique (company_id, email_thread_id, provider_message_id),
  unique (company_id, email_thread_id, email_message_id),
  foreign key (company_id, email_thread_id)
    references email_threads(company_id, email_thread_id) on delete cascade,
  constraint email_messages_provider_message_chk check (btrim(provider_message_id) <> ''),
  constraint email_messages_order_chk check (message_order >= 0),
  constraint email_messages_json_chk check (
    jsonb_typeof(sender_snapshot) = 'array'
    and jsonb_typeof(to_snapshot) = 'array'
    and jsonb_typeof(cc_snapshot) = 'array'
    and jsonb_typeof(bcc_snapshot) = 'array'
    and jsonb_typeof(reply_to_snapshot) = 'array'
    and jsonb_typeof(folder_snapshot) = 'array'
    and jsonb_typeof(folder_id_snapshot) = 'array'
    and jsonb_typeof(attachment_metadata) = 'array'
  )
);

create index if not exists idx_email_messages_thread_order
  on email_messages(company_id, email_thread_id, message_order, provider_message_id);

create table if not exists email_relationships (
  company_id uuid not null,
  email_relationship_id uuid not null,
  email_thread_id uuid not null,
  email_message_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  resource_textbox_id text,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, email_relationship_id),
  foreign key (company_id, email_thread_id, email_message_id)
    references email_messages(company_id, email_thread_id, email_message_id) on delete cascade,
  constraint email_relationships_resource_type_chk
    check (resource_type in ('node', 'project', 'logic_gate')),
  constraint email_relationships_textbox_id_chk
    check (resource_textbox_id is null or btrim(resource_textbox_id) <> '')
);

create index if not exists idx_email_relationships_resource
  on email_relationships(
    company_id, resource_type, resource_id, resource_textbox_id, created_timestamp
  );

create index if not exists idx_email_relationships_message
  on email_relationships(company_id, email_thread_id, email_message_id);

create unique index if not exists idx_email_relationships_active_identity
  on email_relationships(
    company_id, email_message_id, resource_type, resource_id,
    coalesce(resource_textbox_id, '')
  );

create unique index if not exists idx_email_relationships_one_node_textbox_per_message
  on email_relationships(company_id, email_message_id, resource_id)
  where resource_type='node' and resource_textbox_id is not null;

create unique index if not exists idx_email_relationships_one_project_textbox_per_message
  on email_relationships(company_id, email_message_id, resource_id)
  where resource_type='project' and resource_textbox_id is not null;

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
-- The permanent textbox tables are the only current editor document storage.

-- One aggregate current-text limit per editor owner. Attachment object bytes
-- and editor history are separate storage and do not count toward this limit.
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

comment on function mangorts_enforce_node_editor_text_limit() is
  'Caps the sum of current Node textbox Tiptap JSON at one GiB. Attachment object bytes and editor history do not count.';
comment on function mangorts_enforce_project_editor_text_limit() is
  'Caps the sum of current Project textbox Tiptap JSON at one GiB. Attachment object bytes and editor history do not count.';
comment on function mangorts_enforce_logic_gate_editor_text_limit() is
  'Caps the sum of current Logic Gate textbox Tiptap JSON at one GiB. Attachment object bytes and editor history do not count.';

-- V3 email relationship host validation is deliberately polymorphic because
-- the relationship may target a Node, Project, or Logic Gate.
create or replace function mangorts_validate_email_relationship_resource()
returns trigger language plpgsql as $$
begin
  if new.resource_type = 'node' then
    if not exists (select 1 from nodes where company_id=new.company_id and node_id=new.resource_id) then
      raise exception 'email relationship node does not exist' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and not exists (
      select 1 from node_textboxes where company_id=new.company_id
        and node_id=new.resource_id and textbox_id::text=new.resource_textbox_id
        and deleted_timestamp is null
    ) then
      raise exception 'email relationship Node textbox does not belong to resource' using errcode='23503';
    end if;
  elsif new.resource_type = 'project' then
    if not exists (select 1 from projects where company_id=new.company_id and project_id=new.resource_id) then
      raise exception 'email relationship project does not exist' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and not exists (
      select 1 from project_textboxes where company_id=new.company_id
        and project_id=new.resource_id and textbox_id=new.resource_textbox_id
        and deleted_timestamp is null
    ) then
      raise exception 'email relationship Project textbox does not belong to resource' using errcode='23503';
    end if;
  elsif new.resource_type = 'logic_gate' then
    if not exists (select 1 from logic_gates where company_id=new.company_id and logic_gate_id=new.resource_id) then
      raise exception 'email relationship Logic Gate does not exist' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and not exists (
      select 1 from logic_gate_textboxes where company_id=new.company_id
        and logic_gate_id=new.resource_id and textbox_id=new.resource_textbox_id
        and deleted_timestamp is null
    ) then
      raise exception 'email relationship Logic Gate textbox does not belong to resource' using errcode='23503';
    end if;
  else
    raise exception 'unsupported email relationship resource type' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_email_relationship_resource on email_relationships;
create constraint trigger trg_validate_email_relationship_resource
after insert or update of company_id,resource_type,resource_id,resource_textbox_id
on email_relationships deferrable initially immediate
for each row execute function mangorts_validate_email_relationship_resource();

create or replace function mangorts_validate_node_email_chat_relationship()
returns trigger language plpgsql as $$
begin
  if new.selection_source='email' and new.deleted_timestamp is null and not exists (
    select 1
    from email_relationships relationship
    where relationship.company_id=new.company_id
      and relationship.resource_type='node'
      and relationship.resource_id=new.node_id
      and relationship.resource_textbox_id=new.textbox_id::text
      and relationship.email_message_id=new.selection_email_message_id
  ) then
    raise exception 'email chat requires exact Node message textbox relationship' using errcode='23503';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_node_email_chat_relationship on node_textbox_chats;
create constraint trigger trg_validate_node_email_chat_relationship
after insert or update of company_id,node_id,textbox_id,selection_source,selection_email_message_id,deleted_timestamp
on node_textbox_chats deferrable initially immediate
for each row execute function mangorts_validate_node_email_chat_relationship();

create or replace function mangorts_protect_node_email_chat_relationship()
returns trigger language plpgsql as $$
begin
  if old.resource_type='node' and old.resource_textbox_id is not null and exists (
    select 1
    from node_textbox_chats chat
    where chat.company_id=old.company_id
      and chat.node_id=old.resource_id
      and chat.textbox_id::text=old.resource_textbox_id
      and chat.selection_source='email'
      and chat.selection_email_message_id=old.email_message_id
      and chat.deleted_timestamp is null
  ) and not exists (
    select 1
    from email_relationships relationship
    where relationship.company_id=old.company_id
      and relationship.email_relationship_id<>old.email_relationship_id
      and relationship.resource_type='node'
      and relationship.resource_id=old.resource_id
      and relationship.resource_textbox_id=old.resource_textbox_id
      and relationship.email_message_id=old.email_message_id
  ) then
    raise exception 'email relationship is required by an active Node chat' using errcode='23503';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_protect_node_email_chat_relationship on email_relationships;
create constraint trigger trg_protect_node_email_chat_relationship
after delete or update of company_id,email_message_id,resource_type,resource_id,resource_textbox_id
on email_relationships deferrable initially deferred
for each row execute function mangorts_protect_node_email_chat_relationship();

create table if not exists email_drafts (
  company_id uuid not null,
  draft_id text not null,
  email_thread_id uuid,
  origin_node_id uuid,
  source_email_message_id uuid,
  email_account_type text not null,
  personal_user_id uuid,
  personal_account_email text,
  shared_inbox_id uuid,
  sender_account_email text not null default '',
  created_by_user_id uuid,
  updated_by_user_id uuid,
  kind text not null default 'compose',
  to_recipients text not null default '',
  cc_recipients text not null default '',
  bcc_recipients text not null default '',
  subject text not null default '',
  body_editor_html text not null default '',
  scheduled_send_timestamp timestamptz,
  revision bigint not null default 1,
  send_state text not null default 'draft',
  send_claim_token text not null default '',
  send_idempotency_key text not null default '',
  send_idempotency_grant_id text not null default '',
  send_idempotency_timestamp timestamptz,
  send_claimed_revision bigint not null default 0,
  send_claimed_timestamp timestamptz,
  sent_email_message_id uuid,
  sent_provider_message_id text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id,draft_id),
  foreign key (company_id,email_thread_id)
    references email_threads(company_id,email_thread_id) on delete cascade,
  foreign key (company_id,origin_node_id)
    references nodes(company_id,node_id) on delete cascade,
  foreign key (company_id,source_email_message_id)
    references email_messages(company_id,email_message_id) on delete restrict,
  foreign key (company_id,sent_email_message_id)
    references email_messages(company_id,email_message_id) on delete restrict,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (updated_by_user_id) references users(user_id) on delete set null,
  constraint email_drafts_draft_id_chk check (btrim(draft_id) <> ''),
  constraint email_drafts_account_type_chk check (
    email_account_type in ('personal_email_account','shared_email_account')
  ),
  constraint email_drafts_account_scope_chk check (
    (email_account_type='personal_email_account' and personal_user_id is not null
      and personal_account_email is not null and shared_inbox_id is null)
    or
    (email_account_type='shared_email_account' and personal_user_id is null
      and personal_account_email is null and shared_inbox_id is not null)
  ),
  constraint email_drafts_personal_account_email_chk check (
    personal_account_email is null or (btrim(personal_account_email)<>''
      and personal_account_email=lower(btrim(personal_account_email)))
  ),
  constraint email_drafts_sender_account_email_chk check (
    sender_account_email='' or sender_account_email=lower(btrim(sender_account_email))
  ),
  constraint email_drafts_origin_node_chk check (
    (email_thread_id is null and origin_node_id is null and created_by_user_id is not null)
    or
    (email_thread_id is not null and origin_node_id is not null and source_email_message_id is not null)
  ),
  constraint email_drafts_kind_chk check (kind in ('compose','reply','forward')),
  constraint email_drafts_revision_chk check (revision > 0),
  constraint email_drafts_send_state_chk check (send_state in ('draft','sending','sent'))
);

create index if not exists idx_email_drafts_personal_updated
  on email_drafts(company_id,personal_user_id,personal_account_email,updated_timestamp desc)
  where deleted_timestamp is null and email_account_type='personal_email_account';
create index if not exists idx_email_drafts_shared_updated
  on email_drafts(company_id,shared_inbox_id,updated_timestamp desc)
  where deleted_timestamp is null and email_account_type='shared_email_account';
drop index if exists idx_email_drafts_active_thread;
create unique index if not exists idx_email_drafts_active_shared_message_node
  on email_drafts(company_id,origin_node_id,source_email_message_id)
  where deleted_timestamp is null and email_thread_id is not null and send_state in ('draft','sending');
create unique index if not exists idx_email_drafts_active_personal_message_personal_account
  on email_drafts(company_id,created_by_user_id,source_email_message_id,personal_user_id,personal_account_email)
  where deleted_timestamp is null and email_thread_id is null and source_email_message_id is not null
    and email_account_type='personal_email_account' and send_state in ('draft','sending');
create unique index if not exists idx_email_drafts_active_personal_message_shared_inbox
  on email_drafts(company_id,created_by_user_id,source_email_message_id,shared_inbox_id)
  where deleted_timestamp is null and email_thread_id is null and source_email_message_id is not null
    and email_account_type='shared_email_account' and send_state in ('draft','sending');
create index if not exists idx_email_drafts_origin_node
  on email_drafts(company_id,origin_node_id,updated_timestamp desc)
  where deleted_timestamp is null and origin_node_id is not null;

create table if not exists email_signatures (
  company_id uuid not null,
  signature_id text not null,
  email_account_type text not null,
  personal_user_id uuid,
  personal_account_email text,
  shared_inbox_id uuid,
  email_account_email text not null,
  name text not null default 'Default',
  body_editor_html text not null default '',
  is_default boolean not null default true,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id,signature_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (updated_by_user_id) references users(user_id) on delete set null,
  constraint email_signatures_signature_id_chk check (btrim(signature_id)<>''),
  constraint email_signatures_name_chk check (btrim(name)<>''),
  constraint email_signatures_account_type_chk check (
    email_account_type in ('personal_email_account','shared_email_account')
  ),
  constraint email_signatures_account_scope_chk check (
    (email_account_type='personal_email_account' and personal_user_id is not null
      and personal_account_email is not null and shared_inbox_id is null)
    or
    (email_account_type='shared_email_account' and personal_user_id is null
      and personal_account_email is null and shared_inbox_id is not null)
  ),
  constraint email_signatures_account_email_chk check (
    btrim(email_account_email)<>'' and email_account_email=lower(btrim(email_account_email))
  ),
  constraint email_signatures_personal_account_email_chk check (
    personal_account_email is null or (btrim(personal_account_email)<>''
      and personal_account_email=lower(btrim(personal_account_email)))
  )
);
create unique index if not exists idx_email_signatures_personal_scope
  on email_signatures(company_id,personal_user_id,personal_account_email)
  where email_account_type='personal_email_account';
create unique index if not exists idx_email_signatures_shared_scope
  on email_signatures(company_id,shared_inbox_id)
  where email_account_type='shared_email_account';

create table if not exists email_ingestion_jobs (
  ingestion_job_id uuid primary key,
  company_id uuid not null,
  email_connection_id uuid not null,
  email_thread_id uuid,
  provider_message_id text not null,
  provider_thread_id text not null default '',
  priority smallint not null default 30,
  status text not null default 'accepted',
	provider_attempt_count integer not null default 0,
	attempt_token uuid,
	enqueue_source_id text not null default '',
	sqs_accepted_timestamp timestamptz,
	last_error text not null default '',
  completed_timestamp timestamptz,
  failed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  foreign key (company_id,email_connection_id)
    references email_connections(company_id,email_connection_id) on delete cascade,
  foreign key (company_id,email_thread_id)
    references email_threads(company_id,email_thread_id) on delete set null,
  constraint email_ingestion_jobs_message_chk check (btrim(provider_message_id)<>''),
  constraint email_ingestion_jobs_priority_chk check (priority between 0 and 100),
  constraint email_ingestion_jobs_status_chk check (
    status in ('accepted','processing','completed','parked','exhausted')
  ),
	constraint email_ingestion_jobs_provider_attempt_chk check (provider_attempt_count between 0 and 3)
);
create unique index if not exists idx_email_ingestion_jobs_stable_message
  on email_ingestion_jobs(company_id,email_connection_id,provider_message_id);
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

-- Active final links take a row lock on the attachment and reject any attachment
-- already marked for cleanup. This closes the relink-versus-cleanup race.
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
  elsif new.resource_type='project_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from project_textbox_chats
                     where company_id=new.company_id
                       and chat_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end
                       and deleted_timestamp is null) then
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

drop trigger if exists trg_node_view_version_textboxes on node_textboxes;
create trigger trg_node_view_version_textboxes after insert or update or delete on node_textboxes
for each row execute function mangorts_trg_bump_node_view_from_direct_node();

drop trigger if exists trg_node_view_version_textbox_chats on node_textbox_chats;
create trigger trg_node_view_version_textbox_chats after insert or update or delete on node_textbox_chats
for each row execute function mangorts_trg_bump_node_view_from_direct_node();

-- BEGIN V2 GVIC AND PERMISSIONS STEP 1 PHASE-APPROPRIATE SCHEMA

-- V2 GVIC and permissions Step 1: additive destination storage only.
-- Runtime readers/writers continue to use the legacy policy tables until Step 2.

do $$
declare
  spec record;
  actual_count integer;
  missing_count integer;
  extra_count integer;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'v2_policy_step1_unsupported_postgresql_version:%', current_setting('server_version');
  end if;

  for spec in
    select key as table_name, value as expected_columns
    from jsonb_each($shape$
      {
        "companies":["company_id","name","created_timestamp","updated_timestamp"],
        "users":["user_id","cognito_subject","email","display_name","created_timestamp","updated_timestamp"],
        "company_memberships":["company_id","user_id","role","created_timestamp","updated_timestamp"],
        "company_user_groups":["company_id","group_id","parent_group_id","name","position","created_timestamp","updated_timestamp"],
        "company_user_group_members":["company_id","group_id","user_id","created_timestamp","updated_timestamp"],
        "nodes":["company_id","node_id","name","status","due_date","priority","default_access","created_timestamp"],
        "logic_gates":["company_id","logic_gate_id","header","default_access","created_timestamp"],
        "projects":["company_id","project_id","name","status","health","default_access","created_timestamp","updated_timestamp"],
        "company_explorer_folders":["company_id","folder_id","parent_folder_id","name","default_access","position","created_by_user_id","created_timestamp","updated_timestamp"],
        "company_explorer_items":["company_id","item_id","parent_folder_id","target_type","target_id","position","created_by_user_id","created_timestamp","updated_timestamp"],
        "shared_inbox_folders":["company_id","folder_id","parent_folder_id","name","default_access","position","created_timestamp","updated_timestamp"],
        "shared_inboxes":["company_id","shared_inbox_id","parent_folder_id","name","account_email","company_email_connection_id","default_access","position","created_timestamp","updated_timestamp"],
        "node_logic_gate_assignments":["assignment_id","company_id","node_id","logic_gate_id","status_key","column_id","is_issue","position","compatibility_board_id","compatibility_card_id","requested_by_user_id","placed_by_user_id","version","created_timestamp","updated_timestamp"],
        "resource_gvic_assignments":["company_id","resource_type","resource_id","role","principal_type","principal_id","created_timestamp","updated_timestamp"],
        "resource_gvic_effective_assignments":["company_id","resource_type","resource_id","role","user_id","source_resource_type","source_resource_id","source_principal_type","source_principal_id","inheritance_type","updated_timestamp"],
        "resource_gvic_policy_revisions":["company_id","resource_type","resource_id","policy_sequence","updated_timestamp"],
        "resource_gvic_subtree_applications":["application_id","policy_sequence","company_id","ancestor_resource_type","ancestor_resource_id","role","principal_type","principal_id","deleted","snapshot","created_timestamp"],
        "resource_permissions":["company_id","resource_type","resource_id","subject_type","subject_id","user_id","access_level","created_timestamp","updated_timestamp"],
        "resource_permission_policy_revisions":["company_id","resource_type","resource_id","policy_sequence","updated_timestamp"],
        "resource_permission_subtree_applications":["application_id","policy_sequence","company_id","ancestor_resource_type","ancestor_resource_id","rule_key","subject_type","subject_id","access_level","deleted","created_timestamp"]
      }
    $shape$::jsonb)
  loop
    if to_regclass('public.' || spec.table_name) is null then
      raise exception 'v2_policy_step1_missing_source_table:%', spec.table_name;
    end if;
    select count(*) into actual_count
    from information_schema.columns
    where table_schema='public' and table_name=spec.table_name;
    select count(*) into missing_count
    from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public'
        and actual.table_name=spec.table_name
        and actual.column_name=expected.column_name
    );
    select count(*) into extra_count
    from information_schema.columns actual
    where actual.table_schema='public'
      and actual.table_name=spec.table_name
      and not exists (
        select 1 from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
        where expected.column_name=actual.column_name
      );
    if actual_count <> jsonb_array_length(spec.expected_columns)
       or missing_count <> 0 or extra_count <> 0 then
      raise exception 'v2_policy_step1_source_schema_drift:%:expected=%:actual=%:missing=%:extra=%',
        spec.table_name, jsonb_array_length(spec.expected_columns), actual_count, missing_count, extra_count;
    end if;
  end loop;

  for spec in
    select key as table_name, value as expected_columns
    from jsonb_each($shape$
      {
        "resource_gvic_settings":["company_id","resource_type","resource_id","assignment_mode","customized_sequence","parent_link_sequence","descendant_reset_sequence","created_timestamp","updated_timestamp"],
        "resource_permission_settings":["company_id","resource_type","resource_id","permission_mode","default_access","customized_sequence","parent_link_sequence","descendant_reset_sequence","created_timestamp","updated_timestamp"],
        "resource_gvic_assignments_v2_staging":["company_id","resource_type","resource_id","role","principal_type","principal_id","created_timestamp","updated_timestamp"],
        "resource_permissions_v2_staging":["company_id","resource_type","resource_id","subject_type","subject_id","access_level","created_timestamp","updated_timestamp"]
      }
    $shape$::jsonb)
  loop
    if to_regclass('public.' || spec.table_name) is not null then
      select count(*) into actual_count
      from information_schema.columns
      where table_schema='public' and table_name=spec.table_name;
      select count(*) into missing_count
      from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
      where not exists (
        select 1 from information_schema.columns actual
        where actual.table_schema='public'
          and actual.table_name=spec.table_name
          and actual.column_name=expected.column_name
      );
      select count(*) into extra_count
      from information_schema.columns actual
      where actual.table_schema='public'
        and actual.table_name=spec.table_name
        and not exists (
          select 1 from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
          where expected.column_name=actual.column_name
        );
      if actual_count <> jsonb_array_length(spec.expected_columns)
         or missing_count <> 0 or extra_count <> 0 then
        raise exception 'v2_policy_step1_destination_schema_drift:%:expected=%:actual=%:missing=%:extra=%',
          spec.table_name, jsonb_array_length(spec.expected_columns), actual_count, missing_count, extra_count;
      end if;
    end if;
  end loop;
end;
$$;

create sequence if not exists resource_gvic_change_sequence;
create sequence if not exists resource_permission_change_sequence;

create table if not exists resource_gvic_settings (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  assignment_mode text not null,
  customized_sequence bigint,
  parent_link_sequence bigint not null,
  descendant_reset_sequence bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  constraint resource_gvic_settings_resource_type_chk check (resource_type in (
    'node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox'
  )),
  constraint resource_gvic_settings_assignment_mode_chk check (assignment_mode in ('inherited','customized')),
  constraint resource_gvic_settings_mode_shape_chk check (
    (assignment_mode='inherited' and customized_sequence is null)
    or (assignment_mode='customized' and customized_sequence is not null and customized_sequence > 0)
  ),
  constraint resource_gvic_settings_parent_sequence_chk check (parent_link_sequence >= 0),
  constraint resource_gvic_settings_reset_sequence_chk check (descendant_reset_sequence >= 0)
);

create index if not exists idx_resource_gvic_settings_customized_sequence
  on resource_gvic_settings(company_id,resource_type,resource_id,customized_sequence);
create index if not exists idx_resource_gvic_settings_reset_sequence
  on resource_gvic_settings(company_id,resource_type,resource_id,descendant_reset_sequence)
  where descendant_reset_sequence > 0;

create table if not exists resource_permission_settings (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  permission_mode text not null,
  default_access text,
  customized_sequence bigint,
  parent_link_sequence bigint not null,
  descendant_reset_sequence bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  constraint resource_permission_settings_resource_type_chk check (resource_type in (
    'node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox'
  )),
  constraint resource_permission_settings_permission_mode_chk check (permission_mode in ('inherited','customized')),
  constraint resource_permission_settings_default_access_chk check (default_access is null or default_access in ('edit','no_access')),
  constraint resource_permission_settings_mode_shape_chk check (
    (permission_mode='inherited' and customized_sequence is null and default_access is null)
    or (
      permission_mode='customized'
      and customized_sequence is not null and customized_sequence > 0
      and default_access in ('edit','no_access')
    )
  ),
  constraint resource_permission_settings_parent_sequence_chk check (parent_link_sequence >= 0),
  constraint resource_permission_settings_reset_sequence_chk check (descendant_reset_sequence >= 0)
);

create index if not exists idx_resource_permission_settings_customized_sequence
  on resource_permission_settings(company_id,resource_type,resource_id,customized_sequence);
create index if not exists idx_resource_permission_settings_reset_sequence
  on resource_permission_settings(company_id,resource_type,resource_id,descendant_reset_sequence)
  where descendant_reset_sequence > 0;

create table if not exists resource_gvic_assignments_v2_staging (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  principal_type text not null,
  principal_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id,resource_type,resource_id,role,principal_type,principal_id),
  foreign key (company_id,resource_type,resource_id)
    references resource_gvic_settings(company_id,resource_type,resource_id) on delete cascade,
  constraint resource_gvic_assignments_v2_staging_role_chk
    check (role in ('generated','verified','consulted','informed')),
  constraint resource_gvic_assignments_v2_staging_principal_type_chk
    check (principal_type in ('user','group')),
  constraint resource_gvic_assignments_v2_staging_user_only_role_chk
    check (role not in ('generated','verified') or principal_type='user')
);

create unique index if not exists idx_resource_gvic_assignments_v2_one_role_per_principal
  on resource_gvic_assignments_v2_staging(company_id,resource_type,resource_id,principal_type,principal_id);
create unique index if not exists idx_resource_gvic_assignments_v2_one_generated
  on resource_gvic_assignments_v2_staging(company_id,resource_type,resource_id)
  where role='generated';
create index if not exists idx_resource_gvic_assignments_v2_principal
  on resource_gvic_assignments_v2_staging(company_id,principal_type,principal_id,role,resource_type,resource_id);

create table if not exists resource_permissions_v2_staging (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  subject_type text not null,
  subject_id uuid not null,
  access_level text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id,resource_type,resource_id,subject_type,subject_id),
  foreign key (company_id,resource_type,resource_id)
    references resource_permission_settings(company_id,resource_type,resource_id) on delete cascade,
  constraint resource_permissions_v2_staging_subject_type_chk check (subject_type in ('user','group')),
  constraint resource_permissions_v2_staging_access_level_chk check (access_level in ('edit','no_access'))
);

create index if not exists idx_resource_permissions_v2_subject
  on resource_permissions_v2_staging(company_id,subject_type,subject_id,access_level,resource_type,resource_id);

create or replace function mangorts_v2_policy_resource_exists(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language sql
stable
set search_path=public,pg_temp
as $$
  select case p_resource_type
    when 'node' then exists(select 1 from nodes where company_id=p_company_id and node_id=p_resource_id)
    when 'logic_gate' then exists(select 1 from logic_gates where company_id=p_company_id and logic_gate_id=p_resource_id)
    when 'project' then exists(select 1 from projects where company_id=p_company_id and project_id=p_resource_id)
    when 'company_explorer_folder' then exists(select 1 from company_explorer_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox_folder' then exists(select 1 from shared_inbox_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox' then exists(select 1 from shared_inboxes where company_id=p_company_id and shared_inbox_id=p_resource_id)
    else false
  end;
$$;

create or replace function mangorts_v2_policy_parent(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(parent_resource_type text,parent_resource_id uuid)
language sql
stable
set search_path=public,pg_temp
as $$
  select 'logic_gate'::text, assignment.logic_gate_id
  from node_logic_gate_assignments assignment
  where p_resource_type='node'
    and assignment.company_id=p_company_id
    and assignment.node_id=p_resource_id
  union all
  select 'company_explorer_folder'::text, item.parent_folder_id
  from company_explorer_items item
  where p_resource_type in ('logic_gate','project')
    and item.company_id=p_company_id
    and item.target_type=p_resource_type
    and item.target_id=p_resource_id
    and item.parent_folder_id is not null
  union all
  select 'company_explorer_folder'::text, folder.parent_folder_id
  from company_explorer_folders folder
  where p_resource_type='company_explorer_folder'
    and folder.company_id=p_company_id
    and folder.folder_id=p_resource_id
    and folder.parent_folder_id is not null
  union all
  select 'shared_inbox_folder'::text, folder.parent_folder_id
  from shared_inbox_folders folder
  where p_resource_type='shared_inbox_folder'
    and folder.company_id=p_company_id
    and folder.folder_id=p_resource_id
    and folder.parent_folder_id is not null
  union all
  select 'shared_inbox_folder'::text, inbox.parent_folder_id
  from shared_inboxes inbox
  where p_resource_type='shared_inbox'
    and inbox.company_id=p_company_id
    and inbox.shared_inbox_id=p_resource_id
    and inbox.parent_folder_id is not null;
$$;

create or replace function mangorts_v2_policy_resource_has_cycle(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language plpgsql
stable
set search_path=public,pg_temp
as $$
declare
  current_type text := p_resource_type;
  current_id uuid := p_resource_id;
  next_type text;
  next_id uuid;
  path text[] := array[]::text[];
  steps integer := 0;
begin
  loop
    if current_type || ':' || current_id::text = any(path) then
      return true;
    end if;
    path := array_append(path,current_type || ':' || current_id::text);
    select parent_resource_type,parent_resource_id into next_type,next_id
    from mangorts_v2_policy_parent(p_company_id,current_type,current_id);
    if not found then
      return false;
    end if;
    current_type := next_type;
    current_id := next_id;
    steps := steps + 1;
    if steps > 1000 then
      return true;
    end if;
  end loop;
end;
$$;

create or replace function mangorts_v2_validate_policy_settings()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  parent_type text;
  parent_id uuid;
  stored_mode text;
begin
  if not mangorts_v2_policy_resource_exists(new.company_id,new.resource_type,new.resource_id) then
    raise exception 'v2_policy_resource_missing:%:%:%', new.company_id,new.resource_type,new.resource_id
      using errcode='23503';
  end if;
  if mangorts_v2_policy_resource_has_cycle(new.company_id,new.resource_type,new.resource_id) then
    raise exception 'v2_policy_resource_cycle:%:%:%', new.company_id,new.resource_type,new.resource_id
      using errcode='23514';
  end if;
  select parent_resource_type,parent_resource_id into parent_type,parent_id
  from mangorts_v2_policy_parent(new.company_id,new.resource_type,new.resource_id);
  stored_mode := to_jsonb(new)->>(case when tg_table_name='resource_gvic_settings'
    then 'assignment_mode' else 'permission_mode' end);
  if found then
    if new.parent_link_sequence <= 0 then
      raise exception 'v2_policy_child_parent_link_sequence_required:%:%',new.resource_type,new.resource_id
        using errcode='23514';
    end if;
  else
    if new.parent_link_sequence <> 0 then
      raise exception 'v2_policy_root_parent_link_sequence_must_be_zero:%:%',new.resource_type,new.resource_id
        using errcode='23514';
    end if;
    if stored_mode='inherited' then
      raise exception 'v2_policy_root_cannot_be_inherited:%:%',new.resource_type,new.resource_id
        using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_resource_gvic_settings_validate on resource_gvic_settings;
create trigger trg_resource_gvic_settings_validate
before insert or update on resource_gvic_settings
for each row execute function mangorts_v2_validate_policy_settings();

drop trigger if exists trg_resource_permission_settings_validate on resource_permission_settings;
create trigger trg_resource_permission_settings_validate
before insert or update on resource_permission_settings
for each row execute function mangorts_v2_validate_policy_settings();

create or replace function mangorts_v2_validate_policy_edge()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  principal_kind text;
  principal_value uuid;
  customized boolean;
begin
  if tg_table_name='resource_gvic_assignments_v2_staging' then
    principal_kind := new.principal_type;
    principal_value := new.principal_id;
    select assignment_mode='customized' into customized
    from resource_gvic_settings
    where company_id=new.company_id and resource_type=new.resource_type and resource_id=new.resource_id;
  else
    principal_kind := new.subject_type;
    principal_value := new.subject_id;
    select permission_mode='customized' into customized
    from resource_permission_settings
    where company_id=new.company_id and resource_type=new.resource_type and resource_id=new.resource_id;
  end if;
  if customized is distinct from true then
    raise exception 'v2_policy_edge_requires_customized_settings:%:%',new.resource_type,new.resource_id
      using errcode='23514';
  end if;
  if principal_kind='user' and not exists (
    select 1 from company_memberships
    where company_id=new.company_id and user_id=principal_value
  ) then
    raise exception 'v2_policy_user_not_company_member:%:%',new.company_id,principal_value
      using errcode='23503';
  end if;
  if principal_kind='group' and not exists (
    select 1 from company_user_groups
    where company_id=new.company_id and group_id=principal_value
  ) then
    raise exception 'v2_policy_group_missing:%:%',new.company_id,principal_value
      using errcode='23503';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_resource_gvic_assignments_v2_validate on resource_gvic_assignments_v2_staging;
create trigger trg_resource_gvic_assignments_v2_validate
before insert or update on resource_gvic_assignments_v2_staging
for each row execute function mangorts_v2_validate_policy_edge();

drop trigger if exists trg_resource_permissions_v2_validate on resource_permissions_v2_staging;
create trigger trg_resource_permissions_v2_validate
before insert or update on resource_permissions_v2_staging
for each row execute function mangorts_v2_validate_policy_edge();

-- Migration-only legacy resolvers for V2 GVIC and permissions Step 1.
-- These reproduce deployed latest-snapshot and direct-revision behavior.

create or replace function mangorts_v2_step1_resolved_gvic(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  role text,
  principal_type text,
  principal_id uuid,
  created_timestamp timestamptz,
  updated_timestamp timestamptz
)
language sql
stable
set search_path=public,pg_temp
as $$
  with requested(company_id,resource_type,legacy_resource_type,resource_id) as (
    select p_company_id,
           p_resource_type,
           case when p_resource_type='shared_inbox_folder' then 'shared_triage_folder' else p_resource_type end,
           p_resource_id
  ),
  direct_sequence(policy_sequence) as (
    select coalesce((
      select revision.policy_sequence
      from resource_gvic_policy_revisions revision
      join requested req
        on revision.company_id=req.company_id
       and revision.resource_type=req.legacy_resource_type
       and revision.resource_id=req.resource_id
    ),0)
  ),
  resource_policy_ancestors(resource_type,resource_id) as (
    select 'logic_gate'::text, assignment.logic_gate_id
    from node_logic_gate_assignments assignment
    join requested req
      on req.resource_type='node'
     and assignment.company_id=req.company_id
     and assignment.node_id=req.resource_id
  ),
  latest_snapshot_application(policy_sequence) as (
    select max(app.policy_sequence)
    from resource_gvic_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.snapshot
  ),
  direct_assignments as (
    select assignment.role,
           assignment.principal_type,
           assignment.principal_id,
           assignment.created_timestamp,
           assignment.updated_timestamp,
           assignment.role || ':' || assignment.principal_type || ':' || assignment.principal_id::text as rule_key
    from resource_gvic_assignments assignment
    join requested req
      on assignment.company_id=req.company_id
     and assignment.resource_type=req.legacy_resource_type
     and assignment.resource_id=req.resource_id
  ),
  application_rules as (
    select distinct on (app.role,app.principal_type,app.principal_id)
           app.role,
           app.principal_type,
           app.principal_id,
           app.deleted,
           app.created_timestamp,
           app.created_timestamp as updated_timestamp,
           app.role || ':' || app.principal_type || ':' || app.principal_id::text as rule_key
    from resource_gvic_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type
     and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where not app.snapshot
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application),0)
    order by app.role,app.principal_type,app.principal_id,app.policy_sequence desc,app.application_id desc
  ),
  merged_assignments as (
    select direct.role,direct.principal_type,direct.principal_id,direct.created_timestamp,direct.updated_timestamp
    from direct_assignments direct
    where not exists (select 1 from latest_snapshot_application where policy_sequence is not null)
      and not exists (select 1 from application_rules app where app.rule_key=direct.rule_key)
    union all
    select app.role,app.principal_type,app.principal_id,app.created_timestamp,app.updated_timestamp
    from application_rules app
    where not app.deleted
  )
  select merged.role,merged.principal_type,merged.principal_id,
         merged.created_timestamp,merged.updated_timestamp
  from merged_assignments merged
  order by merged.role,merged.principal_type,merged.principal_id;
$$;

create or replace function mangorts_v2_step1_resolved_permission_default(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns text
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive requested(company_id,resource_type,resource_id) as (
    select p_company_id,p_resource_type,p_resource_id
  ),
  direct_default(default_access) as (
    select node.default_access from nodes node,requested req
    where req.resource_type='node' and node.company_id=req.company_id and node.node_id=req.resource_id
    union all
    select gate.default_access from logic_gates gate,requested req
    where req.resource_type='logic_gate' and gate.company_id=req.company_id and gate.logic_gate_id=req.resource_id
    union all
    select project.default_access from projects project,requested req
    where req.resource_type='project' and project.company_id=req.company_id and project.project_id=req.resource_id
    union all
    select folder.default_access from company_explorer_folders folder,requested req
    where req.resource_type='company_explorer_folder' and folder.company_id=req.company_id and folder.folder_id=req.resource_id
    union all
    select folder.default_access from shared_inbox_folders folder,requested req
    where req.resource_type='shared_inbox_folder' and folder.company_id=req.company_id and folder.folder_id=req.resource_id
    union all
    select inbox.default_access from shared_inboxes inbox,requested req
    where req.resource_type='shared_inbox' and inbox.company_id=req.company_id and inbox.shared_inbox_id=req.resource_id
  ),
  direct_sequence(policy_sequence) as (
    select coalesce((
      select revision.policy_sequence from resource_permission_policy_revisions revision,requested req
      where revision.company_id=req.company_id
        and revision.resource_type=req.resource_type
        and revision.resource_id=req.resource_id
    ),0)
  ),
  node_logic_gate_ancestors(logic_gate_id) as (
    select assignment.logic_gate_id
    from node_logic_gate_assignments assignment,requested req
    where req.resource_type='node'
      and assignment.company_id=req.company_id
      and assignment.node_id=req.resource_id
  ),
  folder_seeds(folder_id) as (
    select folder.parent_folder_id
    from company_explorer_folders folder,requested req
    where req.resource_type='company_explorer_folder'
      and folder.company_id=req.company_id
      and folder.folder_id=req.resource_id
      and folder.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item,requested req
    where req.resource_type in ('project','logic_gate')
      and item.company_id=req.company_id
      and item.target_type=req.resource_type
      and item.target_id=req.resource_id
      and item.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item
    join node_logic_gate_ancestors gate
      on item.target_type='logic_gate' and item.target_id=gate.logic_gate_id
    join requested req on item.company_id=req.company_id
    where item.parent_folder_id is not null
  ),
  folder_ancestors(folder_id,path) as (
    select folder_id,array[folder_id] from folder_seeds
    union all
    select parent.parent_folder_id,ancestor.path || parent.parent_folder_id
    from folder_ancestors ancestor
    join requested req on true
    join company_explorer_folders parent
      on parent.company_id=req.company_id and parent.folder_id=ancestor.folder_id
    where parent.parent_folder_id is not null
      and not parent.parent_folder_id=any(ancestor.path)
  ),
  resource_policy_ancestors(resource_type,resource_id) as (
    select 'logic_gate'::text,logic_gate_id from node_logic_gate_ancestors
    union
    select 'company_explorer_folder'::text,folder_id from folder_ancestors
  ),
  latest_snapshot_application(policy_sequence) as (
    select max(app.policy_sequence)
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.rule_key='__snapshot__'
  ),
  latest_default_application(access_level) as (
    select app.access_level
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.rule_key='__default__'
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application),0)
    order by app.policy_sequence desc,app.application_id desc
    limit 1
  )
  select coalesce((select access_level from latest_default_application),(select default_access from direct_default limit 1));
$$;

create or replace function mangorts_v2_step1_resolved_permissions(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  subject_type text,
  subject_id uuid,
  access_level text,
  created_timestamp timestamptz,
  updated_timestamp timestamptz
)
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive requested(company_id,resource_type,resource_id) as (
    select p_company_id,p_resource_type,p_resource_id
  ),
  direct_sequence(policy_sequence) as (
    select coalesce((
      select revision.policy_sequence from resource_permission_policy_revisions revision,requested req
      where revision.company_id=req.company_id
        and revision.resource_type=req.resource_type
        and revision.resource_id=req.resource_id
    ),0)
  ),
  node_logic_gate_ancestors(logic_gate_id) as (
    select assignment.logic_gate_id
    from node_logic_gate_assignments assignment,requested req
    where req.resource_type='node'
      and assignment.company_id=req.company_id
      and assignment.node_id=req.resource_id
  ),
  folder_seeds(folder_id) as (
    select folder.parent_folder_id
    from company_explorer_folders folder,requested req
    where req.resource_type='company_explorer_folder'
      and folder.company_id=req.company_id
      and folder.folder_id=req.resource_id
      and folder.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item,requested req
    where req.resource_type in ('project','logic_gate')
      and item.company_id=req.company_id
      and item.target_type=req.resource_type
      and item.target_id=req.resource_id
      and item.parent_folder_id is not null
    union
    select item.parent_folder_id
    from company_explorer_items item
    join node_logic_gate_ancestors gate
      on item.target_type='logic_gate' and item.target_id=gate.logic_gate_id
    join requested req on item.company_id=req.company_id
    where item.parent_folder_id is not null
  ),
  folder_ancestors(folder_id,path) as (
    select folder_id,array[folder_id] from folder_seeds
    union all
    select parent.parent_folder_id,ancestor.path || parent.parent_folder_id
    from folder_ancestors ancestor
    join requested req on true
    join company_explorer_folders parent
      on parent.company_id=req.company_id and parent.folder_id=ancestor.folder_id
    where parent.parent_folder_id is not null
      and not parent.parent_folder_id=any(ancestor.path)
  ),
  resource_policy_ancestors(resource_type,resource_id) as (
    select 'logic_gate'::text,logic_gate_id from node_logic_gate_ancestors
    union
    select 'company_explorer_folder'::text,folder_id from folder_ancestors
  ),
  latest_snapshot_application(policy_sequence) as (
    select max(app.policy_sequence)
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.rule_key='__snapshot__'
  ),
  direct_assignments as (
    select access.subject_type,access.subject_id,access.access_level,
           access.created_timestamp,access.updated_timestamp,
           access.subject_type || ':' || access.subject_id::text as rule_key
    from resource_permissions access,requested req
    where access.company_id=req.company_id
      and access.resource_type=req.resource_type
      and access.resource_id=req.resource_id
  ),
  application_rules as (
    select distinct on (app.rule_key)
           app.rule_key,app.subject_type,app.subject_id,app.access_level,app.deleted,
           app.created_timestamp,app.created_timestamp as updated_timestamp
    from resource_permission_subtree_applications app
    join resource_policy_ancestors ancestor
      on ancestor.resource_type=app.ancestor_resource_type and ancestor.resource_id=app.ancestor_resource_id
    join requested req on app.company_id=req.company_id
    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
    where app.rule_key not in ('__default__','__snapshot__')
      and app.policy_sequence >= coalesce((select policy_sequence from latest_snapshot_application),0)
    order by app.rule_key,app.policy_sequence desc,app.application_id desc
  ),
  merged_assignments as (
    select direct.subject_type,direct.subject_id,direct.access_level,direct.created_timestamp,direct.updated_timestamp
    from direct_assignments direct
    where not exists (select 1 from latest_snapshot_application where policy_sequence is not null)
      and not exists (select 1 from application_rules app where app.rule_key=direct.rule_key)
    union all
    select app.subject_type,app.subject_id,app.access_level,app.created_timestamp,app.updated_timestamp
    from application_rules app
    where not app.deleted
  )
  select merged.subject_type,merged.subject_id,merged.access_level,
         merged.created_timestamp,merged.updated_timestamp
  from merged_assignments merged
  order by merged.subject_type,merged.subject_id;
$$;

-- END V2 GVIC AND PERMISSIONS STEP 1 PHASE-APPROPRIATE SCHEMA

-- BEGIN V2 GVIC AND PERMISSIONS STEP 2 CUTOVER SCHEMA
-- V2 GVIC and permissions Step 2: atomic graph cutover and runtime contract.
-- Run only after the final Step 1 preflight and delta copy both return READY.
begin;


do $$
declare
  spec record;
  actual_count integer;
  missing_count integer;
  extra_count integer;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'v2_policy_step2_unsupported_postgresql_version:%', current_setting('server_version');
  end if;

  for spec in
    select key as table_name, value as expected_columns
    from jsonb_each($shape$
      {
        "resource_gvic_assignments":["company_id","resource_type","resource_id","role","principal_type","principal_id","created_timestamp","updated_timestamp"],
        "resource_permissions":["company_id","resource_type","resource_id","subject_type","subject_id","user_id","access_level","created_timestamp","updated_timestamp"],
        "resource_gvic_settings":["company_id","resource_type","resource_id","assignment_mode","customized_sequence","parent_link_sequence","descendant_reset_sequence","created_timestamp","updated_timestamp"],
        "resource_permission_settings":["company_id","resource_type","resource_id","permission_mode","default_access","customized_sequence","parent_link_sequence","descendant_reset_sequence","created_timestamp","updated_timestamp"],
        "resource_gvic_assignments_v2_staging":["company_id","resource_type","resource_id","role","principal_type","principal_id","created_timestamp","updated_timestamp"],
        "resource_permissions_v2_staging":["company_id","resource_type","resource_id","subject_type","subject_id","access_level","created_timestamp","updated_timestamp"]
      }
    $shape$::jsonb)
  loop
    if to_regclass('public.' || spec.table_name) is null then
      raise exception 'v2_policy_step2_missing_cutover_table:%', spec.table_name;
    end if;
    select count(*) into actual_count
    from information_schema.columns
    where table_schema='public' and table_name=spec.table_name;
    select count(*) into missing_count
    from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public'
        and actual.table_name=spec.table_name
        and actual.column_name=expected.column_name
    );
    select count(*) into extra_count
    from information_schema.columns actual
    where actual.table_schema='public'
      and actual.table_name=spec.table_name
      and not exists (
        select 1 from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
        where expected.column_name=actual.column_name
      );
    if actual_count <> jsonb_array_length(spec.expected_columns)
       or missing_count <> 0 or extra_count <> 0 then
      raise exception 'v2_policy_step2_schema_drift:%:expected=%:actual=%:missing=%:extra=%',
        spec.table_name, jsonb_array_length(spec.expected_columns), actual_count, missing_count, extra_count;
    end if;
  end loop;

end;
$$;

lock table resource_gvic_assignments in access exclusive mode;
lock table resource_permissions in access exclusive mode;
lock table resource_gvic_assignments_v2_staging in access exclusive mode;
lock table resource_permissions_v2_staging in access exclusive mode;
lock table resource_gvic_settings in access exclusive mode;
lock table resource_permission_settings in access exclusive mode;

alter table resource_gvic_assignments rename to resource_gvic_assignments_step2_legacy;
alter table resource_permissions rename to resource_permissions_step2_legacy;
alter table resource_gvic_assignments_v2_staging rename to resource_gvic_assignments;
alter table resource_permissions_v2_staging rename to resource_permissions;

alter trigger trg_resource_gvic_assignments_v2_validate on resource_gvic_assignments
  rename to trg_resource_gvic_assignments_validate;
alter trigger trg_resource_permissions_v2_validate on resource_permissions
  rename to trg_resource_permissions_validate;

create or replace function mangorts_v2_validate_policy_edge()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  principal_kind text;
  principal_value uuid;
  customized boolean;
begin
  if tg_table_name='resource_gvic_assignments' then
    principal_kind := new.principal_type;
    principal_value := new.principal_id;
    select assignment_mode='customized' into customized
    from resource_gvic_settings
    where company_id=new.company_id and resource_type=new.resource_type and resource_id=new.resource_id;
  else
    principal_kind := new.subject_type;
    principal_value := new.subject_id;
    select permission_mode='customized' into customized
    from resource_permission_settings
    where company_id=new.company_id and resource_type=new.resource_type and resource_id=new.resource_id;
  end if;
  if customized is distinct from true then
    raise exception 'v2_policy_edge_requires_customized_settings:%:%',new.resource_type,new.resource_id
      using errcode='23514';
  end if;
  if principal_kind='user' and not exists (
    select 1 from company_memberships
    where company_id=new.company_id and user_id=principal_value
  ) then
    raise exception 'v2_policy_user_not_company_member:%:%',new.company_id,principal_value
      using errcode='23503';
  end if;
  if principal_kind='group' and not exists (
    select 1 from company_user_groups
    where company_id=new.company_id and group_id=principal_value
  ) then
    raise exception 'v2_policy_group_missing:%:%',new.company_id,principal_value
      using errcode='23503';
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_resolve_gvic_policy(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  source_resource_type text,
  source_resource_id uuid,
  source_customized_sequence bigint,
  reset_resource_type text,
  reset_resource_id uuid,
  reset_sequence bigint,
  overwritten_resource_type text,
  overwritten_resource_id uuid,
  overwritten_sequence bigint,
  parent_link_fingerprint text
)
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive path as (
    select 0 as depth,
           setting.resource_type,
           setting.resource_id,
           setting.assignment_mode as stored_mode,
           setting.customized_sequence,
           setting.parent_link_sequence,
           setting.descendant_reset_sequence,
           array[setting.resource_type || ':' || setting.resource_id::text]::text[] as visited
    from resource_gvic_settings setting
    where setting.company_id=p_company_id
      and setting.resource_type=p_resource_type
      and setting.resource_id=p_resource_id
    union all
    select child.depth+1,
           parent_setting.resource_type,
           parent_setting.resource_id,
           parent_setting.assignment_mode,
           parent_setting.customized_sequence,
           parent_setting.parent_link_sequence,
           parent_setting.descendant_reset_sequence,
           child.visited || (parent_setting.resource_type || ':' || parent_setting.resource_id::text)
    from path child
    cross join lateral mangorts_v2_policy_parent(p_company_id,child.resource_type,child.resource_id) parent
    join resource_gvic_settings parent_setting
      on parent_setting.company_id=p_company_id
     and parent_setting.resource_type=parent.parent_resource_type
     and parent_setting.resource_id=parent.parent_resource_id
    where not (parent_setting.resource_type || ':' || parent_setting.resource_id::text)=any(child.visited)
  ),
  eligible_resets as (
    select ancestor.*
    from path ancestor
    where ancestor.depth>0
      and ancestor.descendant_reset_sequence>0
      and not exists (
        select 1 from path edge
        where edge.depth<ancestor.depth
          and edge.parent_link_sequence>ancestor.descendant_reset_sequence
      )
  ),
  active_sources as (
    select candidate.*
    from path candidate
    where candidate.stored_mode='customized'
      and not exists (
        select 1 from eligible_resets reset
        where reset.depth>candidate.depth
          and reset.descendant_reset_sequence>=candidate.customized_sequence
      )
  ),
  selected_source as (
    select * from active_sources order by depth limit 1
  ),
  selected_reset as (
    select * from eligible_resets order by descendant_reset_sequence desc,depth limit 1
  ),
  target as (
    select * from path where depth=0
  ),
  target_overwrite as (
    select reset.*
    from eligible_resets reset,target
    where target.stored_mode='customized'
      and reset.descendant_reset_sequence>=target.customized_sequence
    order by reset.descendant_reset_sequence desc,reset.depth
    limit 1
  )
  select source.resource_type,
         source.resource_id,
         source.customized_sequence,
         reset.resource_type,
         reset.resource_id,
         reset.descendant_reset_sequence,
         overwritten.resource_type,
         overwritten.resource_id,
         overwritten.descendant_reset_sequence,
         coalesce((
           select md5(string_agg(
             node.depth::text || ':' || node.resource_type || ':' || node.resource_id::text || ':' || node.parent_link_sequence::text,
             '|' order by node.depth
           ))
           from path node
         ),md5(''))
  from selected_source source
  left join selected_reset reset on true
  left join target_overwrite overwritten on true;
$$;

create or replace function mangorts_v2_resolve_permission_policy(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  source_resource_type text,
  source_resource_id uuid,
  source_customized_sequence bigint,
  reset_resource_type text,
  reset_resource_id uuid,
  reset_sequence bigint,
  overwritten_resource_type text,
  overwritten_resource_id uuid,
  overwritten_sequence bigint,
  parent_link_fingerprint text
)
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive path as (
    select 0 as depth,
           setting.resource_type,
           setting.resource_id,
           setting.permission_mode as stored_mode,
           setting.customized_sequence,
           setting.parent_link_sequence,
           setting.descendant_reset_sequence,
           array[setting.resource_type || ':' || setting.resource_id::text]::text[] as visited
    from resource_permission_settings setting
    where setting.company_id=p_company_id
      and setting.resource_type=p_resource_type
      and setting.resource_id=p_resource_id
    union all
    select child.depth+1,
           parent_setting.resource_type,
           parent_setting.resource_id,
           parent_setting.permission_mode,
           parent_setting.customized_sequence,
           parent_setting.parent_link_sequence,
           parent_setting.descendant_reset_sequence,
           child.visited || (parent_setting.resource_type || ':' || parent_setting.resource_id::text)
    from path child
    cross join lateral mangorts_v2_policy_parent(p_company_id,child.resource_type,child.resource_id) parent
    join resource_permission_settings parent_setting
      on parent_setting.company_id=p_company_id
     and parent_setting.resource_type=parent.parent_resource_type
     and parent_setting.resource_id=parent.parent_resource_id
    where not (parent_setting.resource_type || ':' || parent_setting.resource_id::text)=any(child.visited)
  ),
  eligible_resets as (
    select ancestor.*
    from path ancestor
    where ancestor.depth>0
      and ancestor.descendant_reset_sequence>0
      and not exists (
        select 1 from path edge
        where edge.depth<ancestor.depth
          and edge.parent_link_sequence>ancestor.descendant_reset_sequence
      )
  ),
  active_sources as (
    select candidate.*
    from path candidate
    where candidate.stored_mode='customized'
      and not exists (
        select 1 from eligible_resets reset
        where reset.depth>candidate.depth
          and reset.descendant_reset_sequence>=candidate.customized_sequence
      )
  ),
  selected_source as (
    select * from active_sources order by depth limit 1
  ),
  selected_reset as (
    select * from eligible_resets order by descendant_reset_sequence desc,depth limit 1
  ),
  target as (
    select * from path where depth=0
  ),
  target_overwrite as (
    select reset.*
    from eligible_resets reset,target
    where target.stored_mode='customized'
      and reset.descendant_reset_sequence>=target.customized_sequence
    order by reset.descendant_reset_sequence desc,reset.depth
    limit 1
  )
  select source.resource_type,
         source.resource_id,
         source.customized_sequence,
         reset.resource_type,
         reset.resource_id,
         reset.descendant_reset_sequence,
         overwritten.resource_type,
         overwritten.resource_id,
         overwritten.descendant_reset_sequence,
         coalesce((
           select md5(string_agg(
             node.depth::text || ':' || node.resource_type || ':' || node.resource_id::text || ':' || node.parent_link_sequence::text,
             '|' order by node.depth
           ))
           from path node
         ),md5(''))
  from selected_source source
  left join selected_reset reset on true
  left join target_overwrite overwritten on true;
$$;

create or replace function mangorts_v2_effective_gvic_assignments(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  role text,
  user_id uuid,
  source_resource_type text,
  source_resource_id uuid,
  source_principal_type text,
  source_principal_id uuid,
  inheritance_type text,
  updated_timestamp timestamptz
)
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive resolved as (
    select * from mangorts_v2_resolve_gvic_policy(p_company_id,p_resource_type,p_resource_id)
  ),
  source_edges as (
    select edge.*
    from resolved
    join resource_gvic_assignments edge
      on edge.company_id=p_company_id
     and edge.resource_type=resolved.source_resource_type
     and edge.resource_id=resolved.source_resource_id
  ),
  group_tree(role,source_principal_id,group_id,depth,path,updated_timestamp) as (
    select edge.role,edge.principal_id,edge.principal_id,0,array[edge.principal_id],edge.updated_timestamp
    from source_edges edge where edge.principal_type='group'
    union all
    select tree.role,tree.source_principal_id,child.group_id,tree.depth+1,tree.path || child.group_id,tree.updated_timestamp
    from group_tree tree
    join company_user_groups child
      on child.company_id=p_company_id and child.parent_group_id=tree.group_id
    where tree.depth<100 and not child.group_id=any(tree.path)
  ),
  candidates as (
    select edge.role,edge.principal_id as user_id,'user'::text as source_principal_type,
           edge.principal_id as source_principal_id,-1 as group_depth,edge.updated_timestamp
    from source_edges edge
    join company_memberships membership
      on edge.principal_type='user'
     and membership.company_id=p_company_id and membership.user_id=edge.principal_id
    union all
    select tree.role,member.user_id,'group',tree.source_principal_id,tree.depth,tree.updated_timestamp
    from group_tree tree
    join company_user_group_members member
      on member.company_id=p_company_id and member.group_id=tree.group_id
  ),
  winners as (
    select distinct on (candidate.user_id) candidate.*
    from candidates candidate
    order by candidate.user_id,
      case candidate.role when 'generated' then 1 when 'verified' then 2 when 'consulted' then 3 else 4 end,
      case candidate.source_principal_type when 'user' then 0 else 1 end,
      candidate.group_depth,
      candidate.source_principal_id
  )
  select winner.role,winner.user_id,resolved.source_resource_type,resolved.source_resource_id,
         winner.source_principal_type,winner.source_principal_id,
         case when resolved.source_resource_type=p_resource_type and resolved.source_resource_id=p_resource_id
              then 'direct' else 'inherited' end,
         winner.updated_timestamp
  from winners winner cross join resolved
  order by winner.user_id;
$$;

create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive resolved as (
    select * from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id)
  ),
  admin_actor as (
    select exists (
      select 1 from company_memberships membership
      where membership.user_id=p_user_id
        and (
          membership.role='dev_admin'
          or (membership.company_id=p_company_id and membership.role='company_admin')
        )
    ) as allowed
  ),
  direct_rule as (
    select access.access_level
    from resolved
    join resource_permissions access
      on access.company_id=p_company_id
     and access.resource_type=resolved.source_resource_type
     and access.resource_id=resolved.source_resource_id
     and access.subject_type='user'
     and access.subject_id=p_user_id
    limit 1
  ),
  member_groups(group_id,depth,path) as (
    select member.group_id,0,array[member.group_id]
    from company_user_group_members member
    where member.company_id=p_company_id and member.user_id=p_user_id
    union all
    select parent.parent_group_id,member.depth+1,member.path || parent.parent_group_id
    from member_groups member
    join company_user_groups parent
      on parent.company_id=p_company_id and parent.group_id=member.group_id
    where parent.parent_group_id is not null
      and member.depth<100
      and not parent.parent_group_id=any(member.path)
  ),
  group_rule as (
    select access.access_level
    from resolved
    join resource_permissions access
      on access.company_id=p_company_id
     and access.resource_type=resolved.source_resource_type
     and access.resource_id=resolved.source_resource_id
     and access.subject_type='group'
    join member_groups membership on membership.group_id=access.subject_id
    order by membership.depth,
             case access.access_level when 'no_access' then 0 else 1 end,
             access.subject_id
    limit 1
  ),
  selected_access as (
    select coalesce(
      (select access_level from direct_rule),
      (select access_level from group_rule),
      (select setting.default_access
       from resolved
       join resource_permission_settings setting
         on setting.company_id=p_company_id
        and setting.resource_type=resolved.source_resource_type
        and setting.resource_id=resolved.source_resource_id)
    ) as access_level
  )
  select case
    when p_access_level<>'edit' then false
    when (select allowed from admin_actor) then true
    else coalesce((select access_level='edit' from selected_access),false)
  end;
$$;

create or replace function mangorts_v2_group_membership_version(p_company_id uuid)
returns bigint
language sql
stable
set search_path=public,pg_temp
as $$
  select coalesce((
    select version from workspace_read_versions
    where company_id=p_company_id and scope='policy-group-membership' and resource_key=''
  ),0);
$$;

create or replace function mangorts_v2_gvic_policy_fingerprint(
  p_company_id uuid,p_resource_type text,p_resource_id uuid
)
returns text
language sql
stable
set search_path=public,pg_temp
as $$
  select md5(concat_ws(':',
    resolved.source_resource_type,resolved.source_resource_id,resolved.source_customized_sequence,
    resolved.reset_resource_type,resolved.reset_resource_id,resolved.reset_sequence,
    resolved.parent_link_fingerprint,mangorts_v2_group_membership_version(p_company_id)
  ))
  from mangorts_v2_resolve_gvic_policy(p_company_id,p_resource_type,p_resource_id) resolved;
$$;

create or replace function mangorts_v2_permission_policy_fingerprint(
  p_company_id uuid,p_resource_type text,p_resource_id uuid,p_user_id uuid
)
returns text
language sql
stable
set search_path=public,pg_temp
as $$
  select md5(concat_ws(':',
    resolved.source_resource_type,resolved.source_resource_id,resolved.source_customized_sequence,
    resolved.reset_resource_type,resolved.reset_resource_id,resolved.reset_sequence,
    resolved.parent_link_fingerprint,mangorts_v2_group_membership_version(p_company_id),p_user_id,
    mangorts_user_can_access_resource(p_company_id,p_resource_type,p_resource_id,p_user_id,'edit')
  ))
  from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id) resolved;
$$;

create or replace function mangorts_v2_initialize_policy_settings()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_resource_type text := tg_argv[0];
  v_resource_id uuid := (to_jsonb(new)->>tg_argv[1])::uuid;
  v_company_id uuid := (to_jsonb(new)->>'company_id')::uuid;
  v_parent_type text;
  v_parent_id uuid;
  v_gvic_sequence bigint;
  v_permission_sequence bigint;
begin
  if exists (
    select 1 from resource_gvic_settings
    where resource_gvic_settings.company_id=v_company_id
      and resource_gvic_settings.resource_type=v_resource_type
      and resource_gvic_settings.resource_id=v_resource_id
  ) and exists (
    select 1 from resource_permission_settings
    where resource_permission_settings.company_id=v_company_id
      and resource_permission_settings.resource_type=v_resource_type
      and resource_permission_settings.resource_id=v_resource_id
  ) then
    return new;
  end if;

  select parent_resource_type,parent_resource_id into v_parent_type,v_parent_id
  from mangorts_v2_policy_parent(v_company_id,v_resource_type,v_resource_id);

  v_gvic_sequence := nextval('resource_gvic_change_sequence');
  v_permission_sequence := nextval('resource_permission_change_sequence');

  insert into resource_gvic_settings(
    company_id,resource_type,resource_id,assignment_mode,customized_sequence,
    parent_link_sequence,descendant_reset_sequence,created_timestamp,updated_timestamp
  ) values(
    v_company_id,v_resource_type,v_resource_id,
    case when v_parent_id is null then 'customized' else 'inherited' end,
    case when v_parent_id is null then v_gvic_sequence else null end,
    case when v_parent_id is null then 0 else v_gvic_sequence end,
    0,now(),now()
  ) on conflict(company_id,resource_type,resource_id) do nothing;

  insert into resource_permission_settings(
    company_id,resource_type,resource_id,permission_mode,default_access,customized_sequence,
    parent_link_sequence,descendant_reset_sequence,created_timestamp,updated_timestamp
  ) values(
    v_company_id,v_resource_type,v_resource_id,
    case when v_parent_id is null then 'customized' else 'inherited' end,
    case when v_parent_id is null then 'edit' else null end,
    case when v_parent_id is null then v_permission_sequence else null end,
    case when v_parent_id is null then 0 else v_permission_sequence end,
    0,now(),now()
  ) on conflict(company_id,resource_type,resource_id) do nothing;
  return new;
end;
$$;

create or replace function mangorts_v2_advance_parent_link(
  p_company_id uuid,p_resource_type text,p_resource_id uuid,p_is_root boolean
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
begin
  update resource_gvic_settings
  set parent_link_sequence=case when p_is_root then 0 else nextval('resource_gvic_change_sequence') end,
      updated_timestamp=now()
  where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;

  update resource_permission_settings
  set parent_link_sequence=case when p_is_root then 0 else nextval('resource_permission_change_sequence') end,
      updated_timestamp=now()
  where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
end;
$$;

create or replace function mangorts_v2_materialize_detached_policy(
  p_company_id uuid,p_resource_type text,p_resource_id uuid
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
declare
  gvic_source_type text;
  gvic_source_id uuid;
  permission_source_type text;
  permission_source_id uuid;
  permission_default text;
  gvic_sequence bigint;
  permission_sequence bigint;
begin
  select source_resource_type,source_resource_id into gvic_source_type,gvic_source_id
  from mangorts_v2_resolve_gvic_policy(p_company_id,p_resource_type,p_resource_id);
  select source_resource_type,source_resource_id into permission_source_type,permission_source_id
  from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id);

  if gvic_source_id is null or permission_source_id is null then
    raise exception 'v2_policy_detach_resolution_failed:%:%',p_resource_type,p_resource_id;
  end if;

  if gvic_source_type<>p_resource_type or gvic_source_id<>p_resource_id then
    gvic_sequence := nextval('resource_gvic_change_sequence');
    delete from resource_gvic_assignments
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    update resource_gvic_settings
    set assignment_mode='customized',customized_sequence=gvic_sequence,updated_timestamp=now()
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    insert into resource_gvic_assignments(
      company_id,resource_type,resource_id,role,principal_type,principal_id,created_timestamp,updated_timestamp
    )
    select p_company_id,p_resource_type,p_resource_id,role,principal_type,principal_id,now(),now()
    from resource_gvic_assignments
    where company_id=p_company_id and resource_type=gvic_source_type and resource_id=gvic_source_id;
  end if;

  if permission_source_type<>p_resource_type or permission_source_id<>p_resource_id then
    select default_access into permission_default
    from resource_permission_settings
    where company_id=p_company_id and resource_type=permission_source_type and resource_id=permission_source_id;
    permission_sequence := nextval('resource_permission_change_sequence');
    delete from resource_permissions
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    update resource_permission_settings
    set permission_mode='customized',default_access=permission_default,
        customized_sequence=permission_sequence,updated_timestamp=now()
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    insert into resource_permissions(
      company_id,resource_type,resource_id,subject_type,subject_id,access_level,created_timestamp,updated_timestamp
    )
    select p_company_id,p_resource_type,p_resource_id,subject_type,subject_id,access_level,now(),now()
    from resource_permissions
    where company_id=p_company_id and resource_type=permission_source_type and resource_id=permission_source_id;
  end if;
end;
$$;

create or replace function mangorts_v2_resource_deleted_cleanup()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  resource_type text := tg_argv[0];
  resource_id uuid := (to_jsonb(old)->>tg_argv[1])::uuid;
  company_id uuid := (to_jsonb(old)->>'company_id')::uuid;
begin
  delete from resource_gvic_settings
  where resource_gvic_settings.company_id=company_id
    and resource_gvic_settings.resource_type=resource_type
    and resource_gvic_settings.resource_id=resource_id;
  delete from resource_permission_settings
  where resource_permission_settings.company_id=company_id
    and resource_permission_settings.resource_type=resource_type
    and resource_permission_settings.resource_id=resource_id;
  return old;
end;
$$;

create or replace function mangorts_v2_node_parent_link_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    perform mangorts_v2_materialize_detached_policy(old.company_id,'node',old.node_id);
    return old;
  end if;
  if tg_op='INSERT' then
    perform mangorts_v2_advance_parent_link(new.company_id,'node',new.node_id,false);
  elsif old.logic_gate_id is distinct from new.logic_gate_id then
    perform mangorts_v2_advance_parent_link(new.company_id,'node',new.node_id,false);
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_node_parent_link_removed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  perform mangorts_v2_advance_parent_link(old.company_id,'node',old.node_id,true);
  return old;
end;
$$;

create or replace function mangorts_v2_company_item_parent_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.target_type in ('logic_gate','project') then
    perform mangorts_v2_materialize_detached_policy(old.company_id,old.target_type,old.target_id);
  end if;
  return old;
end;
$$;

create or replace function mangorts_v2_company_item_parent_saved()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.target_type in ('logic_gate','project') and tg_op='INSERT' then
    perform mangorts_v2_advance_parent_link(new.company_id,new.target_type,new.target_id,false);
  elsif new.target_type in ('logic_gate','project')
     and old.parent_folder_id is distinct from new.parent_folder_id then
    perform mangorts_v2_advance_parent_link(new.company_id,new.target_type,new.target_id,false);
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_folder_parent_changing()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.parent_folder_id is not null and new.parent_folder_id is null then
    perform mangorts_v2_materialize_detached_policy(old.company_id,tg_argv[0],old.folder_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_folder_parent_saved()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='UPDATE' and old.parent_folder_id is not distinct from new.parent_folder_id then
    return new;
  end if;
  perform mangorts_v2_advance_parent_link(new.company_id,tg_argv[0],new.folder_id,new.parent_folder_id is null);
  return new;
end;
$$;

create or replace function mangorts_v2_shared_inbox_parent_changing()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.parent_folder_id is not null and new.parent_folder_id is null then
    perform mangorts_v2_materialize_detached_policy(old.company_id,'shared_inbox',old.shared_inbox_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_shared_inbox_parent_saved()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='UPDATE' and old.parent_folder_id is not distinct from new.parent_folder_id then
    return new;
  end if;
  perform mangorts_v2_advance_parent_link(new.company_id,'shared_inbox',new.shared_inbox_id,new.parent_folder_id is null);
  return new;
end;
$$;

create or replace function mangorts_v2_group_policy_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid := coalesce((to_jsonb(new)->>'company_id')::uuid,(to_jsonb(old)->>'company_id')::uuid);
begin
  insert into workspace_read_versions(company_id,scope,resource_key,version,updated_timestamp)
  values(v_company_id,'policy-group-membership','',1,now())
  on conflict(company_id,scope,resource_key) do update
  set version=workspace_read_versions.version+1,updated_timestamp=now();
  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_group_deleted_cleanup()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  delete from resource_gvic_assignments
  where company_id=old.company_id and principal_type='group' and principal_id=old.group_id;
  delete from resource_permissions
  where company_id=old.company_id and subject_type='group' and subject_id=old.group_id;
  return old;
end;
$$;

do $$
declare
  item record;
begin
  for item in select * from (values
    ('nodes','node','node_id'),
    ('logic_gates','logic_gate','logic_gate_id'),
    ('projects','project','project_id'),
    ('company_explorer_folders','company_explorer_folder','folder_id'),
    ('shared_inbox_folders','shared_inbox_folder','folder_id'),
    ('shared_inboxes','shared_inbox','shared_inbox_id')
  ) as values_row(table_name,resource_type,id_column)
  loop
    execute format('drop trigger if exists trg_v2_policy_initialize on %I',item.table_name);
    execute format(
      'create constraint trigger trg_v2_policy_initialize after insert on %I deferrable initially deferred for each row execute function mangorts_v2_initialize_policy_settings(%L,%L)',
      item.table_name,item.resource_type,item.id_column
    );
    execute format('drop trigger if exists trg_v2_policy_delete on %I',item.table_name);
    execute format(
      'create trigger trg_v2_policy_delete after delete on %I for each row execute function mangorts_v2_resource_deleted_cleanup(%L,%L)',
      item.table_name,item.resource_type,item.id_column
    );
  end loop;
end;
$$;

drop trigger if exists trg_v2_node_policy_parent_before_delete on node_logic_gate_assignments;
create trigger trg_v2_node_policy_parent_before_delete
before delete on node_logic_gate_assignments
for each row execute function mangorts_v2_node_parent_link_changed();
drop trigger if exists trg_v2_node_policy_parent_after_save on node_logic_gate_assignments;
create trigger trg_v2_node_policy_parent_after_save
after insert or update of logic_gate_id on node_logic_gate_assignments
for each row execute function mangorts_v2_node_parent_link_changed();
drop trigger if exists trg_v2_node_policy_parent_after_delete on node_logic_gate_assignments;
create trigger trg_v2_node_policy_parent_after_delete
after delete on node_logic_gate_assignments
for each row execute function mangorts_v2_node_parent_link_removed();

drop trigger if exists trg_v2_company_item_policy_parent_before_delete on company_explorer_items;
create trigger trg_v2_company_item_policy_parent_before_delete
before delete on company_explorer_items
for each row execute function mangorts_v2_company_item_parent_changed();
drop trigger if exists trg_v2_company_item_policy_parent_after_save on company_explorer_items;
create trigger trg_v2_company_item_policy_parent_after_save
after insert or update of parent_folder_id on company_explorer_items
for each row execute function mangorts_v2_company_item_parent_saved();

drop trigger if exists trg_v2_company_folder_policy_parent_before_update on company_explorer_folders;
create trigger trg_v2_company_folder_policy_parent_before_update
before update of parent_folder_id on company_explorer_folders
for each row execute function mangorts_v2_folder_parent_changing('company_explorer_folder');
drop trigger if exists trg_v2_company_folder_policy_parent_after_save on company_explorer_folders;
create trigger trg_v2_company_folder_policy_parent_after_save
after insert or update of parent_folder_id on company_explorer_folders
for each row execute function mangorts_v2_folder_parent_saved('company_explorer_folder');

drop trigger if exists trg_v2_shared_folder_policy_parent_before_update on shared_inbox_folders;
create trigger trg_v2_shared_folder_policy_parent_before_update
before update of parent_folder_id on shared_inbox_folders
for each row execute function mangorts_v2_folder_parent_changing('shared_inbox_folder');
drop trigger if exists trg_v2_shared_folder_policy_parent_after_save on shared_inbox_folders;
create trigger trg_v2_shared_folder_policy_parent_after_save
after insert or update of parent_folder_id on shared_inbox_folders
for each row execute function mangorts_v2_folder_parent_saved('shared_inbox_folder');

drop trigger if exists trg_v2_shared_inbox_policy_parent_before_update on shared_inboxes;
create trigger trg_v2_shared_inbox_policy_parent_before_update
before update of parent_folder_id on shared_inboxes
for each row execute function mangorts_v2_shared_inbox_parent_changing();
drop trigger if exists trg_v2_shared_inbox_policy_parent_after_save on shared_inboxes;
create trigger trg_v2_shared_inbox_policy_parent_after_save
after insert or update of parent_folder_id on shared_inboxes
for each row execute function mangorts_v2_shared_inbox_parent_saved();

drop trigger if exists trg_v2_group_policy_cleanup on company_user_groups;
create trigger trg_v2_group_policy_cleanup
before delete on company_user_groups
for each row execute function mangorts_v2_group_deleted_cleanup();
drop trigger if exists trg_v2_group_policy_version on company_user_groups;
create trigger trg_v2_group_policy_version
after insert or update or delete on company_user_groups
for each row execute function mangorts_v2_group_policy_changed();
drop trigger if exists trg_v2_group_member_policy_version on company_user_group_members;
create trigger trg_v2_group_member_policy_version
after insert or update or delete on company_user_group_members
for each row execute function mangorts_v2_group_policy_changed();

insert into workspace_read_versions(company_id,scope,resource_key,version,updated_timestamp)
select company_id,'policy-group-membership','',0,now() from companies
on conflict(company_id,scope,resource_key) do nothing;

do $$
begin
  if (select count(*) from resource_gvic_settings) <>
     ((select count(*) from nodes)+(select count(*) from logic_gates)+(select count(*) from projects)+
      (select count(*) from company_explorer_folders)+(select count(*) from shared_inbox_folders)+(select count(*) from shared_inboxes)) then
    raise exception 'v2_policy_step2_gvic_settings_coverage_mismatch';
  end if;
  if (select count(*) from resource_permission_settings) <>
     ((select count(*) from nodes)+(select count(*) from logic_gates)+(select count(*) from projects)+
      (select count(*) from company_explorer_folders)+(select count(*) from shared_inbox_folders)+(select count(*) from shared_inboxes)) then
    raise exception 'v2_policy_step2_permission_settings_coverage_mismatch';
  end if;
end;
$$;

commit;
-- END V2 GVIC AND PERMISSIONS STEP 2 CUTOVER SCHEMA

-- BEGIN V2 NODE DELETE POLICY CASCADE FIX
begin;

create or replace function mangorts_v2_resource_deleted_cleanup()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  deleted_resource_type text := tg_argv[0];
  deleted_resource_id uuid := (to_jsonb(old)->>tg_argv[1])::uuid;
  deleted_company_id uuid := (to_jsonb(old)->>'company_id')::uuid;
begin
  delete from resource_gvic_settings
  where resource_gvic_settings.company_id=deleted_company_id
    and resource_gvic_settings.resource_type=deleted_resource_type
    and resource_gvic_settings.resource_id=deleted_resource_id;
  delete from resource_permission_settings
  where resource_permission_settings.company_id=deleted_company_id
    and resource_permission_settings.resource_type=deleted_resource_type
    and resource_permission_settings.resource_id=deleted_resource_id;
  return old;
end;
$$;

create or replace function mangorts_v2_node_parent_link_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    if exists(
      select 1
      from nodes
      where company_id=old.company_id and node_id=old.node_id
    ) then
      perform mangorts_v2_materialize_detached_policy(old.company_id,'node',old.node_id);
    end if;
    return old;
  end if;
  if tg_op='INSERT' then
    perform mangorts_v2_advance_parent_link(new.company_id,'node',new.node_id,false);
  elsif old.logic_gate_id is distinct from new.logic_gate_id then
    perform mangorts_v2_advance_parent_link(new.company_id,'node',new.node_id,false);
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_node_parent_link_removed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if exists(
    select 1
    from nodes
    where company_id=old.company_id and node_id=old.node_id
  ) then
    perform mangorts_v2_advance_parent_link(old.company_id,'node',old.node_id,true);
  end if;
  return old;
end;
$$;

commit;
-- END V2 NODE DELETE POLICY CASCADE FIX

-- BEGIN RACI ROLE CONTRACT
-- Rename the active GVIC role contract to RACI and allow groups in every role.
begin;

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'raci_roles_unsupported_postgresql_version:%', current_setting('server_version');
  end if;
end;
$$;

lock table resource_gvic_assignments in access exclusive mode;
lock table notifications in access exclusive mode;
lock table recycle_bin_items in access exclusive mode;

alter table resource_gvic_assignments
  drop constraint if exists resource_gvic_assignments_v2_staging_role_chk,
  drop constraint if exists resource_gvic_assignments_v2_staging_user_only_role_chk,
  drop constraint if exists resource_gvic_assignments_role_chk,
  drop constraint if exists resource_gvic_assignments_rcvi_role_chk,
  drop constraint if exists resource_gvic_assignments_raci_role_chk;
drop index if exists idx_resource_gvic_assignments_v2_one_generated;

update resource_gvic_assignments
set role = case role
  when 'generated' then 'responsible'
  when 'verified' then 'accountable'
  when 'verifier' then 'accountable'
  else role
end
where role in ('generated', 'verified', 'verifier');

alter table resource_gvic_assignments
  add constraint resource_gvic_assignments_raci_role_chk
    check (role in ('responsible', 'accountable', 'consulted', 'informed'));

alter table notifications drop constraint if exists notifications_surface_chk;
update notifications set surface='aci_inbox' where surface='cvi_inbox';
update notifications
set notification_type = case notification_type
  when 'cvi_inbox.changed' then 'aci_inbox.changed'
  when 'cvi_inbox.RCVI_updated' then 'aci_inbox.RACI_updated'
  else notification_type
end
where notification_type in ('cvi_inbox.changed', 'cvi_inbox.RCVI_updated');
alter table notifications
  add constraint notifications_surface_chk
    check (surface = '' or surface in ('r_inbox', 'aci_inbox', 'my_triage', 'shared_triage'));

alter table notifications drop constraint if exists notifications_role_chk;
update notifications
set role = case role
  when 'generated' then 'responsible'
  when 'verified' then 'accountable'
  when 'verifier' then 'accountable'
  else role
end
where role in ('generated', 'verified', 'verifier');
alter table notifications
  add constraint notifications_role_chk
    check (role = '' or role in ('responsible', 'accountable', 'consulted', 'informed', 'other'));

update recycle_bin_items item
set restore_payload = jsonb_set(
  item.restore_payload,
  '{resource_gvic_assignments}',
  coalesce((
    select jsonb_agg(
      case assignment->>'role'
        when 'generated' then jsonb_set(assignment, '{role}', '"responsible"'::jsonb)
        when 'verified' then jsonb_set(assignment, '{role}', '"accountable"'::jsonb)
        when 'verifier' then jsonb_set(assignment, '{role}', '"accountable"'::jsonb)
        else assignment
      end
    )
    from jsonb_array_elements(item.restore_payload->'resource_gvic_assignments') assignment
  ), '[]'::jsonb)
)
where jsonb_typeof(item.restore_payload->'resource_gvic_assignments') = 'array';

create or replace function mangorts_v2_effective_gvic_assignments(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  role text,
  user_id uuid,
  source_resource_type text,
  source_resource_id uuid,
  source_principal_type text,
  source_principal_id uuid,
  inheritance_type text,
  updated_timestamp timestamptz
)
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive resolved as (
    select * from mangorts_v2_resolve_gvic_policy(p_company_id,p_resource_type,p_resource_id)
  ),
  source_edges as (
    select edge.*
    from resolved
    join resource_gvic_assignments edge
      on edge.company_id=p_company_id
     and edge.resource_type=resolved.source_resource_type
     and edge.resource_id=resolved.source_resource_id
  ),
  group_tree(role,source_principal_id,group_id,depth,path,updated_timestamp) as (
    select edge.role,edge.principal_id,edge.principal_id,0,array[edge.principal_id],edge.updated_timestamp
    from source_edges edge where edge.principal_type='group'
    union all
    select tree.role,tree.source_principal_id,child.group_id,tree.depth+1,tree.path || child.group_id,tree.updated_timestamp
    from group_tree tree
    join company_user_groups child
      on child.company_id=p_company_id and child.parent_group_id=tree.group_id
    where tree.depth<100 and not child.group_id=any(tree.path)
  ),
  candidates as (
    select edge.role,edge.principal_id as user_id,'user'::text as source_principal_type,
           edge.principal_id as source_principal_id,-1 as group_depth,edge.updated_timestamp
    from source_edges edge
    join company_memberships membership
      on edge.principal_type='user'
     and membership.company_id=p_company_id and membership.user_id=edge.principal_id
    union all
    select tree.role,member.user_id,'group',tree.source_principal_id,tree.depth,tree.updated_timestamp
    from group_tree tree
    join company_user_group_members member
      on member.company_id=p_company_id and member.group_id=tree.group_id
  ),
  winners as (
    select distinct on (candidate.user_id) candidate.*
    from candidates candidate
    order by candidate.user_id,
      case candidate.role when 'responsible' then 1 when 'accountable' then 2 when 'consulted' then 3 else 4 end,
      case candidate.source_principal_type when 'user' then 0 else 1 end,
      candidate.group_depth,
      candidate.source_principal_id
  )
  select winner.role,winner.user_id,resolved.source_resource_type,resolved.source_resource_id,
         winner.source_principal_type,winner.source_principal_id,
         case when resolved.source_resource_type=p_resource_type and resolved.source_resource_id=p_resource_id
              then 'direct' else 'inherited' end,
         winner.updated_timestamp
  from winners winner cross join resolved
  order by winner.user_id;
$$;

commit;
-- END RACI ROLE CONTRACT

-- Bare-bones Huddles and KPIs. PostgreSQL 17.x compatible.

create table if not exists huddle_logic_gates (
  company_id uuid not null,
  huddle_logic_gate_id uuid not null,
  header text not null,
  body_json jsonb not null default '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb,
  revision bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id,huddle_logic_gate_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  constraint huddle_logic_gates_header_chk check (btrim(header) <> ''),
  constraint huddle_logic_gates_revision_chk check (revision >= 0),
  constraint huddle_logic_gates_body_chk check (
    body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and jsonb_typeof(body_json->'annotations')='array'
  )
);

create table if not exists huddle_nodes (
  company_id uuid not null,
  huddle_node_id uuid not null,
  huddle_logic_gate_id uuid not null,
  name text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id,huddle_node_id),
  foreign key (company_id,huddle_logic_gate_id)
    references huddle_logic_gates(company_id,huddle_logic_gate_id) on delete restrict,
  constraint huddle_nodes_name_chk check (btrim(name) <> '')
);

create index if not exists idx_huddle_nodes_owner
  on huddle_nodes(company_id,huddle_logic_gate_id,created_timestamp,huddle_node_id);

create table if not exists kpis (
  company_id uuid not null,
  kpi_id uuid not null,
  logic_gate_id uuid not null,
  name text not null,
  body_json jsonb not null default '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb,
  revision bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id,kpi_id),
  foreign key (company_id,logic_gate_id) references logic_gates(company_id,logic_gate_id) on delete cascade,
  constraint kpis_name_chk check (btrim(name) <> ''),
  constraint kpis_revision_chk check (revision >= 0),
  constraint kpis_body_chk check (
    body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and jsonb_typeof(body_json->'annotations')='array'
  )
);

create index if not exists idx_kpis_logic_gate
  on kpis(company_id,logic_gate_id,created_timestamp,kpi_id);

create unique index if not exists uq_kpis_owner_identity
  on kpis(company_id,logic_gate_id,kpi_id);

create table if not exists huddle_logic_gate_relationships (
  company_id uuid not null,
  huddle_logic_gate_id uuid not null,
  logic_gate_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,huddle_logic_gate_id,logic_gate_id),
  foreign key (company_id,huddle_logic_gate_id)
    references huddle_logic_gates(company_id,huddle_logic_gate_id) on delete cascade,
  foreign key (company_id,logic_gate_id)
    references logic_gates(company_id,logic_gate_id) on delete cascade
);

create index if not exists idx_huddle_logic_gate_relationships_logic_gate
  on huddle_logic_gate_relationships(company_id,logic_gate_id,huddle_logic_gate_id);

create table if not exists huddle_node_logic_gate_relationships (
  company_id uuid not null,
  huddle_node_id uuid not null,
  logic_gate_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,huddle_node_id,logic_gate_id),
  foreign key (company_id,huddle_node_id)
    references huddle_nodes(company_id,huddle_node_id) on delete cascade,
  foreign key (company_id,logic_gate_id)
    references logic_gates(company_id,logic_gate_id) on delete cascade
);

create index if not exists idx_huddle_node_logic_gate_relationships_logic_gate
  on huddle_node_logic_gate_relationships(company_id,logic_gate_id,huddle_node_id);

create table if not exists huddle_node_kpi_relationships (
  company_id uuid not null,
  huddle_node_id uuid not null,
  logic_gate_id uuid not null,
  kpi_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,huddle_node_id,logic_gate_id,kpi_id),
  foreign key (company_id,huddle_node_id,logic_gate_id)
    references huddle_node_logic_gate_relationships(company_id,huddle_node_id,logic_gate_id) on delete cascade,
  foreign key (company_id,logic_gate_id,kpi_id)
    references kpis(company_id,logic_gate_id,kpi_id) on delete cascade
);

create index if not exists idx_huddle_node_kpi_relationships_kpi
  on huddle_node_kpi_relationships(company_id,kpi_id,huddle_node_id);

create table if not exists huddle_explorer_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  primary key (company_id,folder_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id,parent_folder_id)
    references huddle_explorer_folders(company_id,folder_id) on delete restrict,
  constraint huddle_explorer_folders_name_chk check (btrim(name) <> ''),
  constraint huddle_explorer_folders_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id)
);

create table if not exists huddle_explorer_items (
  company_id uuid not null,
  huddle_explorer_item_id uuid not null,
  resource_huddle_resource_id uuid not null,
  huddle_type text not null,
  parent_folder_id uuid,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  primary key (company_id,huddle_explorer_item_id),
  unique (company_id,huddle_type,resource_huddle_resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id,parent_folder_id)
    references huddle_explorer_folders(company_id,folder_id) on delete restrict,
  constraint huddle_explorer_items_huddle_type_chk check (huddle_type = 'huddle_logic_gate')
);

create index if not exists idx_huddle_explorer_folders_parent
  on huddle_explorer_folders(company_id,parent_folder_id,created_date,folder_id);
create index if not exists idx_huddle_explorer_items_parent
  on huddle_explorer_items(company_id,parent_folder_id,created_date,huddle_explorer_item_id);

create or replace function mangorts_validate_huddle_explorer_folder()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare current_id uuid := new.parent_folder_id; steps integer := 0;
begin
  while current_id is not null loop
    if current_id=new.folder_id then
      raise exception 'huddle_explorer_folder_cycle' using errcode='23514';
    end if;
    select parent_folder_id into current_id
    from huddle_explorer_folders
    where company_id=new.company_id and folder_id=current_id;
    steps := steps + 1;
    if steps > 1000 then raise exception 'huddle_explorer_folder_cycle' using errcode='23514'; end if;
  end loop;
  return new;
end; $$;

drop trigger if exists trg_huddle_explorer_folder_cycle on huddle_explorer_folders;
create trigger trg_huddle_explorer_folder_cycle
before insert or update of parent_folder_id on huddle_explorer_folders
for each row execute function mangorts_validate_huddle_explorer_folder();

create or replace function mangorts_validate_huddle_explorer_item()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.huddle_type='huddle_logic_gate' and not exists(
    select 1 from huddle_logic_gates where company_id=new.company_id and huddle_logic_gate_id=new.resource_huddle_resource_id
  ) then raise exception 'huddle_logic_gate_missing' using errcode='23503'; end if;
  return new;
end; $$;

drop trigger if exists trg_huddle_explorer_item_validate on huddle_explorer_items;
create trigger trg_huddle_explorer_item_validate
before insert or update of company_id,huddle_type,resource_huddle_resource_id on huddle_explorer_items
for each row execute function mangorts_validate_huddle_explorer_item();

alter table pins drop constraint if exists pins_resource_type_chk;
alter table pins add constraint pins_resource_type_chk
  check (resource_type in ('node','logic_gate','project','huddle_logic_gate','huddle_node'));

alter table recycle_bin_items drop constraint if exists recycle_bin_items_kind_chk;
alter table recycle_bin_items add constraint recycle_bin_items_kind_chk check (object_kind in (
  'folder','node','logic_gate','project','kanban','kpi','huddle_logic_gate','huddle_node','huddle_explorer_folder','huddle_explorer_item'
));

alter table resource_gvic_assignments drop constraint if exists resource_gvic_assignments_resource_type_chk;
alter table resource_gvic_assignments add constraint resource_gvic_assignments_resource_type_chk check (resource_type in (
  'node','logic_gate','project','shared_triage_folder','shared_inbox','huddle_logic_gate','huddle_node'
));
alter table resource_permissions drop constraint if exists resource_permissions_resource_type_chk;
alter table resource_permissions add constraint resource_permissions_resource_type_chk check (resource_type in (
  'node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox','huddle_logic_gate','huddle_node'
));

alter table resource_gvic_settings drop constraint if exists resource_gvic_settings_resource_type_chk;
alter table resource_gvic_settings add constraint resource_gvic_settings_resource_type_chk
  check (resource_type in ('node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox','huddle_logic_gate','huddle_node'));
alter table resource_permission_settings drop constraint if exists resource_permission_settings_resource_type_chk;
alter table resource_permission_settings add constraint resource_permission_settings_resource_type_chk
  check (resource_type in ('node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox','huddle_logic_gate','huddle_node'));
create or replace function mangorts_v2_policy_resource_exists(p_company_id uuid,p_resource_type text,p_resource_id uuid)
returns boolean language sql stable set search_path=public,pg_temp as $$
  select case p_resource_type
    when 'node' then exists(select 1 from nodes where company_id=p_company_id and node_id=p_resource_id)
    when 'logic_gate' then exists(select 1 from logic_gates where company_id=p_company_id and logic_gate_id=p_resource_id)
    when 'project' then exists(select 1 from projects where company_id=p_company_id and project_id=p_resource_id)
    when 'company_explorer_folder' then exists(select 1 from company_explorer_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox_folder' then exists(select 1 from shared_inbox_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox' then exists(select 1 from shared_inboxes where company_id=p_company_id and shared_inbox_id=p_resource_id)
    when 'huddle_logic_gate' then exists(select 1 from huddle_logic_gates where company_id=p_company_id and huddle_logic_gate_id=p_resource_id)
    when 'huddle_node' then exists(select 1 from huddle_nodes where company_id=p_company_id and huddle_node_id=p_resource_id)
    else false end;
$$;
-- BEGIN RACI TABS
begin;

create table if not exists raci_tabs_folders (
  company_id uuid not null,
  folder_id uuid not null,
  user_id uuid not null,
  role text not null,
  parent_folder_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint raci_tabs_folders_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  constraint raci_tabs_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint raci_tabs_folders_not_self_parent_chk check (parent_folder_id is distinct from folder_id),
  primary key (folder_id),
  unique (company_id, user_id, role, folder_id),
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, user_id, role, parent_folder_id)
    references raci_tabs_folders(company_id, user_id, role, folder_id) on delete cascade
);

create index if not exists idx_raci_tabs_folders_owner_role_parent_position
  on raci_tabs_folders(company_id, user_id, role, parent_folder_id, position, created_timestamp, name, folder_id);

create table if not exists raci_tabs_items (
  company_id uuid not null,
  user_id uuid not null,
  role text not null,
  logic_gate_id uuid not null,
  folder_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint raci_tabs_items_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  constraint raci_tabs_items_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, user_id, logic_gate_id),
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, user_id, role, folder_id)
    references raci_tabs_folders(company_id, user_id, role, folder_id) on delete cascade
);

do $$
declare
  spec record;
  actual_count integer;
  missing_count integer;
  extra_count integer;
begin
  for spec in
    select * from (values
      ('raci_tabs_items', array['company_id','user_id','role','logic_gate_id','folder_id','name','position','created_timestamp','updated_timestamp']::text[]),
      ('raci_tabs_folders', array['company_id','folder_id','user_id','role','parent_folder_id','name','position','created_timestamp','updated_timestamp']::text[])
    ) expected(table_name,expected_columns)
  loop
    select count(*) into actual_count
    from information_schema.columns actual
    where actual.table_schema='public' and actual.table_name=spec.table_name;

    select count(*) into missing_count
    from unnest(spec.expected_columns) expected(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public' and actual.table_name=spec.table_name
        and actual.column_name=expected.column_name
    );

    select count(*) into extra_count
    from information_schema.columns actual
    where actual.table_schema='public' and actual.table_name=spec.table_name
      and not (actual.column_name=any(spec.expected_columns));

    if actual_count<>cardinality(spec.expected_columns) or missing_count<>0 or extra_count<>0 then
      raise exception 'raci_tabs_schema_drift:%:expected=%:actual=%:missing=%:extra=%',
        spec.table_name,cardinality(spec.expected_columns),actual_count,missing_count,extra_count;
    end if;
  end loop;
end;
$$;

create index if not exists idx_raci_tabs_items_owner_role_folder_position
  on raci_tabs_items(company_id, user_id, role, folder_id, position, created_timestamp, name, logic_gate_id);

create index if not exists idx_raci_tabs_items_logic_gate
  on raci_tabs_items(company_id, logic_gate_id, user_id);

with expected as (
  select
    gate.company_id,
    effective.user_id,
    effective.role,
    gate.logic_gate_id,
    gate.header as name,
    row_number() over (
      partition by gate.company_id, effective.user_id, effective.role
      order by gate.created_timestamp, lower(gate.header), gate.logic_gate_id
    )::integer * 1000 as position,
    gate.created_timestamp
  from logic_gates gate
  cross join lateral mangorts_v2_effective_gvic_assignments(
    gate.company_id,
    'logic_gate',
    gate.logic_gate_id
  ) effective
)
insert into raci_tabs_items(
  company_id, user_id, role, logic_gate_id, folder_id, name, position,
  created_timestamp, updated_timestamp
)
select
  expected.company_id,
  expected.user_id,
  expected.role,
  expected.logic_gate_id,
  null,
  expected.name,
  expected.position,
  expected.created_timestamp,
  now()
from expected
on conflict (company_id, user_id, logic_gate_id) do nothing;

create or replace function mangorts_sync_raci_tabs_logic_gate(
  p_company_id uuid,
  p_logic_gate_id uuid
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_name text;
begin
  select gate.header
  into v_name
  from logic_gates gate
  where gate.company_id=p_company_id
    and gate.logic_gate_id=p_logic_gate_id;

  if not found then
    delete from raci_tabs_items item
    where item.company_id=p_company_id
      and item.logic_gate_id=p_logic_gate_id;
    return;
  end if;

  with effective as materialized (
    select assignment.user_id, assignment.role
    from mangorts_v2_effective_gvic_assignments(
      p_company_id,
      'logic_gate',
      p_logic_gate_id
    ) assignment
  ), prepared as (
    select
      p_company_id as company_id,
      effective.user_id,
      effective.role,
      p_logic_gate_id as logic_gate_id,
      case when current_item.role=effective.role then current_item.folder_id else null end as folder_id,
      v_name as name,
      case
        when current_item.role=effective.role then current_item.position
        else coalesce((
          select max(sibling.position)
          from (
            select folder.position
            from raci_tabs_folders folder
            where folder.company_id=p_company_id
              and folder.user_id=effective.user_id
              and folder.role=effective.role
              and folder.parent_folder_id is null
            union all
            select item.position
            from raci_tabs_items item
            where item.company_id=p_company_id
              and item.user_id=effective.user_id
              and item.role=effective.role
              and item.folder_id is null
              and item.logic_gate_id<>p_logic_gate_id
          ) sibling
        ), 0) + 1000
      end as position,
      coalesce(current_item.created_timestamp, now()) as created_timestamp
    from effective
    left join raci_tabs_items current_item
      on current_item.company_id=p_company_id
     and current_item.user_id=effective.user_id
     and current_item.logic_gate_id=p_logic_gate_id
  )
  insert into raci_tabs_items(
    company_id, user_id, role, logic_gate_id, folder_id, name, position,
    created_timestamp, updated_timestamp
  )
  select
    prepared.company_id,
    prepared.user_id,
    prepared.role,
    prepared.logic_gate_id,
    prepared.folder_id,
    prepared.name,
    prepared.position,
    prepared.created_timestamp,
    now()
  from prepared
  on conflict (company_id, user_id, logic_gate_id) do update
  set role=excluded.role,
      folder_id=excluded.folder_id,
      name=excluded.name,
      position=excluded.position,
      updated_timestamp=now()
  where (raci_tabs_items.role, raci_tabs_items.folder_id, raci_tabs_items.name, raci_tabs_items.position)
        is distinct from
        (excluded.role, excluded.folder_id, excluded.name, excluded.position);

  delete from raci_tabs_items item
  where item.company_id=p_company_id
    and item.logic_gate_id=p_logic_gate_id
    and not exists (
      select 1
      from mangorts_v2_effective_gvic_assignments(
        p_company_id,
        'logic_gate',
        p_logic_gate_id
      ) effective
      where effective.user_id=item.user_id
    );
end;
$$;

create or replace function mangorts_sync_raci_tabs_explorer_subtree(
  p_company_id uuid,
  p_folder_id uuid
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_gate record;
begin
  for v_gate in
    with recursive subtree(folder_id) as (
      select folder.folder_id
      from company_explorer_folders folder
      where folder.company_id=p_company_id
        and folder.folder_id=p_folder_id
      union all
      select child.folder_id
      from subtree parent
      join company_explorer_folders child
        on child.company_id=p_company_id
       and child.parent_folder_id=parent.folder_id
    )
    select distinct item.target_id as logic_gate_id
    from subtree folder
    join company_explorer_items item
      on item.company_id=p_company_id
     and item.parent_folder_id=folder.folder_id
     and item.target_type='logic_gate'
    order by item.target_id
  loop
    perform mangorts_sync_raci_tabs_logic_gate(p_company_id, v_gate.logic_gate_id);
  end loop;
end;
$$;

create or replace function mangorts_sync_raci_tabs_policy_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if p_resource_type='logic_gate' then
    perform mangorts_sync_raci_tabs_logic_gate(p_company_id,p_resource_id);
  elsif p_resource_type='company_explorer_folder' then
    perform mangorts_sync_raci_tabs_explorer_subtree(p_company_id,p_resource_id);
  end if;
end;
$$;

create or replace function mangorts_sync_raci_tabs_group_ancestors(
  p_company_id uuid,
  p_group_ids uuid[]
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_resource record;
begin
  for v_resource in
    with recursive ancestors(group_id) as (
      select distinct seed.group_id
      from unnest(coalesce(p_group_ids,'{}'::uuid[])) seed(group_id)
      where seed.group_id is not null
      union
      select parent.parent_group_id
      from ancestors child
      join company_user_groups parent
        on parent.company_id=p_company_id
       and parent.group_id=child.group_id
      where parent.parent_group_id is not null
    )
    select distinct assignment.resource_type,assignment.resource_id
    from ancestors affected
    join resource_gvic_assignments assignment
      on assignment.company_id=p_company_id
     and assignment.principal_type='group'
     and assignment.principal_id=affected.group_id
    where assignment.resource_type in ('logic_gate','company_explorer_folder')
    order by assignment.resource_type,assignment.resource_id
  loop
    perform mangorts_sync_raci_tabs_policy_resource(
      p_company_id,v_resource.resource_type,v_resource.resource_id
    );
  end loop;
end;
$$;

create or replace function mangorts_raci_tabs_logic_gate_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    perform mangorts_sync_raci_tabs_logic_gate(old.company_id, old.logic_gate_id);
  else
    perform mangorts_sync_raci_tabs_logic_gate(new.company_id, new.logic_gate_id);
  end if;
  return null;
end;
$$;

create or replace function mangorts_raci_tabs_policy_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid;
  v_resource_type text;
  v_resource_id uuid;
begin
  if tg_op='UPDATE'
     and (old.company_id,old.resource_type,old.resource_id)
         is distinct from
         (new.company_id,new.resource_type,new.resource_id) then
    if old.resource_type='logic_gate' then
      perform mangorts_sync_raci_tabs_logic_gate(old.company_id,old.resource_id);
    elsif old.resource_type='company_explorer_folder' then
      perform mangorts_sync_raci_tabs_explorer_subtree(old.company_id,old.resource_id);
    end if;
  end if;
  if tg_op='DELETE' then
    v_company_id := old.company_id;
    v_resource_type := old.resource_type;
    v_resource_id := old.resource_id;
  else
    v_company_id := new.company_id;
    v_resource_type := new.resource_type;
    v_resource_id := new.resource_id;
  end if;
  if v_resource_type='logic_gate' then
    perform mangorts_sync_raci_tabs_logic_gate(v_company_id, v_resource_id);
  elsif v_resource_type='company_explorer_folder' then
    perform mangorts_sync_raci_tabs_explorer_subtree(v_company_id,v_resource_id);
  end if;
  return null;
end;
$$;

create or replace function mangorts_raci_tabs_explorer_folder_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.parent_folder_id is distinct from new.parent_folder_id then
    perform mangorts_sync_raci_tabs_explorer_subtree(new.company_id,new.folder_id);
  end if;
  return null;
end;
$$;

create or replace function mangorts_raci_tabs_group_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    perform mangorts_sync_raci_tabs_group_ancestors(old.company_id,array[old.parent_group_id]);
  elsif tg_op='UPDATE' and old.parent_group_id is distinct from new.parent_group_id then
    perform mangorts_sync_raci_tabs_group_ancestors(old.company_id,array[old.parent_group_id]);
    perform mangorts_sync_raci_tabs_group_ancestors(new.company_id,array[new.parent_group_id]);
  end if;
  return null;
end;
$$;

create or replace function mangorts_raci_tabs_group_member_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    perform mangorts_sync_raci_tabs_group_ancestors(old.company_id,array[old.group_id]);
  elsif tg_op='INSERT' then
    perform mangorts_sync_raci_tabs_group_ancestors(new.company_id,array[new.group_id]);
  else
    perform mangorts_sync_raci_tabs_group_ancestors(old.company_id,array[old.group_id]);
    if (old.company_id,old.group_id) is distinct from (new.company_id,new.group_id) then
      perform mangorts_sync_raci_tabs_group_ancestors(new.company_id,array[new.group_id]);
    end if;
  end if;
  return null;
end;
$$;

create or replace function mangorts_raci_tabs_membership_added()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_resource record;
begin
  for v_resource in
    select distinct assignment.resource_type,assignment.resource_id
    from resource_gvic_assignments assignment
    where assignment.company_id=new.company_id
      and assignment.principal_type='user'
      and assignment.principal_id=new.user_id
      and assignment.resource_type in ('logic_gate','company_explorer_folder')
    order by assignment.resource_type,assignment.resource_id
  loop
    perform mangorts_sync_raci_tabs_policy_resource(
      new.company_id,v_resource.resource_type,v_resource.resource_id
    );
  end loop;
  return null;
end;
$$;

create or replace function mangorts_raci_tabs_explorer_item_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' and old.target_type='logic_gate' then
    perform mangorts_sync_raci_tabs_logic_gate(old.company_id, old.target_id);
  elsif tg_op<>'DELETE' then
    if tg_op='UPDATE' and old.target_type='logic_gate'
       and (old.company_id,old.target_id,old.target_type)
           is distinct from
           (new.company_id,new.target_id,new.target_type) then
      perform mangorts_sync_raci_tabs_logic_gate(old.company_id,old.target_id);
    end if;
    if new.target_type='logic_gate' then
      perform mangorts_sync_raci_tabs_logic_gate(new.company_id,new.target_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_zz_raci_tabs_logic_gate_changed on logic_gates;
create trigger trg_zz_raci_tabs_logic_gate_changed
after insert or update of header or delete on logic_gates
for each row execute function mangorts_raci_tabs_logic_gate_changed();

drop trigger if exists trg_zz_raci_tabs_assignment_changed on resource_gvic_assignments;
create trigger trg_zz_raci_tabs_assignment_changed
after insert or update or delete on resource_gvic_assignments
for each row execute function mangorts_raci_tabs_policy_changed();

drop trigger if exists trg_zz_raci_tabs_setting_changed on resource_gvic_settings;
create trigger trg_zz_raci_tabs_setting_changed
after insert or update or delete on resource_gvic_settings
for each row execute function mangorts_raci_tabs_policy_changed();

drop trigger if exists trg_zz_raci_tabs_explorer_item_changed on company_explorer_items;
create trigger trg_zz_raci_tabs_explorer_item_changed
after insert or update of parent_folder_id, target_id, target_type or delete on company_explorer_items
for each row execute function mangorts_raci_tabs_explorer_item_changed();

drop trigger if exists trg_zz_raci_tabs_explorer_folder_changed on company_explorer_folders;
create trigger trg_zz_raci_tabs_explorer_folder_changed
after update of parent_folder_id on company_explorer_folders
for each row
when (old.parent_folder_id is distinct from new.parent_folder_id)
execute function mangorts_raci_tabs_explorer_folder_changed();

drop trigger if exists trg_zz_raci_tabs_group_changed on company_user_groups;
create trigger trg_zz_raci_tabs_group_changed
after update of parent_group_id or delete on company_user_groups
for each row execute function mangorts_raci_tabs_group_changed();

drop trigger if exists trg_zz_raci_tabs_group_member_changed on company_user_group_members;
create trigger trg_zz_raci_tabs_group_member_changed
after insert or update or delete on company_user_group_members
for each row execute function mangorts_raci_tabs_group_member_changed();

drop trigger if exists trg_zz_raci_tabs_membership_changed on company_memberships;
create trigger trg_zz_raci_tabs_membership_changed
after insert on company_memberships
for each row execute function mangorts_raci_tabs_membership_added();

drop function if exists mangorts_raci_tabs_company_changed();
drop function if exists mangorts_sync_raci_tabs_company(uuid);

commit;
-- END RACI TABS
