-- READ-ONLY preflight for the exact empty Node textbox document created by the
-- 2026-08-04 final-storage conversion. Plain PostgreSQL for DBeaver.
begin isolation level repeatable read read only;

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only;

do $$
begin
  if current_setting('server_version_num')::integer / 10000 <> 17 then
    raise exception 'STOP: empty Node textbox repair supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;

  if to_regclass('public.node_textboxes') is null
     or to_regclass('public.node_textboxes_history') is null
     or to_regclass('public.node_textbox_seen_snapshots') is null
     or to_regclass('public.recycle_bin_items') is null then
    raise exception 'STOP: one or more final Node/recycle tables are missing';
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

  if (select count(*) from pg_attribute where attrelid='public.node_textboxes_history'::regclass and attnum>0 and not attisdropped)<>8
     or exists((values ('batch_id'),('body_json'),('company_id'),('display_order'),
       ('node_id'),('saved_by_user_id'),('saved_timestamp'),('textbox_id')) except
       select attname from pg_attribute where attrelid='public.node_textboxes_history'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_textboxes_history'::regclass and attnum>0 and not attisdropped except
       values ('batch_id'),('body_json'),('company_id'),('display_order'),
       ('node_id'),('saved_by_user_id'),('saved_timestamp'),('textbox_id')) then
    raise exception 'STOP: node_textboxes_history exact unordered column set drifted';
  end if;

  if (select count(*) from pg_attribute where attrelid='public.node_textbox_seen_snapshots'::regclass and attnum>0 and not attisdropped)<>8
     or exists((values ('body_json'),('company_id'),('node_id'),('seen_timestamp'),
       ('textbox_id'),('textbox_revision'),('textbox_updated_timestamp'),('user_id')) except
       select attname from pg_attribute where attrelid='public.node_textbox_seen_snapshots'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_textbox_seen_snapshots'::regclass and attnum>0 and not attisdropped except
       values ('body_json'),('company_id'),('node_id'),('seen_timestamp'),
       ('textbox_id'),('textbox_revision'),('textbox_updated_timestamp'),('user_id')) then
    raise exception 'STOP: node_textbox_seen_snapshots exact unordered column set drifted';
  end if;

  if (select count(*) from pg_attribute where attrelid='public.recycle_bin_items'::regclass and attnum>0 and not attisdropped)<>9
     or exists((values ('company_id'),('deleted_by_user_id'),('deleted_timestamp'),('object_folder_kind'),
       ('object_id'),('object_kind'),('object_label'),('recycle_bin_item_id'),('restore_payload')) except
       select attname from pg_attribute where attrelid='public.recycle_bin_items'::regclass and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.recycle_bin_items'::regclass and attnum>0 and not attisdropped except
       values ('company_id'),('deleted_by_user_id'),('deleted_timestamp'),('object_folder_kind'),
       ('object_id'),('object_kind'),('object_label'),('recycle_bin_item_id'),('restore_payload')) then
    raise exception 'STOP: recycle_bin_items exact unordered column set drifted';
  end if;

  if exists(
    select 1
    from recycle_bin_items item
    cross join lateral (values
      ('node_textboxes'),
      ('node_textboxes_history'),
      ('node_textbox_seen_snapshots')
    ) as expected(payload_key)
    where jsonb_typeof(item.restore_payload)='object'
      and item.restore_payload ? expected.payload_key
      and jsonb_typeof(item.restore_payload->expected.payload_key)<>'array'
  ) then
    raise exception 'STOP: a Node recycle payload member is not an array';
  end if;
end
$$;

with exact_targets(scope,row_count) as (
  select 'node_textboxes',count(*)
  from node_textboxes
  where body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and body_json->'document'->'content'='[]'::jsonb
    and jsonb_typeof(body_json->'annotations')='array'
  union all
  select 'node_textboxes_history',count(*)
  from node_textboxes_history
  where body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and body_json->'document'->'content'='[]'::jsonb
    and jsonb_typeof(body_json->'annotations')='array'
  union all
  select 'node_textbox_seen_snapshots',count(*)
  from node_textbox_seen_snapshots
  where body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and body_json->'document'->'content'='[]'::jsonb
    and jsonb_typeof(body_json->'annotations')='array'
  union all
  select 'recycle_bin_restore_payloads',count(*)
  from recycle_bin_items item
  cross join lateral (values
    ('node_textboxes'),
    ('node_textboxes_history'),
    ('node_textbox_seen_snapshots')
  ) as expected(payload_key)
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(item.restore_payload)='object'
       and jsonb_typeof(item.restore_payload->expected.payload_key)='array'
      then item.restore_payload->expected.payload_key
      else '[]'::jsonb
    end
  ) as saved(row_value)
  where saved.row_value->'body_json'->>'format'='mango-tiptap-json'
    and saved.row_value->'body_json'->>'schema_version'='1'
    and saved.row_value->'body_json'->'document'->>'type'='doc'
    and saved.row_value->'body_json'->'document'->'content'='[]'::jsonb
    and jsonb_typeof(saved.row_value->'body_json'->'annotations')='array'
),
report(section,identity,status,details,sort_order) as (
  select 'TARGETS',scope,
         case when row_count=0 then 'CLEAR' else 'REPAIR_REQUIRED' end,
         jsonb_build_object('row_count',row_count),
         row_number() over(order by scope)
  from exact_targets
  union all
  select 'FINAL','empty_node_textbox_documents',
         case when sum(row_count)=0 then 'NO_REPAIR_NEEDED' else 'READY_TO_REPAIR' end,
         jsonb_build_object('target_count',sum(row_count)),
         100
  from exact_targets
)
select section,identity,status,details
from report
order by sort_order;

rollback;