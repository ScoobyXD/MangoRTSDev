create table if not exists attachments (
  attachment_id uuid not null,
  company_id uuid not null,
  uploaded_by_user_id uuid,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null,
  sha256 text not null,
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

create table if not exists attachment_variants (
  attachment_id uuid not null,
  variant_type text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,
  storage_bucket text not null,
  storage_key text not null,
  created_timestamp timestamptz not null default now(),
  constraint attachment_variants_type_chk check (variant_type in ('original', 'display', 'thumbnail', 'email_send')),
  constraint attachment_variants_mime_type_nonblank_chk check (btrim(mime_type) <> ''),
  constraint attachment_variants_byte_size_chk check (byte_size >= 0),
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
