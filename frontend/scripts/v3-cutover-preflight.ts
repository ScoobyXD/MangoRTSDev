import pg from "pg";
const { Pool } = pg;
type Check={category:string;severity?:"blocker"|"cleanup"|"review";sql:string};
const uuid="^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const legacyEmailMailboxInventory=`with projection as materialized(
 select p.company_id,p.node_id,p.information_id,
  case when pg_input_is_valid(p.information,'jsonb') then case when jsonb_typeof(p.information::jsonb)='object' then p.information::jsonb end end payload
 from node_projection_table p
 where p.type='Attached email'::information_type and not p.is_deleted
),valid as(
 select p.*,
  case when coalesce(p.payload->>'email_thread_id','')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (p.payload->>'email_thread_id')::uuid end source_email_thread_id
 from projection p
 where p.payload is not null and btrim(coalesce(p.payload->>'message_id',''))<>''
  and (coalesce(p.payload->>'email_thread_id','')='' or p.payload->>'email_thread_id'~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  and (coalesce(p.payload->>'shared_inbox_id','')='' or p.payload->>'shared_inbox_id'~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  and (coalesce(p.payload->>'account_email','')='' or p.payload->>'account_email'=lower(btrim(p.payload->>'account_email')))
  and (coalesce(p.payload->>'date','')='' or pg_input_is_valid(p.payload->>'date','double precision'))
),needing as(
 select p.* from valid p
 where not exists(
  select 1 from communications_email_messages m
  where m.company_id=p.company_id and m.provider_message_id=p.payload->>'message_id'
   and (p.source_email_thread_id is null or m.email_thread_id=p.source_email_thread_id)
 )
),candidate as(
 select n.company_id,n.node_id,n.information_id,c.scope_type,
  c.personal_user_id,c.personal_account_email,c.shared_inbox_id,c.account_email,x.provider
 from needing n join communications_email_collaborations c
  on (c.company_id,c.node_id,c.attached_email_information_id)=(n.company_id,n.node_id,n.information_id)
 join user_email_connections x
  on c.scope_type='personal' and (x.user_id,x.account_email)=(c.personal_user_id,c.personal_account_email)
 union
 select n.company_id,n.node_id,n.information_id,c.scope_type,
  null::uuid,null::text,c.shared_inbox_id,c.account_email,x.provider
 from needing n join communications_email_collaborations c
  on (c.company_id,c.node_id,c.attached_email_information_id)=(n.company_id,n.node_id,n.information_id)
 join shared_inboxes s
  on c.scope_type='shared' and (s.company_id,s.shared_inbox_id)=(c.company_id,c.shared_inbox_id)
 join company_email_connections x
  on (x.company_id,x.company_email_connection_id)=(s.company_id,s.company_email_connection_id)
 union
 select n.company_id,n.node_id,n.information_id,t.scope_type mailbox_scope_type,
  t.personal_user_id,t.personal_account_email,t.shared_inbox_id,t.account_email mailbox_account_email,c.provider
 from needing n join communications_email_threads t on (t.company_id,t.email_thread_id)=(n.company_id,n.source_email_thread_id)
 join user_email_connections c on t.scope_type='personal' and (c.user_id,c.account_email)=(t.personal_user_id,t.personal_account_email)
 union
 select n.company_id,n.node_id,n.information_id,t.scope_type,null::uuid,null::text,t.shared_inbox_id,t.account_email,c.provider
 from needing n join communications_email_threads t on (t.company_id,t.email_thread_id)=(n.company_id,n.source_email_thread_id)
 join shared_inboxes i on t.scope_type='shared' and (i.company_id,i.shared_inbox_id)=(t.company_id,t.shared_inbox_id)
 join company_email_connections c on (c.company_id,c.company_email_connection_id)=(i.company_id,i.company_email_connection_id)
 union
 select n.company_id,n.node_id,n.information_id,'shared',null::uuid,null::text,i.shared_inbox_id,i.account_email,c.provider
 from needing n join shared_inboxes i on i.company_id=n.company_id and i.shared_inbox_id=(n.payload->>'shared_inbox_id')::uuid
 join company_email_connections c on (c.company_id,c.company_email_connection_id)=(i.company_id,i.company_email_connection_id)
 where coalesce(n.payload->>'shared_inbox_id','')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and (coalesce(n.payload->>'account_email','')='' or i.account_email=n.payload->>'account_email')
 union
 select n.company_id,n.node_id,n.information_id,'personal',x.user_id,c.account_email,null::uuid,c.account_email,c.provider
 from needing n join(
  select company_id,node_id,user_id,message_id from communications_email_nodes
  union select company_id,node_id,user_id,message_id from communications_email_node_attachments
 )x on x.company_id=n.company_id and x.node_id=n.node_id and x.message_id=n.payload->>'message_id'
 join company_memberships m on (m.company_id,m.user_id)=(n.company_id,x.user_id)
 join user_email_connections c on c.user_id=x.user_id
 where coalesce(n.payload->>'shared_inbox_id','')='' and(
  c.account_email=n.payload->>'account_email' or(
   coalesce(n.payload->>'account_email','')='' and 1=(select count(*) from user_email_connections e where e.user_id=x.user_id)
  )
 )
 union
 select n.company_id,n.node_id,n.information_id,'personal',c.user_id,c.account_email,null::uuid,c.account_email,c.provider
 from needing n join user_email_connections c on c.account_email=n.payload->>'account_email'
 join company_memberships m on (m.company_id,m.user_id)=(n.company_id,c.user_id)
 where coalesce(n.payload->>'shared_inbox_id','')='' and coalesce(n.payload->>'account_email','')<>''
 union
 select n.company_id,n.node_id,n.information_id,'personal',j.actor_user_id,j.account_email,null::uuid,j.account_email,j.provider
 from needing n join communications_email_archive_job_items i on i.message_id=n.payload->>'message_id'
 join communications_email_archive_jobs j on j.archive_job_id=i.archive_job_id
 join company_memberships m on (m.company_id,m.user_id)=(n.company_id,j.actor_user_id)
 where j.connection_scope='personal' and coalesce(n.payload->>'shared_inbox_id','')=''
  and (coalesce(n.payload->>'account_email','')='' or j.account_email=n.payload->>'account_email')
  and (j.company_id=n.company_id or(j.company_id is null and exists(
   select 1 from(
    select company_id,node_id,user_id,message_id from communications_email_nodes
    union all select company_id,node_id,user_id,message_id from communications_email_node_attachments
   )x where (x.company_id,x.node_id,x.user_id,x.message_id)=(n.company_id,n.node_id,j.actor_user_id,n.payload->>'message_id')
  )))
 union
 select n.company_id,n.node_id,n.information_id,'shared',null::uuid,null::text,j.shared_inbox_id,j.account_email,j.provider
 from needing n join communications_email_archive_job_items i on i.message_id=n.payload->>'message_id'
 join communications_email_archive_jobs j on j.archive_job_id=i.archive_job_id
 join shared_inboxes s on (s.company_id,s.shared_inbox_id,s.account_email)=(n.company_id,j.shared_inbox_id,j.account_email)
 where j.connection_scope='shared' and j.company_id=n.company_id
  and coalesce(n.payload->>'shared_inbox_id','')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and j.shared_inbox_id=(n.payload->>'shared_inbox_id')::uuid
  and (coalesce(n.payload->>'account_email','')='' or j.account_email=n.payload->>'account_email')
),resolved as(
 select n.company_id,n.node_id,n.information_id,n.payload,count(c.provider)::int mailbox_count
 from needing n left join candidate c using(company_id,node_id,information_id)
 group by n.company_id,n.node_id,n.information_id,n.payload
)`;
const checks:Check[]=[
{category:"node.active_projection_without_target",sql:`select company_id::text,node_id::text,information_id::text,type::text from node_projection_table where not is_deleted and type not in ('Text box'::information_type,'Text block chat'::information_type,'Attached email'::information_type)`},
{category:"node.information_without_target",sql:`select company_id::text,node_id::text,information_id::text,type::text from node_information where type not in ('Text box'::information_type,'Text block chat'::information_type,'Attached email'::information_type,'Saved version'::information_type)`},
{category:"node.active_textbox_missing_permanent_row",sql:`select p.company_id::text,p.node_id::text,p.information_id::text from node_projection_table p where not p.is_deleted and p.type='Text box'::information_type and not exists(select 1 from node_textboxes t where (t.company_id,t.node_id,t.textbox_id)=(p.company_id,p.node_id,p.information_id))`},
{category:"node.content_change_missing_textbox",sql:`select c.company_id::text,c.node_id::text,c.information_id::text,count(*)::int rows from node_content_changes c where not exists(select 1 from node_textboxes t where (t.company_id,t.node_id,t.textbox_id)=(c.company_id,c.node_id,c.information_id)) group by 1,2,3`},
{category:"chat.invalid_json_or_identity",sql:`select company_id::text,node_id::text,information_id::text chat_id,is_deleted from node_projection_table where type='Text block chat'::information_type and (not pg_input_is_valid(information,'jsonb') or case when pg_input_is_valid(information,'jsonb') then jsonb_typeof(information::jsonb)<>'object' or coalesce(information::jsonb->>'block_id','')!~'${uuid}' else false end)`},
{category:"chat.invalid_payload_fields",sql:`with c as materialized(select p.*,case when pg_input_is_valid(information,'jsonb') and jsonb_typeof(information::jsonb)='object' then information::jsonb end j from node_projection_table p where type='Text block chat'::information_type) select c.company_id::text,c.node_id::text,c.information_id::text chat_id,c.j->>'author_id' author_user_id,c.j->>'selection_source' selection_source,c.j->>'selection_block_id' selection_textbox_id,c.j->>'selection_start' selection_start,c.j->>'selection_end' selection_end,jsonb_typeof(c.j->'entity_links') entity_links_type,jsonb_typeof(c.j->'mentioned_user_ids') mentioned_user_ids_type,jsonb_typeof(c.j->'mentioned_group_ids') mentioned_group_ids_type from c join node_textboxes t on (t.company_id,t.node_id)=(c.company_id,c.node_id) and t.textbox_id::text=lower(c.j->>'block_id') where c.j is not null and coalesce(c.j->>'block_id','')~'${uuid}' and (coalesce(c.j->>'selection_source','') not in ('','text','email') or (coalesce(c.j->>'selection_block_id','')<>'' and c.j->>'selection_block_id'!~'${uuid}') or (coalesce(c.j->>'author_id','')<>'' and c.j->>'author_id'!~'${uuid}') or case when c.j->>'selection_start' is null and c.j->>'selection_end' is null then false when c.j->>'selection_start' is null or c.j->>'selection_end' is null then true when not pg_input_is_valid(c.j->>'selection_start','integer') or not pg_input_is_valid(c.j->>'selection_end','integer') then true else (c.j->>'selection_start')::integer<0 or (c.j->>'selection_end')::integer<(c.j->>'selection_start')::integer end or (c.j?'entity_links' and jsonb_typeof(c.j->'entity_links') not in ('array','null')) or (c.j?'mentioned_user_ids' and jsonb_typeof(c.j->'mentioned_user_ids') not in ('array','null')) or case when jsonb_typeof(c.j->'mentioned_user_ids')='array' then exists(select 1 from jsonb_array_elements_text(c.j->'mentioned_user_ids') v where v!~'${uuid}') else false end or (c.j?'mentioned_group_ids' and jsonb_typeof(c.j->'mentioned_group_ids') not in ('array','null')) or case when jsonb_typeof(c.j->'mentioned_group_ids')='array' then exists(select 1 from jsonb_array_elements_text(c.j->'mentioned_group_ids') v where v!~'${uuid}') else false end or c.updated_timestamp<c.created_timestamp)`},
{category:"chat.author_user_missing",severity:"cleanup",sql:`with c as materialized(select p.*,case when pg_input_is_valid(information,'jsonb') and jsonb_typeof(information::jsonb)='object' then information::jsonb end j from node_projection_table p where type='Text block chat'::information_type) select c.company_id::text,c.node_id::text,c.information_id::text chat_id,c.j->>'author_id' author_user_id,coalesce(c.j->>'author_name','') author_display_name,c.is_deleted from c join node_textboxes t on (t.company_id,t.node_id)=(c.company_id,c.node_id) and t.textbox_id::text=lower(c.j->>'block_id') left join users u on u.user_id::text=lower(c.j->>'author_id') where c.j is not null and coalesce(c.j->>'block_id','')~'${uuid}' and coalesce(c.j->>'author_id','')~'${uuid}' and u.user_id is null`},
{category:"chat.host_textbox_missing",severity:"cleanup",sql:`with c as(select p.*,case when pg_input_is_valid(information,'jsonb') and jsonb_typeof(information::jsonb)='object' then information::jsonb end j from node_projection_table p where type='Text block chat'::information_type) select c.company_id::text,c.node_id::text,c.information_id::text chat_id,j->>'block_id' textbox_id,is_deleted,(coalesce(j->>'message',j->>'content','')<>'') has_message,coalesce(jsonb_array_length(case when jsonb_typeof(j->'attachments')='array' then j->'attachments' else '[]'::jsonb end),0) payload_attachments,(select count(*)::int from resource_attachments a where a.company_id=c.company_id and a.resource_type='node_chat_message' and a.resource_id=c.information_id::text and a.deleted_timestamp is null) linked_attachments,exists(select 1 from node_projection_table t where (t.company_id,t.node_id,t.information_id)=(c.company_id,c.node_id,(j->>'block_id')::uuid) and t.type='Text box'::information_type and t.is_deleted) deleted_projection,exists(select 1 from node_information i where (i.company_id,i.node_id,i.information_id)=(c.company_id,c.node_id,(j->>'block_id')::uuid) and i.type='Text box'::information_type) information_history,exists(select 1 from node_textboxes_history h where (h.company_id,h.node_id,h.textbox_id)=(c.company_id,c.node_id,(j->>'block_id')::uuid)) save_history from c where j is not null and coalesce(j->>'block_id','')~'${uuid}' and not exists(select 1 from node_textboxes t where (t.company_id,t.node_id,t.textbox_id)=(c.company_id,c.node_id,(j->>'block_id')::uuid))`},
{category:"chat.parent_missing_or_wrong_textbox",severity:"cleanup",sql:`with c as(select p.company_id,p.node_id,p.information_id,p.is_deleted,p.information::jsonb j from node_projection_table p where type='Text block chat'::information_type and pg_input_is_valid(information,'jsonb') and jsonb_typeof(information::jsonb)='object') select x.company_id::text,x.node_id::text,x.information_id::text chat_id,x.j->>'block_id' textbox_id,x.j->>'parent_id' parent_id,x.is_deleted from c x where coalesce(x.j->>'parent_id','')<>'' and (coalesce(x.j->>'parent_id','')!~'${uuid}' or case when coalesce(x.j->>'parent_id','')~'${uuid}' then not exists(select 1 from c p where (p.company_id,p.node_id,p.information_id)=(x.company_id,x.node_id,(x.j->>'parent_id')::uuid) and p.j->>'block_id'=x.j->>'block_id') else false end)`},
{category:"seen_snapshot.missing_textbox",severity:"cleanup",sql:`select s.company_id::text,s.node_id::text,s.information_id::text,s.user_id::text from node_projection_seen_snapshots s where not exists(select 1 from node_textboxes t where (t.company_id,t.node_id,t.textbox_id)=(s.company_id,s.node_id,s.information_id))`},
{category:"email.relationship_host_missing",severity:"cleanup",sql:`select source,company_id,node_id,relationship_id,host_id from (select 'thread_link' source,l.company_id::text,l.node_id::text,l.information_id::text relationship_id,l.node_id::text host_id from communications_node_email_threads l where not exists(select 1 from nodes n where (n.company_id,n.node_id)=(l.company_id,l.node_id)) union all select 'collaboration',c.company_id::text,c.node_id::text,c.attached_email_information_id::text,c.node_id::text from communications_email_collaborations c where not exists(select 1 from nodes n where (n.company_id,n.node_id)=(c.company_id,c.node_id)) union all select 'email_node',e.company_id::text,e.node_id::text,e.message_id,e.node_id::text from communications_email_nodes e where not exists(select 1 from nodes n where (n.company_id,n.node_id)=(e.company_id,e.node_id)) union all select 'email_node_attachment',e.company_id::text,e.node_id::text,e.message_id,e.node_id::text from communications_email_node_attachments e where not exists(select 1 from nodes n where (n.company_id,n.node_id)=(e.company_id,e.node_id)) union all select 'attached_email_textbox',p.company_id::text,p.node_id::text,p.information_id::text,p.information::jsonb->>'block_id' from node_projection_table p where p.type='Attached email'::information_type and not p.is_deleted and pg_input_is_valid(p.information,'jsonb') and jsonb_typeof(p.information::jsonb)='object' and coalesce(p.information::jsonb->>'block_id','')<>'' and not exists(select 1 from node_textboxes t where (t.company_id,t.node_id)=(p.company_id,p.node_id) and t.textbox_id::text=p.information::jsonb->>'block_id' and t.deleted_timestamp is null)) x`},
{category:"email.attached_projection_invalid_json",sql:`select company_id::text,node_id::text,information_id::text,is_deleted,left(ltrim(information),1) first_character,length(information) stored_length from node_projection_table where type='Attached email'::information_type and not is_deleted and (not pg_input_is_valid(information,'jsonb') or case when pg_input_is_valid(information,'jsonb') then jsonb_typeof(information::jsonb)<>'object' else false end)`},
{category:"email.attached_projection_invalid_identity_or_date",sql:`with p as materialized(select company_id,node_id,information_id,case when pg_input_is_valid(information,'jsonb') and jsonb_typeof(information::jsonb)='object' then information::jsonb end j from node_projection_table where type='Attached email'::information_type and not is_deleted) select company_id::text,node_id::text,information_id::text,j->>'message_id' message_id,j->>'email_thread_id' email_thread_id,j->>'shared_inbox_id' shared_inbox_id,j->>'account_email' account_email,j->>'date' message_date from p where j is not null and (btrim(coalesce(j->>'message_id',''))='' or (coalesce(j->>'email_thread_id','')<>'' and j->>'email_thread_id'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') or (coalesce(j->>'shared_inbox_id','')<>'' and j->>'shared_inbox_id'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') or (coalesce(j->>'account_email','')<>'' and j->>'account_email'<>lower(btrim(j->>'account_email'))) or (coalesce(j->>'date','')<>'' and not pg_input_is_valid(j->>'date','double precision')))`},
{category:"email.attached_projection_message_ambiguous",sql:`with p as materialized(select company_id,node_id,information_id,case when pg_input_is_valid(information,'jsonb') and jsonb_typeof(information::jsonb)='object' then information::jsonb end j from node_projection_table where type='Attached email'::information_type and not is_deleted) select p.company_id::text,p.node_id::text,p.information_id::text,p.j->>'message_id' message_id,count(m.*)::int normalized_matches from p join communications_email_messages m on m.company_id=p.company_id and m.provider_message_id=p.j->>'message_id' and (coalesce(p.j->>'email_thread_id','')='' or case when p.j->>'email_thread_id'~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then m.email_thread_id=(p.j->>'email_thread_id')::uuid else false end) where p.j is not null group by p.company_id,p.node_id,p.information_id,p.j having count(m.*)>1`},
{category:"email.legacy_snapshot_requires_normalization",severity:"cleanup",sql:`${legacyEmailMailboxInventory} select company_id::text,node_id::text,information_id::text,payload->>'message_id' message_id,payload->>'thread_id' provider_thread_id,payload->>'account_email' account_email,payload->>'shared_inbox_id' shared_inbox_id,mailbox_count from resolved`},
{category:"email.legacy_snapshot_mailbox_unresolved_or_ambiguous",sql:`${legacyEmailMailboxInventory} select company_id::text,node_id::text,information_id::text,payload->>'message_id' message_id,payload->>'thread_id' provider_thread_id,payload->>'account_email' account_email,payload->>'shared_inbox_id' shared_inbox_id,mailbox_count from resolved where mailbox_count<>1`},
{category:"email.thread_provider_not_exactly_one",sql:`select t.company_id::text,t.email_thread_id::text,t.scope_type from communications_email_threads t where (select count(distinct provider) from (select c.provider from user_email_connections c where t.scope_type='personal' and c.user_id=t.personal_user_id and c.account_email=t.personal_account_email union all select c.provider from shared_inboxes i join company_email_connections c on (c.company_id,c.company_email_connection_id)=(i.company_id,i.company_email_connection_id) where t.scope_type='shared' and (i.company_id,i.shared_inbox_id)=(t.company_id,t.shared_inbox_id)) s)<>1`},
{category:"email.address_not_normalized",sql:`select source,company_id,id,email from (select 'thread' source,company_id::text,email_thread_id::text id,account_email email from communications_email_threads union all select 'draft',company_id::text,draft_id,account_email from communications_email_drafts union all select 'collaboration',company_id::text,collaboration_id::text,account_email from communications_email_collaborations) x where email<>lower(btrim(email)) or btrim(email)=''`},
{category:"email.invalid_fallback_snapshot",sql:`select source,company_id,id from (select 'collaboration' source,company_id::text,collaboration_id::text id,message_snapshot::text snapshot,latest_message_id message_id from communications_email_collaborations union all select 'email_node',company_id::text,node_id::text||':'||message_id,message::text,message_id from communications_email_nodes union all select 'email_attachment',company_id::text,node_id::text||':'||message_id,message::text,message_id from communications_email_node_attachments) x where not pg_input_is_valid(snapshot,'jsonb') or case when pg_input_is_valid(snapshot,'jsonb') then jsonb_typeof(snapshot::jsonb)<>'object' or btrim(coalesce(message_id,''))='' or (coalesce(snapshot::jsonb->>'date','')<>'' and not pg_input_is_valid(snapshot::jsonb->>'date','double precision')) else false end`},
{category:"email.placement_without_thread_or_projection",sql:`select source,company_id::text,node_id::text,message_id,user_id::text from (select 'email_node' source,company_id,node_id,message_id,user_id,email_thread_id from communications_email_nodes union all select 'email_attachment',company_id,node_id,message_id,user_id,email_thread_id from communications_email_node_attachments) x where email_thread_id is null and not exists(select 1 from communications_email_messages m where m.company_id=x.company_id and m.provider_message_id=x.message_id) and not exists(select 1 from node_projection_table p where (p.company_id,p.node_id)=(x.company_id,x.node_id) and p.type='Attached email'::information_type and not p.is_deleted and pg_input_is_valid(p.information,'jsonb') and jsonb_typeof(p.information::jsonb)='object' and p.information::jsonb->>'message_id'=x.message_id)`},
{category:"draft.invalid_relationship_state",sql:`select d.company_id::text,d.draft_id,d.is_shared,d.collaboration_id::text from communications_email_drafts d where not d.is_shared and d.collaboration_id is not null`},
{category:"draft.source_message_not_normalized",severity:"review",sql:`select d.company_id::text,d.draft_id,d.source_message_id from communications_email_drafts d where btrim(d.source_message_id)<>'' and not exists(select 1 from communications_email_messages m where m.company_id=d.company_id and m.provider_message_id=d.source_message_id)`},
{category:"draft.sent_message_not_resolved",severity:"review",sql:`select d.company_id::text,d.draft_id,d.sent_message_id from communications_email_drafts d where btrim(d.sent_message_id)<>'' and not exists(select 1 from communications_email_messages m where m.company_id=d.company_id and m.provider_message_id=d.sent_message_id)`},
{category:"attachment.pending_attached_email_upload",sql:`select company_id::text,upload_intent_id::text,resource_id from attachment_upload_intents where resource_type='attached_email'`},
{category:"attachment.unrecoverable_attached_email_identity",sql:`select company_id::text,resource_attachment_id::text,resource_id,information_id::text,message_id from resource_attachments where resource_type='attached_email' and ((btrim(coalesce(message_id,''))='' and resource_id!~'^node:[0-9a-fA-F-]{36}:message:.+$') or (information_id is null and resource_id!~'^node:[0-9a-fA-F-]{36}:message:' and resource_id!~'${uuid}'))`}
];
async function main(){
 const url=String(process.env.MANGORTS_V3_PREFLIGHT_DATABASE_URL??"").trim();if(!url)throw new Error("MANGORTS_V3_PREFLIGHT_DATABASE_URL is required");
 const pool=new Pool({connectionString:url,max:1,application_name:"mangorts-v3-cutover-preflight"}),client=await pool.connect();
 try{await client.query("begin isolation level repeatable read read only");await client.query("set local statement_timeout='10min'");
  const p=await client.query(`select has_table_privilege(current_user,'node_textboxes','INSERT') or has_table_privilege(current_user,'node_textboxes','UPDATE') or has_table_privilege(current_user,'node_textboxes','DELETE') writable`);
  if(p.rows[0]?.writable!==false)throw new Error("database_role_is_not_enforced_read_only");
  let blockers=0,cleanup=0,review=0;for(const check of checks){const r=await client.query(check.sql),count=r.rowCount??0;if(check.severity==="cleanup")cleanup+=count;else if(check.severity==="review")review+=count;else blockers+=count;process.stdout.write(`${JSON.stringify({category:check.category,severity:check.severity??"blocker",count,sample:r.rows.slice(0,25)})}\n`)}
  await client.query("rollback");process.stdout.write(`${JSON.stringify({summary:true,categories:checks.length,blocker_rows:blockers,cleanup_rows:cleanup,review_rows:review})}\n`);if(blockers>0)process.exitCode=2;
 }catch(e){await client.query("rollback").catch(()=>undefined);throw e}finally{client.release();await pool.end()}
}
void main().catch(e=>{process.stderr.write(`${e instanceof Error?e.message:"unknown V3 preflight failure"}\n`);process.exitCode=1});
