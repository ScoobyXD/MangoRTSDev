-- Final Node runtime storage. Run only with application writers paused and deploy
-- the matching backend before writers resume. This migration does not retire the
-- three legacy tables; the separately gated operator script does that later.
do $$
begin
  if current_setting('server_version_num')::integer / 10000 <> 17 then
    raise exception 'STOP: Node final storage cutover requires PostgreSQL 17.x; connected server is %', version();
  end if;
end
$$;

begin;
lock table node_content_changes in access exclusive mode;
lock table node_projection_seen_snapshots in share mode;
lock table node_textboxes in share row exclusive mode;

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

do $$
begin
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
    raise exception 'STOP: a legacy Node seen snapshot lacks its exact legacy projection or final textbox';
  end if;
end
$$;

create or replace function pg_temp.mangorts_node_seen_body(
  legacy_information text, current_legacy_information text, current_body jsonb
) returns jsonb language plpgsql as $$
declare
  prefix constant text := '<!-- mango-node-text-block-v1 -->';
  payload jsonb;
  document_text text;
  document_json jsonb;
begin
  if legacy_information=current_legacy_information then
    return current_body;
  end if;
  begin
    if left(legacy_information,length(prefix))=prefix then
      payload:=substring(legacy_information from length(prefix)+1)::jsonb;
      if jsonb_typeof(payload)<>'object' or not (payload ? 'document') then
        raise exception 'invalid envelope';
      end if;
      document_text:=payload->>'document';
    else
      document_text:=legacy_information;
    end if;
    if btrim(coalesce(document_text,''))='' then
      return jsonb_build_object('format','mango-tiptap-json','schema_version',1,
        'document',jsonb_build_object('type','doc','content','[]'::jsonb),'annotations','[]'::jsonb);
    end if;
    document_json:=document_text::jsonb;
    if document_json->>'format'='mango-tiptap-json'
       and document_json->>'schema_version'='1'
       and document_json->'document'->>'type'='doc'
       and jsonb_typeof(document_json->'annotations')='array' then
      return document_json;
    end if;
    if document_json->>'type'='doc' then
      return jsonb_build_object('format','mango-tiptap-json','schema_version',1,
        'document',document_json,'annotations','[]'::jsonb);
    end if;
  exception when others then
    raise exception 'STOP: a historical Node seen baseline cannot be converted exactly; reconcile it before cutover';
  end;
  raise exception 'STOP: a historical Node seen baseline is not final TipTap JSON';
end
$$;

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
commit;
