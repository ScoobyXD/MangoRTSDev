-- Final Node runtime storage. Run only with application writers paused and deploy
-- the matching backend before writers resume. This migration does not retire the
-- three legacy tables; the separately gated operator script does that later.
--
-- The writer-paused delta is intentionally narrow:
-- * copy active legacy Text box projections only when their stable ID is absent
--   from node_textboxes;
-- * delete a legacy seen snapshot only when its current Node exists and no exact
--   projection, final textbox, history row, or content change remains;
-- * preserve every real textbox and migrate every remaining seen snapshot.
do $$
begin
  if current_setting('server_version_num')::integer / 10000 <> 17 then
    raise exception 'STOP: Node final storage cutover requires PostgreSQL 17.x; connected server is %', version();
  end if;
end
$$;

begin;
lock table node_information in share mode;
lock table node_projection_table in share mode;
lock table node_projection_seen_snapshots in share row exclusive mode;
lock table node_textboxes in share row exclusive mode;
lock table node_content_changes in access exclusive mode;

create table if not exists node_textbox_seen_snapshots (
  company_id uuid not null,
  node_id uuid not null,
  textbox_id uuid not null,
  user_id uuid not null,
  body_json jsonb not null,
  textbox_revision bigint not null,
  textbox_updated_timestamp timestamptz not null,
  seen_timestamp timestamptz not null default now(),
  primary key (company_id,node_id,textbox_id,user_id),
  foreign key (company_id,node_id,textbox_id)
    references node_textboxes(company_id,node_id,textbox_id) on delete cascade,
  foreign key (user_id) references users(user_id) on delete cascade,
  constraint node_textbox_seen_snapshots_body_json_chk check (
    body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and jsonb_typeof(body_json->'annotations')='array'
  ),
  constraint node_textbox_seen_snapshots_revision_chk check (textbox_revision >= 0)
);

create or replace function pg_temp.mangorts_node_projection_body(
  legacy_information text
) returns jsonb language plpgsql as $function$
declare
  prefix constant text := '<!-- mango-node-text-block-v1 -->';
  payload jsonb;
  document_text text;
  document_json jsonb;
begin
  if left(legacy_information,length(prefix))=prefix then
    payload:=substring(legacy_information from length(prefix)+1)::jsonb;
    if jsonb_typeof(payload)<>'object' or not (payload ? 'document') then
      raise exception 'invalid legacy Node textbox envelope';
    end if;
    document_text:=payload->>'document';
  else
    document_text:=legacy_information;
  end if;

  if btrim(coalesce(document_text,''))='' then
    return jsonb_build_object(
      'format','mango-tiptap-json',
      'schema_version',1,
      'document',jsonb_build_object('type','doc','content','[]'::jsonb),
      'annotations','[]'::jsonb
    );
  end if;

  document_json:=document_text::jsonb;
  if document_json->>'format'='mango-tiptap-json'
     and document_json->>'schema_version'='1'
     and document_json->'document'->>'type'='doc'
     and (
       not (document_json ? 'annotations')
       or jsonb_typeof(document_json->'annotations')='array'
     ) then
    return document_json || jsonb_build_object(
      'annotations',coalesce(document_json->'annotations','[]'::jsonb)
    );
  end if;
  if document_json->>'type'='doc' then
    return jsonb_build_object(
      'format','mango-tiptap-json',
      'schema_version',1,
      'document',document_json,
      'annotations','[]'::jsonb
    );
  end if;
  raise exception 'legacy Node textbox body is not final TipTap JSON';
exception when others then
  raise exception 'STOP: an active or historical Node textbox cannot be converted exactly; reconcile it before cutover';
end
$function$;

create or replace function pg_temp.mangorts_node_seen_body(
  legacy_information text, current_legacy_information text, current_body jsonb
) returns jsonb language plpgsql as $function$
begin
  if legacy_information is not distinct from current_legacy_information then
    return current_body;
  end if;
  return pg_temp.mangorts_node_projection_body(legacy_information);
end
$function$;

create temporary table mangorts_node_final_cutover_report(
  metric text primary key,
  row_count bigint not null
) on commit drop;

