-- STEP 2: create/copy/recount/reconcile the retained V3 email data.
--
-- This is one plain PostgreSQL SQL file. It contains no psql-only backslash
-- commands, so the entire file can be opened and executed in DBeaver.
--
-- First run scripts/v3_email_step1_count.sql and review READY_TO_COPY.
-- Pause the API, email sync/download/archive workers, webhook consumers, and all
-- other legacy email writers while this file runs. Keep the backend on the old
-- tables after commit; backend cutover is a separate future step.
--
-- Safe failure: one outer transaction rolls back every target-table change.
-- Safe rerun: stable identities are reused and exact source rows are refreshed.
-- This script never updates or deletes a legacy table.

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
-- BEGIN INLINED SCHEMA EXPANSION
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
    disposition in ('copied','updated','consolidated_duplicate','retained_without_source_link')
  ),
  constraint v3_email_migration_items_checksum_chk check (
    source_checksum ~ '^[0-9a-f]{32}$'
  )
);
-- END INLINED SCHEMA EXPANSION


create temp table v3_current_email_run(run_id uuid primary key) on commit drop;
insert into v3_current_email_run values(gen_random_uuid());
insert into v3_email_migration_runs(run_id,mapping_version,status)
select run_id,1,'running' from v3_current_email_run;
-- BEGIN INLINED SOURCE CLASSIFICATION
create function pg_temp.v3_email_uuid(value text)
returns uuid language sql immutable strict as $$
select (substr(md5(value),1,8)||'-'||substr(md5(value),9,4)||'-'||
substr(md5(value),13,4)||'-'||substr(md5(value),17,4)||'-'||
substr(md5(value),21,12))::uuid
$$;

create function pg_temp.v3_query_unescape(value text)
returns text language plpgsql immutable strict as $$
declare i integer:=1; decoded bytea:=''::bytea; ch text;
begin
  while i<=char_length(value) loop
    ch:=substr(value,i,1);
    if ch='+' then decoded:=decoded||convert_to(' ','UTF8'); i:=i+1;
    elsif ch='%' then
      if i+2>char_length(value) or substr(value,i+1,2)!~'^[0-9A-Fa-f]{2}$' then
        raise exception 'invalid URL escape in legacy attachment resource ID';
      end if;
      decoded:=decoded||decode(substr(value,i+1,2),'hex'); i:=i+3;
    else decoded:=decoded||convert_to(ch,'UTF8'); i:=i+1;
    end if;
  end loop;
  return btrim(convert_from(decoded,'UTF8'));
end $$;
create function pg_temp.v3_assert_columns(expected_table text,expected_columns text[])
returns void language plpgsql as $$
declare actual_columns text[];
begin
 select array_agg(column_name order by ordinal_position) into actual_columns
 from information_schema.columns
 where table_schema=current_schema() and table_name=expected_table;
 if actual_columns is distinct from expected_columns then
  raise exception 'V3 email target column drift for %: expected %, found %',
   expected_table,expected_columns,actual_columns;
 end if;
end $$;

select pg_temp.v3_assert_columns('email_threads',array[
 'company_id','email_thread_id','email_account_type','personal_user_id',
 'personal_account_email','shared_inbox_id','email_account_email','provider',
 'provider_thread_key','provider_thread_id','root_provider_message_id',
 'download_status','history_complete','fetched_timestamp','last_download_error',
 'created_timestamp','updated_timestamp'
]);
select pg_temp.v3_assert_columns('email_messages',array[
 'company_id','email_message_id','email_thread_id','provider_message_id',
 'message_order','subject','sender_snapshot','to_snapshot','cc_snapshot',
 'bcc_snapshot','reply_to_snapshot','message_timestamp','rich_html_body',
 'text_fallback','snippet','unread','starred','folder_snapshot',
 'folder_id_snapshot','attachment_metadata','download_complete',
 'created_timestamp','updated_timestamp'
]);
select pg_temp.v3_assert_columns('email_relationships',array[
 'company_id','email_relationship_id','email_thread_id','email_message_id',
 'resource_type','resource_id','resource_textbox_id','created_timestamp'
]);
select pg_temp.v3_assert_columns('email_drafts',array[
 'company_id','draft_id','email_relationship_id','source_email_message_id',
 'email_account_type','personal_user_id','personal_account_email','shared_inbox_id',
 'sender_account_email','created_by_user_id','updated_by_user_id','kind',
 'to_recipients','cc_recipients','bcc_recipients','subject','body_editor_html',
 'scheduled_send_timestamp','revision','send_state','send_claim_token',
 'send_idempotency_key','send_idempotency_grant_id','send_idempotency_timestamp',
 'send_claimed_revision','send_claimed_timestamp','sent_email_message_id',
 'sent_provider_message_id','created_timestamp','updated_timestamp','deleted_timestamp'
]);
select pg_temp.v3_assert_columns('email_signatures',array[
 'company_id','signature_id','email_account_type','personal_user_id',
 'personal_account_email','shared_inbox_id','email_account_email','name',
 'body_editor_html','is_default','created_by_user_id','updated_by_user_id',
 'created_timestamp','updated_timestamp'
]);
select pg_temp.v3_assert_columns('email_thread_download_jobs',array[
 'download_job_id','company_id','email_thread_id','download_scope',
 'requested_provider_message_id','requested_by_user_id','status','attempt_count',
 'last_error','available_at','processing_started_at','completed_timestamp',
 'failed_timestamp','created_timestamp','updated_timestamp'
]);
select pg_temp.v3_assert_columns('attachment_relationships',array[
 'attachment_relationship_id','company_id','resource_type','resource_id',
 'attachment_id','information_id','message_id','editor_surface',
 'relationship_kind','created_by_user_id','created_timestamp','deleted_timestamp'
]);


do $$
begin
  if (select count(*) from recycle_bin_items)<>0 then
    raise exception 'approved recycle-bin cleanup drifted from zero rows';
  end if;
end $$;

create temp table v3_projections on commit drop as
select p.company_id,'node'::text resource_type,p.node_id resource_id,
 p.information_id email_relationship_id,p.information::jsonb payload,
 p.created_timestamp,p.updated_timestamp
from node_projection_table p where p.type::text='Attached email' and not p.is_deleted
union all
select p.company_id,'project',p.project_id,p.information_id,p.information::jsonb,
 p.created_timestamp,p.updated_timestamp
from project_projection_table p where p.type::text='Attached email'
union all
select p.company_id,'logic_gate',p.logic_gate_id,p.information_id,p.information::jsonb,
 p.created_timestamp,p.updated_timestamp
from logic_gate_projection_table p where p.type::text='Attached email' and not p.is_deleted;

