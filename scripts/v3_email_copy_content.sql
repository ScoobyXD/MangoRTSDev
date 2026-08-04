create temp table v3_thread_seed_raw on commit drop as
select 10 priority,'legacy'::text source_kind,t.email_thread_id::text source_key,
 t.company_id,t.email_account_type,t.personal_user_id,t.personal_account_email,
 t.shared_inbox_id,lower(btrim(t.account_email)) email_account_email,t.provider,
 t.provider_thread_key,t.provider_thread_id,t.root_provider_message_id,
 t.download_status,t.history_complete,t.fetched_at fetched_timestamp,
 t.last_download_error,t.created_timestamp,t.updated_timestamp,
 t.email_thread_id preferred_email_thread_id
from v3_legacy_threads t
union all
select 20,'projection',a.email_relationship_id::text,a.company_id,
 case a.scope_type when 'personal' then 'personal_email_account'
 else 'shared_email_account' end,a.personal_user_id,a.personal_account_email,
 a.shared_inbox_id,a.account_email,a.provider,'thread:'||(a.payload->>'thread_id'),
 a.payload->>'thread_id',a.payload->>'message_id','partial',false,null,'',
 a.created_timestamp,a.updated_timestamp,null
from v3_projection_accounts a
union all
select 30,'draft',d.draft_id,d.company_id,d.email_account_type,d.personal_user_id,
 d.personal_account_email,d.shared_inbox_id,d.email_account_email,d.provider,
 'thread:'||(d.reply_to_message->>'thread_id'),d.reply_to_message->>'thread_id',
 d.reply_to_message->>'id','partial',false,null,'',d.created_timestamp,d.updated_timestamp,null
from v3_draft_accounts d where d.valid_source_snapshot;

create temp table v3_thread_desired on commit drop as
with ranked as (
 select s.*,row_number() over(partition by company_id,email_account_type,
  coalesce(personal_user_id::text,''),coalesce(personal_account_email,''),
  coalesce(shared_inbox_id::text,''),provider,provider_thread_key
  order by priority,created_timestamp,source_kind,source_key) source_rank,
 (min(preferred_email_thread_id::text) over(partition by company_id,email_account_type,
  coalesce(personal_user_id::text,''),coalesce(personal_account_email,''),
  coalesce(shared_inbox_id::text,''),provider,provider_thread_key))::uuid legacy_thread_id
 from v3_thread_seed_raw s
), chosen as (select * from ranked where source_rank=1)
select c.*,coalesce(e.email_thread_id,c.legacy_thread_id,
 pg_temp.v3_email_uuid('v3-email-thread:'||c.company_id||':'||c.email_account_type||':'||
 coalesce(c.personal_user_id::text,'')||':'||coalesce(c.personal_account_email,'')||':'||
 coalesce(c.shared_inbox_id::text,'')||':'||c.provider||':'||c.provider_thread_key)
) email_thread_id
from chosen c left join email_threads e on e.company_id=c.company_id
 and e.email_account_type=c.email_account_type and e.provider=c.provider
 and e.provider_thread_key=c.provider_thread_key
 and coalesce(e.personal_user_id::text,'')=coalesce(c.personal_user_id::text,'')
 and coalesce(e.personal_account_email,'')=coalesce(c.personal_account_email,'')
 and coalesce(e.shared_inbox_id::text,'')=coalesce(c.shared_inbox_id::text,'');

insert into email_threads(company_id,email_thread_id,email_account_type,personal_user_id,
 personal_account_email,shared_inbox_id,email_account_email,provider,provider_thread_key,
 provider_thread_id,root_provider_message_id,download_status,history_complete,
 fetched_timestamp,last_download_error,created_timestamp,updated_timestamp)
select company_id,email_thread_id,email_account_type,personal_user_id,
 personal_account_email,shared_inbox_id,email_account_email,provider,provider_thread_key,
 provider_thread_id,root_provider_message_id,download_status,history_complete,
 fetched_timestamp,last_download_error,created_timestamp,updated_timestamp
