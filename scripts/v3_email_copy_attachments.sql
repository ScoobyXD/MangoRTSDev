create temp table v3_attachment_desired (
 attachment_relationship_id uuid not null,company_id uuid not null,
 resource_type text not null,resource_id text not null,attachment_id uuid not null,
 information_id uuid,message_id text not null,editor_surface text not null,
 relationship_kind text not null,created_by_user_id uuid,
 created_timestamp timestamptz not null,deleted_timestamp timestamptz
) on commit drop;

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,r.resource_type,r.resource_id,r.attachment_id,
 r.information_id,r.message_id,r.editor_surface,r.relationship_kind,
 r.created_by_user_id,r.created_timestamp,r.deleted_timestamp
from resource_attachments r
where r.resource_type not in('email_message','email_draft','email_signature','attached_email')
 and not (r.resource_type='node'
  and r.relationship_kind in('email_attachment','email_inline_attachment')
  and btrim(r.message_id)<>'');

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_draft',
 pg_temp.v3_query_unescape(parts[array_length(parts,1)]),r.attachment_id,
 null,'','',r.relationship_kind,r.created_by_user_id,r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
where r.resource_type='email_draft'
 and array_length(parts,1) in(3,4)
 and exists(select 1 from email_drafts d where d.company_id=r.company_id
  and d.draft_id=pg_temp.v3_query_unescape(parts[array_length(parts,1)]));

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_signature',signature.signature_id,
 r.attachment_id,null,'','',r.relationship_kind,r.created_by_user_id,
 r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
join email_signatures signature on signature.company_id=r.company_id and (
 (parts[1]='personal' and array_length(parts,1)=3
  and signature.email_account_type='personal_email_account'
  and signature.personal_user_id::text=pg_temp.v3_query_unescape(parts[2])
  and signature.personal_account_email=lower(pg_temp.v3_query_unescape(parts[3])))
 or
 (parts[1]='shared' and array_length(parts,1)=2
  and signature.email_account_type='shared_email_account'
  and signature.shared_inbox_id::text=pg_temp.v3_query_unescape(parts[2]))
)
where r.resource_type='email_signature';

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_message',resolved.email_message_id::text,
 r.attachment_id,null,'','',r.relationship_kind,r.created_by_user_id,
 r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
cross join lateral (
 select count(distinct m.email_message_id) n,min(m.email_message_id::text)::uuid email_message_id
 from email_messages m join email_threads t on t.company_id=m.company_id
  and t.email_thread_id=m.email_thread_id
 where m.company_id=r.company_id and m.provider_message_id=pg_temp.v3_query_unescape(parts[3])
  and ((parts[1]='personal' and array_length(parts,1)=3
    and t.email_account_type='personal_email_account'
    and t.personal_user_id::text=pg_temp.v3_query_unescape(parts[2]))
   or (parts[1]='shared' and array_length(parts,1)=3
    and t.email_account_type='shared_email_account'
    and t.shared_inbox_id::text=pg_temp.v3_query_unescape(parts[2])))
) resolved
where r.resource_type='email_message' and resolved.n=1;

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_message',resolved.email_message_id::text,
 r.attachment_id,null,'','',r.relationship_kind,r.created_by_user_id,
 r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (select string_to_array(r.resource_id,':') parts) decoded
cross join lateral (
 select count(distinct rel.email_message_id) n,
        min(rel.email_message_id::text)::uuid email_message_id
 from email_relationships rel join email_messages m on m.company_id=rel.company_id
  and m.email_message_id=rel.email_message_id
 where rel.company_id=r.company_id and rel.resource_type='node'
  and rel.resource_id::text=pg_temp.v3_query_unescape(parts[2])
  and m.provider_message_id=pg_temp.v3_query_unescape(parts[4])
) resolved
where r.resource_type='attached_email' and array_length(parts,1)=4
 and parts[1]='node' and parts[3]='message' and resolved.n=1;

insert into v3_attachment_desired
select r.resource_attachment_id,r.company_id,'email_message',resolved.email_message_id::text,
 r.attachment_id,null,'','',r.relationship_kind,r.created_by_user_id,
 r.created_timestamp,r.deleted_timestamp
from resource_attachments r
cross join lateral (
 select count(distinct rel.email_message_id) n,
        min(rel.email_message_id::text)::uuid email_message_id
 from email_relationships rel join email_messages m on m.company_id=rel.company_id
  and m.email_message_id=rel.email_message_id
 where rel.company_id=r.company_id and rel.resource_type='node'
  and rel.resource_id::text=r.resource_id and m.provider_message_id=r.message_id
) resolved
where r.resource_type='node'
 and r.relationship_kind in('email_attachment','email_inline_attachment')
 and btrim(r.message_id)<>'' and resolved.n=1;

do $$
begin
 if (select count(*) from v3_attachment_desired)<>(select count(*) from resource_attachments) then
  raise exception 'not every legacy attachment relationship resolved exactly once';
 end if;
 if exists(select 1 from v3_attachment_desired group by attachment_relationship_id having count(*)<>1) then
  raise exception 'legacy attachment relationship mapped more than once';
 end if;
 if exists(select 1 from v3_attachment_desired a where a.resource_type='email_message'
  and not exists(select 1 from email_messages m where m.company_id=a.company_id
   and m.email_message_id::text=a.resource_id)) then
  raise exception 'incoming-email file did not target an internal email_message_id';
 end if;
end $$;

insert into attachment_relationships(attachment_relationship_id,company_id,resource_type,
 resource_id,attachment_id,information_id,message_id,editor_surface,relationship_kind,
 created_by_user_id,created_timestamp,deleted_timestamp)
select attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,
 information_id,message_id,editor_surface,relationship_kind,created_by_user_id,
 created_timestamp,deleted_timestamp from v3_attachment_desired
on conflict(attachment_relationship_id) do update set
 company_id=excluded.company_id,resource_type=excluded.resource_type,
 resource_id=excluded.resource_id,attachment_id=excluded.attachment_id,
 information_id=excluded.information_id,message_id=excluded.message_id,
 editor_surface=excluded.editor_surface,relationship_kind=excluded.relationship_kind,
 created_by_user_id=excluded.created_by_user_id,
 created_timestamp=least(attachment_relationships.created_timestamp,excluded.created_timestamp),
 deleted_timestamp=excluded.deleted_timestamp;

