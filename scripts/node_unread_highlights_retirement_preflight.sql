begin transaction isolation level repeatable read read only;

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num;

do $$
declare
  server_num integer := current_setting('server_version_num')::integer;
  change_rel regclass := to_regclass('public.node_content_changes');
  seen_rel regclass := to_regclass('public.node_content_change_seen');
  snapshot_rel regclass := to_regclass('public.node_textbox_seen_snapshots');
  unexpected_count bigint;
  unexpected_routines text;
begin
  if server_num < 170000 or server_num >= 190000 then
    raise exception 'STOP: Node unread-highlight retirement supports PostgreSQL 17.x and 18.x; connected server_version_num=%', server_num;
  end if;
  if change_rel is null or seen_rel is null or snapshot_rel is null then
    raise exception 'STOP: one or more Node unread-highlight tables are missing';
  end if;
  if (select count(*) from pg_attribute where attrelid=change_rel and attnum>0 and not attisdropped) <> 11
     or exists (
       select attname::text from pg_attribute where attrelid=change_rel and attnum>0 and not attisdropped
       except select column_name from (values
         ('company_id'), ('change_id'), ('node_id'), ('textbox_id'), ('change_type'), ('text'),
         ('start_offset'), ('end_offset'), ('actor_user_id'), ('actor_display_name'), ('created_timestamp')
       ) expected(column_name)
     )
     or exists (
       select column_name from (values
         ('company_id'), ('change_id'), ('node_id'), ('textbox_id'), ('change_type'), ('text'),
         ('start_offset'), ('end_offset'), ('actor_user_id'), ('actor_display_name'), ('created_timestamp')
       ) expected(column_name)
       except select attname::text from pg_attribute where attrelid=change_rel and attnum>0 and not attisdropped
     ) then
    raise exception 'STOP: node_content_changes exact unordered column set drifted';
  end if;
  if (select count(*) from pg_attribute where attrelid=seen_rel and attnum>0 and not attisdropped) <> 4
     or exists (
       select attname::text from pg_attribute where attrelid=seen_rel and attnum>0 and not attisdropped
       except select column_name from (values ('company_id'), ('change_id'), ('user_id'), ('seen_timestamp')) expected(column_name)
     )
     or exists (
       select column_name from (values ('company_id'), ('change_id'), ('user_id'), ('seen_timestamp')) expected(column_name)
       except select attname::text from pg_attribute where attrelid=seen_rel and attnum>0 and not attisdropped
     ) then
    raise exception 'STOP: node_content_change_seen exact unordered column set drifted';
  end if;
  if (select count(*) from pg_attribute where attrelid=snapshot_rel and attnum>0 and not attisdropped) <> 8
     or exists (
       select attname::text from pg_attribute where attrelid=snapshot_rel and attnum>0 and not attisdropped
       except select column_name from (values
         ('company_id'), ('node_id'), ('textbox_id'), ('user_id'), ('body_json'), ('textbox_revision'),
         ('textbox_updated_timestamp'), ('seen_timestamp')
       ) expected(column_name)
     )
     or exists (
       select column_name from (values
         ('company_id'), ('node_id'), ('textbox_id'), ('user_id'), ('body_json'), ('textbox_revision'),
         ('textbox_updated_timestamp'), ('seen_timestamp')
       ) expected(column_name)
       except select attname::text from pg_attribute where attrelid=snapshot_rel and attnum>0 and not attisdropped
     ) then
    raise exception 'STOP: node_textbox_seen_snapshots exact unordered column set drifted';
  end if;

  if to_regclass('public.idx_node_content_changes_node_created') is null
     or to_regclass('public.idx_node_content_change_seen_user') is null
     or to_regclass('public.idx_node_textbox_seen_snapshots_user') is null
     or to_regprocedure('public.mangorts_trg_bump_node_view_user_from_change_seen()') is null
     or to_regprocedure('public.mangorts_trg_bump_node_view_user_from_snapshot()') is null then
    raise exception 'STOP: a dedicated Node unread-highlight object is missing';
  end if;

  if not exists (
       select 1 from pg_constraint
       where conrelid=change_rel and conname='node_content_changes_textbox_fk' and contype='f'
     ) then
    raise exception 'STOP: node_content_changes_textbox_fk is missing';
  end if;

  select count(*) into unexpected_count
  from pg_trigger trigger_row
  where not trigger_row.tgisinternal
    and trigger_row.tgrelid in (change_rel, seen_rel, snapshot_rel)
    and trigger_row.tgname not in (
      'trg_node_view_version_content_changes',
      'trg_node_view_user_version_change_seen_mutation',
      'trg_node_view_user_version_change_seen_delete',
      'trg_node_view_user_version_snapshots'
    );
  if unexpected_count <> 0 then
    raise exception 'STOP: an unexpected trigger depends on a Node unread-highlight table';
  end if;

  if not exists (
       select 1 from pg_trigger where not tgisinternal and tgrelid=change_rel
         and tgname='trg_node_view_version_content_changes'
     )
     or (select count(*) from pg_trigger where not tgisinternal and tgrelid=seen_rel
           and tgname in ('trg_node_view_user_version_change_seen_mutation', 'trg_node_view_user_version_change_seen_delete')) <> 2
     or not exists (
       select 1 from pg_trigger where not tgisinternal and tgrelid=snapshot_rel
         and tgname='trg_node_view_user_version_snapshots'
     ) then
    raise exception 'STOP: the dedicated Node unread-highlight trigger set drifted';
  end if;

  select count(*) into unexpected_count
  from pg_constraint constraint_row
  where constraint_row.contype='f'
    and constraint_row.confrelid in (change_rel, seen_rel, snapshot_rel)
    and constraint_row.conrelid not in (change_rel, seen_rel, snapshot_rel);
  if unexpected_count <> 0 then
    raise exception 'STOP: an unexpected foreign key depends on a Node unread-highlight table';
  end if;

  if exists (
       select 1 from pg_views
       where schemaname not in ('pg_catalog', 'information_schema')
         and lower(definition) ~ 'node_content_changes|node_content_change_seen|node_textbox_seen_snapshots'
     )
     or exists (
       select 1 from pg_matviews
       where schemaname not in ('pg_catalog', 'information_schema')
         and lower(definition) ~ 'node_content_changes|node_content_change_seen|node_textbox_seen_snapshots'
     ) then
    raise exception 'STOP: a view still depends on Node unread-highlight storage';
  end if;

  select string_agg(
           format('%I.%I(%s)', namespace_row.nspname, routine.proname,
                  pg_get_function_identity_arguments(routine.oid)),
           ', ' order by namespace_row.nspname, routine.proname, routine.oid
         )
  into unexpected_routines
  from pg_proc routine
  join pg_namespace namespace_row on namespace_row.oid=routine.pronamespace
  where namespace_row.nspname not in ('pg_catalog', 'information_schema')
    and namespace_row.oid <> pg_my_temp_schema()
    and not pg_is_other_temp_schema(namespace_row.oid)
    and routine.oid not in (
      'public.mangorts_trg_bump_node_view_user_from_change_seen()'::regprocedure,
      'public.mangorts_trg_bump_node_view_user_from_snapshot()'::regprocedure
    )
    and lower(routine.prosrc) ~ 'node_content_changes|node_content_change_seen|node_textbox_seen_snapshots';
  if unexpected_routines is not null then
    raise exception 'STOP: surviving routine(s) still reference Node unread-highlight storage: %', unexpected_routines;
  end if;
