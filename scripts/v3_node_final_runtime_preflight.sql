-- READ-ONLY Node final-storage preflight. Plain PostgreSQL for DBeaver.
begin isolation level repeatable read read only;

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only;

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: Node final-storage preflight supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;
  if to_regclass('public.node_information') is null
     or to_regclass('public.node_projection_table') is null
     or to_regclass('public.node_projection_seen_snapshots') is null then
    raise exception 'STOP: expected three-table legacy Node source set is missing or drifted';
  end if;
  if to_regclass('public.node_textboxes') is null
     or to_regclass('public.node_textbox_chats') is null
     or to_regclass('public.node_textboxes_history') is null then
    raise exception 'STOP: final Node textbox/chat/history tables are missing';
  end if;
  if exists(select 1 from node_projection_table where not is_deleted
    and type::text not in ('Text box','Text block chat','Attached email')) then
    raise exception 'STOP: active unsupported Node projection types remain';
  end if;
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
    raise exception 'STOP: node_textboxes exact unordered column set drifted';
  end if;
  if (select count(*) from pg_attribute where attrelid='public.node_content_changes'::regclass and attnum>0 and not attisdropped)<>11
     or exists((values ('actor_display_name'),('actor_user_id'),('change_id'),('change_type'),
       ('company_id'),('created_timestamp'),('end_offset'),('information_id'),('node_id'),
       ('start_offset'),('text')) except
       select attname from pg_attribute where attrelid='public.node_content_changes'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_content_changes'::regclass and attnum>0 and not attisdropped except
       values ('actor_display_name'),('actor_user_id'),('change_id'),('change_type'),
       ('company_id'),('created_timestamp'),('end_offset'),('information_id'),('node_id'),
       ('start_offset'),('text')) then
    raise exception 'STOP: node_content_changes exact pre-cutover column set drifted';
  end if;

  if exists(
    select 1
    from node_projection_table projection
    where not projection.is_deleted
      and projection.type::text='Text box'
      and not exists(
        select 1 from node_textboxes textbox
        where textbox.company_id=projection.company_id
          and textbox.node_id=projection.node_id
          and textbox.textbox_id=projection.information_id
      )
      and not exists(
        select 1 from nodes parent
        where parent.company_id=projection.company_id
          and parent.node_id=projection.node_id
      )
  ) then
    raise exception 'STOP: an active legacy Node textbox missing final storage has no exact Node owner';
  end if;

  if exists(
    select 1
    from node_projection_table projection
    join node_textboxes textbox
      on textbox.company_id=projection.company_id
     and textbox.node_id=projection.node_id
     and textbox.textbox_id=projection.information_id
    where not projection.is_deleted
      and projection.type::text='Text box'
      and textbox.deleted_timestamp is not null
  ) then
    raise exception 'STOP: an active legacy Node textbox conflicts with a deleted final textbox';
  end if;

  if exists(
    select 1
    from node_projection_seen_snapshots seen
    where not (
      (
        exists(
          select 1 from nodes parent
          where parent.company_id=seen.company_id
            and parent.node_id=seen.node_id
        )
        and not exists(
          select 1 from node_projection_table projection
          where projection.company_id=seen.company_id
            and projection.node_id=seen.node_id
            and projection.information_id=seen.information_id
        )
        and not exists(
          select 1 from node_textboxes textbox
          where textbox.company_id=seen.company_id
            and textbox.node_id=seen.node_id
            and textbox.textbox_id=seen.information_id
        )
        and not exists(
          select 1 from node_information history
          where history.company_id=seen.company_id
            and history.node_id=seen.node_id
            and coalesce(history.source_information_id,history.information_id)=seen.information_id
        )
        and not exists(
          select 1 from node_content_changes change
          where change.company_id=seen.company_id
            and change.node_id=seen.node_id
            and change.information_id=seen.information_id
        )
      )
      or (
        exists(
          select 1 from node_projection_table projection
          where projection.company_id=seen.company_id
            and projection.node_id=seen.node_id
            and projection.information_id=seen.information_id
            and projection.type::text='Text box'
        )
        and (
          exists(
            select 1 from node_textboxes textbox
            where textbox.company_id=seen.company_id
              and textbox.node_id=seen.node_id
              and textbox.textbox_id=seen.information_id
          )
          or exists(
            select 1 from node_projection_table projection
            where projection.company_id=seen.company_id
              and projection.node_id=seen.node_id
              and projection.information_id=seen.information_id
              and projection.type::text='Text box'
              and not projection.is_deleted
          )
        )
      )
    )
  ) then
    raise exception 'STOP: a legacy Node seen snapshot is neither a proven orphan nor tied to a copyable/final textbox';
  end if;
