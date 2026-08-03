-- Strict V3 permanent-content cutover.
-- This migration intentionally names every expected legacy object directly.
-- Any missing object, unexpected column set, invalid payload, ambiguous email,
-- or unmapped relationship aborts the transaction.
begin;

lock table node_information, node_projection_table, node_projection_seen_snapshots,
  node_content_changes, node_textboxes, communications_email_threads,
  communications_email_messages, communications_node_email_threads,
  communications_email_thread_download_jobs, communications_email_drafts,
  communications_email_collaborations, communications_email_collaboration_participants,
  communications_email_nodes, communications_email_node_attachments
in share row exclusive mode;

create function pg_temp.mangorts_v3_assert_columns(expected_table text, expected_columns text[])
returns void language plpgsql as $$
declare
  actual_columns text[];
begin
  -- Column order is not a schema contract. PostgreSQL appends columns added by
  -- ALTER TABLE, and identifier/text sorting can use different collations.
  -- Compare both set directions plus cardinality so order and collation are
  -- irrelevant while every missing, extra, or duplicated expectation fails.
  select array_agg(column_name::text order by ordinal_position)
    into actual_columns
    from information_schema.columns
   where table_schema='public' and table_name=expected_table;
  if actual_columns is null then
    raise exception 'V3 cutover expected table % is missing', expected_table;
  end if;
  if cardinality(actual_columns) <> cardinality(expected_columns)
     or not (actual_columns @> expected_columns and actual_columns <@ expected_columns) then
    raise exception 'V3 cutover schema drift for %: expected %, found %',
      expected_table, expected_columns, actual_columns;
  end if;
end;
$$;

select pg_temp.mangorts_v3_assert_columns('node_information', array[
  'company_id','information_id','node_id','type','information','save_batch_id',
  'save_kind','saved_by_user_id','saved_by_display_name','source_information_id',
  'created_timestamp','updated_timestamp'
]);
select pg_temp.mangorts_v3_assert_columns('node_projection_table', array[
  'company_id','node_id','information_id','type','information','is_deleted',
  'revision','created_timestamp','updated_timestamp'
]);
select pg_temp.mangorts_v3_assert_columns('node_projection_seen_snapshots', array[
  'company_id','node_id','information_id','user_id','information',
  'projection_updated_timestamp','seen_timestamp'
]);
select pg_temp.mangorts_v3_assert_columns('node_content_changes', array[
  'company_id','change_id','node_id','information_id','change_type','text',
  'start_offset','end_offset','actor_user_id','actor_display_name','created_timestamp'
]);
select pg_temp.mangorts_v3_assert_columns('communications_email_threads', array[
  'company_id','email_thread_id','scope_type','personal_user_id',
  'personal_account_email','shared_inbox_id','account_email','provider_thread_key',
  'provider_thread_id','root_provider_message_id','download_status',
  'history_complete','fetched_at','last_download_error','created_timestamp',
  'updated_timestamp'
]);
select pg_temp.mangorts_v3_assert_columns('communications_email_messages', array[
  'company_id','email_message_id','email_thread_id','provider_message_id',
  'provider_thread_id','message_order','subject','sender_snapshot','to_snapshot',
  'cc_snapshot','bcc_snapshot','reply_to_snapshot','message_timestamp',
  'rich_html_body','text_fallback','snippet','unread','starred','folder_snapshot',
  'folder_id_snapshot','attachment_metadata','download_complete',
  'created_timestamp','updated_timestamp'
]);
select pg_temp.mangorts_v3_assert_columns('communications_node_email_threads', array[
  'company_id','node_id','information_id','email_thread_id',
  'selected_provider_message_id','created_by_user_id','created_timestamp'
]);
select pg_temp.mangorts_v3_assert_columns('communications_email_thread_download_jobs', array[
  'download_job_id','company_id','email_thread_id','download_scope',
  'requested_provider_message_id','requested_by_user_id','status','attempt_count',
  'last_error','available_at','processing_started_at','completed_timestamp',
  'failed_timestamp','created_timestamp','updated_timestamp'
]);
select pg_temp.mangorts_v3_assert_columns('communications_email_drafts', array[
  'company_id','draft_id','personal_user_id','personal_account_email',
  'shared_inbox_id','created_by_user_id','updated_by_user_id','kind',
  'source_message_id','account_email','to_recipients','cc_recipients',
  'bcc_recipients','subject','body_editor_html','reply_to_message',
  'scheduled_send_timestamp','created_timestamp','updated_timestamp',
  'deleted_timestamp','collaboration_id','is_shared','revision','send_state',
  'send_claim_token','send_idempotency_key','send_idempotency_grant_id',
  'send_idempotency_timestamp','send_claimed_revision',
  'send_claimed_timestamp','sent_message_id'
]);
select pg_temp.mangorts_v3_assert_columns('communications_email_collaborations', array[
  'company_id','collaboration_id','node_id','attached_email_information_id',
  'scope_type','personal_user_id','personal_account_email','shared_inbox_id',
  'account_email','provider_thread_id','root_message_id','latest_message_id',
  'message_snapshot','created_by_user_id','created_timestamp','updated_timestamp',
  'email_thread_id'
]);
select pg_temp.mangorts_v3_assert_columns('communications_email_collaboration_participants', array[
  'company_id','collaboration_id','user_id','added_by_user_id','added_via_type',
  'added_via_id','created_timestamp'
]);
select pg_temp.mangorts_v3_assert_columns('communications_email_nodes', array[
  'company_id','user_id','message_id','node_id','board_id','card_id',
  'logic_gate_id','message','created_timestamp','updated_timestamp','email_thread_id'
]);
select pg_temp.mangorts_v3_assert_columns('communications_email_node_attachments', array[
  'company_id','user_id','message_id','node_id','board_id','card_id',
  'logic_gate_id','message','created_timestamp','updated_timestamp','email_thread_id'
]);

do $$
declare
  unexpected text;
begin
  select string_agg(name, ', ' order by name) into unexpected
  from (values
    ('node_textbox_chats'),('node_textbox_seen_snapshots'),('email_threads'),
    ('email_messages'),('email_relationships'),('email_drafts'),
    ('email_thread_download_jobs')
  ) expected(name)
  where to_regclass('public.'||name) is not null;
  if unexpected is not null then
    raise exception 'V3 cutover target objects already exist: %', unexpected;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='node_projection_table'::regclass
      and conname='node_projection_table_pkey'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='communications_email_messages'::regclass
      and conname='communications_email_messages_pkey'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='communications_email_threads'::regclass
      and conname='communications_email_threads_pkey'
  ) then
    raise exception 'V3 cutover expected legacy primary-key constraints are missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='node_information'::regclass
      and tgname='trg_node_view_version_information' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid='node_projection_table'::regclass
      and tgname='trg_node_view_version_projection' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid='node_projection_seen_snapshots'::regclass
      and tgname='trg_node_view_user_version_snapshots' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid='communications_email_nodes'::regclass
      and tgname='trg_logic_gate_work_version_email_origin' and not tgisinternal
  ) then
    raise exception 'V3 cutover expected legacy view-version triggers are missing';
  end if;
end;
$$;

-- The permanent textbox table is authoritative. Refuse to discard any other
-- active generic Node information type or a current textbox without a V3 row.
do $$
begin
  if exists (
    select 1 from node_projection_table projection
    where not projection.is_deleted
      and projection.type not in (
        'Text box'::information_type,
        'Text block chat'::information_type,
        'Attached email'::information_type
      )
  ) then
    raise exception 'V3 cutover found active Node projection data with no permanent target';
  end if;
  if exists (
    select 1 from node_information information
    where information.type not in (
      'Text box'::information_type,
      'Text block chat'::information_type,
      'Attached email'::information_type,
      'Saved version'::information_type
    )
  ) then
    raise exception 'V3 cutover found Node information data with no permanent target';
  end if;
  if exists (
    select 1 from node_projection_table projection
    where not projection.is_deleted
      and projection.type='Text box'::information_type
      and not exists (
        select 1 from node_textboxes textbox
        where textbox.company_id=projection.company_id
          and textbox.node_id=projection.node_id
          and textbox.textbox_id=projection.information_id
      )
  ) then
    raise exception 'V3 cutover found current Node textbox projection without node_textboxes row';
  end if;
  if exists (
    select 1 from node_content_changes change
    where not exists (
      select 1 from node_textboxes textbox
      where textbox.company_id=change.company_id
        and textbox.node_id=change.node_id
        and textbox.textbox_id=change.information_id
    )
  ) then
    raise exception 'V3 cutover found node_content_changes row without a permanent textbox';
  end if;
