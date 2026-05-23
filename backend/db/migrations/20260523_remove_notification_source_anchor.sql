do $$
declare
  fk_name text;
begin
  for fk_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    join pg_class table_row
      on table_row.oid = constraint_row.conrelid
    join pg_namespace schema_row
      on schema_row.oid = table_row.relnamespace
    join pg_class referenced_table_row
      on referenced_table_row.oid = constraint_row.confrelid
    join pg_attribute column_row
      on column_row.attrelid = table_row.oid
     and column_row.attnum = any(constraint_row.conkey)
    where constraint_row.contype = 'f'
      and schema_row.nspname = 'public'
      and table_row.relname = 'notifications'
      and column_row.attname = 'source_event_id'
      and referenced_table_row.relname = 'notification_events'
  loop
    execute format('alter table public.notifications drop constraint %I', fk_name);
  end loop;
end $$;

comment on column notifications.source_event_id is
  'Notification source UUID. Notifications V1 writes committed domain_events event_id values for new projected rows, but this column is intentionally not foreign-key constrained so existing historical source UUIDs remain valid.';

create index if not exists idx_notifications_source_event_id
  on notifications(source_event_id);

drop index if exists idx_notification_events_pending;
drop index if exists idx_notification_events_idempotency_key;
drop index if exists idx_notification_events_company_created;

drop table if exists notification_events;