do $$
begin
  if exists(select 1 from v3_projections where jsonb_typeof(payload)<>'object'
    or btrim(coalesce(payload->>'message_id',''))=''
    or btrim(coalesce(payload->>'thread_id',''))=''
    or jsonb_typeof(payload->'date')<>'number'
    or jsonb_typeof(payload->'from')<>'string') then
    raise exception 'invalid retained Attached-email projection';
  end if;
  if exists(select 1 from v3_projections group by company_id,email_relationship_id having count(*)>1) then
    raise exception 'duplicate retained relationship ID';
  end if;
end $$;

create temp table v3_legacy_threads on commit drop as
select t.*,case t.scope_type when 'personal' then 'personal_email_account'
 else 'shared_email_account' end email_account_type,p.provider
from communications_email_threads t
cross join lateral (
 select count(distinct x.provider) n,min(x.provider) provider from (
  select u.provider from user_email_connections u where t.scope_type='personal'
   and u.user_id=t.personal_user_id and u.account_email=t.personal_account_email
  union
  select c.provider from shared_inboxes s join company_email_connections c
   on c.company_id=s.company_id
   and c.company_email_connection_id=s.company_email_connection_id
   where t.scope_type='shared' and s.company_id=t.company_id
   and s.shared_inbox_id=t.shared_inbox_id
  union
  select e.provider from email_threads e where e.company_id=t.company_id
   and e.email_thread_id=t.email_thread_id
 ) x
) p where p.n=1 and p.provider in('google','microsoft');

do $$
begin
 if (select count(*) from v3_legacy_threads)<>(select count(*) from communications_email_threads) then
  raise exception 'cannot prove one provider for every normalized legacy thread';
 end if;
end $$;

create temp table v3_account_candidates on commit drop as
select distinct p.email_relationship_id,10 priority,t.scope_type,t.personal_user_id,
 t.personal_account_email,t.shared_inbox_id,t.account_email,t.provider
from v3_projections p join communications_email_messages m
 on m.company_id=p.company_id and m.provider_message_id=p.payload->>'message_id'
join v3_legacy_threads t on t.company_id=m.company_id and t.email_thread_id=m.email_thread_id
where nullif(btrim(p.payload->>'email_thread_id'),'') is null
 or (pg_input_is_valid(p.payload->>'email_thread_id','uuid')
 and m.email_thread_id=(p.payload->>'email_thread_id')::uuid)
union
select p.email_relationship_id,20,c.scope_type,c.personal_user_id,
 c.personal_account_email,c.shared_inbox_id,c.account_email,coalesce(u.provider,ce.provider)
from v3_projections p join communications_email_collaborations c
 on c.company_id=p.company_id and c.attached_email_information_id=p.email_relationship_id
left join user_email_connections u on c.scope_type='personal'
 and u.user_id=c.personal_user_id and u.account_email=c.personal_account_email
left join shared_inboxes s on c.scope_type='shared' and s.company_id=c.company_id
 and s.shared_inbox_id=c.shared_inbox_id
left join company_email_connections ce on ce.company_id=s.company_id
 and ce.company_email_connection_id=s.company_email_connection_id
union
select p.email_relationship_id,30,'shared',null,null,s.shared_inbox_id,s.account_email,c.provider
from v3_projections p join shared_inboxes s on s.company_id=p.company_id
 and pg_input_is_valid(p.payload->>'shared_inbox_id','uuid')
 and s.shared_inbox_id=(p.payload->>'shared_inbox_id')::uuid
join company_email_connections c on c.company_id=s.company_id
 and c.company_email_connection_id=s.company_email_connection_id
union
select p.email_relationship_id,40,'personal',cm.user_id,u.account_email,null,u.account_email,u.provider
from v3_projections p join company_memberships cm on cm.company_id=p.company_id
join user_email_connections u on u.user_id=cm.user_id
 and u.account_email=lower(btrim(p.payload->>'account_email'))
where nullif(btrim(p.payload->>'account_email'),'') is not null
 and nullif(btrim(p.payload->>'shared_inbox_id'),'') is null
union
select p.email_relationship_id,50,'personal',n.user_id,u.account_email,null,u.account_email,u.provider
from v3_projections p join communications_email_nodes n on p.resource_type='node'
 and n.company_id=p.company_id and n.node_id=p.resource_id
 and n.message_id=p.payload->>'message_id'
join user_email_connections u on u.user_id=n.user_id
union
select p.email_relationship_id,60,'personal',n.user_id,u.account_email,null,u.account_email,u.provider
from v3_projections p join communications_email_node_attachments n on p.resource_type='node'
 and n.company_id=p.company_id and n.node_id=p.resource_id
 and n.message_id=p.payload->>'message_id'
join user_email_connections u on u.user_id=n.user_id
union
select p.email_relationship_id,70,j.connection_scope,
 case when j.connection_scope='personal' then j.actor_user_id end,
 case when j.connection_scope='personal' then j.account_email end,
 case when j.connection_scope='shared' then j.shared_inbox_id end,
 j.account_email,j.provider
from v3_projections p join communications_email_archive_job_items i
 on i.message_id=p.payload->>'message_id'
join communications_email_archive_jobs j on j.archive_job_id=i.archive_job_id
 and j.company_id=p.company_id;

create temp table v3_projection_accounts on commit drop as
with ranked as (
 select c.*,min(priority) over(partition by email_relationship_id) best
 from v3_account_candidates c where provider in('google','microsoft')
), distinct_best as (
 select distinct email_relationship_id,scope_type,personal_user_id,
  personal_account_email,shared_inbox_id,lower(btrim(account_email)) account_email,provider
 from ranked where priority=best
), counted as (
 select b.*,count(*) over(partition by email_relationship_id) candidate_count from distinct_best b
)
select p.*,
 case when p.resource_type='node' and p.payload->>'block_id'=p.email_relationship_id::text
  then null else nullif(btrim(p.payload->>'block_id'),'') end resource_textbox_id,
 c.scope_type,c.personal_user_id,c.personal_account_email,c.shared_inbox_id,
 c.account_email,c.provider,c.candidate_count
from v3_projections p left join counted c using(email_relationship_id);

do $$
begin
 if exists(select 1 from v3_projection_accounts where candidate_count is distinct from 1) then
  raise exception 'retained relationship does not have exactly one source email account';
 end if;
 if (
  select coalesce(sum(source_count-1),0) from (
   select count(*) source_count from v3_projection_accounts
   group by company_id,provider,scope_type,personal_user_id,personal_account_email,
    shared_inbox_id,payload->>'message_id',resource_type,resource_id,
    coalesce(resource_textbox_id,'') having count(*)>1
  ) duplicate_groups
 )<>28 or exists(
  select 1 from v3_projection_accounts
  group by company_id,provider,scope_type,personal_user_id,personal_account_email,
   shared_inbox_id,payload->>'message_id',resource_type,resource_id,
   coalesce(resource_textbox_id,'')
  having count(*)>1 and not (
   count(*)=2
   and count(*) filter(where resource_type='node'
    and payload->>'block_id'=email_relationship_id::text)=1
   and count(*) filter(where payload->>'created_from_email'='true')=1
   and count(*) filter(where nullif(payload->>'collaboration_id','') is not null)=1
  )
 ) then
  raise exception 'retained duplicate relationship pairs do not match the approved 28 exact pairs';
 end if;
