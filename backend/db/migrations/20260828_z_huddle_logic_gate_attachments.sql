begin;

alter table attachment_relationships
  drop constraint attachment_relationships_type_chk,
  add constraint attachment_relationships_type_chk check (
    resource_type in (
      'node','logic_gate','project','huddle_logic_gate','huddle_node','node_chat_message',
      'logic_gate_chat_message','project_chat_message','email_message',
      'email_draft','email_signature','shared_inbox',
      'company_explorer_folder','shared_inbox_folder'
    )
  );

alter table attachment_upload_jobs
  drop constraint attachment_upload_jobs_resource_type_chk,
  add constraint attachment_upload_jobs_resource_type_chk check (
    resource_type in (
      'node','logic_gate','project','huddle_logic_gate','huddle_node','node_chat_message',
      'logic_gate_chat_message','project_chat_message','email_message',
      'email_draft','email_signature','attached_email','shared_inbox',
      'company_explorer_folder','shared_inbox_folder'
    )
  );

create or replace function mangorts_validate_attachment_relationship_owner()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.deleted_timestamp is not null then
    return new;
  end if;

  perform 1
  from attachments attachment
  where attachment.company_id=new.company_id
    and attachment.attachment_id=new.attachment_id
    and attachment.deleted_timestamp is null
  for update;
  if not found then
    raise exception 'attachment is missing or pending deletion' using errcode='23503';
  end if;

  if new.resource_type='node' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from nodes where company_id=new.company_id
                     and node_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Node owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='logic_gate' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from logic_gates where company_id=new.company_id
                     and logic_gate_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Logic Gate owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='project' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from projects where company_id=new.company_id
                     and project_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Project owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='huddle_logic_gate' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from huddle_logic_gates where company_id=new.company_id
                     and huddle_logic_gate_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Huddle Logic Gate owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='huddle_node' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from huddle_nodes where company_id=new.company_id
                     and huddle_node_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment Huddle Node owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='node_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from node_textbox_chats where company_id=new.company_id
                     and chat_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end and deleted_timestamp is null) then
      raise exception 'attachment Node chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='logic_gate_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from logic_gate_projection_table
                     where company_id=new.company_id
                       and information_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end
                       and type='Text block chat'::information_type
                       and is_deleted=false) then
      raise exception 'attachment Logic Gate chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='project_chat_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from project_textbox_chats
                     where company_id=new.company_id
                       and chat_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end
                       and deleted_timestamp is null) then
      raise exception 'attachment Project chat owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_message' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from email_messages where company_id=new.company_id
                     and email_message_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment email message owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_draft' then
    if not exists(select 1 from email_drafts where company_id=new.company_id
                  and draft_id=new.resource_id and deleted_timestamp is null) then
      raise exception 'attachment email draft owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='email_signature' then
    if not exists(select 1 from email_signatures where company_id=new.company_id
                  and signature_id=new.resource_id) then
      raise exception 'attachment email signature owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='shared_inbox' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from shared_inboxes where company_id=new.company_id
                     and shared_inbox_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment shared inbox owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='company_explorer_folder' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from company_explorer_folders where company_id=new.company_id
                     and folder_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment company folder owner does not exist' using errcode='23503';
    end if;
  elsif new.resource_type='shared_inbox_folder' then
    if not pg_input_is_valid(new.resource_id,'uuid')
       or not exists(select 1 from shared_inbox_folders where company_id=new.company_id
                     and folder_id=case when pg_input_is_valid(new.resource_id,'uuid') then new.resource_id::uuid end) then
      raise exception 'attachment shared inbox folder owner does not exist' using errcode='23503';
    end if;
  else
    raise exception 'unsupported attachment owner type' using errcode='23514';
  end if;
  return new;
end;
$$;

commit;
