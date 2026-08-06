begin transaction isolation level repeatable read read only;

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num;

do $$
declare
  server_num integer := current_setting('server_version_num')::integer;
begin
  if server_num < 170000 or server_num >= 190000 then
    raise exception 'STOP: Node unread-highlight retirement verification supports PostgreSQL 17.x and 18.x; connected server_version_num=%', server_num;
  end if;
  if to_regclass('public.node_content_changes') is not null
     or to_regclass('public.node_content_change_seen') is not null
     or to_regclass('public.node_textbox_seen_snapshots') is not null
     or to_regclass('public.idx_node_content_changes_node_created') is not null
     or to_regclass('public.idx_node_content_change_seen_user') is not null
     or to_regclass('public.idx_node_textbox_seen_snapshots_user') is not null
     or to_regprocedure('public.mangorts_trg_bump_node_view_user_from_change_seen()') is not null
     or to_regprocedure('public.mangorts_trg_bump_node_view_user_from_snapshot()') is not null then
    raise exception 'STOP: retired Node unread-highlight database objects remain';
  end if;
  if exists (
    select 1 from pg_trigger
    where not tgisinternal
      and tgname in (
        'trg_node_view_version_content_changes',
        'trg_node_view_user_version_change_seen_mutation',
        'trg_node_view_user_version_change_seen_delete',
        'trg_node_view_user_version_snapshots'
      )
  ) then
    raise exception 'STOP: a retired Node unread-highlight trigger remains';
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
  (select count(*) from public.recycle_bin_items item
   where item.restore_payload ?| array['node_content_changes', 'node_content_change_seen', 'node_textbox_seen_snapshots']) as recycle_items_with_ignored_retired_top_level_keys,
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

select true as node_unread_highlight_retirement_verified;

rollback;
