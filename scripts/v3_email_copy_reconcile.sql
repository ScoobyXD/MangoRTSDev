insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_threads',s.company_id,s.email_thread_id::text,
 'email_threads',map.email_thread_id::text,'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join communications_email_threads s
join v3_thread_map map on map.source_kind='legacy' and map.company_id=s.company_id
 and map.source_key=s.email_thread_id::text;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_messages',s.company_id,s.email_message_id::text,
 'email_messages',desired.email_message_id::text,'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join communications_email_messages s
join v3_thread_map map on map.source_kind='legacy' and map.company_id=s.company_id
 and map.source_key=s.email_thread_id::text
join v3_message_desired desired on desired.company_id=s.company_id
 and desired.email_thread_id=map.email_thread_id
 and desired.provider_message_id=s.provider_message_id;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'Attached email projection',s.company_id,s.email_relationship_id::text,
 'email_relationships',map.target_relationship_id::text,
 case when map.relationship_rank=1 then 'copied' else 'consolidated_duplicate' end,
 md5(to_jsonb(s)::text)
from v3_current_email_run run cross join v3_projection_accounts s
join v3_relationship_source_map map on map.company_id=s.company_id
 and map.source_relationship_id=s.email_relationship_id;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_drafts',s.company_id,s.draft_id,
 'email_drafts',s.draft_id,
 case when nullif(btrim(s.source_message_id),'') is not null and not s.valid_source_snapshot
  then 'retained_without_source_link' else 'updated' end,
 md5(to_jsonb(s)::text)
from v3_current_email_run run cross join v3_draft_accounts s;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_signatures',s.company_id,s.signature_id,
 'email_signatures',s.signature_id,'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join communications_email_signatures s;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'communications_email_thread_download_jobs',s.company_id,
 s.download_job_id::text,'email_thread_download_jobs',s.download_job_id::text,
 'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join communications_email_thread_download_jobs s;

insert into v3_email_migration_items(run_id,source_table,company_id,source_key,
 target_table,target_key,disposition,source_checksum)
select run.run_id,'resource_attachments',s.company_id,s.resource_attachment_id::text,
 'attachment_relationships',s.resource_attachment_id::text,'updated',md5(to_jsonb(s)::text)
from v3_current_email_run run cross join resource_attachments s;

do $$
begin
 if (select count(*) from email_threads)<>(select count(*) from v3_thread_desired) then
  raise exception 'V3 email thread final count mismatch';
 end if;
 if (select count(*) from email_messages)<>(select count(*) from v3_message_desired) then
  raise exception 'V3 email message final count mismatch';
 end if;
 if (select count(*) from email_relationships)<>(select count(*) from v3_relationship_desired) then
  raise exception 'V3 email relationship final count mismatch';
 end if;
 if (select count(*) from email_drafts)<>(select count(*) from communications_email_drafts) then
  raise exception 'V3 email draft final count mismatch';
 end if;
 if (select count(*) from email_signatures)<>(select count(*) from communications_email_signatures) then
  raise exception 'V3 email signature final count mismatch';
 end if;
 if (select count(*) from email_thread_download_jobs)
    <>(select count(*) from communications_email_thread_download_jobs) then
  raise exception 'V3 email download-job final count mismatch';
 end if;
 if (select count(*) from attachment_relationships)
    <>(select count(*) from resource_attachments) then
  raise exception 'V3 attachment relationship final count mismatch';
 end if;
 if exists(select 1 from email_relationships r left join email_messages m
  on m.company_id=r.company_id and m.email_thread_id=r.email_thread_id
  and m.email_message_id=r.email_message_id where m.email_message_id is null) then
  raise exception 'V3 email relationship has no exact final message';
 end if;
 if exists(select 1 from email_drafts d where d.source_email_message_id is not null
  and not exists(select 1 from email_messages m where m.company_id=d.company_id
   and m.email_message_id=d.source_email_message_id)) then
  raise exception 'V3 email draft source message is missing';
 end if;
end $$;

update v3_email_migration_runs run set status='complete',
 summary=jsonb_build_object(
  'email_threads',(select count(*) from email_threads),
  'email_messages',(select count(*) from email_messages),
  'email_relationships',(select count(*) from email_relationships),
  'email_drafts',(select count(*) from email_drafts),
  'email_signatures',(select count(*) from email_signatures),
  'email_thread_download_jobs',(select count(*) from email_thread_download_jobs),
  'attachment_relationships',(select count(*) from attachment_relationships),
  'malformed_compose_source_links_omitted',(
    select count(*) from v3_draft_accounts
    where nullif(btrim(source_message_id),'') is not null and not valid_source_snapshot
  )
 ),completed_timestamp=now()
from v3_current_email_run current
where run.run_id=current.run_id;

select 'READY_FOR_BACKEND_CUTOVER_REVIEW' status,
 (select count(*) from email_threads) email_threads,
 (select count(*) from email_messages) email_messages,
 (select count(*) from email_relationships) email_relationships,
 (select count(*) from email_drafts) email_drafts,
 (select count(*) from email_signatures) email_signatures,
 (select count(*) from attachment_relationships) attachment_relationships;

