create function pg_temp.v3_email_uuid(value text)
returns uuid language sql immutable strict as $$
select (substr(md5(value),1,8)||'-'||substr(md5(value),9,4)||'-'||
substr(md5(value),13,4)||'-'||substr(md5(value),17,4)||'-'||
substr(md5(value),21,12))::uuid
$$;

create function pg_temp.v3_query_unescape(value text)
returns text language plpgsql immutable strict as $$
declare i integer:=1; decoded bytea:=''::bytea; ch text;
begin
  while i<=char_length(value) loop
    ch:=substr(value,i,1);
    if ch='+' then decoded:=decoded||convert_to(' ','UTF8'); i:=i+1;
    elsif ch='%' then
      if i+2>char_length(value) or substr(value,i+1,2)!~'^[0-9A-Fa-f]{2}$' then
        raise exception 'invalid URL escape in legacy attachment resource ID';
      end if;
      decoded:=decoded||decode(substr(value,i+1,2),'hex'); i:=i+3;
    else decoded:=decoded||convert_to(ch,'UTF8'); i:=i+1;
    end if;
  end loop;
  return btrim(convert_from(decoded,'UTF8'));
end $$;
create function pg_temp.v3_assert_columns(expected_table text,expected_columns text[])
returns void language plpgsql as $$
declare actual_columns text[];
begin
 select array_agg(column_name order by ordinal_position) into actual_columns
 from information_schema.columns
 where table_schema=current_schema() and table_name=expected_table;
 if actual_columns is distinct from expected_columns then
  raise exception 'V3 email target column drift for %: expected %, found %',
   expected_table,expected_columns,actual_columns;
 end if;
end $$;

select pg_temp.v3_assert_columns('email_threads',array[
 'company_id','email_thread_id','email_account_type','personal_user_id',
 'personal_account_email','shared_inbox_id','email_account_email','provider',
 'provider_thread_key','provider_thread_id','root_provider_message_id',
 'download_status','history_complete','fetched_timestamp','last_download_error',
 'created_timestamp','updated_timestamp'
]);
select pg_temp.v3_assert_columns('email_messages',array[
 'company_id','email_message_id','email_thread_id','provider_message_id',
 'message_order','subject','sender_snapshot','to_snapshot','cc_snapshot',
 'bcc_snapshot','reply_to_snapshot','message_timestamp','rich_html_body',
 'text_fallback','snippet','unread','starred','folder_snapshot',
 'folder_id_snapshot','attachment_metadata','download_complete',
 'created_timestamp','updated_timestamp'
]);
select pg_temp.v3_assert_columns('email_relationships',array[
 'company_id','email_relationship_id','email_thread_id','email_message_id',
 'resource_type','resource_id','resource_textbox_id','created_timestamp'
]);
select pg_temp.v3_assert_columns('email_drafts',array[
 'company_id','draft_id','email_relationship_id','source_email_message_id',
 'email_account_type','personal_user_id','personal_account_email','shared_inbox_id',
 'sender_account_email','created_by_user_id','updated_by_user_id','kind',
 'to_recipients','cc_recipients','bcc_recipients','subject','body_editor_html',
 'scheduled_send_timestamp','revision','send_state','send_claim_token',
 'send_idempotency_key','send_idempotency_grant_id','send_idempotency_timestamp',
 'send_claimed_revision','send_claimed_timestamp','sent_email_message_id',
 'sent_provider_message_id','created_timestamp','updated_timestamp','deleted_timestamp'
]);
select pg_temp.v3_assert_columns('email_signatures',array[
 'company_id','signature_id','email_account_type','personal_user_id',
 'personal_account_email','shared_inbox_id','email_account_email','name',
 'body_editor_html','is_default','created_by_user_id','updated_by_user_id',
 'created_timestamp','updated_timestamp'
]);
select pg_temp.v3_assert_columns('email_thread_download_jobs',array[
 'download_job_id','company_id','email_thread_id','download_scope',
 'requested_provider_message_id','requested_by_user_id','status','attempt_count',
 'last_error','available_at','processing_started_at','completed_timestamp',
 'failed_timestamp','created_timestamp','updated_timestamp'
]);
select pg_temp.v3_assert_columns('attachment_relationships',array[
 'attachment_relationship_id','company_id','resource_type','resource_id',
 'attachment_id','information_id','message_id','editor_surface',
 'relationship_kind','created_by_user_id','created_timestamp','deleted_timestamp'
]);


do $$
begin
  if (select count(*) from recycle_bin_items)<>0 then
    raise exception 'approved recycle-bin cleanup drifted from zero rows';
  end if;
end $$;

create temp table v3_projections on commit drop as
select p.company_id,'node'::text resource_type,p.node_id resource_id,
 p.information_id email_relationship_id,p.information::jsonb payload,
 p.created_timestamp,p.updated_timestamp
