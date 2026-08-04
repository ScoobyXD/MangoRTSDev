create temp table v3_relationship_ranked on commit drop as
select a.company_id,a.email_relationship_id,m.email_thread_id,m.email_message_id,
 a.resource_type,a.resource_id,a.resource_textbox_id,a.created_timestamp,
 row_number() over(partition by a.company_id,m.email_message_id,a.resource_type,
  a.resource_id,coalesce(a.resource_textbox_id,'') order by
  case when a.resource_type='node'
   and a.payload->>'block_id'=a.email_relationship_id::text then 0 else 1 end,
  a.created_timestamp,a.email_relationship_id) relationship_rank,
 first_value(a.email_relationship_id) over(partition by a.company_id,m.email_message_id,
  a.resource_type,a.resource_id,coalesce(a.resource_textbox_id,'') order by
  case when a.resource_type='node'
   and a.payload->>'block_id'=a.email_relationship_id::text then 0 else 1 end,
  a.created_timestamp,a.email_relationship_id) target_relationship_id
from v3_projection_accounts a
join v3_thread_map map on map.source_kind='projection' and map.company_id=a.company_id
 and map.source_key=a.email_relationship_id::text
join email_messages m on m.company_id=a.company_id and m.email_thread_id=map.email_thread_id
 and m.provider_message_id=a.payload->>'message_id';

create temp table v3_relationship_source_map on commit drop as
select company_id,email_relationship_id source_relationship_id,target_relationship_id,
 relationship_rank from v3_relationship_ranked;

create temp table v3_relationship_desired on commit drop as
select company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,
 resource_id,resource_textbox_id,created_timestamp
from v3_relationship_ranked where relationship_rank=1;

do $$
begin
 if (select count(*) from v3_relationship_desired)<>(select count(*) from v3_projections)-28 then
  raise exception 'retained relationship consolidation did not produce the approved 228 identities';
 end if;
 if exists(select 1 from v3_relationship_desired r where
  (r.resource_type='node' and (
    not exists(select 1 from nodes n where n.company_id=r.company_id and n.node_id=r.resource_id)
    or (r.resource_textbox_id is not null and not exists(
      select 1 from node_textboxes t where t.company_id=r.company_id
       and t.node_id=r.resource_id and t.textbox_id::text=r.resource_textbox_id
       and t.deleted_timestamp is null))))
  or (r.resource_type='project' and (
    not exists(select 1 from projects p where p.company_id=r.company_id and p.project_id=r.resource_id)
    or (r.resource_textbox_id is not null and not exists(
      select 1 from project_textboxes t where t.company_id=r.company_id
       and t.project_id=r.resource_id and t.textbox_id=r.resource_textbox_id
       and t.deleted_timestamp is null))))
  or (r.resource_type='logic_gate' and (
    not exists(select 1 from logic_gates g where g.company_id=r.company_id and g.logic_gate_id=r.resource_id)
    or (r.resource_textbox_id is not null and not exists(
      select 1 from logic_gate_textboxes t where t.company_id=r.company_id
       and t.logic_gate_id=r.resource_id and t.textbox_id=r.resource_textbox_id
       and t.deleted_timestamp is null))))
 ) then raise exception 'retained relationship has a missing or deleted resource/textbox host'; end if;
end $$;

insert into email_relationships(company_id,email_relationship_id,email_thread_id,
 email_message_id,resource_type,resource_id,resource_textbox_id,created_timestamp)
select company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,
 resource_id,resource_textbox_id,created_timestamp from v3_relationship_desired
on conflict(company_id,email_relationship_id) do update set
 email_thread_id=excluded.email_thread_id,email_message_id=excluded.email_message_id,
 resource_type=excluded.resource_type,resource_id=excluded.resource_id,
 resource_textbox_id=excluded.resource_textbox_id,
 created_timestamp=least(email_relationships.created_timestamp,excluded.created_timestamp);

create temp table v3_draft_desired on commit drop as
select d.*,
 relationship.email_relationship_id resolved_relationship_id,
 source_message.email_message_id resolved_source_message_id,
 sent_message.email_message_id resolved_sent_message_id,
 sent_message.match_count sent_message_match_count
