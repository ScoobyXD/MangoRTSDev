begin;

set local lock_timeout = '5s';

select current_setting('server_version') as postgresql_server_version,
       current_setting('server_version_num')::integer as postgresql_server_version_num;

do $$
declare
  actual_columns text[];
begin
  if current_setting('server_version_num')::integer not between 170000 and 189999 then
    raise exception 'STOP: unsupported_postgresql_server_version';
  end if;
  if to_regclass('public.email_relationships') is null
     or to_regclass('public.email_messages') is null
     or to_regclass('public.email_threads') is null
     or to_regclass('public.email_drafts') is null
     or to_regclass('public.node_textboxes') is null
     or to_regclass('public.node_textbox_chats') is null
     or to_regclass('public.nodes') is null
     or to_regclass('public.node_logic_gate_assignments') is null then
    raise exception 'STOP: required_email_or_node_table_missing';
  end if;

  select array_agg(attname) into actual_columns
  from pg_attribute
  where attrelid='public.email_relationships'::regclass and attnum>0 and not attisdropped;
  if cardinality(actual_columns)<>8 or not actual_columns @> array[
    'company_id','created_timestamp','email_message_id','email_relationship_id',
    'email_thread_id','resource_id','resource_textbox_id','resource_type'
  ]::text[] then
    raise exception 'STOP: email_relationships exact column set drifted';
  end if;

  select array_agg(attname) into actual_columns
  from pg_attribute
  where attrelid='public.node_textbox_chats'::regclass and attnum>0 and not attisdropped;
  if cardinality(actual_columns)<>22 or not actual_columns @> array[
    'author_display_name','author_user_id','chat_id','company_id','created_timestamp',
    'deleted_timestamp','edited_timestamp','entity_links','mentioned_group_ids',
    'mentioned_user_ids','message','node_id','parent_chat_id','revision',
    'selection_email_message_id','selection_end','selection_quote','selection_source',
    'selection_start','selection_textbox_id','textbox_id','updated_timestamp'
  ]::text[] then
    raise exception 'STOP: node_textbox_chats exact column set drifted';
  end if;
end;
$$;

lock table email_relationships in share row exclusive mode;
lock table node_textbox_chats in share row exclusive mode;
lock table email_drafts in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from email_relationships relationship
    where relationship.resource_type='node'
      and relationship.resource_textbox_id is not null
    group by relationship.company_id,relationship.resource_id,relationship.email_message_id
    having count(distinct relationship.resource_textbox_id)>1
  ) then
    raise exception 'STOP: email_message_linked_to_multiple_textboxes_in_one_node';
  end if;

  if exists (
    select 1
    from node_textbox_chats chat
    where chat.selection_source='email'
      and chat.deleted_timestamp is null
      and not exists (
        select 1
        from email_relationships relationship
        where relationship.company_id=chat.company_id
          and relationship.resource_type='node'
          and relationship.resource_id=chat.node_id
          and relationship.resource_textbox_id=chat.textbox_id::text
          and relationship.email_message_id=chat.selection_email_message_id
      )
  ) then
    raise exception 'STOP: email_chat_missing_exact_textbox_relationship';
  end if;

  if exists (
    select 1
    from email_relationships relationship
    group by relationship.company_id,relationship.email_message_id,
             relationship.resource_type,relationship.resource_id,
             coalesce(relationship.resource_textbox_id,'')
    having count(*)>1
  ) then
    raise exception 'STOP: duplicate_email_semantic_edge';
  end if;
end;
$$;

drop trigger if exists trg_node_logic_gate_assignment_priority on node_logic_gate_assignments;
drop function if exists enforce_node_logic_gate_assignment_priority();

drop trigger if exists trg_email_relationships_one_node_per_thread on email_relationships;
drop function if exists mangorts_enforce_one_node_per_email_thread();

create unique index if not exists idx_email_relationships_active_identity
  on email_relationships(
    company_id,email_message_id,resource_type,resource_id,
    coalesce(resource_textbox_id,'')
  );

