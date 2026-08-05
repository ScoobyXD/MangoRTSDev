-- Run in DBeaver while Project writes are paused, after the additive schema
-- migration and before deploying the Project final-storage backend.
-- This copies textbox metadata only. Project chat and email rows must already
-- be present in their final tables. This script does not drop legacy tables.

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only;

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: this cutover supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;
end
$$;

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $$
begin
  if to_regclass('public.project_projection_table') is null
     or to_regclass('public.project_textboxes') is null
     or to_regclass('public.project_textbox_chats') is null
     or to_regclass('public.email_relationships') is null then
    raise exception 'STOP: required Project cutover table is missing';
  end if;

  if (select count(*) from pg_attribute
      where attrelid='public.project_projection_table'::regclass
        and attnum>0 and not attisdropped)<>7
     or exists (
       (values ('company_id'),('created_timestamp'),('information'),('information_id'),
               ('project_id'),('type'),('updated_timestamp'))
       except
       select attname from pg_attribute
       where attrelid='public.project_projection_table'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname from pg_attribute
       where attrelid='public.project_projection_table'::regclass
         and attnum>0 and not attisdropped
       except
       values ('company_id'),('created_timestamp'),('information'),('information_id'),
              ('project_id'),('type'),('updated_timestamp')
     ) then
    raise exception 'STOP: project_projection_table column set drifted';
  end if;

  if (select count(*) from pg_attribute
      where attrelid='public.project_textboxes'::regclass
        and attnum>0 and not attisdropped)<>13
     or exists (
       (values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
               ('display_order'),('email_accent'),('email_message_id'),('metadata_revision'),
               ('project_id'),('revision'),('textbox_id'),('title'),('updated_timestamp'))
       except
       select attname from pg_attribute
       where attrelid='public.project_textboxes'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname from pg_attribute
       where attrelid='public.project_textboxes'::regclass
         and attnum>0 and not attisdropped
       except
       values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
              ('display_order'),('email_accent'),('email_message_id'),('metadata_revision'),
              ('project_id'),('revision'),('textbox_id'),('title'),('updated_timestamp')
     ) then
    raise exception 'STOP: project_textboxes final column set drifted';
  end if;

  if (select count(*) from pg_attribute
      where attrelid='public.project_textbox_chats'::regclass
        and attnum>0 and not attisdropped)<>22
     or exists (
       (values ('author_display_name'),('author_user_id'),('chat_id'),('company_id'),
               ('created_timestamp'),('deleted_timestamp'),('edited_timestamp'),('entity_links'),
               ('mentioned_group_ids'),('mentioned_user_ids'),('message'),('parent_chat_id'),
               ('project_id'),('revision'),('selection_email_message_id'),('selection_end'),
               ('selection_quote'),('selection_source'),('selection_start'),
               ('selection_textbox_id'),('textbox_id'),('updated_timestamp'))
       except
       select attname from pg_attribute
       where attrelid='public.project_textbox_chats'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname from pg_attribute
       where attrelid='public.project_textbox_chats'::regclass
         and attnum>0 and not attisdropped
       except
       values ('author_display_name'),('author_user_id'),('chat_id'),('company_id'),
              ('created_timestamp'),('deleted_timestamp'),('edited_timestamp'),('entity_links'),
              ('mentioned_group_ids'),('mentioned_user_ids'),('message'),('parent_chat_id'),
              ('project_id'),('revision'),('selection_email_message_id'),('selection_end'),
              ('selection_quote'),('selection_source'),('selection_start'),
              ('selection_textbox_id'),('textbox_id'),('updated_timestamp')
     ) then
    raise exception 'STOP: project_textbox_chats column set drifted';
  end if;

  if (select count(*) from pg_attribute
      where attrelid='public.email_relationships'::regclass
        and attnum>0 and not attisdropped)<>8
     or exists (
       (values ('company_id'),('created_timestamp'),('email_message_id'),
               ('email_relationship_id'),('email_thread_id'),('resource_id'),
               ('resource_textbox_id'),('resource_type'))
       except
       select attname from pg_attribute
       where attrelid='public.email_relationships'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname from pg_attribute
       where attrelid='public.email_relationships'::regclass
         and attnum>0 and not attisdropped
       except
       values ('company_id'),('created_timestamp'),('email_message_id'),
              ('email_relationship_id'),('email_thread_id'),('resource_id'),
              ('resource_textbox_id'),('resource_type')
     ) then
    raise exception 'STOP: email_relationships column set drifted';
  end if;

  if (select count(*) from project_projection_table where type::text='Text box')<>25
     or (select count(*) from project_textboxes where deleted_timestamp is null)<>25
     or (select count(*) from project_projection_table where type::text='Text block chat')<>16
     or (select count(*) from project_textbox_chats where deleted_timestamp is null)<>16
     or (select count(*) from project_projection_table where type::text='Attached email')<>6
     or (select count(*) from email_relationships where resource_type='project')<>6 then
    raise exception 'STOP: audited Project row counts changed; inspect again before copying';
  end if;

  if exists (
    (select projection.information_id
     from project_projection_table projection
     where projection.type::text='Text block chat'
     except
     select chat.chat_id
     from project_textbox_chats chat
     where chat.deleted_timestamp is null)
    union all
    (select chat.chat_id
     from project_textbox_chats chat
     where chat.deleted_timestamp is null
     except
     select projection.information_id
     from project_projection_table projection
     where projection.type::text='Text block chat')
  ) then
    raise exception 'STOP: legacy/final Project chat identity sets differ';
  end if;

  if exists (
    (select projection.information_id
     from project_projection_table projection
     where projection.type::text='Attached email'
     except
     select relationship.email_relationship_id
     from email_relationships relationship
     where relationship.resource_type='project')
    union all
    (select relationship.email_relationship_id
     from email_relationships relationship
     where relationship.resource_type='project'
     except
     select projection.information_id
     from project_projection_table projection
     where projection.type::text='Attached email')
  ) then
    raise exception 'STOP: legacy/final Project email relationship identity sets differ';
  end if;

  if exists (
    select 1
    from project_projection_table projection
    left join project_textboxes textbox
      on textbox.company_id=projection.company_id
     and textbox.project_id=projection.project_id
     and textbox.textbox_id=projection.information_id::text
     and textbox.deleted_timestamp is null
    where projection.type::text='Text box'
      and (textbox.textbox_id is null
        or not starts_with(projection.information,'<!-- mango-node-text-block-v1 -->')
        or not pg_input_is_valid(
          substring(projection.information from length('<!-- mango-node-text-block-v1 -->')+1),
          'jsonb'
        ))
  ) then
    raise exception 'STOP: a current Project textbox projection cannot be matched or decoded';
  end if;
