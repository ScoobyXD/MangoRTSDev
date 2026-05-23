create table if not exists notification_events (
  event_id uuid not null,
  company_id uuid,
  actor_user_id uuid,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  idempotency_key text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_timestamp timestamptz not null default now(),
  constraint notification_events_type_nonblank_chk check (btrim(event_type) <> ''),
  constraint notification_events_entity_type_nonblank_chk check (btrim(entity_type) <> ''),
  constraint notification_events_entity_id_nonblank_chk check (btrim(entity_id) <> ''),
  constraint notification_events_payload_object_chk check (jsonb_typeof(payload) = 'object'),
  primary key (event_id),
  foreign key (actor_user_id) references users (user_id) on delete set null
);

create unique index if not exists idx_notification_events_idempotency_key
  on notification_events(idempotency_key)
  where btrim(idempotency_key) <> '';

create index if not exists idx_notification_events_company_created
  on notification_events(company_id, created_timestamp desc, event_id desc);

create table if not exists notifications (
  notification_id uuid not null,
  company_id uuid,
  recipient_user_id uuid not null,
  actor_user_id uuid,
  notification_type text not null,
  source_event_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  title text not null,
  body_preview text not null default '',
  surface text not null default '',
  role text not null default '',
  logic_gate_id text not null default '',
  node_id text not null default '',
  read_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  constraint notifications_type_nonblank_chk check (btrim(notification_type) <> ''),
  constraint notifications_entity_type_nonblank_chk check (btrim(entity_type) <> ''),
  constraint notifications_entity_id_nonblank_chk check (btrim(entity_id) <> ''),
  constraint notifications_title_nonblank_chk check (btrim(title) <> ''),
  constraint notifications_surface_chk check (surface = '' or surface in ('r_inbox', 'aci_inbox', 'my_triage', 'shared_triage')),
  constraint notifications_role_chk check (role = '' or role in ('responsible', 'accountable', 'consulted', 'informed')),
  primary key (notification_id),
  foreign key (recipient_user_id) references users (user_id) on delete cascade,
  foreign key (actor_user_id) references users (user_id) on delete set null,
  foreign key (source_event_id) references notification_events (event_id) on delete cascade
);

alter table notifications add column if not exists surface text not null default '';
alter table notifications add column if not exists role text not null default '';
alter table notifications add column if not exists logic_gate_id text not null default '';
alter table notifications add column if not exists node_id text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.notifications'::regclass and conname = 'notifications_surface_chk') then
    alter table notifications add constraint notifications_surface_chk check (surface = '' or surface in ('r_inbox', 'aci_inbox', 'my_triage', 'shared_triage'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notifications'::regclass and conname = 'notifications_role_chk') then
    alter table notifications add constraint notifications_role_chk check (role = '' or role in ('responsible', 'accountable', 'consulted', 'informed'));
  end if;
end $$;

create unique index if not exists idx_notifications_dedupe
  on notifications(recipient_user_id, source_event_id, notification_type, entity_type, entity_id);

create index if not exists idx_notifications_recipient_created
  on notifications(recipient_user_id, created_timestamp desc, notification_id desc);

create index if not exists idx_notifications_recipient_company_created
  on notifications(recipient_user_id, company_id, created_timestamp desc, notification_id desc);

create index if not exists idx_notifications_recipient_unread
  on notifications(recipient_user_id, created_timestamp desc, notification_id desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_company_unread
  on notifications(recipient_user_id, company_id, created_timestamp desc, notification_id desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_summary_unread
  on notifications(recipient_user_id, company_id, surface, role, created_timestamp desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_logic_gate_unread
  on notifications(recipient_user_id, company_id, logic_gate_id, node_id, role, created_timestamp desc)
  where read_timestamp is null and btrim(logic_gate_id) <> '';

