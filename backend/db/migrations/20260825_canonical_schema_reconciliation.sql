-- Reconcile the empty QA schema with the reviewed PostgreSQL 17 canonical
-- inventory. The retired V2 policy tables may be removed only as one complete,
-- empty set; partial or populated storage is a hard stop.
-- The migration runner executes this whole file and its ledger insert in one
-- transaction; transaction control must remain outside the migration text.

set local lock_timeout = '10s';
set local statement_timeout = '5min';
set local search_path = public, pg_catalog;

do $guard$
declare
  retired_tables constant text[] := array[
    'company_user_group_closure',
    'resource_gvic_assignments_step2_legacy',
    'resource_gvic_effective_assignments',
    'resource_gvic_policy_revisions',
    'resource_gvic_subtree_applications',
    'resource_permission_policy_revisions',
    'resource_permission_subtree_applications',
    'resource_permissions_step2_legacy'
  ];
  retired_table text;
  present_count integer;
  contains_rows boolean;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'STOP: canonical schema reconciliation requires PostgreSQL 17.x; connected server_version=%, server_version_num=%',
      current_setting('server_version'), current_setting('server_version_num');
  end if;

  select count(*)
  into present_count
  from unnest(retired_tables) candidate(table_name)
  where to_regclass(format('public.%I', candidate.table_name)) is not null;

  if present_count not in (0, cardinality(retired_tables)) then
    raise exception 'STOP: retired V2 policy tables are partially present; expected 0 or %, found %',
      cardinality(retired_tables), present_count;
  end if;

  if present_count = cardinality(retired_tables) then
    foreach retired_table in array retired_tables
    loop
      execute format('lock table public.%I in access exclusive mode', retired_table);
    end loop;

    foreach retired_table in array retired_tables
    loop
      execute format(
        'select exists (select 1 from public.%I limit 1)',
        retired_table
      ) into contains_rows;
      if contains_rows then
        raise exception 'STOP: retired V2 policy table public.% contains rows', retired_table;
      end if;
    end loop;
  end if;

  if to_regclass('public.communications_message_read_receipt_summaries') is null
     or to_regclass('public.resource_gvic_assignments') is null
     or to_regclass('public.resource_permissions') is null then
    raise exception 'STOP: required canonical tables are missing';
  end if;
end;
$guard$;

-- These tables have no surviving business authority. Dropping the dependent
-- application tables first also removes their owned indexes, triggers, and
-- application-id sequences through normal ownership dependencies.
drop table if exists public.resource_permission_subtree_applications;
drop table if exists public.resource_gvic_subtree_applications;
drop table if exists public.resource_permission_policy_revisions;
drop table if exists public.resource_gvic_policy_revisions;
drop table if exists public.resource_gvic_effective_assignments;
drop table if exists public.company_user_group_closure;
drop table if exists public.resource_gvic_assignments_step2_legacy;
drop table if exists public.resource_permissions_step2_legacy;

drop sequence if exists public.resource_policy_sequence;

drop function if exists public.mangorts_trg_bump_logic_gate_work_from_permission_application();
drop function if exists public.mangorts_trg_bump_node_view_from_permission_application();
drop function if exists public.mangorts_v2_step1_resolved_gvic(uuid, text, uuid);
drop function if exists public.mangorts_v2_step1_resolved_permission_default(uuid, text, uuid);
drop function if exists public.mangorts_v2_step1_resolved_permissions(uuid, text, uuid);

alter table only public.communications_message_read_receipt_summaries
  drop constraint if exists communications_message_read_receipt_summaries_scope_chk;
alter table only public.communications_message_read_receipt_summaries
  add constraint communications_message_read_receipt_summaries_scope_chk
  check (((receipt_scope_type)::text = any (array[
    ('personal'::character varying)::text,
    ('shared'::character varying)::text
  ])));

create or replace function public.mangorts_protect_email_relationship_dependencies() returns trigger
  language plpgsql
  as $function$
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
$function$;

create or replace function public.mangorts_raci_tabs_policy_changed() returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
  as $function$
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
$function$;

create or replace function public.mangorts_sync_raci_tabs_explorer_subtree(p_company_id uuid, p_folder_id uuid) returns void
  language plpgsql
  set search_path to 'public', 'pg_temp'
  as $function$
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
$function$;

create or replace function public.trg_validate_resource_operational_relationship() returns trigger
  language plpgsql
  as $function$
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
$function$;

create or replace function public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb) returns table(scope text, resource_key text)
  language plpgsql immutable
  as $function$
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
    'logic_gate_permissions_updated', 'company_explorer_folder_updated',
    'company_explorer_folder_deleted', 'company_explorer_folder_permissions_updated',
	'company_explorer_item_placed', 'company_explorer_item_removed',
    'company_user_group_updated', 'company_user_group_deleted', 'company_user_group_members_updated',
    'company_membership_saved', 'company_membership_deleted'
  ]::text[])
  or (
    p_event_type in ('logic_gate_created', 'company_explorer_folder_created')
    and btrim(coalesce(p_payload->>'realtime_change_type', '')) = 'resource_restored'
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
$function$;

drop trigger if exists trg_logic_gate_work_version_gvic on public.resource_gvic_assignments;
create trigger trg_logic_gate_work_version_gvic
  after insert or delete or update on public.resource_gvic_assignments
  for each row execute function public.mangorts_trg_bump_logic_gate_work_from_resource();

drop trigger if exists trg_logic_gate_work_version_permissions on public.resource_permissions;
create trigger trg_logic_gate_work_version_permissions
  after insert or delete or update on public.resource_permissions
  for each row execute function public.mangorts_trg_bump_logic_gate_work_from_resource();
