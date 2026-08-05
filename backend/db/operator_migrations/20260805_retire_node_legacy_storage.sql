-- DESTRUCTIVE, HUMAN-RUN OPERATOR MIGRATION. Plain PostgreSQL for DBeaver.
--
-- Change the five false values only after the final-storage preflight/copy,
-- matching backend deploy, smoke tests, soak, and restorable snapshot exist.
-- This transaction drops exactly the three tables below. It does not use CASCADE.

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only;

begin;
set local lock_timeout='10s';
set local statement_timeout='5min';

create temporary table mangorts_node_retirement_approval (
  copy_verified boolean not null,
  no_current_writer_verified boolean not null,
  smoke_and_recycle_verified boolean not null,
  soak_and_snapshot_confirmed boolean not null,
  operator_approved boolean not null
) on commit drop;

-- OPERATOR: change every false to true only after the named evidence exists.
insert into mangorts_node_retirement_approval values(false,false,false,false,false);

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: Node retirement supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;
  if current_setting('transaction_read_only')::boolean then
    raise exception 'STOP: retirement requires the human operator write connection';
  end if;
  if not exists(select 1 from mangorts_node_retirement_approval
    where copy_verified and no_current_writer_verified and smoke_and_recycle_verified
      and soak_and_snapshot_confirmed and operator_approved) then
    raise exception 'STOP: all five Node retirement approvals must be explicitly true';
  end if;
  if to_regclass('public.node_information') is null
     or to_regclass('public.node_projection_table') is null
     or to_regclass('public.node_projection_seen_snapshots') is null then
    raise exception 'STOP: legacy Node retirement table set drifted or was already retired';
  end if;
end
$$;

lock table node_information,node_projection_table,node_projection_seen_snapshots
  in access exclusive mode;

do $$
begin
  if (select count(*) from pg_attribute where attrelid='public.node_information'::regclass and attnum>0 and not attisdropped)<>12
     or exists((values ('company_id'),('created_timestamp'),('information'),('information_id'),('node_id'),
       ('save_batch_id'),('save_kind'),('saved_by_display_name'),('saved_by_user_id'),
       ('source_information_id'),('type'),('updated_timestamp')) except
       select attname from pg_attribute where attrelid='public.node_information'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_information'::regclass and attnum>0 and not attisdropped except
       values ('company_id'),('created_timestamp'),('information'),('information_id'),('node_id'),
       ('save_batch_id'),('save_kind'),('saved_by_display_name'),('saved_by_user_id'),
       ('source_information_id'),('type'),('updated_timestamp')) then
    raise exception 'STOP: node_information exact unordered column set drifted';
  end if;

  if (select count(*) from pg_attribute where attrelid='public.node_projection_table'::regclass and attnum>0 and not attisdropped)<>9
     or exists((values ('company_id'),('created_timestamp'),('information'),('information_id'),
       ('is_deleted'),('node_id'),('revision'),('type'),('updated_timestamp')) except
       select attname from pg_attribute where attrelid='public.node_projection_table'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_projection_table'::regclass and attnum>0 and not attisdropped except
       values ('company_id'),('created_timestamp'),('information'),('information_id'),
       ('is_deleted'),('node_id'),('revision'),('type'),('updated_timestamp')) then
    raise exception 'STOP: node_projection_table exact unordered column set drifted';
  end if;

  if (select count(*) from pg_attribute where attrelid='public.node_projection_seen_snapshots'::regclass and attnum>0 and not attisdropped)<>7
     or exists((values ('company_id'),('information'),('information_id'),('node_id'),
       ('projection_updated_timestamp'),('seen_timestamp'),('user_id')) except
       select attname from pg_attribute where attrelid='public.node_projection_seen_snapshots'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_projection_seen_snapshots'::regclass and attnum>0 and not attisdropped except
       values ('company_id'),('information'),('information_id'),('node_id'),
       ('projection_updated_timestamp'),('seen_timestamp'),('user_id')) then
    raise exception 'STOP: node_projection_seen_snapshots exact unordered column set drifted';
  end if;

  if (select count(*) from pg_attribute where attrelid='public.node_textboxes'::regclass and attnum>0 and not attisdropped)<>9
     or exists((values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
       ('display_order'),('node_id'),('revision'),('textbox_id'),('updated_timestamp')) except
       select attname from pg_attribute where attrelid='public.node_textboxes'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_textboxes'::regclass and attnum>0 and not attisdropped except
       values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
       ('display_order'),('node_id'),('revision'),('textbox_id'),('updated_timestamp')) then
    raise exception 'STOP: node_textboxes exact final column set drifted';
  end if;

  if (select count(*) from pg_attribute where attrelid='public.node_textbox_seen_snapshots'::regclass and attnum>0 and not attisdropped)<>8
     or exists((values ('body_json'),('company_id'),('node_id'),('seen_timestamp'),
       ('textbox_id'),('textbox_revision'),('textbox_updated_timestamp'),('user_id')) except
       select attname from pg_attribute where attrelid='public.node_textbox_seen_snapshots'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_textbox_seen_snapshots'::regclass and attnum>0 and not attisdropped except
       values ('body_json'),('company_id'),('node_id'),('seen_timestamp'),
       ('textbox_id'),('textbox_revision'),('textbox_updated_timestamp'),('user_id')) then
    raise exception 'STOP: node_textbox_seen_snapshots exact final column set drifted';
  end if;

  if (select count(*) from pg_attribute where attrelid='public.node_content_changes'::regclass and attnum>0 and not attisdropped)<>11
     or exists((values ('actor_display_name'),('actor_user_id'),('change_id'),('change_type'),
       ('company_id'),('created_timestamp'),('end_offset'),('node_id'),('start_offset'),('text'),('textbox_id')) except
       select attname from pg_attribute where attrelid='public.node_content_changes'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_content_changes'::regclass and attnum>0 and not attisdropped except
       values ('actor_display_name'),('actor_user_id'),('change_id'),('change_type'),
       ('company_id'),('created_timestamp'),('end_offset'),('node_id'),('start_offset'),('text'),('textbox_id')) then
    raise exception 'STOP: node_content_changes exact final column set drifted';
  end if;
