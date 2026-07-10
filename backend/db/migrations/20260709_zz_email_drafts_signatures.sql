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
  foreign key (personal_user_id, personal_account_email) references user_email_connections(user_id, account_email) on delete cascade,
  foreign key (company_id, shared_inbox_id) references shared_inboxes(company_id, shared_inbox_id) on delete cascade,
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
  foreign key (company_id, shared_inbox_id) references shared_inboxes(company_id, shared_inbox_id) on delete cascade,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (updated_by_user_id) references users(user_id) on delete set null
);

create unique index if not exists idx_communications_email_signatures_personal_scope
  on communications_email_signatures(company_id, personal_user_id, personal_account_email)
  where personal_user_id is not null;

create unique index if not exists idx_communications_email_signatures_shared_scope
  on communications_email_signatures(company_id, shared_inbox_id)
  where shared_inbox_id is not null;

alter table resource_attachments
  drop constraint if exists resource_attachments_type_chk;

alter table resource_attachments
  add constraint resource_attachments_type_chk check (
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
  );