end;
$$;

-- Retire old view triggers before backfill so the migration does not produce
-- artificial version churn through the legacy stores.
drop trigger trg_node_view_version_information on node_information;
drop trigger trg_node_view_version_projection on node_projection_table;
drop trigger trg_node_view_user_version_snapshots on node_projection_seen_snapshots;
drop trigger trg_logic_gate_work_version_email_origin on communications_email_nodes;

-- Preserve normalized thread and message IDs while transforming their columns.
alter table communications_email_threads rename to email_threads;
alter table communications_email_messages rename to email_messages;
alter table communications_email_thread_download_jobs rename to email_thread_download_jobs;

alter table email_threads rename column scope_type to mailbox_scope_type;
alter table email_threads rename column account_email to mailbox_account_email;
alter table email_threads rename column fetched_at to fetched_timestamp;
alter table email_threads add column provider text;

do $$
begin
  if exists (
    select 1
    from email_threads thread
    where (
      select count(distinct source.provider)
      from (
        select connection.provider
        from user_email_connections connection
        where thread.mailbox_scope_type='personal'
          and connection.user_id=thread.personal_user_id
          and connection.account_email=thread.personal_account_email
        union all
        select connection.provider
        from shared_inboxes inbox
        join company_email_connections connection
          on connection.company_id=inbox.company_id
         and connection.company_email_connection_id=inbox.company_email_connection_id
        where thread.mailbox_scope_type='shared'
          and inbox.company_id=thread.company_id
          and inbox.shared_inbox_id=thread.shared_inbox_id
      ) source
    ) <> 1
  ) then
    raise exception 'V3 cutover cannot resolve exactly one provider for every email thread';
  end if;
end;
$$;

update email_threads thread
set provider=(  select min(source.provider)
  from (
    select connection.provider
    from user_email_connections connection
    where thread.mailbox_scope_type='personal'
      and connection.user_id=thread.personal_user_id
      and connection.account_email=thread.personal_account_email
    union all
    select connection.provider
    from shared_inboxes inbox
    join company_email_connections connection
      on connection.company_id=inbox.company_id
     and connection.company_email_connection_id=inbox.company_email_connection_id
    where thread.mailbox_scope_type='shared'
      and inbox.company_id=thread.company_id
      and inbox.shared_inbox_id=thread.shared_inbox_id
  ) source
);
alter table email_threads alter column provider set not null;
alter table email_threads add constraint email_threads_provider_chk
  check (provider in ('google','microsoft'));

-- Mailbox source metadata must survive source disconnection.
alter table email_threads
  drop constraint communications_email_threads_company_id_personal_user_id_fkey;
alter table email_threads
  drop constraint communications_email_threads_company_id_shared_inbox_id_fkey;

drop index idx_communications_email_threads_personal_provider;
drop index idx_communications_email_threads_shared_provider;
create unique index idx_email_threads_personal_provider
  on email_threads(
    company_id,personal_user_id,personal_account_email,provider,provider_thread_key
  ) where mailbox_scope_type='personal';
create unique index idx_email_threads_shared_provider
  on email_threads(company_id,shared_inbox_id,provider,provider_thread_key)
  where mailbox_scope_type='shared';

alter table email_messages alter column message_timestamp drop default;
alter table email_messages alter column message_timestamp drop not null;
alter table email_messages alter column message_timestamp type timestamptz
  using case
    when message_timestamp <= 0 then null
    when message_timestamp > 100000000000 then to_timestamp(message_timestamp::double precision/1000.0)
    else to_timestamp(message_timestamp::double precision)
  end;
alter table email_messages drop column provider_thread_id;
alter table email_messages
  add constraint email_messages_thread_internal_identity_key
  unique (company_id,email_thread_id,email_message_id);
alter index idx_communications_email_messages_thread_order
  rename to idx_email_messages_thread_order;

alter index idx_communications_email_thread_download_jobs_active_full
  rename to idx_email_thread_download_jobs_active_full;
alter index idx_communications_email_thread_download_jobs_active_message
  rename to idx_email_thread_download_jobs_active_message;
alter index idx_communications_email_thread_download_jobs_claim
  rename to idx_email_thread_download_jobs_claim;

-- Current Node textbox comments.
create table node_textbox_chats (
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
  entity_links jsonb not null default '[]'::jsonb,
  mentioned_user_ids uuid[] not null default '{}'::uuid[],
  mentioned_group_ids uuid[] not null default '{}'::uuid[],
  revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id,chat_id),
  unique (company_id,node_id,textbox_id,chat_id),
  foreign key (company_id,node_id,textbox_id)
    references node_textboxes(company_id,node_id,textbox_id) on delete cascade,
  foreign key (company_id,node_id,textbox_id,parent_chat_id)
    references node_textbox_chats(company_id,node_id,textbox_id,chat_id) on delete cascade,
  foreign key (author_user_id) references users(user_id) on delete set null,
  constraint node_textbox_chats_selection_source_chk
    check (selection_source in ('text','email')),
  constraint node_textbox_chats_selection_target_chk check (
    (selection_source='text' and selection_email_message_id is null)
    or (selection_source='email' and selection_textbox_id is null)
  ),
  constraint node_textbox_chats_selection_offsets_chk check (
    (selection_start is null and selection_end is null)
    or (selection_start >= 0 and selection_end >= selection_start)
  ),
  constraint node_textbox_chats_entity_links_chk check (jsonb_typeof(entity_links)='array'),
  constraint node_textbox_chats_revision_chk check (revision > 0),
  constraint node_textbox_chats_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  )
);
create index idx_node_textbox_chats_textbox_created
  on node_textbox_chats(company_id,node_id,textbox_id,created_timestamp,chat_id)
  where deleted_timestamp is null;
create index idx_node_textbox_chats_parent
  on node_textbox_chats(company_id,node_id,textbox_id,parent_chat_id,created_timestamp)
  where deleted_timestamp is null;
create index idx_node_textbox_chats_email_selection
  on node_textbox_chats(company_id,selection_email_message_id)
  where selection_email_message_id is not null and deleted_timestamp is null;

create temp table mangorts_v3_chat_source_all on commit drop as
select projection.company_id,projection.node_id,projection.information_id as chat_id,
       projection.information::jsonb as payload,projection.is_deleted,
       projection.revision,projection.created_timestamp,projection.updated_timestamp
from node_projection_table projection
where projection.type='Text block chat'::information_type;

do $$
begin
  if exists (
    select 1 from mangorts_v3_chat_source_all source
    where jsonb_typeof(source.payload)<>'object'
       or coalesce(source.payload->>'block_id','') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) then
    raise exception 'V3 cutover found invalid or unmapped Node textbox chat payload';
  end if;
end;
$$;

-- Textbox-owned rows disappear with a deleted textbox. Keep only chats whose
-- permanent host survives; a missing reply parent is detached below.
create temp table mangorts_v3_chat_source on commit drop as
select source.*
from mangorts_v3_chat_source_all source
join node_textboxes textbox
  on textbox.company_id=source.company_id
 and textbox.node_id=source.node_id
 and textbox.textbox_id=(source.payload->>'block_id')::uuid;

delete from resource_attachments attachment
using mangorts_v3_chat_source_all source
where attachment.company_id=source.company_id
  and attachment.resource_type='node_chat_message'
  and attachment.resource_id=source.chat_id::text
  and not exists (
    select 1 from mangorts_v3_chat_source surviving
    where surviving.company_id=source.company_id and surviving.chat_id=source.chat_id
  );