from node_projection_table p where p.type::text='Attached email' and not p.is_deleted
union all
select p.company_id,'project',p.project_id,p.information_id,p.information::jsonb,
 p.created_timestamp,p.updated_timestamp
from project_projection_table p where p.type::text='Attached email'
union all
select p.company_id,'logic_gate',p.logic_gate_id,p.information_id,p.information::jsonb,
 p.created_timestamp,p.updated_timestamp
from logic_gate_projection_table p where p.type::text='Attached email' and not p.is_deleted;

do $$
begin
  if exists(select 1 from v3_projections where jsonb_typeof(payload)<>'object'
    or btrim(coalesce(payload->>'message_id',''))=''
    or btrim(coalesce(payload->>'thread_id',''))=''
    or jsonb_typeof(payload->'date')<>'number'
    or jsonb_typeof(payload->'from')<>'string') then
    raise exception 'invalid retained Attached-email projection';
  end if;
  if exists(select 1 from v3_projections group by company_id,email_relationship_id having count(*)>1) then
    raise exception 'duplicate retained relationship ID';
  end if;
end $$;

create temp table v3_legacy_threads on commit drop as
select t.*,case t.scope_type when 'personal' then 'personal_email_account'
 else 'shared_email_account' end email_account_type,p.provider
from communications_email_threads t
cross join lateral (
 select count(distinct x.provider) n,min(x.provider) provider from (
  select u.provider from user_email_connections u where t.scope_type='personal'
   and u.user_id=t.personal_user_id and u.account_email=t.personal_account_email
  union
  select c.provider from shared_inboxes s join company_email_connections c
   on c.company_id=s.company_id
   and c.company_email_connection_id=s.company_email_connection_id
   where t.scope_type='shared' and s.company_id=t.company_id
   and s.shared_inbox_id=t.shared_inbox_id
  union
  select e.provider from email_threads e where e.company_id=t.company_id
   and e.email_thread_id=t.email_thread_id
 ) x
) p where p.n=1 and p.provider in('google','microsoft');

do $$
begin
 if (select count(*) from v3_legacy_threads)<>(select count(*) from communications_email_threads) then
  raise exception 'cannot prove one provider for every normalized legacy thread';
 end if;
end $$;

create temp table v3_account_candidates on commit drop as
select distinct p.email_relationship_id,10 priority,t.scope_type,t.personal_user_id,
 t.personal_account_email,t.shared_inbox_id,t.account_email,t.provider
from v3_projections p join communications_email_messages m
 on m.company_id=p.company_id and m.provider_message_id=p.payload->>'message_id'
join v3_legacy_threads t on t.company_id=m.company_id and t.email_thread_id=m.email_thread_id
where nullif(btrim(p.payload->>'email_thread_id'),'') is null
 or (pg_input_is_valid(p.payload->>'email_thread_id','uuid')
 and m.email_thread_id=(p.payload->>'email_thread_id')::uuid)
union
select p.email_relationship_id,20,c.scope_type,c.personal_user_id,
 c.personal_account_email,c.shared_inbox_id,c.account_email,coalesce(u.provider,ce.provider)
from v3_projections p join communications_email_collaborations c
 on c.company_id=p.company_id and c.attached_email_information_id=p.email_relationship_id
left join user_email_connections u on c.scope_type='personal'
 and u.user_id=c.personal_user_id and u.account_email=c.personal_account_email
left join shared_inboxes s on c.scope_type='shared' and s.company_id=c.company_id
 and s.shared_inbox_id=c.shared_inbox_id
left join company_email_connections ce on ce.company_id=s.company_id
 and ce.company_email_connection_id=s.company_email_connection_id
union
select p.email_relationship_id,30,'shared',null,null,s.shared_inbox_id,s.account_email,c.provider
from v3_projections p join shared_inboxes s on s.company_id=p.company_id
 and pg_input_is_valid(p.payload->>'shared_inbox_id','uuid')
 and s.shared_inbox_id=(p.payload->>'shared_inbox_id')::uuid
join company_email_connections c on c.company_id=s.company_id
 and c.company_email_connection_id=s.company_email_connection_id
union
select p.email_relationship_id,40,'personal',cm.user_id,u.account_email,null,u.account_email,u.provider
from v3_projections p join company_memberships cm on cm.company_id=p.company_id
join user_email_connections u on u.user_id=cm.user_id
 and u.account_email=lower(btrim(p.payload->>'account_email'))
where nullif(btrim(p.payload->>'account_email'),'') is not null
 and nullif(btrim(p.payload->>'shared_inbox_id'),'') is null
union
select p.email_relationship_id,50,'personal',n.user_id,u.account_email,null,u.account_email,u.provider
from v3_projections p join communications_email_nodes n on p.resource_type='node'
 and n.company_id=p.company_id and n.node_id=p.resource_id
 and n.message_id=p.payload->>'message_id'
