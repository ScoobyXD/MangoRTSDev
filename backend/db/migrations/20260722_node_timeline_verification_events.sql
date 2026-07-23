begin;

create table if not exists node_timeline_events (
  company_id uuid not null,
  event_id uuid not null,
  node_id uuid not null,
  event_type text not null,
  actor_user_id uuid,
  actor_display_name text not null,
  from_logic_gate_id uuid,
  from_logic_gate_name text not null default '',
  to_logic_gate_id uuid,
  to_logic_gate_name text not null default '',
  idempotency_key text not null default '',
  created_timestamp timestamptz not null default now(),
  constraint node_timeline_events_type_chk check (event_type in ('logic_gate_transfer', 'verification_request')),
  constraint node_timeline_events_actor_name_chk check (btrim(actor_display_name) <> ''),
  constraint node_timeline_events_transfer_chk check (
    (event_type='logic_gate_transfer' and from_logic_gate_id is not null and to_logic_gate_id is not null and from_logic_gate_id<>to_logic_gate_id and btrim(from_logic_gate_name)<>'' and btrim(to_logic_gate_name)<>'')
    or (event_type='verification_request' and from_logic_gate_id is null and to_logic_gate_id is null)
  ),
  primary key (company_id, event_id),
  unique (company_id, node_id, event_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

create unique index if not exists idx_node_timeline_events_idempotency
  on node_timeline_events(company_id, node_id, event_type, idempotency_key)
  where btrim(idempotency_key)<>'';

create index if not exists idx_node_timeline_events_node_created
  on node_timeline_events(company_id, node_id, created_timestamp desc, event_id desc);

create table if not exists node_timeline_verification_recipients (
  company_id uuid not null,
  node_id uuid not null,
  event_id uuid not null,
  user_id uuid not null,
  user_display_name text not null,
  completed_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  constraint node_timeline_verification_recipients_name_chk check (btrim(user_display_name)<>''),
  primary key (company_id, event_id, user_id),
  foreign key (company_id, node_id, event_id) references node_timeline_events(company_id, node_id, event_id) on delete cascade
);

create index if not exists idx_node_timeline_verification_recipient_user
  on node_timeline_verification_recipients(company_id, user_id, completed_timestamp, created_timestamp desc);

drop trigger if exists trg_node_view_version_timeline_events on node_timeline_events;
create trigger trg_node_view_version_timeline_events after insert or update or delete on node_timeline_events
for each row execute function mangorts_trg_bump_node_view_from_direct_node();

drop trigger if exists trg_node_view_version_timeline_recipients on node_timeline_verification_recipients;
create trigger trg_node_view_version_timeline_recipients after insert or update or delete on node_timeline_verification_recipients
for each row execute function mangorts_trg_bump_node_view_from_direct_node();

commit;