insert into node_textbox_chats(
  company_id,chat_id,node_id,textbox_id,parent_chat_id,selection_source,
  selection_textbox_id,selection_email_message_id,selection_quote,
  selection_start,selection_end,author_user_id,author_display_name,message,
  entity_links,mentioned_user_ids,mentioned_group_ids,revision,
  created_timestamp,updated_timestamp,deleted_timestamp
)
select source.company_id,source.chat_id,source.node_id,
       (source.payload->>'block_id')::uuid,null,
       case when source.payload->>'selection_source'='email' then 'email' else 'text' end,
       case
         when source.payload->>'selection_source'='email' then null
         when coalesce(source.payload->>'selection_block_id','')='' then null
         else (source.payload->>'selection_block_id')::uuid
       end,
       null,
       coalesce(source.payload->>'selection_quote',''),
       case when source.payload ? 'selection_start'
         then (source.payload->>'selection_start')::integer else null end,
       case when source.payload ? 'selection_end'
         then (source.payload->>'selection_end')::integer else null end,
       nullif(source.payload->>'author_id','')::uuid,
       coalesce(source.payload->>'author_name',''),
       coalesce(source.payload->>'message',source.payload->>'content',''),
       coalesce(source.payload->'entity_links','[]'::jsonb),
       coalesce((
         select array_agg(value::uuid order by value)
         from jsonb_array_elements_text(
           coalesce(source.payload->'mentioned_user_ids','[]'::jsonb)
         ) value
       ),'{}'::uuid[]),
       coalesce((
         select array_agg(value::uuid order by value)
         from jsonb_array_elements_text(
           coalesce(source.payload->'mentioned_group_ids','[]'::jsonb)
         ) value
       ),'{}'::uuid[]),
       greatest(source.revision,1),source.created_timestamp,source.updated_timestamp,
       case when source.is_deleted then source.updated_timestamp else null end
from mangorts_v3_chat_source source;

update node_textbox_chats chat
set parent_chat_id=parent.chat_id
from mangorts_v3_chat_source source
join mangorts_v3_chat_source parent
  on parent.company_id=source.company_id
 and parent.node_id=source.node_id
 and parent.chat_id::text=source.payload->>'parent_id'
 and parent.payload->>'block_id'=source.payload->>'block_id'
where source.company_id=chat.company_id and source.chat_id=chat.chat_id;

-- Permanent normalized email relationships.
create table email_relationships (
  company_id uuid not null,
  email_relationship_id uuid not null,
  email_thread_id uuid not null,
  email_message_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  resource_textbox_id text,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,email_relationship_id),
  foreign key (company_id,email_thread_id,email_message_id)
    references email_messages(company_id,email_thread_id,email_message_id) on delete cascade,
  constraint email_relationships_resource_type_chk
    check (resource_type in ('node','project','logic_gate')),
  constraint email_relationships_textbox_id_chk
    check (resource_textbox_id is null or btrim(resource_textbox_id)<>'')
);
create index idx_email_relationships_resource
  on email_relationships(
    company_id,resource_type,resource_id,resource_textbox_id,created_timestamp
  );
create index idx_email_relationships_message
  on email_relationships(company_id,email_thread_id,email_message_id);
create unique index idx_email_relationships_active_identity
  on email_relationships(
    company_id,email_message_id,resource_type,resource_id,
    coalesce(resource_textbox_id,'')
  );

create or replace function mangorts_validate_email_relationship_resource()
returns trigger language plpgsql as $$
begin
  if new.resource_type='node' then
    if not exists (
      select 1 from nodes
      where company_id=new.company_id and node_id=new.resource_id
    ) then
      raise exception 'email relationship node does not exist' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and not exists (
      select 1 from node_textboxes
      where company_id=new.company_id and node_id=new.resource_id
        and textbox_id::text=new.resource_textbox_id and deleted_timestamp is null
    ) then
      raise exception 'email relationship Node textbox does not belong to resource'
        using errcode='23503';
    end if;
  elsif new.resource_type='project' then
    if not exists (
      select 1 from projects
      where company_id=new.company_id and project_id=new.resource_id
    ) then      raise exception 'email relationship project does not exist' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and not exists (
      select 1 from project_textboxes
      where company_id=new.company_id and project_id=new.resource_id
        and textbox_id=new.resource_textbox_id and deleted_timestamp is null
    ) then
      raise exception 'email relationship Project textbox does not belong to resource'
        using errcode='23503';
    end if;
  elsif new.resource_type='logic_gate' then
    if not exists (
      select 1 from logic_gates
      where company_id=new.company_id and logic_gate_id=new.resource_id
    ) then
      raise exception 'email relationship Logic Gate does not exist' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and not exists (
      select 1 from logic_gate_textboxes
      where company_id=new.company_id and logic_gate_id=new.resource_id
        and textbox_id=new.resource_textbox_id and deleted_timestamp is null
    ) then
      raise exception 'email relationship Logic Gate textbox does not belong to resource'
        using errcode='23503';
    end if;
  else
    raise exception 'unsupported email relationship resource type' using errcode='23514';
  end if;
  return new;
end;
$$;
create constraint trigger trg_validate_email_relationship_resource
after insert or update of company_id,resource_type,resource_id,resource_textbox_id
on email_relationships deferrable initially immediate
for each row execute function mangorts_validate_email_relationship_resource();

create function pg_temp.mangorts_v3_uuid(value text)
returns uuid language sql immutable strict as $$
  select (
    substr(md5(value),1,8)||'-'||substr(md5(value),9,4)||'-'||
    substr(md5(value),13,4)||'-'||substr(md5(value),17,4)||'-'||
    substr(md5(value),21,12)
  )::uuid
$$;

-- Normalized rows are authoritative. When they are missing, repair from the
-- durable collaboration snapshot first. Provider resolution must be exact;
-- disconnected sources are accepted only when an existing normalized thread
-- still supplies the provider identity.
create temp table mangorts_v3_collaboration_repair on commit drop as
select collaboration.*,
       provider_source.provider_count,
       provider_source.provider,
       matching_thread.match_count,
       matching_thread.email_thread_id as matching_email_thread_id,
       coalesce(
         collaboration.email_thread_id,
         matching_thread.email_thread_id,
         pg_temp.mangorts_v3_uuid(
           'v3-collaboration-thread:'||collaboration.company_id||':'||
           collaboration.collaboration_id
         )
       ) as resolved_email_thread_id,
       case
         when collaboration.provider_thread_id<>''
           then 'thread:'||collaboration.provider_thread_id
         else 'message:'||collaboration.root_message_id
       end as resolved_provider_thread_key
from communications_email_collaborations collaboration
cross join lateral (
  select count(distinct candidate.provider) as provider_count,
         min(candidate.provider) as provider
  from (
    select thread.provider
    from email_threads thread
    where thread.company_id=collaboration.company_id
      and thread.email_thread_id=collaboration.email_thread_id
    union
    select connection.provider
    from user_email_connections connection
    where collaboration.scope_type='personal'
      and connection.user_id=collaboration.personal_user_id
      and connection.account_email=collaboration.personal_account_email
    union
    select connection.provider
    from shared_inboxes inbox
    join company_email_connections connection
      on connection.company_id=inbox.company_id
     and connection.company_email_connection_id=inbox.company_email_connection_id
    where collaboration.scope_type='shared'
      and inbox.company_id=collaboration.company_id
      and inbox.shared_inbox_id=collaboration.shared_inbox_id
    union
    select thread.provider
    from email_threads thread
    where thread.company_id=collaboration.company_id
      and thread.mailbox_scope_type=collaboration.scope_type
      and thread.provider_thread_key=case
        when collaboration.provider_thread_id<>''
          then 'thread:'||collaboration.provider_thread_id
        else 'message:'||collaboration.root_message_id
      end
      and (
        (collaboration.scope_type='personal'
          and thread.personal_user_id=collaboration.personal_user_id
          and thread.personal_account_email=collaboration.personal_account_email)
        or
        (collaboration.scope_type='shared'
          and thread.shared_inbox_id=collaboration.shared_inbox_id)
      )
  ) candidate
) provider_source
cross join lateral (
  select count(*) as match_count,min(thread.email_thread_id::text)::uuid as email_thread_id
  from email_threads thread
  where thread.company_id=collaboration.company_id
    and thread.mailbox_scope_type=collaboration.scope_type
    and thread.provider=provider_source.provider
    and thread.provider_thread_key=case
      when collaboration.provider_thread_id<>''
        then 'thread:'||collaboration.provider_thread_id
      else 'message:'||collaboration.root_message_id
    end
    and (
      (collaboration.scope_type='personal'
        and thread.personal_user_id=collaboration.personal_user_id
        and thread.personal_account_email=collaboration.personal_account_email)
      or
      (collaboration.scope_type='shared'
        and thread.shared_inbox_id=collaboration.shared_inbox_id)
    )
) matching_thread;