end
$$;

select 'READY_FOR_PAUSED_WRITER_FINAL_DELTA' as status,
       (select count(*) from node_information) as legacy_information_rows,
       (select count(*) from node_projection_table) as legacy_projection_rows,
       (select count(*) from node_projection_seen_snapshots) as legacy_seen_rows,
       (select count(*)
          from node_projection_table projection
         where not projection.is_deleted
           and projection.type::text='Text box'
           and not exists(
             select 1 from node_textboxes textbox
             where textbox.company_id=projection.company_id
               and textbox.node_id=projection.node_id
               and textbox.textbox_id=projection.information_id
           )) as active_legacy_textboxes_to_copy,
       (select count(*)
          from node_projection_seen_snapshots seen
         where exists(
           select 1 from nodes parent
           where parent.company_id=seen.company_id
             and parent.node_id=seen.node_id
         )
           and not exists(
           select 1 from node_projection_table projection
           where projection.company_id=seen.company_id
             and projection.node_id=seen.node_id
             and projection.information_id=seen.information_id
         )
           and not exists(
             select 1 from node_textboxes textbox
             where textbox.company_id=seen.company_id
             and textbox.node_id=seen.node_id
             and textbox.textbox_id=seen.information_id
           )
           and not exists(
             select 1 from node_information history
             where history.company_id=seen.company_id
               and history.node_id=seen.node_id
               and coalesce(history.source_information_id,history.information_id)=seen.information_id
           )
           and not exists(
             select 1 from node_content_changes change
             where change.company_id=seen.company_id
               and change.node_id=seen.node_id
               and change.information_id=seen.information_id
           )) as stale_seen_snapshots_to_remove,
       (select count(distinct (seen.company_id,seen.node_id,seen.information_id))
          from node_projection_seen_snapshots seen
         where exists(
           select 1 from nodes parent
           where parent.company_id=seen.company_id
             and parent.node_id=seen.node_id
         )
           and not exists(
           select 1 from node_projection_table projection
           where projection.company_id=seen.company_id
             and projection.node_id=seen.node_id
             and projection.information_id=seen.information_id
         )
           and not exists(
             select 1 from node_textboxes textbox
             where textbox.company_id=seen.company_id
             and textbox.node_id=seen.node_id
             and textbox.textbox_id=seen.information_id
           )
           and not exists(
             select 1 from node_information history
             where history.company_id=seen.company_id
               and history.node_id=seen.node_id
               and coalesce(history.source_information_id,history.information_id)=seen.information_id
           )
           and not exists(
             select 1 from node_content_changes change
             where change.company_id=seen.company_id
               and change.node_id=seen.node_id
               and change.information_id=seen.information_id
           )) as stale_seen_textbox_ids,
       (select count(*)
          from node_projection_seen_snapshots seen
          join node_projection_table projection
            on projection.company_id=seen.company_id
           and projection.node_id=seen.node_id
           and projection.information_id=seen.information_id
           and projection.type::text='Text box'
           and not projection.is_deleted
         where not exists(
           select 1 from node_textboxes textbox
           where textbox.company_id=seen.company_id
             and textbox.node_id=seen.node_id
             and textbox.textbox_id=seen.information_id
         )) as seen_snapshots_to_migrate_after_copy,
       (select count(*) from node_textboxes) as final_textbox_rows,
       (select count(*) from node_textbox_chats) as final_chat_rows,
       (select count(*) from node_textboxes_history) as final_history_rows;

commit;
