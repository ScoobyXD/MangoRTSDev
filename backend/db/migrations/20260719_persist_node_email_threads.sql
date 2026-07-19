-- Durable provider-independent email snapshots for Node and collaboration reads.
-- Provider credentials, attachment bytes, object URLs, and presigned URLs are
-- intentionally excluded from these tables.
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
  hydration_status text not null default 'partial',
  history_complete boolean not null default false,
  fetched_at timestamptz,
  last_hydration_error text not null default '',
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
  constraint communications_email_threads_hydration_chk check (
    hydration_status in ('partial', 'complete') and (not history_complete or hydration_status='complete')
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
