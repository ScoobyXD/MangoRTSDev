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

do $$
begin
  if not exists (select 1 from pg_type where typname = 'information_type') then
    create type information_type as enum (
      'Text box',
      'Checklist',
      'Status',
      'Due date',
      'Employee name',
      'PDF',
      'PNG',
      'MOV',
      'Hyperlink',
      'Text block chat',
      'Attached email'
    );
  end if;
end $$;

alter type information_type add value if not exists 'Text block chat';
alter type information_type add value if not exists 'Attached email';
alter type information_type add value if not exists 'Saved version';

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
  constraint saved_views_surface_chk check (surface in ('my_work', 'updates', 'logic_gate_kanban')),
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

create table if not exists pins (
  pin_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
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
  unique (company_id, user_id, resource_type, resource_id)
);

create index if not exists idx_pins_user_position
  on pins(company_id, user_id, position, created_timestamp, pin_id);

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

create table if not exists user_email_connections (
  user_id uuid not null,
  provider text not null,
  account_email text not null,
  grant_id text not null,
  status text not null default 'connected',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint user_email_connections_provider_chk check (provider in ('google', 'microsoft')),
  constraint user_email_connections_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  constraint user_email_connections_grant_id_nonblank_chk check (btrim(grant_id) <> ''),
  constraint user_email_connections_status_chk check (status in ('connected', 'disconnected', 'reauth_required')),
  primary key (user_id, account_email),
  foreign key (user_id) references users (user_id) on delete cascade
);

create unique index if not exists idx_user_email_connections_grant_id
  on user_email_connections(grant_id);

create index if not exists idx_user_email_connections_user_updated
  on user_email_connections(user_id, updated_timestamp desc);

