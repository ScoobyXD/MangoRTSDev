do $$
declare
  pk_name text;
  pk_def text;
begin
  if to_regclass('public.user_email_connections') is null then
    return;
  end if;

  select conname, pg_get_constraintdef(oid)
    into pk_name, pk_def
  from pg_constraint
  where conrelid = 'public.user_email_connections'::regclass
    and contype = 'p'
  limit 1;

  if pk_name is not null and pk_def <> 'PRIMARY KEY (user_id, account_email)' then
    execute format('alter table public.user_email_connections drop constraint %I', pk_name);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_email_connections'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, account_email)'
  ) then
    alter table public.user_email_connections add primary key (user_id, account_email);
  end if;

  create unique index if not exists idx_user_email_connections_grant_id
    on public.user_email_connections(grant_id);

  create index if not exists idx_user_email_connections_user_updated
    on public.user_email_connections(user_id, updated_timestamp desc);
end $$;
