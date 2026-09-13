-- Run after 20260913_ctrl_loop.sql through the existing human-controlled migration process.
-- PostgreSQL 17 and 18. No data conversion and no generic browser-upload owner.
ALTER TABLE public.attachment_relationships DROP CONSTRAINT attachment_relationships_type_chk;
ALTER TABLE public.attachment_relationships ADD CONSTRAINT attachment_relationships_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'logic_gate'::text, 'project'::text, 'huddle_logic_gate'::text, 'huddle_node'::text, 'node_chat_message'::text, 'logic_gate_chat_message'::text, 'project_chat_message'::text, 'email_message'::text, 'email_draft'::text, 'email_signature'::text, 'shared_inbox'::text, 'company_explorer_folder'::text, 'shared_inbox_folder'::text, 'ctrl_loop_job'::text])));
ALTER TABLE public.attachment_relationships ADD CONSTRAINT attachment_relationships_ctrl_loop_shape_chk CHECK (resource_type <> 'ctrl_loop_job' OR (relationship_kind='file_attachment' AND information_id IS NULL AND message_id='' AND editor_surface=''));

CREATE OR REPLACE FUNCTION public.mangorts_validate_attachment_relationship_owner() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.deleted_timestamp is not null then
    return new;
  end if;

  if new.resource_type='ctrl_loop_job' then
    if not pg_input_is_valid(new.resource_id,'uuid') then
      raise exception 'attachment CtrlLoop owner ID is invalid' using errcode='23503';
    end if;
    perform 1 from ctrl_loop_jobs where company_id=new.company_id and job_id=new.resource_id::uuid for key share;
    if not found then
      raise exception 'attachment CtrlLoop owner does not exist in company' using errcode='23503';
    end if;
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

  if new.resource_type='ctrl_loop_job' then
    return new;
  elsif new.resource_type='node' then
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

CREATE FUNCTION public.mangorts_retire_ctrl_loop_attachments() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  PERFORM 1 FROM attachments a
  WHERE a.company_id=old.company_id AND EXISTS (
    SELECT 1 FROM attachment_relationships ar WHERE ar.company_id=a.company_id
      AND ar.attachment_id=a.attachment_id AND ar.resource_type='ctrl_loop_job'
      AND ar.resource_id=old.job_id::text AND ar.deleted_timestamp IS NULL)
  ORDER BY a.attachment_id FOR UPDATE;

  UPDATE attachment_relationships SET deleted_timestamp=clock_timestamp()
  WHERE company_id=old.company_id AND resource_type='ctrl_loop_job'
    AND resource_id=old.job_id::text AND deleted_timestamp IS NULL;

  UPDATE attachments a SET deleted_timestamp=clock_timestamp()
  WHERE a.company_id=old.company_id AND a.deleted_timestamp IS NULL
    AND EXISTS (SELECT 1 FROM attachment_relationships ar WHERE ar.company_id=a.company_id
      AND ar.attachment_id=a.attachment_id AND ar.resource_type='ctrl_loop_job' AND ar.resource_id=old.job_id::text)
    AND NOT EXISTS (SELECT 1 FROM attachment_relationships live WHERE live.company_id=a.company_id
      AND live.attachment_id=a.attachment_id AND live.deleted_timestamp IS NULL);
  RETURN old;
END;
$$;
CREATE TRIGGER ctrl_loop_retire_attachments BEFORE DELETE ON ctrl_loop_jobs
FOR EACH ROW EXECUTE FUNCTION public.mangorts_retire_ctrl_loop_attachments();
