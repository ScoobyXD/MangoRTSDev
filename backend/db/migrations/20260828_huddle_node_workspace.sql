begin;

create table huddle_node_textboxes (
  company_id uuid not null,
  huddle_node_id uuid not null,
  textbox_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  display_order bigint not null default 0,
  body_json jsonb not null,
  revision bigint not null default 0,
  title text not null default '',
  primary key (company_id,huddle_node_id,textbox_id),
  constraint huddle_node_textboxes_owner_fkey
    foreign key (company_id,huddle_node_id)
    references huddle_nodes(company_id,huddle_node_id)
    on delete cascade,
  constraint huddle_node_textboxes_body_json_chk check (
    body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and jsonb_typeof(body_json->'annotations')='array'
  ),
  constraint huddle_node_textboxes_revision_chk check (revision>=0),
  constraint huddle_node_textboxes_title_chk check (length(title)<=500),
  constraint huddle_node_textboxes_timestamps_chk check (
    updated_timestamp>=created_timestamp
    and (deleted_timestamp is null or deleted_timestamp>=created_timestamp)
  )
);

create index huddle_node_textboxes_live_order_idx
  on huddle_node_textboxes(company_id,huddle_node_id,display_order,textbox_id)
  where deleted_timestamp is null;

create or replace function mangorts_enforce_huddle_node_editor_text_limit()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':huddle_node:' || new.huddle_node_id::text, 0
  ));
  select coalesce(sum(octet_length(textbox.body_json::text)),0)
    into total_bytes
    from huddle_node_textboxes textbox
   where textbox.company_id=new.company_id
     and textbox.huddle_node_id=new.huddle_node_id
     and textbox.deleted_timestamp is null
     and textbox.textbox_id<>new.textbox_id;
  if new.deleted_timestamp is null then
    total_bytes := total_bytes + octet_length(new.body_json::text);
  end if;
  if total_bytes > 1073741824 then
    raise exception 'editor_owner_text_limit_exceeded'
      using errcode='P0001',
            detail='The one-GiB limit counts current editor text documents only; attachment object bytes are excluded.';
  end if;
  return new;
end;
$$;

create trigger trg_huddle_node_editor_text_limit
before insert or update of company_id,huddle_node_id,textbox_id,body_json,deleted_timestamp
on huddle_node_textboxes
for each row execute function mangorts_enforce_huddle_node_editor_text_limit();

create table huddle_node_textbox_chats (
  company_id uuid not null,
  chat_id uuid not null,
  huddle_node_id uuid not null,
  textbox_id uuid not null,
  parent_chat_id uuid,
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
  primary key (company_id,chat_id),
  constraint huddle_node_textbox_chats_textbox_fkey
    foreign key (company_id,huddle_node_id,textbox_id)
    references huddle_node_textboxes(company_id,huddle_node_id,textbox_id)
    on delete cascade,
  constraint huddle_node_textbox_chats_author_fkey
    foreign key (author_user_id)
    references users(user_id)
    on delete set null,
  constraint huddle_node_textbox_chats_message_chk check (btrim(message)<>''),
  constraint huddle_node_textbox_chats_entity_links_chk check (jsonb_typeof(entity_links)='array'),
  constraint huddle_node_textbox_chats_offsets_chk check (
    (selection_start is null and selection_end is null)
    or (selection_start>=0 and selection_end>=selection_start)
  ),
  constraint huddle_node_textbox_chats_revision_chk check (revision>0),
  constraint huddle_node_textbox_chats_timestamps_chk check (
    updated_timestamp>=created_timestamp
    and (edited_timestamp is null or edited_timestamp>=created_timestamp)
    and (deleted_timestamp is null or deleted_timestamp>=created_timestamp)
  )
);

create unique index huddle_node_textbox_chats_parent_identity_idx
  on huddle_node_textbox_chats(company_id,huddle_node_id,textbox_id,chat_id);

alter table huddle_node_textbox_chats
  add constraint huddle_node_textbox_chats_parent_fkey
  foreign key (company_id,huddle_node_id,textbox_id,parent_chat_id)
  references huddle_node_textbox_chats(company_id,huddle_node_id,textbox_id,chat_id)
  on delete cascade;

create index huddle_node_textbox_chats_live_idx
  on huddle_node_textbox_chats(company_id,huddle_node_id,textbox_id,created_timestamp,chat_id)
  where deleted_timestamp is null;

alter table attachment_relationships
  drop constraint attachment_relationships_type_chk,
  add constraint attachment_relationships_type_chk check (
    resource_type in (
      'node','logic_gate','project','huddle_node','node_chat_message',
      'logic_gate_chat_message','project_chat_message','email_message',
      'email_draft','email_signature','shared_inbox',
      'company_explorer_folder','shared_inbox_folder'
    )
  );

alter table attachment_upload_jobs
  drop constraint attachment_upload_jobs_resource_type_chk,
  add constraint attachment_upload_jobs_resource_type_chk check (
    resource_type in (
      'node','logic_gate','project','huddle_node','node_chat_message',
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
