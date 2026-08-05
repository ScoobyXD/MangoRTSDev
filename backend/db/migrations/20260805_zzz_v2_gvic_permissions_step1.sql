-- V2 GVIC and permissions Step 1: additive destination storage only.
-- Runtime readers/writers continue to use the legacy policy tables until Step 2.

do $$
declare
  spec record;
  actual_count integer;
  missing_count integer;
  extra_count integer;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'v2_policy_step1_unsupported_postgresql_version:%', current_setting('server_version');
  end if;

  for spec in
    select key as table_name, value as expected_columns
    from jsonb_each($shape$
      {
        "companies":["company_id","name","created_timestamp","updated_timestamp"],
        "users":["user_id","cognito_subject","email","display_name","created_timestamp","updated_timestamp"],
        "company_memberships":["company_id","user_id","role","created_timestamp","updated_timestamp"],
        "company_user_groups":["company_id","group_id","parent_group_id","name","position","created_timestamp","updated_timestamp"],
        "company_user_group_members":["company_id","group_id","user_id","created_timestamp","updated_timestamp"],
        "nodes":["company_id","node_id","name","status","due_date","priority","default_access","created_timestamp"],
        "logic_gates":["company_id","logic_gate_id","header","default_access","created_timestamp"],
        "projects":["company_id","project_id","name","status","health","default_access","created_timestamp","updated_timestamp"],
        "company_explorer_folders":["company_id","folder_id","parent_folder_id","name","default_access","position","created_by_user_id","created_timestamp","updated_timestamp"],
        "company_explorer_items":["company_id","item_id","parent_folder_id","target_type","target_id","position","created_by_user_id","created_timestamp","updated_timestamp"],
        "shared_inbox_folders":["company_id","folder_id","parent_folder_id","name","default_access","position","created_timestamp","updated_timestamp"],
        "shared_inboxes":["company_id","shared_inbox_id","parent_folder_id","name","account_email","company_email_connection_id","default_access","position","created_timestamp","updated_timestamp"],
        "node_logic_gate_assignments":["assignment_id","company_id","node_id","logic_gate_id","status_key","column_id","is_issue","position","compatibility_board_id","compatibility_card_id","requested_by_user_id","placed_by_user_id","version","created_timestamp","updated_timestamp"],
        "resource_gvic_assignments":["company_id","resource_type","resource_id","role","principal_type","principal_id","created_timestamp","updated_timestamp"],
        "resource_gvic_effective_assignments":["company_id","resource_type","resource_id","role","user_id","source_resource_type","source_resource_id","source_principal_type","source_principal_id","inheritance_type","updated_timestamp"],
        "resource_gvic_policy_revisions":["company_id","resource_type","resource_id","policy_sequence","updated_timestamp"],
        "resource_gvic_subtree_applications":["application_id","policy_sequence","company_id","ancestor_resource_type","ancestor_resource_id","role","principal_type","principal_id","deleted","snapshot","created_timestamp"],
        "resource_permissions":["company_id","resource_type","resource_id","subject_type","subject_id","user_id","access_level","created_timestamp","updated_timestamp"],
        "resource_permission_policy_revisions":["company_id","resource_type","resource_id","policy_sequence","updated_timestamp"],
        "resource_permission_subtree_applications":["application_id","policy_sequence","company_id","ancestor_resource_type","ancestor_resource_id","rule_key","subject_type","subject_id","access_level","deleted","created_timestamp"],
        "gvic_matrix_projection_table":["company_id","projection_row_id","user_id","node_name","gvic_assignment","priority","project_id","project_name","logic_gate_id","logic_gate_name","node_id","status","due_date","accounts","created_timestamp","updated_timestamp","sort_order"]
      }
    $shape$::jsonb)
  loop
    if to_regclass('public.' || spec.table_name) is null then
      raise exception 'v2_policy_step1_missing_source_table:%', spec.table_name;
    end if;
    select count(*) into actual_count
    from information_schema.columns
    where table_schema='public' and table_name=spec.table_name;
    select count(*) into missing_count
    from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public'
        and actual.table_name=spec.table_name
        and actual.column_name=expected.column_name
    );
    select count(*) into extra_count
    from information_schema.columns actual
    where actual.table_schema='public'
      and actual.table_name=spec.table_name
      and not exists (
        select 1 from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
        where expected.column_name=actual.column_name
      );
    if actual_count <> jsonb_array_length(spec.expected_columns)
       or missing_count <> 0 or extra_count <> 0 then
      raise exception 'v2_policy_step1_source_schema_drift:%:expected=%:actual=%:missing=%:extra=%',
        spec.table_name, jsonb_array_length(spec.expected_columns), actual_count, missing_count, extra_count;
    end if;
  end loop;

  for spec in
    select key as table_name, value as expected_columns
    from jsonb_each($shape$
      {
        "resource_gvic_settings":["company_id","resource_type","resource_id","assignment_mode","customized_sequence","parent_link_sequence","descendant_reset_sequence","created_timestamp","updated_timestamp"],
        "resource_permission_settings":["company_id","resource_type","resource_id","permission_mode","default_access","customized_sequence","parent_link_sequence","descendant_reset_sequence","created_timestamp","updated_timestamp"],
        "resource_gvic_assignments_v2_staging":["company_id","resource_type","resource_id","role","principal_type","principal_id","created_timestamp","updated_timestamp"],
        "resource_permissions_v2_staging":["company_id","resource_type","resource_id","subject_type","subject_id","access_level","created_timestamp","updated_timestamp"]
      }
    $shape$::jsonb)
  loop
    if to_regclass('public.' || spec.table_name) is not null then
      select count(*) into actual_count
      from information_schema.columns
      where table_schema='public' and table_name=spec.table_name;
      select count(*) into missing_count
      from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
      where not exists (
        select 1 from information_schema.columns actual
        where actual.table_schema='public'
          and actual.table_name=spec.table_name
          and actual.column_name=expected.column_name
      );
      select count(*) into extra_count
      from information_schema.columns actual
      where actual.table_schema='public'
        and actual.table_name=spec.table_name
        and not exists (
          select 1 from jsonb_array_elements_text(spec.expected_columns) expected(column_name)
          where expected.column_name=actual.column_name
        );
      if actual_count <> jsonb_array_length(spec.expected_columns)
         or missing_count <> 0 or extra_count <> 0 then
        raise exception 'v2_policy_step1_destination_schema_drift:%:expected=%:actual=%:missing=%:extra=%',
          spec.table_name, jsonb_array_length(spec.expected_columns), actual_count, missing_count, extra_count;
      end if;
    end if;
  end loop;
