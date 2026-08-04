-- STEP 1: read-only V3 email count, account classification, and readiness report.
-- Returns counts only. It never returns email addresses, bodies, subjects, file
-- keys, credentials, provider tokens, or attachment bytes.
begin transaction isolation level repeatable read read only;

with recursive projections as (
 select p.company_id,'node'::text resource_type,p.node_id resource_id,
  p.information_id relationship_id,p.information::jsonb payload
 from node_projection_table p where p.type::text='Attached email' and not p.is_deleted
 union all
 select p.company_id,'project',p.project_id,p.information_id,p.information::jsonb
 from project_projection_table p where p.type::text='Attached email'
 union all
 select p.company_id,'logic_gate',p.logic_gate_id,p.information_id,p.information::jsonb
 from logic_gate_projection_table p where p.type::text='Attached email' and not p.is_deleted
), legacy_threads as (
 select t.*,x.provider from communications_email_threads t
 cross join lateral (
  select count(distinct s.provider) n,min(s.provider) provider from (
   select u.provider from user_email_connections u where t.scope_type='personal'
    and u.user_id=t.personal_user_id and u.account_email=t.personal_account_email
   union
   select c.provider from shared_inboxes i join company_email_connections c
    on c.company_id=i.company_id
    and c.company_email_connection_id=i.company_email_connection_id
    where t.scope_type='shared' and i.company_id=t.company_id
    and i.shared_inbox_id=t.shared_inbox_id
  ) s
 ) x where x.n=1 and x.provider in('google','microsoft')
), candidates as (
 select distinct p.relationship_id,10 priority,t.scope_type,t.personal_user_id,
  t.personal_account_email,t.shared_inbox_id,t.account_email,t.provider
 from projections p join communications_email_messages m
  on m.company_id=p.company_id and m.provider_message_id=p.payload->>'message_id'
 join legacy_threads t on t.company_id=m.company_id and t.email_thread_id=m.email_thread_id
 where nullif(btrim(p.payload->>'email_thread_id'),'') is null
  or (pg_input_is_valid(p.payload->>'email_thread_id','uuid')
  and m.email_thread_id=(p.payload->>'email_thread_id')::uuid)
 union
 select p.relationship_id,20,c.scope_type,c.personal_user_id,c.personal_account_email,
  c.shared_inbox_id,c.account_email,coalesce(u.provider,ce.provider)
 from projections p join communications_email_collaborations c
  on c.company_id=p.company_id and c.attached_email_information_id=p.relationship_id
 left join user_email_connections u on c.scope_type='personal'
  and u.user_id=c.personal_user_id and u.account_email=c.personal_account_email
 left join shared_inboxes i on c.scope_type='shared' and i.company_id=c.company_id
  and i.shared_inbox_id=c.shared_inbox_id
 left join company_email_connections ce on ce.company_id=i.company_id
  and ce.company_email_connection_id=i.company_email_connection_id
 union
 select p.relationship_id,30,'shared',null,null,i.shared_inbox_id,i.account_email,c.provider
 from projections p join shared_inboxes i on i.company_id=p.company_id
  and pg_input_is_valid(p.payload->>'shared_inbox_id','uuid')
  and i.shared_inbox_id=(p.payload->>'shared_inbox_id')::uuid
 join company_email_connections c on c.company_id=i.company_id
  and c.company_email_connection_id=i.company_email_connection_id
 union
 select p.relationship_id,40,'personal',cm.user_id,u.account_email,null,u.account_email,u.provider
 from projections p join company_memberships cm on cm.company_id=p.company_id
 join user_email_connections u on u.user_id=cm.user_id
  and u.account_email=lower(btrim(p.payload->>'account_email'))
 where nullif(btrim(p.payload->>'account_email'),'') is not null
  and nullif(btrim(p.payload->>'shared_inbox_id'),'') is null
 union
 select p.relationship_id,50,'personal',n.user_id,u.account_email,null,u.account_email,u.provider
 from projections p join communications_email_nodes n on p.resource_type='node'
  and n.company_id=p.company_id and n.node_id=p.resource_id
  and n.message_id=p.payload->>'message_id'
 join user_email_connections u on u.user_id=n.user_id
 union
 select p.relationship_id,60,'personal',n.user_id,u.account_email,null,u.account_email,u.provider
 from projections p join communications_email_node_attachments n on p.resource_type='node'
  and n.company_id=p.company_id and n.node_id=p.resource_id
  and n.message_id=p.payload->>'message_id'
 join user_email_connections u on u.user_id=n.user_id
 union
 select p.relationship_id,70,j.connection_scope,
  case when j.connection_scope='personal' then j.actor_user_id end,
  case when j.connection_scope='personal' then j.account_email end,
  case when j.connection_scope='shared' then j.shared_inbox_id end,j.account_email,j.provider
 from projections p join communications_email_archive_job_items x
  on x.message_id=p.payload->>'message_id'
 join communications_email_archive_jobs j on j.archive_job_id=x.archive_job_id
  and j.company_id=p.company_id
), ranked as (
 select c.*,min(priority) over(partition by relationship_id) best
 from candidates c where provider in('google','microsoft')
), distinct_best as (
 select distinct relationship_id,scope_type,personal_user_id,personal_account_email,
  shared_inbox_id,lower(btrim(account_email)) account_email,provider
 from ranked where priority=best
), candidate_counts as (
 select relationship_id,count(*) candidate_count from distinct_best group by relationship_id
), accounts as (
 select p.*,
  case when p.resource_type='node' and p.payload->>'block_id'=p.relationship_id::text
   then null else nullif(btrim(p.payload->>'block_id'),'') end resource_textbox_id,
  b.scope_type,b.personal_user_id,b.personal_account_email,b.shared_inbox_id,
  b.account_email,b.provider,coalesce(c.candidate_count,0) candidate_count
 from projections p left join distinct_best b using(relationship_id)
 left join candidate_counts c using(relationship_id)
), drafts as (
 select d.*,coalesce(u.provider,ce.provider) provider,
  lower(btrim(coalesce(d.personal_account_email,i.account_email))) email_account_email,
  (nullif(btrim(d.source_message_id),'') is not null
   and jsonb_typeof(d.reply_to_message)='object'
   and d.reply_to_message->>'id'=btrim(d.source_message_id)
   and nullif(btrim(d.reply_to_message->>'thread_id'),'') is not null) valid_source
 from communications_email_drafts d
 left join user_email_connections u on d.personal_user_id is not null
  and u.user_id=d.personal_user_id and u.account_email=d.personal_account_email
 left join shared_inboxes i on i.company_id=d.company_id and i.shared_inbox_id=d.shared_inbox_id
 left join company_email_connections ce on ce.company_id=i.company_id
  and ce.company_email_connection_id=i.company_email_connection_id
), thread_identities as (
 select t.company_id,t.scope_type,t.personal_user_id,t.personal_account_email,t.shared_inbox_id,
  t.provider,t.provider_thread_key
 from legacy_threads t
 union
 select a.company_id,a.scope_type,a.personal_user_id,a.personal_account_email,a.shared_inbox_id,
  a.provider,'thread:'||(a.payload->>'thread_id') from accounts a where candidate_count=1
 union
 select d.company_id,case when d.personal_user_id is not null then 'personal' else 'shared' end,
  d.personal_user_id,d.personal_account_email,d.shared_inbox_id,d.provider,
  'thread:'||(d.reply_to_message->>'thread_id') from drafts d where valid_source
), current_message_identities as (
 select m.company_id,t.scope_type,t.personal_user_id,t.personal_account_email,t.shared_inbox_id,
  t.provider,t.provider_thread_key,m.provider_message_id
 from communications_email_messages m join legacy_threads t
  on t.company_id=m.company_id and t.email_thread_id=m.email_thread_id
), message_identities as (
 select * from current_message_identities
 union
 select a.company_id,a.scope_type,a.personal_user_id,a.personal_account_email,a.shared_inbox_id,
  a.provider,'thread:'||(a.payload->>'thread_id'),a.payload->>'message_id'
 from accounts a where candidate_count=1
 union
 select d.company_id,case when d.personal_user_id is not null then 'personal' else 'shared' end,
  d.personal_user_id,d.personal_account_email,d.shared_inbox_id,d.provider,
  'thread:'||(d.reply_to_message->>'thread_id'),d.reply_to_message->>'id'
 from drafts d where valid_source
), attachment_sources as (
 select r.*,string_to_array(r.resource_id,':') parts
 from resource_attachments r
), attachment_encoded_parts as (
 select resource_attachment_id,'target'::text part_name,
  parts[array_length(parts,1)] encoded_value
 from attachment_sources
 where resource_type='email_draft'
  and ((parts[1]='personal' and array_length(parts,1) in(3,4))
   or (parts[1] in('shared','collaboration') and array_length(parts,1)=3))
 union all
 select resource_attachment_id,'owner',parts[2] from attachment_sources
 where resource_type in('email_signature','email_message','attached_email')
 union all
 select resource_attachment_id,'item',
  case when resource_type='attached_email' then parts[4] else parts[3] end
 from attachment_sources
 where (resource_type in('email_signature','email_message'))
   or resource_type='attached_email'
), attachment_decode(resource_attachment_id,part_name,encoded_value,pos,decoded,valid) as (
 select resource_attachment_id,part_name,encoded_value,1,''::bytea,true
 from attachment_encoded_parts
 union all
 select resource_attachment_id,part_name,encoded_value,
  case when substr(encoded_value,pos,1)='%'
    and substr(encoded_value,pos+1,2)~'^[0-9A-Fa-f]{2}$'
   then pos+3 else pos+1 end,
  decoded||case
   when substr(encoded_value,pos,1)='+' then convert_to(' ','UTF8')
   when substr(encoded_value,pos,1)='%'
    and substr(encoded_value,pos+1,2)~'^[0-9A-Fa-f]{2}$'
    then decode(substr(encoded_value,pos+1,2),'hex')
   when substr(encoded_value,pos,1)='%' then ''::bytea
   else convert_to(substr(encoded_value,pos,1),'UTF8') end,
  valid and (substr(encoded_value,pos,1)<>'%'
   or substr(encoded_value,pos+1,2)~'^[0-9A-Fa-f]{2}$')
 from attachment_decode
 where valid and pos<=char_length(encoded_value)
), attachment_decoded_parts as (
 select resource_attachment_id,part_name,
  case when valid and pos>char_length(encoded_value)
   and btrim(convert_from(decoded,'UTF8'))<>'' then btrim(convert_from(decoded,'UTF8'))
  end decoded_value
 from attachment_decode
 where not valid or pos>char_length(encoded_value)
), attachment_inputs as (
 select s.*,
  (select decoded_value from attachment_decoded_parts d
   where d.resource_attachment_id=s.resource_attachment_id and d.part_name='target') target_value,
  (select decoded_value from attachment_decoded_parts d
   where d.resource_attachment_id=s.resource_attachment_id and d.part_name='owner') owner_value,
  (select decoded_value from attachment_decoded_parts d
   where d.resource_attachment_id=s.resource_attachment_id and d.part_name='item') item_value
 from attachment_sources s
), attachment_shapes as (
 select i.*,case
  when resource_type in(
   'logic_gate','project','node_chat_message','logic_gate_chat_message',
   'project_chat_message','shared_inbox','company_explorer_folder',
   'shared_inbox_folder'
  ) then true
  when resource_type='node' and not (
   relationship_kind in('email_attachment','email_inline_attachment')
   and btrim(message_id)<>''
  ) then true
  when resource_type='email_draft' then target_value is not null
   and ((parts[1]='personal' and array_length(parts,1) in(3,4))
    or (parts[1] in('shared','collaboration') and array_length(parts,1)=3))
  when resource_type='email_signature' then
   (parts[1]='personal' and array_length(parts,1)=3
    and owner_value is not null and item_value is not null)
   or (parts[1]='shared' and array_length(parts,1)=2 and owner_value is not null)
  when resource_type='email_message' then parts[1] in('personal','shared')
   and array_length(parts,1)=3 and owner_value is not null and item_value is not null
  when resource_type='attached_email' then parts[1]='node'
   and array_length(parts,1)=4 and parts[3]='message'
   and owner_value is not null and item_value is not null
  when resource_type='node' then btrim(resource_id)<>'' and btrim(message_id)<>''
  else false end valid_shape
 from attachment_inputs i
), attachment_resolutions as (
 select a.*,case
  when not valid_shape then -1
  when resource_type in(
   'logic_gate','project','node_chat_message','logic_gate_chat_message',
   'project_chat_message','shared_inbox','company_explorer_folder',
   'shared_inbox_folder'
  ) or (resource_type='node' and not (
   relationship_kind in('email_attachment','email_inline_attachment')
   and btrim(message_id)<>''
  )) then 1
  when resource_type='email_draft' then
   (select count(*) from communications_email_drafts d
    where d.company_id=a.company_id and d.draft_id=a.target_value)
  when resource_type='email_signature' then
   (select count(*) from communications_email_signatures signature
    where signature.company_id=a.company_id and (
     (parts[1]='personal' and signature.personal_user_id::text=a.owner_value
      and signature.personal_account_email=lower(a.item_value))
     or (parts[1]='shared' and signature.shared_inbox_id::text=a.owner_value)
    ))
  when resource_type='email_message' then
   (select count(distinct (m.scope_type,m.personal_user_id,m.personal_account_email,
     m.shared_inbox_id,m.provider,m.provider_thread_key,m.provider_message_id))
    from message_identities m where m.company_id=a.company_id
     and m.provider_message_id=a.item_value
     and ((parts[1]='personal' and m.scope_type='personal'
       and m.personal_user_id::text=a.owner_value)
      or (parts[1]='shared' and m.scope_type='shared'
       and m.shared_inbox_id::text=a.owner_value)))
  when resource_type='attached_email' then
   (select count(distinct (r.scope_type,r.personal_user_id,r.personal_account_email,
     r.shared_inbox_id,r.provider,r.payload->>'thread_id',r.payload->>'message_id'))
    from accounts r where r.candidate_count=1 and r.company_id=a.company_id
     and r.resource_type='node' and r.resource_id::text=a.owner_value
     and r.payload->>'message_id'=a.item_value)
  when resource_type='node' then
   (select count(distinct (r.scope_type,r.personal_user_id,r.personal_account_email,
     r.shared_inbox_id,r.provider,r.payload->>'thread_id',r.payload->>'message_id'))
    from accounts r where r.candidate_count=1 and r.company_id=a.company_id
     and r.resource_type='node' and r.resource_id::text=a.resource_id
     and r.payload->>'message_id'=a.message_id)
  else -1 end resolution_count
 from attachment_shapes a
), duplicate_groups as (
 select count(*) source_count,
  count(*) filter(where resource_type='node'
   and payload->>'block_id'=relationship_id::text) self_rows,
  count(*) filter(where payload->>'created_from_email'='true') created_rows,
  count(*) filter(where nullif(payload->>'collaboration_id','') is not null) collaboration_rows
 from accounts where candidate_count=1
 group by company_id,provider,scope_type,personal_user_id,personal_account_email,
  shared_inbox_id,payload->>'message_id',resource_type,resource_id,
  coalesce(resource_textbox_id,'') having count(*)>1
), invalid_duplicate_groups as (
 select 1 from duplicate_groups where source_count<>2 or self_rows<>1
  or created_rows<>1 or collaboration_rows<>1
), missing_hosts as (
 select 1 from accounts a where
  (a.resource_type='node' and (
   not exists(select 1 from nodes n where n.company_id=a.company_id and n.node_id=a.resource_id)
   or (a.resource_textbox_id is not null and not exists(
    select 1 from node_textboxes t where t.company_id=a.company_id and t.node_id=a.resource_id
     and t.textbox_id::text=a.resource_textbox_id and t.deleted_timestamp is null))))
  or (a.resource_type='project' and (
   not exists(select 1 from projects p where p.company_id=a.company_id and p.project_id=a.resource_id)
   or (a.resource_textbox_id is not null and not exists(
    select 1 from project_textboxes t where t.company_id=a.company_id and t.project_id=a.resource_id
     and t.textbox_id=a.resource_textbox_id and t.deleted_timestamp is null))))
  or (a.resource_type='logic_gate' and (
   not exists(select 1 from logic_gates g where g.company_id=a.company_id and g.logic_gate_id=a.resource_id)
   or (a.resource_textbox_id is not null and not exists(
    select 1 from logic_gate_textboxes t where t.company_id=a.company_id
     and t.logic_gate_id=a.resource_id and t.textbox_id=a.resource_textbox_id
     and t.deleted_timestamp is null))))
), metrics as (
 select 'legacy_email_threads' metric,count(*)::bigint value from communications_email_threads
 union all select 'legacy_email_messages',count(*) from communications_email_messages
 union all select 'retained_relationships',count(*) from projections
 union all select 'relationships_without_one_account',count(*) from accounts where candidate_count<>1
 union all select 'relationship_duplicate_groups',count(*) from duplicate_groups
 union all select 'relationship_rows_to_consolidate',coalesce(sum(source_count-1),0) from duplicate_groups
 union all select 'expected_final_email_relationships',count(*)-(select coalesce(sum(source_count-1),0) from duplicate_groups) from projections
 union all select 'relationships_with_missing_host',count(*) from missing_hosts
 union all select 'expected_final_email_threads',count(*) from thread_identities
 union all select 'expected_final_email_messages',count(*) from message_identities
 union all select 'drafts_all',count(*) from drafts
 union all select 'drafts_active',count(*) from drafts where deleted_timestamp is null
 union all select 'drafts_soft_deleted',count(*) from drafts where deleted_timestamp is not null
 union all select 'drafts_without_exact_account',count(*) from drafts
  where provider not in('google','microsoft') or email_account_email=''
 union all select 'valid_draft_source_snapshots',count(*) from drafts where valid_source
 union all select 'stale_compose_source_links_to_omit',count(*) from drafts
  where nullif(btrim(source_message_id),'') is not null and not valid_source
   and kind='compose' and deleted_timestamp is not null
 union all select 'email_signatures',count(*) from communications_email_signatures
 union all select 'email_download_jobs',count(*) from communications_email_thread_download_jobs
 union all select 'attachments',count(*) from attachments
 union all select 'legacy_attachment_relationships',count(*) from attachment_resolutions
 union all select 'attachment_relationships_to_copy',count(*) from attachment_resolutions
  where resolution_count=1
 union all select 'orphan_attachment_relationships_to_omit',count(*)
  from attachment_resolutions where valid_shape and resolution_count=0
 union all select 'attachment_relationships_requiring_review',count(*)
  from attachment_resolutions where not valid_shape or resolution_count>1
 union all select 'recycle_bin_rows',count(*) from recycle_bin_items
), readiness as (
 select case when
  (select count(*) from accounts where candidate_count<>1)=0
  and (select coalesce(sum(source_count-1),0) from duplicate_groups)=28
  and (select count(*) from invalid_duplicate_groups)=0
  and (select count(*) from missing_hosts)=0
  and (select count(*) from drafts where provider not in('google','microsoft')
       or email_account_email='')=0
  and (select count(*) from drafts where nullif(btrim(source_message_id),'') is not null
       and not valid_source)=1
  and (select count(*) from drafts where nullif(btrim(source_message_id),'') is not null
       and not valid_source and kind='compose' and deleted_timestamp is not null)=1
  and (select count(*) from attachment_resolutions
       where not valid_shape or resolution_count>1)=0
  and (select count(*) from recycle_bin_items)=0
 then 'READY_TO_COPY' else 'STOP_AND_REVIEW' end status
)
select metric,value from metrics
union all select 'target_tables_already_present',count(*) from (
 values('email_threads'),('email_messages'),('email_relationships'),('email_drafts'),
 ('email_signatures'),('email_thread_download_jobs'),('attachment_relationships')
) expected(name) where to_regclass('public.'||name) is not null
union all select status,null::bigint from readiness
order by metric;

rollback;

