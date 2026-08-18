begin;

lock table project_textboxes,project_textbox_chats,email_relationships,
  node_textboxes,node_textbox_chats
  in share row exclusive mode;

alter table project_textboxes
  add column if not exists color text;

do $$
begin
  if exists (
    select 1 from email_relationships relationship
    where relationship.resource_type='project'
      and relationship.resource_textbox_id=relationship.resource_id::text
  ) or exists (
    select 1 from project_textbox_chats chat
    where chat.textbox_id=chat.project_id::text
  ) or exists (
    select 1 from project_textboxes textbox
    where btrim(textbox.email_message_id)<>''
      and textbox.textbox_id=textbox.project_id::text
  ) then
    raise exception 'permanent Project documents contain email or chat work; remove that invalid work before migration'
      using errcode='23514';
  end if;
  if exists (
    select 1 from project_textboxes textbox
    where textbox.deleted_timestamp is not null
      and btrim(textbox.email_message_id)<>''
  ) then
    raise exception 'deleted Project textboxes retain legacy email identity; restore or clear those obsolete copies before migration'
      using errcode='23514';
  end if;
  if exists (
    select 1 from email_relationships relationship
    where relationship.resource_type in ('node','project')
      and relationship.resource_textbox_id is not null
      and (
        (relationship.resource_type='node' and not exists (
          select 1 from node_textboxes textbox
          where textbox.company_id=relationship.company_id
            and textbox.node_id=relationship.resource_id
            and textbox.textbox_id::text=relationship.resource_textbox_id
            and textbox.deleted_timestamp is null
        ))
        or (relationship.resource_type='project' and not exists (
          select 1 from project_textboxes textbox
          where textbox.company_id=relationship.company_id
            and textbox.project_id=relationship.resource_id
            and textbox.textbox_id=relationship.resource_textbox_id
            and textbox.deleted_timestamp is null
        ))
      )
  ) then
    raise exception 'email relationship targets a missing or deleted owner textbox'
      using errcode='23514';
  end if;
  if exists (
    select 1 from node_textbox_chats chat
    where chat.deleted_timestamp is null and not exists (
      select 1 from node_textboxes textbox
      where textbox.company_id=chat.company_id and textbox.node_id=chat.node_id
        and textbox.textbox_id=chat.textbox_id and textbox.deleted_timestamp is null
    )
  ) or exists (
    select 1 from project_textbox_chats chat
    where chat.deleted_timestamp is null and not exists (
      select 1 from project_textboxes textbox
      where textbox.company_id=chat.company_id and textbox.project_id=chat.project_id
        and textbox.textbox_id=chat.textbox_id and textbox.deleted_timestamp is null
    )
  ) then
    raise exception 'active email chat targets a missing or deleted owner textbox'
      using errcode='23514';
  end if;
  if exists (
    select relationship.company_id,relationship.email_message_id,
           relationship.resource_type,relationship.resource_id
    from email_relationships relationship
    where relationship.resource_type in ('node','project')
      and relationship.resource_textbox_id is not null
    group by relationship.company_id,relationship.email_message_id,
             relationship.resource_type,relationship.resource_id
    having count(distinct relationship.resource_textbox_id)>1
  ) then
    raise exception 'existing email relationships conflict with one-message-per-owner cardinality'
      using errcode='23514';
  end if;
  if exists (
    select 1 from node_textbox_chats chat
    where chat.selection_source='email' and chat.deleted_timestamp is null
      and not exists (
        select 1 from email_relationships relationship
        where relationship.company_id=chat.company_id
          and relationship.resource_type='node'
          and relationship.resource_id=chat.node_id
          and relationship.resource_textbox_id=chat.textbox_id::text
          and relationship.email_message_id=chat.selection_email_message_id
      )
  ) then
    raise exception 'Node email chat is missing its exact message textbox relationship'
      using errcode='23514';
  end if;
  if exists (
    select 1
    from project_textboxes textbox
    where textbox.deleted_timestamp is null
      and btrim(textbox.email_message_id)<>''
      and (
        not pg_input_is_valid(btrim(textbox.email_message_id),'uuid')
        or not exists (
          select 1 from email_messages message
          where message.company_id=textbox.company_id
            and message.email_message_id=case
              when pg_input_is_valid(btrim(textbox.email_message_id),'uuid')
              then btrim(textbox.email_message_id)::uuid
            end
        )
      )
  ) then
    raise exception 'Project textbox legacy email_message_id is not an exact internal message identity'
      using errcode='23514';
  end if;
  if exists (
    select claim.company_id,claim.project_id,claim.email_message_id
    from (
      select textbox.company_id,textbox.project_id,textbox.textbox_id,
             btrim(textbox.email_message_id)::uuid as email_message_id
      from project_textboxes textbox
      where textbox.deleted_timestamp is null
        and btrim(textbox.email_message_id)<>''
      union all
      select relationship.company_id,relationship.resource_id,
             relationship.resource_textbox_id,relationship.email_message_id
      from email_relationships relationship
      where relationship.resource_type='project'
        and relationship.resource_textbox_id is not null
      union all
      select chat.company_id,chat.project_id,chat.textbox_id,chat.selection_email_message_id
      from project_textbox_chats chat
      where chat.selection_source='email' and chat.deleted_timestamp is null
    ) claim
    group by claim.company_id,claim.project_id,claim.email_message_id
    having count(distinct claim.textbox_id)>1
  ) then
    raise exception 'Project email work conflicts with one-message-per-owner cardinality'
      using errcode='23514';
  end if;
  if exists (
    select 1 from project_textbox_chats chat
    where chat.selection_source='email' and chat.deleted_timestamp is null
      and not exists (
        select 1 from email_messages message
        where message.company_id=chat.company_id
          and message.email_message_id=chat.selection_email_message_id
      )
  ) then
    raise exception 'Project email chat does not reference an internal message identity'
      using errcode='23514';
  end if;
