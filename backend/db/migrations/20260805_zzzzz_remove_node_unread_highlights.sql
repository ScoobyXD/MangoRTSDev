begin;

do $$
declare
  server_num integer := current_setting('server_version_num')::integer;
  change_rel regclass := to_regclass('public.node_content_changes');
  seen_rel regclass := to_regclass('public.node_content_change_seen');
  snapshot_rel regclass := to_regclass('public.node_textbox_seen_snapshots');
  unexpected_count bigint;
begin
  raise notice 'server_version=%, server_version_num=%', current_setting('server_version'), server_num;
  if server_num < 170000 or server_num >= 190000 then
    raise exception 'STOP: Node unread-highlight retirement supports PostgreSQL 17.x and 18.x; connected server_version_num=%', server_num;
  end if;

  if change_rel is null or seen_rel is null or snapshot_rel is null then
    raise exception 'STOP: one or more Node unread-highlight tables are missing';
  end if;

  if (select count(*) from pg_attribute where attrelid=change_rel and attnum>0 and not attisdropped) <> 11
     or exists (
       select attname::text from pg_attribute where attrelid=change_rel and attnum>0 and not attisdropped
       except
       select column_name from (values
         ('company_id'), ('change_id'), ('node_id'), ('textbox_id'), ('change_type'), ('text'),
         ('start_offset'), ('end_offset'), ('actor_user_id'), ('actor_display_name'), ('created_timestamp')
       ) expected(column_name)
     )
     or exists (
       select column_name from (values
         ('company_id'), ('change_id'), ('node_id'), ('textbox_id'), ('change_type'), ('text'),
         ('start_offset'), ('end_offset'), ('actor_user_id'), ('actor_display_name'), ('created_timestamp')
       ) expected(column_name)
       except
       select attname::text from pg_attribute where attrelid=change_rel and attnum>0 and not attisdropped
     ) then
    raise exception 'STOP: node_content_changes exact unordered column set drifted';
  end if;

  if (select count(*) from pg_attribute where attrelid=seen_rel and attnum>0 and not attisdropped) <> 4
     or exists (
       select attname::text from pg_attribute where attrelid=seen_rel and attnum>0 and not attisdropped
       except
       select column_name from (values ('company_id'), ('change_id'), ('user_id'), ('seen_timestamp')) expected(column_name)
     )
     or exists (
       select column_name from (values ('company_id'), ('change_id'), ('user_id'), ('seen_timestamp')) expected(column_name)
       except
       select attname::text from pg_attribute where attrelid=seen_rel and attnum>0 and not attisdropped
     ) then
    raise exception 'STOP: node_content_change_seen exact unordered column set drifted';
  end if;

  if (select count(*) from pg_attribute where attrelid=snapshot_rel and attnum>0 and not attisdropped) <> 8
     or exists (
       select attname::text from pg_attribute where attrelid=snapshot_rel and attnum>0 and not attisdropped
       except
       select column_name from (values
         ('company_id'), ('node_id'), ('textbox_id'), ('user_id'), ('body_json'), ('textbox_revision'),
         ('textbox_updated_timestamp'), ('seen_timestamp')
       ) expected(column_name)
     )
     or exists (
       select column_name from (values
         ('company_id'), ('node_id'), ('textbox_id'), ('user_id'), ('body_json'), ('textbox_revision'),
         ('textbox_updated_timestamp'), ('seen_timestamp')
       ) expected(column_name)
       except
       select attname::text from pg_attribute where attrelid=snapshot_rel and attnum>0 and not attisdropped
     ) then
    raise exception 'STOP: node_textbox_seen_snapshots exact unordered column set drifted';
  end if;

  if to_regclass('public.idx_node_content_changes_node_created') is null
     or to_regclass('public.idx_node_content_change_seen_user') is null
     or to_regclass('public.idx_node_textbox_seen_snapshots_user') is null then
    raise exception 'STOP: a dedicated Node unread-highlight index is missing';
  end if;

  if not exists (
       select 1 from pg_constraint
       where conrelid=change_rel and conname='node_content_changes_textbox_fk' and contype='f'
     ) then
    raise exception 'STOP: node_content_changes_textbox_fk is missing';
  end if;

  if to_regprocedure('public.mangorts_trg_bump_node_view_user_from_change_seen()') is null
     or to_regprocedure('public.mangorts_trg_bump_node_view_user_from_snapshot()') is null then
    raise exception 'STOP: a dedicated Node unread-highlight trigger function is missing';
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

  select count(*) into unexpected_count
  from pg_proc routine
  join pg_namespace namespace_row on namespace_row.oid=routine.pronamespace
  where namespace_row.nspname not in ('pg_catalog', 'information_schema')
    and routine.oid not in (
      'public.mangorts_trg_bump_node_view_user_from_change_seen()'::regprocedure,
      'public.mangorts_trg_bump_node_view_user_from_snapshot()'::regprocedure
    )
    and lower(routine.prosrc) ~ 'node_content_changes|node_content_change_seen|node_textbox_seen_snapshots';
  if unexpected_count <> 0 then
    raise exception 'STOP: a surviving routine still references Node unread-highlight storage';
  end if;
end;
$$;

drop trigger trg_node_view_user_version_change_seen_mutation on public.node_content_change_seen;
drop trigger trg_node_view_user_version_change_seen_delete on public.node_content_change_seen;
drop trigger trg_node_view_user_version_snapshots on public.node_textbox_seen_snapshots;
drop trigger trg_node_view_version_content_changes on public.node_content_changes;

drop index public.idx_node_content_change_seen_user;
drop index public.idx_node_textbox_seen_snapshots_user;
drop index public.idx_node_content_changes_node_created;

drop table public.node_content_change_seen;
drop table public.node_textbox_seen_snapshots;
alter table public.node_content_changes drop constraint node_content_changes_textbox_fk;
drop table public.node_content_changes;

drop function public.mangorts_trg_bump_node_view_user_from_change_seen();
drop function public.mangorts_trg_bump_node_view_user_from_snapshot();

commit;
