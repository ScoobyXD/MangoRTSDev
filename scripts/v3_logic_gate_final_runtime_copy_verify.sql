-- Run in DBeaver while Logic Gate writes are paused.
-- Required order:
--   1. Run scripts/v3_logic_gate_final_runtime_preflight.sql and require READY.
--   2. Apply backend/db/migrations/20260805_logic_gate_final_runtime_storage.sql.
--   3. Run this short metadata copy/reconcile transaction while writers remain paused.
-- This script does not drop either legacy table.

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only;

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: Logic Gate cutover supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;
end
$$;

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $$
begin
  if to_regclass('public.logic_gate_information') is null
     or to_regclass('public.logic_gate_projection_table') is null
     or to_regclass('public.logic_gate_textboxes') is null
     or to_regclass('public.logic_gate_textboxes_history') is null
     or to_regclass('public.email_relationships') is null then
    raise exception 'STOP: a required Logic Gate cutover table is missing';
  end if;

  if (select count(*) from pg_attribute
      where attrelid='public.logic_gate_projection_table'::regclass
        and attnum>0 and not attisdropped)<>9
     or exists (
       (values ('company_id'),('created_timestamp'),('information'),('information_id'),
               ('is_deleted'),('logic_gate_id'),('revision'),('type'),('updated_timestamp'))
       except
       select attname from pg_attribute
       where attrelid='public.logic_gate_projection_table'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname from pg_attribute
       where attrelid='public.logic_gate_projection_table'::regclass
         and attnum>0 and not attisdropped
       except
       values ('company_id'),('created_timestamp'),('information'),('information_id'),
              ('is_deleted'),('logic_gate_id'),('revision'),('type'),('updated_timestamp')
     ) then
    raise exception 'STOP: logic_gate_projection_table exact column set drifted';
  end if;

  if (select count(*) from pg_attribute
      where attrelid='public.logic_gate_information'::regclass
        and attnum>0 and not attisdropped)<>12
     or exists (
       (values ('company_id'),('created_timestamp'),('information'),('information_id'),
               ('logic_gate_id'),('save_batch_id'),('save_kind'),('saved_by_display_name'),
               ('saved_by_user_id'),('source_information_id'),('type'),('updated_timestamp'))
       except
       select attname from pg_attribute
       where attrelid='public.logic_gate_information'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname from pg_attribute
       where attrelid='public.logic_gate_information'::regclass
         and attnum>0 and not attisdropped
       except
       values ('company_id'),('created_timestamp'),('information'),('information_id'),
              ('logic_gate_id'),('save_batch_id'),('save_kind'),('saved_by_display_name'),
              ('saved_by_user_id'),('source_information_id'),('type'),('updated_timestamp')
     ) then
    raise exception 'STOP: logic_gate_information exact column set drifted';
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
    raise exception 'STOP: email_relationships exact column set drifted';
  end if;

  if (select count(*) from pg_attribute
      where attrelid='public.logic_gate_textboxes'::regclass
        and attnum>0 and not attisdropped)<>12
     or exists (
       (values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
               ('email_accent'),('email_message_id'),('logic_gate_id'),('metadata_revision'),
               ('revision'),('textbox_id'),('title'),('updated_timestamp'))
       except
       select attname from pg_attribute
       where attrelid='public.logic_gate_textboxes'::regclass
         and attnum>0 and not attisdropped
     )
     or exists (
       select attname from pg_attribute
       where attrelid='public.logic_gate_textboxes'::regclass
         and attnum>0 and not attisdropped
       except
       values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
              ('email_accent'),('email_message_id'),('logic_gate_id'),('metadata_revision'),
              ('revision'),('textbox_id'),('title'),('updated_timestamp')
     ) then
    raise exception 'STOP: logic_gate_textboxes exact final column set drifted';
  end if;

  if exists (
    select 1 from logic_gate_projection_table
    where not is_deleted
      and type::text not in ('Text box','Attached email')
  ) then
    raise exception 'STOP: an active unsupported Logic Gate projection remains';
  end if;

  if exists (
    select 1
    from logic_gate_projection_table projection
    left join logic_gate_textboxes textbox
      on textbox.company_id=projection.company_id
     and textbox.logic_gate_id=projection.logic_gate_id
     and textbox.textbox_id=projection.information_id::text
     and textbox.deleted_timestamp is null
    where not projection.is_deleted
      and projection.type::text='Text box'
      and (textbox.textbox_id is null
        or not starts_with(projection.information,'<!-- mango-node-text-block-v1 -->')
        or not pg_input_is_valid(
          substring(projection.information from length('<!-- mango-node-text-block-v1 -->')+1),
          'jsonb'
        ))
  ) then
    raise exception 'STOP: an active Logic Gate textbox cannot be matched or decoded';
  end if;

  if exists (
    select 1 from logic_gate_textboxes
    where deleted_timestamp is null
    group by company_id,logic_gate_id
    having count(*)>1
  ) then
    raise exception 'STOP: more than one live final textbox exists for a Logic Gate';
  end if;

  if exists (
    (select company_id,logic_gate_id,information_id
     from logic_gate_projection_table
     where not is_deleted and type::text='Attached email'
     except
     select company_id,resource_id,email_relationship_id
     from email_relationships where resource_type='logic_gate')
    union all
    (select company_id,resource_id,email_relationship_id
     from email_relationships where resource_type='logic_gate'
     except
     select company_id,logic_gate_id,information_id
     from logic_gate_projection_table
     where not is_deleted and type::text='Attached email')
  ) then
    raise exception 'STOP: legacy/final Logic Gate email identity sets differ';
  end if;

  if exists (
    select 1
    from logic_gate_information information
    left join logic_gate_textboxes_history history
      on history.company_id=information.company_id
     and history.logic_gate_id=information.logic_gate_id
     and history.batch_id=information.save_batch_id
     and history.textbox_id=coalesce(information.source_information_id,information.information_id)::text
    where information.save_batch_id is not null
      and information.save_kind<>'auto'
      and history.batch_id is null
  ) then
    raise exception 'STOP: a manual Logic Gate save is missing final history';
  end if;
