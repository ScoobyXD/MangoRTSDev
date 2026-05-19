create table if not exists domain_events (
  event_id uuid not null,
  company_id uuid not null,
  stream_type text not null,
  stream_id text not null,
  sequence bigint not null,
  event_type text not null,
  actor_user_id uuid,
  idempotency_key text not null default '',
  payload jsonb not null default '{}'::jsonb,
  published_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  constraint domain_events_stream_type_nonblank_chk check (btrim(stream_type) <> ''),
  constraint domain_events_stream_id_nonblank_chk check (btrim(stream_id) <> ''),
  constraint domain_events_event_type_nonblank_chk check (btrim(event_type) <> ''),
  constraint domain_events_sequence_positive_chk check (sequence > 0),
  primary key (company_id, event_id),
  unique (company_id, stream_type, stream_id, sequence),
  foreign key (actor_user_id) references users (user_id) on delete set null
);

create unique index if not exists idx_domain_events_idempotency_key
  on domain_events(company_id, idempotency_key)
  where btrim(idempotency_key) <> '';

create index if not exists idx_domain_events_stream_sequence
  on domain_events(company_id, stream_type, stream_id, sequence);

create index if not exists idx_domain_events_pending
  on domain_events(created_timestamp, company_id, event_id)
  where published_timestamp is null;

create index if not exists idx_domain_events_company_created
  on domain_events(company_id, created_timestamp desc, event_id desc);