create table if not exists company_email_connections (
  company_email_connection_id uuid not null,
  company_id uuid not null,
  provider text not null,
  account_email text not null,
  grant_id text not null,
  status text not null default 'connected',
  connected_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_email_connections_provider_chk check (provider in ('google', 'microsoft')),
  constraint company_email_connections_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  constraint company_email_connections_grant_id_nonblank_chk check (btrim(grant_id) <> ''),
  constraint company_email_connections_status_chk check (status in ('connected', 'disconnected', 'reauth_required')),
  primary key (company_email_connection_id),
  unique (company_id, company_email_connection_id),
  unique (company_id, account_email),
  unique (company_id, grant_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (connected_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_company_email_connections_company_status
  on company_email_connections(company_id, status, updated_timestamp desc);

create table if not exists communications_message_read_receipt_summaries (
  receipt_scope_type varchar not null,
  receipt_scope_id varchar not null,
  user_id uuid references users(user_id) on delete cascade,
  company_id uuid references companies(company_id) on delete cascade,
  company_email_connection_id uuid references company_email_connections(company_email_connection_id) on delete cascade,
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

create table if not exists communications_email_drafts (
  company_id uuid not null,
  draft_id text not null,
  personal_user_id uuid,
  personal_account_email text,
  shared_inbox_id uuid,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  kind text not null default 'compose',
  source_message_id text not null default '',
  account_email text not null default '',
  to_recipients text not null default '',
  cc_recipients text not null default '',
  bcc_recipients text not null default '',
  subject text not null default '',
  body_editor_html text not null default '',
  reply_to_message jsonb not null default '{}'::jsonb,
  scheduled_send_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  constraint communications_email_drafts_draft_id_chk check (btrim(draft_id) <> ''),
  constraint communications_email_drafts_kind_chk check (kind in ('compose', 'reply', 'forward')),
  constraint communications_email_drafts_account_email_chk check (account_email = '' or account_email = lower(btrim(account_email))),
  constraint communications_email_drafts_personal_account_email_chk check (personal_account_email is null or (btrim(personal_account_email) <> '' and personal_account_email = lower(btrim(personal_account_email)))),
  constraint communications_email_drafts_scope_chk check (
    (personal_user_id is not null and personal_account_email is not null and shared_inbox_id is null)
    or (personal_user_id is null and personal_account_email is null and shared_inbox_id is not null)
  ),
  primary key (company_id, draft_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (updated_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_communications_email_drafts_personal_updated
  on communications_email_drafts(company_id, personal_user_id, personal_account_email, updated_timestamp desc)
  where deleted_timestamp is null and personal_user_id is not null;

create index if not exists idx_communications_email_drafts_shared_updated
  on communications_email_drafts(company_id, shared_inbox_id, updated_timestamp desc)
  where deleted_timestamp is null and shared_inbox_id is not null;

create table if not exists communications_email_signatures (
  company_id uuid not null,
  signature_id text not null,
  personal_user_id uuid,
  personal_account_email text,
  shared_inbox_id uuid,
  name text not null default 'Default',
  body_editor_html text not null default '',
  is_default boolean not null default true,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_signatures_signature_id_chk check (btrim(signature_id) <> ''),
  constraint communications_email_signatures_name_chk check (btrim(name) <> ''),
  constraint communications_email_signatures_personal_account_email_chk check (personal_account_email is null or (btrim(personal_account_email) <> '' and personal_account_email = lower(btrim(personal_account_email)))),
  constraint communications_email_signatures_scope_chk check (
    (personal_user_id is not null and personal_account_email is not null and shared_inbox_id is null)
    or (personal_user_id is null and personal_account_email is null and shared_inbox_id is not null)
  ),
  primary key (company_id, signature_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (personal_user_id, personal_account_email) references user_email_connections(user_id, account_email) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (updated_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_communications_email_signatures_personal_scope
  on communications_email_signatures(company_id, personal_user_id, personal_account_email)
  where personal_user_id is not null;

create unique index if not exists idx_communications_email_signatures_shared_scope
  on communications_email_signatures(company_id, shared_inbox_id)
  where shared_inbox_id is not null;

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

-- The legacy upload-intent table remains through Step 3 as rollback evidence.
-- New application work uses attachment_upload_jobs only.
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

create table if not exists attachment_variants (
  attachment_id uuid not null,
  variant_type text not null,
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
  constraint attachment_variants_type_chk check (variant_type in ('original', 'display', 'thumbnail', 'email_send')),
  constraint attachment_variants_mime_type_nonblank_chk check (btrim(mime_type) <> ''),
  constraint attachment_variants_byte_size_chk check (byte_size >= 0),
  constraint attachment_variants_sha256_chk check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint attachment_variants_generation_version_chk check (generation_version is null or generation_version > 0),
  constraint attachment_variants_dimensions_chk check (
    (width is null or width > 0)
    and (height is null or height > 0)
  ),
  constraint attachment_variants_storage_bucket_nonblank_chk check (btrim(storage_bucket) <> ''),
  constraint attachment_variants_storage_key_nonblank_chk check (btrim(storage_key) <> ''),
  primary key (attachment_id, variant_type),
  unique (storage_bucket, storage_key),
  foreign key (attachment_id) references attachments(attachment_id) on delete cascade
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

create table if not exists resource_attachments (
  resource_attachment_id uuid not null,
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
  constraint resource_attachments_type_chk check (
    resource_type in (
      'node',
      'logic_gate',
      'project',
      'node_chat_message',
      'logic_gate_chat_message',
      'project_chat_message',
      'email_message',
      'email_draft',
      'email_signature',
      'attached_email',
      'shared_inbox',
      'company_explorer_folder',
      'shared_inbox_folder'
    )
  ),
  constraint resource_attachments_resource_id_nonblank_chk check (btrim(resource_id) <> ''),
  constraint resource_attachments_relationship_kind_chk check (
    relationship_kind in (
      'inline_image',
      'file_attachment',
      'chat_attachment',
      'email_attachment',
      'email_inline_attachment',
      'migrated_inline_image'
    )
  ),
  primary key (resource_attachment_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, attachment_id) references attachments(company_id, attachment_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_resource_attachments_resource
  on resource_attachments(company_id, resource_type, resource_id, deleted_timestamp, created_timestamp desc);

create index if not exists idx_resource_attachments_attachment
  on resource_attachments(company_id, attachment_id, deleted_timestamp);

create unique index if not exists idx_resource_attachments_active_unique
  on resource_attachments(
    company_id,
    resource_type,
    resource_id,
    attachment_id,
    relationship_kind,
    coalesce(information_id::text, ''),
    coalesce(message_id, ''),
    coalesce(editor_surface, '')
  )
  where deleted_timestamp is null;

create table if not exists attachment_migration_runs (
  migration_run_id uuid not null,
  company_id uuid not null,
  status text not null default 'pending',
  dry_run boolean not null default true,
  started_by_user_id uuid,
  source_scope text not null default '',
  summary jsonb not null default '{}'::jsonb,
  started_timestamp timestamptz not null default now(),
  completed_timestamp timestamptz,
  constraint attachment_migration_runs_status_chk check (status in ('pending', 'running', 'completed', 'failed')),
  constraint attachment_migration_runs_summary_object_chk check (jsonb_typeof(summary) = 'object'),
  primary key (migration_run_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (started_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_attachment_migration_runs_company_started
  on attachment_migration_runs(company_id, started_timestamp desc, migration_run_id);

create table if not exists attachment_migration_items (
  migration_item_id uuid not null,
  migration_run_id uuid not null,
  company_id uuid not null,
  source_table text not null,
  source_pk text not null,
  resource_type text not null,
  resource_id text not null,
  information_id uuid,
  message_id text not null default '',
  attachment_id uuid,
  embedded_sha256 text not null default '',
  status text not null default 'pending',
  error text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint attachment_migration_items_source_table_chk check (btrim(source_table) <> ''),
  constraint attachment_migration_items_source_pk_chk check (btrim(source_pk) <> ''),
  constraint attachment_migration_items_resource_id_chk check (btrim(resource_id) <> ''),
  constraint attachment_migration_items_status_chk check (status in ('pending', 'migrated', 'skipped', 'failed')),
  primary key (migration_item_id),
  foreign key (migration_run_id) references attachment_migration_runs(migration_run_id) on delete cascade,
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, attachment_id) references attachments(company_id, attachment_id) on delete set null
);

create index if not exists idx_attachment_migration_items_run_status
  on attachment_migration_items(migration_run_id, status, migration_item_id);

create index if not exists idx_attachment_migration_items_resource
  on attachment_migration_items(company_id, resource_type, resource_id);

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

create table if not exists node_information (
  company_id uuid not null,
  information_id uuid not null,
  node_id uuid not null,
  type information_type not null,
  information text not null,
  save_batch_id uuid,
  save_kind text not null default 'legacy',
  saved_by_user_id uuid,
  saved_by_display_name text not null default '',
  source_information_id uuid,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint node_information_save_kind_chk check (save_kind in ('legacy', 'manual', 'auto')),
  constraint node_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (saved_by_user_id) references users (user_id) on delete set null,
  foreign key (company_id, node_id) references nodes (company_id, node_id)
);

create table if not exists node_projection_table (
  company_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  is_deleted boolean not null default false,
  revision bigint not null default 1,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint node_projection_table_nonblank_chk check (btrim(information) <> ''),
  constraint node_projection_table_revision_chk check (revision > 0),
  primary key (company_id, node_id, information_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id)
);

create table if not exists node_content_changes (
  company_id uuid not null,
  change_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  change_type text not null,
  text text not null,
  start_offset integer not null,
  end_offset integer not null,
  actor_user_id uuid,
  actor_display_name text not null default '',
  created_timestamp timestamptz not null default now(),
  constraint node_content_changes_type_chk check (change_type in ('addition', 'deletion')),
  constraint node_content_changes_text_nonblank_chk check (btrim(text) <> ''),
  constraint node_content_changes_offsets_chk check (start_offset >= 0 and end_offset >= start_offset),
  primary key (company_id, change_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (actor_user_id) references users (user_id) on delete set null
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
  idempotency_key text not null default '',
  created_timestamp timestamptz not null default now(),
  constraint node_timeline_events_type_chk check (event_type in ('logic_gate_transfer', 'verification_request')),
  constraint node_timeline_events_actor_name_chk check (btrim(actor_display_name) <> ''),
  constraint node_timeline_events_transfer_chk check (
    (event_type='logic_gate_transfer' and from_logic_gate_id is not null and to_logic_gate_id is not null and from_logic_gate_id<>to_logic_gate_id and btrim(from_logic_gate_name)<>'' and btrim(to_logic_gate_name)<>'')
    or (event_type='verification_request' and from_logic_gate_id is null and to_logic_gate_id is null)
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

create table if not exists node_content_change_seen (
  company_id uuid not null,
  change_id uuid not null,
  user_id uuid not null,
  seen_timestamp timestamptz not null default now(),
  primary key (company_id, change_id, user_id),
  foreign key (company_id, change_id) references node_content_changes (company_id, change_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create table if not exists node_projection_seen_snapshots (
  company_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  user_id uuid not null,
  information text not null,
  projection_updated_timestamp timestamptz not null,
  seen_timestamp timestamptz not null default now(),
  primary key (company_id, node_id, information_id, user_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create table if not exists node_map_positions (
  company_id uuid not null,
  node_id uuid not null,
  x double precision not null,
  y double precision not null,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, node_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

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

create table if not exists project_information (
  company_id uuid not null,
  information_id uuid not null,
  project_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_information_project
  on project_information(company_id, project_id, created_timestamp, information_id);

create table if not exists project_projection_table (
  company_id uuid not null,
  project_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_projection_table_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, project_id, information_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_projection_table_project_created
  on project_projection_table(company_id, project_id, type, created_timestamp desc, information_id);

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

create table if not exists logic_gate_information (
  company_id uuid not null,
  information_id uuid not null,
  logic_gate_id uuid not null,
  type information_type not null,
  information text not null,
  save_batch_id uuid,
  save_kind text not null default 'legacy',
  saved_by_user_id uuid,
  saved_by_display_name text not null default '',
  source_information_id uuid,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint logic_gate_information_save_kind_chk check (save_kind in ('legacy', 'manual', 'auto')),
  constraint logic_gate_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (saved_by_user_id) references users (user_id) on delete set null,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_projection_table (
  company_id uuid not null,
  logic_gate_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  is_deleted boolean not null default false,
  revision bigint not null default 1,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint logic_gate_projection_table_nonblank_chk check (btrim(information) <> ''),
  constraint logic_gate_projection_table_revision_chk check (revision > 0),
  primary key (company_id, logic_gate_id, information_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_map_positions (
  company_id uuid not null,
  logic_gate_id uuid not null,
  x double precision not null,
  y double precision not null,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, logic_gate_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
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

-- Existing deployments may already have current-value logic_gate_information rows.
-- Seed the projection table once so the new hot read path can serve those rows too.
do $$
begin
  if to_regclass('public.idx_logic_gate_projection_table_one_text_box') is not null then
    execute $sql$
      insert into logic_gate_projection_table (
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      )
      select distinct on (company_id, logic_gate_id, type)
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      from logic_gate_information
      where btrim(information) <> ''
        and type = 'Text box'::information_type
      order by company_id, logic_gate_id, type, updated_timestamp desc, created_timestamp desc, information_id desc
      on conflict (company_id, logic_gate_id, type) where type = 'Text box'::information_type
      do update set
        information = excluded.information,
        updated_timestamp = excluded.updated_timestamp
      where logic_gate_projection_table.updated_timestamp <= excluded.updated_timestamp
    $sql$;

    execute $sql$
      insert into logic_gate_projection_table (
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      )
      select distinct on (company_id, logic_gate_id, information_id)
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      from logic_gate_information
      where btrim(information) <> ''
        and type <> 'Text box'::information_type
      order by company_id, logic_gate_id, information_id, updated_timestamp desc
      on conflict (company_id, logic_gate_id, information_id)
      do update set
        type = excluded.type,
        information = excluded.information,
        updated_timestamp = excluded.updated_timestamp
      where logic_gate_projection_table.updated_timestamp <= excluded.updated_timestamp
    $sql$;
  else
    execute $sql$
      insert into logic_gate_projection_table (
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      )
      select distinct on (company_id, logic_gate_id, information_id)
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      from logic_gate_information
      where btrim(information) <> ''
      order by company_id, logic_gate_id, information_id, updated_timestamp desc
      on conflict (company_id, logic_gate_id, information_id)
      do update set
        type = excluded.type,
        information = excluded.information,
        updated_timestamp = excluded.updated_timestamp
      where logic_gate_projection_table.updated_timestamp <= excluded.updated_timestamp
    $sql$;
  end if;
end $$;
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

create or replace function enforce_node_logic_gate_assignment_priority()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from nodes n
    where n.company_id = new.company_id
      and n.node_id = new.node_id
      and n.priority between 1 and 5
  ) then
    raise exception 'node_logic_gate_assignment_priority_required'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_node_logic_gate_assignment_priority on node_logic_gate_assignments;
create trigger trg_node_logic_gate_assignment_priority
before insert or update of company_id, node_id on node_logic_gate_assignments
for each row
execute function enforce_node_logic_gate_assignment_priority();

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

-- Targeted My Work read model for GVIC assignment/priority cells.
-- Source of truth remains nodes, node_logic_gate_assignments, logic_gates,
-- projects/project_relationship_projection, resource_gvic_effective_assignments,
-- and node_account_assignments.
create table if not exists gvic_matrix_projection_table (
  company_id uuid not null,
  projection_row_id text not null,
  user_id uuid not null,
  node_name text not null,
  gvic_assignment text not null,
  priority smallint,
  project_id uuid,
  project_name text,
  logic_gate_id uuid,
  logic_gate_name text,
  node_id uuid not null,
  status text,
  due_date date,
  accounts jsonb not null default '[]'::jsonb,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  sort_order integer not null default 1,
  constraint gvic_matrix_projection_table_clean_pkey primary key (company_id, projection_row_id),
  constraint gvic_matrix_projection_gvic_assignment_chk check (
    gvic_assignment in ('generated', 'verified', 'consulted', 'informed')
  ),
  constraint gvic_matrix_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array'),
  constraint gvic_matrix_projection_priority_chk check (priority is null or priority between 1 and 5),
  constraint gvic_matrix_projection_sort_order_positive_chk check (sort_order > 0),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

create index if not exists idx_gvic_matrix_projection_leaf_user_cell
  on gvic_matrix_projection_table(company_id, user_id, gvic_assignment, priority, sort_order, projection_row_id);

create index if not exists idx_gvic_matrix_projection_leaf_node
  on gvic_matrix_projection_table(company_id, node_id);

create index if not exists idx_gvic_matrix_projection_leaf_project
  on gvic_matrix_projection_table(company_id, project_id);

create index if not exists idx_gvic_matrix_projection_leaf_logic_gate
  on gvic_matrix_projection_table(company_id, logic_gate_id);
create index if not exists idx_node_information_node on node_information(company_id, node_id);
create index if not exists idx_node_information_save_batch
  on node_information(company_id, node_id, save_batch_id, created_timestamp desc)
  where save_batch_id is not null;
create index if not exists idx_node_projection_table_node_updated on node_projection_table(company_id, node_id, updated_timestamp desc);
drop index if exists idx_node_projection_table_one_text_box;
create index if not exists idx_node_projection_table_node_type_created
  on node_projection_table(company_id, node_id, type, created_timestamp, information_id);
create index if not exists idx_node_content_changes_node_created
  on node_content_changes(company_id, node_id, created_timestamp, change_id);
create index if not exists idx_node_content_change_seen_user
  on node_content_change_seen(company_id, user_id, change_id);
create index if not exists idx_node_projection_seen_user
  on node_projection_seen_snapshots(company_id, user_id, node_id, information_id);
create index if not exists idx_node_map_positions_company_updated on node_map_positions(company_id, updated_timestamp desc);
create index if not exists idx_node_relationships_a on node_relationships(company_id, node_id_a);
create index if not exists idx_node_relationships_b on node_relationships(company_id, node_id_b);
create index if not exists idx_logic_gate_information_logic_gate on logic_gate_information(company_id, logic_gate_id);
create index if not exists idx_logic_gate_information_save_batch
  on logic_gate_information(company_id, logic_gate_id, save_batch_id, created_timestamp desc)
  where save_batch_id is not null;
create index if not exists idx_logic_gate_projection_table_logic_gate_updated on logic_gate_projection_table(company_id, logic_gate_id, updated_timestamp desc);
with ranked_logic_gate_text as (
  select ctid,
         row_number() over (
           partition by company_id, logic_gate_id, type
           order by updated_timestamp desc, created_timestamp desc, information_id desc
         ) as rn
  from logic_gate_projection_table
  where type = 'Text box'::information_type
)
delete from logic_gate_projection_table target
using ranked_logic_gate_text ranked
where target.ctid = ranked.ctid
  and ranked.rn > 1;
create unique index if not exists idx_logic_gate_projection_table_one_text_box on logic_gate_projection_table(company_id, logic_gate_id, type) where type = 'Text box'::information_type;
create index if not exists idx_logic_gate_map_positions_company_updated on logic_gate_map_positions(company_id, updated_timestamp desc);
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

create table if not exists communications_email_nodes (
  company_id uuid not null,
  user_id uuid not null,
  message_id text not null,
  node_id uuid not null,
  board_id text not null,
  card_id uuid not null,
  logic_gate_id uuid not null,
  message jsonb not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_nodes_message_id_nonblank_chk check (btrim(message_id) <> ''),
  primary key (company_id, node_id),
  unique (company_id, board_id, card_id),
  foreign key (user_id) references users (user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_communications_email_nodes_user_message
  on communications_email_nodes(user_id, message_id);

create index if not exists idx_communications_email_nodes_logic_gate
  on communications_email_nodes(company_id, logic_gate_id, created_timestamp desc);

create table if not exists communications_email_node_attachments (
  company_id uuid not null,
  user_id uuid not null,
  message_id text not null,
  node_id uuid not null,
  board_id text not null default '',
  card_id uuid not null,
  logic_gate_id uuid not null,
  message jsonb not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_node_attachments_message_id_nonblank_chk check (btrim(message_id) <> ''),
  primary key (company_id, user_id, message_id, node_id),
  foreign key (user_id) references users (user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_communications_email_node_attachments_user_message
  on communications_email_node_attachments(user_id, message_id);

create index if not exists idx_communications_email_node_attachments_node
  on communications_email_node_attachments(company_id, node_id, updated_timestamp desc);

create index if not exists idx_communications_email_node_attachments_logic_gate
  on communications_email_node_attachments(company_id, logic_gate_id, updated_timestamp desc);

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
  constraint shared_inboxes_company_email_connection_fkey foreign key (company_id, company_email_connection_id) references company_email_connections(company_id, company_email_connection_id)
);

create index if not exists idx_shared_inboxes_parent
  on shared_inboxes(company_id, parent_folder_id, position, created_timestamp);

create index if not exists idx_shared_inboxes_account_email
  on shared_inboxes(company_id, account_email);

create index if not exists idx_shared_inboxes_company_email_connection
  on shared_inboxes(company_id, company_email_connection_id);
do $$
begin
  if to_regclass('public.communications_email_signatures') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'communications_email_signatures_shared_inbox_fkey'
         and conrelid = 'communications_email_signatures'::regclass
     ) then
    alter table communications_email_signatures
      add constraint communications_email_signatures_shared_inbox_fkey
      foreign key (company_id, shared_inbox_id)
      references shared_inboxes(company_id, shared_inbox_id) on delete cascade;
  end if;
end $$;

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
  foreign key (company_email_connection_id) references company_email_connections(company_email_connection_id) on delete set null
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
  attempt_count integer not null default 0,
  last_error text not null default '',
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  archived_timestamp timestamptz,
  failed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_archive_job_items_message_chk check (btrim(message_id) <> ''),
  constraint communications_email_archive_job_items_status_chk check (status in ('pending', 'processing', 'retry', 'archived', 'failed')),
  unique (archive_job_id, message_id)
);

create index if not exists idx_communications_email_archive_job_items_claim
  on communications_email_archive_job_items(status, available_at, created_timestamp, job_item_id)
  where status in ('pending', 'processing', 'retry');

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

-- Match the current dev database validation state for legacy backfill constraints.
alter table logic_gate_information
  drop constraint if exists logic_gate_information_nonblank_chk;
alter table logic_gate_information
  add constraint logic_gate_information_nonblank_chk check (btrim(information) <> '') not valid;

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

alter table node_information
  drop constraint if exists node_information_nonblank_chk;
alter table node_information
  add constraint node_information_nonblank_chk check (btrim(information) <> '') not valid;

alter table node_projection_table
  drop constraint if exists node_projection_table_nonblank_chk;
alter table node_projection_table
  add constraint node_projection_table_nonblank_chk check (btrim(information) <> '') not valid;

create or replace function workspace_static_read_version_keys()
returns table(scope text, resource_key text) as $$
  select *
  from (values
    ('workspace-snapshot:full', ''),
    ('workspace-snapshot:node_map', ''),
    ('workspace-snapshot:node_map_window', ''),
    ('workspace-snapshot:logic_gate_map', ''),
    ('workspace-snapshot:logic_gate_map_window', ''),
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
    ('map-layout:node', ''),
    ('map-layout:node-window', ''),
    ('map-layout:logic_gate', ''),
    ('map-layout:logic_gate-window', ''),
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
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', ''),
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
      ('node-relationships', ''),
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'node_map_positions_updated' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:node', ''),
      ('map-layout:node-window', ''),
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'node_deleted' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:node', ''),
      ('map-layout:node-window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_created', 'logic_gate_updated', 'logic_gate_deleted', 'logic_gate_raci_updated', 'logic_gate_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gates', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', ''),
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
      ('logic-gate-relationships', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'logic_gate_map_positions_updated' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:logic_gate', ''),
      ('map-layout:logic_gate-window', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'logic_gate_deleted' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:logic_gate', ''),
      ('map-layout:logic_gate-window', '')
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
        ('workspace-snapshot:node_map', ''),
        ('workspace-snapshot:node_map_window', ''),
        ('map-layout:node-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif folder_kind = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:logic_gate_map', ''),
        ('workspace-snapshot:logic_gate_map_window', ''),
        ('map-layout:logic_gate-window', ''),
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
        ('workspace-snapshot:node_map', ''),
        ('workspace-snapshot:node_map_window', ''),
        ('map-layout:node-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif item_type = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:logic_gate_map', ''),
        ('workspace-snapshot:logic_gate_map_window', ''),
        ('map-layout:logic_gate-window', ''),
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
drop trigger if exists trg_logic_gate_work_version_email_origin on communications_email_nodes;
create trigger trg_logic_gate_work_version_email_origin after insert or update or delete on communications_email_nodes
for each row execute function mangorts_trg_bump_logic_gate_work_from_gate_row();

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

create or replace function mangorts_trg_bump_node_view_user_from_change_seen()
returns trigger language plpgsql as $$
declare
  target_node_id uuid;
begin
  if tg_op <> 'INSERT' then
    select node_id into target_node_id
    from node_content_changes
    where company_id=old.company_id and change_id=old.change_id;
    if target_node_id is not null then
      perform mangorts_bump_node_view_user_version(old.company_id, target_node_id, old.user_id);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    target_node_id := null;
    select node_id into target_node_id
    from node_content_changes
    where company_id=new.company_id and change_id=new.change_id;
    if target_node_id is not null then
      perform mangorts_bump_node_view_user_version(new.company_id, target_node_id, new.user_id);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create or replace function mangorts_trg_bump_node_view_user_from_snapshot()
returns trigger language plpgsql as $$
begin
  if current_setting('mangorts.node_view_anchor_clean', true) = '1' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_user_version(old.company_id, old.node_id, old.user_id);
  end if;
  if tg_op <> 'DELETE' then
    if tg_op='INSERT' or (new.company_id, new.node_id, new.user_id) is distinct from (old.company_id, old.node_id, old.user_id) then
      perform mangorts_bump_node_view_user_version(new.company_id, new.node_id, new.user_id);
    end if;
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

drop trigger if exists trg_node_view_version_information on node_information;
create trigger trg_node_view_version_information after insert or update or delete on node_information
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
drop trigger if exists trg_node_view_version_projection on node_projection_table;
create trigger trg_node_view_version_projection after insert or update or delete on node_projection_table
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
drop trigger if exists trg_node_view_version_content_changes on node_content_changes;
create trigger trg_node_view_version_content_changes after insert or update or delete on node_content_changes
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
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

drop trigger if exists trg_node_view_user_version_change_seen_mutation on node_content_change_seen;
create trigger trg_node_view_user_version_change_seen_mutation after insert or update on node_content_change_seen
for each row execute function mangorts_trg_bump_node_view_user_from_change_seen();
drop trigger if exists trg_node_view_user_version_change_seen_delete on node_content_change_seen;
create trigger trg_node_view_user_version_change_seen_delete before delete on node_content_change_seen
for each row execute function mangorts_trg_bump_node_view_user_from_change_seen();
drop trigger if exists trg_node_view_user_version_snapshots on node_projection_seen_snapshots;
create trigger trg_node_view_user_version_snapshots after insert or update or delete on node_projection_seen_snapshots
for each row execute function mangorts_trg_bump_node_view_user_from_snapshot();

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
  check (target_type in ('project', 'logic_gate', 'node'));

create table if not exists communications_email_collaborations (
  company_id uuid not null,
  collaboration_id uuid not null,
  node_id uuid not null,
  attached_email_information_id uuid not null,
  scope_type varchar not null,
  personal_user_id uuid,
  personal_account_email text,
  shared_inbox_id uuid,
  account_email text not null,
  provider_thread_id text not null default '',
  root_message_id text not null,
  latest_message_id text not null,
  message_snapshot jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_collaborations_scope_type_chk check (scope_type in ('personal', 'shared')),
  constraint communications_email_collaborations_scope_chk check (
    (scope_type='personal' and personal_user_id is not null and personal_account_email is not null and shared_inbox_id is null)
    or (scope_type='shared' and personal_user_id is null and personal_account_email is null and shared_inbox_id is not null)
  ),
  constraint communications_email_collaborations_account_email_chk check (btrim(account_email) <> '' and account_email=lower(btrim(account_email))),
  constraint communications_email_collaborations_personal_account_email_chk check (personal_account_email is null or (btrim(personal_account_email) <> '' and personal_account_email=lower(btrim(personal_account_email)))),
  constraint communications_email_collaborations_root_message_chk check (btrim(root_message_id) <> ''),
  constraint communications_email_collaborations_latest_message_chk check (btrim(latest_message_id) <> ''),
  constraint communications_email_collaborations_snapshot_object_chk check (jsonb_typeof(message_snapshot)='object'),
  primary key (company_id, collaboration_id),
  unique (company_id, node_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null
);
-- Keep immutable mailbox identifiers and the shared snapshot after a source mailbox is disconnected.
do $$
declare
  source_fk record;
begin
  for source_fk in
    select conname
    from pg_constraint
    where conrelid = 'communications_email_collaborations'::regclass
      and contype = 'f'
      and confrelid in ('user_email_connections'::regclass, 'shared_inboxes'::regclass)
  loop
    execute format('alter table communications_email_collaborations drop constraint %I', source_fk.conname);
  end loop;
end $$;

create unique index if not exists idx_email_collaborations_personal_thread
  on communications_email_collaborations(
    company_id,
    personal_user_id,
    personal_account_email,
    (case when provider_thread_id <> '' then 'thread:' || provider_thread_id else 'message:' || root_message_id end)
  ) where scope_type='personal';

create unique index if not exists idx_email_collaborations_shared_thread
  on communications_email_collaborations(
    company_id,
    shared_inbox_id,
    (case when provider_thread_id <> '' then 'thread:' || provider_thread_id else 'message:' || root_message_id end)
  ) where scope_type='shared';

create index if not exists idx_email_collaborations_latest_message
  on communications_email_collaborations(company_id, latest_message_id);

create table if not exists communications_email_collaboration_participants (
  company_id uuid not null,
  collaboration_id uuid not null,
  user_id uuid not null,
  added_by_user_id uuid,
  added_via_type text not null,
  added_via_id uuid,
  created_timestamp timestamptz not null default now(),
  constraint communications_email_collaboration_participants_via_chk check (added_via_type in ('creator', 'user', 'group')),
  constraint communications_email_collaboration_participants_via_id_chk check ((added_via_type='creator' and added_via_id is null) or (added_via_type in ('user', 'group') and added_via_id is not null)),
  primary key (company_id, collaboration_id, user_id),
  foreign key (company_id, collaboration_id) references communications_email_collaborations(company_id, collaboration_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (added_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_email_collaboration_participants_user
  on communications_email_collaboration_participants(company_id, user_id, created_timestamp desc);

alter table communications_email_drafts
  add column if not exists collaboration_id uuid,
  add column if not exists is_shared boolean not null default false,
  add column if not exists revision bigint not null default 1,
  add column if not exists send_state text not null default 'draft',
  add column if not exists send_claim_token text not null default '',
  add column if not exists send_idempotency_key text not null default '',
  add column if not exists send_idempotency_grant_id text not null default '',
  add column if not exists send_idempotency_timestamp timestamptz,
  add column if not exists send_claimed_revision bigint not null default 0,
  add column if not exists send_claimed_timestamp timestamptz,
  add column if not exists sent_message_id text not null default '';

alter table communications_email_drafts
  drop constraint if exists communications_email_drafts_shared_collaboration_chk;
alter table communications_email_drafts
  add constraint communications_email_drafts_shared_collaboration_chk
  check ((is_shared and collaboration_id is not null) or (not is_shared and collaboration_id is null));

alter table communications_email_drafts
  drop constraint if exists communications_email_drafts_revision_chk;
alter table communications_email_drafts
  add constraint communications_email_drafts_revision_chk check (revision > 0);

-- Shared collaboration drafts keep their immutable source identifiers and send-recovery
-- state after a mailbox source is removed. Ordinary private drafts retain their former
-- source-delete cleanup semantics through the two source-table triggers below.
do $$
declare
  source_fk record;
begin
  for source_fk in
    select conname
    from pg_constraint
    where conrelid = 'communications_email_drafts'::regclass
      and contype = 'f'
      and confrelid in ('user_email_connections'::regclass, 'shared_inboxes'::regclass)
  loop
    execute format('alter table communications_email_drafts drop constraint %I', source_fk.conname);
  end loop;
end $$;

create or replace function mangorts_cleanup_private_personal_email_drafts()
returns trigger language plpgsql as $$
begin
  delete from communications_email_drafts
  where not is_shared
    and personal_user_id = old.user_id
    and personal_account_email = old.account_email;
  return old;
end;
$$;

drop trigger if exists trg_cleanup_private_email_drafts_personal_source on user_email_connections;
create trigger trg_cleanup_private_email_drafts_personal_source
before delete on user_email_connections
for each row execute function mangorts_cleanup_private_personal_email_drafts();

create or replace function mangorts_cleanup_private_shared_email_drafts()
returns trigger language plpgsql as $$
begin
  delete from communications_email_drafts
  where not is_shared
    and company_id = old.company_id
    and shared_inbox_id = old.shared_inbox_id;
  return old;
end;
$$;

drop trigger if exists trg_cleanup_private_email_drafts_shared_source on shared_inboxes;
create trigger trg_cleanup_private_email_drafts_shared_source
before delete on shared_inboxes
for each row execute function mangorts_cleanup_private_shared_email_drafts();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='communications_email_drafts'::regclass
      and conname='communications_email_drafts_collaboration_fkey'
  ) then
    alter table communications_email_drafts
      add constraint communications_email_drafts_collaboration_fkey
      foreign key (company_id, collaboration_id)
      references communications_email_collaborations(company_id, collaboration_id)
      on delete cascade;
  end if;
end $$;

create index if not exists idx_communications_email_drafts_collaboration_updated
  on communications_email_drafts(company_id, collaboration_id, updated_timestamp desc)
  where deleted_timestamp is null and collaboration_id is not null;

create unique index if not exists idx_communications_email_drafts_active_shared_source
  on communications_email_drafts(company_id, collaboration_id, source_message_id)
  where is_shared and deleted_timestamp is null and source_message_id <> '';


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


-- Logic Gate collaboration treats every independently editable text body as an
-- exact document. Remove the historical one-text-box-per-gate uniqueness rule.
drop index if exists idx_logic_gate_projection_table_one_text_box;
create index if not exists idx_logic_gate_projection_table_text_boxes
  on logic_gate_projection_table(company_id, logic_gate_id, created_timestamp, information_id)
  where type = 'Text box'::information_type;

-- Durable provider-independent email snapshots for Node and collaboration reads.
-- Provider credentials, attachment bytes, object URLs, and presigned URLs are
-- excluded; attachment bytes live in Mango's private attachment object storage.
create table if not exists communications_email_threads (
  company_id uuid not null,
  email_thread_id uuid not null,
  scope_type varchar(16) not null,
  personal_user_id uuid,
  personal_account_email text,
  shared_inbox_id uuid,
  account_email text not null,
  provider_thread_key text not null,
  provider_thread_id text not null default '',
  root_provider_message_id text not null,
  download_status text not null default 'partial',
  history_complete boolean not null default false,
  fetched_at timestamptz,
  last_download_error text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_threads_scope_type_chk check (scope_type in ('personal', 'shared')),
  constraint communications_email_threads_scope_chk check (
    (scope_type='personal' and personal_user_id is not null and personal_account_email is not null and shared_inbox_id is null)
    or
    (scope_type='shared' and personal_user_id is null and personal_account_email is null and shared_inbox_id is not null)
  ),
  constraint communications_email_threads_account_email_chk check (btrim(account_email) <> '' and account_email=lower(btrim(account_email))),
  constraint communications_email_threads_personal_account_email_chk check (
    personal_account_email is null or (btrim(personal_account_email) <> '' and personal_account_email=lower(btrim(personal_account_email)))
  ),
  constraint communications_email_threads_provider_key_chk check (btrim(provider_thread_key) <> ''),
  constraint communications_email_threads_root_message_chk check (btrim(root_provider_message_id) <> ''),
  constraint communications_email_threads_download_status_chk check (
    download_status in ('partial', 'downloading', 'complete', 'failed') and (not history_complete or download_status in ('downloading', 'complete', 'failed'))
  ),
  primary key (company_id, email_thread_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, personal_user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, shared_inbox_id) references shared_inboxes(company_id, shared_inbox_id) on delete cascade
);

create unique index if not exists idx_communications_email_threads_personal_provider
  on communications_email_threads(company_id, personal_user_id, personal_account_email, provider_thread_key)
  where scope_type='personal';

create unique index if not exists idx_communications_email_threads_shared_provider
  on communications_email_threads(company_id, shared_inbox_id, provider_thread_key)
  where scope_type='shared';

create table if not exists communications_email_messages (
  company_id uuid not null,
  email_message_id uuid not null,
  email_thread_id uuid not null,
  provider_message_id text not null,
  provider_thread_id text not null default '',
  message_order integer not null,
  subject text not null default '',
  sender_snapshot jsonb not null default '[]'::jsonb,
  to_snapshot jsonb not null default '[]'::jsonb,
  cc_snapshot jsonb not null default '[]'::jsonb,
  bcc_snapshot jsonb not null default '[]'::jsonb,
  reply_to_snapshot jsonb not null default '[]'::jsonb,
  message_timestamp bigint not null default 0,
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
  constraint communications_email_messages_provider_message_chk check (btrim(provider_message_id) <> ''),
  constraint communications_email_messages_order_chk check (message_order >= 0),
  constraint communications_email_messages_json_chk check (
    jsonb_typeof(sender_snapshot)='array'
    and jsonb_typeof(to_snapshot)='array'
    and jsonb_typeof(cc_snapshot)='array'
    and jsonb_typeof(bcc_snapshot)='array'
    and jsonb_typeof(reply_to_snapshot)='array'
    and jsonb_typeof(folder_snapshot)='array'
    and jsonb_typeof(folder_id_snapshot)='array'
    and jsonb_typeof(attachment_metadata)='array'
  ),
  primary key (company_id, email_message_id),
  unique (company_id, email_thread_id, provider_message_id),
  foreign key (company_id, email_thread_id)
    references communications_email_threads(company_id, email_thread_id) on delete cascade
);

create index if not exists idx_communications_email_messages_thread_order
  on communications_email_messages(company_id, email_thread_id, message_order, provider_message_id);

create table if not exists communications_node_email_threads (
  company_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  email_thread_id uuid not null,
  selected_provider_message_id text not null,
  created_by_user_id uuid,
  created_timestamp timestamptz not null default now(),
  constraint communications_node_email_threads_selected_message_chk check (btrim(selected_provider_message_id) <> ''),
  primary key (company_id, node_id, information_id),
  unique (company_id, node_id, email_thread_id),
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade,
  foreign key (company_id, email_thread_id)
    references communications_email_threads(company_id, email_thread_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_communications_node_email_threads_read
  on communications_node_email_threads(company_id, node_id, email_thread_id);

create table if not exists communications_email_thread_download_jobs (
  download_job_id uuid primary key,
  company_id uuid not null,
  email_thread_id uuid not null,
  download_scope text not null,
  requested_provider_message_id text not null default '',
  requested_by_user_id uuid,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text not null default '',
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_timestamp timestamptz,
  failed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_thread_download_jobs_scope_chk check (
    (download_scope='full_thread' and requested_provider_message_id='')
    or (download_scope='message' and btrim(requested_provider_message_id)<>'')
  ),
  constraint communications_email_thread_download_jobs_status_chk check (status in ('pending','processing','retry','completed','failed')),
  constraint communications_email_thread_download_jobs_attempt_chk check (attempt_count >= 0),
  foreign key (company_id, email_thread_id)
    references communications_email_threads(company_id, email_thread_id) on delete cascade,
  foreign key (requested_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_communications_email_thread_download_jobs_active_full
  on communications_email_thread_download_jobs(company_id, email_thread_id)
  where download_scope='full_thread' and status in ('pending','processing','retry');

create unique index if not exists idx_communications_email_thread_download_jobs_active_message
  on communications_email_thread_download_jobs(company_id, email_thread_id, requested_provider_message_id)
  where download_scope='message' and status in ('pending','processing','retry');

create index if not exists idx_communications_email_thread_download_jobs_claim
  on communications_email_thread_download_jobs(status, available_at, created_timestamp)
  where status in ('pending','processing','retry');

alter table communications_email_collaborations
  add column if not exists email_thread_id uuid;

alter table communications_email_nodes
  add column if not exists email_thread_id uuid;

alter table communications_email_node_attachments
  add column if not exists email_thread_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='communications_email_collaborations'::regclass
      and conname='communications_email_collaborations_email_thread_fk'
  ) then
    alter table communications_email_collaborations
      add constraint communications_email_collaborations_email_thread_fk
      foreign key (company_id, email_thread_id)
      references communications_email_threads(company_id, email_thread_id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='communications_email_nodes'::regclass
      and conname='communications_email_nodes_email_thread_fk'
  ) then
    alter table communications_email_nodes
      add constraint communications_email_nodes_email_thread_fk
      foreign key (company_id, email_thread_id)
      references communications_email_threads(company_id, email_thread_id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='communications_email_node_attachments'::regclass
      and conname='communications_email_node_attachments_email_thread_fk'
  ) then
    alter table communications_email_node_attachments
      add constraint communications_email_node_attachments_email_thread_fk
      foreign key (company_id, email_thread_id)
      references communications_email_threads(company_id, email_thread_id) on delete restrict;
  end if;
end
$$;
-- Permanent TipTap JSON storage for Node text boxes.
create table if not exists node_textboxes (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  body_json jsonb not null,
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
-- Additive V3 email expansion. Legacy communications_email_* and
-- resource_attachments tables remain until the backend cutover has passed.
create table if not exists email_threads (
  company_id uuid not null,
  email_thread_id uuid not null,
  email_account_type text not null,
  personal_user_id uuid,
  personal_account_email text,
  shared_inbox_id uuid,
  email_account_email text not null,
  provider text not null,
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
  constraint email_threads_account_type_chk check (
    email_account_type in ('personal_email_account', 'shared_email_account')
  ),
  constraint email_threads_account_scope_chk check (
    (email_account_type = 'personal_email_account'
      and personal_user_id is not null and personal_account_email is not null
      and shared_inbox_id is null)
    or
    (email_account_type = 'shared_email_account'
      and personal_user_id is null and personal_account_email is null
      and shared_inbox_id is not null)
  ),
  constraint email_threads_account_email_chk check (
    btrim(email_account_email) <> ''
    and email_account_email = lower(btrim(email_account_email))
  ),
  constraint email_threads_personal_account_email_chk check (
    personal_account_email is null
    or (btrim(personal_account_email) <> ''
      and personal_account_email = lower(btrim(personal_account_email)))
  ),
  constraint email_threads_provider_chk check (provider in ('google', 'microsoft')),
  constraint email_threads_provider_key_chk check (btrim(provider_thread_key) <> ''),
  constraint email_threads_root_message_chk check (btrim(root_provider_message_id) <> ''),
  constraint email_threads_download_status_chk check (
    download_status in ('partial', 'downloading', 'complete', 'failed')
    and (not history_complete or download_status in ('downloading', 'complete', 'failed'))
  )
);

create unique index if not exists idx_email_threads_personal_provider
  on email_threads(
    company_id, personal_user_id, personal_account_email, provider, provider_thread_key
  ) where email_account_type = 'personal_email_account';

create unique index if not exists idx_email_threads_shared_provider
  on email_threads(company_id, shared_inbox_id, provider, provider_thread_key)
  where email_account_type = 'shared_email_account';

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

create table if not exists email_drafts (
  company_id uuid not null,
  draft_id text not null,
  email_relationship_id uuid,
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
  foreign key (company_id,email_relationship_id)
    references email_relationships(company_id,email_relationship_id) on delete set null,
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
create index if not exists idx_email_drafts_relationship_updated
  on email_drafts(company_id,email_relationship_id,updated_timestamp desc)
  where deleted_timestamp is null and email_relationship_id is not null;

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

create table if not exists email_thread_download_jobs (
  download_job_id uuid primary key,
  company_id uuid not null,
  email_thread_id uuid not null,
  download_scope text not null,
  requested_provider_message_id text not null default '',
  requested_by_user_id uuid,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text not null default '',
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_timestamp timestamptz,
  failed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  foreign key (company_id,email_thread_id)
    references email_threads(company_id,email_thread_id) on delete cascade,
  foreign key (requested_by_user_id) references users(user_id) on delete set null,
  constraint email_thread_download_jobs_scope_chk check (
    (download_scope='full_thread' and requested_provider_message_id='')
    or (download_scope='message' and btrim(requested_provider_message_id)<>'')
  ),
  constraint email_thread_download_jobs_status_chk check (
    status in ('pending','processing','retry','completed','failed')
  ),
  constraint email_thread_download_jobs_attempt_chk check (attempt_count >= 0)
);
create unique index if not exists idx_email_thread_download_jobs_active_full
  on email_thread_download_jobs(company_id,email_thread_id)
  where download_scope='full_thread' and status in ('pending','processing','retry');
create unique index if not exists idx_email_thread_download_jobs_active_message
  on email_thread_download_jobs(company_id,email_thread_id,requested_provider_message_id)
  where download_scope='message' and status in ('pending','processing','retry');
create index if not exists idx_email_thread_download_jobs_claim
  on email_thread_download_jobs(status,available_at,created_timestamp)
  where status in ('pending','processing','retry');
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

create table if not exists v3_email_migration_runs (
  run_id uuid primary key,
  mapping_version integer not null,
  status text not null,
  summary jsonb not null default '{}'::jsonb,
  started_timestamp timestamptz not null default now(),
  completed_timestamp timestamptz,
  constraint v3_email_migration_runs_version_chk check (mapping_version > 0),
  constraint v3_email_migration_runs_status_chk check (status in ('running','complete')),
  constraint v3_email_migration_runs_summary_chk check (jsonb_typeof(summary)='object')
);
create table if not exists v3_email_migration_items (
  run_id uuid not null,
  source_table text not null,
  company_id uuid not null,
  source_key text not null,
  target_table text not null,
  target_key text not null,
  disposition text not null,
  source_checksum text not null,
  recorded_timestamp timestamptz not null default now(),
  primary key (run_id,source_table,company_id,source_key),
  foreign key (run_id) references v3_email_migration_runs(run_id) on delete cascade,
  constraint v3_email_migration_items_source_chk check (btrim(source_table)<>''),
  constraint v3_email_migration_items_source_key_chk check (btrim(source_key)<>''),
  constraint v3_email_migration_items_target_chk check (btrim(target_table)<>''),
  constraint v3_email_migration_items_target_key_chk check (btrim(target_key)<>''),
  constraint v3_email_migration_items_disposition_chk check (
    disposition in ('copied','updated','consolidated_duplicate','retained_without_source_link',
      'retained_orphan_evidence')
  ),
  constraint v3_email_migration_items_checksum_chk check (
    source_checksum ~ '^[0-9a-f]{32}$'
  )
);
