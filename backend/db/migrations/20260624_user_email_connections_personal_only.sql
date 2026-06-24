do $$
begin
  if to_regclass('public.user_email_connections') is null then
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_email_connections'
      and column_name = 'connection_scope'
  ) then
    if to_regclass('public.company_email_connections') is not null
       and to_regclass('public.shared_inboxes') is not null then
      with ranked_connections as (
        select
          inbox.company_id,
          inbox.account_email,
          connection.user_id as connected_by_user_id,
          connection.provider,
          connection.grant_id,
          connection.status,
          connection.created_timestamp,
          connection.updated_timestamp,
          row_number() over (
            partition by inbox.company_id, inbox.account_email
            order by
              case connection.status when 'connected' then 1 when 'reauth_required' then 2 else 3 end,
              connection.updated_timestamp desc
          ) as rn
        from public.shared_inboxes inbox
        join public.user_email_connections connection
          on connection.account_email = inbox.account_email
         and connection.connection_scope = 'shared'
      )
      insert into public.company_email_connections (
        company_email_connection_id,
        company_id,
        provider,
        account_email,
        grant_id,
        status,
        connected_by_user_id,
        created_timestamp,
        updated_timestamp
      )
      select
        md5('company_email_connection:' || company_id::text || ':' || account_email)::uuid,
        company_id,
        provider,
        account_email,
        grant_id,
        status,
        connected_by_user_id,
        created_timestamp,
        updated_timestamp
      from ranked_connections
      where rn = 1
      on conflict (company_id, account_email) do update set
        provider = excluded.provider,
        grant_id = excluded.grant_id,
        status = excluded.status,
        connected_by_user_id = excluded.connected_by_user_id,
        updated_timestamp = excluded.updated_timestamp;

      update public.shared_inboxes inbox
      set company_email_connection_id = connection.company_email_connection_id,
          updated_timestamp = now()
      from public.company_email_connections connection
      where connection.company_id = inbox.company_id
        and connection.account_email = inbox.account_email
        and inbox.company_email_connection_id is null;

      delete from public.user_email_connections
      where connection_scope <> 'personal';

      alter table public.user_email_connections
        drop constraint if exists user_email_connections_scope_chk;

      alter table public.user_email_connections
        drop column if exists connection_scope;
    end if;
  end if;
end $$;
