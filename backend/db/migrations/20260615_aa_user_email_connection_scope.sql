alter table user_email_connections
  add column if not exists connection_scope text not null default 'personal';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_email_connections'::regclass
      and conname = 'user_email_connections_scope_chk'
  ) then
    alter table public.user_email_connections
      add constraint user_email_connections_scope_chk check (connection_scope in ('personal', 'shared'));
  end if;
end $$;
