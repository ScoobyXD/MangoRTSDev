-- Attachment Step 1 read-only preflight.
-- RESULT SET 1 starts with exactly one readiness row. Do not continue unless
-- that first row says READY_FOR_ATTACHMENT_STEP1. Summary counts follow it,
-- then the safe identities needed to audit any cleanup candidates.
-- RESULT SET 2 is the exact attachment-table column inventory.
-- RESULT SET 3 is the exact constraint and index inventory.
--
-- These SQL files do not map one-to-one to the three product rollout steps.
-- Open this whole file in DBeaver and execute it as one script. It uses plain
-- PostgreSQL SQL only and never returns filenames, resource IDs, object keys,
-- message content, credentials, signed URLs, or attachment bytes.

begin transaction isolation level repeatable read read only;
set local statement_timeout = '5min';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '6min';

-- RESULT SET 1: decision first, summary second, safe audit detail last.
with recursive
source_relationships as (
  select r.*,string_to_array(r.resource_id,':') parts
  from resource_attachments r
),
encoded_parts as (
  select resource_attachment_id,'target'::text part_name,
         parts[array_length(parts,1)] encoded_value
  from source_relationships
  where resource_type='email_draft'
    and ((parts[1]='personal' and array_length(parts,1) in(3,4))
      or (parts[1] in('shared','collaboration') and array_length(parts,1)=3))
  union all
  select resource_attachment_id,'owner',parts[2]
  from source_relationships
  where resource_type in('email_signature','email_message','attached_email')
  union all
  select resource_attachment_id,'item',
         case when resource_type='attached_email' then parts[4] else parts[3] end
  from source_relationships
  where resource_type in('email_signature','email_message','attached_email')
),
decoded_walk(resource_attachment_id,part_name,encoded_value,pos,decoded,valid) as (
  select resource_attachment_id,part_name,encoded_value,1,''::bytea,true
  from encoded_parts
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
  from decoded_walk
  where valid and pos<=char_length(encoded_value)
),
decoded_parts as (
  select resource_attachment_id,part_name,
         case when valid and pos>char_length(encoded_value)
                    and btrim(convert_from(decoded,'UTF8'))<>''
              then btrim(convert_from(decoded,'UTF8')) end decoded_value
  from decoded_walk
  where not valid or pos>char_length(encoded_value)
),
inputs as (
  select s.*,
    (select decoded_value from decoded_parts d
      where d.resource_attachment_id=s.resource_attachment_id
        and d.part_name='target') target_value,
    (select decoded_value from decoded_parts d
      where d.resource_attachment_id=s.resource_attachment_id
        and d.part_name='owner') owner_value,
    (select decoded_value from decoded_parts d
      where d.resource_attachment_id=s.resource_attachment_id
        and d.part_name='item') item_value
  from source_relationships s
),
shapes as (
  select i.*,case
    when resource_type in(
      'node','logic_gate','project','node_chat_message','logic_gate_chat_message',
      'project_chat_message','shared_inbox','company_explorer_folder',
      'shared_inbox_folder'
    ) and not (resource_type='node'
      and relationship_kind in('email_attachment','email_inline_attachment')
      and btrim(message_id)<>'') then true
    when resource_type='email_draft' then target_value is not null
      and ((parts[1]='personal' and array_length(parts,1) in(3,4))
        or (parts[1] in('shared','collaboration') and array_length(parts,1)=3))
    when resource_type='email_signature' then
      (parts[1]='personal' and array_length(parts,1)=3
        and owner_value is not null and item_value is not null)
      or (parts[1]='shared' and array_length(parts,1)=2
        and owner_value is not null)
    when resource_type='email_message' then parts[1] in('personal','shared')
      and array_length(parts,1)=3 and owner_value is not null
      and item_value is not null
    when resource_type='attached_email' then parts[1]='node'
      and array_length(parts,1)=4 and parts[3]='message'
      and owner_value is not null and item_value is not null
    when resource_type='node'
      and relationship_kind in('email_attachment','email_inline_attachment')
      then btrim(resource_id)<>'' and btrim(message_id)<>''
    else false end valid_shape
  from inputs i
),
candidates as (
  select s.resource_attachment_id,s.resource_type mapped_resource_type,
         s.resource_id mapped_resource_id
  from shapes s
  where s.valid_shape
    and s.resource_type in(
      'node','logic_gate','project','node_chat_message','logic_gate_chat_message',
      'project_chat_message','shared_inbox','company_explorer_folder',
      'shared_inbox_folder'
    )
    and not (s.resource_type='node'
      and s.relationship_kind in('email_attachment','email_inline_attachment')
      and btrim(s.message_id)<>'')
  union all
  select s.resource_attachment_id,'email_draft',d.draft_id
  from shapes s
  join email_drafts d on d.company_id=s.company_id and d.draft_id=s.target_value
  where s.valid_shape and s.resource_type='email_draft'
  union all
  select s.resource_attachment_id,'email_signature',signature.signature_id
  from shapes s
  join email_signatures signature on signature.company_id=s.company_id and (
    (s.parts[1]='personal'
      and signature.email_account_type='personal_email_account'
      and signature.personal_user_id::text=s.owner_value
      and signature.personal_account_email=lower(s.item_value))
    or
    (s.parts[1]='shared'
      and signature.email_account_type='shared_email_account'
      and signature.shared_inbox_id::text=s.owner_value)
  )
  where s.valid_shape and s.resource_type='email_signature'
  union all
  select s.resource_attachment_id,'email_message',m.email_message_id::text
  from shapes s
  join email_messages m on m.company_id=s.company_id
    and m.provider_message_id=s.item_value
  join email_threads t on t.company_id=m.company_id
    and t.email_thread_id=m.email_thread_id
    and ((s.parts[1]='personal'
      and t.email_account_type='personal_email_account'
      and t.personal_user_id::text=s.owner_value)
      or (s.parts[1]='shared'
      and t.email_account_type='shared_email_account'
      and t.shared_inbox_id::text=s.owner_value))
  where s.valid_shape and s.resource_type='email_message'
  union all
  select s.resource_attachment_id,'email_message',m.email_message_id::text
  from shapes s
  join email_relationships rel on rel.company_id=s.company_id
    and rel.resource_type='node' and rel.resource_id::text=s.owner_value
  join email_messages m on m.company_id=rel.company_id
    and m.email_message_id=rel.email_message_id
    and m.provider_message_id=s.item_value
  where s.valid_shape and s.resource_type='attached_email'
  union all
  select s.resource_attachment_id,'email_message',m.email_message_id::text
  from shapes s
  join email_relationships rel on rel.company_id=s.company_id
    and rel.resource_type='node' and rel.resource_id::text=s.resource_id
  join email_messages m on m.company_id=rel.company_id
    and m.email_message_id=rel.email_message_id
    and m.provider_message_id=s.message_id
  where s.valid_shape and s.resource_type='node'
    and s.relationship_kind in('email_attachment','email_inline_attachment')
    and btrim(s.message_id)<>''
),
candidate_counts as (
  select s.resource_attachment_id,s.valid_shape,
         count(distinct (c.mapped_resource_type,c.mapped_resource_id)) candidate_count
  from shapes s
  left join candidates c on c.resource_attachment_id=s.resource_attachment_id
  group by s.resource_attachment_id,s.valid_shape
),
unique_candidates as (
  select c.resource_attachment_id,min(c.mapped_resource_type) mapped_resource_type,
         min(c.mapped_resource_id) mapped_resource_id
  from candidates c
  group by c.resource_attachment_id
  having count(distinct (c.mapped_resource_type,c.mapped_resource_id))=1
),
desired as (
  select s.resource_attachment_id attachment_relationship_id,s.company_id,
         c.mapped_resource_type resource_type,c.mapped_resource_id resource_id,
         s.attachment_id,s.information_id,s.message_id,s.editor_surface,
         s.relationship_kind,s.created_by_user_id,s.created_timestamp,
         s.deleted_timestamp
  from shapes s
  join candidate_counts cc on cc.resource_attachment_id=s.resource_attachment_id
    and cc.valid_shape and cc.candidate_count=1
  join unique_candidates c on c.resource_attachment_id=s.resource_attachment_id
),
approved_evidence as (
  select distinct item.company_id,item.source_key::uuid resource_attachment_id,
         item.target_key::uuid attachment_id,item.source_checksum
  from v3_email_migration_items item
  where item.source_table='resource_attachments'
    and item.disposition='retained_orphan_evidence'
    and pg_input_is_valid(item.source_key,'uuid')
    and pg_input_is_valid(item.target_key,'uuid')
),
broken_live as (
  select s.resource_attachment_id,s.company_id,s.attachment_id,s.resource_type,
         s.relationship_kind,md5(to_jsonb(r)::text) source_checksum
  from shapes s
  join resource_attachments r
    on r.resource_attachment_id=s.resource_attachment_id
  join candidate_counts cc on cc.resource_attachment_id=s.resource_attachment_id
  where cc.valid_shape and cc.candidate_count=0
),
evidence_conflicts as (
  select e.resource_attachment_id
  from approved_evidence e
  join candidate_counts cc on cc.resource_attachment_id=e.resource_attachment_id
  where not (cc.valid_shape and cc.candidate_count=0)
),
owner_checks as (
  select d.*,case
    when d.deleted_timestamp is not null then true
    when d.resource_type='node' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from nodes n where n.company_id=d.company_id
        and n.node_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='logic_gate' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from logic_gates g where g.company_id=d.company_id
        and g.logic_gate_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='project' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from projects p where p.company_id=d.company_id
        and p.project_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='node_chat_message' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from node_textbox_chats chat
        where chat.company_id=d.company_id
          and chat.chat_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end and chat.deleted_timestamp is null)
    when d.resource_type='logic_gate_chat_message' then
      pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from logic_gate_projection_table projection
        where projection.company_id=d.company_id
          and projection.information_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end
          and projection.type='Text block chat'::information_type
          and projection.is_deleted=false)
    when d.resource_type='project_chat_message' then
      pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from project_projection_table projection
        where projection.company_id=d.company_id
          and projection.information_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end
          and projection.type='Text block chat'::information_type)
    when d.resource_type='email_message' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from email_messages m where m.company_id=d.company_id
        and m.email_message_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='email_draft' then exists(select 1 from email_drafts draft
      where draft.company_id=d.company_id and draft.draft_id=d.resource_id
        and draft.deleted_timestamp is null)
    when d.resource_type='email_signature' then exists(select 1 from email_signatures signature
      where signature.company_id=d.company_id and signature.signature_id=d.resource_id)
    when d.resource_type='shared_inbox' then pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from shared_inboxes inbox where inbox.company_id=d.company_id
        and inbox.shared_inbox_id=case when pg_input_is_valid(d.resource_id,'uuid')
          then d.resource_id::uuid end)
    when d.resource_type='company_explorer_folder' then
      pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from company_explorer_folders folder
        where folder.company_id=d.company_id
          and folder.folder_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end)
    when d.resource_type='shared_inbox_folder' then
      pg_input_is_valid(d.resource_id,'uuid')
      and exists(select 1 from shared_inbox_folders folder
        where folder.company_id=d.company_id
          and folder.folder_id=case when pg_input_is_valid(d.resource_id,'uuid')
            then d.resource_id::uuid end)
    else false end owner_exists
  from desired d
),
valid_active_relationships as (
  select * from owner_checks
  where deleted_timestamp is null and owner_exists
),
relationship_counts as (
  select a.company_id,a.attachment_id,
         count(v.attachment_relationship_id) active_relationship_count
  from attachments a
  left join valid_active_relationships v on v.company_id=a.company_id
    and v.attachment_id=a.attachment_id
  group by a.company_id,a.attachment_id
),
orphan_attachments as (
  select c.company_id,c.attachment_id,
         case when exists(select 1 from approved_evidence e
                          where e.attachment_id=c.attachment_id)
              then 'approved_broken_relationship_attachment'
              else 'other_zero_owner_attachment' end orphan_class
  from relationship_counts c
  where c.active_relationship_count=0
),
target_conflicts as (
  select target.attachment_relationship_id
  from attachment_relationships target
  join desired d on d.attachment_relationship_id=target.attachment_relationship_id
  where row(target.company_id,target.resource_type,target.resource_id,
            target.attachment_id,target.information_id,target.message_id,
            target.editor_surface,target.relationship_kind,target.created_by_user_id,
            target.created_timestamp,target.deleted_timestamp)
    is distinct from
        row(d.company_id,d.resource_type,d.resource_id,d.attachment_id,
            d.information_id,d.message_id,d.editor_surface,d.relationship_kind,
            d.created_by_user_id,d.created_timestamp,d.deleted_timestamp)
),
target_extras as (
  select target.attachment_relationship_id
  from attachment_relationships target
  left join desired d on d.attachment_relationship_id=target.attachment_relationship_id
  where d.attachment_relationship_id is null
),
storage_references as (
  select a.company_id,a.attachment_id,'original'::text storage_role,
         a.storage_bucket,a.storage_key
  from attachments a
  union all
  select a.company_id,v.attachment_id,'legacy_'||v.variant_type,
         v.storage_bucket,v.storage_key
  from attachment_variants v join attachments a using(attachment_id)
  union all
  select i.company_id,i.attachment_id,'upload_'||i.status,
         i.storage_bucket,i.storage_key
  from attachment_upload_intents i
),
reused_storage as (
  select md5(storage_bucket||E'\x1f'||storage_key) storage_identity,
         count(*) reference_count,count(distinct attachment_id) attachment_count,
         string_agg(distinct storage_role,',' order by storage_role) roles
  from storage_references
  group by storage_bucket,storage_key
  having count(*)>1
),
metrics as (
  select 'table_rows' category,'attachments' detail,count(*)::bigint value from attachments
  union all select 'table_rows','resource_attachments',count(*) from resource_attachments
  union all select 'table_rows','attachment_relationships',count(*) from attachment_relationships
  union all select 'table_rows','attachment_upload_intents',count(*) from attachment_upload_intents
  union all select 'table_rows','attachment_upload_parts',count(*) from attachment_upload_parts
  union all select 'table_rows','attachment_variants',count(*) from attachment_variants
  union all select 'table_rows','attachment_migration_runs',count(*) from attachment_migration_runs
  union all select 'table_rows','attachment_migration_items',count(*) from attachment_migration_items
  union all select 'attachments_state','active',count(*) from attachments where deleted_timestamp is null
  union all select 'attachments_state','deleted_or_pending',count(*) from attachments where deleted_timestamp is not null
  union all select 'legacy_relationship_state','active',count(*) from resource_attachments where deleted_timestamp is null
  union all select 'legacy_relationship_state','deleted',count(*) from resource_attachments where deleted_timestamp is not null
  union all select 'final_relationship_state','active',count(*) from attachment_relationships where deleted_timestamp is null
  union all select 'final_relationship_state','deleted',count(*) from attachment_relationships where deleted_timestamp is not null
  union all select 'classification','legacy_relationships_resolved',count(*) from desired
  union all select 'classification','broken_relationships_live',count(*) from broken_live
  union all select 'classification','approved_broken_identities',count(*) from approved_evidence
  union all select 'classification','malformed_or_ambiguous_relationships',count(*)
    from candidate_counts where not valid_shape or candidate_count>1
  union all select 'classification','invalid_active_final_owners',count(*)
    from owner_checks where deleted_timestamp is null and not owner_exists
  union all select 'classification','target_conflicts',count(*) from target_conflicts
  union all select 'classification','target_extras',count(*) from target_extras
  union all select 'classification','evidence_conflicts',count(*) from evidence_conflicts
  union all select 'relationship_cardinality','zero',count(*) from relationship_counts where active_relationship_count=0
  union all select 'relationship_cardinality','one',count(*) from relationship_counts where active_relationship_count=1
  union all select 'relationship_cardinality','many',count(*) from relationship_counts where active_relationship_count>1
  union all select 'expected_final','attachment_relationships',count(*) from desired
  union all select 'expected_final','attachment_upload_jobs',count(*) from attachment_upload_intents
  union all select 'expected_final','attachment_previews',count(*) from attachment_variants
    where variant_type in('display','thumbnail')
  union all select 'expected_final','retained_attachments',count(*) from relationship_counts
    where active_relationship_count>0
  union all select 'cleanup','orphan_attachments_all',count(*) from orphan_attachments
  union all select 'cleanup','email_send_rows',count(*) from attachment_variants where variant_type='email_send'
  union all select 'cleanup','legacy_original_preview_rows',count(*) from attachment_variants where variant_type='original'
  union all select 'storage','reused_keys',count(*) from reused_storage
  union all select 'storage','unsafe_cross_attachment_reuse',count(*) from reused_storage where attachment_count>1
  union all select 'multipart','parts_without_intent',count(*) from attachment_upload_parts p
    where not exists(select 1 from attachment_upload_intents i
      where i.upload_intent_id=p.upload_intent_id)
),
relationship_type_metrics as (
  select 'legacy_relationship_resource_type' category,
         resource_type||':'||case when deleted_timestamp is null then 'active' else 'deleted' end detail,
         count(*)::bigint value
  from resource_attachments group by resource_type,(deleted_timestamp is null)
  union all
  select 'final_relationship_resource_type',
         resource_type||':'||case when deleted_timestamp is null then 'active' else 'deleted' end,
         count(*)::bigint
  from attachment_relationships group by resource_type,(deleted_timestamp is null)
),
upload_metrics as (
  select 'upload_status' category,status detail,count(*)::bigint value
  from attachment_upload_intents group by status
  union all
  select 'multipart_strategy',strategy,count(*)::bigint
  from attachment_upload_intents group by strategy
),
preview_metrics as (
  select 'legacy_preview_type' category,variant_type detail,count(*)::bigint value
  from attachment_variants group by variant_type
),
readiness as (
  select case when
    (select count(*) from candidate_counts where not valid_shape or candidate_count>1)=0
    and (select count(*) from owner_checks
         where deleted_timestamp is null and not owner_exists)=0
    and (select count(*) from target_conflicts)=0
    and (select count(*) from target_extras)=0
    and (select count(*) from evidence_conflicts)=0
    and not exists(
      select 1 from broken_live b
      where not exists(select 1 from approved_evidence e
        where e.company_id=b.company_id
          and e.resource_attachment_id=b.resource_attachment_id
          and e.attachment_id=b.attachment_id
          and e.source_checksum=b.source_checksum)
    )
    and (
      (not exists(select 1 from v3_email_migration_runs)
        and (select count(*) from approved_evidence)=0)
      or
      (exists(select 1 from v3_email_migration_runs)
        and (select count(*) from approved_evidence)=213)
    )
    and not exists(select 1 from attachment_upload_intents
      where status in('pending','uploading','completing','failed'))
    and not exists(select 1 from reused_storage where attachment_count>1)
    and not exists(select 1 from attachment_upload_parts p
      where not exists(select 1 from attachment_upload_intents i
        where i.upload_intent_id=p.upload_intent_id))
    then 'READY_FOR_ATTACHMENT_STEP1'
    else 'STOP_AND_REVIEW' end status
),
report_rows as (
  -- Summary metrics and safe audit details share one result set.
select 'metric' section,m.category,null::uuid company_id,null::uuid identity_id,
       null::uuid attachment_id,m.detail,m.value
from metrics m
union all
select 'metric',m.category,null,null,null,m.detail,m.value
from relationship_type_metrics m
union all
select 'metric',m.category,null,null,null,m.detail,m.value
from upload_metrics m
union all
select 'metric',m.category,null,null,null,m.detail,m.value
from preview_metrics m
union all
select 'broken_relationship_identity','approved_broken_relationship',
       e.company_id,e.resource_attachment_id,e.attachment_id,
       case when b.resource_attachment_id is null then 'already_deleted'
            else b.resource_type||':'||b.relationship_kind end,null
from approved_evidence e
left join broken_live b on b.company_id=e.company_id
  and b.resource_attachment_id=e.resource_attachment_id
union all
select 'zero_owner_attachment',o.orphan_class,o.company_id,null,o.attachment_id,
       'no surviving active valid relationship',null
from orphan_attachments o
union all
select 'reused_storage_key','storage_key_fingerprint',null,null,null,
       r.storage_identity||':'||r.roles,r.reference_count
from reused_storage r
union all
select 'readiness',status,null,null,null,
       case when status='READY_FOR_ATTACHMENT_STEP1'
            then 'Continue only after reviewing the summary counts and safe audit details below.'
            else 'Stop. Do not run the Step 1 write script.' end,null
from readiness
)
select section,category,company_id,identity_id,attachment_id,detail,value
from report_rows
order by case section
           when 'readiness' then 1
           when 'metric' then 2
           when 'broken_relationship_identity' then 3
           when 'zero_owner_attachment' then 4
           when 'reused_storage_key' then 5
           else 6
         end,
         category,company_id,identity_id,attachment_id,detail;