do $$
begin
  if exists (
    select 1 from mangorts_v3_collaboration_repair
    where provider_count<>1 or provider not in ('google','microsoft')
  ) then
    raise exception 'V3 cutover cannot resolve exactly one provider for collaboration fallback email data';
  end if;
  if exists (
    select 1 from mangorts_v3_collaboration_repair where match_count>1
  ) then
    raise exception 'V3 cutover found ambiguous normalized thread matches for collaboration fallback email data';
  end if;
  if exists (
    select 1
    from mangorts_v3_collaboration_repair repair
    join email_threads thread
      on thread.company_id=repair.company_id
     and thread.email_thread_id=repair.email_thread_id
    where thread.mailbox_scope_type<>repair.scope_type
       or thread.provider<>repair.provider
       or thread.mailbox_account_email<>repair.account_email
       or thread.provider_thread_key<>repair.resolved_provider_thread_key
       or coalesce(thread.personal_user_id::text,'')<>coalesce(repair.personal_user_id::text,'')
       or coalesce(thread.personal_account_email,'')<>coalesce(repair.personal_account_email,'')
       or coalesce(thread.shared_inbox_id::text,'')<>coalesce(repair.shared_inbox_id::text,'')
  ) then
    raise exception 'V3 cutover found collaboration mailbox metadata that conflicts with its normalized thread';
  end if;
  if exists (
    select 1 from mangorts_v3_collaboration_repair
    where jsonb_typeof(message_snapshot)<>'object'
       or coalesce(message_snapshot->>'id',latest_message_id)<>latest_message_id
  ) then
    raise exception 'V3 cutover found invalid collaboration fallback message snapshot';
  end if;
  if exists (
    select 1
    from mangorts_v3_collaboration_repair
    group by company_id,resolved_email_thread_id
    having count(distinct (
      scope_type||':'||coalesce(personal_user_id::text,'')||':'||
      coalesce(personal_account_email,'')||':'||coalesce(shared_inbox_id::text,'')||':'||
      account_email||':'||provider||':'||resolved_provider_thread_key
    ))>1
  ) then
    raise exception 'V3 cutover found conflicting collaboration snapshots for one preserved thread ID';
  end if;
end;
$$;

insert into email_threads(
  company_id,email_thread_id,mailbox_scope_type,personal_user_id,
  personal_account_email,shared_inbox_id,mailbox_account_email,provider,
  provider_thread_key,provider_thread_id,root_provider_message_id,
  download_status,history_complete,fetched_timestamp,last_download_error,
  created_timestamp,updated_timestamp
)
select distinct on (repair.company_id,repair.resolved_email_thread_id)
       repair.company_id,repair.resolved_email_thread_id,repair.scope_type,
       repair.personal_user_id,repair.personal_account_email,repair.shared_inbox_id,
       repair.account_email,repair.provider,repair.resolved_provider_thread_key,
       repair.provider_thread_id,repair.root_message_id,'partial',false,null,'',
       repair.created_timestamp,repair.updated_timestamp
from mangorts_v3_collaboration_repair repair
where not exists (
  select 1 from email_threads thread
  where thread.company_id=repair.company_id
    and thread.email_thread_id=repair.resolved_email_thread_id
)
order by repair.company_id,repair.resolved_email_thread_id,
         repair.created_timestamp,repair.collaboration_id;

update communications_email_collaborations collaboration
set email_thread_id=repair.resolved_email_thread_id
from mangorts_v3_collaboration_repair repair
where repair.company_id=collaboration.company_id
  and repair.collaboration_id=collaboration.collaboration_id;

insert into email_messages(
  company_id,email_message_id,email_thread_id,provider_message_id,message_order,
  subject,sender_snapshot,to_snapshot,cc_snapshot,bcc_snapshot,reply_to_snapshot,
  message_timestamp,rich_html_body,text_fallback,snippet,unread,starred,
  folder_snapshot,folder_id_snapshot,attachment_metadata,download_complete,
  created_timestamp,updated_timestamp
)
select repair.company_id,
       pg_temp.mangorts_v3_uuid(
         'v3-collaboration-message:'||repair.company_id||':'||
         repair.resolved_email_thread_id||':'||repair.latest_message_id
       ),
       repair.resolved_email_thread_id,repair.latest_message_id,
       coalesce((
         select max(message.message_order)+1
         from email_messages message
         where message.company_id=repair.company_id
           and message.email_thread_id=repair.resolved_email_thread_id
       ),0),
       coalesce(repair.message_snapshot->>'subject',''),
       case when jsonb_typeof(repair.message_snapshot->'from')='array'
         then repair.message_snapshot->'from' else '[]'::jsonb end,
       case when jsonb_typeof(repair.message_snapshot->'to')='array'
         then repair.message_snapshot->'to' else '[]'::jsonb end,
       case when jsonb_typeof(repair.message_snapshot->'cc')='array'
         then repair.message_snapshot->'cc' else '[]'::jsonb end,
       case when jsonb_typeof(repair.message_snapshot->'bcc')='array'
         then repair.message_snapshot->'bcc' else '[]'::jsonb end,
       case when jsonb_typeof(repair.message_snapshot->'reply_to')='array'
         then repair.message_snapshot->'reply_to' else '[]'::jsonb end,
       case when nullif(repair.message_snapshot->>'date','') is null then null
         when (repair.message_snapshot->>'date')::numeric>100000000000
           then to_timestamp((repair.message_snapshot->>'date')::double precision/1000.0)
         else to_timestamp((repair.message_snapshot->>'date')::double precision)
       end,
       coalesce(repair.message_snapshot->>'body',''),'',
       coalesce(repair.message_snapshot->>'snippet',''),
       case when repair.message_snapshot->>'unread' in ('true','false')
         then (repair.message_snapshot->>'unread')::boolean else false end,
       case when repair.message_snapshot->>'starred' in ('true','false')
         then (repair.message_snapshot->>'starred')::boolean else false end,
       case when jsonb_typeof(repair.message_snapshot->'folders')='array'
         then repair.message_snapshot->'folders' else '[]'::jsonb end,
       case when jsonb_typeof(repair.message_snapshot->'folder_ids')='array'
         then repair.message_snapshot->'folder_ids' else '[]'::jsonb end,
       case when jsonb_typeof(repair.message_snapshot->'attachments')='array'
         then repair.message_snapshot->'attachments' else '[]'::jsonb end,
       case when repair.message_snapshot->>'download_complete' in ('true','false')
         then (repair.message_snapshot->>'download_complete')::boolean else false end,
       repair.created_timestamp,repair.updated_timestamp
from mangorts_v3_collaboration_repair repair
where not exists (
  select 1 from email_messages message
  where message.company_id=repair.company_id
    and message.email_thread_id=repair.resolved_email_thread_id
    and message.provider_message_id=repair.latest_message_id
);

-- Placement and projection snapshots are the second fallback. They may repair a
-- missing message only inside an already resolved normalized thread; they never
-- invent mailbox ownership.
create temp table mangorts_v3_message_snapshot_candidates on commit drop as
select source.company_id,source.email_thread_id,source.message_id as provider_message_id,
       source.message as snapshot,10 as priority,
       'email-node:'||source.company_id||':'||source.node_id as source_key,
       source.created_timestamp,source.updated_timestamp
from communications_email_nodes source
union all
select source.company_id,source.email_thread_id,source.message_id,
       source.message,20,
       'email-attachment:'||source.company_id||':'||source.user_id||':'||
         source.message_id||':'||source.node_id,
       source.created_timestamp,source.updated_timestamp
from communications_email_node_attachments source
union all
select projection.company_id,
       nullif(projection.information::jsonb->>'email_thread_id','')::uuid,
       projection.information::jsonb->>'message_id',projection.information::jsonb,
       30,'projection:'||projection.company_id||':'||projection.node_id||':'||
         projection.information_id,
       projection.created_timestamp,projection.updated_timestamp
from node_projection_table projection
where projection.type='Attached email'::information_type
  and not projection.is_deleted;