from v3_draft_accounts d
left join communications_email_collaborations collaboration
 on collaboration.company_id=d.company_id and collaboration.collaboration_id=d.collaboration_id
left join email_relationships relationship
 on relationship.company_id=collaboration.company_id
 and relationship.email_relationship_id=collaboration.attached_email_information_id
left join email_threads source_thread on d.valid_source_snapshot
 and source_thread.company_id=d.company_id
 and source_thread.provider=d.provider
 and source_thread.provider_thread_key='thread:'||(d.reply_to_message->>'thread_id')
 and ((d.personal_user_id is not null
   and source_thread.email_account_type='personal_email_account'
   and source_thread.personal_user_id=d.personal_user_id
   and source_thread.personal_account_email=d.personal_account_email)
  or (d.shared_inbox_id is not null
   and source_thread.email_account_type='shared_email_account'
   and source_thread.shared_inbox_id=d.shared_inbox_id))
left join email_messages source_message
 on source_message.company_id=source_thread.company_id
 and source_message.email_thread_id=source_thread.email_thread_id
 and source_message.provider_message_id=d.source_message_id
left join lateral (
 select case when count(*)=1 then min(m.email_message_id::text)::uuid end email_message_id,
        count(*) match_count
 from email_messages m join email_threads t on t.company_id=m.company_id
  and t.email_thread_id=m.email_thread_id
 where nullif(btrim(d.sent_message_id),'') is not null
  and m.company_id=d.company_id and m.provider_message_id=d.sent_message_id
  and ((d.personal_user_id is not null and t.email_account_type='personal_email_account'
    and t.personal_user_id=d.personal_user_id
    and t.personal_account_email=d.personal_account_email)
   or (d.shared_inbox_id is not null and t.email_account_type='shared_email_account'
    and t.shared_inbox_id=d.shared_inbox_id))
) sent_message on true;

do $$
begin
 if exists(select 1 from v3_draft_desired
  where valid_source_snapshot and resolved_source_message_id is null) then
  raise exception 'valid draft source snapshot did not resolve to one final message';
 end if;
 if exists(select 1 from v3_draft_desired
  where nullif(btrim(sent_message_id),'') is not null and sent_message_match_count<>1) then
  raise exception 'sent draft provider message did not resolve to one final message';
 end if;
end $$;

insert into email_drafts(company_id,draft_id,email_relationship_id,
 source_email_message_id,email_account_type,personal_user_id,personal_account_email,
 shared_inbox_id,sender_account_email,created_by_user_id,updated_by_user_id,kind,
 to_recipients,cc_recipients,bcc_recipients,subject,body_editor_html,
 scheduled_send_timestamp,revision,send_state,send_claim_token,send_idempotency_key,
 send_idempotency_grant_id,send_idempotency_timestamp,send_claimed_revision,
 send_claimed_timestamp,sent_email_message_id,sent_provider_message_id,
 created_timestamp,updated_timestamp,deleted_timestamp)
select company_id,draft_id,resolved_relationship_id,resolved_source_message_id,
 email_account_type,personal_user_id,personal_account_email,shared_inbox_id,
 lower(btrim(account_email)),created_by_user_id,updated_by_user_id,kind,to_recipients,
 cc_recipients,bcc_recipients,subject,body_editor_html,scheduled_send_timestamp,
 revision,send_state,send_claim_token,send_idempotency_key,send_idempotency_grant_id,
 send_idempotency_timestamp,send_claimed_revision,send_claimed_timestamp,
 resolved_sent_message_id,sent_message_id,created_timestamp,updated_timestamp,deleted_timestamp