end $$;

create temp table v3_draft_accounts on commit drop as
select d.*,case when d.personal_user_id is not null then 'personal_email_account'
 else 'shared_email_account' end email_account_type,
 coalesce(u.provider,ce.provider) provider,
 lower(btrim(coalesce(d.personal_account_email,s.account_email))) email_account_email,
 (nullif(btrim(d.source_message_id),'') is not null
  and jsonb_typeof(d.reply_to_message)='object'
  and d.reply_to_message->>'id'=btrim(d.source_message_id)
  and nullif(btrim(d.reply_to_message->>'thread_id'),'') is not null) valid_source_snapshot
from communications_email_drafts d
left join user_email_connections u on d.personal_user_id is not null
 and u.user_id=d.personal_user_id and u.account_email=d.personal_account_email
left join shared_inboxes s on s.company_id=d.company_id and s.shared_inbox_id=d.shared_inbox_id
left join company_email_connections ce on ce.company_id=s.company_id
 and ce.company_email_connection_id=s.company_email_connection_id;

do $$
begin
 if exists(select 1 from v3_draft_accounts
  where provider not in('google','microsoft') or email_account_email='') then
  raise exception 'cannot prove exact source email account for every draft';
 end if;
 if (select count(*) from v3_draft_accounts where nullif(btrim(source_message_id),'') is not null
     and not valid_source_snapshot)<>1
  or exists(select 1 from v3_draft_accounts where nullif(btrim(source_message_id),'') is not null
     and not valid_source_snapshot and (kind<>'compose' or deleted_timestamp is null)) then
  raise exception 'expected one soft-deleted compose draft with a stale unusable source ID';
 end if;
end $$;
-- END INLINED SOURCE CLASSIFICATION

-- BEGIN INLINED THREAD AND MESSAGE COPY
create temp table v3_thread_seed_raw on commit drop as
select 10 priority,'legacy'::text source_kind,t.email_thread_id::text source_key,
 t.company_id,t.email_account_type,t.personal_user_id,t.personal_account_email,
 t.shared_inbox_id,lower(btrim(t.account_email)) email_account_email,t.provider,
 t.provider_thread_key,t.provider_thread_id,t.root_provider_message_id,
 t.download_status,t.history_complete,t.fetched_at fetched_timestamp,
 t.last_download_error,t.created_timestamp,t.updated_timestamp,
 t.email_thread_id preferred_email_thread_id
from v3_legacy_threads t
union all
select 20,'projection',a.email_relationship_id::text,a.company_id,
 case a.scope_type when 'personal' then 'personal_email_account'
 else 'shared_email_account' end,a.personal_user_id,a.personal_account_email,
 a.shared_inbox_id,a.account_email,a.provider,'thread:'||(a.payload->>'thread_id'),
 a.payload->>'thread_id',a.payload->>'message_id','partial',false,null,'',
 a.created_timestamp,a.updated_timestamp,null
from v3_projection_accounts a
union all
select 30,'draft',d.draft_id,d.company_id,d.email_account_type,d.personal_user_id,
 d.personal_account_email,d.shared_inbox_id,d.email_account_email,d.provider,
 'thread:'||(d.reply_to_message->>'thread_id'),d.reply_to_message->>'thread_id',
 d.reply_to_message->>'id','partial',false,null,'',d.created_timestamp,d.updated_timestamp,null
from v3_draft_accounts d where d.valid_source_snapshot;

create temp table v3_thread_desired on commit drop as
with ranked as (
 select s.*,row_number() over(partition by company_id,email_account_type,
  coalesce(personal_user_id::text,''),coalesce(personal_account_email,''),
  coalesce(shared_inbox_id::text,''),provider,provider_thread_key
  order by priority,created_timestamp,source_kind,source_key) source_rank,
 (min(preferred_email_thread_id::text) over(partition by company_id,email_account_type,
  coalesce(personal_user_id::text,''),coalesce(personal_account_email,''),
  coalesce(shared_inbox_id::text,''),provider,provider_thread_key))::uuid legacy_thread_id
 from v3_thread_seed_raw s
), chosen as (select * from ranked where source_rank=1)
select c.*,coalesce(e.email_thread_id,c.legacy_thread_id,
 pg_temp.v3_email_uuid('v3-email-thread:'||c.company_id||':'||c.email_account_type||':'||
 coalesce(c.personal_user_id::text,'')||':'||coalesce(c.personal_account_email,'')||':'||
 coalesce(c.shared_inbox_id::text,'')||':'||c.provider||':'||c.provider_thread_key)
) email_thread_id
from chosen c left join email_threads e on e.company_id=c.company_id
 and e.email_account_type=c.email_account_type and e.provider=c.provider
 and e.provider_thread_key=c.provider_thread_key
 and coalesce(e.personal_user_id::text,'')=coalesce(c.personal_user_id::text,'')
 and coalesce(e.personal_account_email,'')=coalesce(c.personal_account_email,'')
 and coalesce(e.shared_inbox_id::text,'')=coalesce(c.shared_inbox_id::text,'');

insert into email_threads(company_id,email_thread_id,email_account_type,personal_user_id,
 personal_account_email,shared_inbox_id,email_account_email,provider,provider_thread_key,
 provider_thread_id,root_provider_message_id,download_status,history_complete,
 fetched_timestamp,last_download_error,created_timestamp,updated_timestamp)
select company_id,email_thread_id,email_account_type,personal_user_id,
 personal_account_email,shared_inbox_id,email_account_email,provider,provider_thread_key,
 provider_thread_id,root_provider_message_id,download_status,history_complete,
 fetched_timestamp,last_download_error,created_timestamp,updated_timestamp
from v3_thread_desired
on conflict(company_id,email_thread_id) do update set
 email_account_type=excluded.email_account_type,personal_user_id=excluded.personal_user_id,
 personal_account_email=excluded.personal_account_email,shared_inbox_id=excluded.shared_inbox_id,
 email_account_email=excluded.email_account_email,provider=excluded.provider,
 provider_thread_key=excluded.provider_thread_key,provider_thread_id=excluded.provider_thread_id,
 root_provider_message_id=excluded.root_provider_message_id,
 download_status=excluded.download_status,history_complete=excluded.history_complete,
 fetched_timestamp=excluded.fetched_timestamp,last_download_error=excluded.last_download_error,
 created_timestamp=least(email_threads.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_threads.updated_timestamp,excluded.updated_timestamp);

