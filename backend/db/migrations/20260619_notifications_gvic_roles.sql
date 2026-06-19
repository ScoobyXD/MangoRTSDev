alter table notifications
  drop constraint if exists notifications_role_chk;

update notifications
set role = case role
  when 'responsible' then 'generated'
  when 'accountable' then 'verified'
  else role
end
where role in ('responsible', 'accountable');

alter table notifications
  add constraint notifications_role_chk
  check (role = '' or role in ('generated', 'verified', 'consulted', 'informed', 'other'));
