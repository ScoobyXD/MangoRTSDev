create table if not exists event_rows (
  event_id uuid not null,
  company_id uuid not null,
  event_type text not null,
  resource_type text not null default '',
  resource_id text not null default '',
  primary_scope text not null default '',
  affected_scopes jsonb not null default '[]'::jsonb,
  actor_user_id uuid,
  idempotency_key text not null default '',
  sequence_scope text not null,
  sequence bigint not null,
  payload jsonb not null default '{}'::jsonb,
  created_timestamp timestamptz not null default now(),
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  attempt_count integer not null default 0,
  last_error text not null default '',
  constraint event_rows_event_type_nonblank_chk check (btrim(event_type) <> ''),
  constraint event_rows_sequence_scope_nonblank_chk check (btrim(sequence_scope) <> ''),
  constraint event_rows_sequence_positive_chk check (sequence > 0),
  constraint event_rows_attempt_count_nonnegative_chk check (attempt_count >= 0),
  constraint event_rows_affected_scopes_array_chk check (jsonb_typeof(affected_scopes) = 'array'),
  constraint event_rows_payload_object_chk check (jsonb_typeof(payload) = 'object'),
  primary key (company_id, event_id),
  unique (company_id, sequence_scope, sequence),
  foreign key (actor_user_id) references users (user_id) on delete set null
);

create unique index if not exists idx_event_rows_idempotency_key
  on event_rows(company_id, idempotency_key)
  where btrim(idempotency_key) <> '';

create index if not exists idx_event_rows_available_unprocessed
  on event_rows(available_at, created_timestamp, company_id, event_id)
  where processed_at is null and processing_started_at is null;

create index if not exists idx_event_rows_processing_started
  on event_rows(processing_started_at)
  where processed_at is null and processing_started_at is not null;

create index if not exists idx_event_rows_scope_sequence
  on event_rows(company_id, sequence_scope, sequence);