do $$
begin
  if (select count(*) from pg_attribute
      where attrelid='public.node_information'::regclass and attnum>0 and not attisdropped)<>12
     or exists((values ('company_id'),('created_timestamp'),('information'),('information_id'),('node_id'),
       ('save_batch_id'),('save_kind'),('saved_by_display_name'),('saved_by_user_id'),
       ('source_information_id'),('type'),('updated_timestamp')) except
       select attname from pg_attribute where attrelid='public.node_information'::regclass
       and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_information'::regclass
       and attnum>0 and not attisdropped except
       values ('company_id'),('created_timestamp'),('information'),('information_id'),('node_id'),
       ('save_batch_id'),('save_kind'),('saved_by_display_name'),('saved_by_user_id'),
       ('source_information_id'),('type'),('updated_timestamp')) then
    raise exception 'STOP: node_information exact pre-cutover column set drifted';
  end if;

  if (select count(*) from pg_attribute
      where attrelid='public.node_content_changes'::regclass and attnum>0 and not attisdropped)<>11
     or exists((values ('actor_display_name'),('actor_user_id'),('change_id'),('change_type'),
       ('company_id'),('created_timestamp'),('end_offset'),('information_id'),('node_id'),
       ('start_offset'),('text')) except
       select attname from pg_attribute where attrelid='public.node_content_changes'::regclass
       and attnum>0 and not attisdropped)
     or exists(select attname from pg_attribute where attrelid='public.node_content_changes'::regclass
       and attnum>0 and not attisdropped except
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
end
$$;

create temporary table mangorts_node_final_textbox_delta
on commit drop
as
select projection.company_id,
       projection.node_id,
       projection.information_id as textbox_id,
       pg_temp.mangorts_node_projection_body(projection.information) as body_json,
       projection.revision,
       coalesce((
         select max(existing.display_order)
         from node_textboxes existing
         where existing.company_id=projection.company_id
           and existing.node_id=projection.node_id
       ),-1)
       + row_number() over(
           partition by projection.company_id,projection.node_id
           order by projection.created_timestamp,projection.information_id
         ) as display_order,
       projection.created_timestamp,
       projection.updated_timestamp
from node_projection_table projection
where not projection.is_deleted
  and projection.type::text='Text box'
  and not exists(
    select 1 from node_textboxes textbox
    where textbox.company_id=projection.company_id
      and textbox.node_id=projection.node_id
      and textbox.textbox_id=projection.information_id
  );

insert into mangorts_node_final_cutover_report(metric,row_count)
select 'active_legacy_textboxes_copied',count(*)
from mangorts_node_final_textbox_delta;

insert into mangorts_node_final_cutover_report(metric,row_count)
select 'delta_seen_snapshots_migrated',count(*)
from node_projection_seen_snapshots seen
join mangorts_node_final_textbox_delta delta
  on delta.company_id=seen.company_id
 and delta.node_id=seen.node_id
 and delta.textbox_id=seen.information_id;

with removed as (
  delete from node_projection_seen_snapshots seen
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
  )
  returning 1
)
insert into mangorts_node_final_cutover_report(metric,row_count)
select 'stale_seen_snapshots_removed',count(*) from removed;

insert into node_textboxes(
  company_id,node_id,textbox_id,body_json,revision,display_order,
  created_timestamp,updated_timestamp,deleted_timestamp
)
select company_id,node_id,textbox_id,body_json,revision,display_order,
       created_timestamp,updated_timestamp,null
from mangorts_node_final_textbox_delta;

do $$
begin
  if exists(
    select 1
    from mangorts_node_final_textbox_delta delta
    left join node_textboxes textbox
      on textbox.company_id=delta.company_id
     and textbox.node_id=delta.node_id
     and textbox.textbox_id=delta.textbox_id
    where textbox.textbox_id is null
       or textbox.body_json is distinct from delta.body_json
       or textbox.revision is distinct from delta.revision
       or textbox.display_order is distinct from delta.display_order
       or textbox.created_timestamp is distinct from delta.created_timestamp
       or textbox.updated_timestamp is distinct from delta.updated_timestamp
       or textbox.deleted_timestamp is not null
  ) then
    raise exception 'STOP: writer-paused Node textbox delta did not reconcile exactly';
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
          and textbox.deleted_timestamp is null
      )
  ) then
    raise exception 'STOP: an active legacy Node textbox is still missing final storage after the delta copy';
  end if;

  if exists(select 1 from node_content_changes change where not exists(
    select 1 from node_textboxes textbox where textbox.company_id=change.company_id
      and textbox.node_id=change.node_id and textbox.textbox_id=change.information_id)) then
    raise exception 'STOP: node_content_changes contains a row without an exact final Node textbox';
  end if;

  if exists(select 1 from node_projection_seen_snapshots seen where not exists(
    select 1 from node_projection_table projection where projection.company_id=seen.company_id
      and projection.node_id=seen.node_id and projection.information_id=seen.information_id
      and projection.type::text='Text box'))
     or exists(select 1 from node_projection_seen_snapshots seen where not exists(
    select 1 from node_textboxes textbox where textbox.company_id=seen.company_id
      and textbox.node_id=seen.node_id and textbox.textbox_id=seen.information_id)) then
    raise exception 'STOP: a remaining legacy Node seen snapshot lacks its exact Text box projection or final textbox';
  end if;