do $$
begin
  if exists (
    select 1 from mangorts_v3_message_snapshot_candidates candidate
    where btrim(coalesce(candidate.provider_message_id,''))=''
       or jsonb_typeof(candidate.snapshot)<>'object'
  ) then
    raise exception 'V3 cutover found invalid placement/projection fallback email snapshot';
  end if;
  if exists (
    select 1
    from mangorts_v3_message_snapshot_candidates candidate
    where not exists (
      select 1 from email_messages message
      where message.company_id=candidate.company_id
        and message.provider_message_id=candidate.provider_message_id
        and (
          candidate.email_thread_id is null
          or message.email_thread_id=candidate.email_thread_id
        )
    )
      and (
        candidate.email_thread_id is null
        or not exists (
          select 1 from email_threads thread
          where thread.company_id=candidate.company_id
            and thread.email_thread_id=candidate.email_thread_id
        )
      )
  ) then
    raise exception 'V3 cutover cannot assign fallback email snapshot to exactly one normalized thread';
  end if;
  if exists (
    select 1
    from mangorts_v3_message_snapshot_candidates candidate
    where not exists (
      select 1 from email_messages message
      where message.company_id=candidate.company_id
        and message.email_thread_id=candidate.email_thread_id
        and message.provider_message_id=candidate.provider_message_id
    )
    group by candidate.company_id,candidate.email_thread_id,
             candidate.provider_message_id,candidate.priority
    having count(distinct (
      coalesce(candidate.snapshot->>'subject','')||':'||
      coalesce(candidate.snapshot->>'snippet','')||':'||
      coalesce(candidate.snapshot->>'body','')||':'||
      coalesce(candidate.snapshot->>'date','')
    ))>1
  ) then
    raise exception 'V3 cutover found conflicting equal-precedence fallback email snapshots';
  end if;
end;
$$;

with missing as (
  select candidate.*,
         row_number() over (
           partition by candidate.company_id,candidate.email_thread_id,
                        candidate.provider_message_id
           order by candidate.priority,candidate.source_key
         ) as source_rank
  from mangorts_v3_message_snapshot_candidates candidate
  where candidate.email_thread_id is not null
    and not exists (
      select 1 from email_messages message
      where message.company_id=candidate.company_id
        and message.email_thread_id=candidate.email_thread_id
        and message.provider_message_id=candidate.provider_message_id
    )
), chosen as (
  select missing.*,
         row_number() over (
           partition by missing.company_id,missing.email_thread_id
           order by missing.created_timestamp,missing.provider_message_id
         ) as added_order
  from missing
  where missing.source_rank=1
), thread_max as (
  select chosen.company_id,chosen.email_thread_id,
         coalesce(max(message.message_order),-1) as maximum_order
  from chosen
  left join email_messages message
    on message.company_id=chosen.company_id
   and message.email_thread_id=chosen.email_thread_id
  group by chosen.company_id,chosen.email_thread_id
)
insert into email_messages(
  company_id,email_message_id,email_thread_id,provider_message_id,message_order,
  subject,sender_snapshot,to_snapshot,cc_snapshot,bcc_snapshot,reply_to_snapshot,
  message_timestamp,rich_html_body,text_fallback,snippet,unread,starred,
  folder_snapshot,folder_id_snapshot,attachment_metadata,download_complete,
  created_timestamp,updated_timestamp
)
select chosen.company_id,
       pg_temp.mangorts_v3_uuid(
         'v3-placement-message:'||chosen.company_id||':'||
         chosen.email_thread_id||':'||chosen.provider_message_id
       ),
       chosen.email_thread_id,chosen.provider_message_id,
       thread_max.maximum_order+chosen.added_order,
       coalesce(chosen.snapshot->>'subject',''),
       case when jsonb_typeof(chosen.snapshot->'from')='array'
         then chosen.snapshot->'from' else '[]'::jsonb end,
       case when jsonb_typeof(chosen.snapshot->'to')='array'
         then chosen.snapshot->'to' else '[]'::jsonb end,
       case when jsonb_typeof(chosen.snapshot->'cc')='array'
         then chosen.snapshot->'cc' else '[]'::jsonb end,
       case when jsonb_typeof(chosen.snapshot->'bcc')='array'
         then chosen.snapshot->'bcc' else '[]'::jsonb end,
       case when jsonb_typeof(chosen.snapshot->'reply_to')='array'
         then chosen.snapshot->'reply_to' else '[]'::jsonb end,
       case when nullif(chosen.snapshot->>'date','') is null then null
         when (chosen.snapshot->>'date')::numeric>100000000000
           then to_timestamp((chosen.snapshot->>'date')::double precision/1000.0)
         else to_timestamp((chosen.snapshot->>'date')::double precision)
       end,
       coalesce(chosen.snapshot->>'body',''),'',
       coalesce(chosen.snapshot->>'snippet',''),
       case when chosen.snapshot->>'unread' in ('true','false')
         then (chosen.snapshot->>'unread')::boolean else false end,
       case when chosen.snapshot->>'starred' in ('true','false')
         then (chosen.snapshot->>'starred')::boolean else false end,
       case when jsonb_typeof(chosen.snapshot->'folders')='array'
         then chosen.snapshot->'folders' else '[]'::jsonb end,
       case when jsonb_typeof(chosen.snapshot->'folder_ids')='array'
         then chosen.snapshot->'folder_ids' else '[]'::jsonb end,
       case when jsonb_typeof(chosen.snapshot->'attachments')='array'
         then chosen.snapshot->'attachments' else '[]'::jsonb end,
       case when chosen.snapshot->>'download_complete' in ('true','false')
         then (chosen.snapshot->>'download_complete')::boolean else false end,
       chosen.created_timestamp,chosen.updated_timestamp
from chosen
join thread_max
  on thread_max.company_id=chosen.company_id
 and thread_max.email_thread_id=chosen.email_thread_id;

-- A legacy attached-email row with an explicit textbox host is owned by that
-- exact textbox relationship. Preserve its normalized email, but do not
-- silently downgrade a missing textbox relationship to a Node relationship.
create temp table mangorts_v3_email_relationships_without_host on commit drop as
select projection.company_id,projection.information_id
from node_projection_table projection
where projection.type='Attached email'::information_type
  and not projection.is_deleted
  and coalesce(projection.information::jsonb->>'block_id','')<>''
  and not exists (
    select 1 from node_textboxes textbox
    where textbox.company_id=projection.company_id
      and textbox.node_id=projection.node_id
      and textbox.textbox_id::text=projection.information::jsonb->>'block_id'
      and textbox.deleted_timestamp is null
  );

create temp table mangorts_v3_relationship_candidates (
  company_id uuid not null,
  proposed_relationship_id uuid not null,
  source_key text not null,
  priority integer not null,
  email_thread_id uuid,
  provider_message_id text not null,
  resource_type text not null,
  resource_id uuid not null,
  resource_textbox_id text,
  created_timestamp timestamptz not null
) on commit drop;

insert into mangorts_v3_relationship_candidates
select link.company_id,link.information_id,
       'thread-link:'||link.company_id||':'||link.node_id||':'||link.information_id,
       10,link.email_thread_id,link.selected_provider_message_id,
       'node',link.node_id,null,link.created_timestamp
from communications_node_email_threads link
where exists (
  select 1 from nodes node
  where node.company_id=link.company_id
    and node.node_id=link.node_id
)
and not exists (
  select 1 from mangorts_v3_email_relationships_without_host missing_host
  where missing_host.company_id=link.company_id
    and missing_host.information_id=link.information_id
);

insert into mangorts_v3_relationship_candidates
select collaboration.company_id,collaboration.attached_email_information_id,
       'collaboration:'||collaboration.company_id||':'||collaboration.collaboration_id,
       20,collaboration.email_thread_id,collaboration.latest_message_id,
       'node',collaboration.node_id,null,collaboration.created_timestamp
from communications_email_collaborations collaboration
where exists (
  select 1 from nodes node
  where node.company_id=collaboration.company_id
    and node.node_id=collaboration.node_id
)
and not exists (
  select 1 from mangorts_v3_email_relationships_without_host missing_host
  where missing_host.company_id=collaboration.company_id
    and missing_host.information_id=collaboration.attached_email_information_id
);

insert into mangorts_v3_relationship_candidates
select source.company_id,
       pg_temp.mangorts_v3_uuid(
         'communications_email_nodes:'||source.company_id||':'||
         source.node_id||':'||source.message_id
       ),
       'email-node:'||source.company_id||':'||source.node_id||':'||source.message_id,
       40,source.email_thread_id,source.message_id,
       'node',source.node_id,null,source.created_timestamp
