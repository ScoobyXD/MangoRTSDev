alter table user_email_connections
  drop constraint if exists user_email_connections_pkey;

alter table user_email_connections
  add primary key (user_id, account_email);

create index if not exists idx_user_email_connections_user_updated
  on user_email_connections(user_id, updated_timestamp desc);