create temp table v3_thread_map on commit drop as
select s.source_kind,s.source_key,s.company_id,d.email_thread_id,d.email_account_type,
 d.personal_user_id,d.personal_account_email,d.shared_inbox_id,d.provider,d.provider_thread_key
from v3_thread_seed_raw s join v3_thread_desired d on d.company_id=s.company_id
 and d.email_account_type=s.email_account_type and d.provider=s.provider
 and d.provider_thread_key=s.provider_thread_key
 and coalesce(d.personal_user_id::text,'')=coalesce(s.personal_user_id::text,'')
 and coalesce(d.personal_account_email,'')=coalesce(s.personal_account_email,'')
 and coalesce(d.shared_inbox_id::text,'')=coalesce(s.shared_inbox_id::text,'');

create temp table v3_message_seed_raw on commit drop as
select 10 priority,'legacy'::text source_kind,m.email_message_id::text source_key,
 m.company_id,map.email_thread_id,m.provider_message_id,m.message_order,m.subject,
 m.sender_snapshot,m.to_snapshot,m.cc_snapshot,m.bcc_snapshot,m.reply_to_snapshot,
 case when m.message_timestamp<=0 then null when m.message_timestamp>100000000000
  then to_timestamp(m.message_timestamp::double precision/1000.0)
  else to_timestamp(m.message_timestamp::double precision) end message_timestamp,
 m.rich_html_body,m.text_fallback,m.snippet,m.unread,m.starred,m.folder_snapshot,
 m.folder_id_snapshot,m.attachment_metadata,m.download_complete,m.created_timestamp,
 m.updated_timestamp,m.email_message_id preferred_email_message_id
from communications_email_messages m join v3_thread_map map
 on map.source_kind='legacy' and map.company_id=m.company_id
 and map.source_key=m.email_thread_id::text;

create temp table v3_projection_snapshots on commit drop as
select a.*,s.priority,s.source_key,s.snapshot
from v3_projection_accounts a cross join lateral (
 select x.* from (
  select 20 priority,'collaboration:'||c.collaboration_id source_key,c.message_snapshot snapshot
  from communications_email_collaborations c where c.company_id=a.company_id
   and c.attached_email_information_id=a.email_relationship_id
   and c.latest_message_id=a.payload->>'message_id'
  union all
  select 30,'email_node:'||n.node_id||':'||n.message_id,n.message
  from communications_email_nodes n where a.resource_type='node'
   and n.company_id=a.company_id and n.node_id=a.resource_id
   and n.message_id=a.payload->>'message_id'
  union all
  select 40,'email_attachment:'||n.node_id||':'||n.message_id,n.message
  from communications_email_node_attachments n where a.resource_type='node'
   and n.company_id=a.company_id and n.node_id=a.resource_id
   and n.message_id=a.payload->>'message_id'
  union all select 50,'projection:'||a.email_relationship_id,a.payload
 ) x where jsonb_typeof(x.snapshot)='object'
 and coalesce(x.snapshot->>'id',a.payload->>'message_id')=a.payload->>'message_id'
 order by x.priority,x.source_key limit 1
) s;

insert into v3_message_seed_raw
select s.priority,'projection',s.email_relationship_id::text,s.company_id,map.email_thread_id,
 s.payload->>'message_id',0,coalesce(s.snapshot->>'subject',''),
 case when jsonb_typeof(s.snapshot->'from')='array' then s.snapshot->'from'
 when jsonb_typeof(s.snapshot->'from')='string' and btrim(s.snapshot->>'from')<>'' then
  case when s.snapshot->>'from'~'^.* <[^<>]+>$' then
   jsonb_build_array(jsonb_build_object(
    'name',btrim(regexp_replace(s.snapshot->>'from',' <[^<>]+>$','')),
    'email',lower(btrim(substring(s.snapshot->>'from' from '<([^<>]+)>$')))))
  else jsonb_build_array(jsonb_build_object('name','','email',lower(btrim(s.snapshot->>'from')))) end
 else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'to')='array' then s.snapshot->'to' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'cc')='array' then s.snapshot->'cc' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'bcc')='array' then s.snapshot->'bcc' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'reply_to')='array' then s.snapshot->'reply_to' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'date')='number' then
  case when (s.snapshot->>'date')::numeric>100000000000
   then to_timestamp((s.snapshot->>'date')::double precision/1000.0)
   else to_timestamp((s.snapshot->>'date')::double precision) end else null end,
 coalesce(s.snapshot->>'body',''),'',coalesce(s.snapshot->>'snippet',''),
 case when s.snapshot->>'unread' in('true','false') then (s.snapshot->>'unread')::boolean else false end,
 case when s.snapshot->>'starred' in('true','false') then (s.snapshot->>'starred')::boolean else false end,
 case when jsonb_typeof(s.snapshot->'folders')='array' then s.snapshot->'folders' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'folder_ids')='array' then s.snapshot->'folder_ids' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'attachments')='array' then s.snapshot->'attachments' else '[]'::jsonb end,
 case when s.snapshot->>'download_complete' in('true','false')
  then (s.snapshot->>'download_complete')::boolean else false end,
 s.created_timestamp,s.updated_timestamp,null
from v3_projection_snapshots s join v3_thread_map map on map.source_kind='projection'
 and map.company_id=s.company_id and map.source_key=s.email_relationship_id::text;

insert into v3_message_seed_raw
select 60,'draft',d.draft_id,d.company_id,map.email_thread_id,
 d.reply_to_message->>'id',0,coalesce(d.reply_to_message->>'subject',''),
 case when jsonb_typeof(d.reply_to_message->'from')='array' then d.reply_to_message->'from' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'to')='array' then d.reply_to_message->'to' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'cc')='array' then d.reply_to_message->'cc' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'bcc')='array' then d.reply_to_message->'bcc' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'reply_to')='array' then d.reply_to_message->'reply_to' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'date')='number' then
  case when (d.reply_to_message->>'date')::numeric>100000000000
   then to_timestamp((d.reply_to_message->>'date')::double precision/1000.0)
   else to_timestamp((d.reply_to_message->>'date')::double precision) end else null end,
 coalesce(d.reply_to_message->>'body',''),'',coalesce(d.reply_to_message->>'snippet',''),
 case when d.reply_to_message->>'unread' in('true','false')
  then (d.reply_to_message->>'unread')::boolean else false end,
 case when d.reply_to_message->>'starred' in('true','false')
  then (d.reply_to_message->>'starred')::boolean else false end,
 case when jsonb_typeof(d.reply_to_message->'folders')='array'
  then d.reply_to_message->'folders' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'folder_ids')='array'
  then d.reply_to_message->'folder_ids' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'attachments')='array'
  then d.reply_to_message->'attachments' else '[]'::jsonb end,
 case when d.reply_to_message->>'download_complete' in('true','false')
  then (d.reply_to_message->>'download_complete')::boolean else false end,
 d.created_timestamp,d.updated_timestamp,null
