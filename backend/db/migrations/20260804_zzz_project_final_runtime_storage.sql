alter table project_textboxes
  add column if not exists title text not null default '',
  add column if not exists email_message_id text not null default '',
  add column if not exists email_accent text not null default '',
  add column if not exists metadata_revision bigint not null default 1;

alter table project_textboxes
  drop constraint if exists project_textboxes_metadata_revision_chk,
  add constraint project_textboxes_metadata_revision_chk check (metadata_revision > 0),
  drop constraint if exists project_textboxes_title_chk,
  add constraint project_textboxes_title_chk check (length(title) <= 500),
  drop constraint if exists project_textboxes_email_accent_chk,
  add constraint project_textboxes_email_accent_chk check (
    email_accent='' or email_accent ~ '^#[0-9A-Fa-f]{6}$'
  );

create table if not exists project_textbox_chats (
  company_id uuid not null,
  chat_id uuid not null,
  project_id uuid not null,
  textbox_id text not null,
  parent_chat_id uuid,
  selection_source text not null default 'text',
  selection_textbox_id text,
  selection_email_message_id uuid,
  selection_quote text not null default '',
  selection_start integer,
  selection_end integer,
  author_user_id uuid,
  author_display_name text not null default '',
  message text not null default '',
  edited_timestamp timestamptz,
  entity_links jsonb not null default '[]'::jsonb,
  mentioned_user_ids uuid[] not null default '{}'::uuid[],
  mentioned_group_ids uuid[] not null default '{}'::uuid[],
  revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id, chat_id),
  unique (company_id, project_id, textbox_id, chat_id),
  foreign key (company_id, project_id, textbox_id)
    references project_textboxes(company_id, project_id, textbox_id) on delete cascade,
  foreign key (company_id, project_id, textbox_id, parent_chat_id)
    references project_textbox_chats(company_id, project_id, textbox_id, chat_id) on delete cascade,
  foreign key (author_user_id) references users(user_id) on delete set null,
  constraint project_textbox_chats_textbox_id_chk check (btrim(textbox_id) <> ''),
  constraint project_textbox_chats_selection_source_chk check (selection_source in ('text','email')),
  constraint project_textbox_chats_selection_target_chk check (
    (selection_source='text' and selection_email_message_id is null)
    or (selection_source='email' and selection_email_message_id is not null)
  ),
  constraint project_textbox_chats_selection_offsets_chk check (
    (selection_start is null and selection_end is null)
    or (selection_start >= 0 and selection_end >= selection_start)
  ),
  constraint project_textbox_chats_entity_links_chk check (jsonb_typeof(entity_links)='array'),
  constraint project_textbox_chats_revision_chk check (revision > 0),
  constraint project_textbox_chats_timestamps_chk check (
    updated_timestamp >= created_timestamp
    and (edited_timestamp is null or edited_timestamp >= created_timestamp)
    and (deleted_timestamp is null or deleted_timestamp >= created_timestamp)
  )
);

create index if not exists idx_project_textbox_chats_textbox_created
  on project_textbox_chats(company_id,project_id,textbox_id,created_timestamp,chat_id)
  where deleted_timestamp is null;
create index if not exists idx_project_textbox_chats_parent
  on project_textbox_chats(company_id,project_id,textbox_id,parent_chat_id)
  where parent_chat_id is not null and deleted_timestamp is null;
create index if not exists idx_project_textbox_chats_email_selection
  on project_textbox_chats(company_id,selection_email_message_id)
  where selection_email_message_id is not null and deleted_timestamp is null;

comment on table project_textbox_chats is
  'Permanent Project textbox chats keyed by the preserved legacy projection information_id.';

create or replace function mangorts_validate_attachment_relationship_owner()
returns trigger language plpgsql as $$
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
drop trigger if exists trg_attachment_relationships_validate_live_owner
  on attachment_relationships;
create trigger trg_attachment_relationships_validate_live_owner
before insert or update of company_id,attachment_id,resource_type,resource_id,deleted_timestamp
on attachment_relationships for each row
execute function mangorts_validate_attachment_relationship_owner();