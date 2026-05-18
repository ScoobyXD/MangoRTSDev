create index if not exists idx_notifications_recipient_type_unread
  on notifications(recipient_user_id, company_id, notification_type, created_timestamp desc, notification_id desc)
  where read_timestamp is null;
