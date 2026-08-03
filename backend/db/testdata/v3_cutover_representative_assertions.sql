-- Assertions for the representative V3 cutover fixture. Every failure aborts.
do $$
begin
  if to_regclass('public.node_information') is not null
     or to_regclass('public.node_projection_table') is not null
     or to_regclass('public.node_projection_seen_snapshots') is not null
     or to_regclass('public.communications_email_collaborations') is not null
     or to_regclass('public.communications_email_nodes') is not null then
    raise exception 'representative V3 test: retired tables remain';
  end if;
  if (select count(*) from node_textboxes)<>3
     or (select count(*) from node_textbox_chats)<>2
     or (select count(*) from node_textbox_seen_snapshots)<>1 then
    raise exception 'representative V3 test: Node textbox row counts changed';
  end if;
  if not exists (
    select 1 from node_textbox_chats
    where chat_id='41000000-0000-0000-0000-000000000001'
      and message='current projection chat'
      and mentioned_user_ids=array['20000000-0000-0000-0000-000000000002'::uuid]
  ) then
    raise exception 'representative V3 test: projection chat did not win over stale history';
  end if;
  if exists (
    select 1 from node_textbox_chats
    where chat_id='41000000-0000-0000-0000-000000000002'
  ) or exists (
    select 1 from resource_attachments
    where resource_attachment_id='81000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'representative V3 test: orphan textbox chat was not discarded';
  end if;
  if not exists (
    select 1 from node_textbox_chats
    where chat_id='41000000-0000-0000-0000-000000000003'
      and parent_chat_id is null
      and message='reply with missing parent'
  ) then
    raise exception 'representative V3 test: missing chat parent was not detached';
  end if;

  if not exists (
    select 1 from node_textbox_seen_snapshots
    where textbox_id='40000000-0000-0000-0000-000000000001'
      and textbox_revision=7
      and body_json::text like '%authoritative one%'
  ) then
    raise exception 'representative V3 test: seen snapshot did not use authoritative textbox body';
  end if;
  if exists (
    select 1 from node_textbox_seen_snapshots
    where textbox_id='40000000-0000-0000-0000-000000000099'
  ) then
    raise exception 'representative V3 test: orphan seen snapshot was not discarded';
  end if;
  if not exists (
    select 1 from node_content_changes
    where change_id='42000000-0000-0000-0000-000000000001'
      and textbox_id='40000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'representative V3 test: content change textbox identity was not preserved';
  end if;
  if (select count(*) from email_threads)<>3
     or (select count(*) from email_messages)<>3
     or (select count(*) from email_relationships)<>3 then
    raise exception 'representative V3 test: normalized/fallback email counts are wrong';
  end if;
  if not exists (
    select 1 from email_messages
    where provider_message_id='provider-message-1'
      and email_message_id='60000000-0000-0000-0000-000000000001'
      and subject='Normalized subject'
  ) then
    raise exception 'representative V3 test: normalized message did not keep precedence and ID';
  end if;
  if not exists (
    select 1 from email_messages
    where provider_message_id='provider-message-2'
      and subject='Collaboration fallback subject'
      and rich_html_body='<p>fallback body</p>'
  ) then
    raise exception 'representative V3 test: collaboration snapshot fallback failed';
  end if;
  if not exists (
    select 1 from email_messages
    where provider_message_id='provider-message-3'
      and subject='Projection fallback subject'
  ) then
    raise exception 'representative V3 test: projection snapshot fallback failed';
  end if;
  if not exists (
    select 1 from resource_permissions
    where company_id='10000000-0000-0000-0000-000000000001'
      and resource_type='node'
      and resource_id='30000000-0000-0000-0000-000000000002'
      and subject_id='20000000-0000-0000-0000-000000000002'
      and access_level='edit'
  ) then
    raise exception 'representative V3 test: participant permission was not backfilled';
  end if;
  if not exists (
    select 1 from resource_attachments
    where resource_attachment_id='81000000-0000-0000-0000-000000000001'
      and resource_type='email_relationship'
      and resource_id='71000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'representative V3 test: attachment relationship identity was not converted';
  end if;
  if not exists (
    select 1 from resource_attachments
    where resource_attachment_id='81000000-0000-0000-0000-000000000003'
      and resource_type='email_message'
      and resource_id='60000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'representative V3 test: email attachment did not survive its deleted textbox';
  end if;
  if not exists (
    select 1 from email_drafts
    where draft_id='fixture-missing-source-draft'
      and source_email_message_id is null
      and body_editor_html='<p>keep this draft</p>'
  ) then
    raise exception 'representative V3 test: draft with missing source message was not preserved';
  end if;
end;
$$;