from communications_email_nodes source
where exists (
  select 1 from nodes node
  where node.company_id=source.company_id
    and node.node_id=source.node_id
);

insert into mangorts_v3_relationship_candidates
select source.company_id,
       pg_temp.mangorts_v3_uuid(
         'communications_email_node_attachments:'||source.company_id||':'||
         source.node_id||':'||source.message_id
       ),
       'email-attachment:'||source.company_id||':'||source.node_id||':'||source.message_id,
       50,source.email_thread_id,source.message_id,
       'node',source.node_id,null,source.created_timestamp
from communications_email_node_attachments source
where exists (
  select 1 from nodes node
  where node.company_id=source.company_id
    and node.node_id=source.node_id
);

insert into mangorts_v3_relationship_candidates
select projection.company_id,projection.information_id,
       'projection:'||projection.company_id||':'||projection.node_id||':'||
         projection.information_id,
       30,nullif(projection.information::jsonb->>'email_thread_id','')::uuid,
       projection.information::jsonb->>'message_id',
       'node',projection.node_id,
       case
         when exists (
           select 1 from node_textboxes textbox
           where textbox.company_id=projection.company_id
             and textbox.node_id=projection.node_id
             and textbox.textbox_id::text=projection.information::jsonb->>'block_id'
             and textbox.deleted_timestamp is null
         ) then projection.information::jsonb->>'block_id'
         else null
       end,
       projection.created_timestamp
from node_projection_table projection
where projection.type='Attached email'::information_type
  and not projection.is_deleted
  and exists (
    select 1 from nodes node
    where node.company_id=projection.company_id
      and node.node_id=projection.node_id
  )
  and not exists (
    select 1 from mangorts_v3_email_relationships_without_host missing_host
    where missing_host.company_id=projection.company_id
      and missing_host.information_id=projection.information_id
  );

do $$
begin
  if exists (
    select 1 from mangorts_v3_relationship_candidates
    where btrim(provider_message_id)=''
  ) then
    raise exception 'V3 cutover found email relationship without provider message ID';
  end if;
  if exists (
    select 1
    from mangorts_v3_relationship_candidates candidate
    where (
      select count(*)
      from email_messages message
      where message.company_id=candidate.company_id
        and message.provider_message_id=candidate.provider_message_id
        and (
          candidate.email_thread_id is null
          or message.email_thread_id=candidate.email_thread_id
        )
    ) <> 1
  ) then
    raise exception 'V3 cutover found unmapped or ambiguous email relationship source';
  end if;
end;
$$;

create temp table mangorts_v3_relationship_resolved on commit drop as
select candidate.*,
       resolved.email_thread_id as resolved_email_thread_id,
       resolved.email_message_id
from mangorts_v3_relationship_candidates candidate
cross join lateral (
  select message.email_thread_id,message.email_message_id
  from email_messages message
  where message.company_id=candidate.company_id
    and message.provider_message_id=candidate.provider_message_id
    and (
      candidate.email_thread_id is null
      or message.email_thread_id=candidate.email_thread_id
    )
) resolved;

do $$
begin
  if exists (
    select 1
    from mangorts_v3_relationship_resolved
    group by company_id,proposed_relationship_id
    having count(distinct (
      resolved_email_thread_id::text||':'||email_message_id::text||':'||
      resource_type||':'||resource_id::text||':'||coalesce(resource_textbox_id,'')
    )) > 1
  ) then
    raise exception 'V3 cutover found one preserved relationship ID with conflicting data';
  end if;
end;
$$;

with ranked as (
  select resolved.*,
         row_number() over (
           partition by company_id,email_message_id,resource_type,resource_id,
                        coalesce(resource_textbox_id,'')
           order by priority,proposed_relationship_id
         ) as identity_rank,
         row_number() over (
           partition by company_id,proposed_relationship_id
           order by priority,source_key
         ) as id_rank
  from mangorts_v3_relationship_resolved resolved
)
insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select company_id,proposed_relationship_id,resolved_email_thread_id,email_message_id,
       resource_type,resource_id,resource_textbox_id,min(created_timestamp)
from ranked
where identity_rank=1 and id_rank=1
group by company_id,proposed_relationship_id,resolved_email_thread_id,email_message_id,
         resource_type,resource_id,resource_textbox_id;

-- Resolve email selections only after relationship backfill, and require exactly
-- one internal email identity within the selected Node.
do $$
begin
  if exists (
    select 1
    from mangorts_v3_chat_source source
    where source.payload->>'selection_source'='email'
      and coalesce(source.payload->>'selection_message_id','')<>''
      and (
        select count(distinct message.email_message_id)
        from email_relationships relationship
        join email_messages message
          on message.company_id=relationship.company_id
         and message.email_thread_id=relationship.email_thread_id
        where relationship.company_id=source.company_id
          and relationship.resource_type='node'
          and relationship.resource_id=source.node_id
          and message.provider_message_id=source.payload->>'selection_message_id'
      ) <> 1
  ) then
    raise exception 'V3 cutover found an unmapped or ambiguous chat email selection';
  end if;
end;
$$;

update node_textbox_chats chat
set selection_email_message_id=resolved.email_message_id
from mangorts_v3_chat_source source
cross join lateral (
  select min(message.email_message_id::text)::uuid as email_message_id
  from email_relationships relationship
  join email_messages message
    on message.company_id=relationship.company_id
   and message.email_thread_id=relationship.email_thread_id
  where relationship.company_id=source.company_id
    and relationship.resource_type='node'
    and relationship.resource_id=source.node_id
    and message.provider_message_id=source.payload->>'selection_message_id'
) resolved
where chat.company_id=source.company_id and chat.chat_id=source.chat_id
  and source.payload->>'selection_source'='email'
  and coalesce(source.payload->>'selection_message_id','')<>'';

-- Existing collaboration participants become ordinary direct Node permissions.
insert into resource_permissions(
  company_id,resource_type,resource_id,subject_type,subject_id,user_id,
  access_level,created_timestamp,updated_timestamp
)
select participant.company_id,'node',collaboration.node_id,'user',
       participant.user_id,participant.user_id,'edit',
       participant.created_timestamp,participant.created_timestamp
from communications_email_collaboration_participants participant
join communications_email_collaborations collaboration
  on collaboration.company_id=participant.company_id
 and collaboration.collaboration_id=participant.collaboration_id
join nodes node
  on node.company_id=collaboration.company_id
 and node.node_id=collaboration.node_id
on conflict(company_id,resource_type,resource_id,subject_type,subject_id)
do update set access_level='edit',user_id=excluded.user_id,updated_timestamp=now();

-- Shared and ordinary drafts move into one permanent table.
create table email_drafts (
  company_id uuid not null,
  draft_id text not null,
  email_relationship_id uuid,
  source_email_message_id uuid,
  mailbox_scope_type text not null,
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
  sent_email_message_id uuid,  sent_provider_message_id text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id,draft_id),
  foreign key (company_id,email_relationship_id)
    references email_relationships(company_id,email_relationship_id) on delete cascade,
  foreign key (company_id,source_email_message_id)
    references email_messages(company_id,email_message_id) on delete restrict,
  foreign key (company_id,sent_email_message_id)
    references email_messages(company_id,email_message_id) on delete restrict,
  foreign key (created_by_user_id) references users(user_id) on delete set null,
  foreign key (updated_by_user_id) references users(user_id) on delete set null,
  constraint email_drafts_draft_id_chk check (btrim(draft_id)<>''),
  constraint email_drafts_scope_type_chk check (mailbox_scope_type in ('personal','shared')),
  constraint email_drafts_scope_chk check (
    (mailbox_scope_type='personal' and personal_user_id is not null
      and personal_account_email is not null and shared_inbox_id is null)
    or
    (mailbox_scope_type='shared' and personal_user_id is null
      and personal_account_email is null and shared_inbox_id is not null)
  ),
  constraint email_drafts_personal_account_email_chk check (
    personal_account_email is null
    or (btrim(personal_account_email)<>'' and personal_account_email=lower(btrim(personal_account_email)))
  ),
  constraint email_drafts_sender_account_email_chk check (
    sender_account_email='' or sender_account_email=lower(btrim(sender_account_email))
  ),
  constraint email_drafts_kind_chk check (kind in ('compose','reply','forward')),
  constraint email_drafts_revision_chk check (revision>0),
  constraint email_drafts_send_state_chk check (send_state in ('draft','sending','sent'))
);

