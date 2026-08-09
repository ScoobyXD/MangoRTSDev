begin;

set local lock_timeout = '5s';

select current_setting('server_version') as postgresql_server_version,
       current_setting('server_version_num')::integer as postgresql_server_version_num;

do $$
begin
  if current_setting('server_version_num')::integer not between 170000 and 189999 then
    raise exception 'unsupported_postgresql_server_version';
  end if;
end;
$$;

lock table email_relationships in share row exclusive mode;
lock table node_textbox_chats in share mode;

create temporary table mangorts_email_thread_canonical_nodes
on commit drop
as
with destinations as (
  select relationship.company_id,
         relationship.email_thread_id,
         relationship.resource_id as node_id,
         min(relationship.created_timestamp) as first_created_timestamp,
         min(relationship.email_relationship_id::text)::uuid as first_relationship_id
  from email_relationships relationship
  where relationship.resource_type='node'
  group by relationship.company_id,relationship.email_thread_id,relationship.resource_id
), ranked as (
  select destination.*,
         row_number() over (
           partition by destination.company_id,destination.email_thread_id
           order by destination.first_created_timestamp,
                    destination.first_relationship_id,
                    destination.node_id
         ) as destination_rank
  from destinations destination
)
select company_id,email_thread_id,node_id
from ranked
where destination_rank=1;

alter table mangorts_email_thread_canonical_nodes
  add primary key(company_id,email_thread_id);

do $$
begin
  if exists (
    select 1
    from node_textbox_chats chat
    join email_messages message
      on message.company_id=chat.company_id
     and message.email_message_id=chat.selection_email_message_id
    join mangorts_email_thread_canonical_nodes canonical
      on canonical.company_id=message.company_id
     and canonical.email_thread_id=message.email_thread_id
    where chat.selection_source='email'
      and chat.deleted_timestamp is null
      and chat.node_id<>canonical.node_id
  ) then
    raise exception 'email_chat_linked_to_later_node_requires_review';
  end if;
end;
$$;

delete from email_relationships relationship
using mangorts_email_thread_canonical_nodes canonical
where relationship.company_id=canonical.company_id
  and relationship.email_thread_id=canonical.email_thread_id
  and relationship.resource_type='node'
  and relationship.resource_id<>canonical.node_id;

do $$
begin
  if exists (
    select 1
    from node_textbox_chats chat
    where chat.selection_source='email'
      and chat.selection_email_message_id is not null
      and chat.deleted_timestamp is null
    group by chat.company_id,chat.node_id,chat.selection_email_message_id
    having count(distinct chat.textbox_id)>1
  ) then
    raise exception 'email_message_chat_linked_to_multiple_textboxes';
  end if;
end;
$$;

create temporary table mangorts_email_message_preferred_textboxes
on commit drop
as
with chat_targets as (
  select chat.company_id,
         chat.node_id,
         chat.selection_email_message_id as email_message_id,
         min(chat.textbox_id::text) as textbox_id
  from node_textbox_chats chat
  where chat.selection_source='email'
    and chat.selection_email_message_id is not null
    and chat.deleted_timestamp is null
  group by chat.company_id,chat.node_id,chat.selection_email_message_id
), ranked_existing as (
  select relationship.company_id,
         relationship.resource_id as node_id,
         relationship.email_message_id,
         relationship.resource_textbox_id as textbox_id,
         row_number() over (
           partition by relationship.company_id,
                        relationship.resource_id,
                        relationship.email_message_id
           order by relationship.created_timestamp,
                    relationship.email_relationship_id,
                    relationship.resource_textbox_id
         ) as textbox_rank
  from email_relationships relationship
  where relationship.resource_type='node'
    and relationship.resource_textbox_id is not null
)
select target.company_id,target.node_id,target.email_message_id,target.textbox_id
from chat_targets target
union all
select existing.company_id,existing.node_id,existing.email_message_id,existing.textbox_id
from ranked_existing existing
where existing.textbox_rank=1
  and not exists (
    select 1
    from chat_targets target
    where target.company_id=existing.company_id
      and target.node_id=existing.node_id
      and target.email_message_id=existing.email_message_id
  );

alter table mangorts_email_message_preferred_textboxes
  add primary key(company_id,node_id,email_message_id);

delete from email_relationships relationship
using mangorts_email_message_preferred_textboxes preferred
where relationship.company_id=preferred.company_id
  and relationship.resource_type='node'
  and relationship.resource_id=preferred.node_id
  and relationship.email_message_id=preferred.email_message_id
  and relationship.resource_textbox_id is not null
  and relationship.resource_textbox_id<>preferred.textbox_id;

insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select distinct
       chat.company_id,
       gen_random_uuid(),
       message.email_thread_id,
       chat.selection_email_message_id,
       'node',
       chat.node_id,
       chat.textbox_id::text,
       chat.created_timestamp
from node_textbox_chats chat
join email_messages message
  on message.company_id=chat.company_id
 and message.email_message_id=chat.selection_email_message_id
join mangorts_email_thread_canonical_nodes canonical
  on canonical.company_id=message.company_id
 and canonical.email_thread_id=message.email_thread_id
 and canonical.node_id=chat.node_id
where chat.selection_source='email'
  and chat.selection_email_message_id is not null
  and chat.deleted_timestamp is null
on conflict do nothing;

do $$
begin
  if exists (
    select 1
    from email_relationships relationship
    where relationship.resource_type='node'
    group by relationship.company_id,relationship.email_thread_id
    having count(distinct relationship.resource_id)>1
  ) then
    raise exception 'email_thread_still_linked_to_multiple_nodes';
  end if;

  if exists (
    select 1
    from email_relationships relationship
    where relationship.resource_type='node'
      and relationship.resource_textbox_id is not null
    group by relationship.company_id,
             relationship.resource_id,
             relationship.email_message_id
    having count(distinct relationship.resource_textbox_id)>1
  ) then
    raise exception 'email_message_still_linked_to_multiple_textboxes';
  end if;

  if exists (
    select 1
    from node_textbox_chats chat
    where chat.selection_source='email'
      and chat.selection_email_message_id is not null
      and chat.deleted_timestamp is null
      and not exists (
        select 1
        from email_relationships relationship
        where relationship.company_id=chat.company_id
          and relationship.email_message_id=chat.selection_email_message_id
          and relationship.resource_type='node'
          and relationship.resource_id=chat.node_id
          and relationship.resource_textbox_id=chat.textbox_id::text
      )
  ) then
    raise exception 'email_chat_missing_exact_textbox_relationship';
  end if;
end;
$$;

drop trigger if exists trg_node_logic_gate_assignment_priority on node_logic_gate_assignments;
drop function if exists enforce_node_logic_gate_assignment_priority();

create or replace function mangorts_enforce_one_node_per_email_thread()
returns trigger language plpgsql as $$
begin
  if new.resource_type <> 'node' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.company_id::text || ':' || new.email_thread_id::text, 0)
  );

  if exists (
    select 1
    from email_relationships relationship
    where relationship.company_id=new.company_id
      and relationship.email_thread_id=new.email_thread_id
      and relationship.resource_type='node'
      and relationship.resource_id<>new.resource_id
      and relationship.email_relationship_id<>new.email_relationship_id
  ) then
    raise exception 'email_thread_already_linked_to_another_node' using errcode='23505';
  end if;

  if new.resource_textbox_id is not null and exists (
    select 1
    from email_relationships relationship
    where relationship.company_id=new.company_id
      and relationship.email_message_id=new.email_message_id
      and relationship.resource_type='node'
      and relationship.resource_id=new.resource_id
      and relationship.resource_textbox_id is not null
      and relationship.resource_textbox_id<>new.resource_textbox_id
      and relationship.email_relationship_id<>new.email_relationship_id
  ) then
    raise exception 'email_message_already_linked_to_another_textbox' using errcode='23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_email_relationships_one_node_per_thread on email_relationships;
create trigger trg_email_relationships_one_node_per_thread
before insert or update of company_id,email_thread_id,email_message_id,resource_type,resource_id,resource_textbox_id
on email_relationships
for each row execute function mangorts_enforce_one_node_per_email_thread();

commit;

select 'NODE_PRIORITY_NOT_ASSIGNED_COMPLETE' as status,
       current_setting('server_version') as postgresql_server_version,
       (
         select count(*)
         from (
           select relationship.company_id,relationship.email_thread_id
           from email_relationships relationship
           where relationship.resource_type='node'
           group by relationship.company_id,relationship.email_thread_id
           having count(distinct relationship.resource_id)>1
         ) conflict
       ) as multi_node_email_threads,
       (
         select count(*)
         from (
           select relationship.company_id,
                  relationship.resource_id,
                  relationship.email_message_id
           from email_relationships relationship
           where relationship.resource_type='node'
             and relationship.resource_textbox_id is not null
           group by relationship.company_id,
                    relationship.resource_id,
                    relationship.email_message_id
           having count(distinct relationship.resource_textbox_id)>1
         ) conflict
       ) as multi_textbox_email_messages;