-- RESULT SET 2: exact current/destination column inventory. Eight current
-- tables are always listed; additive destinations appear when expanded.
select c.table_name,c.ordinal_position,c.column_name,c.data_type,c.udt_name,
       c.is_nullable,c.column_default
from information_schema.columns c
where c.table_schema='public'
  and c.table_name in (
    'attachments','resource_attachments','attachment_relationships',
    'attachment_upload_intents','attachment_upload_parts','attachment_variants',
    'attachment_migration_runs','attachment_migration_items',
    'attachment_upload_jobs','attachment_previews'
  )
order by c.table_name,c.ordinal_position;

-- RESULT SET 3: exact keys, checks, foreign keys, and indexes without table data.
select 'constraint' object_kind,cls.relname table_name,con.conname object_name,
       pg_get_constraintdef(con.oid,true) definition
from pg_constraint con
join pg_class cls on cls.oid=con.conrelid
join pg_namespace ns on ns.oid=cls.relnamespace
where ns.nspname='public' and cls.relname in (
  'attachments','resource_attachments','attachment_relationships',
  'attachment_upload_intents','attachment_upload_parts','attachment_variants',
  'attachment_migration_runs','attachment_migration_items',
  'attachment_upload_jobs','attachment_previews'
)
union all
select 'index',tablename,indexname,indexdef
from pg_indexes
where schemaname='public' and tablename in (
  'attachments','resource_attachments','attachment_relationships',
  'attachment_upload_intents','attachment_upload_parts','attachment_variants',
  'attachment_migration_runs','attachment_migration_items',
  'attachment_upload_jobs','attachment_previews'
)
order by table_name,object_kind,object_name;

rollback; -- end read-only preflight