end
$$;

with source as (
  select projection.company_id,
         projection.logic_gate_id,
         projection.information_id::text as textbox_id,
         substring(
           projection.information
           from length('<!-- mango-node-text-block-v1 -->')+1
         )::jsonb as payload,
         projection.updated_timestamp
  from logic_gate_projection_table projection
  where not projection.is_deleted
    and projection.type::text='Text box'
)
update logic_gate_textboxes textbox
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
  and textbox.logic_gate_id=source.logic_gate_id
  and textbox.textbox_id=source.textbox_id
  and textbox.deleted_timestamp is null;

do $$
begin
  if exists (
    with source as (
      select projection.company_id,
             projection.logic_gate_id,
             projection.information_id::text as textbox_id,
             substring(
               projection.information
               from length('<!-- mango-node-text-block-v1 -->')+1
             )::jsonb as payload
      from logic_gate_projection_table projection
      where not projection.is_deleted
        and projection.type::text='Text box'
    )
    select 1
    from source
    join logic_gate_textboxes textbox
      on textbox.company_id=source.company_id
     and textbox.logic_gate_id=source.logic_gate_id
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
    raise exception 'STOP: Logic Gate textbox metadata reconciliation failed';
  end if;
end
$$;

commit;

select current_setting('server_version') as server_version,
       'COPY_COMPLETE' as status,
       (select count(*) from logic_gate_projection_table
        where not is_deleted and type::text='Text box') as source_textboxes,
       (select count(*) from logic_gate_textboxes
        where deleted_timestamp is null) as final_textboxes,
       (select count(*) from logic_gate_projection_table
        where not is_deleted and type::text='Attached email') as source_email_relationships,
       (select count(*) from email_relationships
        where resource_type='logic_gate') as final_email_relationships,
       0::integer as rows_needing_review;

-- STOP HERE. Deploy the matching backend, smoke test create/edit/save/restore/
-- delete/recycle behavior, then observe the agreed soak. Retirement is separate.