end;
$$;

-- Preserve every existing exact Node or Project edge by supplying its canonical wide
-- owner/thread edge before the new invariant is enabled.
insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select exact.company_id,gen_random_uuid(),exact.email_thread_id,exact.email_message_id,
       exact.resource_type,exact.resource_id,null,exact.created_timestamp
from email_relationships exact
where exact.resource_type in ('node','project')
  and exact.resource_textbox_id is not null
  and not exists (
    select 1 from email_relationships wide
    where wide.company_id=exact.company_id
      and wide.email_thread_id=exact.email_thread_id
      and wide.resource_type=exact.resource_type
      and wide.resource_id=exact.resource_id
      and wide.resource_textbox_id is null
  )
on conflict do nothing;

-- Convert the retired Project textbox identity copy into the canonical typed edges.
insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select textbox.company_id,gen_random_uuid(),message.email_thread_id,message.email_message_id,
       'project',textbox.project_id,null,textbox.created_timestamp
from project_textboxes textbox
join email_messages message
  on message.company_id=textbox.company_id
 and message.email_message_id=btrim(textbox.email_message_id)::uuid
where btrim(textbox.email_message_id)<>''
  and textbox.deleted_timestamp is null
  and not exists (
    select 1 from email_relationships wide
    where wide.company_id=textbox.company_id
      and wide.email_thread_id=message.email_thread_id
      and wide.resource_type='project'
      and wide.resource_id=textbox.project_id
      and wide.resource_textbox_id is null
  )
on conflict do nothing;

insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select textbox.company_id,gen_random_uuid(),message.email_thread_id,message.email_message_id,
       'project',textbox.project_id,textbox.textbox_id,textbox.created_timestamp
from project_textboxes textbox
join email_messages message
  on message.company_id=textbox.company_id
 and message.email_message_id=btrim(textbox.email_message_id)::uuid
where textbox.deleted_timestamp is null
  and btrim(textbox.email_message_id)<>''
on conflict do nothing;

-- An existing Project email chat is itself an exact textbox claim. Preserve it
-- by creating the same canonical wide + exact edges before enabling validation.
insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select chat.company_id,gen_random_uuid(),message.email_thread_id,message.email_message_id,
       'project',chat.project_id,null,chat.created_timestamp
from project_textbox_chats chat
join email_messages message
  on message.company_id=chat.company_id
 and message.email_message_id=chat.selection_email_message_id
where chat.selection_source='email' and chat.deleted_timestamp is null
  and not exists (
    select 1 from email_relationships wide
    where wide.company_id=chat.company_id
      and wide.email_thread_id=message.email_thread_id
      and wide.resource_type='project'
      and wide.resource_id=chat.project_id
      and wide.resource_textbox_id is null
  )
on conflict do nothing;

insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select chat.company_id,gen_random_uuid(),message.email_thread_id,message.email_message_id,
       'project',chat.project_id,chat.textbox_id,chat.created_timestamp
from project_textbox_chats chat
join email_messages message
  on message.company_id=chat.company_id
 and message.email_message_id=chat.selection_email_message_id