create temp table mangorts_v3_draft_resolved on commit drop as
select draft.*,
       relationship.email_relationship_id as resolved_relationship_id,
       source_message.email_message_id as resolved_source_message_id,
       sent_message.email_message_id as resolved_sent_message_id
from communications_email_drafts draft
left join communications_email_collaborations collaboration
  on collaboration.company_id=draft.company_id
 and collaboration.collaboration_id=draft.collaboration_id
left join lateral (
  select relationship.email_relationship_id
  from email_relationships relationship
  join email_messages message
    on message.company_id=relationship.company_id
   and message.email_thread_id=relationship.email_thread_id
   and message.email_message_id=relationship.email_message_id
  where collaboration.collaboration_id is not null
    and relationship.company_id=collaboration.company_id
    and relationship.resource_type='node'
    and relationship.resource_id=collaboration.node_id
    and message.provider_message_id=collaboration.latest_message_id
  order by relationship.created_timestamp,relationship.email_relationship_id
  limit 1
) relationship on true
left join lateral (
  select message.email_message_id
  from email_messages message
  join email_threads thread
    on thread.company_id=message.company_id
   and thread.email_thread_id=message.email_thread_id
  where btrim(draft.source_message_id)<>''
    and message.company_id=draft.company_id
    and message.provider_message_id=draft.source_message_id
    and (
      (draft.personal_user_id is not null
        and thread.mailbox_scope_type='personal'
        and thread.personal_user_id=draft.personal_user_id
        and thread.personal_account_email=draft.personal_account_email)
      or
      (draft.shared_inbox_id is not null
        and thread.mailbox_scope_type='shared'
        and thread.shared_inbox_id=draft.shared_inbox_id)
    )
) source_message on true
left join lateral (
  select message.email_message_id
  from email_messages message
  join email_threads thread
    on thread.company_id=message.company_id
   and thread.email_thread_id=message.email_thread_id
  where btrim(draft.sent_message_id)<>''
    and message.company_id=draft.company_id
    and message.provider_message_id=draft.sent_message_id
    and (
      (draft.personal_user_id is not null
        and thread.mailbox_scope_type='personal'
        and thread.personal_user_id=draft.personal_user_id
        and thread.personal_account_email=draft.personal_account_email)
      or
      (draft.shared_inbox_id is not null
        and thread.mailbox_scope_type='shared'
        and thread.shared_inbox_id=draft.shared_inbox_id)
    )
  order by message.updated_timestamp desc
  limit 1
) sent_message on true;

do $$
begin
  if exists (
    select 1 from mangorts_v3_draft_resolved
    where not is_shared and resolved_relationship_id is not null
  ) then
    raise exception 'V3 cutover found draft with unmapped relationship';
  end if;
  if exists (
    select 1
    from communications_email_drafts draft
    where btrim(draft.source_message_id)<>''
      and (
        select count(*)
        from email_messages message
        join email_threads thread
          on thread.company_id=message.company_id
         and thread.email_thread_id=message.email_thread_id
        where message.company_id=draft.company_id
          and message.provider_message_id=draft.source_message_id
          and (
            (draft.personal_user_id is not null
              and thread.mailbox_scope_type='personal'
              and thread.personal_user_id=draft.personal_user_id
              and thread.personal_account_email=draft.personal_account_email)
            or
            (draft.shared_inbox_id is not null
              and thread.mailbox_scope_type='shared'
              and thread.shared_inbox_id=draft.shared_inbox_id)
          )
      ) > 1
  ) then
    raise exception 'V3 cutover found ambiguous draft source message';
  end if;
end;
$$;

insert into email_drafts(
  company_id,draft_id,email_relationship_id,source_email_message_id,
  mailbox_scope_type,personal_user_id,personal_account_email,shared_inbox_id,
  sender_account_email,created_by_user_id,updated_by_user_id,kind,
  to_recipients,cc_recipients,bcc_recipients,subject,body_editor_html,
  scheduled_send_timestamp,revision,send_state,send_claim_token,
  send_idempotency_key,send_idempotency_grant_id,send_idempotency_timestamp,
  send_claimed_revision,send_claimed_timestamp,sent_email_message_id,
  sent_provider_message_id,created_timestamp,updated_timestamp,deleted_timestamp
)
select company_id,draft_id,resolved_relationship_id,resolved_source_message_id,
       case when personal_user_id is not null then 'personal' else 'shared' end,
       personal_user_id,personal_account_email,shared_inbox_id,
       account_email,created_by_user_id,updated_by_user_id,kind,
       to_recipients,cc_recipients,bcc_recipients,subject,body_editor_html,
       scheduled_send_timestamp,revision,send_state,send_claim_token,
       send_idempotency_key,send_idempotency_grant_id,send_idempotency_timestamp,
       send_claimed_revision,send_claimed_timestamp,resolved_sent_message_id,
       sent_message_id,created_timestamp,updated_timestamp,deleted_timestamp
from mangorts_v3_draft_resolved;

create index idx_email_drafts_personal_updated
  on email_drafts(company_id,personal_user_id,personal_account_email,updated_timestamp desc)
  where deleted_timestamp is null and mailbox_scope_type='personal';
create index idx_email_drafts_shared_updated
  on email_drafts(company_id,shared_inbox_id,updated_timestamp desc)
  where deleted_timestamp is null and mailbox_scope_type='shared';
create index idx_email_drafts_relationship_updated
  on email_drafts(company_id,email_relationship_id,updated_timestamp desc)
  where deleted_timestamp is null and email_relationship_id is not null;
create unique index idx_email_drafts_active_relationship_source
  on email_drafts(company_id,email_relationship_id,source_email_message_id)
  where deleted_timestamp is null
    and email_relationship_id is not null
    and source_email_message_id is not null;

-- Exact per-user textbox baselines.
create table node_textbox_seen_snapshots (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  user_id uuid not null,
  body_json jsonb not null,
  textbox_revision bigint not null,
  textbox_updated_timestamp timestamptz not null,
  seen_timestamp timestamptz not null default now(),
  primary key (company_id,node_id,textbox_id,user_id),
  foreign key (company_id,node_id,textbox_id)
    references node_textboxes(company_id,node_id,textbox_id) on delete cascade,
  foreign key (user_id) references users(user_id) on delete cascade,
  constraint node_textbox_seen_snapshots_revision_chk check (textbox_revision>=0)
);

insert into node_textbox_seen_snapshots(
  company_id,node_id,textbox_id,user_id,body_json,textbox_revision,
  textbox_updated_timestamp,seen_timestamp
)
select snapshot.company_id,snapshot.node_id,snapshot.information_id,snapshot.user_id,
       textbox.body_json,textbox.revision,textbox.updated_timestamp,
       snapshot.seen_timestamp
from node_projection_seen_snapshots snapshot
join node_textboxes textbox
  on textbox.company_id=snapshot.company_id
 and textbox.node_id=snapshot.node_id
 and textbox.textbox_id=snapshot.information_id;

alter table node_content_changes rename column information_id to textbox_id;
alter table node_content_changes
  add constraint node_content_changes_textbox_fkey
  foreign key (company_id,node_id,textbox_id)
  references node_textboxes(company_id,node_id,textbox_id) on delete cascade;

-- Attachment blobs stay in place; only the durable relationship identity changes.
do $$
begin
  if exists (
    select 1 from attachment_upload_intents
    where resource_type='attached_email'
  ) then
    raise exception 'V3 cutover requires attached-email upload intents to finish before migration';
  end if;
end;
$$;