end
$$;

with source as (
  select projection.company_id,
         projection.project_id,
         projection.information_id::text as textbox_id,
         substring(
           projection.information
           from length('<!-- mango-node-text-block-v1 -->')+1
         )::jsonb as payload,
         projection.updated_timestamp
  from project_projection_table projection
  where projection.type::text='Text box'
)
update project_textboxes textbox
set title=left(coalesce(source.payload->>'title',''),500),
    email_message_id=coalesce(source.payload->>'email_message_id',''),
    email_accent=case
      when coalesce(source.payload->>'email_accent','') ~ '^#[0-9A-Fa-f]{6}$'
        then source.payload->>'email_accent'
      else ''
    end,
    metadata_revision=greatest(textbox.metadata_revision,1),
    updated_timestamp=greatest(
      textbox.updated_timestamp,textbox.created_timestamp,source.updated_timestamp
    )
from source
where textbox.company_id=source.company_id
  and textbox.project_id=source.project_id
  and textbox.textbox_id=source.textbox_id
  and textbox.deleted_timestamp is null;

do $$
begin
  if exists (
    with source as (
      select projection.company_id,
             projection.project_id,
             projection.information_id::text as textbox_id,
             substring(
               projection.information
               from length('<!-- mango-node-text-block-v1 -->')+1
             )::jsonb as payload
      from project_projection_table projection
      where projection.type::text='Text box'
    )
    select 1
    from source
    join project_textboxes textbox
      on textbox.company_id=source.company_id
     and textbox.project_id=source.project_id
     and textbox.textbox_id=source.textbox_id
     and textbox.deleted_timestamp is null
    where textbox.title is distinct from left(coalesce(source.payload->>'title',''),500)
       or textbox.email_message_id is distinct from coalesce(source.payload->>'email_message_id','')
       or textbox.email_accent is distinct from case
            when coalesce(source.payload->>'email_accent','') ~ '^#[0-9A-Fa-f]{6}$'
              then source.payload->>'email_accent'
            else ''
          end
  ) then
    raise exception 'STOP: Project textbox metadata reconciliation failed';
  end if;
end
$$;

commit;

select current_setting('server_version') as server_version,
       'COPY_COMPLETE' as status,
       (select count(*) from project_textboxes where deleted_timestamp is null) as final_textboxes,
       (select count(*) from project_textbox_chats where deleted_timestamp is null) as final_chats,
       (select count(*) from email_relationships where resource_type='project') as final_email_relationships,
       0::integer as rows_needing_review;

-- STOP HERE. Deploy and soak the final Project backend next. Legacy-table
-- retirement remains a separate, destructive, operator-controlled script.
