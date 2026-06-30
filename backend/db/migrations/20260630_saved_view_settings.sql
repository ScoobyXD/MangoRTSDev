alter table saved_views
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table saved_views
  drop constraint if exists saved_views_settings_object_chk;

alter table saved_views
  add constraint saved_views_settings_object_chk
  check (jsonb_typeof(settings) = 'object');