create temp table mangorts_v3_attachment_targets on commit drop as
with candidates as (
  select attachment.resource_attachment_id,
         message.email_message_id,
         relationship.email_relationship_id
  from resource_attachments attachment
  left join email_messages message
    on message.company_id=attachment.company_id
   and message.provider_message_id=coalesce(
     nullif(attachment.message_id,''),
     case when attachment.resource_id ~ '^node:[0-9a-fA-F-]{36}:message:.+$'
       then split_part(attachment.resource_id,':',4)
     end
   )
  left join email_relationships relationship
    on relationship.company_id=message.company_id
   and relationship.email_thread_id=message.email_thread_id
   and relationship.email_message_id=message.email_message_id
   and relationship.resource_type='node'
   and (
     (attachment.information_id is not null and relationship.email_relationship_id=attachment.information_id)
     or (attachment.information_id is null and relationship.resource_id=case
       when attachment.resource_id ~ '^node:[0-9a-fA-F-]{36}:message:'
         then split_part(attachment.resource_id,':',2)::uuid
       when attachment.resource_id ~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         then attachment.resource_id::uuid
       else null
     end)
   )
  where attachment.resource_type='attached_email'
), grouped as (
  select resource_attachment_id,
         count(distinct email_relationship_id) as relationship_count,
         count(distinct email_message_id) as message_count,
         min(email_relationship_id::text) as email_relationship_id,
         min(email_message_id::text) as email_message_id
  from candidates
  group by resource_attachment_id
)
select resource_attachment_id,
       case
         when relationship_count=1 then 'email_relationship'
         when relationship_count=0 and message_count=1 then 'email_message'
       end as target_resource_type,
       case
         when relationship_count=1 then email_relationship_id
         when relationship_count=0 and message_count=1 then email_message_id
       end as target_resource_id
from grouped;

do $$
begin
  if exists (
    select 1 from mangorts_v3_attachment_targets
    where target_resource_type is null or target_resource_id is null
  ) then
    raise exception 'V3 cutover found unmapped or ambiguous attached-email attachment identity';
  end if;
end;
$$;

-- Allow both identities only while the rows are rewritten inside this transaction.
alter table resource_attachments drop constraint resource_attachments_type_chk;
alter table resource_attachments add constraint resource_attachments_type_chk check (
  resource_type in (
    'node','logic_gate','project','node_chat_message','logic_gate_chat_message',
    'project_chat_message','email_message','email_draft','email_signature',
    'attached_email','email_relationship','shared_inbox','company_explorer_folder',
    'shared_inbox_folder'
  )
);
update resource_attachments attachment
set resource_type=target.target_resource_type,
    resource_id=target.target_resource_id
from mangorts_v3_attachment_targets target
where attachment.resource_attachment_id=target.resource_attachment_id;

alter table resource_attachments drop constraint resource_attachments_type_chk;
alter table resource_attachments add constraint resource_attachments_type_chk check (
  resource_type in (
    'node','logic_gate','project','node_chat_message','logic_gate_chat_message',
    'project_chat_message','email_message','email_draft','email_signature',
    'email_relationship','shared_inbox','company_explorer_folder','shared_inbox_folder'
  )
);
alter table attachment_upload_intents
  drop constraint attachment_upload_intents_resource_type_chk;
alter table attachment_upload_intents
  add constraint attachment_upload_intents_resource_type_chk check (
    resource_type in (
      'node','logic_gate','project','node_chat_message','logic_gate_chat_message',
      'project_chat_message','email_message','email_draft','email_signature',
      'email_relationship','shared_inbox','company_explorer_folder','shared_inbox_folder'
    )
  );

-- Final count and ownership validations before retiring source tables.
do $$
begin
  if (select count(*) from node_textbox_chats)
     <> (select count(*) from mangorts_v3_chat_source) then
    raise exception 'V3 cutover Node chat count mismatch';
  end if;
  if (select count(*) from node_textbox_seen_snapshots)
     <> (select count(*)
         from node_projection_seen_snapshots snapshot
         join node_textboxes textbox
           on (textbox.company_id,textbox.node_id,textbox.textbox_id)
            =(snapshot.company_id,snapshot.node_id,snapshot.information_id)) then
    raise exception 'V3 cutover textbox seen snapshot count mismatch';
  end if;
  if (select count(*) from email_drafts)
     <> (select count(*) from communications_email_drafts) then
    raise exception 'V3 cutover email draft count mismatch';
  end if;
  if exists (
    select 1 from mangorts_v3_relationship_candidates candidate
    where not exists (
      select 1 from email_relationships relationship
      join email_messages message
        on message.company_id=relationship.company_id
       and message.email_thread_id=relationship.email_thread_id
       and message.email_message_id=relationship.email_message_id
      where relationship.company_id=candidate.company_id
        and relationship.resource_type=candidate.resource_type
        and relationship.resource_id=candidate.resource_id
        and coalesce(relationship.resource_textbox_id,'')
            =coalesce(candidate.resource_textbox_id,'')
        and message.provider_message_id=candidate.provider_message_id
    )
  ) then
    raise exception 'V3 cutover did not map every legacy email association';
  end if;
  if exists (
    select 1 from email_drafts draft
    join email_relationships relationship
      on relationship.company_id=draft.company_id
     and relationship.email_relationship_id=draft.email_relationship_id
    where draft.mailbox_scope_type='personal'
      and not exists (
        select 1 from email_threads thread
        where thread.company_id=relationship.company_id
          and thread.email_thread_id=relationship.email_thread_id
          and thread.mailbox_scope_type='personal'
          and thread.personal_user_id=draft.personal_user_id
          and thread.personal_account_email=draft.personal_account_email
      )
  ) then
    raise exception 'V3 cutover found a draft whose relationship mailbox ownership differs';
  end if;
end;
$$;

-- Replace source-cleanup triggers before the old draft table is dropped.
drop trigger trg_cleanup_private_email_drafts_personal_source on user_email_connections;
drop trigger trg_cleanup_private_email_drafts_shared_source on shared_inboxes;

create or replace function mangorts_cleanup_private_personal_email_drafts()
returns trigger language plpgsql as $$
begin
  delete from email_drafts
  where email_relationship_id is null
    and mailbox_scope_type='personal'
    and personal_user_id=old.user_id
    and personal_account_email=old.account_email;
  return old;
end;
$$;
create trigger trg_cleanup_private_email_drafts_personal_source
before delete on user_email_connections
for each row execute function mangorts_cleanup_private_personal_email_drafts();

create or replace function mangorts_cleanup_private_shared_email_drafts()
returns trigger language plpgsql as $$
begin
  delete from email_drafts
  where email_relationship_id is null
    and mailbox_scope_type='shared'
    and company_id=old.company_id
    and shared_inbox_id=old.shared_inbox_id;
  return old;
end;
$$;
create trigger trg_cleanup_private_email_drafts_shared_source
before delete on shared_inboxes
for each row execute function mangorts_cleanup_private_shared_email_drafts();

-- Drop sources in dependency order. Direct names make drift fail visibly.
drop table communications_email_drafts;
drop table communications_email_collaboration_participants;
drop table communications_node_email_threads;
drop table communications_email_collaborations;
drop table communications_email_node_attachments;
drop table communications_email_nodes;
drop table node_projection_seen_snapshots;
drop table node_projection_table;
drop table node_information;

-- New Node and Logic Gate read-version triggers.
create trigger trg_node_view_version_textboxes
after insert or update or delete on node_textboxes
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
create trigger trg_node_view_version_textbox_chats
after insert or update or delete on node_textbox_chats
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
create trigger trg_node_view_user_version_textbox_snapshots
after insert or update or delete on node_textbox_seen_snapshots
for each row execute function mangorts_trg_bump_node_view_user_from_snapshot();

create or replace function mangorts_trg_bump_node_view_from_email_relationship()
returns trigger language plpgsql as $$
begin
  if tg_op<>'INSERT' and old.resource_type='node' then
    perform mangorts_bump_node_view_version(old.company_id,old.resource_id);
  end if;
  if tg_op<>'DELETE' and new.resource_type='node' then
    perform mangorts_bump_node_view_version(new.company_id,new.resource_id);
    return new;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function mangorts_trg_bump_logic_gate_work_from_email_relationship()
returns trigger language plpgsql as $$
begin
  if tg_op<>'INSERT' then
    if old.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id,old.resource_id);
    elsif old.resource_type='node' then
      perform mangorts_bump_logic_gate_work_versions_for_node(old.company_id,old.resource_id);
    end if;
  end if;
  if tg_op<>'DELETE' then
    if new.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id,new.resource_id);
    elsif new.resource_type='node' then
      perform mangorts_bump_logic_gate_work_versions_for_node(new.company_id,new.resource_id);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create trigger trg_node_view_version_email_relationships
after insert or update or delete on email_relationships
for each row execute function mangorts_trg_bump_node_view_from_email_relationship();
create trigger trg_logic_gate_work_version_email_relationships
after insert or update or delete on email_relationships
for each row execute function mangorts_trg_bump_logic_gate_work_from_email_relationship();

commit;
