create table if not exists communications_message_read_statuses (
  user_id uuid not null,
  message_id text not null,
  thread_id text not null default '',
  status text not null default 'likely_read',
  signal_count integer not null default 1,
  first_signal_timestamp timestamptz not null,
  last_signal_timestamp timestamptz not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_message_read_statuses_message_id_chk check (btrim(message_id) <> ''),
  constraint communications_message_read_statuses_status_chk check (status in ('likely_read', 'read')),
  constraint communications_message_read_statuses_signal_count_chk check (signal_count >= 0),
  primary key (user_id, message_id),
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_communications_message_read_statuses_user_thread
  on communications_message_read_statuses(user_id, thread_id)
  where btrim(thread_id) <> '';

create index if not exists idx_communications_message_read_statuses_user_latest
  on communications_message_read_statuses(user_id, last_signal_timestamp desc);
