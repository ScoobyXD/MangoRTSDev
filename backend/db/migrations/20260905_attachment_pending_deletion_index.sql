-- Run before releasing event-triggered attachment cleanup. No attachment data changes.
select current_setting('server_version') as server_version,
       case when current_setting('server_version_num')::integer >= 170000
                  and current_setting('server_version_num')::integer < 190000
            then 'READY' else 'STOP: PostgreSQL 17 or 18 required' end as preflight;

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'STOP: PostgreSQL 17 or 18 required';
  end if;
  create index idx_attachments_pending_deletion
    on public.attachments using btree (company_id, attachment_id)
    where (deleted_timestamp is not null);
end;
$$;
