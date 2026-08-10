set constraints all deferred;

create temporary table mangorts_email_node_textbox_cutover as
select wide.company_id,
       wide.email_relationship_id,
       wide.resource_id as node_id,
       wide.email_message_id,
       coalesce(exact.resource_textbox_id::uuid,gen_random_uuid()) as textbox_id,
       exact.email_relationship_id as duplicate_relationship_id
from email_relationships wide
left join lateral (
  select candidate.email_relationship_id,candidate.resource_textbox_id
  from email_relationships candidate
  where candidate.company_id=wide.company_id
    and candidate.email_message_id=wide.email_message_id
    and candidate.resource_type='node'
    and candidate.resource_id=wide.resource_id
    and candidate.resource_textbox_id is not null
  order by candidate.created_timestamp,candidate.email_relationship_id
  limit 1
) exact on true
where wide.resource_type='node'
  and wide.resource_textbox_id is null;

delete from email_relationships relationship
using mangorts_email_node_textbox_cutover cutover
where relationship.company_id=cutover.company_id
  and relationship.email_relationship_id=cutover.duplicate_relationship_id;

insert into node_textboxes(
  company_id,node_id,textbox_id,body_json,title,revision,display_order,created_timestamp,updated_timestamp
)
select cutover.company_id,cutover.node_id,cutover.textbox_id,
       jsonb_build_object(
         'format','mango-tiptap-json',
         'schema_version','1',
         'document',jsonb_build_object('type','doc','content',jsonb_build_array()),
         'annotations',jsonb_build_array()
       ),
       message.subject,0,
       coalesce(current_order.max_order,-1)+row_number() over(
         partition by cutover.company_id,cutover.node_id
         order by message.message_order,message.provider_message_id,cutover.email_relationship_id
       ),
       relationship.created_timestamp,relationship.created_timestamp
from mangorts_email_node_textbox_cutover cutover
join email_relationships relationship
  on relationship.company_id=cutover.company_id
 and relationship.email_relationship_id=cutover.email_relationship_id
join email_messages message
  on message.company_id=relationship.company_id
 and message.email_message_id=relationship.email_message_id
left join lateral (
  select max(textbox.display_order) as max_order
  from node_textboxes textbox
  where textbox.company_id=cutover.company_id
    and textbox.node_id=cutover.node_id
) current_order on true
where cutover.duplicate_relationship_id is null
on conflict(company_id,node_id,textbox_id) do nothing;

update email_relationships relationship
set resource_textbox_id=cutover.textbox_id::text
from mangorts_email_node_textbox_cutover cutover
where relationship.company_id=cutover.company_id
  and relationship.email_relationship_id=cutover.email_relationship_id;

drop table mangorts_email_node_textbox_cutover;

create temporary table mangorts_email_node_textbox_split as
select ranked.company_id,
       ranked.email_relationship_id,
       ranked.resource_id as node_id,
       ranked.email_message_id,
       gen_random_uuid() as textbox_id,
       ranked.created_timestamp,
       ranked.message_order,
       ranked.provider_message_id,
       ranked.subject
from (
  select relationship.*,
         message.message_order,
         message.provider_message_id,
         message.subject,
         row_number() over(
           partition by relationship.company_id,relationship.resource_id,relationship.resource_textbox_id
           order by relationship.created_timestamp,relationship.email_relationship_id
         ) as textbox_message_number
  from email_relationships relationship
  join email_messages message
    on message.company_id=relationship.company_id
   and message.email_message_id=relationship.email_message_id
  where relationship.resource_type='node'
) ranked
where ranked.textbox_message_number>1;

insert into node_textboxes(
  company_id,node_id,textbox_id,body_json,title,revision,display_order,created_timestamp,updated_timestamp
)
select split.company_id,split.node_id,split.textbox_id,
       jsonb_build_object(
         'format','mango-tiptap-json',
         'schema_version','1',
         'document',jsonb_build_object('type','doc','content',jsonb_build_array()),
         'annotations',jsonb_build_array()
       ),
       split.subject,0,
       coalesce(current_order.max_order,-1)+row_number() over(
         partition by split.company_id,split.node_id
         order by split.message_order,split.provider_message_id,split.email_relationship_id
       ),
       split.created_timestamp,split.created_timestamp
from mangorts_email_node_textbox_split split
left join lateral (
  select max(textbox.display_order) as max_order
  from node_textboxes textbox
  where textbox.company_id=split.company_id
    and textbox.node_id=split.node_id
) current_order on true;

update email_relationships relationship
set resource_textbox_id=split.textbox_id::text
from mangorts_email_node_textbox_split split
where relationship.company_id=split.company_id
  and relationship.email_relationship_id=split.email_relationship_id;

drop table mangorts_email_node_textbox_split;

do $$
begin
  if exists (
    select 1
    from email_relationships
    where resource_type='node' and resource_textbox_id is not null
    group by company_id,resource_id,resource_textbox_id
    having count(*)>1
  ) then
    raise exception 'STOP: one Node textbox still links to several email messages';
  end if;
end;
$$;

alter table email_relationships
  drop constraint if exists email_relationships_node_textbox_required_chk,
  add constraint email_relationships_node_textbox_required_chk
    check (resource_type <> 'node' or resource_textbox_id is not null);

create unique index if not exists idx_email_relationships_one_message_per_node_textbox
  on email_relationships(company_id,resource_id,resource_textbox_id)
  where resource_type='node' and resource_textbox_id is not null;
