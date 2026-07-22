alter table notifications
  add column if not exists priority smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notifications_priority_chk'
      and conrelid = 'notifications'::regclass
  ) then
    alter table notifications
      add constraint notifications_priority_chk
      check (priority is null or priority between 1 and 5);
  end if;
end
$$;