from v3_draft_accounts d join v3_thread_map map on map.source_kind='draft'
 and map.company_id=d.company_id and map.source_key=d.draft_id
where d.valid_source_snapshot;

create temp table v3_message_desired on commit drop as
with ranked as (
 select s.*,row_number() over(partition by company_id,email_thread_id,provider_message_id
  order by priority,created_timestamp,source_kind,source_key) source_rank,
 (min(preferred_email_message_id::text) over(partition by company_id,email_thread_id,provider_message_id))::uuid
  legacy_message_id
 from v3_message_seed_raw s
), chosen as (select * from ranked where source_rank=1),
numbered as (
 select c.*,row_number() over(partition by company_id,email_thread_id
  order by created_timestamp,provider_message_id) synthetic_order from chosen c
), maximums as (
 select n.company_id,n.email_thread_id,coalesce(max(l.message_order),-1) maximum_legacy_order
 from numbered n left join v3_message_seed_raw l on l.company_id=n.company_id
  and l.email_thread_id=n.email_thread_id and l.priority=10
 group by n.company_id,n.email_thread_id
)
select n.*,coalesce(e.email_message_id,n.legacy_message_id,
 pg_temp.v3_email_uuid('v3-email-message:'||n.company_id||':'||
 n.email_thread_id||':'||n.provider_message_id)) email_message_id,
 case when n.priority=10 then n.message_order
  when e.email_message_id is not null then e.message_order
  else m.maximum_legacy_order+n.synthetic_order end resolved_message_order
from numbered n join maximums m using(company_id,email_thread_id)
left join email_messages e on e.company_id=n.company_id
 and e.email_thread_id=n.email_thread_id and e.provider_message_id=n.provider_message_id;

insert into email_messages(company_id,email_message_id,email_thread_id,provider_message_id,
 message_order,subject,sender_snapshot,to_snapshot,cc_snapshot,bcc_snapshot,
 reply_to_snapshot,message_timestamp,rich_html_body,text_fallback,snippet,unread,
 starred,folder_snapshot,folder_id_snapshot,attachment_metadata,download_complete,
 created_timestamp,updated_timestamp)
select company_id,email_message_id,email_thread_id,provider_message_id,
 resolved_message_order,subject,sender_snapshot,to_snapshot,cc_snapshot,bcc_snapshot,
 reply_to_snapshot,message_timestamp,rich_html_body,text_fallback,snippet,unread,
 starred,folder_snapshot,folder_id_snapshot,attachment_metadata,download_complete,
 created_timestamp,updated_timestamp
from v3_message_desired
on conflict(company_id,email_message_id) do update set
 email_thread_id=excluded.email_thread_id,provider_message_id=excluded.provider_message_id,
 message_order=excluded.message_order,subject=excluded.subject,
 sender_snapshot=excluded.sender_snapshot,to_snapshot=excluded.to_snapshot,
 cc_snapshot=excluded.cc_snapshot,bcc_snapshot=excluded.bcc_snapshot,
 reply_to_snapshot=excluded.reply_to_snapshot,message_timestamp=excluded.message_timestamp,
 rich_html_body=excluded.rich_html_body,text_fallback=excluded.text_fallback,
 snippet=excluded.snippet,unread=excluded.unread,starred=excluded.starred,
 folder_snapshot=excluded.folder_snapshot,folder_id_snapshot=excluded.folder_id_snapshot,
 attachment_metadata=excluded.attachment_metadata,download_complete=excluded.download_complete,
 created_timestamp=least(email_messages.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_messages.updated_timestamp,excluded.updated_timestamp);
-- END INLINED THREAD AND MESSAGE COPY

-- BEGIN INLINED RELATIONSHIP, DRAFT, SIGNATURE, AND JOB COPY
create temp table v3_relationship_ranked on commit drop as
select a.company_id,a.email_relationship_id,m.email_thread_id,m.email_message_id,
 a.resource_type,a.resource_id,a.resource_textbox_id,a.created_timestamp,
 row_number() over(partition by a.company_id,m.email_message_id,a.resource_type,
  a.resource_id,coalesce(a.resource_textbox_id,'') order by
  case when a.resource_type='node'
   and a.payload->>'block_id'=a.email_relationship_id::text then 0 else 1 end,
  a.created_timestamp,a.email_relationship_id) relationship_rank,
 first_value(a.email_relationship_id) over(partition by a.company_id,m.email_message_id,
  a.resource_type,a.resource_id,coalesce(a.resource_textbox_id,'') order by
  case when a.resource_type='node'
   and a.payload->>'block_id'=a.email_relationship_id::text then 0 else 1 end,
  a.created_timestamp,a.email_relationship_id) target_relationship_id
from v3_projection_accounts a
join v3_thread_map map on map.source_kind='projection' and map.company_id=a.company_id
 and map.source_key=a.email_relationship_id::text
join email_messages m on m.company_id=a.company_id and m.email_thread_id=map.email_thread_id
 and m.provider_message_id=a.payload->>'message_id';

create temp table v3_relationship_source_map on commit drop as
select company_id,email_relationship_id source_relationship_id,target_relationship_id,
 relationship_rank from v3_relationship_ranked;

create temp table v3_relationship_desired on commit drop as
select company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,
 resource_id,resource_textbox_id,created_timestamp
from v3_relationship_ranked where relationship_rank=1;

do $$
begin
 if (select count(*) from v3_relationship_desired)<>(select count(*) from v3_projections)-28 then
  raise exception 'retained relationship consolidation did not produce the approved 228 identities';
 end if;
 if exists(select 1 from v3_relationship_desired r where
  (r.resource_type='node' and (
    not exists(select 1 from nodes n where n.company_id=r.company_id and n.node_id=r.resource_id)
    or (r.resource_textbox_id is not null and not exists(
      select 1 from node_textboxes t where t.company_id=r.company_id
       and t.node_id=r.resource_id and t.textbox_id::text=r.resource_textbox_id
       and t.deleted_timestamp is null))))
  or (r.resource_type='project' and (
    not exists(select 1 from projects p where p.company_id=r.company_id and p.project_id=r.resource_id)
    or (r.resource_textbox_id is not null and not exists(
      select 1 from project_textboxes t where t.company_id=r.company_id
       and t.project_id=r.resource_id and t.textbox_id=r.resource_textbox_id
       and t.deleted_timestamp is null))))
  or (r.resource_type='logic_gate' and (
    not exists(select 1 from logic_gates g where g.company_id=r.company_id and g.logic_gate_id=r.resource_id)
    or (r.resource_textbox_id is not null and not exists(
      select 1 from logic_gate_textboxes t where t.company_id=r.company_id
       and t.logic_gate_id=r.resource_id and t.textbox_id=r.resource_textbox_id
       and t.deleted_timestamp is null))))
 ) then raise exception 'retained relationship has a missing or deleted resource/textbox host'; end if;