end
$$;

do $$
begin
  if exists(select 1 from node_projection_table where not is_deleted
    and type::text not in ('Text box','Text block chat','Attached email')) then
    raise exception 'STOP: active unsupported Node projections remain';
  end if;
  if exists(select company_id,node_id,information_id from node_projection_table
      where not is_deleted and type::text='Text box'
    except select company_id,node_id,textbox_id from node_textboxes where deleted_timestamp is null) then
    raise exception 'STOP: an active legacy Node textbox is missing final storage';
  end if;
  if exists((select company_id,node_id,information_id from node_projection_table
      where not is_deleted and type::text='Text block chat'
    except select company_id,node_id,chat_id from node_textbox_chats where deleted_timestamp is null)) then
    raise exception 'STOP: an active legacy Node chat is missing final chat storage';
  end if;
  if exists(select company_id,node_id,information_id from node_projection_table
      where not is_deleted and type::text='Attached email'
    except select company_id,resource_id,email_relationship_id from email_relationships where resource_type='node') then
    raise exception 'STOP: an active legacy Node email relationship is missing final storage';
  end if;
  if exists(select 1 from node_information information
    left join node_textboxes_history history on history.company_id=information.company_id
      and history.node_id=information.node_id and history.batch_id=information.save_batch_id
      and history.textbox_id=coalesce(information.source_information_id,information.information_id)
    where information.save_batch_id is not null and information.save_kind<>'auto' and history.batch_id is null) then
    raise exception 'STOP: a manual Node save is missing final history';
  end if;
  if exists(select company_id,node_id,information_id,user_id from node_projection_seen_snapshots
    except select company_id,node_id,textbox_id,user_id from node_textbox_seen_snapshots) then
    raise exception 'STOP: a legacy Node seen snapshot is missing final storage';
  end if;
  if exists(select 1 from node_textbox_seen_snapshots where textbox_revision<0)
     or exists(select 1 from node_content_changes change where not exists(
       select 1 from node_textboxes textbox where textbox.company_id=change.company_id
         and textbox.node_id=change.node_id and textbox.textbox_id=change.textbox_id)) then
    raise exception 'STOP: final Node seen/change storage failed reconciliation';
  end if;
end
$$;

do $$
begin
  if exists(select 1 from pg_constraint where contype='f' and confrelid in (
    'public.node_information'::regclass,'public.node_projection_table'::regclass,
    'public.node_projection_seen_snapshots'::regclass)) then
    raise exception 'STOP: a foreign key still references legacy Node storage';
  end if;
  if exists(select 1 from pg_views where schemaname not in ('pg_catalog','information_schema')
      and (definition ilike '%node_information%' or definition ilike '%node_projection_table%'
        or definition ilike '%node_projection_seen_snapshots%'))
    or exists(select 1 from pg_matviews where schemaname not in ('pg_catalog','information_schema')
      and (definition ilike '%node_information%' or definition ilike '%node_projection_table%'
        or definition ilike '%node_projection_seen_snapshots%')) then
    raise exception 'STOP: a view still references legacy Node storage';
  end if;
  if exists(select 1 from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname not in ('pg_catalog','information_schema') and procedure.prokind in ('f','p')
      and (pg_get_functiondef(procedure.oid) ilike '%node_information%'
        or pg_get_functiondef(procedure.oid) ilike '%node_projection_table%'
        or pg_get_functiondef(procedure.oid) ilike '%node_projection_seen_snapshots%')) then
    raise exception 'STOP: a function still references legacy Node storage';
  end if;
end
$$;

drop table node_projection_seen_snapshots;
drop table node_projection_table;
drop table node_information;

insert into schema_migrations(version)
values('operator/20260805_retire_node_legacy_storage.sql')
on conflict(version) do nothing;
commit;

select current_setting('server_version') as server_version,
       'RETIREMENT_COMPLETE' as status,
       to_regclass('public.node_information') is null as information_table_dropped,
       to_regclass('public.node_projection_table') is null as projection_table_dropped,
       to_regclass('public.node_projection_seen_snapshots') is null as seen_table_dropped;
