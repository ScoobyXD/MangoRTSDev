alter table notifications
  add column if not exists information_id text not null default '';