end $$;

insert into email_relationships(company_id,email_relationship_id,email_thread_id,
 email_message_id,resource_type,resource_id,resource_textbox_id,created_timestamp)
select company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,
 resource_id,resource_textbox_id,created_timestamp from v3_relationship_desired
on conflict(company_id,email_relationship_id) do update set
 email_thread_id=excluded.email_thread_id,email_message_id=excluded.email_message_id,
 resource_type=excluded.resource_type,resource_id=excluded.resource_id,
 resource_textbox_id=excluded.resource_textbox_id,
 created_timestamp=least(email_relationships.created_timestamp,excluded.created_timestamp);

create temp table v3_draft_desired on commit drop as
select d.*,
 relationship.email_relationship_id resolved_relationship_id,
 source_message.email_message_id resolved_source_message_id,
 sent_message.email_message_id resolved_sent_message_id,
 sent_message.match_count sent_message_match_count
from v3_draft_accounts d
left join communications_email_collaborations collaboration
 on collaboration.company_id=d.company_id and collaboration.collaboration_id=d.collaboration_id
left join email_relationships relationship
 on relationship.company_id=collaboration.company_id
 and relationship.email_relationship_id=collaboration.attached_email_information_id
left join email_threads source_thread on d.valid_source_snapshot
 and source_thread.company_id=d.company_id
 and source_thread.provider=d.provider
 and source_thread.provider_thread_key='thread:'||(d.reply_to_message->>'thread_id')
 and ((d.personal_user_id is not null
   and source_thread.email_account_type='personal_email_account'
   and source_thread.personal_user_id=d.personal_user_id
   and source_thread.personal_account_email=d.personal_account_email)
  or (d.shared_inbox_id is not null
   and source_thread.email_account_type='shared_email_account'
   and source_thread.shared_inbox_id=d.shared_inbox_id))
left join email_messages source_message
 on source_message.company_id=source_thread.company_id
 and source_message.email_thread_id=source_thread.email_thread_id
 and source_message.provider_message_id=d.source_message_id
left join lateral (
 select case when count(*)=1 then min(m.email_message_id::text)::uuid end email_message_id,
        count(*) match_count
 from email_messages m join email_threads t on t.company_id=m.company_id
  and t.email_thread_id=m.email_thread_id
 where nullif(btrim(d.sent_message_id),'') is not null
  and m.company_id=d.company_id and m.provider_message_id=d.sent_message_id
  and ((d.personal_user_id is not null and t.email_account_type='personal_email_account'
    and t.personal_user_id=d.personal_user_id
    and t.personal_account_email=d.personal_account_email)
   or (d.shared_inbox_id is not null and t.email_account_type='shared_email_account'
    and t.shared_inbox_id=d.shared_inbox_id))
) sent_message on true;

do $$
begin
 if exists(select 1 from v3_draft_desired
  where valid_source_snapshot and resolved_source_message_id is null) then
  raise exception 'valid draft source snapshot did not resolve to one final message';
 end if;
 if exists(select 1 from v3_draft_desired
  where nullif(btrim(sent_message_id),'') is not null and sent_message_match_count<>1) then
  raise exception 'sent draft provider message did not resolve to one final message';
 end if;
end $$;

insert into email_drafts(company_id,draft_id,email_relationship_id,
 source_email_message_id,email_account_type,personal_user_id,personal_account_email,
 shared_inbox_id,sender_account_email,created_by_user_id,updated_by_user_id,kind,
 to_recipients,cc_recipients,bcc_recipients,subject,body_editor_html,
 scheduled_send_timestamp,revision,send_state,send_claim_token,send_idempotency_key,
 send_idempotency_grant_id,send_idempotency_timestamp,send_claimed_revision,
 send_claimed_timestamp,sent_email_message_id,sent_provider_message_id,
 created_timestamp,updated_timestamp,deleted_timestamp)
select company_id,draft_id,resolved_relationship_id,resolved_source_message_id,
 email_account_type,personal_user_id,personal_account_email,shared_inbox_id,
 lower(btrim(account_email)),created_by_user_id,updated_by_user_id,kind,to_recipients,
 cc_recipients,bcc_recipients,subject,body_editor_html,scheduled_send_timestamp,
 revision,send_state,send_claim_token,send_idempotency_key,send_idempotency_grant_id,
 send_idempotency_timestamp,send_claimed_revision,send_claimed_timestamp,
 resolved_sent_message_id,sent_message_id,created_timestamp,updated_timestamp,deleted_timestamp
from v3_draft_desired
on conflict(company_id,draft_id) do update set
 email_relationship_id=excluded.email_relationship_id,
 source_email_message_id=excluded.source_email_message_id,
 email_account_type=excluded.email_account_type,personal_user_id=excluded.personal_user_id,
 personal_account_email=excluded.personal_account_email,shared_inbox_id=excluded.shared_inbox_id,
 sender_account_email=excluded.sender_account_email,created_by_user_id=excluded.created_by_user_id,
 updated_by_user_id=excluded.updated_by_user_id,kind=excluded.kind,
 to_recipients=excluded.to_recipients,cc_recipients=excluded.cc_recipients,
 bcc_recipients=excluded.bcc_recipients,subject=excluded.subject,
 body_editor_html=excluded.body_editor_html,
 scheduled_send_timestamp=excluded.scheduled_send_timestamp,revision=excluded.revision,
 send_state=excluded.send_state,send_claim_token=excluded.send_claim_token,
 send_idempotency_key=excluded.send_idempotency_key,
 send_idempotency_grant_id=excluded.send_idempotency_grant_id,
 send_idempotency_timestamp=excluded.send_idempotency_timestamp,
 send_claimed_revision=excluded.send_claimed_revision,
 send_claimed_timestamp=excluded.send_claimed_timestamp,
 sent_email_message_id=excluded.sent_email_message_id,
 sent_provider_message_id=excluded.sent_provider_message_id,
 created_timestamp=least(email_drafts.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_drafts.updated_timestamp,excluded.updated_timestamp),
 deleted_timestamp=excluded.deleted_timestamp;

insert into email_signatures(company_id,signature_id,email_account_type,
 personal_user_id,personal_account_email,shared_inbox_id,email_account_email,name,
 body_editor_html,is_default,created_by_user_id,updated_by_user_id,
 created_timestamp,updated_timestamp)
select s.company_id,s.signature_id,
 case when s.personal_user_id is not null then 'personal_email_account'
 else 'shared_email_account' end,s.personal_user_id,s.personal_account_email,
 s.shared_inbox_id,lower(btrim(coalesce(s.personal_account_email,inbox.account_email))),
 s.name,s.body_editor_html,s.is_default,s.created_by_user_id,s.updated_by_user_id,
 s.created_timestamp,s.updated_timestamp
