do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.notifications'::regclass and conname = 'notifications_role_chk') then
    alter table notifications drop constraint notifications_role_chk;
  end if;
  alter table notifications add constraint notifications_role_chk check (role = '' or role in ('responsible', 'accountable', 'consulted', 'informed', 'other'));
end $$;
