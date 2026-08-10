alter table node_textboxes
  drop constraint if exists node_textboxes_email_accent_chk,
  drop column if exists email_accent;