from v3_thread_desired
on conflict(company_id,email_thread_id) do update set
 email_account_type=excluded.email_account_type,personal_user_id=excluded.personal_user_id,
 personal_account_email=excluded.personal_account_email,shared_inbox_id=excluded.shared_inbox_id,
 email_account_email=excluded.email_account_email,provider=excluded.provider,
 provider_thread_key=excluded.provider_thread_key,provider_thread_id=excluded.provider_thread_id,
 root_provider_message_id=excluded.root_provider_message_id,
 download_status=excluded.download_status,history_complete=excluded.history_complete,
 fetched_timestamp=excluded.fetched_timestamp,last_download_error=excluded.last_download_error,
 created_timestamp=least(email_threads.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_threads.updated_timestamp,excluded.updated_timestamp);

create temp table v3_thread_map on commit drop as
select s.source_kind,s.source_key,s.company_id,d.email_thread_id,d.email_account_type,
 d.personal_user_id,d.personal_account_email,d.shared_inbox_id,d.provider,d.provider_thread_key
from v3_thread_seed_raw s join v3_thread_desired d on d.company_id=s.company_id
 and d.email_account_type=s.email_account_type and d.provider=s.provider
 and d.provider_thread_key=s.provider_thread_key
 and coalesce(d.personal_user_id::text,'')=coalesce(s.personal_user_id::text,'')
 and coalesce(d.personal_account_email,'')=coalesce(s.personal_account_email,'')
 and coalesce(d.shared_inbox_id::text,'')=coalesce(s.shared_inbox_id::text,'');

create temp table v3_message_seed_raw on commit drop as
select 10 priority,'legacy'::text source_kind,m.email_message_id::text source_key,
 m.company_id,map.email_thread_id,m.provider_message_id,m.message_order,m.subject,
 m.sender_snapshot,m.to_snapshot,m.cc_snapshot,m.bcc_snapshot,m.reply_to_snapshot,
 case when m.message_timestamp<=0 then null when m.message_timestamp>100000000000
  then to_timestamp(m.message_timestamp::double precision/1000.0)
  else to_timestamp(m.message_timestamp::double precision) end message_timestamp,
 m.rich_html_body,m.text_fallback,m.snippet,m.unread,m.starred,m.folder_snapshot,
 m.folder_id_snapshot,m.attachment_metadata,m.download_complete,m.created_timestamp,
 m.updated_timestamp,m.email_message_id preferred_email_message_id
from communications_email_messages m join v3_thread_map map
 on map.source_kind='legacy' and map.company_id=m.company_id
 and map.source_key=m.email_thread_id::text;

create temp table v3_projection_snapshots on commit drop as
select a.*,s.priority,s.source_key,s.snapshot
from v3_projection_accounts a cross join lateral (
 select x.* from (
  select 20 priority,'collaboration:'||c.collaboration_id source_key,c.message_snapshot snapshot
  from communications_email_collaborations c where c.company_id=a.company_id
   and c.attached_email_information_id=a.email_relationship_id
   and c.latest_message_id=a.payload->>'message_id'
  union all
  select 30,'email_node:'||n.node_id||':'||n.message_id,n.message
  from communications_email_nodes n where a.resource_type='node'
   and n.company_id=a.company_id and n.node_id=a.resource_id
   and n.message_id=a.payload->>'message_id'
  union all
  select 40,'email_attachment:'||n.node_id||':'||n.message_id,n.message
  from communications_email_node_attachments n where a.resource_type='node'
   and n.company_id=a.company_id and n.node_id=a.resource_id
   and n.message_id=a.payload->>'message_id'
  union all select 50,'projection:'||a.email_relationship_id,a.payload
 ) x where jsonb_typeof(x.snapshot)='object'
 and coalesce(x.snapshot->>'id',a.payload->>'message_id')=a.payload->>'message_id'
 order by x.priority,x.source_key limit 1
) s;

