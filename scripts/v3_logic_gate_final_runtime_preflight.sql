-- Read-only Logic Gate final-storage preflight for PostgreSQL 17.x.
-- Run in DBeaver before the copy and again before retirement.
-- This script reports identities and counts only; it does not print content.

begin transaction isolation level repeatable read read only;

select current_setting('server_version') as server_version,
       current_setting('server_version_num')::integer as server_version_num,
       current_setting('transaction_read_only') as transaction_read_only;

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: Logic Gate cutover supports PostgreSQL 17.x only; connected server is %',
      current_setting('server_version');
  end if;
  if to_regclass('public.logic_gate_information') is null
     or to_regclass('public.logic_gate_projection_table') is null
     or to_regclass('public.logic_gate_textboxes') is null
     or to_regclass('public.logic_gate_textboxes_history') is null
     or to_regclass('public.email_relationships') is null then
    raise exception 'STOP: a required Logic Gate cutover table is missing';
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

  if not (
    (
      (select count(*) from pg_attribute
       where attrelid='public.logic_gate_textboxes'::regclass
         and attnum>0 and not attisdropped)=8
      and not exists (
        (values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
                ('logic_gate_id'),('revision'),('textbox_id'),('updated_timestamp'))
        except
        select attname from pg_attribute
        where attrelid='public.logic_gate_textboxes'::regclass
          and attnum>0 and not attisdropped
      )
      and not exists (
        select attname from pg_attribute
        where attrelid='public.logic_gate_textboxes'::regclass
          and attnum>0 and not attisdropped
        except
        values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
               ('logic_gate_id'),('revision'),('textbox_id'),('updated_timestamp')
      )
    )
    or
    (
      (select count(*) from pg_attribute
       where attrelid='public.logic_gate_textboxes'::regclass
         and attnum>0 and not attisdropped)=12
      and not exists (
        (values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
                ('email_accent'),('email_message_id'),('logic_gate_id'),('metadata_revision'),
                ('revision'),('textbox_id'),('title'),('updated_timestamp'))
        except
        select attname from pg_attribute
        where attrelid='public.logic_gate_textboxes'::regclass
          and attnum>0 and not attisdropped
      )
      and not exists (
        select attname from pg_attribute
        where attrelid='public.logic_gate_textboxes'::regclass
          and attnum>0 and not attisdropped
        except
        values ('body_json'),('company_id'),('created_timestamp'),('deleted_timestamp'),
               ('email_accent'),('email_message_id'),('logic_gate_id'),('metadata_revision'),
               ('revision'),('textbox_id'),('title'),('updated_timestamp')
      )
    )
  ) then
    raise exception 'STOP: logic_gate_textboxes must have the exact 8-column pre-migration or exact 12-column final set';
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

create temporary table logic_gate_cutover_problems on commit drop as
select 'active_unsupported_projection_type'::text as reason,
       projection.company_id, projection.logic_gate_id,
       projection.information_id::text as related_id
from logic_gate_projection_table projection
where not projection.is_deleted
  and projection.type::text not in ('Text box','Attached email')
union all
select 'active_textbox_missing_final_row',
       projection.company_id, projection.logic_gate_id,
       projection.information_id::text
from logic_gate_projection_table projection
left join logic_gate_textboxes textbox
  on textbox.company_id=projection.company_id
 and textbox.logic_gate_id=projection.logic_gate_id
 and textbox.textbox_id=projection.information_id::text
 and textbox.deleted_timestamp is null
where not projection.is_deleted
  and projection.type::text='Text box'
  and textbox.textbox_id is null
union all
select 'active_textbox_metadata_not_decodable',
       projection.company_id, projection.logic_gate_id,
       projection.information_id::text
from logic_gate_projection_table projection
where not projection.is_deleted
  and projection.type::text='Text box'
  and (
    not starts_with(projection.information,'<!-- mango-node-text-block-v1 -->')
    or not pg_input_is_valid(
      substring(projection.information from length('<!-- mango-node-text-block-v1 -->')+1),
      'jsonb'
    )
  )
union all
select 'active_attached_email_missing_exact_relationship',
       projection.company_id, projection.logic_gate_id,
       projection.information_id::text
from logic_gate_projection_table projection
left join email_relationships relationship
  on relationship.company_id=projection.company_id
 and relationship.resource_type='logic_gate'
 and relationship.resource_id=projection.logic_gate_id
 and relationship.email_relationship_id=projection.information_id
where not projection.is_deleted
  and projection.type::text='Attached email'
  and relationship.email_relationship_id is null
union all
select 'final_email_relationship_missing_active_legacy_identity',
       relationship.company_id, relationship.resource_id,
       relationship.email_relationship_id::text
from email_relationships relationship
left join logic_gate_projection_table projection
  on projection.company_id=relationship.company_id
 and projection.logic_gate_id=relationship.resource_id
 and projection.information_id=relationship.email_relationship_id
 and projection.type::text='Attached email'
 and not projection.is_deleted
where relationship.resource_type='logic_gate'
  and projection.information_id is null
union all
select 'multiple_live_final_textboxes_for_one_gate',
       textbox.company_id, textbox.logic_gate_id, min(textbox.textbox_id)
from logic_gate_textboxes textbox
where textbox.deleted_timestamp is null
group by textbox.company_id,textbox.logic_gate_id
having count(*)>1
union all
select 'manual_save_missing_final_history',
       information.company_id, information.logic_gate_id,
       coalesce(information.source_information_id,information.information_id)::text
from logic_gate_information information
left join logic_gate_textboxes_history history
  on history.company_id=information.company_id
 and history.logic_gate_id=information.logic_gate_id
 and history.batch_id=information.save_batch_id
 and history.textbox_id=coalesce(information.source_information_id,information.information_id)::text
where information.save_batch_id is not null
  and information.save_kind<>'auto'
  and history.batch_id is null;

select 'summary'::text as row_kind, 'active_textboxes'::text as area,
       count(*)::bigint as value, null::uuid as company_id,
       null::uuid as logic_gate_id, null::text as related_id
from logic_gate_projection_table
where not is_deleted and type::text='Text box'
union all
select 'summary','final_live_textboxes',count(*),null,null,null
from logic_gate_textboxes where deleted_timestamp is null
union all
select 'summary','active_attached_emails',count(*),null,null,null
from logic_gate_projection_table
where not is_deleted and type::text='Attached email'
union all
select 'summary','final_email_relationships',count(*),null,null,null
from email_relationships where resource_type='logic_gate'
union all
select 'summary','manual_save_rows',count(*),null,null,null
from logic_gate_information
where save_batch_id is not null and save_kind<>'auto'
union all
select 'summary','problems',count(*),null,null,null
from logic_gate_cutover_problems
union all
select 'problem',reason,null,company_id,logic_gate_id,related_id
from logic_gate_cutover_problems
order by row_kind desc,area,company_id,logic_gate_id,related_id;

select case when exists(select 1 from logic_gate_cutover_problems)
            then 'STOP_AND_REVIEW'
            else 'READY_FOR_LOGIC_GATE_SCHEMA_AND_COPY' end as status;

rollback;