from v3_draft_desired
on conflict(company_id,draft_id) do update set
 email_relationship_id=excluded.email_relationship_id,
 source_email_message_id=excluded.source_email_message_id,
 email_account_type=excluded.email_account_type,personal_user_id=excluded.personal_user_id,
 personal_account_email=excluded.personal_account_email,shared_inbox_id=excluded.shared_inbox_id,
 sender_account_email=excluded.sender_account_email,created_by_user_id=excluded.created_by_user_id,
 updated_by_user_id=excluded.updated_by_user_id,kind=excluded.kind,
 to_recipients=excluded.to_recipients,cc_recipients=excluded.cc_recipients,
 bcc_recipients=excluded.bcc_recipients,subject=excluded.subject,
 body_editor_html=excluded.body_editor_html,
 scheduled_send_timestamp=excluded.scheduled_send_timestamp,revision=excluded.revision,
 send_state=excluded.send_state,send_claim_token=excluded.send_claim_token,
 send_idempotency_key=excluded.send_idempotency_key,
 send_idempotency_grant_id=excluded.send_idempotency_grant_id,
 send_idempotency_timestamp=excluded.send_idempotency_timestamp,
 send_claimed_revision=excluded.send_claimed_revision,
 send_claimed_timestamp=excluded.send_claimed_timestamp,
 sent_email_message_id=excluded.sent_email_message_id,
 sent_provider_message_id=excluded.sent_provider_message_id,
 created_timestamp=least(email_drafts.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_drafts.updated_timestamp,excluded.updated_timestamp),
 deleted_timestamp=excluded.deleted_timestamp;

insert into email_signatures(company_id,signature_id,email_account_type,
 personal_user_id,personal_account_email,shared_inbox_id,email_account_email,name,
 body_editor_html,is_default,created_by_user_id,updated_by_user_id,
 created_timestamp,updated_timestamp)
select s.company_id,s.signature_id,
 case when s.personal_user_id is not null then 'personal_email_account'
 else 'shared_email_account' end,s.personal_user_id,s.personal_account_email,
 s.shared_inbox_id,lower(btrim(coalesce(s.personal_account_email,inbox.account_email))),
 s.name,s.body_editor_html,s.is_default,s.created_by_user_id,s.updated_by_user_id,
 s.created_timestamp,s.updated_timestamp
from communications_email_signatures s
left join shared_inboxes inbox on inbox.company_id=s.company_id
 and inbox.shared_inbox_id=s.shared_inbox_id
on conflict(company_id,signature_id) do update set
 email_account_type=excluded.email_account_type,personal_user_id=excluded.personal_user_id,
 personal_account_email=excluded.personal_account_email,shared_inbox_id=excluded.shared_inbox_id,
 email_account_email=excluded.email_account_email,name=excluded.name,
 body_editor_html=excluded.body_editor_html,is_default=excluded.is_default,
 created_by_user_id=excluded.created_by_user_id,updated_by_user_id=excluded.updated_by_user_id,
 created_timestamp=least(email_signatures.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_signatures.updated_timestamp,excluded.updated_timestamp);

insert into email_thread_download_jobs(download_job_id,company_id,email_thread_id,
 download_scope,requested_provider_message_id,requested_by_user_id,status,attempt_count,
 last_error,available_at,processing_started_at,completed_timestamp,failed_timestamp,
 created_timestamp,updated_timestamp)
select j.download_job_id,j.company_id,map.email_thread_id,j.download_scope,
 j.requested_provider_message_id,j.requested_by_user_id,j.status,j.attempt_count,
 j.last_error,j.available_at,j.processing_started_at,j.completed_timestamp,
 j.failed_timestamp,j.created_timestamp,j.updated_timestamp
from communications_email_thread_download_jobs j join v3_thread_map map
 on map.source_kind='legacy' and map.company_id=j.company_id
 and map.source_key=j.email_thread_id::text
on conflict(download_job_id) do update set
 company_id=excluded.company_id,email_thread_id=excluded.email_thread_id,
 download_scope=excluded.download_scope,
 requested_provider_message_id=excluded.requested_provider_message_id,
 requested_by_user_id=excluded.requested_by_user_id,status=excluded.status,
 attempt_count=excluded.attempt_count,last_error=excluded.last_error,
 available_at=excluded.available_at,processing_started_at=excluded.processing_started_at,
 completed_timestamp=excluded.completed_timestamp,failed_timestamp=excluded.failed_timestamp,
 created_timestamp=least(email_thread_download_jobs.created_timestamp,excluded.created_timestamp),
 updated_timestamp=greatest(email_thread_download_jobs.updated_timestamp,excluded.updated_timestamp);