end;
$$;

create sequence if not exists resource_gvic_change_sequence;
create sequence if not exists resource_permission_change_sequence;

create table if not exists resource_gvic_settings (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  assignment_mode text not null,
  customized_sequence bigint,
  parent_link_sequence bigint not null,
  descendant_reset_sequence bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  constraint resource_gvic_settings_resource_type_chk check (resource_type in (
    'node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox'
  )),
  constraint resource_gvic_settings_assignment_mode_chk check (assignment_mode in ('inherited','customized')),
  constraint resource_gvic_settings_mode_shape_chk check (
    (assignment_mode='inherited' and customized_sequence is null)
    or (assignment_mode='customized' and customized_sequence is not null and customized_sequence > 0)
  ),
  constraint resource_gvic_settings_parent_sequence_chk check (parent_link_sequence >= 0),
  constraint resource_gvic_settings_reset_sequence_chk check (descendant_reset_sequence >= 0)
);

create index if not exists idx_resource_gvic_settings_customized_sequence
  on resource_gvic_settings(company_id,resource_type,resource_id,customized_sequence);
create index if not exists idx_resource_gvic_settings_reset_sequence
  on resource_gvic_settings(company_id,resource_type,resource_id,descendant_reset_sequence)
  where descendant_reset_sequence > 0;

create table if not exists resource_permission_settings (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  permission_mode text not null,
  default_access text,
  customized_sequence bigint,
  parent_link_sequence bigint not null,
  descendant_reset_sequence bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, resource_type, resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  constraint resource_permission_settings_resource_type_chk check (resource_type in (
    'node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox'
  )),
  constraint resource_permission_settings_permission_mode_chk check (permission_mode in ('inherited','customized')),
  constraint resource_permission_settings_default_access_chk check (default_access is null or default_access in ('edit','no_access')),
  constraint resource_permission_settings_mode_shape_chk check (
    (permission_mode='inherited' and customized_sequence is null and default_access is null)
    or (
      permission_mode='customized'
      and customized_sequence is not null and customized_sequence > 0
      and default_access in ('edit','no_access')
    )
  ),
  constraint resource_permission_settings_parent_sequence_chk check (parent_link_sequence >= 0),
  constraint resource_permission_settings_reset_sequence_chk check (descendant_reset_sequence >= 0)
);

create index if not exists idx_resource_permission_settings_customized_sequence
  on resource_permission_settings(company_id,resource_type,resource_id,customized_sequence);
