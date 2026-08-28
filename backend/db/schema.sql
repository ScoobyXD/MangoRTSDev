--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: node_relationship_position; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.node_relationship_position AS ENUM (
    'Parent',
    'Child',
    'Peer'
);


--
-- Name: mangorts_access_level_rank(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_access_level_rank(p_access_level text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case lower(btrim(coalesce(p_access_level, '')))
    when 'no_access' then 0
    when 'edit' then 1
    else 0
  end;
$$;


--
-- Name: mangorts_bump_logic_gate_work_version(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_bump_logic_gate_work_version(p_company_id uuid, p_logic_gate_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select company_id, logic_gate_id, 1, now()
  from logic_gates
  where company_id=p_company_id and logic_gate_id=p_logic_gate_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;


--
-- Name: mangorts_bump_logic_gate_work_versions_for_company(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_bump_logic_gate_work_versions_for_company(p_company_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select company_id, logic_gate_id, 1, now()
  from logic_gates where company_id=p_company_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;


--
-- Name: mangorts_bump_logic_gate_work_versions_for_folder(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_bump_logic_gate_work_versions_for_folder(p_company_id uuid, p_folder_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  with recursive folders(folder_id, path) as (
    select folder_id, array[folder_id]
    from company_explorer_folders
    where company_id=p_company_id and folder_id=p_folder_id
    union all
    select child.folder_id, folders.path || child.folder_id
    from folders
    join company_explorer_folders child
      on child.company_id=p_company_id and child.parent_folder_id=folders.folder_id
    where not child.folder_id=any(folders.path)
  ), gates as (
    select distinct item.target_id
    from folders
    join company_explorer_items item
      on item.company_id=p_company_id
     and item.parent_folder_id=folders.folder_id
     and item.target_type='logic_gate'
  )
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select gate.company_id, gate.logic_gate_id, 1, now()
  from gates
  join logic_gates gate on gate.company_id=p_company_id and gate.logic_gate_id=gates.target_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;


--
-- Name: mangorts_bump_logic_gate_work_versions_for_node(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_bump_logic_gate_work_versions_for_node(p_company_id uuid, p_node_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  insert into logic_gate_work_versions (company_id, logic_gate_id, version, updated_timestamp)
  select distinct assignment.company_id, assignment.logic_gate_id, 1, now()
  from node_logic_gate_assignments assignment
  join logic_gates gate
    on gate.company_id=assignment.company_id and gate.logic_gate_id=assignment.logic_gate_id
  where assignment.company_id=p_company_id and assignment.node_id=p_node_id
  on conflict (company_id, logic_gate_id) do update set
    version=logic_gate_work_versions.version+1,
    updated_timestamp=now();
$$;


--
-- Name: mangorts_bump_node_view_user_version(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_bump_node_view_user_version(p_company_id uuid, p_node_id uuid, p_user_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  insert into node_view_user_versions(company_id, node_id, user_id, version, updated_timestamp)
  select node.company_id, node.node_id, actor.user_id, 1, now()
  from nodes node
  join users actor on actor.user_id=p_user_id
  where node.company_id=p_company_id and node.node_id=p_node_id
  on conflict (company_id, node_id, user_id) do update set
    version=node_view_user_versions.version+1,
    updated_timestamp=now();
$$;


--
-- Name: mangorts_bump_node_view_version(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_bump_node_view_version(p_company_id uuid, p_node_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select company_id, node_id, 1, now()
  from nodes
  where company_id=p_company_id and node_id=p_node_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;


--
-- Name: mangorts_bump_node_view_versions_for_account(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_bump_node_view_versions_for_account(p_company_id uuid, p_account_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select distinct assignment.company_id, assignment.node_id, 1, now()
  from node_account_assignments assignment
  join nodes node on node.company_id=assignment.company_id and node.node_id=assignment.node_id
  where assignment.company_id=p_company_id and assignment.account_id=p_account_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;


--
-- Name: mangorts_bump_node_view_versions_for_folder(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_bump_node_view_versions_for_folder(p_company_id uuid, p_folder_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  with recursive folders(folder_id, path) as (
    select folder_id, array[folder_id]
    from company_explorer_folders
    where company_id=p_company_id and folder_id=p_folder_id
    union all
    select child.folder_id, folders.path || child.folder_id
    from folders
    join company_explorer_folders child
      on child.company_id=p_company_id and child.parent_folder_id=folders.folder_id
    where not child.folder_id=any(folders.path)
  ), affected_nodes(node_id) as (
    select distinct assignment.node_id
    from folders
    join company_explorer_items item
      on item.company_id=p_company_id
     and item.parent_folder_id=folders.folder_id
     and item.target_type='logic_gate'
    join node_logic_gate_assignments assignment
      on assignment.company_id=item.company_id
     and assignment.logic_gate_id=item.target_id
  )
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select node.company_id, node.node_id, 1, now()
  from affected_nodes affected
  join nodes node on node.company_id=p_company_id and node.node_id=affected.node_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;


--
-- Name: mangorts_bump_node_view_versions_for_logic_gate(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_bump_node_view_versions_for_logic_gate(p_company_id uuid, p_logic_gate_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  insert into node_view_versions(company_id, node_id, version, updated_timestamp)
  select distinct assignment.company_id, assignment.node_id, 1, now()
  from node_logic_gate_assignments assignment
  join nodes node on node.company_id=assignment.company_id and node.node_id=assignment.node_id
  where assignment.company_id=p_company_id and assignment.logic_gate_id=p_logic_gate_id
  on conflict (company_id, node_id) do update set
    version=node_view_versions.version+1,
    updated_timestamp=now();
$$;


--
-- Name: mangorts_enforce_huddle_node_editor_text_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_enforce_huddle_node_editor_text_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: mangorts_enforce_logic_gate_editor_text_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_enforce_logic_gate_editor_text_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':logic_gate:' || new.logic_gate_id::text, 0
  ));
  select coalesce(sum(octet_length(textbox.body_json::text)),0)
    into total_bytes
    from logic_gate_textboxes textbox
   where textbox.company_id=new.company_id
     and textbox.logic_gate_id=new.logic_gate_id
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


--
-- Name: mangorts_enforce_node_editor_text_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_enforce_node_editor_text_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':node:' || new.node_id::text, 0
  ));
  select coalesce(sum(octet_length(textbox.body_json::text)),0)
    into total_bytes
    from node_textboxes textbox
   where textbox.company_id=new.company_id
     and textbox.node_id=new.node_id
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


--
-- Name: mangorts_enforce_project_editor_text_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_enforce_project_editor_text_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  total_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'editor-owner-text:' || new.company_id::text || ':project:' || new.project_id::text, 0
  ));
  select coalesce(sum(octet_length(textbox.body_json::text)),0)
    into total_bytes
    from project_textboxes textbox
   where textbox.company_id=new.company_id
     and textbox.project_id=new.project_id
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


--
-- Name: mangorts_lock_live_email_draft_attachment_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_lock_live_email_draft_attachment_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.deleted_timestamp is not null or new.resource_type<>'email_draft' then
    return new;
  end if;
  perform 1 from email_drafts
  where company_id=new.company_id and draft_id=new.resource_id
    and deleted_timestamp is null
  for share;
  if not found then
    raise exception 'attachment email draft owner does not exist' using errcode='23503';
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_process_map_route_points_valid(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_process_map_route_points_valid(p_route_points jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
declare
  point jsonb;
  point_key_count integer;
  x_text text;
  y_text text;
begin
  if p_route_points is null or jsonb_typeof(p_route_points) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_route_points) > 256 then
    return false;
  end if;
  for point in select value from jsonb_array_elements(p_route_points) loop
    if jsonb_typeof(point) <> 'object' then
      return false;
    end if;
    select count(*) into point_key_count from jsonb_object_keys(point);
    if not (point ? 'x' and point ? 'y') or point_key_count <> 2
       or jsonb_typeof(point->'x') <> 'number'
       or jsonb_typeof(point->'y') <> 'number' then
      return false;
    end if;
    x_text := point->>'x';
    y_text := point->>'y';
    if x_text !~ '^-?(0|[1-9][0-9]*)$' or y_text !~ '^-?(0|[1-9][0-9]*)$' then
      return false;
    end if;
    if x_text::numeric not between -1000000000 and 1000000000
       or y_text::numeric not between -1000000000 and 1000000000 then
      return false;
    end if;
  end loop;
  return true;
end;
$_$;


--
-- Name: mangorts_protect_email_relationship_dependencies(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_protect_email_relationship_dependencies() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if old.resource_type not in ('node','project') then
    return old;
  end if;
  if old.resource_textbox_id is not null
     and not exists (
       select 1 from email_relationships relationship
       where relationship.company_id=old.company_id
         and relationship.email_relationship_id<>old.email_relationship_id
         and relationship.resource_type=old.resource_type
         and relationship.resource_id=old.resource_id
         and relationship.resource_textbox_id=old.resource_textbox_id
         and relationship.email_message_id=old.email_message_id
     )
     and (
       (old.resource_type='node' and exists (
         select 1 from node_textbox_chats chat
         where chat.company_id=old.company_id and chat.node_id=old.resource_id
           and chat.textbox_id::text=old.resource_textbox_id
           and chat.selection_source='email'
           and chat.selection_email_message_id=old.email_message_id
           and chat.deleted_timestamp is null
       ))
       or (old.resource_type='project' and exists (
         select 1 from project_textbox_chats chat
         where chat.company_id=old.company_id and chat.project_id=old.resource_id
           and chat.textbox_id=old.resource_textbox_id
           and chat.selection_source='email'
           and chat.selection_email_message_id=old.email_message_id
           and chat.deleted_timestamp is null
       ))
     ) then
    raise exception 'email relationship is required by an active chat'
      using errcode='23503', constraint='email_relationship_required_by_chat';
  end if;
  if old.resource_textbox_id is null and (
    exists (
      select 1 from email_relationships relationship
      where relationship.company_id=old.company_id
        and relationship.email_thread_id=old.email_thread_id
        and relationship.resource_type=old.resource_type
        and relationship.resource_id=old.resource_id
        and relationship.resource_textbox_id is not null
    )
    or (old.resource_type='node' and exists (
      select 1 from node_textbox_chats chat
      join email_messages message on message.company_id=chat.company_id
       and message.email_message_id=chat.selection_email_message_id
      where chat.company_id=old.company_id and chat.node_id=old.resource_id
        and chat.selection_source='email' and chat.deleted_timestamp is null
        and message.email_thread_id=old.email_thread_id
    ))
    or (old.resource_type='project' and exists (
      select 1 from project_textbox_chats chat
      join email_messages message on message.company_id=chat.company_id
       and message.email_message_id=chat.selection_email_message_id
      where chat.company_id=old.company_id and chat.project_id=old.resource_id
        and chat.selection_source='email' and chat.deleted_timestamp is null
        and message.email_thread_id=old.email_thread_id
    ))
  ) then
    raise exception 'wide email relationship is required by owner textbox work'
      using errcode='23503', constraint='email_wide_relationship_required_by_textbox_work';
  end if;
  return old;
end;
$$;


--
-- Name: mangorts_protect_shared_email_draft_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_protect_shared_email_draft_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare owner_id uuid;
begin
  if not exists (select 1 from companies where company_id=old.company_id) then
    if tg_op='UPDATE' then return new; end if;
    return old;
  end if;
  if tg_table_name='nodes' then
    if tg_op='UPDATE' and old.company_id is not distinct from new.company_id and old.node_id is not distinct from new.node_id then return new; end if;
    owner_id:=old.node_id;
  else
    if tg_op='UPDATE' and old.company_id is not distinct from new.company_id and old.project_id is not distinct from new.project_id then return new; end if;
    owner_id:=old.project_id;
  end if;
  if exists (select 1 from email_drafts where company_id=old.company_id
    and shared_resource_type=case when tg_table_name='nodes' then 'node' else 'project' end
    and shared_resource_id=owner_id and deleted_timestamp is null) then
    raise exception 'resource is required by a shared email draft'
      using errcode='23503', constraint='shared_email_draft_owner_required';
  end if;
  if tg_op='UPDATE' then return new; end if;
  return old;
end;
$$;


--
-- Name: mangorts_protect_shared_email_draft_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_protect_shared_email_draft_relationship() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if old.resource_textbox_id is null and old.resource_type in ('node','project')
    and exists (select 1 from email_drafts where company_id=old.company_id
      and shared_resource_type=old.resource_type and shared_resource_id=old.resource_id
      and source_email_message_id=old.email_message_id and deleted_timestamp is null) then
    raise exception 'wide email relationship is required by a shared email draft'
      using errcode='23503', constraint='shared_email_draft_source_relationship_required';
  end if;
  return old;
end;
$$;


--
-- Name: mangorts_raci_tabs_explorer_folder_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_raci_tabs_explorer_folder_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if old.parent_folder_id is distinct from new.parent_folder_id then
    perform mangorts_sync_raci_tabs_explorer_subtree(new.company_id,new.folder_id);
  end if;
  return null;
end;
$$;


--
-- Name: mangorts_raci_tabs_explorer_item_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_raci_tabs_explorer_item_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op='DELETE' and old.target_type='logic_gate' then
    perform mangorts_sync_raci_tabs_logic_gate(old.company_id, old.target_id);
  elsif tg_op<>'DELETE' then
    if tg_op='UPDATE' and old.target_type='logic_gate'
       and (old.company_id,old.target_id,old.target_type)
           is distinct from
           (new.company_id,new.target_id,new.target_type) then
      perform mangorts_sync_raci_tabs_logic_gate(old.company_id,old.target_id);
    end if;
    if new.target_type='logic_gate' then
      perform mangorts_sync_raci_tabs_logic_gate(new.company_id,new.target_id);
    end if;
  end if;
  return null;
end;
$$;


--
-- Name: mangorts_raci_tabs_group_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_raci_tabs_group_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op='DELETE' then
    perform mangorts_sync_raci_tabs_group_ancestors(old.company_id,array[old.parent_group_id]);
  elsif tg_op='UPDATE' and old.parent_group_id is distinct from new.parent_group_id then
    perform mangorts_sync_raci_tabs_group_ancestors(old.company_id,array[old.parent_group_id]);
    perform mangorts_sync_raci_tabs_group_ancestors(new.company_id,array[new.parent_group_id]);
  end if;
  return null;
end;
$$;


--
-- Name: mangorts_raci_tabs_group_member_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_raci_tabs_group_member_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op='DELETE' then
    perform mangorts_sync_raci_tabs_group_ancestors(old.company_id,array[old.group_id]);
  elsif tg_op='INSERT' then
    perform mangorts_sync_raci_tabs_group_ancestors(new.company_id,array[new.group_id]);
  else
    perform mangorts_sync_raci_tabs_group_ancestors(old.company_id,array[old.group_id]);
    if (old.company_id,old.group_id) is distinct from (new.company_id,new.group_id) then
      perform mangorts_sync_raci_tabs_group_ancestors(new.company_id,array[new.group_id]);
    end if;
  end if;
  return null;
end;
$$;


--
-- Name: mangorts_raci_tabs_logic_gate_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_raci_tabs_logic_gate_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op='DELETE' then
    perform mangorts_sync_raci_tabs_logic_gate(old.company_id, old.logic_gate_id);
  else
    perform mangorts_sync_raci_tabs_logic_gate(new.company_id, new.logic_gate_id);
  end if;
  return null;
end;
$$;


--
-- Name: mangorts_raci_tabs_membership_added(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_raci_tabs_membership_added() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_resource record;
begin
  for v_resource in
    select distinct assignment.resource_type,assignment.resource_id
    from resource_gvic_assignments assignment
    where assignment.company_id=new.company_id
      and assignment.principal_type='user'
      and assignment.principal_id=new.user_id
      and assignment.resource_type in ('logic_gate','company_explorer_folder')
    order by assignment.resource_type,assignment.resource_id
  loop
    perform mangorts_sync_raci_tabs_policy_resource(
      new.company_id,v_resource.resource_type,v_resource.resource_id
    );
  end loop;
  return null;
end;
$$;


--
-- Name: mangorts_raci_tabs_policy_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_raci_tabs_policy_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_company_id uuid;
  v_resource_type text;
  v_resource_id uuid;
begin
  if tg_op='UPDATE'
     and (old.company_id,old.resource_type,old.resource_id)
         is distinct from
         (new.company_id,new.resource_type,new.resource_id) then
    perform mangorts_sync_raci_tabs_policy_resource(old.company_id,old.resource_type,old.resource_id);
  end if;
  if tg_op='DELETE' then
    v_company_id := old.company_id;
    v_resource_type := old.resource_type;
    v_resource_id := old.resource_id;
  else
    v_company_id := new.company_id;
    v_resource_type := new.resource_type;
    v_resource_id := new.resource_id;
  end if;
  perform mangorts_sync_raci_tabs_policy_resource(v_company_id,v_resource_type,v_resource_id);
  return null;
end;
$$;


--
-- Name: mangorts_reject_pending_attachment_link(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_reject_pending_attachment_link() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
  return new;
end;
$$;


--
-- Name: mangorts_sync_raci_tabs_explorer_subtree(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_sync_raci_tabs_explorer_subtree(p_company_id uuid, p_folder_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_gate record;
begin
  for v_gate in
    with recursive subtree(folder_id) as (
      select folder.folder_id
      from company_explorer_folders folder
      where folder.company_id=p_company_id
        and folder.folder_id=p_folder_id
      union all
      select child.folder_id
      from subtree parent
      join company_explorer_folders child
        on child.company_id=p_company_id
       and child.parent_folder_id=parent.folder_id
    )
    select distinct item.target_id as logic_gate_id
    from subtree folder
    join company_explorer_items item
      on item.company_id=p_company_id
     and item.parent_folder_id=folder.folder_id
     and item.target_type='logic_gate'
    order by item.target_id
  loop
    perform mangorts_sync_raci_tabs_logic_gate(p_company_id,v_gate.logic_gate_id);
  end loop;
end;
$$;


--
-- Name: mangorts_sync_raci_tabs_group_ancestors(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_sync_raci_tabs_group_ancestors(p_company_id uuid, p_group_ids uuid[]) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_resource record;
begin
  for v_resource in
    with recursive ancestors(group_id) as (
      select distinct seed.group_id
      from unnest(coalesce(p_group_ids,'{}'::uuid[])) seed(group_id)
      where seed.group_id is not null
      union
      select parent.parent_group_id
      from ancestors child
      join company_user_groups parent
        on parent.company_id=p_company_id
       and parent.group_id=child.group_id
      where parent.parent_group_id is not null
    )
    select distinct assignment.resource_type,assignment.resource_id
    from ancestors affected
    join resource_gvic_assignments assignment
      on assignment.company_id=p_company_id
     and assignment.principal_type='group'
     and assignment.principal_id=affected.group_id
    where assignment.resource_type in ('logic_gate','company_explorer_folder')
    order by assignment.resource_type,assignment.resource_id
  loop
    perform mangorts_sync_raci_tabs_policy_resource(
      p_company_id,v_resource.resource_type,v_resource.resource_id
    );
  end loop;
end;
$$;


--
-- Name: mangorts_sync_raci_tabs_logic_gate(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_sync_raci_tabs_logic_gate(p_company_id uuid, p_logic_gate_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_name text;
begin
  select gate.header
  into v_name
  from logic_gates gate
  where gate.company_id=p_company_id
    and gate.logic_gate_id=p_logic_gate_id;

  if not found then
    delete from raci_tabs_items item
    where item.company_id=p_company_id
      and item.logic_gate_id=p_logic_gate_id;
    return;
  end if;

  with effective as materialized (
    select assignment.user_id, assignment.role
    from mangorts_v2_effective_gvic_assignments(
      p_company_id,
      'logic_gate',
      p_logic_gate_id
    ) assignment
  ), prepared as (
    select
      p_company_id as company_id,
      effective.user_id,
      effective.role,
      p_logic_gate_id as logic_gate_id,
      case when current_item.role=effective.role then current_item.folder_id else null end as folder_id,
      v_name as name,
      case
        when current_item.role=effective.role then current_item.position
        else coalesce((
          select max(sibling.position)
          from (
            select folder.position
            from raci_tabs_folders folder
            where folder.company_id=p_company_id
              and folder.user_id=effective.user_id
              and folder.role=effective.role
              and folder.parent_folder_id is null
            union all
            select item.position
            from raci_tabs_items item
            where item.company_id=p_company_id
              and item.user_id=effective.user_id
              and item.role=effective.role
              and item.folder_id is null
              and item.logic_gate_id<>p_logic_gate_id
          ) sibling
        ), 0) + 1000
      end as position,
      coalesce(current_item.created_timestamp, now()) as created_timestamp
    from effective
    left join raci_tabs_items current_item
      on current_item.company_id=p_company_id
     and current_item.user_id=effective.user_id
     and current_item.logic_gate_id=p_logic_gate_id
  )
  insert into raci_tabs_items(
    company_id, user_id, role, logic_gate_id, folder_id, name, position,
    created_timestamp, updated_timestamp
  )
  select
    prepared.company_id,
    prepared.user_id,
    prepared.role,
    prepared.logic_gate_id,
    prepared.folder_id,
    prepared.name,
    prepared.position,
    prepared.created_timestamp,
    now()
  from prepared
  on conflict (company_id, user_id, logic_gate_id) do update
  set role=excluded.role,
      folder_id=excluded.folder_id,
      name=excluded.name,
      position=excluded.position,
      updated_timestamp=now()
  where (raci_tabs_items.role, raci_tabs_items.folder_id, raci_tabs_items.name, raci_tabs_items.position)
        is distinct from
        (excluded.role, excluded.folder_id, excluded.name, excluded.position);

  delete from raci_tabs_items item
  where item.company_id=p_company_id
    and item.logic_gate_id=p_logic_gate_id
    and not exists (
      select 1
      from mangorts_v2_effective_gvic_assignments(
        p_company_id,
        'logic_gate',
        p_logic_gate_id
      ) effective
      where effective.user_id=item.user_id
    );
end;
$$;


--
-- Name: mangorts_sync_raci_tabs_policy_resource(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_sync_raci_tabs_policy_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if p_resource_type='logic_gate' then
    perform mangorts_sync_raci_tabs_logic_gate(p_company_id,p_resource_id);
  elsif p_resource_type='company_explorer_folder' then
    perform mangorts_sync_raci_tabs_explorer_subtree(p_company_id,p_resource_id);
  end if;
end;
$$;


--
-- Name: mangorts_trg_bump_logic_gate_work_for_company(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_logic_gate_work_for_company() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_logic_gate_work_versions_for_company(new.company_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_versions_for_company(old.company_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_versions_for_company(old.company_id);
  if new.company_id is distinct from old.company_id then
    perform mangorts_bump_logic_gate_work_versions_for_company(new.company_id);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_trg_bump_logic_gate_work_from_explorer_folder(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_explorer_folder() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_versions_for_folder(old.company_id, old.folder_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_versions_for_folder(new.company_id, new.folder_id);
  return new;
end;
$$;


--
-- Name: mangorts_trg_bump_logic_gate_work_from_explorer_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_explorer_item() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op='INSERT' then
    if new.target_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.target_id);
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.target_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id, old.target_id);
    end if;
    return old;
  end if;
  if old.target_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.target_id);
  end if;
  if (new.company_id, new.target_type, new.target_id)
       is distinct from (old.company_id, old.target_type, old.target_id)
     and new.target_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.target_id);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_trg_bump_logic_gate_work_from_gate_row(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_gate_row() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.logic_gate_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.logic_gate_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_version(old.company_id, old.logic_gate_id);
  if (new.company_id, new.logic_gate_id) is distinct from (old.company_id, old.logic_gate_id) then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.logic_gate_id);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_trg_bump_logic_gate_work_from_node(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_node() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_logic_gate_work_versions_for_node(new.company_id, new.node_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_logic_gate_work_versions_for_node(old.company_id, old.node_id);
    return old;
  end if;
  perform mangorts_bump_logic_gate_work_versions_for_node(old.company_id, old.node_id);
  if (new.company_id, new.node_id) is distinct from (old.company_id, old.node_id) then
    perform mangorts_bump_logic_gate_work_versions_for_node(new.company_id, new.node_id);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_trg_bump_logic_gate_work_from_resource(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_resource() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op='INSERT' then
    if new.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(new.company_id, new.resource_id);
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.resource_type='logic_gate' then
      perform mangorts_bump_logic_gate_work_version(old.company_id, old.resource_id);
    end if;
    return old;
  end if;
  if old.resource_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(old.company_id, old.resource_id);
  end if;
  if (new.company_id, new.resource_type, new.resource_id)
       is distinct from (old.company_id, old.resource_type, old.resource_id)
     and new.resource_type='logic_gate' then
    perform mangorts_bump_logic_gate_work_version(new.company_id, new.resource_id);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_trg_bump_node_view_from_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_node_view_from_account() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_versions_for_account(old.company_id, old.account_id);
  end if;
  if tg_op <> 'DELETE' then
    perform mangorts_bump_node_view_versions_for_account(new.company_id, new.account_id);
    return new;
  end if;
  return old;
end;
$$;


--
-- Name: mangorts_trg_bump_node_view_from_direct_node(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_node_view_from_direct_node() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
    return new;
  elsif tg_op='DELETE' then
    perform mangorts_bump_node_view_version(old.company_id, old.node_id);
    return old;
  end if;
  perform mangorts_bump_node_view_version(old.company_id, old.node_id);
  if (new.company_id, new.node_id) is distinct from (old.company_id, old.node_id) then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_trg_bump_node_view_from_explorer_folder(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_node_view_from_explorer_folder() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_versions_for_folder(old.company_id, old.folder_id);
  end if;
  if tg_op <> 'DELETE' then
    perform mangorts_bump_node_view_versions_for_folder(new.company_id, new.folder_id);
    return new;
  end if;
  return old;
end;
$$;


--
-- Name: mangorts_trg_bump_node_view_from_explorer_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_node_view_from_explorer_item() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op <> 'INSERT' and old.target_type='logic_gate' then
    perform mangorts_bump_node_view_versions_for_logic_gate(old.company_id, old.target_id);
  end if;
  if tg_op <> 'DELETE' and new.target_type='logic_gate' then
    perform mangorts_bump_node_view_versions_for_logic_gate(new.company_id, new.target_id);
    return new;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;


--
-- Name: mangorts_trg_bump_node_view_from_node(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_node_view_from_node() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op='INSERT' then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
    return new;
  elsif tg_op='DELETE' then
    return old;
  end if;
  perform mangorts_bump_node_view_version(old.company_id, old.node_id);
  if (new.company_id, new.node_id) is distinct from (old.company_id, old.node_id) then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_trg_bump_node_view_from_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_node_view_from_relationship() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op <> 'INSERT' then
    perform mangorts_bump_node_view_version(old.company_id, old.node_id_a);
    perform mangorts_bump_node_view_version(old.company_id, old.node_id_b);
  end if;
  if tg_op <> 'DELETE' then
    perform mangorts_bump_node_view_version(new.company_id, new.node_id_a);
    perform mangorts_bump_node_view_version(new.company_id, new.node_id_b);
    return new;
  end if;
  return old;
end;
$$;


--
-- Name: mangorts_trg_bump_node_view_from_resource(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_bump_node_view_from_resource() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op <> 'INSERT' then
    if old.resource_type='node' then
      perform mangorts_bump_node_view_version(old.company_id, old.resource_id);
    elsif old.resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(old.company_id, old.resource_id);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    if new.resource_type='node' then
      perform mangorts_bump_node_view_version(new.company_id, new.resource_id);
    elsif new.resource_type='logic_gate' then
      perform mangorts_bump_node_view_versions_for_logic_gate(new.company_id, new.resource_id);
    end if;
    return new;
  end if;
  return old;
end;
$$;


--
-- Name: mangorts_trg_seed_logic_gate_work_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_seed_logic_gate_work_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  insert into logic_gate_work_versions (company_id, logic_gate_id)
  values (new.company_id, new.logic_gate_id)
  on conflict (company_id, logic_gate_id) do nothing;
  return new;
end;
$$;


--
-- Name: mangorts_trg_seed_node_view_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_trg_seed_node_view_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  insert into node_view_versions(company_id, node_id)
  values (new.company_id, new.node_id)
  on conflict (company_id, node_id) do nothing;
  return new;
end;
$$;


--
-- Name: mangorts_try_uuid(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_try_uuid(p_value text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE
    AS $$
begin
  return nullif(btrim(coalesce(p_value, '')), '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;


--
-- Name: mangorts_user_can_access_resource(uuid, text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with recursive resolved as (
    select * from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id)
  ),
  company_actor as (
    select exists (
      select 1 from company_memberships membership
      where membership.user_id=p_user_id
        and (membership.role='dev_admin' or membership.company_id=p_company_id)
    ) as allowed
  ),
  admin_actor as (
    select exists (
      select 1 from company_memberships membership
      where membership.user_id=p_user_id
        and (
          membership.role='dev_admin'
          or (membership.company_id=p_company_id and membership.role='company_admin')
        )
    ) as allowed
  ),
  direct_rule as (
    select access.access_level
    from resolved
    join resource_permissions access
      on access.company_id=p_company_id
     and access.resource_type=resolved.source_resource_type
     and access.resource_id=resolved.source_resource_id
     and access.subject_type='user'
     and access.subject_id=p_user_id
    limit 1
  ),
  member_groups(group_id,depth,path) as (
    select member.group_id,0,array[member.group_id]
    from company_user_group_members member
    where member.company_id=p_company_id and member.user_id=p_user_id
    union all
    select parent.parent_group_id,member.depth+1,member.path || parent.parent_group_id
    from member_groups member
    join company_user_groups parent
      on parent.company_id=p_company_id and parent.group_id=member.group_id
    where parent.parent_group_id is not null
      and member.depth<100
      and not parent.parent_group_id=any(member.path)
  ),
  group_rule as (
    select access.access_level
    from resolved
    join resource_permissions access
      on access.company_id=p_company_id
     and access.resource_type=resolved.source_resource_type
     and access.resource_id=resolved.source_resource_id
     and access.subject_type='group'
    join member_groups membership on membership.group_id=access.subject_id
    order by membership.depth,
             case access.access_level when 'no_access' then 0 else 1 end,
             access.subject_id
    limit 1
  ),
  selected_access as (
    select coalesce(
      (select access_level from direct_rule),
      (select access_level from group_rule),
      (select setting.default_access
       from resolved
       join resource_permission_settings setting
         on setting.company_id=p_company_id
        and setting.resource_type=resolved.source_resource_type
        and setting.resource_id=resolved.source_resource_id)
    ) as access_level
  )
  select case
    when p_access_level<>'edit' then false
    when not (select allowed from company_actor) then false
    when (select allowed from admin_actor) then true
    else coalesce((select access_level='edit' from selected_access),false)
  end;
$$;


--
-- Name: mangorts_v2_advance_parent_link(uuid, text, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_advance_parent_link(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_is_root boolean) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  update resource_gvic_settings
  set parent_link_sequence=case when p_is_root then 0 else nextval('resource_gvic_change_sequence') end,
      updated_timestamp=now()
  where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;

  update resource_permission_settings
  set parent_link_sequence=case when p_is_root then 0 else nextval('resource_permission_change_sequence') end,
      updated_timestamp=now()
  where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
end;
$$;


--
-- Name: mangorts_v2_company_item_parent_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_company_item_parent_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if old.target_type in ('logic_gate','project') then
    if tg_op='DELETE' then
      perform mangorts_v2_materialize_detached_policy(old.company_id,old.target_type,old.target_id);
    elsif old.parent_folder_id is not null and new.parent_folder_id is null then
      perform mangorts_v2_materialize_detached_policy(old.company_id,old.target_type,old.target_id);
    end if;
  end if;
  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_v2_company_item_parent_saved(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_company_item_parent_saved() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.target_type in ('logic_gate','project') and tg_op='INSERT' then
    perform mangorts_v2_advance_parent_link(
      new.company_id,new.target_type,new.target_id,new.parent_folder_id is null
    );
  elsif new.target_type in ('logic_gate','project')
     and old.parent_folder_id is distinct from new.parent_folder_id then
    perform mangorts_v2_advance_parent_link(
      new.company_id,new.target_type,new.target_id,new.parent_folder_id is null
    );
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_v2_effective_gvic_assignments(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_effective_gvic_assignments(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS TABLE(role text, user_id uuid, source_resource_type text, source_resource_id uuid, source_principal_type text, source_principal_id uuid, inheritance_type text, updated_timestamp timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with recursive resolved as (
    select * from mangorts_v2_resolve_gvic_policy(p_company_id,p_resource_type,p_resource_id)
  ),
  source_edges as (
    select edge.*
    from resolved
    join resource_gvic_assignments edge
      on edge.company_id=p_company_id
     and edge.resource_type=resolved.source_resource_type
     and edge.resource_id=resolved.source_resource_id
  ),
  group_tree(role,source_principal_id,group_id,depth,path,updated_timestamp) as (
    select edge.role,edge.principal_id,edge.principal_id,0,array[edge.principal_id],edge.updated_timestamp
    from source_edges edge where edge.principal_type='group'
    union all
    select tree.role,tree.source_principal_id,child.group_id,tree.depth+1,tree.path || child.group_id,tree.updated_timestamp
    from group_tree tree
    join company_user_groups child
      on child.company_id=p_company_id and child.parent_group_id=tree.group_id
    where tree.depth<100 and not child.group_id=any(tree.path)
  ),
  candidates as (
    select edge.role,edge.principal_id as user_id,'user'::text as source_principal_type,
           edge.principal_id as source_principal_id,-1 as group_depth,edge.updated_timestamp
    from source_edges edge
    join company_memberships membership
      on edge.principal_type='user'
     and membership.company_id=p_company_id and membership.user_id=edge.principal_id
    union all
    select tree.role,member.user_id,'group',tree.source_principal_id,tree.depth,tree.updated_timestamp
    from group_tree tree
    join company_user_group_members member
      on member.company_id=p_company_id and member.group_id=tree.group_id
  ),
  winners as (
    select distinct on (candidate.user_id) candidate.*
    from candidates candidate
    order by candidate.user_id,
      case candidate.role when 'responsible' then 1 when 'accountable' then 2 when 'consulted' then 3 else 4 end,
      case candidate.source_principal_type when 'user' then 0 else 1 end,
      candidate.group_depth,
      candidate.source_principal_id
  )
  select winner.role,winner.user_id,resolved.source_resource_type,resolved.source_resource_id,
         winner.source_principal_type,winner.source_principal_id,
         case when resolved.source_resource_type=p_resource_type and resolved.source_resource_id=p_resource_id
              then 'direct' else 'inherited' end,
         winner.updated_timestamp
  from winners winner cross join resolved
  order by winner.user_id;
$$;


--
-- Name: mangorts_v2_folder_parent_changing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_folder_parent_changing() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if old.parent_folder_id is not null and new.parent_folder_id is null then
    perform mangorts_v2_materialize_detached_policy(old.company_id,tg_argv[0],old.folder_id);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_v2_folder_parent_saved(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_folder_parent_saved() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op='UPDATE' and old.parent_folder_id is not distinct from new.parent_folder_id then
    return new;
  end if;
  perform mangorts_v2_advance_parent_link(new.company_id,tg_argv[0],new.folder_id,new.parent_folder_id is null);
  return new;
end;
$$;


--
-- Name: mangorts_v2_group_deleted_cleanup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_group_deleted_cleanup() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  delete from resource_gvic_assignments
  where company_id=old.company_id and principal_type='group' and principal_id=old.group_id;
  delete from resource_permissions
  where company_id=old.company_id and subject_type='group' and subject_id=old.group_id;
  return old;
end;
$$;


--
-- Name: mangorts_v2_group_membership_version(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_group_membership_version(p_company_id uuid) RETURNS bigint
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce((
    select version from workspace_read_versions
    where company_id=p_company_id and scope='policy-group-membership' and resource_key=''
  ),0);
$$;


--
-- Name: mangorts_v2_group_policy_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_group_policy_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_company_id uuid := coalesce((to_jsonb(new)->>'company_id')::uuid,(to_jsonb(old)->>'company_id')::uuid);
begin
  insert into workspace_read_versions(company_id,scope,resource_key,version,updated_timestamp)
  values(v_company_id,'policy-group-membership','',1,now())
  on conflict(company_id,scope,resource_key) do update
  set version=workspace_read_versions.version+1,updated_timestamp=now();
  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_v2_gvic_policy_fingerprint(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_gvic_policy_fingerprint(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select md5(concat_ws(':',
    resolved.source_resource_type,resolved.source_resource_id,resolved.source_customized_sequence,
    resolved.reset_resource_type,resolved.reset_resource_id,resolved.reset_sequence,
    resolved.parent_link_fingerprint,mangorts_v2_group_membership_version(p_company_id)
  ))
  from mangorts_v2_resolve_gvic_policy(p_company_id,p_resource_type,p_resource_id) resolved;
$$;


--
-- Name: mangorts_v2_initialize_policy_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_initialize_policy_settings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_resource_type text := tg_argv[0];
  v_resource_id uuid := (to_jsonb(new)->>tg_argv[1])::uuid;
  v_company_id uuid := (to_jsonb(new)->>'company_id')::uuid;
  v_parent_type text;
  v_parent_id uuid;
  v_gvic_sequence bigint;
  v_permission_sequence bigint;
begin
  if exists (
    select 1 from resource_gvic_settings
    where resource_gvic_settings.company_id=v_company_id
      and resource_gvic_settings.resource_type=v_resource_type
      and resource_gvic_settings.resource_id=v_resource_id
  ) and exists (
    select 1 from resource_permission_settings
    where resource_permission_settings.company_id=v_company_id
      and resource_permission_settings.resource_type=v_resource_type
      and resource_permission_settings.resource_id=v_resource_id
  ) then
    return new;
  end if;

  select parent_resource_type,parent_resource_id into v_parent_type,v_parent_id
  from mangorts_v2_policy_parent(v_company_id,v_resource_type,v_resource_id);

  v_gvic_sequence := nextval('resource_gvic_change_sequence');
  v_permission_sequence := nextval('resource_permission_change_sequence');

  insert into resource_gvic_settings(
    company_id,resource_type,resource_id,assignment_mode,customized_sequence,
    parent_link_sequence,descendant_reset_sequence,created_timestamp,updated_timestamp
  ) values(
    v_company_id,v_resource_type,v_resource_id,
    case when v_parent_id is null then 'customized' else 'inherited' end,
    case when v_parent_id is null then v_gvic_sequence else null end,
    case when v_parent_id is null then 0 else v_gvic_sequence end,
    0,now(),now()
  ) on conflict(company_id,resource_type,resource_id) do nothing;

  insert into resource_permission_settings(
    company_id,resource_type,resource_id,permission_mode,default_access,customized_sequence,
    parent_link_sequence,descendant_reset_sequence,created_timestamp,updated_timestamp
  ) values(
    v_company_id,v_resource_type,v_resource_id,
    case when v_parent_id is null then 'customized' else 'inherited' end,
    case when v_parent_id is null then 'edit' else null end,
    case when v_parent_id is null then v_permission_sequence else null end,
    case when v_parent_id is null then 0 else v_permission_sequence end,
    0,now(),now()
  ) on conflict(company_id,resource_type,resource_id) do nothing;
  return new;
end;
$$;


--
-- Name: mangorts_v2_materialize_detached_policy(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_materialize_detached_policy(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  gvic_source_type text;
  gvic_source_id uuid;
  permission_source_type text;
  permission_source_id uuid;
  permission_default text;
  gvic_sequence bigint;
  permission_sequence bigint;
begin
  select source_resource_type,source_resource_id into gvic_source_type,gvic_source_id
  from mangorts_v2_resolve_gvic_policy(p_company_id,p_resource_type,p_resource_id);
  select source_resource_type,source_resource_id into permission_source_type,permission_source_id
  from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id);

  if gvic_source_id is null or permission_source_id is null then
    raise exception 'v2_policy_detach_resolution_failed:%:%',p_resource_type,p_resource_id;
  end if;

  if gvic_source_type<>p_resource_type or gvic_source_id<>p_resource_id then
    gvic_sequence := nextval('resource_gvic_change_sequence');
    delete from resource_gvic_assignments
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    update resource_gvic_settings
    set assignment_mode='customized',customized_sequence=gvic_sequence,updated_timestamp=now()
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    insert into resource_gvic_assignments(
      company_id,resource_type,resource_id,role,principal_type,principal_id,created_timestamp,updated_timestamp
    )
    select p_company_id,p_resource_type,p_resource_id,role,principal_type,principal_id,now(),now()
    from resource_gvic_assignments
    where company_id=p_company_id and resource_type=gvic_source_type and resource_id=gvic_source_id;
  end if;

  if permission_source_type<>p_resource_type or permission_source_id<>p_resource_id then
    select default_access into permission_default
    from resource_permission_settings
    where company_id=p_company_id and resource_type=permission_source_type and resource_id=permission_source_id;
    permission_sequence := nextval('resource_permission_change_sequence');
    delete from resource_permissions
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    update resource_permission_settings
    set permission_mode='customized',default_access=permission_default,
        customized_sequence=permission_sequence,updated_timestamp=now()
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    insert into resource_permissions(
      company_id,resource_type,resource_id,subject_type,subject_id,access_level,created_timestamp,updated_timestamp
    )
    select p_company_id,p_resource_type,p_resource_id,subject_type,subject_id,access_level,now(),now()
    from resource_permissions
    where company_id=p_company_id and resource_type=permission_source_type and resource_id=permission_source_id;
  end if;
end;
$$;


--
-- Name: mangorts_v2_node_parent_link_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_node_parent_link_changed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op='DELETE' then
    if exists(
      select 1
      from nodes
      where company_id=old.company_id and node_id=old.node_id
    ) then
      perform mangorts_v2_materialize_detached_policy(old.company_id,'node',old.node_id);
    end if;
    return old;
  end if;
  if tg_op='INSERT' then
    perform mangorts_v2_advance_parent_link(new.company_id,'node',new.node_id,false);
  elsif old.logic_gate_id is distinct from new.logic_gate_id then
    perform mangorts_v2_advance_parent_link(new.company_id,'node',new.node_id,false);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_v2_node_parent_link_removed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_node_parent_link_removed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if exists(
    select 1
    from nodes
    where company_id=old.company_id and node_id=old.node_id
  ) then
    perform mangorts_v2_advance_parent_link(old.company_id,'node',old.node_id,true);
  end if;
  return old;
end;
$$;


--
-- Name: mangorts_v2_permission_policy_fingerprint(uuid, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_permission_policy_fingerprint(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select md5(concat_ws(':',
    resolved.source_resource_type,resolved.source_resource_id,resolved.source_customized_sequence,
    resolved.reset_resource_type,resolved.reset_resource_id,resolved.reset_sequence,
    resolved.parent_link_fingerprint,mangorts_v2_group_membership_version(p_company_id),p_user_id,
    mangorts_user_can_access_resource(p_company_id,p_resource_type,p_resource_id,p_user_id,'edit')
  ))
  from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id) resolved;
$$;


--
-- Name: mangorts_v2_policy_parent(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_policy_parent(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS TABLE(parent_resource_type text, parent_resource_id uuid)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select 'logic_gate'::text, assignment.logic_gate_id
  from node_logic_gate_assignments assignment
  where p_resource_type='node'
    and assignment.company_id=p_company_id
    and assignment.node_id=p_resource_id
  union all
  select 'company_explorer_folder'::text, item.parent_folder_id
  from company_explorer_items item
  where p_resource_type in ('logic_gate','project')
    and item.company_id=p_company_id
    and item.target_type=p_resource_type
    and item.target_id=p_resource_id
    and item.parent_folder_id is not null
  union all
  select 'company_explorer_folder'::text, folder.parent_folder_id
  from company_explorer_folders folder
  where p_resource_type='company_explorer_folder'
    and folder.company_id=p_company_id
    and folder.folder_id=p_resource_id
    and folder.parent_folder_id is not null
  union all
  select 'shared_inbox_folder'::text, folder.parent_folder_id
  from shared_inbox_folders folder
  where p_resource_type='shared_inbox_folder'
    and folder.company_id=p_company_id
    and folder.folder_id=p_resource_id
    and folder.parent_folder_id is not null
  union all
  select 'shared_inbox_folder'::text, inbox.parent_folder_id
  from shared_inboxes inbox
  where p_resource_type='shared_inbox'
    and inbox.company_id=p_company_id
    and inbox.shared_inbox_id=p_resource_id
    and inbox.parent_folder_id is not null;
$$;


--
-- Name: mangorts_v2_policy_resource_exists(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_policy_resource_exists(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select case p_resource_type
    when 'node' then exists(select 1 from nodes where company_id=p_company_id and node_id=p_resource_id)
    when 'logic_gate' then exists(select 1 from logic_gates where company_id=p_company_id and logic_gate_id=p_resource_id)
    when 'project' then exists(select 1 from projects where company_id=p_company_id and project_id=p_resource_id)
    when 'company_explorer_folder' then exists(select 1 from company_explorer_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox_folder' then exists(select 1 from shared_inbox_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox' then exists(select 1 from shared_inboxes where company_id=p_company_id and shared_inbox_id=p_resource_id)
    when 'huddle_logic_gate' then exists(select 1 from huddle_logic_gates where company_id=p_company_id and huddle_logic_gate_id=p_resource_id)
    when 'huddle_node' then exists(select 1 from huddle_nodes where company_id=p_company_id and huddle_node_id=p_resource_id)
    else false end;
$$;


--
-- Name: mangorts_v2_policy_resource_has_cycle(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_policy_resource_has_cycle(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  current_type text := p_resource_type;
  current_id uuid := p_resource_id;
  next_type text;
  next_id uuid;
  path text[] := array[]::text[];
  steps integer := 0;
begin
  loop
    if current_type || ':' || current_id::text = any(path) then
      return true;
    end if;
    path := array_append(path,current_type || ':' || current_id::text);
    select parent_resource_type,parent_resource_id into next_type,next_id
    from mangorts_v2_policy_parent(p_company_id,current_type,current_id);
    if not found then
      return false;
    end if;
    current_type := next_type;
    current_id := next_id;
    steps := steps + 1;
    if steps > 1000 then
      return true;
    end if;
  end loop;
end;
$$;


--
-- Name: mangorts_v2_resolve_gvic_policy(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_resolve_gvic_policy(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS TABLE(source_resource_type text, source_resource_id uuid, source_customized_sequence bigint, reset_resource_type text, reset_resource_id uuid, reset_sequence bigint, overwritten_resource_type text, overwritten_resource_id uuid, overwritten_sequence bigint, parent_link_fingerprint text)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with recursive path as (
    select 0 as depth,
           setting.resource_type,
           setting.resource_id,
           setting.assignment_mode as stored_mode,
           setting.customized_sequence,
           setting.parent_link_sequence,
           setting.descendant_reset_sequence,
           array[setting.resource_type || ':' || setting.resource_id::text]::text[] as visited
    from resource_gvic_settings setting
    where setting.company_id=p_company_id
      and setting.resource_type=p_resource_type
      and setting.resource_id=p_resource_id
    union all
    select child.depth+1,
           parent_setting.resource_type,
           parent_setting.resource_id,
           parent_setting.assignment_mode,
           parent_setting.customized_sequence,
           parent_setting.parent_link_sequence,
           parent_setting.descendant_reset_sequence,
           child.visited || (parent_setting.resource_type || ':' || parent_setting.resource_id::text)
    from path child
    cross join lateral mangorts_v2_policy_parent(p_company_id,child.resource_type,child.resource_id) parent
    join resource_gvic_settings parent_setting
      on parent_setting.company_id=p_company_id
     and parent_setting.resource_type=parent.parent_resource_type
     and parent_setting.resource_id=parent.parent_resource_id
    where not (parent_setting.resource_type || ':' || parent_setting.resource_id::text)=any(child.visited)
  ),
  eligible_resets as (
    select ancestor.*
    from path ancestor
    where ancestor.depth>0
      and ancestor.descendant_reset_sequence>0
      and not exists (
        select 1 from path edge
        where edge.depth<ancestor.depth
          and edge.parent_link_sequence>ancestor.descendant_reset_sequence
      )
  ),
  active_sources as (
    select candidate.*
    from path candidate
    where candidate.stored_mode='customized'
      and not exists (
        select 1 from eligible_resets reset
        where reset.depth>candidate.depth
          and reset.descendant_reset_sequence>=candidate.customized_sequence
      )
  ),
  selected_source as (
    select * from active_sources order by depth limit 1
  ),
  selected_reset as (
    select * from eligible_resets order by descendant_reset_sequence desc,depth limit 1
  ),
  target as (
    select * from path where depth=0
  ),
  target_overwrite as (
    select reset.*
    from eligible_resets reset,target
    where target.stored_mode='customized'
      and reset.descendant_reset_sequence>=target.customized_sequence
    order by reset.descendant_reset_sequence desc,reset.depth
    limit 1
  )
  select source.resource_type,
         source.resource_id,
         source.customized_sequence,
         reset.resource_type,
         reset.resource_id,
         reset.descendant_reset_sequence,
         overwritten.resource_type,
         overwritten.resource_id,
         overwritten.descendant_reset_sequence,
         coalesce((
           select md5(string_agg(
             node.depth::text || ':' || node.resource_type || ':' || node.resource_id::text || ':' || node.parent_link_sequence::text,
             '|' order by node.depth
           ))
           from path node
         ),md5(''))
  from selected_source source
  left join selected_reset reset on true
  left join target_overwrite overwritten on true;
$$;


--
-- Name: mangorts_v2_resolve_permission_policy(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_resolve_permission_policy(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS TABLE(source_resource_type text, source_resource_id uuid, source_customized_sequence bigint, reset_resource_type text, reset_resource_id uuid, reset_sequence bigint, overwritten_resource_type text, overwritten_resource_id uuid, overwritten_sequence bigint, parent_link_fingerprint text)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with recursive path as (
    select 0 as depth,
           setting.resource_type,
           setting.resource_id,
           setting.permission_mode as stored_mode,
           setting.customized_sequence,
           setting.parent_link_sequence,
           setting.descendant_reset_sequence,
           array[setting.resource_type || ':' || setting.resource_id::text]::text[] as visited
    from resource_permission_settings setting
    where setting.company_id=p_company_id
      and setting.resource_type=p_resource_type
      and setting.resource_id=p_resource_id
    union all
    select child.depth+1,
           parent_setting.resource_type,
           parent_setting.resource_id,
           parent_setting.permission_mode,
           parent_setting.customized_sequence,
           parent_setting.parent_link_sequence,
           parent_setting.descendant_reset_sequence,
           child.visited || (parent_setting.resource_type || ':' || parent_setting.resource_id::text)
    from path child
    cross join lateral mangorts_v2_policy_parent(p_company_id,child.resource_type,child.resource_id) parent
    join resource_permission_settings parent_setting
      on parent_setting.company_id=p_company_id
     and parent_setting.resource_type=parent.parent_resource_type
     and parent_setting.resource_id=parent.parent_resource_id
    where not (parent_setting.resource_type || ':' || parent_setting.resource_id::text)=any(child.visited)
  ),
  eligible_resets as (
    select ancestor.*
    from path ancestor
    where ancestor.depth>0
      and ancestor.descendant_reset_sequence>0
      and not exists (
        select 1 from path edge
        where edge.depth<ancestor.depth
          and edge.parent_link_sequence>ancestor.descendant_reset_sequence
      )
  ),
  active_sources as (
    select candidate.*
    from path candidate
    where candidate.stored_mode='customized'
      and not exists (
        select 1 from eligible_resets reset
        where reset.depth>candidate.depth
          and reset.descendant_reset_sequence>=candidate.customized_sequence
      )
  ),
  selected_source as (
    select * from active_sources order by depth limit 1
  ),
  selected_reset as (
    select * from eligible_resets order by descendant_reset_sequence desc,depth limit 1
  ),
  target as (
    select * from path where depth=0
  ),
  target_overwrite as (
    select reset.*
    from eligible_resets reset,target
    where target.stored_mode='customized'
      and reset.descendant_reset_sequence>=target.customized_sequence
    order by reset.descendant_reset_sequence desc,reset.depth
    limit 1
  )
  select source.resource_type,
         source.resource_id,
         source.customized_sequence,
         reset.resource_type,
         reset.resource_id,
         reset.descendant_reset_sequence,
         overwritten.resource_type,
         overwritten.resource_id,
         overwritten.descendant_reset_sequence,
         coalesce((
           select md5(string_agg(
             node.depth::text || ':' || node.resource_type || ':' || node.resource_id::text || ':' || node.parent_link_sequence::text,
             '|' order by node.depth
           ))
           from path node
         ),md5(''))
  from selected_source source
  left join selected_reset reset on true
  left join target_overwrite overwritten on true;
$$;


--
-- Name: mangorts_v2_resource_deleted_cleanup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_resource_deleted_cleanup() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  deleted_resource_type text := tg_argv[0];
  deleted_resource_id uuid := (to_jsonb(old)->>tg_argv[1])::uuid;
  deleted_company_id uuid := (to_jsonb(old)->>'company_id')::uuid;
begin
  delete from resource_gvic_settings
  where resource_gvic_settings.company_id=deleted_company_id
    and resource_gvic_settings.resource_type=deleted_resource_type
    and resource_gvic_settings.resource_id=deleted_resource_id;
  delete from resource_permission_settings
  where resource_permission_settings.company_id=deleted_company_id
    and resource_permission_settings.resource_type=deleted_resource_type
    and resource_permission_settings.resource_id=deleted_resource_id;
  return old;
end;
$$;


--
-- Name: mangorts_v2_shared_inbox_parent_changing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_shared_inbox_parent_changing() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if old.parent_folder_id is not null and new.parent_folder_id is null then
    perform mangorts_v2_materialize_detached_policy(old.company_id,'shared_inbox',old.shared_inbox_id);
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_v2_shared_inbox_parent_saved(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_shared_inbox_parent_saved() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op='UPDATE' and old.parent_folder_id is not distinct from new.parent_folder_id then
    return new;
  end if;
  perform mangorts_v2_advance_parent_link(new.company_id,'shared_inbox',new.shared_inbox_id,new.parent_folder_id is null);
  return new;
end;
$$;


--
-- Name: mangorts_v2_validate_policy_edge(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_validate_policy_edge() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  principal_kind text;
  principal_value uuid;
  customized boolean;
begin
  if tg_table_name='resource_gvic_assignments' then
    principal_kind := new.principal_type;
    principal_value := new.principal_id;
    select assignment_mode='customized' into customized
    from resource_gvic_settings
    where company_id=new.company_id and resource_type=new.resource_type and resource_id=new.resource_id;
  else
    principal_kind := new.subject_type;
    principal_value := new.subject_id;
    select permission_mode='customized' into customized
    from resource_permission_settings
    where company_id=new.company_id and resource_type=new.resource_type and resource_id=new.resource_id;
  end if;
  if customized is distinct from true then
    raise exception 'v2_policy_edge_requires_customized_settings:%:%',new.resource_type,new.resource_id
      using errcode='23514';
  end if;
  if principal_kind='user' and not exists (
    select 1 from company_memberships
    where company_id=new.company_id and user_id=principal_value
  ) then
    raise exception 'v2_policy_user_not_company_member:%:%',new.company_id,principal_value
      using errcode='23503';
  end if;
  if principal_kind='group' and not exists (
    select 1 from company_user_groups
    where company_id=new.company_id and group_id=principal_value
  ) then
    raise exception 'v2_policy_group_missing:%:%',new.company_id,principal_value
      using errcode='23503';
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_v2_validate_policy_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_v2_validate_policy_settings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  parent_type text;
  parent_id uuid;
  stored_mode text;
begin
  if not mangorts_v2_policy_resource_exists(new.company_id,new.resource_type,new.resource_id) then
    raise exception 'v2_policy_resource_missing:%:%:%', new.company_id,new.resource_type,new.resource_id
      using errcode='23503';
  end if;
  if mangorts_v2_policy_resource_has_cycle(new.company_id,new.resource_type,new.resource_id) then
    raise exception 'v2_policy_resource_cycle:%:%:%', new.company_id,new.resource_type,new.resource_id
      using errcode='23514';
  end if;
  select parent_resource_type,parent_resource_id into parent_type,parent_id
  from mangorts_v2_policy_parent(new.company_id,new.resource_type,new.resource_id);
  stored_mode := to_jsonb(new)->>(case when tg_table_name='resource_gvic_settings'
    then 'assignment_mode' else 'permission_mode' end);
  if found then
    if new.parent_link_sequence <= 0 then
      raise exception 'v2_policy_child_parent_link_sequence_required:%:%',new.resource_type,new.resource_id
        using errcode='23514';
    end if;
  else
    if new.parent_link_sequence <> 0 then
      raise exception 'v2_policy_root_parent_link_sequence_must_be_zero:%:%',new.resource_type,new.resource_id
        using errcode='23514';
    end if;
    if stored_mode='inherited' then
      raise exception 'v2_policy_root_cannot_be_inherited:%:%',new.resource_type,new.resource_id
        using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_validate_attachment_relationship_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_validate_attachment_relationship_owner() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: mangorts_validate_email_draft_shared_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_validate_email_draft_shared_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.deleted_timestamp is not null or new.shared_resource_type is null then
    return new;
  end if;
  if new.shared_resource_type='node' then
    perform 1 from nodes where company_id=new.company_id and node_id=new.shared_resource_id for key share;
  elsif new.shared_resource_type='project' then
    perform 1 from projects where company_id=new.company_id and project_id=new.shared_resource_id for key share;
  else
    raise exception 'shared email draft owner type is invalid'
      using errcode='23514', constraint='email_drafts_shared_owner_chk';
  end if;
  if not found then
    raise exception 'shared email draft owner does not exist in company'
      using errcode='23503', constraint='email_drafts_shared_owner_fkey';
  end if;
  perform 1 from email_relationships
  where company_id=new.company_id and email_message_id=new.source_email_message_id
    and resource_type=new.shared_resource_type and resource_id=new.shared_resource_id
    and resource_textbox_id is null
  for share;
  if not found then
    raise exception 'shared email draft source relationship does not exist'
      using errcode='23503', constraint='email_drafts_shared_source_relationship_fkey';
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_validate_email_relationship_resource(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_validate_email_relationship_resource() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.resource_type = 'node' then
    if not exists (select 1 from nodes where company_id=new.company_id and node_id=new.resource_id) then
      raise exception 'email relationship node does not exist' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and not exists (
      select 1 from node_textboxes where company_id=new.company_id
        and node_id=new.resource_id and textbox_id::text=new.resource_textbox_id
        and deleted_timestamp is null
    ) then
      raise exception 'email relationship Node textbox does not belong to resource' using errcode='23503';
    end if;
  elsif new.resource_type = 'project' then
    if not exists (select 1 from projects where company_id=new.company_id and project_id=new.resource_id) then
      raise exception 'email relationship project does not exist' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and not exists (
      select 1 from project_textboxes where company_id=new.company_id
        and project_id=new.resource_id and textbox_id=new.resource_textbox_id
        and deleted_timestamp is null
    ) then
      raise exception 'email relationship Project textbox does not belong to resource' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and new.resource_textbox_id=new.resource_id::text then
      raise exception 'permanent Project document cannot own an email textbox relationship'
        using errcode='23514', constraint='email_relationship_project_document_forbidden';
    end if;
  elsif new.resource_type = 'logic_gate' then
    if not exists (select 1 from logic_gates where company_id=new.company_id and logic_gate_id=new.resource_id) then
      raise exception 'email relationship Logic Gate does not exist' using errcode='23503';
    end if;
    if new.resource_textbox_id is not null and not exists (
      select 1 from logic_gate_textboxes where company_id=new.company_id
        and logic_gate_id=new.resource_id and textbox_id=new.resource_textbox_id
        and deleted_timestamp is null
    ) then
      raise exception 'email relationship Logic Gate textbox does not belong to resource' using errcode='23503';
    end if;
  else
    raise exception 'unsupported email relationship resource type' using errcode='23514';
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_validate_email_textbox_relationship_has_wide_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_validate_email_textbox_relationship_has_wide_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.resource_type in ('node','project') and new.resource_textbox_id is not null then
    perform 1
    from email_relationships wide
    where wide.company_id=new.company_id
      and wide.email_thread_id=new.email_thread_id
      and wide.resource_type=new.resource_type
      and wide.resource_id=new.resource_id
      and wide.resource_textbox_id is null
    order by wide.created_timestamp,wide.email_relationship_id
    limit 1
    for share;
    if not found then
      raise exception 'email textbox relationship requires a wide owner relationship'
        using errcode='23503', constraint='email_textbox_relationship_requires_wide';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_validate_huddle_explorer_folder(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_validate_huddle_explorer_folder() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare current_id uuid := new.parent_folder_id; steps integer := 0;
begin
  while current_id is not null loop
    if current_id=new.folder_id then
      raise exception 'huddle_explorer_folder_cycle' using errcode='23514';
    end if;
    select parent_folder_id into current_id
    from huddle_explorer_folders
    where company_id=new.company_id and folder_id=current_id;
    steps := steps + 1;
    if steps > 1000 then raise exception 'huddle_explorer_folder_cycle' using errcode='23514'; end if;
  end loop;
  return new;
end; $$;


--
-- Name: mangorts_validate_huddle_explorer_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_validate_huddle_explorer_item() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.huddle_type='huddle_logic_gate' and not exists(
    select 1 from huddle_logic_gates where company_id=new.company_id and huddle_logic_gate_id=new.resource_huddle_resource_id
  ) then raise exception 'huddle_logic_gate_missing' using errcode='23503'; end if;
  return new;
end; $$;


--
-- Name: mangorts_validate_node_email_chat_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_validate_node_email_chat_relationship() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.selection_source='email' and new.deleted_timestamp is null then
    perform 1
    from email_relationships relationship
    where relationship.company_id=new.company_id
      and relationship.resource_type='node'
      and relationship.resource_id=new.node_id
      and relationship.resource_textbox_id=new.textbox_id::text
      and relationship.email_message_id=new.selection_email_message_id
    limit 1
    for share;
    if not found then
      raise exception 'email chat requires exact Node message textbox relationship'
        using errcode='23503', constraint='email_chat_requires_exact_textbox_relationship';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_validate_project_email_chat_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_validate_project_email_chat_relationship() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.textbox_id=new.project_id::text then
    raise exception 'permanent Project document cannot own a chat'
      using errcode='23514', constraint='project_document_chat_forbidden';
  end if;
  if new.selection_source='email' and new.deleted_timestamp is null then
    perform 1
    from email_relationships relationship
    where relationship.company_id=new.company_id
      and relationship.resource_type='project'
      and relationship.resource_id=new.project_id
      and relationship.resource_textbox_id=new.textbox_id
      and relationship.email_message_id=new.selection_email_message_id
    limit 1
    for share;
    if not found then
      raise exception 'email chat requires exact Project message textbox relationship'
        using errcode='23503', constraint='email_chat_requires_exact_textbox_relationship';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: trg_cleanup_process_map_source_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_cleanup_process_map_source_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  deleted_company_id uuid := (to_jsonb(old)->>'company_id')::uuid;
  deleted_resource_type text;
  deleted_resource_id uuid;
  replacement_parent_id uuid;
begin
  if tg_table_name = 'company_explorer_folders' then
    deleted_resource_type := 'company_explorer_folder';
    deleted_resource_id := (to_jsonb(old)->>'folder_id')::uuid;

    perform pg_advisory_xact_lock(hashtextextended('process-map-parent:' || deleted_company_id::text, 0));
    select placement.map_parent_folder_id
      into replacement_parent_id
    from process_map_placements placement
    where placement.company_id = deleted_company_id
      and placement.resource_type = deleted_resource_type
      and placement.resource_id = deleted_resource_id
    for update;

    update process_map_placements placement
    set map_parent_folder_id=replacement_parent_id,
        revision = placement.revision + 1,
        updated_timestamp = statement_timestamp()
    where placement.company_id = deleted_company_id
      and placement.map_parent_folder_id = deleted_resource_id;
  elsif tg_table_name = 'logic_gates' then
    deleted_resource_type := 'logic_gate';
    deleted_resource_id := (to_jsonb(old)->>'logic_gate_id')::uuid;
  else
    raise exception 'unsupported_process_map_cleanup_source' using errcode='23514';
  end if;

  delete from resource_operational_relationships relationship
  where relationship.company_id = deleted_company_id
    and (
      (relationship.source_resource_type = deleted_resource_type
       and relationship.source_resource_id = deleted_resource_id)
      or
      (relationship.target_resource_type = deleted_resource_type
       and relationship.target_resource_id = deleted_resource_id)
    );

  delete from process_map_placements placement
  where placement.company_id = deleted_company_id
    and placement.resource_type = deleted_resource_type
    and placement.resource_id = deleted_resource_id;
  return old;
end;
$$;


--
-- Name: trg_update_workspace_read_versions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_update_workspace_read_versions() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.stream_type <> 'workspace' or new.stream_id <> new.company_id::text then
    return new;
  end if;

  insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
  select new.company_id, key.scope, key.resource_key, 0, new.created_timestamp
  from workspace_static_read_version_keys() key
  on conflict (company_id, scope, resource_key) do nothing;

  insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
  select new.company_id, key.scope, key.resource_key, new.sequence, new.created_timestamp
  from (
    select distinct scope, resource_key
    from workspace_read_version_keys_for_domain_event(new.event_type, new.payload)
  ) key
  on conflict (company_id, scope, resource_key)
  do update set
    version = greatest(workspace_read_versions.version, excluded.version),
    updated_timestamp = greatest(workspace_read_versions.updated_timestamp, excluded.updated_timestamp);

  return new;
end;
$$;


--
-- Name: trg_validate_process_map_placement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_validate_process_map_placement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  cycle_found boolean;
  parent_changed boolean;
begin

  parent_changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    parent_changed := new.map_parent_folder_id is distinct from old.map_parent_folder_id;
  end if;

  if parent_changed then
    perform pg_advisory_xact_lock(hashtextextended('process-map-parent:' || new.company_id::text, 0));
  end if;

  if new.resource_type = 'company_explorer_folder' then
    perform 1
    from company_explorer_folders folder
    where folder.company_id = new.company_id
      and folder.folder_id = new.resource_id
    for key share;
  elsif new.resource_type = 'logic_gate' then
    perform 1
    from logic_gates gate
    where gate.company_id = new.company_id
      and gate.logic_gate_id = new.resource_id
    for key share;
  else
    raise exception 'invalid_process_map_resource_type' using errcode='23514';
  end if;
  if not found then
    raise exception 'process_map_resource_not_found' using errcode='23503';
  end if;

  if new.map_parent_folder_id is not null then
    perform 1
    from company_explorer_folders folder
    where folder.company_id = new.company_id
      and folder.folder_id = new.map_parent_folder_id
    for key share;
    if not found then
      raise exception 'process_map_parent_folder_not_found' using errcode='23503';
    end if;

    perform 1
    from process_map_placements parent_placement
    where parent_placement.company_id = new.company_id
      and parent_placement.resource_type = 'company_explorer_folder'
      and parent_placement.resource_id = new.map_parent_folder_id
    for key share;
    if not found then
      raise exception 'process_map_parent_folder_not_mapped' using errcode='23503';
    end if;
  end if;

  if new.resource_type = 'company_explorer_folder'
     and new.map_parent_folder_id is not null
     and parent_changed then
    with recursive ancestors(folder_id) as (
      select new.map_parent_folder_id
      union
      select placement.map_parent_folder_id
      from ancestors ancestor
      join process_map_placements placement
        on placement.company_id = new.company_id
       and placement.resource_type = 'company_explorer_folder'
       and placement.resource_id = ancestor.folder_id
      where placement.map_parent_folder_id is not null
    )
    select exists(select 1 from ancestors where folder_id = new.resource_id)
    into cycle_found;
    if cycle_found then
      raise exception 'process_map_parent_cycle' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: trg_validate_resource_operational_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_validate_resource_operational_relationship() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  locked_count integer;
begin
  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.resource_operational_relationship_id is distinct from old.resource_operational_relationship_id
    or new.source_resource_type is distinct from old.source_resource_type
    or new.source_resource_id is distinct from old.source_resource_id
    or new.target_resource_type is distinct from old.target_resource_type
    or new.target_resource_id is distinct from old.target_resource_id
  ) then
    raise exception 'process_map_relationship_endpoints_immutable' using errcode='23514';
  end if;

  if new.source_resource_type not in ('company_explorer_folder', 'logic_gate')
     or new.target_resource_type not in ('company_explorer_folder', 'logic_gate') then
    raise exception 'invalid_process_map_resource_type' using errcode='23514';
  end if;
  if new.source_resource_type = new.target_resource_type
     and new.source_resource_id = new.target_resource_id then
    raise exception 'process_map_relationship_self_edge' using errcode='23514';
  end if;

  if new.source_resource_type = 'company_explorer_folder'
     and new.target_resource_type = 'company_explorer_folder' then
    perform 1 from company_explorer_folders
    where company_id = new.company_id
      and folder_id in (new.source_resource_id, new.target_resource_id)
    order by folder_id for key share;
    get diagnostics locked_count = row_count;
    if locked_count <> 2 then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
  elsif new.source_resource_type = 'logic_gate'
        and new.target_resource_type = 'logic_gate' then
    perform 1 from logic_gates
    where company_id = new.company_id
      and logic_gate_id in (new.source_resource_id, new.target_resource_id)
    order by logic_gate_id for key share;
    get diagnostics locked_count = row_count;
    if locked_count <> 2 then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
  else
    perform 1 from company_explorer_folders
    where company_id = new.company_id
      and folder_id = case
        when new.source_resource_type = 'company_explorer_folder' then new.source_resource_id
        else new.target_resource_id
      end
    for key share;
    if not found then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
    perform 1 from logic_gates
    where company_id = new.company_id
      and logic_gate_id = case
        when new.source_resource_type = 'logic_gate' then new.source_resource_id
        else new.target_resource_id
      end
    for key share;
    if not found then
      raise exception 'process_map_endpoint_not_found' using errcode='23503';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: workspace_read_version_keys_for_domain_event(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb) RETURNS TABLE(scope text, resource_key text)
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  board_id text := btrim(coalesce(p_payload->>'board_id', ''));
  folder_kind text := btrim(coalesce(p_payload->>'folder_kind', ''));
  item_type text := btrim(coalesce(p_payload->>'item_type', ''));
begin
  return query select v.scope, v.resource_key from (values
    ('workspace-snapshot:full', '')
  ) as v(scope, resource_key);

  if p_event_type = any(array[
    'node_created', 'node_updated', 'node_deleted',
    'kanban_card_upserted', 'kanban_card_moved', 'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved', 'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed', 'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted', 'kanban_board_deleted', 'node_permissions_updated'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('nodes', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:node')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['node_deleted', 'node_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('company-explorer-folder-items', ''),
      ('company-explorer-folder-items', 'item_type:node')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['relationship_created', 'relationship_deleted', 'node_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values ('node-relationships', '')) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_created', 'logic_gate_updated', 'logic_gate_deleted', 'logic_gate_raci_updated', 'logic_gate_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gates', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_deleted', 'logic_gate_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('company-explorer-folder-items', ''),
      ('company-explorer-folder-items', 'item_type:logic_gate')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array[
    'project_created', 'project_updated', 'project_deleted', 'project_information_created',
    'project_information_deleted', 'project_relationship_upserted', 'project_relationship_deleted',
    'project_permissions_updated'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('projects', ''),
      ('workspace-snapshot:company_explorer', ''),
      ('workspace-snapshot:company_explorer', 'folder_kind:project')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['project_deleted', 'project_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('company-explorer-folder-items', ''),
      ('company-explorer-folder-items', 'item_type:project')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array[
    'process_map_placement_saved', 'process_map_placement_deleted',
    'resource_operational_relationship_created', 'resource_operational_relationship_deleted',
    'process_map_trace_saved', 'logic_gate_updated', 'logic_gate_deleted',
    'logic_gate_gvic_updated', 'logic_gate_qd_rating_updated',
    'logic_gate_permissions_updated', 'company_explorer_folder_updated',
    'company_explorer_folder_created', 'company_explorer_folder_deleted', 'company_explorer_folder_permissions_updated',
	'company_explorer_item_placed', 'company_explorer_item_removed',
    'company_user_group_updated', 'company_user_group_deleted', 'company_user_group_members_updated',
    'company_membership_saved', 'company_membership_deleted', 'company_user_profile_updated'
  ]::text[])
  or (
    p_event_type='logic_gate_created'
    and btrim(coalesce(p_payload->>'realtime_change_type', ''))='resource_restored'
  )
  or (
    p_event_type='resource_gvic_policy_updated'
    and btrim(coalesce(p_payload->>'resource_type', ''))='company_explorer_folder'
  ) then
    return query select v.scope, v.resource_key from (values ('process-map', '')) as v(scope, resource_key);
  end if;

  if p_event_type = any(array[
    'company_explorer_folder_created', 'company_explorer_folder_updated',
    'company_explorer_folder_deleted', 'communications_shared_inbox_raci_updated',
    'shared_triage_access_updated'
  ]::text[]) then
    if folder_kind = 'node' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif folder_kind = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:logic_gate')
      ) as v(scope, resource_key);
    elsif folder_kind = 'project' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:project'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:project')
      ) as v(scope, resource_key);
    elsif folder_kind = 'communications' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', 'folder_kind:communications')
      ) as v(scope, resource_key);
    end if;
  end if;

  if p_event_type = any(array['company_explorer_folder_item_assigned', 'company_explorer_folder_item_removed']::text[]) then
    if item_type = 'node' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif item_type = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:logic_gate')
      ) as v(scope, resource_key);
    elsif item_type = 'project' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:project'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:project')
      ) as v(scope, resource_key);
    end if;
  end if;

  if p_event_type = any(array['kanban_board_saved', 'kanban_board_updated', 'kanban_board_deleted', 'logic_gate_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values ('kanban-boards', '')) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_column_created', 'kanban_column_updated', 'kanban_column_deleted',
    'kanban_board_deleted', 'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-columns', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_card_upserted', 'kanban_card_moved', 'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved', 'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed', 'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted', 'kanban_board_deleted', 'node_deleted', 'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-cards', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;
end;
$$;


--
-- Name: workspace_static_read_version_keys(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_static_read_version_keys() RETURNS TABLE(scope text, resource_key text)
    LANGUAGE sql IMMUTABLE
    AS $$
  select *
  from (values
    ('workspace-snapshot:full', ''),
    ('workspace-snapshot:company_explorer', ''),
    ('workspace-snapshot:company_explorer', 'folder_kind:node'),
    ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
    ('workspace-snapshot:company_explorer', 'folder_kind:communications'),
    ('company-explorer-folder-items', ''),
    ('company-explorer-folder-items', 'item_type:node'),
    ('company-explorer-folder-items', 'item_type:logic_gate'),
    ('nodes', ''),
    ('node-relationships', ''),
    ('logic-gates', ''),
    ('process-map', ''),
    ('kanban-boards', '')
  ) as keys(scope, resource_key)
$$;


--
-- Name: mangorts_entity_field_type_config_valid(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_entity_field_type_config_valid(p_field_type text, p_config jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  option_value jsonb;
begin
  if jsonb_typeof(p_config) <> 'object' then
    return false;
  end if;
  if p_field_type not in ('choice','color') then
    return p_config = '{}'::jsonb;
  end if;
  if (p_config - array['default','options']) <> '{}'::jsonb then
    return false;
  end if;
  if jsonb_typeof(p_config->'options') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_config->'options') = 0 then
    return false;
  end if;
  for option_value in select value from jsonb_array_elements(p_config->'options') loop
    if jsonb_typeof(option_value) is distinct from 'object'
       or jsonb_typeof(option_value->'key') is distinct from 'string'
       or (option_value->>'key') !~ '^[a-z][a-z0-9_]*$'
       or length(option_value->>'key') > 200
       or jsonb_typeof(option_value->'label') is distinct from 'string'
       or btrim(option_value->>'label') = ''
       or length(option_value->>'label') > 200 then
      return false;
    end if;
    if p_field_type = 'choice' then
      if (option_value - array['key','label']) <> '{}'::jsonb then
        return false;
      end if;
    elsif (option_value - array['key','label','color']) <> '{}'::jsonb
          or jsonb_typeof(option_value->'color') is distinct from 'string'
          or (option_value->>'color') !~ '^#[0-9a-f]{6}$' then
      return false;
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_config->'options') item
    group by item->>'key' having count(*) > 1
  ) then
    return false;
  end if;
  if p_config ? 'default' and p_config->'default' <> 'null'::jsonb then
    if jsonb_typeof(p_config->'default') is distinct from 'string'
       or not exists (
         select 1 from jsonb_array_elements(p_config->'options') item
         where item->>'key'=p_config->>'default'
       ) then
      return false;
    end if;
  end if;
  return true;
end;
$$;


--
-- Name: mangorts_protect_action_item_entity_type(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_protect_action_item_entity_type() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE' then
    if old.system_key = 'action_item'
       and exists (select 1 from companies where company_id=old.company_id) then
      raise exception 'action_item_entity_type_required' using errcode='23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.system_key = 'action_item' and (
    new.company_id is distinct from old.company_id
    or new.entity_type_id is distinct from old.entity_type_id
    or new.system_key is distinct from old.system_key
    or new.name is distinct from old.name
  ) then
    raise exception 'action_item_entity_type_immutable' using errcode='23514';
  end if;
  if new.system_key = 'action_item' and (
    new.entity_type_id <> 'a17e0000-0000-4000-8000-000000000001'::uuid
    or new.name <> 'Action Item'
  ) then
    raise exception 'action_item_entity_type_invalid' using errcode='23514';
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_protect_action_item_field_type(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_protect_action_item_field_type() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  old_is_action_item boolean := false;
  new_is_action_item boolean := false;
  old_is_required boolean := false;
  expected_id uuid;
  expected_name text;
  expected_field_type text;
begin
  if tg_op <> 'INSERT' then
    select coalesce(entity_type.system_key='action_item',false)
    into old_is_action_item
    from entity_types entity_type
    where entity_type.company_id=old.company_id
      and entity_type.entity_type_id=old.entity_type_id;
    old_is_required := coalesce(old_is_action_item,false)
      and old.system_key in ('person_in_charge','analysis_due_date','completion_due_date','status','color');
    if tg_op = 'DELETE' then
      if old_is_required and exists (select 1 from companies where company_id=old.company_id) then
        raise exception 'action_item_field_type_required:%',old.system_key using errcode='23514';
      end if;
      return old;
    end if;
    if old_is_required and (
      new.company_id is distinct from old.company_id
      or new.entity_field_type_id is distinct from old.entity_field_type_id
      or new.entity_type_id is distinct from old.entity_type_id
      or new.entity_folder_id is distinct from old.entity_folder_id
      or new.system_key is distinct from old.system_key
      or new.name is distinct from old.name
      or new.field_type is distinct from old.field_type
    ) then
      raise exception 'action_item_field_type_immutable:%',old.system_key using errcode='23514';
    end if;
  end if;
  select coalesce(entity_type.system_key='action_item',false)
  into new_is_action_item
  from entity_types entity_type
  where entity_type.company_id=new.company_id
    and entity_type.entity_type_id=new.entity_type_id;
  if not coalesce(new_is_action_item,false) then
    return new;
  end if;
  if new.system_key is null
     or new.system_key not in ('person_in_charge','analysis_due_date','completion_due_date','status','color') then
    if lower(btrim(new.name)) in ('person in charge','analysis due date','completion due date','status','color') then
      raise exception 'action_item_field_type_name_reserved:%',new.name using errcode='23514';
    end if;
    return new;
  end if;
  select definition.expected_id,definition.expected_name,definition.expected_field_type
  into expected_id,expected_name,expected_field_type
  from (values
    ('person_in_charge','a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person'),
    ('analysis_due_date','a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date'),
    ('completion_due_date','a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date'),
    ('status','a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice'),
    ('color','a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color')
  ) as definition(system_key,expected_id,expected_name,expected_field_type)
  where definition.system_key=new.system_key;
  if new.entity_field_type_id <> expected_id
     or new.entity_folder_id is not null
     or new.name <> expected_name
     or new.field_type <> expected_field_type then
    raise exception 'action_item_field_type_invalid:%',new.system_key using errcode='23514';
  end if;
  if not mangorts_entity_field_type_config_valid(new.field_type,new.config_jsonb) then
    raise exception 'action_item_field_type_config_invalid:%',new.system_key using errcode='23514';
  end if;
  if new.system_key='status' and (
    not (new.config_jsonb ? 'default')
    or new.config_jsonb->>'default' is distinct from 'in_progress'
    or jsonb_array_length(new.config_jsonb->'options') <> 3
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='in_progress')
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='pending')
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='done')
  ) then
    raise exception 'action_item_status_config_required' using errcode='23514';
  end if;
  if new.system_key='color' and (
    not (new.config_jsonb ? 'default')
    or new.config_jsonb->'default' is distinct from 'null'::jsonb
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='yellow')
    or not exists (select 1 from jsonb_array_elements(new.config_jsonb->'options') option_value where option_value->>'key'='red')
  ) then
    raise exception 'action_item_color_config_required' using errcode='23514';
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_maintain_entity_field_template_link(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_maintain_entity_field_template_link() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  template_field_type text;
  template_config jsonb;
  person_id text;
  date_text text;
  parsed_date date;
begin
  if tg_op = 'UPDATE'
     and new.field_type is distinct from old.field_type
     and new.entity_field_type_id is not distinct from old.entity_field_type_id then
    new.entity_field_type_id := null;
  end if;
  if new.entity_field_type_id is not null then
    select template.field_type,template.config_jsonb
    into template_field_type,template_config
    from entity_field_types template
    join entities entity
      on entity.company_id=new.company_id
     and entity.entity_id=new.entity_id
     and entity.entity_type_id=template.entity_type_id
    where template.company_id=new.company_id
      and template.entity_field_type_id=new.entity_field_type_id;
    if not found then
      raise exception 'entity_field_type_link_invalid' using errcode='23503';
    end if;
    if template_field_type <> new.field_type then
      raise exception 'entity_field_type_link_kind_mismatch' using errcode='23514';
    end if;
    if new.value_jsonb is not null and new.field_type in ('choice','color')
       and not exists (
         select 1 from jsonb_array_elements(template_config->'options') option_value
         where option_value->>'key' = (new.value_jsonb #>> '{}')
       ) then
      raise exception 'entity_field_option_invalid' using errcode='23514';
    end if;
  end if;
  if new.value_jsonb is not null and new.field_type='date' then
    date_text := new.value_jsonb #>> '{}';
    if jsonb_typeof(new.value_jsonb) is distinct from 'string'
       or date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'entity_field_date_invalid' using errcode='23514';
    end if;
    begin
      parsed_date := date_text::date;
    exception when others then
      raise exception 'entity_field_date_invalid' using errcode='23514';
    end;
    if to_char(parsed_date,'YYYY-MM-DD') <> date_text then
      raise exception 'entity_field_date_invalid' using errcode='23514';
    end if;
  end if;
  if new.value_jsonb is not null and new.field_type='person' then
    person_id := new.value_jsonb #>> '{}';
    if person_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (
         select 1 from company_memberships membership
         where membership.company_id=new.company_id
           and membership.user_id=person_id::uuid
       ) then
      raise exception 'entity_field_person_not_company_member' using errcode='23503';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_clear_entity_person_fields_for_membership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_clear_entity_person_fields_for_membership() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if exists (select 1 from companies where company_id=old.company_id) then
    update entity_fields
    set value_jsonb=null,
        updated_timestamp=now()
    where company_id=old.company_id
      and field_type='person'
      and value_jsonb=to_jsonb(old.user_id::text);
  end if;
  return old;
end;
$$;


--
-- Name: mangorts_unlink_entity_fields_after_template_retype(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_unlink_entity_fields_after_template_retype() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  update entity_fields
  set entity_field_type_id=null,
      updated_timestamp=now()
  where company_id=new.company_id
    and entity_field_type_id=new.entity_field_type_id;
  return new;
end;
$$;


--
-- Name: mangorts_protect_action_item_entity_field(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_protect_action_item_entity_field() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  old_system_key text;
  old_is_required boolean := false;
  new_system_key text;
  new_expected_name text;
  new_expected_field_type text;
begin
  if tg_op <> 'INSERT' and old.entity_field_type_id is not null then
    select template.system_key
    into old_system_key
    from entity_field_types template
    join entity_types entity_type
      on entity_type.company_id=template.company_id
     and entity_type.entity_type_id=template.entity_type_id
     and entity_type.system_key='action_item'
    where template.company_id=old.company_id
      and template.entity_field_type_id=old.entity_field_type_id;
    old_is_required := old_system_key in ('person_in_charge','analysis_due_date','completion_due_date','status','color');
    if tg_op = 'DELETE' then
      if old_is_required and exists (
        select 1 from entities entity
        where entity.company_id=old.company_id and entity.entity_id=old.entity_id
      ) then
        raise exception 'action_item_entity_field_required:%',old_system_key using errcode='23514';
      end if;
      return old;
    end if;
    if old_is_required and (
      new.company_id is distinct from old.company_id
      or new.entity_field_id is distinct from old.entity_field_id
      or new.entity_id is distinct from old.entity_id
      or new.entity_field_type_id is distinct from old.entity_field_type_id
      or new.name is distinct from old.name
      or new.field_type is distinct from old.field_type
    ) then
      raise exception 'action_item_entity_field_immutable:%',old_system_key using errcode='23514';
    end if;
  elsif tg_op = 'DELETE' then
    return old;
  end if;
  if new.entity_field_type_id is null then
    return new;
  end if;
  select template.system_key,
         case template.system_key
           when 'person_in_charge' then 'Person in charge'
           when 'analysis_due_date' then 'Analysis due date'
           when 'completion_due_date' then 'Completion due date'
           when 'status' then 'Status'
           when 'color' then 'Color'
         end,
         case template.system_key
           when 'person_in_charge' then 'person'
           when 'analysis_due_date' then 'date'
           when 'completion_due_date' then 'date'
           when 'status' then 'choice'
           when 'color' then 'color'
         end
  into new_system_key,new_expected_name,new_expected_field_type
  from entity_field_types template
  join entity_types entity_type
    on entity_type.company_id=template.company_id
   and entity_type.entity_type_id=template.entity_type_id
   and entity_type.system_key='action_item'
  where template.company_id=new.company_id
    and template.entity_field_type_id=new.entity_field_type_id
    and template.system_key in ('person_in_charge','analysis_due_date','completion_due_date','status','color');
  if found and (new.name <> new_expected_name or new.field_type <> new_expected_field_type) then
    raise exception 'action_item_entity_field_invalid:%',new_system_key using errcode='23514';
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_validate_entity_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_validate_entity_relationship() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op='UPDATE' and (
       new.company_id is distinct from old.company_id
       or new.entity_id is distinct from old.entity_id
       or new.resource_type is distinct from old.resource_type
       or new.resource_id is distinct from old.resource_id
     ) then
    raise exception 'entity_relationship_endpoints_immutable' using errcode='23514';
  end if;

  if new.resource_type='huddle_node' then
    perform 1
    from huddle_nodes
    where company_id=new.company_id and huddle_node_id=new.resource_id
    for key share;
  elsif new.resource_type='huddle_logic_gate' then
    perform 1
    from huddle_logic_gates
    where company_id=new.company_id and huddle_logic_gate_id=new.resource_id
    for key share;
  else
    raise exception 'entity_relationship_resource_type_invalid:%',new.resource_type using errcode='23514';
  end if;

  if not found then
    raise exception 'entity_relationship_resource_not_found:%:%',new.resource_type,new.resource_id using errcode='23503';
  end if;
  return new;
end;
$$;


--
-- Name: mangorts_delete_entity_relationships_for_huddle_resource(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mangorts_delete_entity_relationships_for_huddle_resource() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_table_name='huddle_nodes' then
    delete from entity_relationships
    where company_id=old.company_id
      and resource_type='huddle_node'
      and resource_id=old.huddle_node_id;
  elsif tg_table_name='huddle_logic_gates' then
    delete from entity_relationships
    where company_id=old.company_id
      and resource_type='huddle_logic_gate'
      and resource_id=old.huddle_logic_gate_id;
  else
    raise exception 'entity_relationship_delete_source_invalid:%',tg_table_name using errcode='23514';
  end if;
  return old;
end;
$$;


--
-- Name: account_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_folders (
    company_id uuid NOT NULL,
    folder_id uuid NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_folders_name_nonblank_chk CHECK ((btrim(name) <> ''::text))
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    company_id uuid NOT NULL,
    account_id uuid NOT NULL,
    name text NOT NULL,
    folder_id uuid,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_name_nonblank_chk CHECK ((btrim(name) <> ''::text))
);


--
-- Name: attachment_previews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachment_previews (
    attachment_id uuid NOT NULL,
    preview_type text NOT NULL,
    mime_type text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text,
    generation_version integer,
    width integer,
    height integer,
    storage_bucket text NOT NULL,
    storage_key text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attachment_previews_byte_size_chk CHECK ((byte_size >= 0)),
    CONSTRAINT attachment_previews_dimensions_chk CHECK ((((width IS NULL) OR (width > 0)) AND ((height IS NULL) OR (height > 0)))),
    CONSTRAINT attachment_previews_generation_version_chk CHECK (((generation_version IS NULL) OR (generation_version > 0))),
    CONSTRAINT attachment_previews_mime_type_nonblank_chk CHECK ((btrim(mime_type) <> ''::text)),
    CONSTRAINT attachment_previews_sha256_chk CHECK (((sha256 IS NULL) OR (sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT attachment_previews_storage_bucket_nonblank_chk CHECK ((btrim(storage_bucket) <> ''::text)),
    CONSTRAINT attachment_previews_storage_key_nonblank_chk CHECK ((btrim(storage_key) <> ''::text)),
    CONSTRAINT attachment_previews_type_chk CHECK ((preview_type = ANY (ARRAY['display'::text, 'thumbnail'::text])))
);


--
-- Name: attachment_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachment_relationships (
    attachment_relationship_id uuid NOT NULL,
    company_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    attachment_id uuid NOT NULL,
    information_id uuid,
    message_id text DEFAULT ''::text NOT NULL,
    editor_surface text DEFAULT ''::text NOT NULL,
    relationship_kind text NOT NULL,
    created_by_user_id uuid,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    CONSTRAINT attachment_relationships_kind_chk CHECK ((relationship_kind = ANY (ARRAY['inline_image'::text, 'file_attachment'::text, 'chat_attachment'::text, 'email_attachment'::text, 'email_inline_attachment'::text, 'migrated_inline_image'::text]))),
    CONSTRAINT attachment_relationships_resource_id_chk CHECK ((btrim(resource_id) <> ''::text)),
    CONSTRAINT attachment_relationships_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'logic_gate'::text, 'project'::text, 'huddle_logic_gate'::text, 'huddle_node'::text, 'node_chat_message'::text, 'logic_gate_chat_message'::text, 'project_chat_message'::text, 'email_message'::text, 'email_draft'::text, 'email_signature'::text, 'shared_inbox'::text, 'company_explorer_folder'::text, 'shared_inbox_folder'::text])))
);


--
-- Name: attachment_upload_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachment_upload_jobs (
    upload_job_id uuid NOT NULL,
    company_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    client_request_id text NOT NULL,
    attachment_id uuid NOT NULL,
    attachment_relationship_id uuid,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    sha256_verification_method text DEFAULT 'client_reported'::text NOT NULL,
    storage_checksum_algorithm text DEFAULT ''::text NOT NULL,
    storage_checksum_value text DEFAULT ''::text NOT NULL,
    storage_checksum_type text DEFAULT ''::text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    information_id uuid,
    message_id text DEFAULT ''::text NOT NULL,
    editor_surface text DEFAULT ''::text NOT NULL,
    relationship_kind text NOT NULL,
    source_kind text NOT NULL,
    source_provider text DEFAULT ''::text NOT NULL,
    original_width integer,
    original_height integer,
    storage_bucket text NOT NULL,
    storage_key text NOT NULL,
    multipart_upload_id text DEFAULT ''::text NOT NULL,
    strategy text NOT NULL,
    part_size_bytes bigint DEFAULT 0 NOT NULL,
    part_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    failure_code text DEFAULT ''::text NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    expires_timestamp timestamp with time zone NOT NULL,
    completed_timestamp timestamp with time zone,
    resource_expected_revision bigint DEFAULT 0 NOT NULL,
    resource_revision bigint DEFAULT 0 NOT NULL,
    CONSTRAINT attachment_upload_jobs_client_request_nonblank_chk CHECK ((btrim(client_request_id) <> ''::text)),
    CONSTRAINT attachment_upload_jobs_completed_timestamp_chk CHECK ((((status = 'completed'::text) AND (completed_timestamp IS NOT NULL)) OR ((status <> 'completed'::text) AND (completed_timestamp IS NULL)))),
    CONSTRAINT attachment_upload_jobs_dimensions_chk CHECK ((((original_width IS NULL) OR (original_width > 0)) AND ((original_height IS NULL) OR (original_height > 0)))),
    CONSTRAINT attachment_upload_jobs_filename_nonblank_chk CHECK ((btrim(original_filename) <> ''::text)),
    CONSTRAINT attachment_upload_jobs_mime_nonblank_chk CHECK ((btrim(mime_type) <> ''::text)),
    CONSTRAINT attachment_upload_jobs_relationship_chk CHECK ((relationship_kind = ANY (ARRAY['inline_image'::text, 'file_attachment'::text, 'chat_attachment'::text, 'email_attachment'::text, 'email_inline_attachment'::text, 'migrated_inline_image'::text]))),
    CONSTRAINT attachment_upload_jobs_resource_nonblank_chk CHECK (((btrim(resource_type) <> ''::text) AND (btrim(resource_id) <> ''::text))),
    CONSTRAINT attachment_upload_jobs_resource_revision_chk CHECK (((resource_expected_revision >= 0) AND (resource_revision >= 0))),
    CONSTRAINT attachment_upload_jobs_resource_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'logic_gate'::text, 'project'::text, 'huddle_logic_gate'::text, 'huddle_node'::text, 'node_chat_message'::text, 'logic_gate_chat_message'::text, 'project_chat_message'::text, 'email_message'::text, 'email_draft'::text, 'email_signature'::text, 'attached_email'::text, 'shared_inbox'::text, 'company_explorer_folder'::text, 'shared_inbox_folder'::text]))),
    CONSTRAINT attachment_upload_jobs_sha256_chk CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT attachment_upload_jobs_sha256_method_chk CHECK ((sha256_verification_method = ANY (ARRAY['s3_full'::text, 'server_stream'::text, 'client_reported'::text]))),
    CONSTRAINT attachment_upload_jobs_size_chk CHECK ((size_bytes >= 0)),
    CONSTRAINT attachment_upload_jobs_source_chk CHECK ((source_kind = ANY (ARRAY['user_upload'::text, 'editor_paste'::text, 'chat_upload'::text, 'email_incoming'::text, 'email_outgoing'::text, 'migration_inline_image'::text]))),
    CONSTRAINT attachment_upload_jobs_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'uploading'::text, 'completing'::text, 'completed'::text, 'failed'::text, 'aborted'::text, 'expired'::text]))),
    CONSTRAINT attachment_upload_jobs_storage_checksum_provenance_chk CHECK (((storage_checksum_algorithm = ANY (ARRAY[''::text, 'SHA256'::text])) AND (storage_checksum_type = ANY (ARRAY[''::text, 'FULL_OBJECT'::text, 'COMPOSITE'::text])) AND ((storage_checksum_algorithm = ''::text) = (storage_checksum_value = ''::text)) AND ((storage_checksum_algorithm = ''::text) = (storage_checksum_type = ''::text)))),
    CONSTRAINT attachment_upload_jobs_storage_nonblank_chk CHECK (((btrim(storage_bucket) <> ''::text) AND (btrim(storage_key) <> ''::text))),
    CONSTRAINT attachment_upload_jobs_strategy_chk CHECK ((((strategy = 'single'::text) AND (size_bytes <= 67108864) AND (multipart_upload_id = ''::text) AND (part_size_bytes = 0) AND (part_count = 0)) OR ((strategy = 'multipart'::text) AND (size_bytes > 67108864) AND (btrim(multipart_upload_id) <> ''::text) AND (part_size_bytes = 16777216) AND (part_count = (((size_bytes + 16777215) / 16777216))::integer) AND ((part_count >= 1) AND (part_count <= 10000)))))
);


--
-- Name: attachment_upload_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachment_upload_parts (
    upload_job_id uuid NOT NULL,
    part_number integer NOT NULL,
    expected_size_bytes bigint NOT NULL,
    observed_size_bytes bigint DEFAULT 0 NOT NULL,
    checksum_algorithm text NOT NULL,
    expected_checksum text NOT NULL,
    etag text DEFAULT ''::text NOT NULL,
    s3_checksum text DEFAULT ''::text NOT NULL,
    signing_attempt_count integer DEFAULT 0 NOT NULL,
    last_signed_timestamp timestamp with time zone,
    uploaded_timestamp timestamp with time zone,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attachment_upload_parts_algorithm_chk CHECK ((checksum_algorithm = 'SHA256'::text)),
    CONSTRAINT attachment_upload_parts_checksum_nonblank_chk CHECK ((btrim(expected_checksum) <> ''::text)),
    CONSTRAINT attachment_upload_parts_number_chk CHECK (((part_number >= 1) AND (part_number <= 10000))),
    CONSTRAINT attachment_upload_parts_signing_attempt_chk CHECK ((signing_attempt_count >= 0)),
    CONSTRAINT attachment_upload_parts_size_chk CHECK (((expected_size_bytes > 0) AND (observed_size_bytes >= 0)))
);


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    attachment_id uuid NOT NULL,
    company_id uuid NOT NULL,
    uploaded_by_user_id uuid,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text NOT NULL,
    storage_bucket text NOT NULL,
    storage_key text NOT NULL,
    original_width integer,
    original_height integer,
    source_kind text NOT NULL,
    source_provider text DEFAULT ''::text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    sha256_verification_method text DEFAULT 'server_stream'::text NOT NULL,
    storage_checksum_algorithm text DEFAULT ''::text NOT NULL,
    storage_checksum_value text DEFAULT ''::text NOT NULL,
    storage_checksum_type text DEFAULT ''::text NOT NULL,
    CONSTRAINT attachments_byte_size_chk CHECK ((byte_size >= 0)),
    CONSTRAINT attachments_dimensions_chk CHECK ((((original_width IS NULL) OR (original_width > 0)) AND ((original_height IS NULL) OR (original_height > 0)))),
    CONSTRAINT attachments_filename_nonblank_chk CHECK ((btrim(original_filename) <> ''::text)),
    CONSTRAINT attachments_mime_type_nonblank_chk CHECK ((btrim(mime_type) <> ''::text)),
    CONSTRAINT attachments_sha256_format_chk CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT attachments_sha256_nonblank_chk CHECK ((btrim(sha256) <> ''::text)),
    CONSTRAINT attachments_sha256_verification_method_chk CHECK ((sha256_verification_method = ANY (ARRAY['s3_full'::text, 'server_stream'::text, 'client_reported'::text]))),
    CONSTRAINT attachments_source_kind_chk CHECK ((source_kind = ANY (ARRAY['user_upload'::text, 'editor_paste'::text, 'chat_upload'::text, 'email_incoming'::text, 'email_outgoing'::text, 'migration_inline_image'::text]))),
    CONSTRAINT attachments_storage_bucket_nonblank_chk CHECK ((btrim(storage_bucket) <> ''::text)),
    CONSTRAINT attachments_storage_checksum_provenance_chk CHECK (((storage_checksum_algorithm = ANY (ARRAY[''::text, 'SHA256'::text])) AND (storage_checksum_type = ANY (ARRAY[''::text, 'FULL_OBJECT'::text, 'COMPOSITE'::text])) AND ((storage_checksum_algorithm = ''::text) = (storage_checksum_value = ''::text)) AND ((storage_checksum_algorithm = ''::text) = (storage_checksum_type = ''::text)))),
    CONSTRAINT attachments_storage_key_nonblank_chk CHECK ((btrim(storage_key) <> ''::text))
);


--
-- Name: auth_external_identity_deletions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_external_identity_deletions (
    provider text NOT NULL,
    external_subject text NOT NULL,
    user_id uuid,
    email text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text DEFAULT ''::text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    completed_timestamp timestamp with time zone,
    CONSTRAINT auth_external_identity_deletions_attempts_chk CHECK ((attempts >= 0)),
    CONSTRAINT auth_external_identity_deletions_provider_chk CHECK ((provider = 'cognito'::text)),
    CONSTRAINT auth_external_identity_deletions_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text]))),
    CONSTRAINT auth_external_identity_deletions_subject_nonblank_chk CHECK ((btrim(external_subject) <> ''::text))
);


--
-- Name: communications_email_archive_job_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications_email_archive_job_items (
    job_item_id uuid NOT NULL,
    archive_job_id uuid NOT NULL,
    message_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    last_error text DEFAULT ''::text NOT NULL,
    archived_timestamp timestamp with time zone,
    failed_timestamp timestamp with time zone,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    attempt_token uuid,
    provider_attempt_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT communications_email_archive_job_items_message_chk CHECK ((btrim(message_id) <> ''::text)),
    CONSTRAINT communications_email_archive_job_items_provider_attempt_chk CHECK (((provider_attempt_count >= 0) AND (provider_attempt_count <= 3))),
    CONSTRAINT communications_email_archive_job_items_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'archived'::text, 'failed'::text])))
);


--
-- Name: communications_email_archive_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications_email_archive_jobs (
    archive_job_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    company_id uuid,
    shared_inbox_id uuid,
    connection_scope text NOT NULL,
    provider text NOT NULL,
    account_email text NOT NULL,
    grant_id text NOT NULL,
    company_email_connection_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_count integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    completed_timestamp timestamp with time zone,
    CONSTRAINT communications_email_archive_jobs_account_email_chk CHECK (((btrim(account_email) <> ''::text) AND (account_email = lower(btrim(account_email))))),
    CONSTRAINT communications_email_archive_jobs_grant_id_chk CHECK ((btrim(grant_id) <> ''::text)),
    CONSTRAINT communications_email_archive_jobs_provider_chk CHECK ((provider = ANY (ARRAY['google'::text, 'microsoft'::text]))),
    CONSTRAINT communications_email_archive_jobs_scope_chk CHECK ((connection_scope = ANY (ARRAY['personal'::text, 'shared'::text]))),
    CONSTRAINT communications_email_archive_jobs_shared_scope_chk CHECK ((((connection_scope = 'personal'::text) AND (shared_inbox_id IS NULL)) OR ((connection_scope = 'shared'::text) AND (company_id IS NOT NULL) AND (shared_inbox_id IS NOT NULL)))),
    CONSTRAINT communications_email_archive_jobs_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: communications_message_read_receipt_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications_message_read_receipt_signals (
    receipt_scope_type character varying NOT NULL,
    receipt_scope_id character varying NOT NULL,
    message_id text NOT NULL,
    signal_timestamp timestamp with time zone NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: communications_message_read_receipt_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications_message_read_receipt_summaries (
    receipt_scope_type character varying NOT NULL,
    receipt_scope_id character varying NOT NULL,
    user_id uuid,
    company_id uuid,
    company_email_connection_id uuid,
    shared_inbox_id uuid,
    message_id text NOT NULL,
    thread_id text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'likely_read'::text NOT NULL,
    signal_count integer DEFAULT 0 NOT NULL,
    first_signal_timestamp timestamp with time zone NOT NULL,
    last_signal_timestamp timestamp with time zone NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT communications_message_read_receipt_summaries_message_id_chk CHECK ((btrim(message_id) <> ''::text)),
    CONSTRAINT communications_message_read_receipt_summaries_personal_chk CHECK (((((receipt_scope_type)::text = 'personal'::text) AND (user_id IS NOT NULL) AND (company_email_connection_id IS NULL) AND ((receipt_scope_id)::text ~~ ((user_id)::text || ':%'::text)) AND (length((receipt_scope_id)::text) > (length((user_id)::text) + 1))) OR (((receipt_scope_type)::text = 'shared'::text) AND (company_id IS NOT NULL) AND (company_email_connection_id IS NOT NULL)))),
    CONSTRAINT communications_message_read_receipt_summaries_scope_chk CHECK (((receipt_scope_type)::text = ANY (ARRAY[('personal'::character varying)::text, ('shared'::character varying)::text]))),
    CONSTRAINT communications_message_read_receipt_summaries_signal_count_chk CHECK ((signal_count >= 0)),
    CONSTRAINT communications_message_read_receipt_summaries_status_chk CHECK ((status = ANY (ARRAY['likely_read'::text, 'read'::text])))
);


--
-- Name: communications_triage_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications_triage_items (
    user_id uuid NOT NULL,
    message_id text NOT NULL,
    message jsonb NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT communications_triage_items_message_id_nonblank_chk CHECK ((btrim(message_id) <> ''::text))
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    company_id uuid NOT NULL,
    name text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT companies_name_nonblank_chk CHECK ((btrim(name) <> ''::text))
);


--
-- Name: company_explorer_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_explorer_folders (
    company_id uuid NOT NULL,
    folder_id uuid NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    "position" integer DEFAULT 1000 NOT NULL,
    default_access text DEFAULT 'edit'::text NOT NULL,
    created_by_user_id uuid,
    CONSTRAINT company_explorer_folders_default_access_chk CHECK ((default_access = ANY (ARRAY['edit'::text, 'no_access'::text]))),
    CONSTRAINT company_explorer_folders_name_nonblank_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT company_explorer_folders_parent_not_self_chk CHECK (((parent_folder_id IS NULL) OR (parent_folder_id <> folder_id)))
);


--
-- Name: company_explorer_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_explorer_items (
    company_id uuid NOT NULL,
    item_id uuid NOT NULL,
    parent_folder_id uuid,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    "position" integer DEFAULT 1000 NOT NULL,
    created_by_user_id uuid,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_explorer_items_target_type_chk CHECK ((target_type = ANY (ARRAY['project'::text, 'logic_gate'::text])))
);


--
-- Name: logic_gates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logic_gates (
    company_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    header text NOT NULL,
    created_timestamp timestamp with time zone NOT NULL,
    default_access text DEFAULT 'edit'::text NOT NULL,
    CONSTRAINT logic_gates_default_access_chk CHECK ((default_access = ANY (ARRAY['edit'::text, 'no_access'::text])))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'Active'::text NOT NULL,
    default_access text DEFAULT 'edit'::text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    health text DEFAULT 'On Track'::text NOT NULL,
    CONSTRAINT projects_default_access_chk CHECK ((default_access = ANY (ARRAY['edit'::text, 'no_access'::text]))),
    CONSTRAINT projects_health_chk CHECK ((health = ANY (ARRAY['On Track'::text, 'AT RISK'::text, 'Off Track'::text]))),
    CONSTRAINT projects_name_nonblank_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT projects_status_nonblank_chk CHECK ((btrim(status) <> ''::text))
);


--
-- Name: company_explorer_final_backfill_verification; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.company_explorer_final_backfill_verification AS
 SELECT check_row.check_name,
    check_row.expected_count,
    check_row.actual_count,
    (check_row.expected_count = check_row.actual_count) AS ok
   FROM ( SELECT 'manual_references_have_existing_targets'::text AS check_name,
            ( SELECT count(*) AS count
                   FROM public.company_explorer_items) AS expected_count,
            ( SELECT count(*) AS count
                   FROM ((public.company_explorer_items item
                     LEFT JOIN public.projects project ON (((item.target_type = 'project'::text) AND (project.company_id = item.company_id) AND (project.project_id = item.target_id))))
                     LEFT JOIN public.logic_gates logic_gate ON (((item.target_type = 'logic_gate'::text) AND (logic_gate.company_id = item.company_id) AND (logic_gate.logic_gate_id = item.target_id))))
                  WHERE (((item.target_type = 'project'::text) AND (project.project_id IS NOT NULL)) OR ((item.target_type = 'logic_gate'::text) AND (logic_gate.logic_gate_id IS NOT NULL)))) AS actual_count) check_row
UNION ALL
 SELECT check_row.check_name,
    check_row.expected_count,
    check_row.actual_count,
    (check_row.expected_count = check_row.actual_count) AS ok
   FROM ( SELECT 'folders_have_valid_parents'::text AS check_name,
            ( SELECT count(*) AS count
                   FROM public.company_explorer_folders
                  WHERE (company_explorer_folders.parent_folder_id IS NOT NULL)) AS expected_count,
            ( SELECT count(*) AS count
                   FROM (public.company_explorer_folders child
                     JOIN public.company_explorer_folders parent ON (((parent.company_id = child.company_id) AND (parent.folder_id = child.parent_folder_id))))
                  WHERE (child.parent_folder_id IS NOT NULL)) AS actual_count) check_row;


--
-- Name: company_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_memberships (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_memberships_role_chk CHECK ((role = ANY (ARRAY['dev_admin'::text, 'company_admin'::text, 'company_manager'::text, 'company_user'::text])))
);


--
-- Name: company_user_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_user_group_members (
    company_id uuid NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_user_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_user_groups (
    company_id uuid NOT NULL,
    group_id uuid NOT NULL,
    parent_group_id uuid,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_user_groups_name_nonblank_chk CHECK ((btrim(name) <> ''::text))
);


--
-- Name: domain_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.domain_events (
    event_id uuid NOT NULL,
    company_id uuid NOT NULL,
    stream_type text NOT NULL,
    stream_id text NOT NULL,
    sequence bigint NOT NULL,
    event_type text NOT NULL,
    actor_user_id uuid,
    idempotency_key text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT domain_events_event_type_nonblank_chk CHECK ((btrim(event_type) <> ''::text)),
    CONSTRAINT domain_events_sequence_positive_chk CHECK ((sequence > 0)),
    CONSTRAINT domain_events_stream_id_nonblank_chk CHECK ((btrim(stream_id) <> ''::text)),
    CONSTRAINT domain_events_stream_type_nonblank_chk CHECK ((btrim(stream_type) <> ''::text))
);


--
-- Name: email_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_connections (
    email_connection_id uuid NOT NULL,
    company_id uuid NOT NULL,
    provider text NOT NULL,
    account_email text NOT NULL,
    grant_id text NOT NULL,
    status text DEFAULT 'connected'::text NOT NULL,
    connected_by_user_id uuid,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    connection_type text NOT NULL,
    personal_user_id uuid,
    ingestion_started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_successful_scan_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_connections_account_email_chk CHECK (((btrim(account_email) <> ''::text) AND (account_email = lower(btrim(account_email))))),
    CONSTRAINT email_connections_checkpoint_chk CHECK ((last_successful_scan_at >= ingestion_started_at)),
    CONSTRAINT email_connections_grant_id_nonblank_chk CHECK ((btrim(grant_id) <> ''::text)),
    CONSTRAINT email_connections_provider_chk CHECK ((provider = ANY (ARRAY['google'::text, 'microsoft'::text]))),
    CONSTRAINT email_connections_scope_chk CHECK ((((connection_type = 'personal'::text) AND (personal_user_id IS NOT NULL)) OR ((connection_type = 'shared'::text) AND (personal_user_id IS NULL)))),
    CONSTRAINT email_connections_status_chk CHECK ((status = ANY (ARRAY['connected'::text, 'disconnected'::text, 'reauth_required'::text, 'configuration_required'::text]))),
    CONSTRAINT email_connections_type_chk CHECK ((connection_type = ANY (ARRAY['personal'::text, 'shared'::text])))
);


--
-- Name: email_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_drafts (
    company_id uuid NOT NULL,
    draft_id text NOT NULL,
    source_email_message_id uuid,
    email_account_type text NOT NULL,
    personal_user_id uuid,
    personal_account_email text,
    shared_inbox_id uuid,
    sender_account_email text DEFAULT ''::text NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    kind text DEFAULT 'compose'::text NOT NULL,
    to_recipients text DEFAULT ''::text NOT NULL,
    cc_recipients text DEFAULT ''::text NOT NULL,
    bcc_recipients text DEFAULT ''::text NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    body_editor_html text DEFAULT ''::text NOT NULL,
    scheduled_send_timestamp timestamp with time zone,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    shared_resource_type text,
    shared_resource_id uuid,
    revision bigint DEFAULT 1 NOT NULL,
    CONSTRAINT email_drafts_account_scope_chk CHECK ((((email_account_type = 'personal_email_account'::text) AND (personal_user_id IS NOT NULL) AND (personal_account_email IS NOT NULL) AND (shared_inbox_id IS NULL)) OR ((email_account_type = 'shared_email_account'::text) AND (personal_user_id IS NULL) AND (personal_account_email IS NULL) AND (shared_inbox_id IS NOT NULL)))),
    CONSTRAINT email_drafts_account_type_chk CHECK ((email_account_type = ANY (ARRAY['personal_email_account'::text, 'shared_email_account'::text]))),
    CONSTRAINT email_drafts_draft_id_chk CHECK ((btrim(draft_id) <> ''::text)),
    CONSTRAINT email_drafts_kind_chk CHECK ((kind = ANY (ARRAY['compose'::text, 'reply'::text, 'forward'::text]))),
    CONSTRAINT email_drafts_personal_account_email_chk CHECK (((personal_account_email IS NULL) OR ((btrim(personal_account_email) <> ''::text) AND (personal_account_email = lower(btrim(personal_account_email)))))),
    CONSTRAINT email_drafts_revision_chk CHECK ((revision > 0)),
    CONSTRAINT email_drafts_sender_account_email_chk CHECK (((sender_account_email = ''::text) OR (sender_account_email = lower(btrim(sender_account_email))))),
    CONSTRAINT email_drafts_shared_owner_chk CHECK ((((shared_resource_type IS NULL) AND (shared_resource_id IS NULL)) OR ((shared_resource_type IS NOT NULL) AND (shared_resource_id IS NOT NULL) AND (shared_resource_type = ANY (ARRAY['node'::text, 'project'::text]))))),
    CONSTRAINT email_drafts_shared_reply_chk CHECK (((shared_resource_type IS NULL) OR ((kind = 'reply'::text) AND (source_email_message_id IS NOT NULL) AND (scheduled_send_timestamp IS NULL))))
);


--
-- Name: email_ingestion_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_ingestion_jobs (
    ingestion_job_id uuid NOT NULL,
    company_id uuid NOT NULL,
    email_thread_id uuid,
    status text DEFAULT 'accepted'::text NOT NULL,
    last_error text DEFAULT ''::text NOT NULL,
    completed_timestamp timestamp with time zone,
    failed_timestamp timestamp with time zone,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    email_connection_id uuid NOT NULL,
    provider_message_id text NOT NULL,
    provider_thread_id text DEFAULT ''::text NOT NULL,
    priority smallint DEFAULT 30 NOT NULL,
    provider_attempt_count integer DEFAULT 0 NOT NULL,
    attempt_token uuid,
    enqueue_source_id text DEFAULT ''::text NOT NULL,
    sqs_accepted_timestamp timestamp with time zone,
    CONSTRAINT email_ingestion_jobs_message_chk CHECK ((btrim(provider_message_id) <> ''::text)),
    CONSTRAINT email_ingestion_jobs_priority_chk CHECK (((priority >= 0) AND (priority <= 100))),
    CONSTRAINT email_ingestion_jobs_provider_attempt_chk CHECK (((provider_attempt_count >= 0) AND (provider_attempt_count <= 3))),
    CONSTRAINT email_ingestion_jobs_status_chk CHECK ((status = ANY (ARRAY['accepted'::text, 'processing'::text, 'completed'::text, 'parked'::text, 'exhausted'::text])))
);


--
-- Name: email_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_messages (
    company_id uuid NOT NULL,
    email_message_id uuid NOT NULL,
    email_thread_id uuid NOT NULL,
    provider_message_id text NOT NULL,
    message_order integer NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    sender_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    to_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    cc_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    bcc_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    reply_to_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    message_timestamp timestamp with time zone,
    rich_html_body text DEFAULT ''::text NOT NULL,
    text_fallback text DEFAULT ''::text NOT NULL,
    snippet text DEFAULT ''::text NOT NULL,
    unread boolean DEFAULT false NOT NULL,
    starred boolean DEFAULT false NOT NULL,
    folder_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    folder_id_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    attachment_metadata jsonb DEFAULT '[]'::jsonb NOT NULL,
    download_complete boolean DEFAULT false NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_messages_json_chk CHECK (((jsonb_typeof(sender_snapshot) = 'array'::text) AND (jsonb_typeof(to_snapshot) = 'array'::text) AND (jsonb_typeof(cc_snapshot) = 'array'::text) AND (jsonb_typeof(bcc_snapshot) = 'array'::text) AND (jsonb_typeof(reply_to_snapshot) = 'array'::text) AND (jsonb_typeof(folder_snapshot) = 'array'::text) AND (jsonb_typeof(folder_id_snapshot) = 'array'::text) AND (jsonb_typeof(attachment_metadata) = 'array'::text))),
    CONSTRAINT email_messages_order_chk CHECK ((message_order >= 0)),
    CONSTRAINT email_messages_provider_message_chk CHECK ((btrim(provider_message_id) <> ''::text))
);


--
-- Name: email_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_relationships (
    company_id uuid NOT NULL,
    email_relationship_id uuid NOT NULL,
    email_thread_id uuid NOT NULL,
    email_message_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    resource_textbox_id text,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_relationships_resource_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'project'::text, 'logic_gate'::text]))),
    CONSTRAINT email_relationships_textbox_id_chk CHECK (((resource_textbox_id IS NULL) OR (btrim(resource_textbox_id) <> ''::text)))
);


--
-- Name: email_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_signatures (
    company_id uuid NOT NULL,
    signature_id text NOT NULL,
    email_account_type text NOT NULL,
    personal_user_id uuid,
    personal_account_email text,
    shared_inbox_id uuid,
    email_account_email text NOT NULL,
    name text DEFAULT 'Default'::text NOT NULL,
    body_editor_html text DEFAULT ''::text NOT NULL,
    is_default boolean DEFAULT true NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_signatures_account_email_chk CHECK (((btrim(email_account_email) <> ''::text) AND (email_account_email = lower(btrim(email_account_email))))),
    CONSTRAINT email_signatures_account_scope_chk CHECK ((((email_account_type = 'personal_email_account'::text) AND (personal_user_id IS NOT NULL) AND (personal_account_email IS NOT NULL) AND (shared_inbox_id IS NULL)) OR ((email_account_type = 'shared_email_account'::text) AND (personal_user_id IS NULL) AND (personal_account_email IS NULL) AND (shared_inbox_id IS NOT NULL)))),
    CONSTRAINT email_signatures_account_type_chk CHECK ((email_account_type = ANY (ARRAY['personal_email_account'::text, 'shared_email_account'::text]))),
    CONSTRAINT email_signatures_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT email_signatures_personal_account_email_chk CHECK (((personal_account_email IS NULL) OR ((btrim(personal_account_email) <> ''::text) AND (personal_account_email = lower(btrim(personal_account_email)))))),
    CONSTRAINT email_signatures_signature_id_chk CHECK ((btrim(signature_id) <> ''::text))
);


--
-- Name: email_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_threads (
    company_id uuid NOT NULL,
    email_thread_id uuid NOT NULL,
    provider_thread_key text NOT NULL,
    provider_thread_id text DEFAULT ''::text NOT NULL,
    root_provider_message_id text NOT NULL,
    download_status text DEFAULT 'partial'::text NOT NULL,
    history_complete boolean DEFAULT false NOT NULL,
    fetched_timestamp timestamp with time zone,
    last_download_error text DEFAULT ''::text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    email_connection_id uuid NOT NULL,
    CONSTRAINT email_threads_download_status_chk CHECK (((download_status = ANY (ARRAY['partial'::text, 'downloading'::text, 'complete'::text, 'failed'::text])) AND ((NOT history_complete) OR (download_status = ANY (ARRAY['downloading'::text, 'complete'::text, 'failed'::text]))))),
    CONSTRAINT email_threads_provider_key_chk CHECK ((btrim(provider_thread_key) <> ''::text)),
    CONSTRAINT email_threads_root_message_chk CHECK ((btrim(root_provider_message_id) <> ''::text))
);


--
-- Name: huddle_explorer_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.huddle_explorer_folders (
    company_id uuid NOT NULL,
    folder_id uuid NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,
    created_date timestamp with time zone DEFAULT now() NOT NULL,
    updated_date timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT huddle_explorer_folders_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT huddle_explorer_folders_not_self_chk CHECK (((parent_folder_id IS NULL) OR (parent_folder_id <> folder_id)))
);


--
-- Name: huddle_explorer_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.huddle_explorer_items (
    company_id uuid NOT NULL,
    huddle_explorer_item_id uuid NOT NULL,
    resource_huddle_resource_id uuid NOT NULL,
    huddle_type text NOT NULL,
    parent_folder_id uuid,
    created_date timestamp with time zone DEFAULT now() NOT NULL,
    updated_date timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT huddle_explorer_items_huddle_type_chk CHECK ((huddle_type = 'huddle_logic_gate'::text))
);


--
-- Name: huddle_logic_gate_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.huddle_logic_gate_relationships (
    company_id uuid NOT NULL,
    huddle_logic_gate_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: huddle_logic_gates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.huddle_logic_gates (
    company_id uuid NOT NULL,
    huddle_logic_gate_id uuid NOT NULL,
    header text NOT NULL,
    body_json jsonb DEFAULT '{"format": "mango-tiptap-json", "document": {"type": "doc", "content": [{"type": "paragraph"}]}, "annotations": [], "schema_version": 1}'::jsonb NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    CONSTRAINT huddle_logic_gates_body_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text))),
    CONSTRAINT huddle_logic_gates_header_chk CHECK ((btrim(header) <> ''::text)),
    CONSTRAINT huddle_logic_gates_revision_chk CHECK ((revision >= 0))
);


--
-- Name: huddle_node_kpi_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.huddle_node_kpi_relationships (
    company_id uuid NOT NULL,
    huddle_node_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    kpi_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: huddle_node_logic_gate_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.huddle_node_logic_gate_relationships (
    company_id uuid NOT NULL,
    huddle_node_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: huddle_node_textbox_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.huddle_node_textbox_chats (
    company_id uuid NOT NULL,
    chat_id uuid NOT NULL,
    huddle_node_id uuid NOT NULL,
    textbox_id uuid NOT NULL,
    parent_chat_id uuid,
    selection_quote text DEFAULT ''::text NOT NULL,
    selection_start integer,
    selection_end integer,
    author_user_id uuid,
    author_display_name text DEFAULT ''::text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    edited_timestamp timestamp with time zone,
    entity_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    mentioned_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    mentioned_group_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    CONSTRAINT huddle_node_textbox_chats_entity_links_chk CHECK ((jsonb_typeof(entity_links) = 'array'::text)),
    CONSTRAINT huddle_node_textbox_chats_message_chk CHECK ((btrim(message) <> ''::text)),
    CONSTRAINT huddle_node_textbox_chats_offsets_chk CHECK ((((selection_start IS NULL) AND (selection_end IS NULL)) OR ((selection_start >= 0) AND (selection_end >= selection_start)))),
    CONSTRAINT huddle_node_textbox_chats_revision_chk CHECK ((revision > 0)),
    CONSTRAINT huddle_node_textbox_chats_timestamps_chk CHECK (((updated_timestamp >= created_timestamp) AND ((edited_timestamp IS NULL) OR (edited_timestamp >= created_timestamp)) AND ((deleted_timestamp IS NULL) OR (deleted_timestamp >= created_timestamp))))
);


--
-- Name: huddle_node_textboxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.huddle_node_textboxes (
    company_id uuid NOT NULL,
    huddle_node_id uuid NOT NULL,
    textbox_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    display_order bigint DEFAULT 0 NOT NULL,
    body_json jsonb NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    CONSTRAINT huddle_node_textboxes_body_json_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text))),
    CONSTRAINT huddle_node_textboxes_revision_chk CHECK ((revision >= 0)),
    CONSTRAINT huddle_node_textboxes_timestamps_chk CHECK (((updated_timestamp >= created_timestamp) AND ((deleted_timestamp IS NULL) OR (deleted_timestamp >= created_timestamp)))),
    CONSTRAINT huddle_node_textboxes_title_chk CHECK ((length(title) <= 500))
);


--
-- Name: huddle_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.huddle_nodes (
    company_id uuid NOT NULL,
    huddle_node_id uuid NOT NULL,
    huddle_logic_gate_id uuid NOT NULL,
    name text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT huddle_nodes_name_chk CHECK ((btrim(name) <> ''::text))
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    invitation_id uuid NOT NULL,
    company_id uuid NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    invited_by_user_id uuid NOT NULL,
    accepted_by_user_id uuid,
    expires_timestamp timestamp with time zone NOT NULL,
    accepted_timestamp timestamp with time zone,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    cognito_status text DEFAULT 'not_started'::text NOT NULL,
    cognito_error text DEFAULT ''::text NOT NULL,
    invite_email_status text DEFAULT 'not_started'::text NOT NULL,
    invite_email_error text DEFAULT ''::text NOT NULL,
    invite_email_sent_timestamp timestamp with time zone,
    CONSTRAINT invitations_cognito_status_chk CHECK ((cognito_status = ANY (ARRAY['not_started'::text, 'not_configured'::text, 'created'::text, 'resent'::text, 'existing_mango_user'::text, 'failed'::text]))),
    CONSTRAINT invitations_email_lowercase_chk CHECK ((email = lower(btrim(email)))),
    CONSTRAINT invitations_email_nonblank_chk CHECK ((btrim(email) <> ''::text)),
    CONSTRAINT invitations_invite_email_status_chk CHECK ((invite_email_status = ANY (ARRAY['not_started'::text, 'not_configured'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT invitations_role_chk CHECK ((role = ANY (ARRAY['company_admin'::text, 'company_manager'::text, 'company_user'::text]))),
    CONSTRAINT invitations_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text]))),
    CONSTRAINT invitations_token_hash_nonblank_chk CHECK ((btrim(token_hash) <> ''::text))
);


--
-- Name: kanban_board_projection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kanban_board_projection (
    company_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    node_id uuid NOT NULL,
    status text NOT NULL,
    column_id text NOT NULL,
    "position" integer NOT NULL,
    title text NOT NULL,
    priority smallint,
    is_issue boolean DEFAULT false NOT NULL,
    due_date date,
    node_created_timestamp timestamp with time zone NOT NULL,
    node_updated_timestamp timestamp with time zone NOT NULL,
    assignment_id uuid NOT NULL,
    assignment_created_timestamp timestamp with time zone NOT NULL,
    assignment_updated_timestamp timestamp with time zone NOT NULL,
    compatibility_board_id text NOT NULL,
    compatibility_card_id uuid NOT NULL,
    projection_updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    accounts jsonb DEFAULT '[]'::jsonb NOT NULL,
    requested_by_user_id uuid,
    placed_by_user_id uuid,
    status_rank smallint GENERATED ALWAYS AS (
CASE
    WHEN (lower(replace(replace(btrim(status), '_'::text, ' '::text), '-'::text, ' '::text)) = ANY (ARRAY['requested'::text, 'request'::text, 'requests'::text, 'r'::text])) THEN 0
    WHEN (lower(replace(replace(btrim(status), '_'::text, ' '::text), '-'::text, ' '::text)) = ANY (ARRAY['backlog'::text, 'backlogs'::text, 'b'::text])) THEN 1
    WHEN (lower(replace(replace(btrim(status), '_'::text, ' '::text), '-'::text, ' '::text)) = ANY (ARRAY['pending'::text, 'p'::text])) THEN 2
    WHEN (lower(replace(replace(btrim(status), '_'::text, ' '::text), '-'::text, ' '::text)) = ANY (ARRAY['in progress'::text, 'inprogress'::text, 'ip'::text])) THEN 3
    WHEN (lower(replace(replace(btrim(status), '_'::text, ' '::text), '-'::text, ' '::text)) = 'review'::text) THEN 4
    WHEN (lower(replace(replace(btrim(status), '_'::text, ' '::text), '-'::text, ' '::text)) = ANY (ARRAY['done'::text, 'd'::text])) THEN 5
    ELSE 2
END) STORED,
    CONSTRAINT kanban_board_projection_accounts_array_chk CHECK ((jsonb_typeof(accounts) = 'array'::text)),
    CONSTRAINT kanban_board_projection_priority_chk CHECK (((priority IS NULL) OR ((priority >= 1) AND (priority <= 5)))),
    CONSTRAINT kanban_board_projection_status_nonblank_chk CHECK ((btrim(status) <> ''::text)),
    CONSTRAINT kanban_board_projection_title_nonblank_chk CHECK ((btrim(title) <> ''::text))
);


--
-- Name: kpis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpis (
    company_id uuid NOT NULL,
    kpi_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    name text NOT NULL,
    body_json jsonb DEFAULT '{"format": "mango-tiptap-json", "document": {"type": "doc", "content": [{"type": "paragraph"}]}, "annotations": [], "schema_version": 1}'::jsonb NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    CONSTRAINT kpis_body_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text))),
    CONSTRAINT kpis_name_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT kpis_revision_chk CHECK ((revision >= 0))
);


--
-- Name: scorecards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scorecards (
    company_id uuid NOT NULL,
    qd_rating_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    quality_rating text,
    cost_rating text,
    delivery_rating text,
    rated_by_user_id uuid,
    rated_by_display_name text NOT NULL,
    rated_created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    rated_updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scorecards_cost_rating_chk CHECK (((cost_rating IS NULL) OR (cost_rating = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text])))),
    CONSTRAINT scorecards_delivery_rating_chk CHECK (((delivery_rating IS NULL) OR (delivery_rating = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text])))),
    CONSTRAINT scorecards_display_name_chk CHECK ((btrim(rated_by_display_name) <> ''::text)),
    CONSTRAINT scorecards_has_rating_chk CHECK (((quality_rating IS NOT NULL) OR (cost_rating IS NOT NULL) OR (delivery_rating IS NOT NULL))),
    CONSTRAINT scorecards_quality_rating_chk CHECK (((quality_rating IS NULL) OR (quality_rating = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text])))),
    CONSTRAINT scorecards_timestamps_chk CHECK ((rated_updated_timestamp >= rated_created_timestamp))
);


--
-- Name: logic_gate_textboxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logic_gate_textboxes (
    company_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    textbox_id text NOT NULL,
    body_json jsonb NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    title text DEFAULT ''::text NOT NULL,
    email_message_id text DEFAULT ''::text NOT NULL,
    email_accent text DEFAULT ''::text NOT NULL,
    metadata_revision bigint DEFAULT 1 NOT NULL,
    CONSTRAINT logic_gate_textboxes_body_json_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text))),
    CONSTRAINT logic_gate_textboxes_email_accent_chk CHECK (((email_accent = ''::text) OR (email_accent ~ '^#[0-9A-Fa-f]{6}$'::text))),
    CONSTRAINT logic_gate_textboxes_id_chk CHECK ((btrim(textbox_id) <> ''::text)),
    CONSTRAINT logic_gate_textboxes_metadata_revision_chk CHECK ((metadata_revision > 0)),
    CONSTRAINT logic_gate_textboxes_revision_chk CHECK ((revision >= 0)),
    CONSTRAINT logic_gate_textboxes_timestamps_chk CHECK (((updated_timestamp >= created_timestamp) AND ((deleted_timestamp IS NULL) OR (deleted_timestamp >= created_timestamp)))),
    CONSTRAINT logic_gate_textboxes_title_chk CHECK ((length(title) <= 500))
);


--
-- Name: logic_gate_textboxes_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logic_gate_textboxes_history (
    company_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    textbox_id text NOT NULL,
    batch_id uuid NOT NULL,
    body_json jsonb NOT NULL,
    saved_by_user_id uuid,
    saved_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT logic_gate_textboxes_history_body_json_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text))),
    CONSTRAINT logic_gate_textboxes_history_id_chk CHECK ((btrim(textbox_id) <> ''::text))
);


--
-- Name: logic_gate_work_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logic_gate_work_versions (
    company_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    board_id text GENERATED ALWAYS AS (('logic-gate:'::text || (logic_gate_id)::text)) STORED,
    version bigint DEFAULT 1 NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT logic_gate_work_versions_version_positive_chk CHECK ((version > 0))
);


--
-- Name: node_account_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_account_assignments (
    company_id uuid NOT NULL,
    node_id uuid NOT NULL,
    account_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: node_logic_gate_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_logic_gate_assignments (
    assignment_id uuid NOT NULL,
    company_id uuid NOT NULL,
    node_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    status_key text NOT NULL,
    column_id text NOT NULL,
    is_issue boolean DEFAULT false NOT NULL,
    "position" integer NOT NULL,
    compatibility_board_id text NOT NULL,
    compatibility_card_id uuid NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    requested_by_user_id uuid,
    placed_by_user_id uuid,
    CONSTRAINT node_logic_gate_assignments_status_key_chk CHECK ((btrim(status_key) <> ''::text)),
    CONSTRAINT node_logic_gate_assignments_version_positive_chk CHECK ((version > 0))
);


--
-- Name: node_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_relationships (
    company_id uuid NOT NULL,
    node_relationship_id uuid NOT NULL,
    node_id_a uuid NOT NULL,
    node_id_b uuid NOT NULL,
    a_position public.node_relationship_position NOT NULL,
    b_position public.node_relationship_position NOT NULL,
    created_timestamp timestamp with time zone NOT NULL,
    CONSTRAINT node_relationships_not_self_chk CHECK ((node_id_a <> node_id_b)),
    CONSTRAINT node_relationships_position_pair_chk CHECK ((((a_position = 'Parent'::public.node_relationship_position) AND (b_position = 'Child'::public.node_relationship_position)) OR ((a_position = 'Child'::public.node_relationship_position) AND (b_position = 'Parent'::public.node_relationship_position)) OR ((a_position = 'Peer'::public.node_relationship_position) AND (b_position = 'Peer'::public.node_relationship_position))))
);


--
-- Name: node_textbox_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_textbox_chats (
    company_id uuid NOT NULL,
    chat_id uuid NOT NULL,
    node_id uuid NOT NULL,
    textbox_id uuid NOT NULL,
    parent_chat_id uuid,
    selection_source text DEFAULT 'text'::text NOT NULL,
    selection_textbox_id uuid,
    selection_email_message_id uuid,
    selection_quote text DEFAULT ''::text NOT NULL,
    selection_start integer,
    selection_end integer,
    author_user_id uuid,
    author_display_name text DEFAULT ''::text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    edited_timestamp timestamp with time zone,
    entity_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    mentioned_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    mentioned_group_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    CONSTRAINT node_textbox_chats_entity_links_chk CHECK ((jsonb_typeof(entity_links) = 'array'::text)),
    CONSTRAINT node_textbox_chats_revision_chk CHECK ((revision > 0)),
    CONSTRAINT node_textbox_chats_selection_offsets_chk CHECK ((((selection_start IS NULL) AND (selection_end IS NULL)) OR ((selection_start >= 0) AND (selection_end >= selection_start)))),
    CONSTRAINT node_textbox_chats_selection_source_chk CHECK ((selection_source = ANY (ARRAY['text'::text, 'email'::text]))),
    CONSTRAINT node_textbox_chats_selection_target_chk CHECK ((((selection_source = 'text'::text) AND (selection_email_message_id IS NULL)) OR ((selection_source = 'email'::text) AND (selection_email_message_id IS NOT NULL)))),
    CONSTRAINT node_textbox_chats_timestamps_chk CHECK (((updated_timestamp >= created_timestamp) AND ((edited_timestamp IS NULL) OR (edited_timestamp >= created_timestamp)) AND ((deleted_timestamp IS NULL) OR (deleted_timestamp >= created_timestamp))))
);


--
-- Name: node_textboxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_textboxes (
    company_id uuid NOT NULL,
    node_id uuid NOT NULL,
    textbox_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    display_order bigint DEFAULT 0 NOT NULL,
    body_json jsonb NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    color text,
    CONSTRAINT node_textboxes_body_json_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text))),
    CONSTRAINT node_textboxes_color_chk CHECK (((color IS NULL) OR (color = ANY (ARRAY['#0EA5E9'::text, '#14B8A6'::text, '#8B5CF6'::text, '#F59E0B'::text, '#22C55E'::text, '#6366F1'::text, '#06B6D4'::text, '#84CC16'::text, '#A855F7'::text, '#10B981'::text, '#EAB308'::text, '#3B82F6'::text])))),
    CONSTRAINT node_textboxes_revision_chk CHECK ((revision >= 0)),
    CONSTRAINT node_textboxes_timestamps_chk CHECK (((updated_timestamp >= created_timestamp) AND ((deleted_timestamp IS NULL) OR (deleted_timestamp >= created_timestamp)))),
    CONSTRAINT node_textboxes_title_chk CHECK ((length(title) <= 500))
);


--
-- Name: node_textboxes_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_textboxes_history (
    company_id uuid NOT NULL,
    node_id uuid NOT NULL,
    textbox_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    body_json jsonb NOT NULL,
    display_order bigint DEFAULT 0 NOT NULL,
    saved_by_user_id uuid,
    saved_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT node_textboxes_history_body_json_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text)))
);


--
-- Name: node_timeline_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_timeline_events (
    company_id uuid NOT NULL,
    event_id uuid NOT NULL,
    node_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_user_id uuid,
    actor_display_name text NOT NULL,
    from_logic_gate_id uuid,
    from_logic_gate_name text DEFAULT ''::text NOT NULL,
    to_logic_gate_id uuid,
    to_logic_gate_name text DEFAULT ''::text NOT NULL,
    idempotency_key text DEFAULT ''::text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid,
    project_name text DEFAULT ''::text NOT NULL,
    CONSTRAINT node_timeline_events_actor_name_chk CHECK ((btrim(actor_display_name) <> ''::text)),
    CONSTRAINT node_timeline_events_payload_chk CHECK ((((event_type = 'logic_gate_transfer'::text) AND (from_logic_gate_id IS NOT NULL) AND (to_logic_gate_id IS NOT NULL) AND (from_logic_gate_id <> to_logic_gate_id) AND (btrim(from_logic_gate_name) <> ''::text) AND (btrim(to_logic_gate_name) <> ''::text) AND (project_id IS NULL) AND (btrim(project_name) = ''::text)) OR ((event_type = 'project_assignment'::text) AND (from_logic_gate_id IS NULL) AND (btrim(from_logic_gate_name) = ''::text) AND (to_logic_gate_id IS NULL) AND (btrim(to_logic_gate_name) = ''::text) AND (project_id IS NOT NULL) AND (btrim(project_name) <> ''::text)) OR ((event_type = 'verification_request'::text) AND (from_logic_gate_id IS NULL) AND (btrim(from_logic_gate_name) = ''::text) AND (to_logic_gate_id IS NULL) AND (btrim(to_logic_gate_name) = ''::text) AND (project_id IS NULL) AND (btrim(project_name) = ''::text)))),
    CONSTRAINT node_timeline_events_type_chk CHECK ((event_type = ANY (ARRAY['logic_gate_transfer'::text, 'project_assignment'::text, 'verification_request'::text])))
);


--
-- Name: node_timeline_verification_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_timeline_verification_recipients (
    company_id uuid NOT NULL,
    node_id uuid NOT NULL,
    event_id uuid NOT NULL,
    user_id uuid NOT NULL,
    user_display_name text NOT NULL,
    completed_timestamp timestamp with time zone,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT node_timeline_verification_recipients_name_chk CHECK ((btrim(user_display_name) <> ''::text))
);


--
-- Name: node_view_user_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_view_user_versions (
    company_id uuid NOT NULL,
    node_id uuid NOT NULL,
    user_id uuid NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT node_view_user_versions_version_positive_chk CHECK ((version > 0))
);


--
-- Name: node_view_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_view_versions (
    company_id uuid NOT NULL,
    node_id uuid NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT node_view_versions_version_positive_chk CHECK ((version > 0))
);


--
-- Name: nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nodes (
    company_id uuid NOT NULL,
    node_id uuid NOT NULL,
    name text NOT NULL,
    created_timestamp timestamp with time zone NOT NULL,
    due_date date,
    priority smallint,
    status text,
    default_access text DEFAULT 'edit'::text NOT NULL,
    CONSTRAINT nodes_default_access_chk CHECK ((default_access = ANY (ARRAY['edit'::text, 'no_access'::text]))),
    CONSTRAINT nodes_priority_chk CHECK (((priority IS NULL) OR ((priority >= 1) AND (priority <= 5))))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    notification_id uuid NOT NULL,
    company_id uuid,
    recipient_user_id uuid NOT NULL,
    actor_user_id uuid,
    notification_type text NOT NULL,
    source_event_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    title text NOT NULL,
    body_preview text DEFAULT ''::text NOT NULL,
    read_timestamp timestamp with time zone,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    surface text DEFAULT ''::text NOT NULL,
    role text DEFAULT ''::text NOT NULL,
    logic_gate_id text DEFAULT ''::text NOT NULL,
    node_id text DEFAULT ''::text NOT NULL,
    information_id text DEFAULT ''::text NOT NULL,
    priority smallint,
    CONSTRAINT notifications_entity_id_nonblank_chk CHECK ((btrim(entity_id) <> ''::text)),
    CONSTRAINT notifications_entity_type_nonblank_chk CHECK ((btrim(entity_type) <> ''::text)),
    CONSTRAINT notifications_priority_chk CHECK (((priority IS NULL) OR ((priority >= 1) AND (priority <= 5)))),
    CONSTRAINT notifications_role_chk CHECK (((role = ''::text) OR (role = ANY (ARRAY['responsible'::text, 'accountable'::text, 'consulted'::text, 'informed'::text, 'other'::text])))),
    CONSTRAINT notifications_surface_chk CHECK (((surface = ''::text) OR (surface = ANY (ARRAY['r_inbox'::text, 'aci_inbox'::text, 'my_triage'::text, 'shared_triage'::text])))),
    CONSTRAINT notifications_title_nonblank_chk CHECK ((btrim(title) <> ''::text)),
    CONSTRAINT notifications_type_nonblank_chk CHECK ((btrim(notification_type) <> ''::text))
);


--
-- Name: pin_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pin_folders (
    folder_id uuid NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pin_folders_name_nonblank_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT pin_folders_not_self_parent_chk CHECK ((parent_folder_id IS DISTINCT FROM folder_id))
);


--
-- Name: pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pins (
    pin_id uuid NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    parent_folder_id uuid,
    CONSTRAINT pins_name_nonblank_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT pins_resource_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'logic_gate'::text, 'project'::text, 'huddle_logic_gate'::text, 'huddle_node'::text])))
);


--
-- Name: process_map_actual_size_layout_recovery_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_map_actual_size_layout_recovery_placements (
    company_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    placement_incarnation_token uuid NOT NULL,
    map_parent_folder_id uuid,
    before_grid_x integer NOT NULL,
    before_grid_y integer NOT NULL,
    before_grid_width integer NOT NULL,
    before_grid_height integer NOT NULL,
    before_revision bigint NOT NULL,
    before_created_timestamp timestamp with time zone NOT NULL,
    before_updated_timestamp timestamp with time zone NOT NULL,
    expected_grid_x integer NOT NULL,
    expected_grid_y integer NOT NULL,
    expected_grid_width integer NOT NULL,
    expected_grid_height integer NOT NULL,
    expected_revision bigint NOT NULL,
    expected_created_timestamp timestamp with time zone NOT NULL,
    expected_updated_timestamp timestamp with time zone NOT NULL,
    changed_by_migration boolean NOT NULL
);


--
-- Name: process_map_actual_size_layout_recovery_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_map_actual_size_layout_recovery_runs (
    company_id uuid NOT NULL,
    recovery_key text NOT NULL,
    format_version integer NOT NULL,
    status text NOT NULL,
    marker_event_id uuid NOT NULL,
    marker_sequence bigint NOT NULL,
    marker_created_timestamp timestamp with time zone NOT NULL,
    placement_count bigint NOT NULL,
    changed_placement_count bigint NOT NULL,
    placement_checksum text NOT NULL,
    created_timestamp timestamp with time zone NOT NULL,
    rollback_event_id uuid,
    rollback_sequence bigint,
    rolled_back_timestamp timestamp with time zone,
    CONSTRAINT pm_actual_size_recovery_runs_counts_chk CHECK (((placement_count >= 0) AND (changed_placement_count >= 0) AND (changed_placement_count <= placement_count))),
    CONSTRAINT pm_actual_size_recovery_runs_format_chk CHECK ((format_version = 1)),
    CONSTRAINT pm_actual_size_recovery_runs_rollback_state_chk CHECK ((((status = 'applied'::text) AND (rollback_event_id IS NULL) AND (rollback_sequence IS NULL) AND (rolled_back_timestamp IS NULL)) OR ((status = 'rolled_back'::text) AND (rollback_event_id IS NOT NULL) AND (rollback_sequence IS NOT NULL) AND (rolled_back_timestamp IS NOT NULL)))),
    CONSTRAINT pm_actual_size_recovery_runs_status_chk CHECK ((status = ANY (ARRAY['applied'::text, 'rolled_back'::text])))
);


--
-- Name: process_map_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_map_placements (
    company_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    placement_incarnation_token uuid DEFAULT gen_random_uuid() NOT NULL,
    map_parent_folder_id uuid,
    grid_x integer NOT NULL,
    grid_y integer NOT NULL,
    grid_width integer DEFAULT 7 NOT NULL,
    grid_height integer DEFAULT 5 NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT process_map_placements_parent_not_self_chk CHECK (((resource_type <> 'company_explorer_folder'::text) OR (map_parent_folder_id IS NULL) OR (map_parent_folder_id <> resource_id))),
    CONSTRAINT process_map_placements_resource_type_chk CHECK ((resource_type = ANY (ARRAY['company_explorer_folder'::text, 'logic_gate'::text]))),
    CONSTRAINT process_map_placements_revision_positive_chk CHECK ((revision > 0)),
    CONSTRAINT process_map_placements_geometry_chk CHECK (((grid_x >= '-1000000000'::integer) AND (grid_y >= '-1000000000'::integer) AND (grid_width > 0) AND (grid_width <= 1000000) AND (grid_height > 0) AND (grid_height <= 1000000) AND (((grid_x)::bigint + grid_width) <= 1000000000) AND (((grid_y)::bigint + grid_height) <= 1000000000))),
    CONSTRAINT process_map_placements_timestamps_chk CHECK ((updated_timestamp >= created_timestamp))
);


--
-- Name: process_map_traces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_map_traces (
    company_id uuid NOT NULL,
    resource_operational_relationship_id uuid NOT NULL,
    route_points jsonb DEFAULT '[]'::jsonb NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT process_map_traces_revision_positive_chk CHECK ((revision > 0)),
    CONSTRAINT process_map_traces_route_points_chk CHECK (public.mangorts_process_map_route_points_valid(route_points)),
    CONSTRAINT process_map_traces_timestamps_chk CHECK ((updated_timestamp >= created_timestamp))
);


--
-- Name: project_account_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_account_assignments (
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    account_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_critical_path_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_critical_path_steps (
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    step_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    relationship_id uuid,
    due_date date,
    owner_type text DEFAULT ''::text NOT NULL,
    owner_id uuid,
    "position" integer DEFAULT 0 NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_critical_path_owner_chk CHECK ((((owner_type = ''::text) AND (owner_id IS NULL)) OR ((owner_type = ANY (ARRAY['user'::text, 'group'::text])) AND (owner_id IS NOT NULL))))
);


--
-- Name: project_management_timeline_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_management_timeline_items (
    company_id uuid NOT NULL,
    item_id uuid NOT NULL,
    user_id uuid NOT NULL,
    node_id uuid,
    logic_gate_id uuid,
    start_date date NOT NULL,
    duration_days smallint NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_by_user_id uuid,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_management_timeline_duration_chk CHECK (((duration_days >= 1) AND (duration_days <= 90))),
    CONSTRAINT project_management_timeline_item_target_chk CHECK ((((node_id IS NOT NULL) AND (logic_gate_id IS NULL)) OR ((node_id IS NULL) AND (logic_gate_id IS NOT NULL))))
);


--
-- Name: project_management_timeline_projection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_management_timeline_projection (
    company_id uuid NOT NULL,
    item_id uuid NOT NULL,
    user_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    node_id uuid,
    logic_gate_id uuid,
    display_title text NOT NULL,
    status text,
    due_date date,
    priority smallint,
    start_date date NOT NULL,
    end_date date NOT NULL,
    duration_days smallint NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    resource_created_timestamp timestamp with time zone NOT NULL,
    timeline_created_timestamp timestamp with time zone NOT NULL,
    timeline_updated_timestamp timestamp with time zone NOT NULL,
    projection_updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    accounts jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT project_management_timeline_projection_accounts_array_chk CHECK ((jsonb_typeof(accounts) = 'array'::text)),
    CONSTRAINT project_management_timeline_projection_duration_chk CHECK (((duration_days >= 1) AND (duration_days <= 90))),
    CONSTRAINT project_management_timeline_projection_resource_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'logic_gate'::text]))),
    CONSTRAINT project_management_timeline_projection_target_chk CHECK ((((resource_type = 'node'::text) AND (node_id IS NOT NULL) AND (logic_gate_id IS NULL) AND (resource_id = node_id)) OR ((resource_type = 'logic_gate'::text) AND (logic_gate_id IS NOT NULL) AND (node_id IS NULL) AND (resource_id = logic_gate_id)))),
    CONSTRAINT project_management_timeline_projection_title_chk CHECK ((btrim(display_title) <> ''::text))
);


--
-- Name: project_relationship_projection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_relationship_projection (
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    relationship_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    logic_gate_id uuid,
    node_id uuid,
    display_title text NOT NULL,
    status text,
    "position" integer DEFAULT 0 NOT NULL,
    resource_created_timestamp timestamp with time zone NOT NULL,
    relationship_created_timestamp timestamp with time zone NOT NULL,
    relationship_updated_timestamp timestamp with time zone NOT NULL,
    projection_updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    assignment_id uuid,
    created_from_email boolean DEFAULT false NOT NULL,
    CONSTRAINT project_relationship_projection_resource_type_chk CHECK ((resource_type = ANY (ARRAY['logic_gate'::text, 'node'::text]))),
    CONSTRAINT project_relationship_projection_target_chk CHECK ((((resource_type = 'logic_gate'::text) AND (logic_gate_id IS NOT NULL) AND (node_id IS NULL) AND (assignment_id IS NULL) AND (resource_id = logic_gate_id)) OR ((resource_type = 'node'::text) AND (node_id IS NOT NULL) AND (resource_id = node_id)))),
    CONSTRAINT project_relationship_projection_title_chk CHECK ((btrim(display_title) <> ''::text))
);


--
-- Name: project_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_relationships (
    company_id uuid NOT NULL,
    relationship_id uuid NOT NULL,
    project_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_relationships_resource_type_chk CHECK ((resource_type = ANY (ARRAY['logic_gate'::text, 'node'::text])))
);


--
-- Name: project_team_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_team_assignments (
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    team_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_textbox_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_textbox_chats (
    company_id uuid NOT NULL,
    chat_id uuid NOT NULL,
    project_id uuid NOT NULL,
    textbox_id text NOT NULL,
    parent_chat_id uuid,
    selection_source text DEFAULT 'text'::text NOT NULL,
    selection_textbox_id text,
    selection_email_message_id uuid,
    selection_quote text DEFAULT ''::text NOT NULL,
    selection_start integer,
    selection_end integer,
    author_user_id uuid,
    author_display_name text DEFAULT ''::text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    edited_timestamp timestamp with time zone,
    entity_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    mentioned_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    mentioned_group_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    CONSTRAINT project_textbox_chats_entity_links_chk CHECK ((jsonb_typeof(entity_links) = 'array'::text)),
    CONSTRAINT project_textbox_chats_revision_chk CHECK ((revision > 0)),
    CONSTRAINT project_textbox_chats_selection_offsets_chk CHECK ((((selection_start IS NULL) AND (selection_end IS NULL)) OR ((selection_start >= 0) AND (selection_end >= selection_start)))),
    CONSTRAINT project_textbox_chats_selection_source_chk CHECK ((selection_source = ANY (ARRAY['text'::text, 'email'::text]))),
    CONSTRAINT project_textbox_chats_selection_target_chk CHECK ((((selection_source = 'text'::text) AND (selection_email_message_id IS NULL)) OR ((selection_source = 'email'::text) AND (selection_email_message_id IS NOT NULL)))),
    CONSTRAINT project_textbox_chats_textbox_id_chk CHECK ((btrim(textbox_id) <> ''::text)),
    CONSTRAINT project_textbox_chats_timestamps_chk CHECK (((updated_timestamp >= created_timestamp) AND ((edited_timestamp IS NULL) OR (edited_timestamp >= created_timestamp)) AND ((deleted_timestamp IS NULL) OR (deleted_timestamp >= created_timestamp))))
);


--
-- Name: project_textboxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_textboxes (
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    textbox_id text NOT NULL,
    body_json jsonb NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    display_order bigint DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    deleted_timestamp timestamp with time zone,
    title text DEFAULT ''::text NOT NULL,
    metadata_revision bigint DEFAULT 1 NOT NULL,
    color text,
    CONSTRAINT project_textboxes_body_json_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text))),
    CONSTRAINT project_textboxes_color_chk CHECK (((color IS NULL) OR (color = ANY (ARRAY['#0EA5E9'::text, '#14B8A6'::text, '#8B5CF6'::text, '#F59E0B'::text, '#22C55E'::text, '#6366F1'::text, '#06B6D4'::text, '#84CC16'::text, '#A855F7'::text, '#10B981'::text, '#EAB308'::text, '#3B82F6'::text])))),
    CONSTRAINT project_textboxes_id_chk CHECK ((btrim(textbox_id) <> ''::text)),
    CONSTRAINT project_textboxes_metadata_revision_chk CHECK ((metadata_revision > 0)),
    CONSTRAINT project_textboxes_revision_chk CHECK ((revision >= 0)),
    CONSTRAINT project_textboxes_timestamps_chk CHECK (((updated_timestamp >= created_timestamp) AND ((deleted_timestamp IS NULL) OR (deleted_timestamp >= created_timestamp)))),
    CONSTRAINT project_textboxes_title_chk CHECK ((length(title) <= 500))
);


--
-- Name: project_textboxes_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_textboxes_history (
    company_id uuid NOT NULL,
    project_id uuid NOT NULL,
    textbox_id text NOT NULL,
    batch_id uuid NOT NULL,
    body_json jsonb NOT NULL,
    display_order bigint DEFAULT 0 NOT NULL,
    saved_by_user_id uuid,
    saved_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_textboxes_history_body_json_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text))),
    CONSTRAINT project_textboxes_history_id_chk CHECK ((btrim(textbox_id) <> ''::text))
);


--
-- Name: raci_tabs_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raci_tabs_folders (
    company_id uuid NOT NULL,
    folder_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT raci_tabs_folders_name_nonblank_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT raci_tabs_folders_not_self_parent_chk CHECK ((parent_folder_id IS DISTINCT FROM folder_id)),
    CONSTRAINT raci_tabs_folders_role_chk CHECK ((role = ANY (ARRAY['responsible'::text, 'accountable'::text, 'consulted'::text, 'informed'::text])))
);


--
-- Name: raci_tabs_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raci_tabs_items (
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    logic_gate_id uuid NOT NULL,
    folder_id uuid,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT raci_tabs_items_name_nonblank_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT raci_tabs_items_role_chk CHECK ((role = ANY (ARRAY['responsible'::text, 'accountable'::text, 'consulted'::text, 'informed'::text])))
);


--
-- Name: entity_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_relationships (
    company_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_relationships_resource_type_chk CHECK ((resource_type = ANY (ARRAY['huddle_node'::text, 'huddle_logic_gate'::text])))
);


--
-- Name: entity_field_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_field_types (
    company_id uuid NOT NULL,
    entity_field_type_id uuid NOT NULL,
    entity_type_id uuid NOT NULL,
    entity_folder_id uuid,
    name character varying(200) NOT NULL,
    field_type text NOT NULL,
    system_key text,
    config_jsonb jsonb DEFAULT '{}'::jsonb NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_field_types_config_jsonb_chk CHECK (public.mangorts_entity_field_type_config_valid(field_type, config_jsonb)),
    CONSTRAINT entity_field_types_field_type_chk CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'date'::text, 'boolean'::text, 'choice'::text, 'color'::text, 'person'::text]))),
    CONSTRAINT entity_field_types_name_nonblank_chk CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT entity_field_types_position_chk CHECK (("position" >= 0)),
    CONSTRAINT entity_field_types_system_key_chk CHECK (((system_key IS NULL) OR (system_key ~ '^[a-z][a-z0-9_]*$'::text)))
);


--
-- Name: entity_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_fields (
    company_id uuid NOT NULL,
    entity_field_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    entity_field_type_id uuid,
    name character varying(200) NOT NULL,
    field_type text NOT NULL,
    value_jsonb jsonb,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_fields_field_type_chk CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'date'::text, 'boolean'::text, 'choice'::text, 'color'::text, 'person'::text]))),
    CONSTRAINT entity_fields_name_nonblank_chk CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT entity_fields_position_chk CHECK (("position" >= 0)),
    CONSTRAINT entity_fields_value_shape_chk CHECK (((value_jsonb IS NULL) OR ((field_type = ANY (ARRAY['text'::text, 'date'::text, 'choice'::text, 'color'::text])) AND (jsonb_typeof(value_jsonb) = 'string'::text)) OR ((field_type = 'person'::text) AND (jsonb_typeof(value_jsonb) = 'string'::text) AND ((value_jsonb #>> '{}'::text[]) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)) OR ((field_type = 'number'::text) AND (jsonb_typeof(value_jsonb) = 'number'::text)) OR ((field_type = 'boolean'::text) AND (jsonb_typeof(value_jsonb) = 'boolean'::text))))
);


--
-- Name: entity_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_folders (
    company_id uuid NOT NULL,
    entity_folder_id uuid NOT NULL,
    entity_type_id uuid NOT NULL,
    parent_entity_folder_id uuid,
    name character varying(200) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_folders_name_nonblank_chk CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT entity_folders_not_self_parent_chk CHECK (((parent_entity_folder_id IS NULL) OR (parent_entity_folder_id <> entity_folder_id))),
    CONSTRAINT entity_folders_position_chk CHECK (("position" >= 0))
);


--
-- Name: entity_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_types (
    company_id uuid NOT NULL,
    entity_type_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    system_key text,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_types_name_nonblank_chk CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT entity_types_system_key_chk CHECK (((system_key IS NULL) OR (system_key ~ '^[a-z][a-z0-9_]*$'::text)))
);


--
-- Name: entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entities (
    company_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    entity_type_id uuid NOT NULL,
    entity_folder_id uuid,
    name character varying(200) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    body_json jsonb DEFAULT '{"format": "mango-tiptap-json", "document": {"type": "doc", "content": [{"type": "paragraph"}]}, "annotations": [], "schema_version": 1}'::jsonb NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    created_by_user_id uuid,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entities_body_json_chk CHECK ((((body_json ->> 'format'::text) = 'mango-tiptap-json'::text) AND ((body_json ->> 'schema_version'::text) = '1'::text) AND (((body_json -> 'document'::text) ->> 'type'::text) = 'doc'::text) AND (jsonb_typeof((body_json -> 'annotations'::text)) = 'array'::text))),
    CONSTRAINT entities_name_nonblank_chk CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT entities_position_chk CHECK (("position" >= 0)),
    CONSTRAINT entities_revision_chk CHECK ((revision >= 0))
);


--
-- Name: realtime_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.realtime_outbox (
    outbox_sequence bigint NOT NULL,
    event_id uuid NOT NULL,
    company_id uuid NOT NULL,
    scope text NOT NULL,
    event_type text NOT NULL,
    resource_type text,
    resource_id text,
    permission text,
    resource_revision bigint DEFAULT 0 NOT NULL,
    payload jsonb NOT NULL,
    allowed_user_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    audience_restricted boolean DEFAULT false NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    claim_token uuid,
    claim_expires_at timestamp with time zone,
    published_timestamp timestamp with time zone,
    last_error_category text,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT realtime_outbox_allowed_user_ids_array_chk CHECK ((jsonb_typeof(allowed_user_ids) = 'array'::text)),
    CONSTRAINT realtime_outbox_attempt_count_chk CHECK ((attempt_count >= 0)),
    CONSTRAINT realtime_outbox_event_type_nonblank_chk CHECK ((btrim(event_type) <> ''::text)),
    CONSTRAINT realtime_outbox_payload_size_chk CHECK ((pg_column_size(payload) <= 262144)),
    CONSTRAINT realtime_outbox_resource_revision_chk CHECK ((resource_revision >= 0)),
    CONSTRAINT realtime_outbox_scope_nonblank_chk CHECK (((btrim(scope) <> ''::text) AND (octet_length(scope) <= 384)))
);


--
-- Name: realtime_outbox_outbox_sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.realtime_outbox_outbox_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: realtime_outbox_outbox_sequence_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.realtime_outbox_outbox_sequence_seq OWNED BY public.realtime_outbox.outbox_sequence;


--
-- Name: recycle_bin_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recycle_bin_items (
    company_id uuid NOT NULL,
    recycle_bin_item_id uuid NOT NULL,
    object_kind text NOT NULL,
    object_id text NOT NULL,
    object_label text NOT NULL,
    object_folder_kind text,
    restore_payload jsonb NOT NULL,
    deleted_by_user_id uuid,
    deleted_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recycle_bin_items_folder_kind_chk CHECK (((object_folder_kind IS NULL) OR (object_folder_kind = ANY (ARRAY['node'::text, 'logic_gate'::text, 'project'::text])))),
    CONSTRAINT recycle_bin_items_kind_chk CHECK ((object_kind = ANY (ARRAY['folder'::text, 'node'::text, 'logic_gate'::text, 'project'::text, 'kanban'::text, 'kpi'::text, 'huddle_logic_gate'::text, 'huddle_node'::text, 'huddle_explorer_folder'::text, 'huddle_explorer_item'::text]))),
    CONSTRAINT recycle_bin_items_object_id_nonblank_chk CHECK ((btrim(object_id) <> ''::text)),
    CONSTRAINT recycle_bin_items_object_label_nonblank_chk CHECK ((btrim(object_label) <> ''::text))
);


--
-- Name: resource_gvic_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_gvic_assignments (
    company_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    role text NOT NULL,
    principal_type text NOT NULL,
    principal_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_gvic_assignments_raci_role_chk CHECK ((role = ANY (ARRAY['responsible'::text, 'accountable'::text, 'consulted'::text, 'informed'::text]))),
    CONSTRAINT resource_gvic_assignments_resource_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'logic_gate'::text, 'project'::text, 'shared_triage_folder'::text, 'shared_inbox'::text, 'huddle_logic_gate'::text, 'huddle_node'::text]))),
    CONSTRAINT resource_gvic_assignments_v2_staging_principal_type_chk CHECK ((principal_type = ANY (ARRAY['user'::text, 'group'::text])))
);


--
-- Name: resource_gvic_change_sequence; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.resource_gvic_change_sequence
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: resource_gvic_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_gvic_settings (
    company_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    assignment_mode text NOT NULL,
    customized_sequence bigint,
    parent_link_sequence bigint NOT NULL,
    descendant_reset_sequence bigint DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_gvic_settings_assignment_mode_chk CHECK ((assignment_mode = ANY (ARRAY['inherited'::text, 'customized'::text]))),
    CONSTRAINT resource_gvic_settings_mode_shape_chk CHECK ((((assignment_mode = 'inherited'::text) AND (customized_sequence IS NULL)) OR ((assignment_mode = 'customized'::text) AND (customized_sequence IS NOT NULL) AND (customized_sequence > 0)))),
    CONSTRAINT resource_gvic_settings_parent_sequence_chk CHECK ((parent_link_sequence >= 0)),
    CONSTRAINT resource_gvic_settings_reset_sequence_chk CHECK ((descendant_reset_sequence >= 0)),
    CONSTRAINT resource_gvic_settings_resource_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'logic_gate'::text, 'project'::text, 'company_explorer_folder'::text, 'shared_inbox_folder'::text, 'shared_inbox'::text, 'huddle_logic_gate'::text, 'huddle_node'::text])))
);