create unique index if not exists idx_email_relationships_one_node_textbox_per_message
  on email_relationships(company_id,email_message_id,resource_id)
  where resource_type='node' and resource_textbox_id is not null;

create or replace function mangorts_validate_node_email_chat_relationship()
returns trigger language plpgsql as $$
begin
  if new.selection_source='email' and new.deleted_timestamp is null and not exists (
    select 1 from email_relationships relationship
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
    select 1 from node_textbox_chats chat
    where chat.company_id=old.company_id and chat.node_id=old.resource_id
      and chat.textbox_id::text=old.resource_textbox_id
      and chat.selection_source='email'
      and chat.selection_email_message_id=old.email_message_id
      and chat.deleted_timestamp is null
  ) and not exists (
    select 1 from email_relationships relationship
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

alter table email_drafts add column if not exists email_thread_id uuid;
alter table email_drafts add column if not exists origin_node_id uuid;

do $$
declare
  unresolved_drafts bigint;
begin
  if exists (
    select 1 from pg_attribute
    where attrelid='public.email_drafts'::regclass
      and attname='email_relationship_id' and attnum>0 and not attisdropped
  ) then
    execute $sql$
      update email_drafts draft
      set email_thread_id=relationship.email_thread_id
      from email_relationships relationship
      where draft.company_id=relationship.company_id
        and draft.email_relationship_id=relationship.email_relationship_id
        and draft.email_thread_id is null
    $sql$;
    execute 'select count(*) from email_drafts where email_relationship_id is not null and email_thread_id is null'
      into unresolved_drafts;
    if unresolved_drafts<>0 then
      raise exception 'STOP: shared_draft_thread_backfill_failed';
    end if;
  end if;
  if exists (
    select 1 from email_drafts
    where deleted_timestamp is null and email_thread_id is not null
    group by company_id,email_thread_id having count(*)>1
  ) then
    raise exception 'STOP: multiple_active_shared_drafts_for_thread';
  end if;
end;
$$;

alter table email_drafts drop constraint if exists email_drafts_email_relationship_id_fkey;
alter table email_drafts drop constraint if exists email_drafts_collaboration_fkey;
drop index if exists idx_email_drafts_relationship_updated;
alter table email_drafts drop column if exists email_relationship_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.email_drafts'::regclass
      and conname='email_drafts_email_thread_fkey'
  ) then
    alter table email_drafts
      add constraint email_drafts_email_thread_fkey
      foreign key(company_id,email_thread_id)
      references email_threads(company_id,email_thread_id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.email_drafts'::regclass
      and conname='email_drafts_origin_node_fkey'
  ) then
    alter table email_drafts
      add constraint email_drafts_origin_node_fkey
      foreign key(company_id,origin_node_id)
      references nodes(company_id,node_id) on delete set null (origin_node_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.email_drafts'::regclass
      and conname='email_drafts_origin_node_chk'
  ) then
    alter table email_drafts
      add constraint email_drafts_origin_node_chk
      check(origin_node_id is null or email_thread_id is not null);
  end if;
end;
$$;

create unique index if not exists idx_email_drafts_active_thread
  on email_drafts(company_id,email_thread_id)
  where deleted_timestamp is null and email_thread_id is not null;
create index if not exists idx_email_drafts_origin_node
  on email_drafts(company_id,origin_node_id,updated_timestamp desc)
  where deleted_timestamp is null and origin_node_id is not null;

commit;

select 'NODE_PRIORITY_NOT_ASSIGNED_COMPLETE' as status,
       current_setting('server_version') as postgresql_server_version,
       (
         select count(*) from (
           select company_id,email_thread_id
           from email_relationships
           where resource_type='node'
           group by company_id,email_thread_id
           having count(distinct resource_id)>1
         ) valid_multi_node_thread
       ) as valid_multi_node_email_threads,
       (
         select count(*) from (
           select company_id,resource_id,email_message_id
           from email_relationships
           where resource_type='node' and resource_textbox_id is not null
           group by company_id,resource_id,email_message_id
           having count(distinct resource_textbox_id)>1
         ) invalid_multi_textbox_messages
       ) as invalid_multi_textbox_email_messages;