insert into v3_message_seed_raw
select s.priority,'projection',s.email_relationship_id::text,s.company_id,map.email_thread_id,
 s.payload->>'message_id',0,coalesce(s.snapshot->>'subject',''),
 case when jsonb_typeof(s.snapshot->'from')='array' then s.snapshot->'from'
 when jsonb_typeof(s.snapshot->'from')='string' and btrim(s.snapshot->>'from')<>'' then
  case when s.snapshot->>'from'~'^.* <[^<>]+>$' then
   jsonb_build_array(jsonb_build_object(
    'name',btrim(regexp_replace(s.snapshot->>'from',' <[^<>]+>$','')),
    'email',lower(btrim(substring(s.snapshot->>'from' from '<([^<>]+)>$')))))
  else jsonb_build_array(jsonb_build_object('name','','email',lower(btrim(s.snapshot->>'from')))) end
 else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'to')='array' then s.snapshot->'to' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'cc')='array' then s.snapshot->'cc' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'bcc')='array' then s.snapshot->'bcc' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'reply_to')='array' then s.snapshot->'reply_to' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'date')='number' then
  case when (s.snapshot->>'date')::numeric>100000000000
   then to_timestamp((s.snapshot->>'date')::double precision/1000.0)
   else to_timestamp((s.snapshot->>'date')::double precision) end else null end,
 coalesce(s.snapshot->>'body',''),'',coalesce(s.snapshot->>'snippet',''),
 case when s.snapshot->>'unread' in('true','false') then (s.snapshot->>'unread')::boolean else false end,
 case when s.snapshot->>'starred' in('true','false') then (s.snapshot->>'starred')::boolean else false end,
 case when jsonb_typeof(s.snapshot->'folders')='array' then s.snapshot->'folders' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'folder_ids')='array' then s.snapshot->'folder_ids' else '[]'::jsonb end,
 case when jsonb_typeof(s.snapshot->'attachments')='array' then s.snapshot->'attachments' else '[]'::jsonb end,
 case when s.snapshot->>'download_complete' in('true','false')
  then (s.snapshot->>'download_complete')::boolean else false end,
 s.created_timestamp,s.updated_timestamp,null
from v3_projection_snapshots s join v3_thread_map map on map.source_kind='projection'
 and map.company_id=s.company_id and map.source_key=s.email_relationship_id::text;

insert into v3_message_seed_raw
select 60,'draft',d.draft_id,d.company_id,map.email_thread_id,
 d.reply_to_message->>'id',0,coalesce(d.reply_to_message->>'subject',''),
 case when jsonb_typeof(d.reply_to_message->'from')='array' then d.reply_to_message->'from' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'to')='array' then d.reply_to_message->'to' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'cc')='array' then d.reply_to_message->'cc' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'bcc')='array' then d.reply_to_message->'bcc' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'reply_to')='array' then d.reply_to_message->'reply_to' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'date')='number' then
  case when (d.reply_to_message->>'date')::numeric>100000000000
   then to_timestamp((d.reply_to_message->>'date')::double precision/1000.0)
   else to_timestamp((d.reply_to_message->>'date')::double precision) end else null end,
 coalesce(d.reply_to_message->>'body',''),'',coalesce(d.reply_to_message->>'snippet',''),
 case when d.reply_to_message->>'unread' in('true','false')
  then (d.reply_to_message->>'unread')::boolean else false end,
 case when d.reply_to_message->>'starred' in('true','false')
  then (d.reply_to_message->>'starred')::boolean else false end,
 case when jsonb_typeof(d.reply_to_message->'folders')='array'
  then d.reply_to_message->'folders' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'folder_ids')='array'
  then d.reply_to_message->'folder_ids' else '[]'::jsonb end,
 case when jsonb_typeof(d.reply_to_message->'attachments')='array'
  then d.reply_to_message->'attachments' else '[]'::jsonb end,
 case when d.reply_to_message->>'download_complete' in('true','false')
  then (d.reply_to_message->>'download_complete')::boolean else false end,
 d.created_timestamp,d.updated_timestamp,null