--
-- Name: resource_operational_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_operational_relationships (
    company_id uuid NOT NULL,
    resource_operational_relationship_id uuid NOT NULL,
    source_resource_type text NOT NULL,
    source_resource_id uuid NOT NULL,
    target_resource_type text NOT NULL,
    target_resource_id uuid NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_operational_relationships_not_self_chk CHECK (((source_resource_type <> target_resource_type) OR (source_resource_id <> target_resource_id))),
    CONSTRAINT resource_operational_relationships_source_type_chk CHECK ((source_resource_type = ANY (ARRAY['company_explorer_folder'::text, 'logic_gate'::text]))),
    CONSTRAINT resource_operational_relationships_target_type_chk CHECK ((target_resource_type = ANY (ARRAY['company_explorer_folder'::text, 'logic_gate'::text])))
);


--
-- Name: resource_permission_change_sequence; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.resource_permission_change_sequence
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: resource_permission_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_permission_settings (
    company_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    permission_mode text NOT NULL,
    default_access text,
    customized_sequence bigint,
    parent_link_sequence bigint NOT NULL,
    descendant_reset_sequence bigint DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_permission_settings_default_access_chk CHECK (((default_access IS NULL) OR (default_access = ANY (ARRAY['edit'::text, 'no_access'::text])))),
    CONSTRAINT resource_permission_settings_mode_shape_chk CHECK ((((permission_mode = 'inherited'::text) AND (customized_sequence IS NULL) AND (default_access IS NULL)) OR ((permission_mode = 'customized'::text) AND (customized_sequence IS NOT NULL) AND (customized_sequence > 0) AND (default_access = ANY (ARRAY['edit'::text, 'no_access'::text]))))),
    CONSTRAINT resource_permission_settings_parent_sequence_chk CHECK ((parent_link_sequence >= 0)),
    CONSTRAINT resource_permission_settings_permission_mode_chk CHECK ((permission_mode = ANY (ARRAY['inherited'::text, 'customized'::text]))),
    CONSTRAINT resource_permission_settings_reset_sequence_chk CHECK ((descendant_reset_sequence >= 0)),
    CONSTRAINT resource_permission_settings_resource_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'logic_gate'::text, 'project'::text, 'company_explorer_folder'::text, 'shared_inbox_folder'::text, 'shared_inbox'::text, 'huddle_logic_gate'::text, 'huddle_node'::text])))
);


