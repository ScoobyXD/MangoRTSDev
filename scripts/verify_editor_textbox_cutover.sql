-- Read-only verification for the final V3 Node textbox and email-storage cutover.
-- This script intentionally fails when any required V3 table is missing or any
-- retired table remains. Run it with the database-enforced read-only role.

\set ON_ERROR_STOP on

do $$
declare
  required_table text;
  retired_table text;
begin
  foreach required_table in array array[
    'node_textboxes',
    'node_textbox_chats',
    'node_textbox_seen_snapshots',
    'email_threads',
    'email_messages',
    'email_relationships',
    'email_drafts',
    'email_thread_download_jobs'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'V3 cutover verification failed: required table % is missing', required_table;
    end if;
  end loop;

  foreach retired_table in array array[
    'node_information',
    'node_projection_table',
    'node_projection_seen_snapshots',
    'communications_email_collaborations',
    'communications_email_collaboration_participants',
    'communications_email_nodes',
    'communications_email_node_attachments',
    'communications_node_email_threads'
  ] loop
    if to_regclass('public.' || retired_table) is not null then
      raise exception 'V3 cutover verification failed: retired table % still exists', retired_table;
    end if;
  end loop;
end $$;

with checks as (
  select 'invalid current Node textbox JSON'::text as check_name,
         count(*)::bigint as problem_count
    from node_textboxes
   where body_json->>'format' <> 'mango-tiptap-json'
      or body_json->>'schema_version' <> '1'
      or body_json->'document'->>'type' <> 'doc'
      or jsonb_typeof(body_json->'annotations') <> 'array'
  union all
  select 'orphan Node textbox chat rows', count(*)
    from node_textbox_chats chat
    left join node_textboxes textbox
      on textbox.company_id=chat.company_id
     and textbox.node_id=chat.node_id
     and textbox.textbox_id=chat.textbox_id
   where textbox.textbox_id is null
  union all
  select 'orphan Node textbox seen snapshots', count(*)
    from node_textbox_seen_snapshots seen
    left join node_textboxes textbox
      on textbox.company_id=seen.company_id
     and textbox.node_id=seen.node_id
     and textbox.textbox_id=seen.textbox_id
   where textbox.textbox_id is null
  union all
  select 'orphan Node content changes', count(*)
    from node_content_changes change
    left join node_textboxes textbox
      on textbox.company_id=change.company_id
     and textbox.node_id=change.node_id
     and textbox.textbox_id=change.textbox_id
   where textbox.textbox_id is null
  union all
  select 'orphan email relationships', count(*)
    from email_relationships relationship
    left join email_messages message
      on message.company_id=relationship.company_id
     and message.email_thread_id=relationship.email_thread_id
     and message.email_message_id=relationship.email_message_id
   where message.email_message_id is null
  union all
  select 'legacy attached_email attachment identities', count(*)
    from resource_attachments
   where resource_type='attached_email'
)
select check_name,
       problem_count,
       case when problem_count=0 then 'ok' else 'blocker' end as status
  from checks
 order by check_name;