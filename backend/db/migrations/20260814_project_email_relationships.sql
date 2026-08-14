create unique index if not exists idx_email_relationships_one_project_textbox_per_message
  on email_relationships(company_id, email_message_id, resource_id)
  where resource_type='project' and resource_textbox_id is not null;