join user_email_connections u on u.user_id=n.user_id
union
select p.email_relationship_id,60,'personal',n.user_id,u.account_email,null,u.account_email,u.provider
from v3_projections p join communications_email_node_attachments n on p.resource_type='node'
 and n.company_id=p.company_id and n.node_id=p.resource_id
 and n.message_id=p.payload->>'message_id'
join user_email_connections u on u.user_id=n.user_id
union
select p.email_relationship_id,70,j.connection_scope,
 case when j.connection_scope='personal' then j.actor_user_id end,
 case when j.connection_scope='personal' then j.account_email end,
 case when j.connection_scope='shared' then j.shared_inbox_id end,
 j.account_email,j.provider
from v3_projections p join communications_email_archive_job_items i
 on i.message_id=p.payload->>'message_id'
join communications_email_archive_jobs j on j.archive_job_id=i.archive_job_id
 and j.company_id=p.company_id;

create temp table v3_projection_accounts on commit drop as
with ranked as (
 select c.*,min(priority) over(partition by email_relationship_id) best
 from v3_account_candidates c where provider in('google','microsoft')
), distinct_best as (
 select distinct email_relationship_id,scope_type,personal_user_id,
  personal_account_email,shared_inbox_id,lower(btrim(account_email)) account_email,provider
 from ranked where priority=best
), counted as (
 select b.*,count(*) over(partition by email_relationship_id) candidate_count from distinct_best b
)
select p.*,
 case when p.resource_type='node' and p.payload->>'block_id'=p.email_relationship_id::text
  then null else nullif(btrim(p.payload->>'block_id'),'') end resource_textbox_id,
 c.scope_type,c.personal_user_id,c.personal_account_email,c.shared_inbox_id,
 c.account_email,c.provider,c.candidate_count
from v3_projections p left join counted c using(email_relationship_id);

do $$
begin
 if exists(select 1 from v3_projection_accounts where candidate_count is distinct from 1) then
  raise exception 'retained relationship does not have exactly one source email account';
 end if;
 if (
  select coalesce(sum(source_count-1),0) from (
   select count(*) source_count from v3_projection_accounts
   group by company_id,provider,scope_type,personal_user_id,personal_account_email,
    shared_inbox_id,payload->>'message_id',resource_type,resource_id,
    coalesce(resource_textbox_id,'') having count(*)>1
  ) duplicate_groups
 )<>28 or exists(
  select 1 from v3_projection_accounts
  group by company_id,provider,scope_type,personal_user_id,personal_account_email,
   shared_inbox_id,payload->>'message_id',resource_type,resource_id,
   coalesce(resource_textbox_id,'')
  having count(*)>1 and not (
   count(*)=2
   and count(*) filter(where resource_type='node'
    and payload->>'block_id'=email_relationship_id::text)=1
   and count(*) filter(where payload->>'created_from_email'='true')=1
   and count(*) filter(where nullif(payload->>'collaboration_id','') is not null)=1
  )
 ) then
  raise exception 'retained duplicate relationship pairs do not match the approved 28 exact pairs';
 end if;
end $$;

create temp table v3_draft_accounts on commit drop as
select d.*,case when d.personal_user_id is not null then 'personal_email_account'
 else 'shared_email_account' end email_account_type,
 coalesce(u.provider,ce.provider) provider,
 lower(btrim(coalesce(d.personal_account_email,s.account_email))) email_account_email,
 (nullif(btrim(d.source_message_id),'') is not null
  and jsonb_typeof(d.reply_to_message)='object'
  and d.reply_to_message->>'id'=btrim(d.source_message_id)
  and nullif(btrim(d.reply_to_message->>'thread_id'),'') is not null) valid_source_snapshot
from communications_email_drafts d
left join user_email_connections u on d.personal_user_id is not null
 and u.user_id=d.personal_user_id and u.account_email=d.personal_account_email
left join shared_inboxes s on s.company_id=d.company_id and s.shared_inbox_id=d.shared_inbox_id
left join company_email_connections ce on ce.company_id=s.company_id
 and ce.company_email_connection_id=s.company_email_connection_id;

do $$
begin
 if exists(select 1 from v3_draft_accounts
  where provider not in('google','microsoft') or email_account_email='') then
  raise exception 'cannot prove exact source email account for every draft';
 end if;
 if (select count(*) from v3_draft_accounts where nullif(btrim(source_message_id),'') is not null
     and not valid_source_snapshot)<>1
  or exists(select 1 from v3_draft_accounts where nullif(btrim(source_message_id),'') is not null
     and not valid_source_snapshot and (kind<>'compose' or deleted_timestamp is null)) then
  raise exception 'expected one soft-deleted compose draft with a stale unusable source ID';
 end if;
end $$;

