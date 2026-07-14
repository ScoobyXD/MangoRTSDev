create table if not exists public.communications_message_read_receipt_signals (
  receipt_scope_type varchar not null,
  receipt_scope_id varchar not null,
  message_id text not null,
  signal_timestamp timestamptz not null,
  created_timestamp timestamptz not null default now(),
  primary key (receipt_scope_type, receipt_scope_id, message_id, signal_timestamp),
  foreign key (receipt_scope_type, receipt_scope_id, message_id)
    references public.communications_message_read_receipt_summaries(receipt_scope_type, receipt_scope_id, message_id) on delete cascade
);

insert into public.communications_message_read_receipt_signals (
  receipt_scope_type, receipt_scope_id, message_id, signal_timestamp
)
select receipt_scope_type, receipt_scope_id, message_id, last_signal_timestamp
from public.communications_message_read_receipt_summaries
on conflict do nothing;
