-- V3 EMAIL EXPANSION COMPONENT.
-- Additive only: creates final tables, constraints, indexes, validation trigger, and audit ledger.
-- It does not copy data, change backend readers/writers, or delete legacy rows.

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
-- Keep exact reruns compatible when this operator-owned table was created by
-- an earlier Step 2 version before orphan evidence became an explicit outcome.
alter table v3_email_migration_items
 drop constraint if exists v3_email_migration_items_disposition_chk;
alter table v3_email_migration_items
 add constraint v3_email_migration_items_disposition_chk check (
  disposition in ('copied','updated','consolidated_duplicate',
   'retained_without_source_link','retained_orphan_evidence')
 );