from communications_email_signatures s
left join shared_inboxes inbox on inbox.company_id=s.company_id
 and inbox.shared_inbox_id=s.shared_inbox_id
on conflict(company_id,signature_id) do update set
 email_account_type=excluded.email_account_type,personal_user_id=excluded.personal_user_id,
 personal_account_email=excluded.personal_account_email,shared_inbox_id=excluded.shared_inbox_id,
 email_account_email=excluded.email_account_email,name=excluded.name,
 body_editor_html=excluded.body_editor_html,is_default=excluded.is_default,
 created_by_user_id=excluded.created_by_user_id,updated_by_user_id=excluded.updated_by_user_id,
 created_timestamp=least(email_signatures.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_signatures.updated_timestamp,excluded.updated_timestamp);

insert into email_thread_download_jobs(download_job_id,company_id,email_thread_id,
 download_scope,requested_provider_message_id,requested_by_user_id,status,attempt_count,
 last_error,available_at,processing_started_at,completed_timestamp,failed_timestamp,
 created_timestamp,updated_timestamp)
select j.download_job_id,j.company_id,map.email_thread_id,j.download_scope,
 j.requested_provider_message_id,j.requested_by_user_id,j.status,j.attempt_count,
 j.last_error,j.available_at,j.processing_started_at,j.completed_timestamp,
 j.failed_timestamp,j.created_timestamp,j.updated_timestamp
from communications_email_thread_download_jobs j join v3_thread_map map
 on map.source_kind='legacy' and map.company_id=j.company_id
 and map.source_key=j.email_thread_id::text
on conflict(download_job_id) do update set
 company_id=excluded.company_id,email_thread_id=excluded.email_thread_id,
 download_scope=excluded.download_scope,
 requested_provider_message_id=excluded.requested_provider_message_id,
 requested_by_user_id=excluded.requested_by_user_id,status=excluded.status,
 attempt_count=excluded.attempt_count,last_error=excluded.last_error,
 available_at=excluded.available_at,processing_started_at=excluded.processing_started_at,
 completed_timestamp=excluded.completed_timestamp,failed_timestamp=excluded.failed_timestamp,
 created_timestamp=least(email_thread_download_jobs.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_thread_download_jobs.updated_timestamp,excluded.updated_timestamp);
-- END INLINED RELATIONSHIP, DRAFT, SIGNATURE, AND JOB COPY

-- BEGIN INLINED ATTACHMENT RELATIONSHIP COPY
create temp table v3_attachment_desired (
 attachment_relationship_id uuid not null,company_id uuid not null,
 resource_type text not null,resource_id text not null,attachment_id uuid not null,
 information_id uuid,message_id text not null,editor_surface text not null,
 relationship_kind text not null,created_by_user_id uuid,
 created_timestamp timestamptz not null,deleted_timestamp timestamptz
) on commit drop;

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,r.resource_type,r.resource_id,r.attachment_id,
 r.information_id,r.message_id,r.editor_surface,r.relationship_kind,
 r.created_by_user_id,r.created_timestamp,r.deleted_timestamp
from resource_attachments r
where r.resource_type not in('email_message','email_draft','email_signature','attached_email')
 and not (r.resource_type='node'
  and r.relationship_kind in('email_attachment','email_inline_attachment')
  and btrim(r.message_id)<>'');

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_draft',
 pg_temp.v3_query_unescape(parts[array_length(parts,1)]),r.attachment_id,
 null,'','',r.relationship_kind,r.created_by_user_id,r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
where r.resource_type='email_draft'
 and array_length(parts,1) in(3,4)
 and exists(select 1 from email_drafts d where d.company_id=r.company_id
  and d.draft_id=pg_temp.v3_query_unescape(parts[array_length(parts,1)]));

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_signature',signature.signature_id,
 r.attachment_id,null,'','',r.relationship_kind,r.created_by_user_id,
 r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
join email_signatures signature on signature.company_id=r.company_id and (
 (parts[1]='personal' and array_length(parts,1)=3
  and signature.email_account_type='personal_email_account'
  and signature.personal_user_id::text=pg_temp.v3_query_unescape(parts[2])
  and signature.personal_account_email=lower(pg_temp.v3_query_unescape(parts[3])))
 or
 (parts[1]='shared' and array_length(parts,1)=2
  and signature.email_account_type='shared_email_account'
  and signature.shared_inbox_id::text=pg_temp.v3_query_unescape(parts[2]))
)
where r.resource_type='email_signature';

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_message',resolved.email_message_id::text,
 r.attachment_id,null,'','',r.relationship_kind,r.created_by_user_id,
 r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
cross join lateral (
 select count(distinct m.email_message_id) n,min(m.email_message_id::text)::uuid email_message_id
 from email_messages m join email_threads t on t.company_id=m.company_id
  and t.email_thread_id=m.email_thread_id
 where m.company_id=r.company_id and m.provider_message_id=pg_temp.v3_query_unescape(parts[3])
  and ((parts[1]='personal' and array_length(parts,1)=3
    and t.email_account_type='personal_email_account'
    and t.personal_user_id::text=pg_temp.v3_query_unescape(parts[2]))
   or (parts[1]='shared' and array_length(parts,1)=3
    and t.email_account_type='shared_email_account'
    and t.shared_inbox_id::text=pg_temp.v3_query_unescape(parts[2])))
) resolved
where r.resource_type='email_message' and resolved.n=1;

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_message',resolved.email_message_id::text,
 r.attachment_id,null,'','',r.relationship_kind,r.created_by_user_id,
 r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
cross join lateral (
 select count(distinct rel.email_message_id) n,
        min(rel.email_message_id::text)::uuid email_message_id
 from email_relationships rel join email_messages m on m.company_id=rel.company_id
  and m.email_message_id=rel.email_message_id
 where rel.company_id=r.company_id and rel.resource_type='node'
  and rel.resource_id::text=pg_temp.v3_query_unescape(parts[2])
  and m.provider_message_id=pg_temp.v3_query_unescape(parts[4])
) resolved
where r.resource_type='attached_email' and array_length(parts,1)=4
 and parts[1]='node' and parts[3]='message' and resolved.n=1;

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_message',resolved.email_message_id::text,
 r.attachment_id,null,'','',r.relationship_kind,r.created_by_user_id,
 r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (
 select count(distinct rel.email_message_id) n,
        min(rel.email_message_id::text)::uuid email_message_id
 from email_relationships rel join email_messages m on m.company_id=rel.company_id
  and m.email_message_id=rel.email_message_id
 where rel.company_id=r.company_id and rel.resource_type='node'
  and rel.resource_id::text=r.resource_id and m.provider_message_id=r.message_id
) resolved
where r.resource_type='node'
 and r.relationship_kind in('email_attachment','email_inline_attachment')
 and btrim(r.message_id)<>'' and resolved.n=1;