end
$$;

insert into mangorts_node_final_cutover_report(metric,row_count)
select 'total_legacy_seen_snapshots_migrated',count(*)
from node_projection_seen_snapshots;

insert into node_textbox_seen_snapshots(
  company_id,node_id,textbox_id,user_id,body_json,textbox_revision,textbox_updated_timestamp,seen_timestamp
)
select seen.company_id,seen.node_id,seen.information_id,seen.user_id,
       pg_temp.mangorts_node_seen_body(seen.information,projection.information,textbox.body_json),
       case when seen.information=projection.information
                  and seen.projection_updated_timestamp=projection.updated_timestamp
            then textbox.revision else 0 end,
       seen.projection_updated_timestamp,seen.seen_timestamp
from node_projection_seen_snapshots seen
join node_textboxes textbox on textbox.company_id=seen.company_id and textbox.node_id=seen.node_id
 and textbox.textbox_id=seen.information_id
join node_projection_table projection on projection.company_id=seen.company_id and projection.node_id=seen.node_id
 and projection.information_id=seen.information_id and projection.type::text='Text box'
on conflict (company_id,node_id,textbox_id,user_id) do update set
  body_json=excluded.body_json,
  textbox_revision=excluded.textbox_revision,
  textbox_updated_timestamp=excluded.textbox_updated_timestamp,
  seen_timestamp=excluded.seen_timestamp;

do $$
begin
  if exists((select company_id,node_id,information_id,user_id from node_projection_seen_snapshots
      except select company_id,node_id,textbox_id,user_id from node_textbox_seen_snapshots)
    union all
    (select company_id,node_id,textbox_id,user_id from node_textbox_seen_snapshots
      except select company_id,node_id,information_id,user_id from node_projection_seen_snapshots)) then
    raise exception 'STOP: Node seen-snapshot identity copy did not reconcile exactly';
  end if;
end
$$;

alter table node_content_changes rename column information_id to textbox_id;
alter table node_content_changes
  add constraint node_content_changes_textbox_fk
  foreign key (company_id,node_id,textbox_id)
  references node_textboxes(company_id,node_id,textbox_id) on delete cascade;

create index if not exists idx_node_textbox_seen_snapshots_user
  on node_textbox_seen_snapshots(company_id,user_id,node_id,textbox_id);

drop trigger if exists trg_node_view_user_version_snapshots on node_projection_seen_snapshots;
create trigger trg_node_view_user_version_snapshots
after insert or update or delete on node_textbox_seen_snapshots
for each row execute function mangorts_trg_bump_node_view_user_from_snapshot();

drop trigger if exists trg_node_view_version_information on node_information;
drop trigger if exists trg_node_view_version_projection on node_projection_table;
drop trigger if exists trg_node_view_version_textboxes on node_textboxes;
create trigger trg_node_view_version_textboxes after insert or update or delete on node_textboxes
for each row execute function mangorts_trg_bump_node_view_from_direct_node();
drop trigger if exists trg_node_view_version_textbox_chats on node_textbox_chats;
create trigger trg_node_view_version_textbox_chats after insert or update or delete on node_textbox_chats
for each row execute function mangorts_trg_bump_node_view_from_direct_node();

select 'NODE_FINAL_STORAGE_CUTOVER_COMPLETE' as status,
       (select row_count from mangorts_node_final_cutover_report
         where metric='stale_seen_snapshots_removed') as stale_seen_snapshots_removed,
       (select row_count from mangorts_node_final_cutover_report
         where metric='active_legacy_textboxes_copied') as active_legacy_textboxes_copied,
       (select row_count from mangorts_node_final_cutover_report
         where metric='delta_seen_snapshots_migrated') as delta_seen_snapshots_migrated,
       (select row_count from mangorts_node_final_cutover_report
         where metric='total_legacy_seen_snapshots_migrated') as total_legacy_seen_snapshots_migrated;

commit;
