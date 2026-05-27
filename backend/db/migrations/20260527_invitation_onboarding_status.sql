alter table invitations
  add column if not exists cognito_status text not null default 'not_started',
  add column if not exists cognito_error text not null default '',
  add column if not exists invite_email_status text not null default 'not_started',
  add column if not exists invite_email_error text not null default '',
  add column if not exists invite_email_sent_timestamp timestamptz;

update invitations
set cognito_status = case
    when status = 'accepted' then 'created'
    else cognito_status
  end,
  invite_email_status = case
    when status = 'accepted' then 'sent'
    else invite_email_status
  end
where cognito_status = 'not_started'
  and invite_email_status = 'not_started'
  and status = 'accepted';

alter table invitations
  drop constraint if exists invitations_cognito_status_chk;

alter table invitations
  add constraint invitations_cognito_status_chk
  check (cognito_status in ('not_started', 'not_configured', 'created', 'resent', 'existing_mango_user', 'failed'));

alter table invitations
  drop constraint if exists invitations_invite_email_status_chk;

alter table invitations
  add constraint invitations_invite_email_status_chk
  check (invite_email_status in ('not_started', 'not_configured', 'sent', 'failed'));

create index if not exists idx_invitations_company_status_updated
  on invitations(company_id, status, updated_timestamp desc);
