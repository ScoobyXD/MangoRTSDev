create table if not exists notification_domain_event_projection_checkpoints (
  company_id uuid primary key,
  checkpoint_timestamp timestamptz not null,
  checkpoint_event_id uuid not null,
  updated_timestamp timestamptz not null default now()
);

