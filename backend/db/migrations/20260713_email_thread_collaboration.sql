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
  scope_type text not null,
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
  constraint communications_email_collaborations_scope_type_chk
    check (scope_type in ('personal', 'shared')),
  constraint communications_email_collaborations_scope_chk check (
    (scope_type='personal' and personal_user_id is not null and personal_account_email is not null and shared_inbox_id is null)
    or (scope_type='shared' and personal_user_id is null and personal_account_email is null and shared_inbox_id is not null)
  ),
  constraint communications_email_collaborations_account_email_chk
    check (btrim(account_email) <> '' and account_email=lower(btrim(account_email))),
  constraint communications_email_collaborations_personal_account_email_chk
    check (personal_account_email is null or (btrim(personal_account_email) <> '' and personal_account_email=lower(btrim(personal_account_email)))),
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
  constraint communications_email_collaboration_participants_via_chk
    check (added_via_type in ('creator', 'user', 'group')),
  constraint communications_email_collaboration_participants_via_id_chk
    check ((added_via_type='creator' and added_via_id is null) or (added_via_type in ('user', 'group') and added_via_id is not null)),
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

-- A collaboration and its shared draft retain immutable source identifiers after a
-- mailbox disconnect/delete. Remove the historical unconditional cascades and keep
-- the same cleanup behavior only for ordinary (non-collaboration) private drafts.
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