where chat.selection_source='email' and chat.deleted_timestamp is null
on conflict do nothing;

update project_textboxes textbox
set color=case upper(btrim(textbox.email_accent))
  when '#0EA5E9' then '#0EA5E9'
  when '#14B8A6' then '#14B8A6'
  when '#8B5CF6' then '#8B5CF6'
  when '#F59E0B' then '#F59E0B'
  when '#22C55E' then '#22C55E'
  when '#6366F1' then '#6366F1'
  when '#06B6D4' then '#06B6D4'
  when '#84CC16' then '#84CC16'
  when '#A855F7' then '#A855F7'
  when '#10B981' then '#10B981'
  when '#EAB308' then '#EAB308'
  when '#3B82F6' then '#3B82F6'
  else '#0EA5E9'
end
where exists (
  select 1 from email_relationships relationship
  where relationship.company_id=textbox.company_id
    and relationship.resource_type='project'
    and relationship.resource_id=textbox.project_id
    and relationship.resource_textbox_id=textbox.textbox_id
);

update project_textboxes textbox
set color=null
where not exists (
  select 1 from email_relationships relationship
  where relationship.company_id=textbox.company_id
    and relationship.resource_type='project'
    and relationship.resource_id=textbox.project_id
    and relationship.resource_textbox_id=textbox.textbox_id
);

alter table project_textboxes
  drop constraint if exists project_textboxes_email_accent_chk,
  drop constraint if exists project_textboxes_color_chk,
  add constraint project_textboxes_color_chk check (color is null or color in (
    '#0EA5E9', '#14B8A6', '#8B5CF6', '#F59E0B', '#22C55E', '#6366F1',
    '#06B6D4', '#84CC16', '#A855F7', '#10B981', '#EAB308', '#3B82F6'
  )),
  drop column if exists email_message_id,
  drop column if exists email_accent;

comment on column project_textboxes.color is
  'Optional non-red RGB color used only when this exact Project textbox has an email relationship.';

drop index if exists idx_email_relationships_one_node_textbox_per_message;
drop index if exists idx_email_relationships_one_project_textbox_per_message;
create unique index idx_email_relationships_one_textbox_per_message_owner
  on email_relationships(company_id,email_message_id,resource_type,resource_id)
  where resource_type in ('node','project') and resource_textbox_id is not null;

create or replace function mangorts_validate_email_textbox_relationship_has_wide_owner()
returns trigger language plpgsql as $$
begin
  if new.resource_type in ('node','project') and new.resource_textbox_id is not null then
    perform 1
    from email_relationships wide
    where wide.company_id=new.company_id
      and wide.email_thread_id=new.email_thread_id
      and wide.resource_type=new.resource_type
      and wide.resource_id=new.resource_id
      and wide.resource_textbox_id is null
    order by wide.created_timestamp,wide.email_relationship_id
    limit 1
    for share;
    if not found then
      raise exception 'email textbox relationship requires a wide owner relationship'
        using errcode='23503', constraint='email_textbox_relationship_requires_wide';
    end if;
  end if;
  return new;
end;
$$;

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
    if new.resource_textbox_id is not null and new.resource_textbox_id=new.resource_id::text then
      raise exception 'permanent Project document cannot own an email textbox relationship'
        using errcode='23514', constraint='email_relationship_project_document_forbidden';
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

drop trigger if exists trg_validate_email_textbox_relationship_has_wide_owner on email_relationships;
create constraint trigger trg_validate_email_textbox_relationship_has_wide_owner
after insert or update of company_id,email_thread_id,resource_type,resource_id,resource_textbox_id
on email_relationships deferrable initially immediate
for each row execute function mangorts_validate_email_textbox_relationship_has_wide_owner();

create or replace function mangorts_validate_node_email_chat_relationship()
returns trigger language plpgsql as $$
begin
  if new.selection_source='email' and new.deleted_timestamp is null then
    perform 1
    from email_relationships relationship
    where relationship.company_id=new.company_id
      and relationship.resource_type='node'
      and relationship.resource_id=new.node_id
      and relationship.resource_textbox_id=new.textbox_id::text
      and relationship.email_message_id=new.selection_email_message_id
    limit 1
    for share;
    if not found then
      raise exception 'email chat requires exact Node message textbox relationship'
        using errcode='23503', constraint='email_chat_requires_exact_textbox_relationship';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_node_email_chat_relationship on node_textbox_chats;
