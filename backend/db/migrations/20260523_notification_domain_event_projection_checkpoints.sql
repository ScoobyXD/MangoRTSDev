create table if not exists notification_domain_event_projection_checkpoints (
  company_id uuid primary key,
  checkpoint_timestamp timestamptz not null,
  checkpoint_event_id uuid not null,
  updated_timestamp timestamptz not null default now()
);

drop index if exists idx_notification_events_pending;

alter table notification_events
  drop column if exists processed_timestamp;