end;
$$;

select
  (select count(*) from public.node_textboxes where deleted_timestamp is null) as active_node_textboxes,
  (select count(*) from public.node_textboxes textbox
   where exists (
     select 1 from jsonb_array_elements(textbox.body_json->'annotations') annotation
     where annotation->>'kind'='change'
   )) as current_textboxes_with_dormant_changes,
  (select count(*) from public.node_textboxes textbox
   cross join lateral jsonb_array_elements(textbox.body_json->'annotations') annotation
   where annotation->>'kind'='change') as current_dormant_change_annotations,
  (select count(*) from public.node_textboxes_history) as node_textbox_history_rows,
  (select count(*) from public.node_textboxes_history history
   cross join lateral jsonb_array_elements(history.body_json->'annotations') annotation
   where annotation->>'kind'='change') as history_dormant_change_annotations,
  (select count(*) from public.node_content_changes) as retired_content_change_rows,
  (select count(*) from public.node_content_change_seen) as retired_seen_rows,
  (select count(*) from public.node_textbox_seen_snapshots) as retired_snapshot_rows,
  (select count(*) from public.recycle_bin_items item
   where item.restore_payload ?| array['node_content_changes', 'node_content_change_seen', 'node_textbox_seen_snapshots']) as recycle_items_with_retired_top_level_keys,
  (select count(*) from public.recycle_bin_items item
   cross join lateral jsonb_array_elements(
     case when jsonb_typeof(item.restore_payload->'node_textboxes')='array'
       then item.restore_payload->'node_textboxes' else '[]'::jsonb end
   ) textbox
   cross join lateral jsonb_array_elements(
     case when jsonb_typeof(textbox->'body_json'->'annotations')='array'
       then textbox->'body_json'->'annotations' else '[]'::jsonb end
   ) annotation
   where annotation->>'kind'='change') as recycle_current_dormant_change_annotations,
  (select count(*) from public.recycle_bin_items item
   cross join lateral jsonb_array_elements(
     case when jsonb_typeof(item.restore_payload->'node_textboxes_history')='array'
       then item.restore_payload->'node_textboxes_history' else '[]'::jsonb end
   ) history
   cross join lateral jsonb_array_elements(
     case when jsonb_typeof(history->'body_json'->'annotations')='array'
       then history->'body_json'->'annotations' else '[]'::jsonb end
   ) annotation
   where annotation->>'kind'='change') as recycle_history_dormant_change_annotations;

select
  count(*) as current_json_rows,
  md5(coalesce(string_agg(md5(body_json::text), '' order by company_id, node_id, textbox_id), '')) as current_json_checksum
from public.node_textboxes;

select
  count(*) as history_json_rows,
  md5(coalesce(string_agg(md5(body_json::text), '' order by company_id, node_id, batch_id, textbox_id), '')) as history_json_checksum
from public.node_textboxes_history;

select true as ready_for_separately_approved_node_unread_highlight_retirement;

rollback;