create constraint trigger trg_validate_node_email_chat_relationship
after insert or update of company_id,node_id,textbox_id,selection_source,selection_email_message_id,deleted_timestamp
on node_textbox_chats deferrable initially immediate
for each row execute function mangorts_validate_node_email_chat_relationship();

create or replace function mangorts_validate_project_email_chat_relationship()
returns trigger language plpgsql as $$
begin
  if new.textbox_id=new.project_id::text then
    raise exception 'permanent Project document cannot own a chat'
      using errcode='23514', constraint='project_document_chat_forbidden';
  end if;
  if new.selection_source='email' and new.deleted_timestamp is null then
    perform 1
    from email_relationships relationship
    where relationship.company_id=new.company_id
      and relationship.resource_type='project'
      and relationship.resource_id=new.project_id
      and relationship.resource_textbox_id=new.textbox_id
      and relationship.email_message_id=new.selection_email_message_id
    limit 1
    for share;
    if not found then
      raise exception 'email chat requires exact Project message textbox relationship'
        using errcode='23503', constraint='email_chat_requires_exact_textbox_relationship';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_project_email_chat_relationship on project_textbox_chats;
create constraint trigger trg_validate_project_email_chat_relationship
after insert or update of company_id,project_id,textbox_id,selection_source,selection_email_message_id,deleted_timestamp
on project_textbox_chats deferrable initially immediate
for each row execute function mangorts_validate_project_email_chat_relationship();

create or replace function mangorts_protect_email_relationship_dependencies()
returns trigger language plpgsql as $$
begin
  if old.resource_type not in ('node','project') then
    return old;
  end if;
  if old.resource_textbox_id is not null
     and not exists (
       select 1 from email_relationships relationship
       where relationship.company_id=old.company_id
         and relationship.email_relationship_id<>old.email_relationship_id
         and relationship.resource_type=old.resource_type
         and relationship.resource_id=old.resource_id
         and relationship.resource_textbox_id=old.resource_textbox_id
         and relationship.email_message_id=old.email_message_id
     )
     and (
       (old.resource_type='node' and exists (
         select 1 from node_textbox_chats chat
         where chat.company_id=old.company_id and chat.node_id=old.resource_id
           and chat.textbox_id::text=old.resource_textbox_id
           and chat.selection_source='email'
           and chat.selection_email_message_id=old.email_message_id
           and chat.deleted_timestamp is null
       ))
       or (old.resource_type='project' and exists (
         select 1 from project_textbox_chats chat
         where chat.company_id=old.company_id and chat.project_id=old.resource_id
           and chat.textbox_id=old.resource_textbox_id
           and chat.selection_source='email'
           and chat.selection_email_message_id=old.email_message_id
           and chat.deleted_timestamp is null
       ))
     ) then
    raise exception 'email relationship is required by an active chat'
      using errcode='23503', constraint='email_relationship_required_by_chat';
  end if;
  if old.resource_textbox_id is null and (
    exists (
      select 1 from email_relationships relationship
      where relationship.company_id=old.company_id
        and relationship.email_thread_id=old.email_thread_id
        and relationship.resource_type=old.resource_type
        and relationship.resource_id=old.resource_id
        and relationship.resource_textbox_id is not null
    )
    or (old.resource_type='node' and exists (
      select 1 from node_textbox_chats chat
      join email_messages message on message.company_id=chat.company_id
       and message.email_message_id=chat.selection_email_message_id
      where chat.company_id=old.company_id and chat.node_id=old.resource_id
        and chat.selection_source='email' and chat.deleted_timestamp is null
        and message.email_thread_id=old.email_thread_id
    ))
    or (old.resource_type='project' and exists (
      select 1 from project_textbox_chats chat
      join email_messages message on message.company_id=chat.company_id
       and message.email_message_id=chat.selection_email_message_id
      where chat.company_id=old.company_id and chat.project_id=old.resource_id
        and chat.selection_source='email' and chat.deleted_timestamp is null
        and message.email_thread_id=old.email_thread_id
    ))
  ) then
    raise exception 'wide email relationship is required by owner textbox work'
      using errcode='23503', constraint='email_wide_relationship_required_by_textbox_work';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_protect_node_email_chat_relationship on email_relationships;
drop trigger if exists trg_protect_email_relationship_dependencies on email_relationships;
drop function if exists mangorts_protect_node_email_chat_relationship();
create constraint trigger trg_protect_email_relationship_dependencies
after delete or update of company_id,email_thread_id,email_message_id,resource_type,resource_id,resource_textbox_id
on email_relationships deferrable initially deferred
for each row execute function mangorts_protect_email_relationship_dependencies();

commit;
