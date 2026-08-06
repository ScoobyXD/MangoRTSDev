-- Forward-only repair for the exact invalid empty TipTap document emitted by the
-- 2026-08-04 final Node storage conversion. This changes representation only:
-- stable identity, revisions, ordering, annotations, timestamps, deletion state,
-- saved-user identity, and recycle ownership remain unchanged.
begin;

do $$
begin
  if current_setting('server_version_num')::integer / 10000 <> 17 then
    raise exception 'STOP: empty Node textbox repair requires PostgreSQL 17.x; connected server is %',
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

lock table node_textboxes in share row exclusive mode;
lock table node_textboxes_history in share row exclusive mode;
lock table node_textbox_seen_snapshots in share row exclusive mode;
lock table recycle_bin_items in share row exclusive mode;

create or replace function pg_temp.mangorts_repair_empty_node_document(
  input_document jsonb
) returns jsonb
language plpgsql
immutable
strict
as $function$
begin
  if input_document->>'format'='mango-tiptap-json'
     and input_document->>'schema_version'='1'
     and input_document->'document'->>'type'='doc'
     and input_document->'document'->'content'='[]'::jsonb
     and jsonb_typeof(input_document->'annotations')='array' then
    return jsonb_set(
      input_document,
      '{document,content}',
      '[{"type":"paragraph"}]'::jsonb,
      false
    );
  end if;
  return input_document;
end
$function$;

create or replace function pg_temp.mangorts_repair_recycled_node_documents(
  input_payload jsonb
) returns jsonb
language plpgsql
immutable
strict
as $function$
declare
  payload_key text;
  repaired_payload jsonb := input_payload;
  repaired_rows jsonb;
begin
  if jsonb_typeof(repaired_payload)<>'object' then
    return repaired_payload;
  end if;

  foreach payload_key in array array[
    'node_textboxes',
    'node_textboxes_history',
    'node_textbox_seen_snapshots'
  ] loop
    if repaired_payload ? payload_key then
      if jsonb_typeof(repaired_payload->payload_key)<>'array' then
        raise exception 'STOP: recycle payload member % is not an array',payload_key;
      end if;

      select coalesce(
        jsonb_agg(
          case
            when jsonb_typeof(saved.row_value)='object'
             and saved.row_value ? 'body_json'
            then jsonb_set(
              saved.row_value,
              '{body_json}',
              pg_temp.mangorts_repair_empty_node_document(saved.row_value->'body_json'),
              false
            )
            else saved.row_value
          end
          order by saved.ordinality
        ),
        '[]'::jsonb
      )
      into repaired_rows
      from jsonb_array_elements(repaired_payload->payload_key)
        with ordinality as saved(row_value,ordinality);

      repaired_payload:=jsonb_set(
        repaired_payload,
        array[payload_key],
        repaired_rows,
        false
      );
    end if;
  end loop;

  return repaired_payload;
end
$function$;

create temporary table mangorts_empty_node_document_repair_report(
  scope text primary key,
  row_count bigint not null
) on commit drop;

with repaired as (
  update node_textboxes
  set body_json=pg_temp.mangorts_repair_empty_node_document(body_json)
  where body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and body_json->'document'->'content'='[]'::jsonb
    and jsonb_typeof(body_json->'annotations')='array'
  returning 1
)
insert into mangorts_empty_node_document_repair_report(scope,row_count)
select 'node_textboxes',count(*) from repaired;

with repaired as (
  update node_textboxes_history
  set body_json=pg_temp.mangorts_repair_empty_node_document(body_json)
  where body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and body_json->'document'->'content'='[]'::jsonb
    and jsonb_typeof(body_json->'annotations')='array'
  returning 1
)
insert into mangorts_empty_node_document_repair_report(scope,row_count)
select 'node_textboxes_history',count(*) from repaired;

with repaired as (
  update node_textbox_seen_snapshots
  set body_json=pg_temp.mangorts_repair_empty_node_document(body_json)
  where body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and body_json->'document'->'content'='[]'::jsonb
    and jsonb_typeof(body_json->'annotations')='array'
  returning 1
)
insert into mangorts_empty_node_document_repair_report(scope,row_count)
select 'node_textbox_seen_snapshots',count(*) from repaired;

with candidates as materialized (
  select company_id,recycle_bin_item_id,
         pg_temp.mangorts_repair_recycled_node_documents(restore_payload) as repaired_payload
  from recycle_bin_items
  where jsonb_typeof(restore_payload)='object'
    and restore_payload ?| array[
      'node_textboxes',
      'node_textboxes_history',
      'node_textbox_seen_snapshots'
    ]
),
repaired as (
  update recycle_bin_items item
  set restore_payload=candidate.repaired_payload
  from candidates candidate
  where item.company_id=candidate.company_id
    and item.recycle_bin_item_id=candidate.recycle_bin_item_id
    and item.restore_payload is distinct from candidate.repaired_payload
  returning 1
)
insert into mangorts_empty_node_document_repair_report(scope,row_count)
select 'recycle_bin_items',count(*) from repaired;

do $$
begin
  if exists(
    select 1
    from node_textboxes
    where body_json->>'format'='mango-tiptap-json'
      and body_json->>'schema_version'='1'
      and body_json->'document'->>'type'='doc'
      and body_json->'document'->'content'='[]'::jsonb
      and jsonb_typeof(body_json->'annotations')='array'
  ) then
    raise exception 'STOP: node_textboxes empty-document repair did not reconcile';
  end if;

  if exists(
    select 1
    from node_textboxes_history
    where body_json->>'format'='mango-tiptap-json'
      and body_json->>'schema_version'='1'
      and body_json->'document'->>'type'='doc'
      and body_json->'document'->'content'='[]'::jsonb
      and jsonb_typeof(body_json->'annotations')='array'
  ) then
    raise exception 'STOP: node_textboxes_history empty-document repair did not reconcile';
  end if;

  if exists(
    select 1
    from node_textbox_seen_snapshots
    where body_json->>'format'='mango-tiptap-json'
      and body_json->>'schema_version'='1'
      and body_json->'document'->>'type'='doc'
      and body_json->'document'->'content'='[]'::jsonb
      and jsonb_typeof(body_json->'annotations')='array'
  ) then
    raise exception 'STOP: node_textbox_seen_snapshots empty-document repair did not reconcile';
  end if;

  if exists(
    select 1
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
  ) then
    raise exception 'STOP: recycled Node empty-document repair did not reconcile';
  end if;
end
$$;

select scope,row_count
from mangorts_empty_node_document_repair_report
order by scope;

commit;