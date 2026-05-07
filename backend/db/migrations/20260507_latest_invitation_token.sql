with ranked_pending_invitations as (
  select
    invitation_id,
    row_number() over (
      partition by company_id, email
      order by created_timestamp desc, invitation_id desc
    ) as rn
  from invitations
  where status = 'pending'
)
update invitations i
set status = 'revoked',
    updated_timestamp = now()
from ranked_pending_invitations ranked
where i.invitation_id = ranked.invitation_id
  and ranked.rn > 1;

create unique index if not exists idx_invitations_one_pending_company_email
  on invitations(company_id, email)
  where status = 'pending';
