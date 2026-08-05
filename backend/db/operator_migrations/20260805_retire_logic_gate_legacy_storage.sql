-- DESTRUCTIVE, HUMAN-RUN OPERATOR MIGRATION. Plain PostgreSQL for DBeaver.
--
-- Do not change the five false values below until:
--   * scripts/v3_logic_gate_final_runtime_preflight.sql reports READY;
--   * scripts/v3_logic_gate_final_runtime_copy_verify.sql reports COPY_COMPLETE;
--   * the matching backend is deployed and no current writer uses either table;
--   * Logic Gate create/edit/save/restore/delete/recycle smoke tests pass;
--   * the agreed soak and a restorable retirement snapshot are complete.
--
-- This migration drops exactly:
--   logic_gate_information
--   logic_gate_projection_table
-- It does not use CASCADE.

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only;

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create temporary table mangorts_logic_gate_retirement_approval (
  copy_verified boolean not null,
  no_current_writer_verified boolean not null,
  smoke_and_recycle_verified boolean not null,
  soak_and_snapshot_confirmed boolean not null,
  operator_approved boolean not null
) on commit drop;

-- OPERATOR: change every false to true only after the named evidence exists.
insert into mangorts_logic_gate_retirement_approval values
  (false, false, false, false, false);

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: Logic Gate retirement supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;
  if current_setting('transaction_read_only')::boolean then
    raise exception 'STOP: retirement requires the human operator write connection';
  end if;
  if not exists (
    select 1
    from mangorts_logic_gate_retirement_approval
    where copy_verified
      and no_current_writer_verified
      and smoke_and_recycle_verified
      and soak_and_snapshot_confirmed
      and operator_approved
  ) then
    raise exception 'STOP: all five retirement approvals must be explicitly true';
  end if;
  if to_regclass('public.logic_gate_information') is null
     or to_regclass('public.logic_gate_projection_table') is null then
    raise exception 'STOP: legacy Logic Gate retirement table set drifted';
  end if;
end
$$;

do $$
begin
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
end
$$;

do $$
begin
  if exists (
    select 1 from logic_gate_projection_table
    where not is_deleted
      and type::text not in ('Text box','Attached email')
  ) then
    raise exception 'STOP: an active unsupported Logic Gate projection remains';
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
    (select company_id,logic_gate_id,information_id::text
     from logic_gate_projection_table
     where not is_deleted and type::text='Text box'
     except
     select company_id,logic_gate_id,textbox_id
     from logic_gate_textboxes where deleted_timestamp is null)
  ) then
    raise exception 'STOP: an active legacy Logic Gate textbox is missing from final storage';
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

create or replace function mangorts_validate_attachment_relationship_owner()
returns trigger language plpgsql as $$
begin
  if new.deleted_timestamp is not null then
    return new;
  end if;

  perform 1
  from attachments attachment
  where attachment.company_id=new.company_id
    and attachment.attachment_id=new.attachment_id
    and attachment.deleted_timestamp is null
  for update;
  if not found then
    raise exception 'attachment is missing or pending deletion' using errcode='23503';
  end if;

  if new.resource_type='node' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from nodes where company_id=new.company_id
                     and node_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Node owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='logic_gate' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from logic_gates where company_id=new.company_id
                     and logic_gate_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Logic Gate owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='project' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from projects where company_id=new.company_id
                     and project_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Project owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='node_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from node_textbox_chats where company_id=new.company_id
                     and chat_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end and deleted_timestamp is null) then
      raise exception 'attachment Node chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='project_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from project_textbox_chats
                     where company_id=new.company_id
                       and chat_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end
                       and deleted_timestamp is null) then
      raise exception 'attachment Project chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from email_messages where company_id=new.company_id
                     and email_message_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment email message owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_draft' then
    if not exists(select 1 from email_drafts where company_id=new.company_id
                  and draft_id=new.resource_id and deleted_timestamp is null) then
      raise exception 'attachment email draft owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_signature' then
    if not exists(select 1 from email_signatures where company_id=new.company_id
                  and signature_id=new.resource_id) then
      raise exception 'attachment email signature owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='shared_inbox' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from shared_inboxes where company_id=new.company_id
                     and shared_inbox_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment shared inbox owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='company_explorer_folder' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from company_explorer_folders where company_id=new.company_id
                     and folder_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment company folder owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='shared_inbox_folder' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from shared_inbox_folders where company_id=new.company_id
                     and folder_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment shared inbox folder owner does not exist' using errcode='23503';
    end if;
  else
    raise exception 'unsupported attachment owner type' using errcode='23514';
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where contype='f'
      and confrelid in (
        'public.logic_gate_information'::regclass,
        'public.logic_gate_projection_table'::regclass
      )
  ) then
    raise exception 'STOP: a foreign key still references legacy Logic Gate storage';
  end if;

  if exists (
    select 1
    from pg_views
    where schemaname not in ('pg_catalog','information_schema')
      and (definition ilike '%logic_gate_information%'
        or definition ilike '%logic_gate_projection_table%')
  ) or exists (
    select 1
    from pg_matviews
    where schemaname not in ('pg_catalog','information_schema')
      and (definition ilike '%logic_gate_information%'
        or definition ilike '%logic_gate_projection_table%')
  ) then
    raise exception 'STOP: a view still references legacy Logic Gate storage';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname not in ('pg_catalog','information_schema')
      and procedure.prokind in ('f','p')
      and (pg_get_functiondef(procedure.oid) ilike '%logic_gate_information%'
        or pg_get_functiondef(procedure.oid) ilike '%logic_gate_projection_table%')
  ) then
    raise exception 'STOP: a function still references legacy Logic Gate storage';
  end if;
end
$$;

drop table logic_gate_information;
drop table logic_gate_projection_table;

insert into schema_migrations(version)
values ('operator/20260805_retire_logic_gate_legacy_storage.sql')
on conflict (version) do nothing;

commit;

select current_setting('server_version') as server_version,
       'RETIREMENT_COMPLETE' as status,
       to_regclass('public.logic_gate_information') is null as information_table_dropped,
       to_regclass('public.logic_gate_projection_table') is null as projection_table_dropped;