do $$
begin
 if (select count(*) from v3_attachment_desired)<>(select count(*) from resource_attachments) then
  raise exception 'not every legacy attachment relationship resolved exactly once';
 end if;
 if exists(select 1 from v3_attachment_desired group by attachment_relationship_id having count(*)<>1) then
  raise exception 'legacy attachment relationship mapped more than once';
 end if;
 if exists(select 1 from v3_attachment_desired a where a.resource_type='email_message'
  and not exists(select 1 from email_messages m where m.company_id=a.company_id
   and m.email_message_id::text=a.resource_id)) then
  raise exception 'incoming-email file did not target an internal email_message_id';
 end if;
end $$;

insert into attachment_relationships(attachment_relationship_id,company_id,resource_type,
 resource_id,attachment_id,information_id,message_id,editor_surface,relationship_kind,
 created_by_user_id,created_timestamp,deleted_timestamp)
select attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,
 information_id,message_id,editor_surface,relationship_kind,created_by_user_id,
 created_timestamp,deleted_timestamp from v3_attachment_desired
on conflict(attachment_relationship_id) do update set
 company_id=excluded.company_id,resource_type=excluded.resource_type,
 resource_id=excluded.resource_id,attachment_id=excluded.attachment_id,
 information_id=excluded.information_id,message_id=excluded.message_id,
 editor_surface=excluded.editor_surface,relationship_kind=excluded.relationship_kind,
 created_by_user_id=excluded.created_by_user_id,
 created_timestamp=least(attachment_relationships.created_timestamp,excluded.created_timestamp),
 deleted_timestamp=excluded.deleted_timestamp;
-- END INLINED ATTACHMENT RELATIONSHIP COPY

-- BEGIN INLINED RECONCILIATION
insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_threads',s.company_id,s.email_thread_id::text,
 'email_threads',map.email_thread_id::text,'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join communications_email_threads s
join v3_thread_map map on map.source_kind='legacy' and map.company_id=s.company_id
 and map.source_key=s.email_thread_id::text;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_messages',s.company_id,s.email_message_id::text,
 'email_messages',desired.email_message_id::text,'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join communications_email_messages s
join v3_thread_map map on map.source_kind='legacy' and map.company_id=s.company_id
 and map.source_key=s.email_thread_id::text
join v3_message_desired desired on desired.company_id=s.company_id
 and desired.email_thread_id=map.email_thread_id
 and desired.provider_message_id=s.provider_message_id;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'Attached email projection',s.company_id,s.email_relationship_id::text,
 'email_relationships',map.target_relationship_id::text,
 case when map.relationship_rank=1 then 'copied' else 'consolidated_duplicate' end,
 md5(to_jsonb(s)::text)
from v3_current_email_run run cross join v3_projection_accounts s
join v3_relationship_source_map map on map.company_id=s.company_id
 and map.source_relationship_id=s.email_relationship_id;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_drafts',s.company_id,s.draft_id,
 'email_drafts',s.draft_id,
 case when nullif(btrim(s.source_message_id),'') is not null and not s.valid_source_snapshot
  then 'retained_without_source_link' else 'updated' end,
 md5(to_jsonb(s)::text)
from v3_current_email_run run cross join v3_draft_accounts s;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_signatures',s.company_id,s.signature_id,
 'email_signatures',s.signature_id,'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join communications_email_signatures s;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_thread_download_jobs',s.company_id,
 s.download_job_id::text,'email_thread_download_jobs',s.download_job_id::text,
 'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join communications_email_thread_download_jobs s;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'resource_attachments',s.company_id,s.resource_attachment_id::text,
 'attachment_relationships',s.resource_attachment_id::text,'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join resource_attachments s;

do $$
begin
 if (select count(*) from email_threads)<>(select count(*) from v3_thread_desired) then
  raise exception 'V3 email thread final count mismatch';
 end if;
 if (select count(*) from email_messages)<>(select count(*) from v3_message_desired) then
  raise exception 'V3 email message final count mismatch';
 end if;
 if (select count(*) from email_relationships)<>(select count(*) from v3_relationship_desired) then
  raise exception 'V3 email relationship final count mismatch';
 end if;
 if (select count(*) from email_drafts)<>(select count(*) from communications_email_drafts) then
  raise exception 'V3 email draft final count mismatch';
 end if;
 if (select count(*) from email_signatures)<>(select count(*) from communications_email_signatures) then
  raise exception 'V3 email signature final count mismatch';
 end if;
 if (select count(*) from email_thread_download_jobs)
    <>(select count(*) from communications_email_thread_download_jobs) then
  raise exception 'V3 email download-job final count mismatch';
 end if;
 if (select count(*) from attachment_relationships)
    <>(select count(*) from resource_attachments) then
  raise exception 'V3 attachment relationship final count mismatch';
 end if;
 if exists(select 1 from email_relationships r left join email_messages m
  on m.company_id=r.company_id and m.email_thread_id=r.email_thread_id
  and m.email_message_id=r.email_message_id where m.email_message_id is null) then
  raise exception 'V3 email relationship has no exact final message';
 end if;
 if exists(select 1 from email_drafts d where d.source_email_message_id is not null
  and not exists(select 1 from email_messages m where m.company_id=d.company_id
   and m.email_message_id=d.source_email_message_id)) then
  raise exception 'V3 email draft source message is missing';
 end if;
end $$;

update v3_email_migration_runs run set status='complete',
 summary=jsonb_build_object(
  'email_threads',(select count(*) from email_threads),
  'email_messages',(select count(*) from email_messages),
  'email_relationships',(select count(*) from email_relationships),
  'email_drafts',(select count(*) from email_drafts),
  'email_signatures',(select count(*) from email_signatures),
  'email_thread_download_jobs',(select count(*) from email_thread_download_jobs),
  'attachment_relationships',(select count(*) from attachment_relationships),
  'malformed_compose_source_links_omitted',(
    select count(*) from v3_draft_accounts
    where nullif(btrim(source_message_id),'') is not null and not valid_source_snapshot
  )
 ),completed_timestamp=now()
from v3_current_email_run current
where run.run_id=current.run_id;

select 'READY_FOR_BACKEND_CUTOVER_REVIEW' status,
 (select count(*) from email_threads) email_threads,
 (select count(*) from email_messages) email_messages,
 (select count(*) from email_relationships) email_relationships,
 (select count(*) from email_drafts) email_drafts,
 (select count(*) from email_signatures) email_signatures,
 (select count(*) from attachment_relationships) attachment_relationships;
-- END INLINED RECONCILIATION

commit;