create index if not exists idx_resource_permission_settings_reset_sequence
  on resource_permission_settings(company_id,resource_type,resource_id,descendant_reset_sequence)
  where descendant_reset_sequence > 0;

create table if not exists resource_gvic_assignments_v2_staging (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  principal_type text not null,
  principal_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id,resource_type,resource_id,role,principal_type,principal_id),
  foreign key (company_id,resource_type,resource_id)
    references resource_gvic_settings(company_id,resource_type,resource_id) on delete cascade,
  constraint resource_gvic_assignments_v2_staging_role_chk
    check (role in ('generated','verified','consulted','informed')),
  constraint resource_gvic_assignments_v2_staging_principal_type_chk
    check (principal_type in ('user','group')),
  constraint resource_gvic_assignments_v2_staging_user_only_role_chk
    check (role not in ('generated','verified') or principal_type='user')
);

create unique index if not exists idx_resource_gvic_assignments_v2_one_role_per_principal
  on resource_gvic_assignments_v2_staging(company_id,resource_type,resource_id,principal_type,principal_id);
create unique index if not exists idx_resource_gvic_assignments_v2_one_generated
  on resource_gvic_assignments_v2_staging(company_id,resource_type,resource_id)
  where role='generated';
create index if not exists idx_resource_gvic_assignments_v2_principal
  on resource_gvic_assignments_v2_staging(company_id,principal_type,principal_id,role,resource_type,resource_id);

create table if not exists resource_permissions_v2_staging (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  subject_type text not null,
  subject_id uuid not null,
  access_level text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id,resource_type,resource_id,subject_type,subject_id),
  foreign key (company_id,resource_type,resource_id)
    references resource_permission_settings(company_id,resource_type,resource_id) on delete cascade,
  constraint resource_permissions_v2_staging_subject_type_chk check (subject_type in ('user','group')),
  constraint resource_permissions_v2_staging_access_level_chk check (access_level in ('edit','no_access'))
);

create index if not exists idx_resource_permissions_v2_subject
  on resource_permissions_v2_staging(company_id,subject_type,subject_id,access_level,resource_type,resource_id);

create or replace function mangorts_v2_policy_resource_exists(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language sql
stable
set search_path=public,pg_temp
as $$
  select case p_resource_type
    when 'node' then exists(select 1 from nodes where company_id=p_company_id and node_id=p_resource_id)
    when 'logic_gate' then exists(select 1 from logic_gates where company_id=p_company_id and logic_gate_id=p_resource_id)
    when 'project' then exists(select 1 from projects where company_id=p_company_id and project_id=p_resource_id)
    when 'company_explorer_folder' then exists(select 1 from company_explorer_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox_folder' then exists(select 1 from shared_inbox_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox' then exists(select 1 from shared_inboxes where company_id=p_company_id and shared_inbox_id=p_resource_id)
    else false
  end;
$$;

create or replace function mangorts_v2_policy_parent(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(parent_resource_type text,parent_resource_id uuid)
language sql
stable
set search_path=public,pg_temp
as $$
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

create or replace function mangorts_v2_policy_resource_has_cycle(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language plpgsql
stable
set search_path=public,pg_temp
as $$
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

create or replace function mangorts_v2_validate_policy_settings()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
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

drop trigger if exists trg_resource_gvic_settings_validate on resource_gvic_settings;
create trigger trg_resource_gvic_settings_validate
before insert or update on resource_gvic_settings
for each row execute function mangorts_v2_validate_policy_settings();

drop trigger if exists trg_resource_permission_settings_validate on resource_permission_settings;
create trigger trg_resource_permission_settings_validate
before insert or update on resource_permission_settings
for each row execute function mangorts_v2_validate_policy_settings();

create or replace function mangorts_v2_validate_policy_edge()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  principal_kind text;
  principal_value uuid;
  customized boolean;
begin
  if tg_table_name='resource_gvic_assignments_v2_staging' then
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

drop trigger if exists trg_resource_gvic_assignments_v2_validate on resource_gvic_assignments_v2_staging;
create trigger trg_resource_gvic_assignments_v2_validate
before insert or update on resource_gvic_assignments_v2_staging
for each row execute function mangorts_v2_validate_policy_edge();

drop trigger if exists trg_resource_permissions_v2_validate on resource_permissions_v2_staging;
create trigger trg_resource_permissions_v2_validate
before insert or update on resource_permissions_v2_staging
for each row execute function mangorts_v2_validate_policy_edge();