--
-- Name: resource_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_permissions (
    company_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    access_level text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_permissions_resource_type_chk CHECK ((resource_type = ANY (ARRAY['node'::text, 'logic_gate'::text, 'project'::text, 'company_explorer_folder'::text, 'shared_inbox_folder'::text, 'shared_inbox'::text, 'huddle_logic_gate'::text, 'huddle_node'::text]))),
    CONSTRAINT resource_permissions_v2_staging_access_level_chk CHECK ((access_level = ANY (ARRAY['edit'::text, 'no_access'::text]))),
    CONSTRAINT resource_permissions_v2_staging_subject_type_chk CHECK ((subject_type = ANY (ARRAY['user'::text, 'group'::text])))
);


--
-- Name: saved_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_views (
    company_id uuid NOT NULL,
    saved_view_id uuid NOT NULL,
    surface text NOT NULL,
    principal text NOT NULL,
    principal_id uuid NOT NULL,
    name text NOT NULL,
    groupings jsonb DEFAULT '[]'::jsonb NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT saved_views_groupings_array_chk CHECK ((jsonb_typeof(groupings) = 'array'::text)),
    CONSTRAINT saved_views_name_nonblank_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT saved_views_principal_chk CHECK ((principal = ANY (ARRAY['user'::text, 'group'::text]))),
    CONSTRAINT saved_views_settings_object_chk CHECK ((jsonb_typeof(settings) = 'object'::text)),
    CONSTRAINT saved_views_surface_chk CHECK ((surface = ANY (ARRAY['updates'::text, 'logic_gate_kanban'::text])))
);


