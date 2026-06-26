alter table company_memberships
  drop constraint if exists company_memberships_role_chk;

alter table company_memberships
  add constraint company_memberships_role_chk
  check (role in ('dev_admin', 'company_admin', 'company_manager', 'company_user'));

alter table invitations
  drop constraint if exists invitations_role_chk;

alter table invitations
  add constraint invitations_role_chk
  check (role in ('company_admin', 'company_manager', 'company_user'));