from v3_draft_accounts d join v3_thread_map map on map.source_kind='draft'
 and map.company_id=d.company_id and map.source_key=d.draft_id
where d.valid_source_snapshot;

create temp table v3_message_desired on commit drop as
with ranked as (
 select s.*,row_number() over(partition by company_id,email_thread_id,provider_message_id
  order by priority,created_timestamp,source_kind,source_key) source_rank,
 (min(preferred_email_message_id::text) over(partition by company_id,email_thread_id,provider_message_id))::uuid
  legacy_message_id
 from v3_message_seed_raw s
), chosen as (select * from ranked where source_rank=1),
numbered as (
 select c.*,row_number() over(partition by company_id,email_thread_id
  order by created_timestamp,provider_message_id) synthetic_order from chosen c
), maximums as (
 select n.company_id,n.email_thread_id,coalesce(max(l.message_order),-1) maximum_legacy_order
 from numbered n left join v3_message_seed_raw l on l.company_id=n.company_id
  and l.email_thread_id=n.email_thread_id and l.priority=10
 group by n.company_id,n.email_thread_id
)
select n.*,coalesce(e.email_message_id,n.legacy_message_id,
 pg_temp.v3_email_uuid('v3-email-message:'||n.company_id||':'||
 n.email_thread_id||':'||n.provider_message_id)) email_message_id,
 case when n.priority=10 then n.message_order
  when e.email_message_id is not null then e.message_order
  else m.maximum_legacy_order+n.synthetic_order end resolved_message_order
from numbered n join maximums m using(company_id,email_thread_id)
left join email_messages e on e.company_id=n.company_id
 and e.email_thread_id=n.email_thread_id and e.provider_message_id=n.provider_message_id;

insert into email_messages(company_id,email_message_id,email_thread_id,provider_message_id,
 message_order,subject,sender_snapshot,to_snapshot,cc_snapshot,bcc_snapshot,
 reply_to_snapshot,message_timestamp,rich_html_body,text_fallback,snippet,unread,
 starred,folder_snapshot,folder_id_snapshot,attachment_metadata,download_complete,
 created_timestamp,updated_timestamp)
select company_id,email_message_id,email_thread_id,provider_message_id,
 resolved_message_order,subject,sender_snapshot,to_snapshot,cc_snapshot,bcc_snapshot,
 reply_to_snapshot,message_timestamp,rich_html_body,text_fallback,snippet,unread,
 starred,folder_snapshot,folder_id_snapshot,attachment_metadata,download_complete,
 created_timestamp,updated_timestamp
from v3_message_desired
on conflict(company_id,email_message_id) do update set
 email_thread_id=excluded.email_thread_id,provider_message_id=excluded.provider_message_id,
 message_order=excluded.message_order,subject=excluded.subject,
 sender_snapshot=excluded.sender_snapshot,to_snapshot=excluded.to_snapshot,
 cc_snapshot=excluded.cc_snapshot,bcc_snapshot=excluded.bcc_snapshot,
 reply_to_snapshot=excluded.reply_to_snapshot,message_timestamp=excluded.message_timestamp,
 rich_html_body=excluded.rich_html_body,text_fallback=excluded.text_fallback,
 snippet=excluded.snippet,unread=excluded.unread,starred=excluded.starred,
 folder_snapshot=excluded.folder_snapshot,folder_id_snapshot=excluded.folder_id_snapshot,
 attachment_metadata=excluded.attachment_metadata,download_complete=excluded.download_complete,
 created_timestamp=least(email_messages.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_messages.updated_timestamp,excluded.updated_timestamp);