--
-- Name: shared_inbox_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_inbox_folders (
    company_id uuid NOT NULL,
    folder_id uuid NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,
    default_access text DEFAULT 'edit'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shared_inbox_folders_default_access_chk CHECK ((default_access = ANY (ARRAY['edit'::text, 'no_access'::text]))),
    CONSTRAINT shared_inbox_folders_name_nonblank_chk CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT shared_inbox_folders_parent_not_self_chk CHECK (((parent_folder_id IS NULL) OR (parent_folder_id <> folder_id)))
);


--
-- Name: shared_inboxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_inboxes (
    company_id uuid NOT NULL,
    shared_inbox_id uuid NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,
    account_email text NOT NULL,
    default_access text DEFAULT 'edit'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    company_email_connection_id uuid,
    CONSTRAINT shared_inboxes_account_email_chk CHECK (((btrim(account_email) <> ''::text) AND (account_email = lower(btrim(account_email))))),
    CONSTRAINT shared_inboxes_default_access_chk CHECK ((default_access = ANY (ARRAY['edit'::text, 'no_access'::text]))),
    CONSTRAINT shared_inboxes_name_nonblank_chk CHECK ((btrim(name) <> ''::text))
);


--
-- Name: user_logic_gate_shortcuts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_logic_gate_shortcuts (
    user_id uuid NOT NULL,
    company_id uuid NOT NULL,
    logic_gate_id uuid NOT NULL,
    "position" integer NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id uuid NOT NULL,
    cognito_subject text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    created_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    display_name text NOT NULL,
    CONSTRAINT users_cognito_subject_nonblank_chk CHECK ((btrim(cognito_subject) <> ''::text)),
    CONSTRAINT users_display_name_nonblank_chk CHECK ((btrim(display_name) <> ''::text)),
    CONSTRAINT users_email_lowercase_chk CHECK ((email = lower(btrim(email))))
);


--
-- Name: workspace_derived_domain_event_projection_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_derived_domain_event_projection_checkpoints (
    company_id uuid NOT NULL,
    checkpoint_timestamp timestamp with time zone NOT NULL,
    checkpoint_event_id uuid NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_read_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_read_versions (
    company_id uuid NOT NULL,
    scope text NOT NULL,
    resource_key text DEFAULT ''::text NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    updated_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_read_versions_scope_nonblank_chk CHECK ((btrim(scope) <> ''::text)),
    CONSTRAINT workspace_read_versions_version_nonnegative_chk CHECK ((version >= 0))
);


--
-- Name: realtime_outbox outbox_sequence; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realtime_outbox ALTER COLUMN outbox_sequence SET DEFAULT nextval('public.realtime_outbox_outbox_sequence_seq'::regclass);


--
-- Name: account_folders account_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_folders
    ADD CONSTRAINT account_folders_pkey PRIMARY KEY (company_id, folder_id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (company_id, account_id);


--
-- Name: attachment_previews attachment_previews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_previews
    ADD CONSTRAINT attachment_previews_pkey PRIMARY KEY (attachment_id, preview_type);


--
-- Name: attachment_previews attachment_previews_storage_bucket_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_previews
    ADD CONSTRAINT attachment_previews_storage_bucket_storage_key_key UNIQUE (storage_bucket, storage_key);


--
-- Name: attachment_relationships attachment_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_relationships
    ADD CONSTRAINT attachment_relationships_pkey PRIMARY KEY (attachment_relationship_id);


--
-- Name: attachment_upload_jobs attachment_upload_jobs_attachment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_upload_jobs
    ADD CONSTRAINT attachment_upload_jobs_attachment_id_key UNIQUE (attachment_id);


--
-- Name: attachment_upload_jobs attachment_upload_jobs_company_id_actor_user_id_client_requ_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_upload_jobs
    ADD CONSTRAINT attachment_upload_jobs_company_id_actor_user_id_client_requ_key UNIQUE (company_id, actor_user_id, client_request_id);


--
-- Name: attachment_upload_jobs attachment_upload_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_upload_jobs
    ADD CONSTRAINT attachment_upload_jobs_pkey PRIMARY KEY (upload_job_id);


--
-- Name: attachment_upload_jobs attachment_upload_jobs_storage_bucket_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_upload_jobs
    ADD CONSTRAINT attachment_upload_jobs_storage_bucket_storage_key_key UNIQUE (storage_bucket, storage_key);


--
-- Name: attachment_upload_parts attachment_upload_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_upload_parts
    ADD CONSTRAINT attachment_upload_parts_pkey PRIMARY KEY (upload_job_id, part_number);


--
-- Name: attachments attachments_company_id_attachment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_company_id_attachment_id_key UNIQUE (company_id, attachment_id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (attachment_id);


--
-- Name: attachments attachments_storage_bucket_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_storage_bucket_storage_key_key UNIQUE (storage_bucket, storage_key);


--
-- Name: auth_external_identity_deletions auth_external_identity_deletions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_external_identity_deletions
    ADD CONSTRAINT auth_external_identity_deletions_pkey PRIMARY KEY (provider, external_subject);


--
-- Name: communications_email_archive_job_items communications_email_archive_job__archive_job_id_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_email_archive_job_items
    ADD CONSTRAINT communications_email_archive_job__archive_job_id_message_id_key UNIQUE (archive_job_id, message_id);


--
-- Name: communications_email_archive_job_items communications_email_archive_job_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_email_archive_job_items
    ADD CONSTRAINT communications_email_archive_job_items_pkey PRIMARY KEY (job_item_id);


--
-- Name: communications_email_archive_jobs communications_email_archive_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_email_archive_jobs
    ADD CONSTRAINT communications_email_archive_jobs_pkey PRIMARY KEY (archive_job_id);


--
-- Name: communications_message_read_receipt_signals communications_message_read_receipt_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_message_read_receipt_signals
    ADD CONSTRAINT communications_message_read_receipt_signals_pkey PRIMARY KEY (receipt_scope_type, receipt_scope_id, message_id, signal_timestamp);


--
-- Name: communications_message_read_receipt_summaries communications_message_read_receipt_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_message_read_receipt_summaries
    ADD CONSTRAINT communications_message_read_receipt_summaries_pkey PRIMARY KEY (receipt_scope_type, receipt_scope_id, message_id);


--
-- Name: communications_triage_items communications_triage_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_triage_items
    ADD CONSTRAINT communications_triage_items_pkey PRIMARY KEY (user_id, message_id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (company_id);


--
-- Name: company_explorer_folders company_explorer_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_explorer_folders
    ADD CONSTRAINT company_explorer_folders_pkey PRIMARY KEY (company_id, folder_id);


--
-- Name: company_explorer_items company_explorer_items_company_id_target_type_target_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_explorer_items
    ADD CONSTRAINT company_explorer_items_company_id_target_type_target_id_key UNIQUE (company_id, target_type, target_id);


--
-- Name: company_explorer_items company_explorer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_explorer_items
    ADD CONSTRAINT company_explorer_items_pkey PRIMARY KEY (company_id, item_id);


--
-- Name: company_memberships company_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_memberships
    ADD CONSTRAINT company_memberships_pkey PRIMARY KEY (company_id, user_id);


--
-- Name: company_user_group_members company_user_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_user_group_members
    ADD CONSTRAINT company_user_group_members_pkey PRIMARY KEY (company_id, group_id, user_id);


--
-- Name: company_user_groups company_user_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_user_groups
    ADD CONSTRAINT company_user_groups_pkey PRIMARY KEY (company_id, group_id);


--
-- Name: domain_events domain_events_company_id_stream_type_stream_id_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_company_id_stream_type_stream_id_sequence_key UNIQUE (company_id, stream_type, stream_id, sequence);


--
-- Name: domain_events domain_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_pkey PRIMARY KEY (company_id, event_id);


--
-- Name: email_connections email_connections_company_id_email_connection_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_company_id_email_connection_id_key UNIQUE (company_id, email_connection_id);


--
-- Name: email_connections email_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_pkey PRIMARY KEY (email_connection_id);


--
-- Name: email_drafts email_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_drafts
    ADD CONSTRAINT email_drafts_pkey PRIMARY KEY (company_id, draft_id);


--
-- Name: email_ingestion_jobs email_ingestion_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_ingestion_jobs
    ADD CONSTRAINT email_ingestion_jobs_pkey PRIMARY KEY (ingestion_job_id);


--
-- Name: email_messages email_messages_company_id_email_thread_id_email_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_company_id_email_thread_id_email_message_id_key UNIQUE (company_id, email_thread_id, email_message_id);


--
-- Name: email_messages email_messages_company_id_email_thread_id_provider_message__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_company_id_email_thread_id_provider_message__key UNIQUE (company_id, email_thread_id, provider_message_id);


--
-- Name: email_messages email_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (company_id, email_message_id);


--
-- Name: email_relationships email_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_relationships
    ADD CONSTRAINT email_relationships_pkey PRIMARY KEY (company_id, email_relationship_id);


--
-- Name: email_signatures email_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_signatures
    ADD CONSTRAINT email_signatures_pkey PRIMARY KEY (company_id, signature_id);


--
-- Name: email_threads email_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_threads
    ADD CONSTRAINT email_threads_pkey PRIMARY KEY (company_id, email_thread_id);


--
-- Name: huddle_explorer_folders huddle_explorer_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_explorer_folders
    ADD CONSTRAINT huddle_explorer_folders_pkey PRIMARY KEY (company_id, folder_id);


--
-- Name: huddle_explorer_items huddle_explorer_items_company_id_huddle_type_resource_huddl_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_explorer_items
    ADD CONSTRAINT huddle_explorer_items_company_id_huddle_type_resource_huddl_key UNIQUE (company_id, huddle_type, resource_huddle_resource_id);


--
-- Name: huddle_explorer_items huddle_explorer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_explorer_items
    ADD CONSTRAINT huddle_explorer_items_pkey PRIMARY KEY (company_id, huddle_explorer_item_id);


--
-- Name: huddle_logic_gate_relationships huddle_logic_gate_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_logic_gate_relationships
    ADD CONSTRAINT huddle_logic_gate_relationships_pkey PRIMARY KEY (company_id, huddle_logic_gate_id, logic_gate_id);


--
-- Name: huddle_logic_gates huddle_logic_gates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_logic_gates
    ADD CONSTRAINT huddle_logic_gates_pkey PRIMARY KEY (company_id, huddle_logic_gate_id);


--
-- Name: huddle_node_kpi_relationships huddle_node_kpi_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_kpi_relationships
    ADD CONSTRAINT huddle_node_kpi_relationships_pkey PRIMARY KEY (company_id, huddle_node_id, logic_gate_id, kpi_id);


--
-- Name: huddle_node_logic_gate_relationships huddle_node_logic_gate_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_logic_gate_relationships
    ADD CONSTRAINT huddle_node_logic_gate_relationships_pkey PRIMARY KEY (company_id, huddle_node_id, logic_gate_id);


--
-- Name: huddle_node_textbox_chats huddle_node_textbox_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_textbox_chats
    ADD CONSTRAINT huddle_node_textbox_chats_pkey PRIMARY KEY (company_id, chat_id);


--
-- Name: huddle_node_textboxes huddle_node_textboxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_textboxes
    ADD CONSTRAINT huddle_node_textboxes_pkey PRIMARY KEY (company_id, huddle_node_id, textbox_id);


--
-- Name: huddle_nodes huddle_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_nodes
    ADD CONSTRAINT huddle_nodes_pkey PRIMARY KEY (company_id, huddle_node_id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (invitation_id);


--
-- Name: invitations invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: kanban_board_projection kanban_board_projection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_board_projection
    ADD CONSTRAINT kanban_board_projection_pkey PRIMARY KEY (company_id, logic_gate_id, node_id);


--
-- Name: kpis kpis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis
    ADD CONSTRAINT kpis_pkey PRIMARY KEY (company_id, kpi_id);


--
-- Name: scorecards scorecards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorecards
    ADD CONSTRAINT scorecards_pkey PRIMARY KEY (company_id, qd_rating_id);


--
-- Name: logic_gate_textboxes_history logic_gate_textboxes_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logic_gate_textboxes_history
    ADD CONSTRAINT logic_gate_textboxes_history_pkey PRIMARY KEY (company_id, logic_gate_id, batch_id, textbox_id);


--
-- Name: logic_gate_textboxes logic_gate_textboxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logic_gate_textboxes
    ADD CONSTRAINT logic_gate_textboxes_pkey PRIMARY KEY (company_id, logic_gate_id, textbox_id);


--
-- Name: logic_gate_work_versions logic_gate_work_versions_board_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logic_gate_work_versions
    ADD CONSTRAINT logic_gate_work_versions_board_key UNIQUE (company_id, board_id);


--
-- Name: logic_gate_work_versions logic_gate_work_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logic_gate_work_versions
    ADD CONSTRAINT logic_gate_work_versions_pkey PRIMARY KEY (company_id, logic_gate_id);


--
-- Name: logic_gates logic_gates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logic_gates
    ADD CONSTRAINT logic_gates_pkey PRIMARY KEY (company_id, logic_gate_id);


--
-- Name: node_account_assignments node_account_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_account_assignments
    ADD CONSTRAINT node_account_assignments_pkey PRIMARY KEY (company_id, node_id, account_id);


--
-- Name: node_logic_gate_assignments node_logic_gate_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_logic_gate_assignments
    ADD CONSTRAINT node_logic_gate_assignments_pkey PRIMARY KEY (company_id, assignment_id);


--
-- Name: node_relationships node_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_relationships
    ADD CONSTRAINT node_relationships_pkey PRIMARY KEY (company_id, node_relationship_id);


--
-- Name: node_textbox_chats node_textbox_chats_company_id_node_id_textbox_id_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textbox_chats
    ADD CONSTRAINT node_textbox_chats_company_id_node_id_textbox_id_chat_id_key UNIQUE (company_id, node_id, textbox_id, chat_id);


--
-- Name: node_textbox_chats node_textbox_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textbox_chats
    ADD CONSTRAINT node_textbox_chats_pkey PRIMARY KEY (company_id, chat_id);


--
-- Name: node_textboxes_history node_textboxes_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textboxes_history
    ADD CONSTRAINT node_textboxes_history_pkey PRIMARY KEY (company_id, node_id, batch_id, textbox_id);


--
-- Name: node_textboxes node_textboxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textboxes
    ADD CONSTRAINT node_textboxes_pkey PRIMARY KEY (company_id, node_id, textbox_id);


--
-- Name: node_timeline_events node_timeline_events_company_id_node_id_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_timeline_events
    ADD CONSTRAINT node_timeline_events_company_id_node_id_event_id_key UNIQUE (company_id, node_id, event_id);


--
-- Name: node_timeline_events node_timeline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_timeline_events
    ADD CONSTRAINT node_timeline_events_pkey PRIMARY KEY (company_id, event_id);


--
-- Name: node_timeline_verification_recipients node_timeline_verification_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_timeline_verification_recipients
    ADD CONSTRAINT node_timeline_verification_recipients_pkey PRIMARY KEY (company_id, event_id, user_id);


--
-- Name: node_view_user_versions node_view_user_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_view_user_versions
    ADD CONSTRAINT node_view_user_versions_pkey PRIMARY KEY (company_id, node_id, user_id);


--
-- Name: node_view_versions node_view_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_view_versions
    ADD CONSTRAINT node_view_versions_pkey PRIMARY KEY (company_id, node_id);


--
-- Name: nodes nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_pkey PRIMARY KEY (company_id, node_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (notification_id);


--
-- Name: pin_folders pin_folders_company_id_user_id_folder_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_folders
    ADD CONSTRAINT pin_folders_company_id_user_id_folder_id_key UNIQUE (company_id, user_id, folder_id);


--
-- Name: pin_folders pin_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_folders
    ADD CONSTRAINT pin_folders_pkey PRIMARY KEY (folder_id);


--
-- Name: pins pins_company_id_user_id_resource_type_resource_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_company_id_user_id_resource_type_resource_id_key UNIQUE (company_id, user_id, resource_type, resource_id);


--
-- Name: pins pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_pkey PRIMARY KEY (pin_id);


--
-- Name: process_map_actual_size_layout_recovery_placements process_map_actual_size_layout_recovery_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_map_actual_size_layout_recovery_placements
    ADD CONSTRAINT process_map_actual_size_layout_recovery_placements_pkey PRIMARY KEY (company_id, resource_type, resource_id);


--
-- Name: process_map_actual_size_layout_recovery_runs process_map_actual_size_layout_recovery_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_map_actual_size_layout_recovery_runs
    ADD CONSTRAINT process_map_actual_size_layout_recovery_runs_pkey PRIMARY KEY (company_id);


--
-- Name: process_map_placements process_map_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_map_placements
    ADD CONSTRAINT process_map_placements_pkey PRIMARY KEY (company_id, resource_type, resource_id);


--
-- Name: process_map_traces process_map_traces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_map_traces
    ADD CONSTRAINT process_map_traces_pkey PRIMARY KEY (company_id, resource_operational_relationship_id);


--
-- Name: project_account_assignments project_account_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_account_assignments
    ADD CONSTRAINT project_account_assignments_pkey PRIMARY KEY (company_id, project_id, account_id);


--
-- Name: project_critical_path_steps project_critical_path_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_critical_path_steps
    ADD CONSTRAINT project_critical_path_steps_pkey PRIMARY KEY (company_id, project_id, step_id);


--
-- Name: project_management_timeline_items project_management_timeline_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_items
    ADD CONSTRAINT project_management_timeline_items_pkey PRIMARY KEY (company_id, item_id);


--
-- Name: project_management_timeline_projection project_management_timeline_projection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_projection
    ADD CONSTRAINT project_management_timeline_projection_pkey PRIMARY KEY (company_id, user_id, item_id);


--
-- Name: project_relationship_projection project_relationship_projection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relationship_projection
    ADD CONSTRAINT project_relationship_projection_pkey PRIMARY KEY (company_id, relationship_id);


--
-- Name: project_relationships project_relationships_company_id_project_id_resource_type_r_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relationships
    ADD CONSTRAINT project_relationships_company_id_project_id_resource_type_r_key UNIQUE (company_id, project_id, resource_type, resource_id);


--
-- Name: project_relationships project_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relationships
    ADD CONSTRAINT project_relationships_pkey PRIMARY KEY (company_id, relationship_id);


--
-- Name: project_team_assignments project_team_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_team_assignments
    ADD CONSTRAINT project_team_assignments_pkey PRIMARY KEY (company_id, project_id, team_id);


--
-- Name: project_textbox_chats project_textbox_chats_company_id_project_id_textbox_id_chat_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textbox_chats
    ADD CONSTRAINT project_textbox_chats_company_id_project_id_textbox_id_chat_key UNIQUE (company_id, project_id, textbox_id, chat_id);


--
-- Name: project_textbox_chats project_textbox_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textbox_chats
    ADD CONSTRAINT project_textbox_chats_pkey PRIMARY KEY (company_id, chat_id);


--
-- Name: project_textboxes_history project_textboxes_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textboxes_history
    ADD CONSTRAINT project_textboxes_history_pkey PRIMARY KEY (company_id, project_id, batch_id, textbox_id);


--
-- Name: project_textboxes project_textboxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textboxes
    ADD CONSTRAINT project_textboxes_pkey PRIMARY KEY (company_id, project_id, textbox_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (company_id, project_id);


--
-- Name: raci_tabs_folders raci_tabs_folders_company_id_user_id_role_folder_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raci_tabs_folders
    ADD CONSTRAINT raci_tabs_folders_company_id_user_id_role_folder_id_key UNIQUE (company_id, user_id, role, folder_id);


--
-- Name: raci_tabs_folders raci_tabs_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raci_tabs_folders
    ADD CONSTRAINT raci_tabs_folders_pkey PRIMARY KEY (folder_id);


--
-- Name: raci_tabs_items raci_tabs_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raci_tabs_items
    ADD CONSTRAINT raci_tabs_items_pkey PRIMARY KEY (company_id, user_id, logic_gate_id);


--
-- Name: entity_relationships entity_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_relationships
    ADD CONSTRAINT entity_relationships_pkey PRIMARY KEY (company_id, entity_id, resource_type, resource_id);


--
-- Name: entity_field_types entity_field_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_field_types
    ADD CONSTRAINT entity_field_types_pkey PRIMARY KEY (company_id, entity_field_type_id);


--
-- Name: entity_fields entity_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_fields
    ADD CONSTRAINT entity_fields_pkey PRIMARY KEY (company_id, entity_field_id);


--
-- Name: entity_folders entity_folders_company_id_entity_type_id_entity_folder_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_folders
    ADD CONSTRAINT entity_folders_company_id_entity_type_id_entity_folder_id_key UNIQUE (company_id, entity_type_id, entity_folder_id);


--
-- Name: entity_folders entity_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_folders
    ADD CONSTRAINT entity_folders_pkey PRIMARY KEY (company_id, entity_folder_id);


--
-- Name: entity_types entity_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_types
    ADD CONSTRAINT entity_types_pkey PRIMARY KEY (company_id, entity_type_id);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (company_id, entity_id);


--
-- Name: realtime_outbox realtime_outbox_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realtime_outbox
    ADD CONSTRAINT realtime_outbox_event_id_key UNIQUE (event_id);


--
-- Name: realtime_outbox realtime_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realtime_outbox
    ADD CONSTRAINT realtime_outbox_pkey PRIMARY KEY (outbox_sequence);


--
-- Name: recycle_bin_items recycle_bin_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recycle_bin_items
    ADD CONSTRAINT recycle_bin_items_pkey PRIMARY KEY (company_id, recycle_bin_item_id);


--
-- Name: resource_gvic_assignments resource_gvic_assignments_v2_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_gvic_assignments
    ADD CONSTRAINT resource_gvic_assignments_v2_staging_pkey PRIMARY KEY (company_id, resource_type, resource_id, role, principal_type, principal_id);


--
-- Name: resource_gvic_settings resource_gvic_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_gvic_settings
    ADD CONSTRAINT resource_gvic_settings_pkey PRIMARY KEY (company_id, resource_type, resource_id);


--
-- Name: resource_operational_relationships resource_operational_relation_company_id_source_resource_ty_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_operational_relationships
    ADD CONSTRAINT resource_operational_relation_company_id_source_resource_ty_key UNIQUE (company_id, source_resource_type, source_resource_id, target_resource_type, target_resource_id);


--
-- Name: resource_operational_relationships resource_operational_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_operational_relationships
    ADD CONSTRAINT resource_operational_relationships_pkey PRIMARY KEY (company_id, resource_operational_relationship_id);


--
-- Name: resource_permission_settings resource_permission_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_permission_settings
    ADD CONSTRAINT resource_permission_settings_pkey PRIMARY KEY (company_id, resource_type, resource_id);


--
-- Name: resource_permissions resource_permissions_v2_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_permissions
    ADD CONSTRAINT resource_permissions_v2_staging_pkey PRIMARY KEY (company_id, resource_type, resource_id, subject_type, subject_id);


--
-- Name: saved_views saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_pkey PRIMARY KEY (company_id, saved_view_id);


--
-- Name: shared_inbox_folders shared_inbox_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_inbox_folders
    ADD CONSTRAINT shared_inbox_folders_pkey PRIMARY KEY (company_id, folder_id);


--
-- Name: shared_inboxes shared_inboxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_inboxes
    ADD CONSTRAINT shared_inboxes_pkey PRIMARY KEY (company_id, shared_inbox_id);


--
-- Name: user_logic_gate_shortcuts user_logic_gate_shortcuts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logic_gate_shortcuts
    ADD CONSTRAINT user_logic_gate_shortcuts_pkey PRIMARY KEY (user_id, company_id, logic_gate_id);


--
-- Name: users users_cognito_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_cognito_subject_key UNIQUE (cognito_subject);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: workspace_derived_domain_event_projection_checkpoints workspace_derived_domain_event_projection_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_derived_domain_event_projection_checkpoints
    ADD CONSTRAINT workspace_derived_domain_event_projection_checkpoints_pkey PRIMARY KEY (company_id);


--
-- Name: workspace_read_versions workspace_read_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_read_versions
    ADD CONSTRAINT workspace_read_versions_pkey PRIMARY KEY (company_id, scope, resource_key);


--
-- Name: idx_account_folders_parent_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_folders_parent_position ON public.account_folders USING btree (company_id, parent_folder_id, "position", lower(name), folder_id);


--
-- Name: idx_accounts_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_company_name ON public.accounts USING btree (company_id, lower(name), account_id);


--
-- Name: idx_accounts_folder_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_folder_position ON public.accounts USING btree (company_id, folder_id, "position", lower(name), account_id);


--
-- Name: idx_attachment_relationships_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_attachment_relationships_active_unique ON public.attachment_relationships USING btree (company_id, resource_type, resource_id, attachment_id, relationship_kind, COALESCE((information_id)::text, ''::text), COALESCE(message_id, ''::text), COALESCE(editor_surface, ''::text)) WHERE (deleted_timestamp IS NULL);


--
-- Name: idx_attachment_relationships_attachment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachment_relationships_attachment ON public.attachment_relationships USING btree (company_id, attachment_id, deleted_timestamp);


--
-- Name: idx_attachment_relationships_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachment_relationships_resource ON public.attachment_relationships USING btree (company_id, resource_type, resource_id, deleted_timestamp, created_timestamp DESC);


--
-- Name: idx_attachment_upload_jobs_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachment_upload_jobs_actor ON public.attachment_upload_jobs USING btree (company_id, actor_user_id, updated_timestamp DESC);


--
-- Name: idx_attachment_upload_jobs_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachment_upload_jobs_expiry ON public.attachment_upload_jobs USING btree (expires_timestamp, upload_job_id) WHERE (status = ANY (ARRAY['pending'::text, 'uploading'::text, 'completing'::text, 'failed'::text]));


--
-- Name: idx_attachment_upload_jobs_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachment_upload_jobs_resource ON public.attachment_upload_jobs USING btree (company_id, resource_type, resource_id);


--
-- Name: idx_attachment_upload_jobs_status_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachment_upload_jobs_status_expiry ON public.attachment_upload_jobs USING btree (status, expires_timestamp);


--
-- Name: idx_attachments_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachments_company_created ON public.attachments USING btree (company_id, created_timestamp DESC, attachment_id);


--
-- Name: idx_attachments_company_sha256; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachments_company_sha256 ON public.attachments USING btree (company_id, sha256);


--
-- Name: idx_auth_external_identity_deletions_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_external_identity_deletions_pending ON public.auth_external_identity_deletions USING btree (updated_timestamp) WHERE (status = 'pending'::text);


--
-- Name: idx_communications_email_archive_job_items_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_email_archive_job_items_job ON public.communications_email_archive_job_items USING btree (archive_job_id, created_timestamp, job_item_id);


--
-- Name: idx_communications_email_archive_jobs_actor_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_email_archive_jobs_actor_created ON public.communications_email_archive_jobs USING btree (actor_user_id, created_timestamp DESC);


--
-- Name: idx_communications_email_archive_jobs_shared_inbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_email_archive_jobs_shared_inbox ON public.communications_email_archive_jobs USING btree (company_id, shared_inbox_id, created_timestamp DESC) WHERE (shared_inbox_id IS NOT NULL);


--
-- Name: idx_communications_message_read_receipt_summaries_shared_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_message_read_receipt_summaries_shared_latest ON public.communications_message_read_receipt_summaries USING btree (company_email_connection_id, last_signal_timestamp DESC) WHERE ((receipt_scope_type)::text = 'shared'::text);


--
-- Name: idx_communications_message_read_receipt_summaries_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_message_read_receipt_summaries_thread ON public.communications_message_read_receipt_summaries USING btree (receipt_scope_type, receipt_scope_id, thread_id) WHERE (thread_id <> ''::text);


--
-- Name: idx_communications_message_read_receipt_summaries_user_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_message_read_receipt_summaries_user_latest ON public.communications_message_read_receipt_summaries USING btree (user_id, last_signal_timestamp DESC) WHERE ((receipt_scope_type)::text = 'personal'::text);


--
-- Name: idx_communications_triage_items_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_triage_items_user_created ON public.communications_triage_items USING btree (user_id, created_timestamp DESC, message_id);


--
-- Name: idx_company_explorer_folders_parent_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_explorer_folders_parent_position ON public.company_explorer_folders USING btree (company_id, parent_folder_id, "position", created_timestamp, folder_id);


--
-- Name: idx_company_explorer_items_parent_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_explorer_items_parent_position ON public.company_explorer_items USING btree (company_id, parent_folder_id, "position", created_timestamp, item_id);


--
-- Name: idx_company_explorer_items_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_explorer_items_target ON public.company_explorer_items USING btree (company_id, target_type, target_id);


--
-- Name: idx_company_memberships_user_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_memberships_user_company ON public.company_memberships USING btree (user_id, company_id);


--
-- Name: idx_company_user_group_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_user_group_members_user ON public.company_user_group_members USING btree (company_id, user_id, group_id);


--
-- Name: idx_company_user_groups_parent_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_user_groups_parent_position ON public.company_user_groups USING btree (company_id, parent_group_id, "position", group_id);


--
-- Name: idx_domain_events_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_domain_events_company_created ON public.domain_events USING btree (company_id, created_timestamp DESC, event_id DESC);


--
-- Name: idx_domain_events_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_domain_events_idempotency_key ON public.domain_events USING btree (company_id, idempotency_key) WHERE (btrim(idempotency_key) <> ''::text);


--
-- Name: idx_domain_events_stream_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_domain_events_stream_sequence ON public.domain_events USING btree (company_id, stream_type, stream_id, sequence);


--
-- Name: idx_email_connections_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_connections_company_status ON public.email_connections USING btree (company_id, status, last_successful_scan_at);


--
-- Name: idx_email_connections_grant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_connections_grant_id ON public.email_connections USING btree (grant_id);


--
-- Name: idx_email_connections_personal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_connections_personal ON public.email_connections USING btree (company_id, personal_user_id, account_email) WHERE (connection_type = 'personal'::text);


--
-- Name: idx_email_connections_shared; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_connections_shared ON public.email_connections USING btree (company_id, account_email) WHERE (connection_type = 'shared'::text);


--
-- Name: idx_email_drafts_active_personal_message_personal_account; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_drafts_active_personal_message_personal_account ON public.email_drafts USING btree (company_id, created_by_user_id, source_email_message_id, personal_user_id, personal_account_email) WHERE ((deleted_timestamp IS NULL) AND (source_email_message_id IS NOT NULL) AND (email_account_type = 'personal_email_account'::text) AND (shared_resource_type IS NULL) AND (shared_resource_id IS NULL));


--
-- Name: idx_email_drafts_active_personal_message_shared_inbox; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_drafts_active_personal_message_shared_inbox ON public.email_drafts USING btree (company_id, created_by_user_id, source_email_message_id, shared_inbox_id) WHERE ((deleted_timestamp IS NULL) AND (source_email_message_id IS NOT NULL) AND (email_account_type = 'shared_email_account'::text) AND (shared_resource_type IS NULL) AND (shared_resource_id IS NULL));


--
-- Name: idx_email_drafts_active_shared_resource_message; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_drafts_active_shared_resource_message ON public.email_drafts USING btree (company_id, shared_resource_type, shared_resource_id, source_email_message_id) WHERE ((deleted_timestamp IS NULL) AND (shared_resource_type IS NOT NULL));


--
-- Name: idx_email_drafts_personal_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_drafts_personal_updated ON public.email_drafts USING btree (company_id, personal_user_id, personal_account_email, updated_timestamp DESC) WHERE ((deleted_timestamp IS NULL) AND (email_account_type = 'personal_email_account'::text));


--
-- Name: idx_email_drafts_resource_shared_mailbox_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_drafts_resource_shared_mailbox_updated ON public.email_drafts USING btree (company_id, email_account_type, personal_user_id, personal_account_email, shared_inbox_id, updated_timestamp DESC) WHERE ((deleted_timestamp IS NULL) AND (shared_resource_type IS NOT NULL));


--
-- Name: idx_email_drafts_shared_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_drafts_shared_updated ON public.email_drafts USING btree (company_id, shared_inbox_id, updated_timestamp DESC) WHERE ((deleted_timestamp IS NULL) AND (email_account_type = 'shared_email_account'::text));


--
-- Name: idx_email_ingestion_jobs_stable_message; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_ingestion_jobs_stable_message ON public.email_ingestion_jobs USING btree (company_id, email_connection_id, provider_message_id);


--
-- Name: idx_email_messages_thread_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_messages_thread_order ON public.email_messages USING btree (company_id, email_thread_id, message_order, provider_message_id);


--
-- Name: idx_email_relationships_active_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_relationships_active_identity ON public.email_relationships USING btree (company_id, email_message_id, resource_type, resource_id, COALESCE(resource_textbox_id, ''::text));


--
-- Name: idx_email_relationships_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_relationships_message ON public.email_relationships USING btree (company_id, email_thread_id, email_message_id);


--
-- Name: idx_email_relationships_one_textbox_per_message_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_relationships_one_textbox_per_message_owner ON public.email_relationships USING btree (company_id, email_message_id, resource_type, resource_id) WHERE ((resource_type = ANY (ARRAY['node'::text, 'project'::text])) AND (resource_textbox_id IS NOT NULL));


--
-- Name: idx_email_relationships_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_relationships_resource ON public.email_relationships USING btree (company_id, resource_type, resource_id, resource_textbox_id, created_timestamp);


--
-- Name: idx_email_signatures_personal_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_signatures_personal_scope ON public.email_signatures USING btree (company_id, personal_user_id, personal_account_email) WHERE (email_account_type = 'personal_email_account'::text);


--
-- Name: idx_email_signatures_shared_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_signatures_shared_scope ON public.email_signatures USING btree (company_id, shared_inbox_id) WHERE (email_account_type = 'shared_email_account'::text);


--
-- Name: idx_email_threads_connection_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_threads_connection_provider ON public.email_threads USING btree (company_id, email_connection_id, provider_thread_key);


--
-- Name: idx_huddle_explorer_folders_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_huddle_explorer_folders_parent ON public.huddle_explorer_folders USING btree (company_id, parent_folder_id, created_date, folder_id);


--
-- Name: idx_huddle_explorer_items_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_huddle_explorer_items_parent ON public.huddle_explorer_items USING btree (company_id, parent_folder_id, created_date, huddle_explorer_item_id);


--
-- Name: idx_huddle_logic_gate_relationships_logic_gate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_huddle_logic_gate_relationships_logic_gate ON public.huddle_logic_gate_relationships USING btree (company_id, logic_gate_id, huddle_logic_gate_id);


--
-- Name: idx_huddle_node_kpi_relationships_kpi; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_huddle_node_kpi_relationships_kpi ON public.huddle_node_kpi_relationships USING btree (company_id, kpi_id, huddle_node_id);


--
-- Name: idx_huddle_node_logic_gate_relationships_logic_gate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_huddle_node_logic_gate_relationships_logic_gate ON public.huddle_node_logic_gate_relationships USING btree (company_id, logic_gate_id, huddle_node_id);


--
-- Name: huddle_node_textbox_chats_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX huddle_node_textbox_chats_live_idx ON public.huddle_node_textbox_chats USING btree (company_id, huddle_node_id, textbox_id, created_timestamp, chat_id) WHERE (deleted_timestamp IS NULL);


--
-- Name: huddle_node_textbox_chats_parent_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX huddle_node_textbox_chats_parent_identity_idx ON public.huddle_node_textbox_chats USING btree (company_id, huddle_node_id, textbox_id, chat_id);


--
-- Name: huddle_node_textboxes_live_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX huddle_node_textboxes_live_order_idx ON public.huddle_node_textboxes USING btree (company_id, huddle_node_id, display_order, textbox_id) WHERE (deleted_timestamp IS NULL);


--
-- Name: idx_huddle_nodes_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_huddle_nodes_owner ON public.huddle_nodes USING btree (company_id, huddle_logic_gate_id, created_timestamp, huddle_node_id);


--
-- Name: idx_invitations_company_email_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_company_email_status ON public.invitations USING btree (company_id, email, status, created_timestamp DESC);


--
-- Name: idx_invitations_company_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_company_status_updated ON public.invitations USING btree (company_id, status, updated_timestamp DESC);


--
-- Name: idx_invitations_one_pending_company_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_invitations_one_pending_company_email ON public.invitations USING btree (company_id, email) WHERE (status = 'pending'::text);


--
-- Name: idx_kanban_board_projection_hot_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kanban_board_projection_hot_read ON public.kanban_board_projection USING btree (company_id, logic_gate_id, status_rank, "position", assignment_created_timestamp, assignment_id);


--
-- Name: idx_kanban_board_projection_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kanban_board_projection_node ON public.kanban_board_projection USING btree (company_id, node_id);


--
-- Name: idx_kanban_board_projection_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kanban_board_projection_updated ON public.kanban_board_projection USING btree (company_id, logic_gate_id, projection_updated_timestamp DESC, node_id);


--
-- Name: idx_kpis_logic_gate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpis_logic_gate ON public.kpis USING btree (company_id, logic_gate_id, created_timestamp, kpi_id);


--
-- Name: uq_scorecards_logic_gate_business_day; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_scorecards_logic_gate_business_day ON public.scorecards USING btree (company_id, logic_gate_id, (((rated_created_timestamp AT TIME ZONE 'America/Los_Angeles'::text))::date));


--
-- Name: idx_logic_gate_textboxes_gate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logic_gate_textboxes_gate ON public.logic_gate_textboxes USING btree (company_id, logic_gate_id, updated_timestamp DESC, textbox_id) WHERE (deleted_timestamp IS NULL);


--
-- Name: idx_logic_gates_header_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_logic_gates_header_trgm ON public.logic_gates USING gin (lower(header) public.gin_trgm_ops);


--
-- Name: idx_node_account_assignments_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_account_assignments_account ON public.node_account_assignments USING btree (company_id, account_id, node_id);


--
-- Name: idx_node_logic_gate_assignments_compat_card; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_node_logic_gate_assignments_compat_card ON public.node_logic_gate_assignments USING btree (company_id, compatibility_board_id, compatibility_card_id);


--
-- Name: idx_node_logic_gate_assignments_logic_gate_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_logic_gate_assignments_logic_gate_position ON public.node_logic_gate_assignments USING btree (company_id, logic_gate_id, column_id, "position", updated_timestamp DESC);


--
-- Name: idx_node_logic_gate_assignments_one_active_node; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_node_logic_gate_assignments_one_active_node ON public.node_logic_gate_assignments USING btree (company_id, node_id);


--
-- Name: idx_node_relationships_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_relationships_a ON public.node_relationships USING btree (company_id, node_id_a);


--
-- Name: idx_node_relationships_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_relationships_b ON public.node_relationships USING btree (company_id, node_id_b);


--
-- Name: idx_node_textbox_chats_email_selection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_textbox_chats_email_selection ON public.node_textbox_chats USING btree (company_id, selection_email_message_id) WHERE ((selection_email_message_id IS NOT NULL) AND (deleted_timestamp IS NULL));


--
-- Name: idx_node_textbox_chats_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_textbox_chats_parent ON public.node_textbox_chats USING btree (company_id, node_id, textbox_id, parent_chat_id) WHERE ((parent_chat_id IS NOT NULL) AND (deleted_timestamp IS NULL));


--
-- Name: idx_node_textbox_chats_textbox_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_textbox_chats_textbox_created ON public.node_textbox_chats USING btree (company_id, node_id, textbox_id, created_timestamp, chat_id) WHERE (deleted_timestamp IS NULL);


--
-- Name: idx_node_textboxes_node_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_textboxes_node_deleted ON public.node_textboxes USING btree (company_id, node_id, deleted_timestamp, textbox_id) WHERE (deleted_timestamp IS NOT NULL);


--
-- Name: idx_node_textboxes_node_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_textboxes_node_order ON public.node_textboxes USING btree (company_id, node_id, display_order, textbox_id) WHERE (deleted_timestamp IS NULL);


--
-- Name: idx_node_timeline_events_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_node_timeline_events_idempotency ON public.node_timeline_events USING btree (company_id, node_id, event_type, idempotency_key) WHERE (btrim(idempotency_key) <> ''::text);


--
-- Name: idx_node_timeline_events_node_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_timeline_events_node_created ON public.node_timeline_events USING btree (company_id, node_id, created_timestamp DESC, event_id DESC);


--
-- Name: idx_node_timeline_verification_recipient_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_timeline_verification_recipient_user ON public.node_timeline_verification_recipients USING btree (company_id, user_id, completed_timestamp, created_timestamp DESC);


--
-- Name: idx_nodes_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nodes_name_trgm ON public.nodes USING gin (lower(name) public.gin_trgm_ops);


--
-- Name: idx_notifications_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_notifications_dedupe ON public.notifications USING btree (recipient_user_id, source_event_id, notification_type, entity_type, entity_id);


--
-- Name: idx_notifications_recipient_company_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_company_created ON public.notifications USING btree (recipient_user_id, company_id, created_timestamp DESC, notification_id DESC);


--
-- Name: idx_notifications_recipient_company_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_company_unread ON public.notifications USING btree (recipient_user_id, company_id, created_timestamp DESC, notification_id DESC) WHERE (read_timestamp IS NULL);


--
-- Name: idx_notifications_recipient_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_created ON public.notifications USING btree (recipient_user_id, created_timestamp DESC, notification_id DESC);


--
-- Name: idx_notifications_recipient_logic_gate_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_logic_gate_unread ON public.notifications USING btree (recipient_user_id, company_id, logic_gate_id, node_id, role, created_timestamp DESC) WHERE ((read_timestamp IS NULL) AND (btrim(logic_gate_id) <> ''::text));


--
-- Name: idx_notifications_recipient_summary_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_summary_unread ON public.notifications USING btree (recipient_user_id, company_id, surface, role, created_timestamp DESC) WHERE (read_timestamp IS NULL);


--
-- Name: idx_notifications_recipient_type_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_type_unread ON public.notifications USING btree (recipient_user_id, company_id, notification_type, created_timestamp DESC, notification_id DESC) WHERE (read_timestamp IS NULL);


--
-- Name: idx_notifications_recipient_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient_unread ON public.notifications USING btree (recipient_user_id, created_timestamp DESC, notification_id DESC) WHERE (read_timestamp IS NULL);


--
-- Name: idx_notifications_source_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_source_event_id ON public.notifications USING btree (source_event_id);


--
-- Name: idx_pin_folders_owner_parent_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pin_folders_owner_parent_position ON public.pin_folders USING btree (company_id, user_id, parent_folder_id, "position", created_timestamp, folder_id);


--
-- Name: idx_pins_owner_parent_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pins_owner_parent_position ON public.pins USING btree (company_id, user_id, parent_folder_id, "position", created_timestamp, pin_id);


--
-- Name: idx_process_map_placements_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_map_placements_parent ON public.process_map_placements USING btree (company_id, map_parent_folder_id, resource_type, resource_id);


--
-- Name: idx_process_map_placements_spatial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_map_placements_spatial ON public.process_map_placements USING gist (box(point((grid_x)::double precision, (grid_y)::double precision), point((((grid_x)::bigint + grid_width))::double precision, (((grid_y)::bigint + grid_height))::double precision)));


--
-- Name: idx_project_account_assignments_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_account_assignments_account ON public.project_account_assignments USING btree (company_id, account_id, project_id);


--
-- Name: idx_project_critical_path_one_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_project_critical_path_one_current ON public.project_critical_path_steps USING btree (company_id, project_id) WHERE is_current;


--
-- Name: idx_project_critical_path_project_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_critical_path_project_position ON public.project_critical_path_steps USING btree (company_id, project_id, "position", step_id);


--
-- Name: idx_project_management_timeline_hot_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_management_timeline_hot_read ON public.project_management_timeline_items USING btree (company_id, user_id, start_date, "position", item_id);


--
-- Name: idx_project_management_timeline_projection_hot_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_management_timeline_projection_hot_read ON public.project_management_timeline_projection USING btree (company_id, user_id, start_date, "position", item_id);


--
-- Name: idx_project_management_timeline_projection_logic_gate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_management_timeline_projection_logic_gate ON public.project_management_timeline_projection USING btree (company_id, logic_gate_id);


--
-- Name: idx_project_management_timeline_projection_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_management_timeline_projection_node ON public.project_management_timeline_projection USING btree (company_id, node_id);


--
-- Name: idx_project_management_timeline_user_logic_gate; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_project_management_timeline_user_logic_gate ON public.project_management_timeline_items USING btree (company_id, user_id, logic_gate_id) WHERE (logic_gate_id IS NOT NULL);


--
-- Name: idx_project_management_timeline_user_node; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_project_management_timeline_user_node ON public.project_management_timeline_items USING btree (company_id, user_id, node_id) WHERE (node_id IS NOT NULL);


--
-- Name: idx_project_relationship_projection_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_relationship_projection_assignment ON public.project_relationship_projection USING btree (company_id, assignment_id);


--
-- Name: idx_project_relationship_projection_logic_gate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_relationship_projection_logic_gate ON public.project_relationship_projection USING btree (company_id, logic_gate_id);


--
-- Name: idx_project_relationship_projection_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_relationship_projection_node ON public.project_relationship_projection USING btree (company_id, node_id);


--
-- Name: idx_project_relationship_projection_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_relationship_projection_project ON public.project_relationship_projection USING btree (company_id, project_id, "position", lower(display_title), relationship_id);


--
-- Name: idx_project_relationship_projection_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_relationship_projection_relationship ON public.project_relationship_projection USING btree (company_id, relationship_id);


--
-- Name: idx_project_relationship_projection_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_relationship_projection_resource ON public.project_relationship_projection USING btree (company_id, resource_type, resource_id);


--
-- Name: idx_project_relationships_one_project_per_node; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_project_relationships_one_project_per_node ON public.project_relationships USING btree (company_id, resource_id) WHERE (resource_type = 'node'::text);


--
-- Name: idx_project_relationships_project_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_relationships_project_position ON public.project_relationships USING btree (company_id, project_id, "position", relationship_id);


--
-- Name: idx_project_relationships_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_relationships_resource ON public.project_relationships USING btree (company_id, resource_type, resource_id, project_id);


--
-- Name: idx_project_team_assignments_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_team_assignments_team ON public.project_team_assignments USING btree (company_id, team_id, project_id);


--
-- Name: idx_project_textbox_chats_email_selection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_textbox_chats_email_selection ON public.project_textbox_chats USING btree (company_id, selection_email_message_id) WHERE ((selection_email_message_id IS NOT NULL) AND (deleted_timestamp IS NULL));


--
-- Name: idx_project_textbox_chats_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_textbox_chats_parent ON public.project_textbox_chats USING btree (company_id, project_id, textbox_id, parent_chat_id) WHERE ((parent_chat_id IS NOT NULL) AND (deleted_timestamp IS NULL));


--
-- Name: idx_project_textbox_chats_textbox_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_textbox_chats_textbox_created ON public.project_textbox_chats USING btree (company_id, project_id, textbox_id, created_timestamp, chat_id) WHERE (deleted_timestamp IS NULL);


--
-- Name: idx_project_textboxes_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_textboxes_order ON public.project_textboxes USING btree (company_id, project_id, display_order, textbox_id) WHERE (deleted_timestamp IS NULL);


--
-- Name: idx_projects_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_company_name ON public.projects USING btree (company_id, lower(name), project_id);


--
-- Name: idx_projects_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_name_trgm ON public.projects USING gin (lower(name) public.gin_trgm_ops);


--
-- Name: idx_raci_tabs_folders_owner_role_parent_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_raci_tabs_folders_owner_role_parent_position ON public.raci_tabs_folders USING btree (company_id, user_id, role, parent_folder_id, "position", created_timestamp, name, folder_id);


--
-- Name: idx_raci_tabs_items_logic_gate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_raci_tabs_items_logic_gate ON public.raci_tabs_items USING btree (company_id, logic_gate_id, user_id);


--
-- Name: idx_raci_tabs_items_owner_role_folder_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_raci_tabs_items_owner_role_folder_position ON public.raci_tabs_items USING btree (company_id, user_id, role, folder_id, "position", created_timestamp, name, logic_gate_id);


--
-- Name: idx_entity_relationships_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_relationships_resource ON public.entity_relationships USING btree (company_id, resource_id, resource_type, entity_id);


--
-- Name: idx_entity_field_types_folder_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_entity_field_types_folder_name_unique ON public.entity_field_types USING btree (company_id, entity_type_id, entity_folder_id, lower(btrim((name)::text))) WHERE (entity_folder_id IS NOT NULL);


--
-- Name: idx_entity_field_types_root_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_entity_field_types_root_name_unique ON public.entity_field_types USING btree (company_id, entity_type_id, lower(btrim((name)::text))) WHERE (entity_folder_id IS NULL);


--
-- Name: idx_entity_field_types_scope_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_field_types_scope_position ON public.entity_field_types USING btree (company_id, entity_type_id, entity_folder_id, "position", lower((name)::text), entity_field_type_id);


--
-- Name: idx_entity_field_types_type_system_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_entity_field_types_type_system_key_unique ON public.entity_field_types USING btree (company_id, entity_type_id, system_key) WHERE (system_key IS NOT NULL);


--
-- Name: idx_entity_fields_entity_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_entity_fields_entity_name_unique ON public.entity_fields USING btree (company_id, entity_id, lower(btrim((name)::text)));


--
-- Name: idx_entity_fields_entity_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_fields_entity_position ON public.entity_fields USING btree (company_id, entity_id, "position", lower((name)::text), entity_field_id);


--
-- Name: idx_entity_fields_entity_field_type_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_entity_fields_entity_field_type_unique ON public.entity_fields USING btree (company_id, entity_id, entity_field_type_id) WHERE (entity_field_type_id IS NOT NULL);


--
-- Name: idx_entity_fields_field_type_link; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_fields_field_type_link ON public.entity_fields USING btree (company_id, entity_field_type_id, entity_id) WHERE (entity_field_type_id IS NOT NULL);


--
-- Name: idx_entity_folders_type_parent_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_folders_type_parent_position ON public.entity_folders USING btree (company_id, entity_type_id, parent_entity_folder_id, "position", lower((name)::text), entity_folder_id);


--
-- Name: idx_entity_types_company_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_entity_types_company_name_unique ON public.entity_types USING btree (company_id, lower(btrim((name)::text)));


--
-- Name: idx_entity_types_company_system_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_entity_types_company_system_key_unique ON public.entity_types USING btree (company_id, system_key) WHERE (system_key IS NOT NULL);


--
-- Name: idx_entities_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entities_name_trgm ON public.entities USING gin (lower((name)::text) public.gin_trgm_ops);


--
-- Name: idx_entities_type_folder_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entities_type_folder_position ON public.entities USING btree (company_id, entity_type_id, entity_folder_id, "position", lower((name)::text), entity_id);


--
-- Name: idx_realtime_outbox_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_realtime_outbox_claim ON public.realtime_outbox USING btree (outbox_sequence) WHERE (published_timestamp IS NULL);


--
-- Name: idx_realtime_outbox_published_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_realtime_outbox_published_sequence ON public.realtime_outbox USING btree (outbox_sequence) WHERE (published_timestamp IS NOT NULL);


--
-- Name: idx_realtime_outbox_scope_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_realtime_outbox_scope_sequence ON public.realtime_outbox USING btree (company_id, scope, outbox_sequence);


--
-- Name: idx_recycle_bin_items_company_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recycle_bin_items_company_deleted ON public.recycle_bin_items USING btree (company_id, deleted_timestamp DESC, recycle_bin_item_id DESC);


--
-- Name: idx_recycle_bin_items_company_user_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recycle_bin_items_company_user_deleted ON public.recycle_bin_items USING btree (company_id, deleted_by_user_id, deleted_timestamp DESC, recycle_bin_item_id DESC) WHERE (deleted_by_user_id IS NOT NULL);


--
-- Name: idx_resource_gvic_assignments_v2_one_role_per_principal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_resource_gvic_assignments_v2_one_role_per_principal ON public.resource_gvic_assignments USING btree (company_id, resource_type, resource_id, principal_type, principal_id);


--
-- Name: idx_resource_gvic_assignments_v2_principal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_gvic_assignments_v2_principal ON public.resource_gvic_assignments USING btree (company_id, principal_type, principal_id, role, resource_type, resource_id);


--
-- Name: idx_resource_gvic_settings_customized_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_gvic_settings_customized_sequence ON public.resource_gvic_settings USING btree (company_id, resource_type, resource_id, customized_sequence);


--
-- Name: idx_resource_gvic_settings_reset_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_gvic_settings_reset_sequence ON public.resource_gvic_settings USING btree (company_id, resource_type, resource_id, descendant_reset_sequence) WHERE (descendant_reset_sequence > 0);


--
-- Name: idx_resource_operational_relationships_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_operational_relationships_target ON public.resource_operational_relationships USING btree (company_id, target_resource_type, target_resource_id, resource_operational_relationship_id);


--
-- Name: idx_resource_permission_settings_customized_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_permission_settings_customized_sequence ON public.resource_permission_settings USING btree (company_id, resource_type, resource_id, customized_sequence);


--
-- Name: idx_resource_permission_settings_reset_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_permission_settings_reset_sequence ON public.resource_permission_settings USING btree (company_id, resource_type, resource_id, descendant_reset_sequence) WHERE (descendant_reset_sequence > 0);


--
-- Name: idx_resource_permissions_v2_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_permissions_v2_subject ON public.resource_permissions USING btree (company_id, subject_type, subject_id, access_level, resource_type, resource_id);


--
-- Name: idx_saved_views_group_principal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_views_group_principal ON public.saved_views USING btree (company_id, principal_id) WHERE (principal = 'group'::text);


--
-- Name: idx_saved_views_logic_gate_kanban_user_single; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_saved_views_logic_gate_kanban_user_single ON public.saved_views USING btree (company_id, surface, principal, principal_id) WHERE ((surface = 'logic_gate_kanban'::text) AND (principal = 'user'::text));


--
-- Name: idx_saved_views_surface_principal_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_views_surface_principal_position ON public.saved_views USING btree (company_id, surface, principal, principal_id, "position", saved_view_id);


--
-- Name: idx_shared_inbox_folders_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_inbox_folders_parent ON public.shared_inbox_folders USING btree (company_id, parent_folder_id, "position", created_timestamp);


--
-- Name: idx_shared_inboxes_account_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_inboxes_account_email ON public.shared_inboxes USING btree (company_id, account_email);


--
-- Name: idx_shared_inboxes_company_email_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_inboxes_company_email_connection ON public.shared_inboxes USING btree (company_id, company_email_connection_id);


--
-- Name: idx_shared_inboxes_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_inboxes_parent ON public.shared_inboxes USING btree (company_id, parent_folder_id, "position", created_timestamp);


--
-- Name: idx_user_logic_gate_shortcuts_user_company_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_logic_gate_shortcuts_user_company_position ON public.user_logic_gate_shortcuts USING btree (user_id, company_id, "position", logic_gate_id);


--
-- Name: idx_workspace_read_versions_scope_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_read_versions_scope_company ON public.workspace_read_versions USING btree (scope, company_id, resource_key);


--
-- Name: uq_kpis_owner_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_kpis_owner_identity ON public.kpis USING btree (company_id, logic_gate_id, kpi_id);


--
-- Name: attachment_relationships trg_attachment_relationships_lock_email_draft_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_attachment_relationships_lock_email_draft_owner BEFORE INSERT OR UPDATE OF company_id, resource_type, resource_id, deleted_timestamp ON public.attachment_relationships FOR EACH ROW EXECUTE FUNCTION public.mangorts_lock_live_email_draft_attachment_owner();


--
-- Name: attachment_relationships trg_attachment_relationships_validate_live_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_attachment_relationships_validate_live_owner BEFORE INSERT OR UPDATE OF company_id, attachment_id, resource_type, resource_id, deleted_timestamp ON public.attachment_relationships FOR EACH ROW EXECUTE FUNCTION public.mangorts_validate_attachment_relationship_owner();


--
-- Name: company_explorer_folders trg_cleanup_process_map_folder_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cleanup_process_map_folder_delete BEFORE DELETE ON public.company_explorer_folders FOR EACH ROW EXECUTE FUNCTION public.trg_cleanup_process_map_source_delete();


--
-- Name: logic_gates trg_cleanup_process_map_logic_gate_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cleanup_process_map_logic_gate_delete BEFORE DELETE ON public.logic_gates FOR EACH ROW EXECUTE FUNCTION public.trg_cleanup_process_map_source_delete();


--
-- Name: huddle_node_textboxes trg_huddle_node_editor_text_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_huddle_node_editor_text_limit BEFORE INSERT OR UPDATE OF company_id, huddle_node_id, textbox_id, body_json, deleted_timestamp ON public.huddle_node_textboxes FOR EACH ROW EXECUTE FUNCTION public.mangorts_enforce_huddle_node_editor_text_limit();


--
-- Name: huddle_explorer_folders trg_huddle_explorer_folder_cycle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_huddle_explorer_folder_cycle BEFORE INSERT OR UPDATE OF parent_folder_id ON public.huddle_explorer_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_validate_huddle_explorer_folder();


--
-- Name: huddle_explorer_items trg_huddle_explorer_item_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_huddle_explorer_item_validate BEFORE INSERT OR UPDATE OF company_id, huddle_type, resource_huddle_resource_id ON public.huddle_explorer_items FOR EACH ROW EXECUTE FUNCTION public.mangorts_validate_huddle_explorer_item();


--
-- Name: logic_gate_textboxes trg_logic_gate_editor_text_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_editor_text_limit BEFORE INSERT OR UPDATE OF company_id, logic_gate_id, textbox_id, body_json, deleted_timestamp ON public.logic_gate_textboxes FOR EACH ROW EXECUTE FUNCTION public.mangorts_enforce_logic_gate_editor_text_limit();


--
-- Name: node_logic_gate_assignments trg_logic_gate_work_version_assignments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_assignments AFTER INSERT OR DELETE OR UPDATE ON public.node_logic_gate_assignments FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_gate_row();


--
-- Name: company_explorer_folders trg_logic_gate_work_version_explorer_folder_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_explorer_folder_delete BEFORE DELETE ON public.company_explorer_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_explorer_folder();


--
-- Name: company_explorer_folders trg_logic_gate_work_version_explorer_folder_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_explorer_folder_update AFTER UPDATE OF parent_folder_id, default_access ON public.company_explorer_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_explorer_folder();


--
-- Name: company_explorer_items trg_logic_gate_work_version_explorer_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_explorer_items AFTER INSERT OR DELETE OR UPDATE ON public.company_explorer_items FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_explorer_item();


--
-- Name: logic_gates trg_logic_gate_work_version_gate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_gate AFTER UPDATE OF header, default_access ON public.logic_gates FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_gate_row();


--
-- Name: company_user_group_members trg_logic_gate_work_version_group_members; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_group_members AFTER INSERT OR DELETE OR UPDATE ON public.company_user_group_members FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_for_company();


--
-- Name: company_user_groups trg_logic_gate_work_version_groups; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_groups AFTER INSERT OR DELETE OR UPDATE ON public.company_user_groups FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_for_company();


--
-- Name: resource_gvic_assignments trg_logic_gate_work_version_gvic; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_gvic AFTER INSERT OR DELETE OR UPDATE ON public.resource_gvic_assignments FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_resource();


--
-- Name: company_memberships trg_logic_gate_work_version_memberships; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_memberships AFTER INSERT OR DELETE OR UPDATE ON public.company_memberships FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_for_company();


--
-- Name: nodes trg_logic_gate_work_version_nodes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_nodes AFTER UPDATE OF name, due_date, priority ON public.nodes FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_node();


--
-- Name: resource_permissions trg_logic_gate_work_version_permissions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_permissions AFTER INSERT OR DELETE OR UPDATE ON public.resource_permissions FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_resource();


--
-- Name: kanban_board_projection trg_logic_gate_work_version_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_projection AFTER INSERT OR DELETE OR UPDATE ON public.kanban_board_projection FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_logic_gate_work_from_gate_row();


--
-- Name: logic_gates trg_logic_gate_work_version_seed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_logic_gate_work_version_seed AFTER INSERT ON public.logic_gates FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_seed_logic_gate_work_version();


--
-- Name: node_textboxes trg_node_editor_text_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_editor_text_limit BEFORE INSERT OR UPDATE OF company_id, node_id, textbox_id, body_json, deleted_timestamp ON public.node_textboxes FOR EACH ROW EXECUTE FUNCTION public.mangorts_enforce_node_editor_text_limit();


--
-- Name: node_account_assignments trg_node_view_version_account_assignments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_account_assignments AFTER INSERT OR DELETE OR UPDATE ON public.node_account_assignments FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_direct_node();


--
-- Name: accounts trg_node_view_version_accounts_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_accounts_delete BEFORE DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_account();


--
-- Name: accounts trg_node_view_version_accounts_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_accounts_update AFTER UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_account();


--
-- Name: company_explorer_folders trg_node_view_version_explorer_folder_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_explorer_folder_delete BEFORE DELETE ON public.company_explorer_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_explorer_folder();


--
-- Name: company_explorer_folders trg_node_view_version_explorer_folder_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_explorer_folder_update AFTER UPDATE OF parent_folder_id, default_access ON public.company_explorer_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_explorer_folder();


--
-- Name: company_explorer_items trg_node_view_version_explorer_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_explorer_items AFTER INSERT OR DELETE OR UPDATE ON public.company_explorer_items FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_explorer_item();


--
-- Name: node_logic_gate_assignments trg_node_view_version_logic_gate_assignments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_logic_gate_assignments AFTER INSERT OR DELETE OR UPDATE ON public.node_logic_gate_assignments FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_direct_node();


--
-- Name: nodes trg_node_view_version_node; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_node AFTER UPDATE ON public.nodes FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_node();


--
-- Name: node_relationships trg_node_view_version_relationships; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_relationships AFTER INSERT OR DELETE OR UPDATE ON public.node_relationships FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_relationship();


--
-- Name: nodes trg_node_view_version_seed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_seed AFTER INSERT ON public.nodes FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_seed_node_view_version();


--
-- Name: node_textbox_chats trg_node_view_version_textbox_chats; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_textbox_chats AFTER INSERT OR DELETE OR UPDATE ON public.node_textbox_chats FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_direct_node();


--
-- Name: node_textboxes trg_node_view_version_textboxes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_textboxes AFTER INSERT OR DELETE OR UPDATE ON public.node_textboxes FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_direct_node();


--
-- Name: node_timeline_events trg_node_view_version_timeline_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_timeline_events AFTER INSERT OR DELETE OR UPDATE ON public.node_timeline_events FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_direct_node();


--
-- Name: node_timeline_verification_recipients trg_node_view_version_timeline_recipients; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_node_view_version_timeline_recipients AFTER INSERT OR DELETE OR UPDATE ON public.node_timeline_verification_recipients FOR EACH ROW EXECUTE FUNCTION public.mangorts_trg_bump_node_view_from_direct_node();


--
-- Name: project_textboxes trg_project_editor_text_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_project_editor_text_limit BEFORE INSERT OR UPDATE OF company_id, project_id, textbox_id, body_json, deleted_timestamp ON public.project_textboxes FOR EACH ROW EXECUTE FUNCTION public.mangorts_enforce_project_editor_text_limit();


--
-- Name: email_relationships trg_protect_email_relationship_dependencies; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_protect_email_relationship_dependencies AFTER DELETE OR UPDATE OF company_id, email_thread_id, email_message_id, resource_type, resource_id, resource_textbox_id ON public.email_relationships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mangorts_protect_email_relationship_dependencies();


--
-- Name: nodes trg_protect_node_shared_email_draft_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_node_shared_email_draft_owner BEFORE DELETE OR UPDATE OF company_id, node_id ON public.nodes FOR EACH ROW EXECUTE FUNCTION public.mangorts_protect_shared_email_draft_owner();


--
-- Name: projects trg_protect_project_shared_email_draft_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_project_shared_email_draft_owner BEFORE DELETE OR UPDATE OF company_id, project_id ON public.projects FOR EACH ROW EXECUTE FUNCTION public.mangorts_protect_shared_email_draft_owner();


--
-- Name: email_relationships trg_protect_shared_email_draft_relationship; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_protect_shared_email_draft_relationship AFTER DELETE OR UPDATE OF company_id, email_message_id, resource_type, resource_id, resource_textbox_id ON public.email_relationships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mangorts_protect_shared_email_draft_relationship();


--
-- Name: resource_gvic_assignments trg_resource_gvic_assignments_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_resource_gvic_assignments_validate BEFORE INSERT OR UPDATE ON public.resource_gvic_assignments FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_validate_policy_edge();


--
-- Name: resource_gvic_settings trg_resource_gvic_settings_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_resource_gvic_settings_validate BEFORE INSERT OR UPDATE ON public.resource_gvic_settings FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_validate_policy_settings();


--
-- Name: resource_permission_settings trg_resource_permission_settings_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_resource_permission_settings_validate BEFORE INSERT OR UPDATE ON public.resource_permission_settings FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_validate_policy_settings();


--
-- Name: resource_permissions trg_resource_permissions_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_resource_permissions_validate BEFORE INSERT OR UPDATE ON public.resource_permissions FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_validate_policy_edge();


--
-- Name: domain_events trg_update_workspace_read_versions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_workspace_read_versions AFTER INSERT ON public.domain_events FOR EACH ROW EXECUTE FUNCTION public.trg_update_workspace_read_versions();


--
-- Name: company_explorer_folders trg_v2_company_folder_policy_parent_after_save; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_company_folder_policy_parent_after_save AFTER INSERT OR UPDATE OF parent_folder_id ON public.company_explorer_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_folder_parent_saved('company_explorer_folder');


--
-- Name: company_explorer_folders trg_v2_company_folder_policy_parent_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_company_folder_policy_parent_before_update BEFORE UPDATE OF parent_folder_id ON public.company_explorer_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_folder_parent_changing('company_explorer_folder');


--
-- Name: company_explorer_items trg_v2_company_item_policy_parent_after_save; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_company_item_policy_parent_after_save AFTER INSERT OR UPDATE OF parent_folder_id ON public.company_explorer_items FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_company_item_parent_saved();


--
-- Name: company_explorer_items trg_v2_company_item_policy_parent_before_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_company_item_policy_parent_before_delete BEFORE DELETE ON public.company_explorer_items FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_company_item_parent_changed();


--
-- Name: company_explorer_items trg_v2_company_item_policy_parent_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_company_item_policy_parent_before_update BEFORE UPDATE OF parent_folder_id ON public.company_explorer_items FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_company_item_parent_changed();


--
-- Name: company_user_group_members trg_v2_group_member_policy_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_group_member_policy_version AFTER INSERT OR DELETE OR UPDATE ON public.company_user_group_members FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_group_policy_changed();


--
-- Name: company_user_groups trg_v2_group_policy_cleanup; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_group_policy_cleanup BEFORE DELETE ON public.company_user_groups FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_group_deleted_cleanup();


--
-- Name: company_user_groups trg_v2_group_policy_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_group_policy_version AFTER INSERT OR DELETE OR UPDATE ON public.company_user_groups FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_group_policy_changed();


--
-- Name: node_logic_gate_assignments trg_v2_node_policy_parent_after_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_node_policy_parent_after_delete AFTER DELETE ON public.node_logic_gate_assignments FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_node_parent_link_removed();


--
-- Name: node_logic_gate_assignments trg_v2_node_policy_parent_after_save; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_node_policy_parent_after_save AFTER INSERT OR UPDATE OF logic_gate_id ON public.node_logic_gate_assignments FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_node_parent_link_changed();


--
-- Name: node_logic_gate_assignments trg_v2_node_policy_parent_before_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_node_policy_parent_before_delete BEFORE DELETE ON public.node_logic_gate_assignments FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_node_parent_link_changed();


--
-- Name: company_explorer_folders trg_v2_policy_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_policy_delete AFTER DELETE ON public.company_explorer_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_resource_deleted_cleanup('company_explorer_folder', 'folder_id');


--
-- Name: logic_gates trg_v2_policy_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_policy_delete AFTER DELETE ON public.logic_gates FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_resource_deleted_cleanup('logic_gate', 'logic_gate_id');


--
-- Name: nodes trg_v2_policy_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_policy_delete AFTER DELETE ON public.nodes FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_resource_deleted_cleanup('node', 'node_id');


--
-- Name: projects trg_v2_policy_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_policy_delete AFTER DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_resource_deleted_cleanup('project', 'project_id');


--
-- Name: shared_inbox_folders trg_v2_policy_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_policy_delete AFTER DELETE ON public.shared_inbox_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_resource_deleted_cleanup('shared_inbox_folder', 'folder_id');


--
-- Name: shared_inboxes trg_v2_policy_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_policy_delete AFTER DELETE ON public.shared_inboxes FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_resource_deleted_cleanup('shared_inbox', 'shared_inbox_id');


--
-- Name: company_explorer_folders trg_v2_policy_initialize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_v2_policy_initialize AFTER INSERT ON public.company_explorer_folders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_initialize_policy_settings('company_explorer_folder', 'folder_id');


--
-- Name: logic_gates trg_v2_policy_initialize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_v2_policy_initialize AFTER INSERT ON public.logic_gates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_initialize_policy_settings('logic_gate', 'logic_gate_id');


--
-- Name: nodes trg_v2_policy_initialize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_v2_policy_initialize AFTER INSERT ON public.nodes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_initialize_policy_settings('node', 'node_id');


--
-- Name: projects trg_v2_policy_initialize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_v2_policy_initialize AFTER INSERT ON public.projects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_initialize_policy_settings('project', 'project_id');


--
-- Name: shared_inbox_folders trg_v2_policy_initialize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_v2_policy_initialize AFTER INSERT ON public.shared_inbox_folders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_initialize_policy_settings('shared_inbox_folder', 'folder_id');


--
-- Name: shared_inboxes trg_v2_policy_initialize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_v2_policy_initialize AFTER INSERT ON public.shared_inboxes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_initialize_policy_settings('shared_inbox', 'shared_inbox_id');


--
-- Name: shared_inbox_folders trg_v2_shared_folder_policy_parent_after_save; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_shared_folder_policy_parent_after_save AFTER INSERT OR UPDATE OF parent_folder_id ON public.shared_inbox_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_folder_parent_saved('shared_inbox_folder');


--
-- Name: shared_inbox_folders trg_v2_shared_folder_policy_parent_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_shared_folder_policy_parent_before_update BEFORE UPDATE OF parent_folder_id ON public.shared_inbox_folders FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_folder_parent_changing('shared_inbox_folder');


--
-- Name: shared_inboxes trg_v2_shared_inbox_policy_parent_after_save; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_shared_inbox_policy_parent_after_save AFTER INSERT OR UPDATE OF parent_folder_id ON public.shared_inboxes FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_shared_inbox_parent_saved();


--
-- Name: shared_inboxes trg_v2_shared_inbox_policy_parent_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_shared_inbox_policy_parent_before_update BEFORE UPDATE OF parent_folder_id ON public.shared_inboxes FOR EACH ROW EXECUTE FUNCTION public.mangorts_v2_shared_inbox_parent_changing();


--
-- Name: email_drafts trg_validate_email_draft_shared_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_email_draft_shared_owner BEFORE INSERT OR UPDATE OF company_id, shared_resource_type, shared_resource_id, source_email_message_id, deleted_timestamp ON public.email_drafts FOR EACH ROW EXECUTE FUNCTION public.mangorts_validate_email_draft_shared_owner();


--
-- Name: email_relationships trg_validate_email_relationship_resource; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_validate_email_relationship_resource AFTER INSERT OR UPDATE OF company_id, resource_type, resource_id, resource_textbox_id ON public.email_relationships DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.mangorts_validate_email_relationship_resource();


--
-- Name: email_relationships trg_validate_email_textbox_relationship_has_wide_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_validate_email_textbox_relationship_has_wide_owner AFTER INSERT OR UPDATE OF company_id, email_thread_id, resource_type, resource_id, resource_textbox_id ON public.email_relationships DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.mangorts_validate_email_textbox_relationship_has_wide_owner();


--
-- Name: node_textbox_chats trg_validate_node_email_chat_relationship; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_validate_node_email_chat_relationship AFTER INSERT OR UPDATE OF company_id, node_id, textbox_id, selection_source, selection_email_message_id, deleted_timestamp ON public.node_textbox_chats DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.mangorts_validate_node_email_chat_relationship();


--
-- Name: process_map_placements trg_validate_process_map_placement; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_process_map_placement BEFORE INSERT OR UPDATE OF company_id, resource_type, resource_id, map_parent_folder_id ON public.process_map_placements FOR EACH ROW EXECUTE FUNCTION public.trg_validate_process_map_placement();


--
-- Name: project_textbox_chats trg_validate_project_email_chat_relationship; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_validate_project_email_chat_relationship AFTER INSERT OR UPDATE OF company_id, project_id, textbox_id, selection_source, selection_email_message_id, deleted_timestamp ON public.project_textbox_chats DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.mangorts_validate_project_email_chat_relationship();


--
-- Name: resource_operational_relationships trg_validate_resource_operational_relationship; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_resource_operational_relationship BEFORE INSERT OR UPDATE ON public.resource_operational_relationships FOR EACH ROW EXECUTE FUNCTION public.trg_validate_resource_operational_relationship();


--
-- Name: resource_gvic_assignments trg_zz_raci_tabs_assignment_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zz_raci_tabs_assignment_changed AFTER INSERT OR DELETE OR UPDATE ON public.resource_gvic_assignments FOR EACH ROW EXECUTE FUNCTION public.mangorts_raci_tabs_policy_changed();


--
-- Name: company_explorer_folders trg_zz_raci_tabs_explorer_folder_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zz_raci_tabs_explorer_folder_changed AFTER UPDATE OF parent_folder_id ON public.company_explorer_folders FOR EACH ROW WHEN ((old.parent_folder_id IS DISTINCT FROM new.parent_folder_id)) EXECUTE FUNCTION public.mangorts_raci_tabs_explorer_folder_changed();


--
-- Name: company_explorer_items trg_zz_raci_tabs_explorer_item_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zz_raci_tabs_explorer_item_changed AFTER INSERT OR DELETE OR UPDATE OF parent_folder_id, target_id, target_type ON public.company_explorer_items FOR EACH ROW EXECUTE FUNCTION public.mangorts_raci_tabs_explorer_item_changed();


--
-- Name: company_user_groups trg_zz_raci_tabs_group_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zz_raci_tabs_group_changed AFTER DELETE OR UPDATE OF parent_group_id ON public.company_user_groups FOR EACH ROW EXECUTE FUNCTION public.mangorts_raci_tabs_group_changed();


--
-- Name: company_user_group_members trg_zz_raci_tabs_group_member_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zz_raci_tabs_group_member_changed AFTER INSERT OR DELETE OR UPDATE ON public.company_user_group_members FOR EACH ROW EXECUTE FUNCTION public.mangorts_raci_tabs_group_member_changed();


--
-- Name: logic_gates trg_zz_raci_tabs_logic_gate_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zz_raci_tabs_logic_gate_changed AFTER INSERT OR DELETE OR UPDATE OF header ON public.logic_gates FOR EACH ROW EXECUTE FUNCTION public.mangorts_raci_tabs_logic_gate_changed();


--
-- Name: company_memberships trg_zz_raci_tabs_membership_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zz_raci_tabs_membership_changed AFTER INSERT ON public.company_memberships FOR EACH ROW EXECUTE FUNCTION public.mangorts_raci_tabs_membership_added();


--
-- Name: resource_gvic_settings trg_zz_raci_tabs_setting_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zz_raci_tabs_setting_changed AFTER INSERT OR DELETE OR UPDATE ON public.resource_gvic_settings FOR EACH ROW EXECUTE FUNCTION public.mangorts_raci_tabs_policy_changed();


--
-- Name: entity_types trg_protect_action_item_entity_type; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_action_item_entity_type BEFORE INSERT OR DELETE OR UPDATE ON public.entity_types FOR EACH ROW EXECUTE FUNCTION public.mangorts_protect_action_item_entity_type();


--
-- Name: entity_field_types trg_protect_action_item_field_type; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_action_item_field_type BEFORE INSERT OR DELETE OR UPDATE ON public.entity_field_types FOR EACH ROW EXECUTE FUNCTION public.mangorts_protect_action_item_field_type();


--
-- Name: entity_fields trg_maintain_entity_field_template_link; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_maintain_entity_field_template_link BEFORE INSERT OR UPDATE OF company_id, entity_id, entity_field_type_id, field_type, value_jsonb ON public.entity_fields FOR EACH ROW EXECUTE FUNCTION public.mangorts_maintain_entity_field_template_link();


--
-- Name: company_memberships trg_clear_entity_person_fields_for_membership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clear_entity_person_fields_for_membership AFTER DELETE ON public.company_memberships FOR EACH ROW EXECUTE FUNCTION public.mangorts_clear_entity_person_fields_for_membership();


--
-- Name: entity_fields trg_protect_action_item_entity_field; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_action_item_entity_field BEFORE INSERT OR DELETE OR UPDATE ON public.entity_fields FOR EACH ROW EXECUTE FUNCTION public.mangorts_protect_action_item_entity_field();


--
-- Name: entity_field_types trg_unlink_entity_fields_after_template_retype; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_unlink_entity_fields_after_template_retype AFTER UPDATE OF field_type ON public.entity_field_types FOR EACH ROW WHEN ((old.field_type IS DISTINCT FROM new.field_type)) EXECUTE FUNCTION public.mangorts_unlink_entity_fields_after_template_retype();


--
-- Name: entity_relationships trg_validate_entity_relationship; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_entity_relationship BEFORE INSERT OR UPDATE ON public.entity_relationships FOR EACH ROW EXECUTE FUNCTION public.mangorts_validate_entity_relationship();


--
-- Name: huddle_nodes trg_delete_huddle_node_entity_relationships; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_delete_huddle_node_entity_relationships AFTER DELETE ON public.huddle_nodes FOR EACH ROW EXECUTE FUNCTION public.mangorts_delete_entity_relationships_for_huddle_resource();


--
-- Name: huddle_logic_gates trg_delete_huddle_logic_gate_entity_relationships; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_delete_huddle_logic_gate_entity_relationships AFTER DELETE ON public.huddle_logic_gates FOR EACH ROW EXECUTE FUNCTION public.mangorts_delete_entity_relationships_for_huddle_resource();


--
-- Name: account_folders account_folders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_folders
    ADD CONSTRAINT account_folders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: accounts accounts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: attachment_previews attachment_previews_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_previews
    ADD CONSTRAINT attachment_previews_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES public.attachments(attachment_id) ON DELETE CASCADE;


--
-- Name: attachment_relationships attachment_relationships_company_id_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_relationships
    ADD CONSTRAINT attachment_relationships_company_id_attachment_id_fkey FOREIGN KEY (company_id, attachment_id) REFERENCES public.attachments(company_id, attachment_id) ON DELETE CASCADE;


--
-- Name: attachment_relationships attachment_relationships_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_relationships
    ADD CONSTRAINT attachment_relationships_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: attachment_relationships attachment_relationships_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_relationships
    ADD CONSTRAINT attachment_relationships_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: attachment_upload_jobs attachment_upload_jobs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_upload_jobs
    ADD CONSTRAINT attachment_upload_jobs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: attachment_upload_jobs attachment_upload_jobs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_upload_jobs
    ADD CONSTRAINT attachment_upload_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: attachment_upload_parts attachment_upload_parts_upload_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_upload_parts
    ADD CONSTRAINT attachment_upload_parts_upload_job_id_fkey FOREIGN KEY (upload_job_id) REFERENCES public.attachment_upload_jobs(upload_job_id) ON DELETE CASCADE;


--
-- Name: attachments attachments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: attachments attachments_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: communications_email_archive_jobs communications_email_archive_j_company_email_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_email_archive_jobs
    ADD CONSTRAINT communications_email_archive_j_company_email_connection_id_fkey FOREIGN KEY (company_email_connection_id) REFERENCES public.email_connections(email_connection_id) ON DELETE SET NULL;


--
-- Name: communications_email_archive_jobs communications_email_archive_jo_company_id_shared_inbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_email_archive_jobs
    ADD CONSTRAINT communications_email_archive_jo_company_id_shared_inbox_id_fkey FOREIGN KEY (company_id, shared_inbox_id) REFERENCES public.shared_inboxes(company_id, shared_inbox_id) ON DELETE CASCADE;


--
-- Name: communications_email_archive_job_items communications_email_archive_job_items_archive_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_email_archive_job_items
    ADD CONSTRAINT communications_email_archive_job_items_archive_job_id_fkey FOREIGN KEY (archive_job_id) REFERENCES public.communications_email_archive_jobs(archive_job_id) ON DELETE CASCADE;


--
-- Name: communications_email_archive_jobs communications_email_archive_jobs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_email_archive_jobs
    ADD CONSTRAINT communications_email_archive_jobs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: communications_email_archive_jobs communications_email_archive_jobs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_email_archive_jobs
    ADD CONSTRAINT communications_email_archive_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: communications_message_read_receipt_signals communications_message_read_r_receipt_scope_type_receipt_s_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_message_read_receipt_signals
    ADD CONSTRAINT communications_message_read_r_receipt_scope_type_receipt_s_fkey FOREIGN KEY (receipt_scope_type, receipt_scope_id, message_id) REFERENCES public.communications_message_read_receipt_summaries(receipt_scope_type, receipt_scope_id, message_id) ON DELETE CASCADE;


--
-- Name: communications_message_read_receipt_summaries communications_message_read_re_company_email_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_message_read_receipt_summaries
    ADD CONSTRAINT communications_message_read_re_company_email_connection_id_fkey FOREIGN KEY (company_email_connection_id) REFERENCES public.email_connections(email_connection_id) ON DELETE CASCADE;


--
-- Name: communications_message_read_receipt_summaries communications_message_read_receipt_summaries_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_message_read_receipt_summaries
    ADD CONSTRAINT communications_message_read_receipt_summaries_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: communications_message_read_receipt_summaries communications_message_read_receipt_summaries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_message_read_receipt_summaries
    ADD CONSTRAINT communications_message_read_receipt_summaries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: communications_triage_items communications_triage_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_triage_items
    ADD CONSTRAINT communications_triage_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: company_explorer_folders company_explorer_folders_company_id_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_explorer_folders
    ADD CONSTRAINT company_explorer_folders_company_id_parent_folder_id_fkey FOREIGN KEY (company_id, parent_folder_id) REFERENCES public.company_explorer_folders(company_id, folder_id) ON DELETE CASCADE;


--
-- Name: company_explorer_folders company_explorer_folders_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_explorer_folders
    ADD CONSTRAINT company_explorer_folders_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: company_explorer_items company_explorer_items_company_id_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_explorer_items
    ADD CONSTRAINT company_explorer_items_company_id_parent_folder_id_fkey FOREIGN KEY (company_id, parent_folder_id) REFERENCES public.company_explorer_folders(company_id, folder_id) ON DELETE CASCADE;


--
-- Name: company_explorer_items company_explorer_items_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_explorer_items
    ADD CONSTRAINT company_explorer_items_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: company_memberships company_memberships_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_memberships
    ADD CONSTRAINT company_memberships_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: company_memberships company_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_memberships
    ADD CONSTRAINT company_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: company_user_group_members company_user_group_members_company_id_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_user_group_members
    ADD CONSTRAINT company_user_group_members_company_id_group_id_fkey FOREIGN KEY (company_id, group_id) REFERENCES public.company_user_groups(company_id, group_id) ON DELETE CASCADE;


--
-- Name: company_user_group_members company_user_group_members_company_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_user_group_members
    ADD CONSTRAINT company_user_group_members_company_id_user_id_fkey FOREIGN KEY (company_id, user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE CASCADE;


--
-- Name: company_user_groups company_user_groups_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_user_groups
    ADD CONSTRAINT company_user_groups_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: company_user_groups company_user_groups_company_id_parent_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_user_groups
    ADD CONSTRAINT company_user_groups_company_id_parent_group_id_fkey FOREIGN KEY (company_id, parent_group_id) REFERENCES public.company_user_groups(company_id, group_id) ON DELETE CASCADE;


--
-- Name: domain_events domain_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_events
    ADD CONSTRAINT domain_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: email_connections email_connections_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: email_connections email_connections_connected_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_connected_by_user_id_fkey FOREIGN KEY (connected_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: email_connections email_connections_personal_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_personal_user_id_fkey FOREIGN KEY (personal_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: email_drafts email_drafts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_drafts
    ADD CONSTRAINT email_drafts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: email_drafts email_drafts_company_id_source_email_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_drafts
    ADD CONSTRAINT email_drafts_company_id_source_email_message_id_fkey FOREIGN KEY (company_id, source_email_message_id) REFERENCES public.email_messages(company_id, email_message_id) ON DELETE RESTRICT;


--
-- Name: email_drafts email_drafts_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_drafts
    ADD CONSTRAINT email_drafts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: email_drafts email_drafts_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_drafts
    ADD CONSTRAINT email_drafts_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: email_ingestion_jobs email_ingestion_jobs_company_id_email_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_ingestion_jobs
    ADD CONSTRAINT email_ingestion_jobs_company_id_email_connection_id_fkey FOREIGN KEY (company_id, email_connection_id) REFERENCES public.email_connections(company_id, email_connection_id) ON DELETE CASCADE;


--
-- Name: email_ingestion_jobs email_ingestion_jobs_company_id_email_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_ingestion_jobs
    ADD CONSTRAINT email_ingestion_jobs_company_id_email_thread_id_fkey FOREIGN KEY (company_id, email_thread_id) REFERENCES public.email_threads(company_id, email_thread_id) ON DELETE SET NULL;


--
-- Name: email_messages email_messages_company_id_email_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_company_id_email_thread_id_fkey FOREIGN KEY (company_id, email_thread_id) REFERENCES public.email_threads(company_id, email_thread_id) ON DELETE CASCADE;


--
-- Name: email_relationships email_relationships_company_id_email_thread_id_email_messa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_relationships
    ADD CONSTRAINT email_relationships_company_id_email_thread_id_email_messa_fkey FOREIGN KEY (company_id, email_thread_id, email_message_id) REFERENCES public.email_messages(company_id, email_thread_id, email_message_id) ON DELETE CASCADE;


--
-- Name: email_signatures email_signatures_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_signatures
    ADD CONSTRAINT email_signatures_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: email_signatures email_signatures_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_signatures
    ADD CONSTRAINT email_signatures_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: email_signatures email_signatures_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_signatures
    ADD CONSTRAINT email_signatures_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: email_threads email_threads_company_id_email_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_threads
    ADD CONSTRAINT email_threads_company_id_email_connection_id_fkey FOREIGN KEY (company_id, email_connection_id) REFERENCES public.email_connections(company_id, email_connection_id) ON DELETE CASCADE;


--
-- Name: email_threads email_threads_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_threads
    ADD CONSTRAINT email_threads_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: huddle_explorer_folders huddle_explorer_folders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_explorer_folders
    ADD CONSTRAINT huddle_explorer_folders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: huddle_explorer_folders huddle_explorer_folders_company_id_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_explorer_folders
    ADD CONSTRAINT huddle_explorer_folders_company_id_parent_folder_id_fkey FOREIGN KEY (company_id, parent_folder_id) REFERENCES public.huddle_explorer_folders(company_id, folder_id) ON DELETE RESTRICT;


--
-- Name: huddle_explorer_items huddle_explorer_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_explorer_items
    ADD CONSTRAINT huddle_explorer_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: huddle_explorer_items huddle_explorer_items_company_id_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_explorer_items
    ADD CONSTRAINT huddle_explorer_items_company_id_parent_folder_id_fkey FOREIGN KEY (company_id, parent_folder_id) REFERENCES public.huddle_explorer_folders(company_id, folder_id) ON DELETE RESTRICT;


--
-- Name: huddle_logic_gate_relationships huddle_logic_gate_relationshi_company_id_huddle_logic_gate_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_logic_gate_relationships
    ADD CONSTRAINT huddle_logic_gate_relationshi_company_id_huddle_logic_gate_fkey FOREIGN KEY (company_id, huddle_logic_gate_id) REFERENCES public.huddle_logic_gates(company_id, huddle_logic_gate_id) ON DELETE CASCADE;


--
-- Name: huddle_logic_gate_relationships huddle_logic_gate_relationships_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_logic_gate_relationships
    ADD CONSTRAINT huddle_logic_gate_relationships_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: huddle_logic_gates huddle_logic_gates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_logic_gates
    ADD CONSTRAINT huddle_logic_gates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: huddle_node_kpi_relationships huddle_node_kpi_relationships_company_id_huddle_node_id_lo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_kpi_relationships
    ADD CONSTRAINT huddle_node_kpi_relationships_company_id_huddle_node_id_lo_fkey FOREIGN KEY (company_id, huddle_node_id, logic_gate_id) REFERENCES public.huddle_node_logic_gate_relationships(company_id, huddle_node_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: huddle_node_kpi_relationships huddle_node_kpi_relationships_company_id_logic_gate_id_kpi_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_kpi_relationships
    ADD CONSTRAINT huddle_node_kpi_relationships_company_id_logic_gate_id_kpi_fkey FOREIGN KEY (company_id, logic_gate_id, kpi_id) REFERENCES public.kpis(company_id, logic_gate_id, kpi_id) ON DELETE CASCADE;


--
-- Name: huddle_node_logic_gate_relationships huddle_node_logic_gate_relations_company_id_huddle_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_logic_gate_relationships
    ADD CONSTRAINT huddle_node_logic_gate_relations_company_id_huddle_node_id_fkey FOREIGN KEY (company_id, huddle_node_id) REFERENCES public.huddle_nodes(company_id, huddle_node_id) ON DELETE CASCADE;


--
-- Name: huddle_node_logic_gate_relationships huddle_node_logic_gate_relationsh_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_logic_gate_relationships
    ADD CONSTRAINT huddle_node_logic_gate_relationsh_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: huddle_node_textbox_chats huddle_node_textbox_chats_author_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_textbox_chats
    ADD CONSTRAINT huddle_node_textbox_chats_author_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: huddle_node_textbox_chats huddle_node_textbox_chats_parent_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_textbox_chats
    ADD CONSTRAINT huddle_node_textbox_chats_parent_fkey FOREIGN KEY (company_id, huddle_node_id, textbox_id, parent_chat_id) REFERENCES public.huddle_node_textbox_chats(company_id, huddle_node_id, textbox_id, chat_id) ON DELETE CASCADE;


--
-- Name: huddle_node_textbox_chats huddle_node_textbox_chats_textbox_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_textbox_chats
    ADD CONSTRAINT huddle_node_textbox_chats_textbox_fkey FOREIGN KEY (company_id, huddle_node_id, textbox_id) REFERENCES public.huddle_node_textboxes(company_id, huddle_node_id, textbox_id) ON DELETE CASCADE;


--
-- Name: huddle_node_textboxes huddle_node_textboxes_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_node_textboxes
    ADD CONSTRAINT huddle_node_textboxes_owner_fkey FOREIGN KEY (company_id, huddle_node_id) REFERENCES public.huddle_nodes(company_id, huddle_node_id) ON DELETE CASCADE;


--
-- Name: huddle_nodes huddle_nodes_company_id_huddle_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.huddle_nodes
    ADD CONSTRAINT huddle_nodes_company_id_huddle_logic_gate_id_fkey FOREIGN KEY (company_id, huddle_logic_gate_id) REFERENCES public.huddle_logic_gates(company_id, huddle_logic_gate_id) ON DELETE RESTRICT;


--
-- Name: invitations invitations_accepted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES public.users(user_id);


--
-- Name: invitations invitations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: invitations invitations_invited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES public.users(user_id);


--
-- Name: kanban_board_projection kanban_board_projection_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_board_projection
    ADD CONSTRAINT kanban_board_projection_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: kanban_board_projection kanban_board_projection_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_board_projection
    ADD CONSTRAINT kanban_board_projection_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: kpis kpis_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis
    ADD CONSTRAINT kpis_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: scorecards scorecards_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorecards
    ADD CONSTRAINT scorecards_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: scorecards scorecards_rated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scorecards
    ADD CONSTRAINT scorecards_rated_by_user_id_fkey FOREIGN KEY (rated_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: logic_gate_textboxes logic_gate_textboxes_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logic_gate_textboxes
    ADD CONSTRAINT logic_gate_textboxes_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: logic_gate_textboxes_history logic_gate_textboxes_history_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logic_gate_textboxes_history
    ADD CONSTRAINT logic_gate_textboxes_history_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: logic_gate_textboxes_history logic_gate_textboxes_history_saved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logic_gate_textboxes_history
    ADD CONSTRAINT logic_gate_textboxes_history_saved_by_user_id_fkey FOREIGN KEY (saved_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: logic_gate_work_versions logic_gate_work_versions_logic_gate_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logic_gate_work_versions
    ADD CONSTRAINT logic_gate_work_versions_logic_gate_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: node_account_assignments node_account_assignments_company_id_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_account_assignments
    ADD CONSTRAINT node_account_assignments_company_id_account_id_fkey FOREIGN KEY (company_id, account_id) REFERENCES public.accounts(company_id, account_id) ON DELETE CASCADE;


--
-- Name: node_account_assignments node_account_assignments_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_account_assignments
    ADD CONSTRAINT node_account_assignments_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: node_logic_gate_assignments node_logic_gate_assignments_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_logic_gate_assignments
    ADD CONSTRAINT node_logic_gate_assignments_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: node_logic_gate_assignments node_logic_gate_assignments_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_logic_gate_assignments
    ADD CONSTRAINT node_logic_gate_assignments_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: node_logic_gate_assignments node_logic_gate_assignments_placed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_logic_gate_assignments
    ADD CONSTRAINT node_logic_gate_assignments_placed_by_user_id_fkey FOREIGN KEY (company_id, placed_by_user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE SET NULL (placed_by_user_id);


--
-- Name: node_logic_gate_assignments node_logic_gate_assignments_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_logic_gate_assignments
    ADD CONSTRAINT node_logic_gate_assignments_requested_by_user_id_fkey FOREIGN KEY (company_id, requested_by_user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE SET NULL (requested_by_user_id);


--
-- Name: node_relationships node_relationships_company_id_node_id_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_relationships
    ADD CONSTRAINT node_relationships_company_id_node_id_a_fkey FOREIGN KEY (company_id, node_id_a) REFERENCES public.nodes(company_id, node_id);


--
-- Name: node_relationships node_relationships_company_id_node_id_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_relationships
    ADD CONSTRAINT node_relationships_company_id_node_id_b_fkey FOREIGN KEY (company_id, node_id_b) REFERENCES public.nodes(company_id, node_id);


--
-- Name: node_textbox_chats node_textbox_chats_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textbox_chats
    ADD CONSTRAINT node_textbox_chats_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: node_textbox_chats node_textbox_chats_company_id_node_id_textbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textbox_chats
    ADD CONSTRAINT node_textbox_chats_company_id_node_id_textbox_id_fkey FOREIGN KEY (company_id, node_id, textbox_id) REFERENCES public.node_textboxes(company_id, node_id, textbox_id) ON DELETE CASCADE;


--
-- Name: node_textbox_chats node_textbox_chats_company_id_node_id_textbox_id_parent_ch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textbox_chats
    ADD CONSTRAINT node_textbox_chats_company_id_node_id_textbox_id_parent_ch_fkey FOREIGN KEY (company_id, node_id, textbox_id, parent_chat_id) REFERENCES public.node_textbox_chats(company_id, node_id, textbox_id, chat_id) ON DELETE CASCADE;


--
-- Name: node_textboxes node_textboxes_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textboxes
    ADD CONSTRAINT node_textboxes_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: node_textboxes_history node_textboxes_history_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textboxes_history
    ADD CONSTRAINT node_textboxes_history_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: node_textboxes_history node_textboxes_history_saved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_textboxes_history
    ADD CONSTRAINT node_textboxes_history_saved_by_user_id_fkey FOREIGN KEY (saved_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: node_timeline_events node_timeline_events_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_timeline_events
    ADD CONSTRAINT node_timeline_events_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: node_timeline_verification_recipients node_timeline_verification_rec_company_id_node_id_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_timeline_verification_recipients
    ADD CONSTRAINT node_timeline_verification_rec_company_id_node_id_event_id_fkey FOREIGN KEY (company_id, node_id, event_id) REFERENCES public.node_timeline_events(company_id, node_id, event_id) ON DELETE CASCADE;


--
-- Name: node_view_user_versions node_view_user_versions_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_view_user_versions
    ADD CONSTRAINT node_view_user_versions_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: node_view_user_versions node_view_user_versions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_view_user_versions
    ADD CONSTRAINT node_view_user_versions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: node_view_versions node_view_versions_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_view_versions
    ADD CONSTRAINT node_view_versions_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: notifications notifications_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: pin_folders pin_folders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_folders
    ADD CONSTRAINT pin_folders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: pin_folders pin_folders_company_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_folders
    ADD CONSTRAINT pin_folders_company_id_user_id_fkey FOREIGN KEY (company_id, user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE CASCADE;


--
-- Name: pin_folders pin_folders_company_id_user_id_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_folders
    ADD CONSTRAINT pin_folders_company_id_user_id_parent_folder_id_fkey FOREIGN KEY (company_id, user_id, parent_folder_id) REFERENCES public.pin_folders(company_id, user_id, folder_id) ON DELETE CASCADE;


--
-- Name: pins pins_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: pins pins_company_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_company_id_user_id_fkey FOREIGN KEY (company_id, user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE CASCADE;


--
-- Name: pins pins_company_id_user_id_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_company_id_user_id_parent_folder_id_fkey FOREIGN KEY (company_id, user_id, parent_folder_id) REFERENCES public.pin_folders(company_id, user_id, folder_id) ON DELETE CASCADE;


--
-- Name: process_map_placements process_map_placements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_map_placements
    ADD CONSTRAINT process_map_placements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: process_map_placements process_map_placements_company_id_map_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_map_placements
    ADD CONSTRAINT process_map_placements_company_id_map_parent_folder_id_fkey FOREIGN KEY (company_id, map_parent_folder_id) REFERENCES public.company_explorer_folders(company_id, folder_id);


--
-- Name: process_map_traces process_map_traces_company_id_resource_operational_relatio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_map_traces
    ADD CONSTRAINT process_map_traces_company_id_resource_operational_relatio_fkey FOREIGN KEY (company_id, resource_operational_relationship_id) REFERENCES public.resource_operational_relationships(company_id, resource_operational_relationship_id) ON DELETE CASCADE;


--
-- Name: project_account_assignments project_account_assignments_company_id_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_account_assignments
    ADD CONSTRAINT project_account_assignments_company_id_account_id_fkey FOREIGN KEY (company_id, account_id) REFERENCES public.accounts(company_id, account_id) ON DELETE CASCADE;


--
-- Name: project_account_assignments project_account_assignments_company_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_account_assignments
    ADD CONSTRAINT project_account_assignments_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, project_id) ON DELETE CASCADE;


--
-- Name: project_critical_path_steps project_critical_path_steps_company_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_critical_path_steps
    ADD CONSTRAINT project_critical_path_steps_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, project_id) ON DELETE CASCADE;


--
-- Name: project_management_timeline_items project_management_timeline_items_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_items
    ADD CONSTRAINT project_management_timeline_items_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: project_management_timeline_items project_management_timeline_items_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_items
    ADD CONSTRAINT project_management_timeline_items_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: project_management_timeline_items project_management_timeline_items_company_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_items
    ADD CONSTRAINT project_management_timeline_items_company_id_user_id_fkey FOREIGN KEY (company_id, user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE CASCADE;


--
-- Name: project_management_timeline_items project_management_timeline_items_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_items
    ADD CONSTRAINT project_management_timeline_items_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id);


--
-- Name: project_management_timeline_projection project_management_timeline_proje_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_projection
    ADD CONSTRAINT project_management_timeline_proje_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: project_management_timeline_projection project_management_timeline_projection_company_id_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_projection
    ADD CONSTRAINT project_management_timeline_projection_company_id_item_id_fkey FOREIGN KEY (company_id, item_id) REFERENCES public.project_management_timeline_items(company_id, item_id) ON DELETE CASCADE;


--
-- Name: project_management_timeline_projection project_management_timeline_projection_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_projection
    ADD CONSTRAINT project_management_timeline_projection_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: project_management_timeline_projection project_management_timeline_projection_company_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_management_timeline_projection
    ADD CONSTRAINT project_management_timeline_projection_company_id_user_id_fkey FOREIGN KEY (company_id, user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE CASCADE;


--
-- Name: project_relationship_projection project_relationship_projection_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relationship_projection
    ADD CONSTRAINT project_relationship_projection_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: project_relationship_projection project_relationship_projection_company_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relationship_projection
    ADD CONSTRAINT project_relationship_projection_company_id_node_id_fkey FOREIGN KEY (company_id, node_id) REFERENCES public.nodes(company_id, node_id) ON DELETE CASCADE;


--
-- Name: project_relationship_projection project_relationship_projection_company_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relationship_projection
    ADD CONSTRAINT project_relationship_projection_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, project_id) ON DELETE CASCADE;


--
-- Name: project_relationship_projection project_relationship_projection_company_id_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relationship_projection
    ADD CONSTRAINT project_relationship_projection_company_id_relationship_id_fkey FOREIGN KEY (company_id, relationship_id) REFERENCES public.project_relationships(company_id, relationship_id) ON DELETE CASCADE;


--
-- Name: project_relationships project_relationships_company_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_relationships
    ADD CONSTRAINT project_relationships_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, project_id) ON DELETE CASCADE;


--
-- Name: project_team_assignments project_team_assignments_company_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_team_assignments
    ADD CONSTRAINT project_team_assignments_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, project_id) ON DELETE CASCADE;


--
-- Name: project_team_assignments project_team_assignments_company_id_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_team_assignments
    ADD CONSTRAINT project_team_assignments_company_id_team_id_fkey FOREIGN KEY (company_id, team_id) REFERENCES public.company_user_groups(company_id, group_id) ON DELETE CASCADE;


--
-- Name: project_textbox_chats project_textbox_chats_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textbox_chats
    ADD CONSTRAINT project_textbox_chats_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: project_textbox_chats project_textbox_chats_company_id_project_id_textbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textbox_chats
    ADD CONSTRAINT project_textbox_chats_company_id_project_id_textbox_id_fkey FOREIGN KEY (company_id, project_id, textbox_id) REFERENCES public.project_textboxes(company_id, project_id, textbox_id) ON DELETE CASCADE;


--
-- Name: project_textbox_chats project_textbox_chats_company_id_project_id_textbox_id_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textbox_chats
    ADD CONSTRAINT project_textbox_chats_company_id_project_id_textbox_id_par_fkey FOREIGN KEY (company_id, project_id, textbox_id, parent_chat_id) REFERENCES public.project_textbox_chats(company_id, project_id, textbox_id, chat_id) ON DELETE CASCADE;


--
-- Name: project_textboxes project_textboxes_company_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textboxes
    ADD CONSTRAINT project_textboxes_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, project_id) ON DELETE CASCADE;


--
-- Name: project_textboxes_history project_textboxes_history_company_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textboxes_history
    ADD CONSTRAINT project_textboxes_history_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES public.projects(company_id, project_id) ON DELETE CASCADE;


--
-- Name: project_textboxes_history project_textboxes_history_saved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_textboxes_history
    ADD CONSTRAINT project_textboxes_history_saved_by_user_id_fkey FOREIGN KEY (saved_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: projects projects_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: raci_tabs_folders raci_tabs_folders_company_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raci_tabs_folders
    ADD CONSTRAINT raci_tabs_folders_company_id_user_id_fkey FOREIGN KEY (company_id, user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE CASCADE;


--
-- Name: raci_tabs_folders raci_tabs_folders_company_id_user_id_role_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raci_tabs_folders
    ADD CONSTRAINT raci_tabs_folders_company_id_user_id_role_parent_folder_id_fkey FOREIGN KEY (company_id, user_id, role, parent_folder_id) REFERENCES public.raci_tabs_folders(company_id, user_id, role, folder_id) ON DELETE CASCADE;


--
-- Name: raci_tabs_items raci_tabs_items_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raci_tabs_items
    ADD CONSTRAINT raci_tabs_items_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: raci_tabs_items raci_tabs_items_company_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raci_tabs_items
    ADD CONSTRAINT raci_tabs_items_company_id_user_id_fkey FOREIGN KEY (company_id, user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE CASCADE;


--
-- Name: raci_tabs_items raci_tabs_items_company_id_user_id_role_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raci_tabs_items
    ADD CONSTRAINT raci_tabs_items_company_id_user_id_role_folder_id_fkey FOREIGN KEY (company_id, user_id, role, folder_id) REFERENCES public.raci_tabs_folders(company_id, user_id, role, folder_id) ON DELETE CASCADE;


--
-- Name: entity_relationships entity_relationships_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_relationships
    ADD CONSTRAINT entity_relationships_entity_fkey FOREIGN KEY (company_id, entity_id) REFERENCES public.entities(company_id, entity_id) ON DELETE CASCADE;


--
-- Name: entity_field_types entity_field_types_company_id_entity_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_field_types
    ADD CONSTRAINT entity_field_types_company_id_entity_type_id_fkey FOREIGN KEY (company_id, entity_type_id) REFERENCES public.entity_types(company_id, entity_type_id) ON DELETE CASCADE;


--
-- Name: entity_field_types entity_field_types_company_id_entity_type_id_entity_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_field_types
    ADD CONSTRAINT entity_field_types_company_id_entity_type_id_entity_folder_id_fkey FOREIGN KEY (company_id, entity_type_id, entity_folder_id) REFERENCES public.entity_folders(company_id, entity_type_id, entity_folder_id) ON DELETE CASCADE;


--
-- Name: entity_fields entity_fields_company_id_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_fields
    ADD CONSTRAINT entity_fields_company_id_entity_id_fkey FOREIGN KEY (company_id, entity_id) REFERENCES public.entities(company_id, entity_id) ON DELETE CASCADE;


--
-- Name: entity_fields entity_fields_entity_field_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_fields
    ADD CONSTRAINT entity_fields_entity_field_type_fkey FOREIGN KEY (company_id, entity_field_type_id) REFERENCES public.entity_field_types(company_id, entity_field_type_id) ON DELETE SET NULL (entity_field_type_id);


--
-- Name: entity_folders entity_folders_company_id_entity_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_folders
    ADD CONSTRAINT entity_folders_company_id_entity_type_id_fkey FOREIGN KEY (company_id, entity_type_id) REFERENCES public.entity_types(company_id, entity_type_id) ON DELETE CASCADE;


--
-- Name: entity_folders entity_folders_company_id_entity_type_id_parent_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_folders
    ADD CONSTRAINT entity_folders_company_id_entity_type_id_parent_entity_fkey FOREIGN KEY (company_id, entity_type_id, parent_entity_folder_id) REFERENCES public.entity_folders(company_id, entity_type_id, entity_folder_id);


--
-- Name: entity_types entity_types_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_types
    ADD CONSTRAINT entity_types_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: entities entities_company_id_entity_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_company_id_entity_type_id_fkey FOREIGN KEY (company_id, entity_type_id) REFERENCES public.entity_types(company_id, entity_type_id);


--
-- Name: entities entities_company_id_entity_type_id_entity_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_company_id_entity_type_id_entity_folder_id_fkey FOREIGN KEY (company_id, entity_type_id, entity_folder_id) REFERENCES public.entity_folders(company_id, entity_type_id, entity_folder_id);


--
-- Name: entities entities_created_by_company_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_created_by_company_member_fkey FOREIGN KEY (company_id, created_by_user_id) REFERENCES public.company_memberships(company_id, user_id) ON DELETE SET NULL (created_by_user_id);


--
-- Name: realtime_outbox realtime_outbox_company_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realtime_outbox
    ADD CONSTRAINT realtime_outbox_company_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: recycle_bin_items recycle_bin_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recycle_bin_items
    ADD CONSTRAINT recycle_bin_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: recycle_bin_items recycle_bin_items_deleted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recycle_bin_items
    ADD CONSTRAINT recycle_bin_items_deleted_by_user_id_fkey FOREIGN KEY (deleted_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: resource_gvic_assignments resource_gvic_assignments_v2__company_id_resource_type_res_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_gvic_assignments
    ADD CONSTRAINT resource_gvic_assignments_v2__company_id_resource_type_res_fkey FOREIGN KEY (company_id, resource_type, resource_id) REFERENCES public.resource_gvic_settings(company_id, resource_type, resource_id) ON DELETE CASCADE;


--
-- Name: resource_gvic_settings resource_gvic_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_gvic_settings
    ADD CONSTRAINT resource_gvic_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: resource_operational_relationships resource_operational_relationships_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_operational_relationships
    ADD CONSTRAINT resource_operational_relationships_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: resource_permission_settings resource_permission_settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_permission_settings
    ADD CONSTRAINT resource_permission_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: resource_permissions resource_permissions_v2_stagi_company_id_resource_type_res_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_permissions
    ADD CONSTRAINT resource_permissions_v2_stagi_company_id_resource_type_res_fkey FOREIGN KEY (company_id, resource_type, resource_id) REFERENCES public.resource_permission_settings(company_id, resource_type, resource_id) ON DELETE CASCADE;


--
-- Name: saved_views saved_views_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: shared_inbox_folders shared_inbox_folders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_inbox_folders
    ADD CONSTRAINT shared_inbox_folders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: shared_inbox_folders shared_inbox_folders_company_id_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_inbox_folders
    ADD CONSTRAINT shared_inbox_folders_company_id_parent_folder_id_fkey FOREIGN KEY (company_id, parent_folder_id) REFERENCES public.shared_inbox_folders(company_id, folder_id) ON DELETE CASCADE;


--
-- Name: shared_inboxes shared_inboxes_company_email_connection_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_inboxes
    ADD CONSTRAINT shared_inboxes_company_email_connection_fkey FOREIGN KEY (company_id, company_email_connection_id) REFERENCES public.email_connections(company_id, email_connection_id);


--
-- Name: shared_inboxes shared_inboxes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_inboxes
    ADD CONSTRAINT shared_inboxes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE;


--
-- Name: shared_inboxes shared_inboxes_company_id_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_inboxes
    ADD CONSTRAINT shared_inboxes_company_id_parent_folder_id_fkey FOREIGN KEY (company_id, parent_folder_id) REFERENCES public.shared_inbox_folders(company_id, folder_id);


--
-- Name: user_logic_gate_shortcuts user_logic_gate_shortcuts_company_id_logic_gate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logic_gate_shortcuts
    ADD CONSTRAINT user_logic_gate_shortcuts_company_id_logic_gate_id_fkey FOREIGN KEY (company_id, logic_gate_id) REFERENCES public.logic_gates(company_id, logic_gate_id) ON DELETE CASCADE;


--
-- Name: user_logic_gate_shortcuts user_logic_gate_shortcuts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_logic_gate_shortcuts
    ADD CONSTRAINT user_logic_gate_shortcuts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
