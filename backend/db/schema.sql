-- Canonical Aurora PostgreSQL schema for MVP.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'node_relationship_position') then
    create type node_relationship_position as enum ('Parent', 'Child', 'Peer');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'logic_gate_relationship_position') then
    create type logic_gate_relationship_position as enum ('Input', 'Output');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'information_type') then
    create type information_type as enum (
      'Text box',
      'Checklist',
      'Status',
      'Due date',
      'Employee name',
      'PDF',
      'PNG',
      'MOV',
      'Hyperlink',
      'Text block chat',
      'Attached email'
    );
  end if;
end $$;

alter type information_type add value if not exists 'Text block chat';
alter type information_type add value if not exists 'Attached email';

create table if not exists users (
  user_id uuid not null,
  cognito_subject text not null,
  email text not null default '',
  display_name text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint users_cognito_subject_nonblank_chk check (btrim(cognito_subject) <> ''),
  constraint users_email_lowercase_chk check (email = lower(btrim(email))),
  primary key (user_id),
  unique (cognito_subject)
);

create table if not exists companies (
  company_id uuid not null,
  name text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint companies_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id)
);

create table if not exists company_memberships (
  company_id uuid not null,
  user_id uuid not null,
  role text not null default 'company_user',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_memberships_role_chk check (role in ('dev_admin', 'company_admin', 'company_user')),
  primary key (company_id, user_id),
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_company_memberships_user_company
  on company_memberships(user_id, company_id);

create table if not exists company_user_groups (
  company_id uuid not null,
  group_id uuid not null,
  parent_group_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_user_groups_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, group_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, parent_group_id) references company_user_groups (company_id, group_id) on delete cascade
);

create index if not exists idx_company_user_groups_parent_position
  on company_user_groups(company_id, parent_group_id, position, group_id);

create table if not exists company_user_group_members (
  company_id uuid not null,
  group_id uuid not null,
  user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, group_id, user_id),
  foreign key (company_id, group_id) references company_user_groups (company_id, group_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_company_user_group_members_user
  on company_user_group_members(company_id, user_id, group_id);

create table if not exists invitations (
  invitation_id uuid not null,
  company_id uuid not null,
  email text not null,
  role text not null,
  token_hash text not null,
  status text not null default 'pending',
  invited_by_user_id uuid not null,
  accepted_by_user_id uuid,
  cognito_status text not null default 'not_started',
  cognito_error text not null default '',
  invite_email_status text not null default 'not_started',
  invite_email_error text not null default '',
  invite_email_sent_timestamp timestamptz,
  expires_timestamp timestamptz not null,
  accepted_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint invitations_email_nonblank_chk check (btrim(email) <> ''),
  constraint invitations_email_lowercase_chk check (email = lower(btrim(email))),
  constraint invitations_token_hash_nonblank_chk check (btrim(token_hash) <> ''),
  constraint invitations_role_chk check (role in ('company_admin', 'company_user')),
  constraint invitations_status_chk check (status in ('pending', 'accepted', 'revoked')),
  constraint invitations_cognito_status_chk check (cognito_status in ('not_started', 'not_configured', 'created', 'resent', 'existing_mango_user', 'failed')),
  constraint invitations_invite_email_status_chk check (invite_email_status in ('not_started', 'not_configured', 'sent', 'failed')),
  primary key (invitation_id),
  unique (token_hash),
  foreign key (invited_by_user_id) references users (user_id),
  foreign key (accepted_by_user_id) references users (user_id)
);

create index if not exists idx_invitations_company_email_status
  on invitations(company_id, email, status, created_timestamp desc);

create unique index if not exists idx_invitations_one_pending_company_email
  on invitations(company_id, email)
  where status = 'pending';

create index if not exists idx_invitations_company_status_updated
  on invitations(company_id, status, updated_timestamp desc);

create table if not exists user_email_connections (
  user_id uuid not null,
  provider text not null,
  account_email text not null,
  grant_id text not null,
  status text not null default 'connected',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint user_email_connections_provider_chk check (provider in ('google', 'microsoft')),
  constraint user_email_connections_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  constraint user_email_connections_grant_id_nonblank_chk check (btrim(grant_id) <> ''),
  constraint user_email_connections_status_chk check (status in ('connected', 'disconnected', 'reauth_required')),
  primary key (user_id),
  foreign key (user_id) references users (user_id) on delete cascade
);

create unique index if not exists idx_user_email_connections_grant_id
  on user_email_connections(grant_id);

create table if not exists auth_external_identity_deletions (
  provider text not null,
  external_subject text not null,
  user_id uuid,
  email text not null default '',
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  completed_timestamp timestamptz,
  primary key (provider, external_subject),
  constraint auth_external_identity_deletions_provider_chk check (provider in ('cognito')),
  constraint auth_external_identity_deletions_subject_nonblank_chk check (btrim(external_subject) <> ''),
  constraint auth_external_identity_deletions_status_chk check (status in ('pending', 'completed')),
  constraint auth_external_identity_deletions_attempts_chk check (attempts >= 0)
);

create index if not exists idx_auth_external_identity_deletions_pending
  on auth_external_identity_deletions(updated_timestamp) where status = 'pending';

create table if not exists communications_triage_items (
  user_id uuid not null,
  message_id text not null,
  message jsonb not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_triage_items_message_id_nonblank_chk check (btrim(message_id) <> ''),
  primary key (user_id, message_id),
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_communications_triage_items_user_created
  on communications_triage_items(user_id, created_timestamp desc, message_id);

create table if not exists nodes (
  company_id uuid not null,
  node_id uuid not null,
  title text not null,
  status text,
  status_color text,
  due_date date,
  priority smallint,
  assignee_user_id uuid,
  default_access text not null default 'edit',
  created_timestamp timestamptz not null,
  constraint nodes_default_access_chk check (default_access in ('edit', 'no_access')),
  constraint nodes_priority_chk check (priority is null or priority between 1 and 5),
  primary key (company_id, node_id),
  foreign key (assignee_user_id) references users (user_id)
);

create table if not exists node_relationships (
  company_id uuid not null,
  node_relationship_id uuid not null,
  node_id_a uuid not null,
  node_id_b uuid not null,
  a_position node_relationship_position not null,
  b_position node_relationship_position not null,
  created_timestamp timestamptz not null,
  constraint node_relationships_position_pair_chk check (
    (a_position = 'Parent' and b_position = 'Child')
    or (a_position = 'Child' and b_position = 'Parent')
    or (a_position = 'Peer' and b_position = 'Peer')
  ),
  constraint node_relationships_not_self_chk check (node_id_a <> node_id_b),
  primary key (company_id, node_relationship_id),
  foreign key (company_id, node_id_a) references nodes (company_id, node_id),
  foreign key (company_id, node_id_b) references nodes (company_id, node_id)
);

create table if not exists node_information (
  company_id uuid not null,
  information_id uuid not null,
  node_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint node_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id)
);

create table if not exists node_projection_table (
  company_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint node_projection_table_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, node_id, information_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id)
);

create table if not exists node_content_changes (
  company_id uuid not null,
  change_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  change_type text not null,
  text text not null,
  start_offset integer not null,
  end_offset integer not null,
  actor_user_id uuid,
  actor_display_name text not null default '',
  created_timestamp timestamptz not null default now(),
  constraint node_content_changes_type_chk check (change_type in ('addition', 'deletion')),
  constraint node_content_changes_text_nonblank_chk check (btrim(text) <> ''),
  constraint node_content_changes_offsets_chk check (start_offset >= 0 and end_offset >= start_offset),
  primary key (company_id, change_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (actor_user_id) references users (user_id) on delete set null
);

create table if not exists node_content_change_seen (
  company_id uuid not null,
  change_id uuid not null,
  user_id uuid not null,
  seen_timestamp timestamptz not null default now(),
  primary key (company_id, change_id, user_id),
  foreign key (company_id, change_id) references node_content_changes (company_id, change_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create table if not exists node_projection_seen_snapshots (
  company_id uuid not null,
  node_id uuid not null,
  information_id uuid not null,
  user_id uuid not null,
  information text not null,
  projection_updated_timestamp timestamptz not null,
  seen_timestamp timestamptz not null default now(),
  primary key (company_id, node_id, information_id, user_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create table if not exists node_map_positions (
  company_id uuid not null,
  node_id uuid not null,
  x double precision not null,
  y double precision not null,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, node_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

create table if not exists logic_gates (
  company_id uuid not null,
  logic_gate_id uuid not null,
  header text not null,
  default_access text not null default 'edit',
  created_timestamp timestamptz not null,
  constraint logic_gates_default_access_chk check (default_access in ('edit', 'no_access')),
  primary key (company_id, logic_gate_id)
);

create table if not exists logic_gate_raci_assignments (
  company_id uuid not null,
  logic_gate_id uuid not null,
  role text not null,
  user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint logic_gate_raci_assignments_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  primary key (company_id, logic_gate_id, role, user_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_logic_gate_raci_user_role_gate
  on logic_gate_raci_assignments(company_id, user_id, role, logic_gate_id);

create index if not exists idx_logic_gate_raci_gate_role_user
  on logic_gate_raci_assignments(company_id, logic_gate_id, role, user_id);

create table if not exists resource_raci_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  subject_type text not null,
  subject_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint resource_raci_assignments_resource_type_chk check (resource_type in ('node', 'logic_gate', 'shared_triage_folder')),
  constraint resource_raci_assignments_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  constraint resource_raci_assignments_subject_type_chk check (subject_type in ('user', 'group')),
  primary key (company_id, resource_type, resource_id, role, subject_type, subject_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_raci_assignments_subject_role_resource
  on resource_raci_assignments(company_id, subject_type, subject_id, role, resource_type, resource_id);

create index if not exists idx_resource_raci_assignments_resource_role_subject
  on resource_raci_assignments(company_id, resource_type, resource_id, role, subject_type, subject_id);

create table if not exists entity_access_permissions (
  company_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  subject_type text not null,
  subject_id uuid not null,
  permission text not null default 'view',
  created_timestamp timestamptz not null default now(),
  constraint entity_access_permissions_entity_type_chk check (entity_type in ('node', 'logic_gate')),
  constraint entity_access_permissions_subject_type_chk check (subject_type in ('user', 'group')),
  constraint entity_access_permissions_permission_chk check (permission = 'view'),
  primary key (company_id, entity_type, entity_id, subject_type, subject_id, permission),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_entity_access_permissions_subject
  on entity_access_permissions(company_id, subject_type, subject_id, entity_type, entity_id);

create index if not exists idx_entity_access_permissions_entity
  on entity_access_permissions(company_id, entity_type, entity_id);


create table if not exists resource_access_grants (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  principal_type text not null,
  principal_id uuid not null,
  access_level text not null default 'view',
  created_timestamp timestamptz not null default now(),
  constraint resource_access_grants_resource_type_chk check (resource_type in ('node', 'logic_gate', 'shared_triage_folder')),
  constraint resource_access_grants_principal_type_chk check (principal_type in ('user', 'group')),
  constraint resource_access_grants_access_level_chk check (access_level in ('no_access', 'view', 'edit', 'admin')),
  primary key (company_id, resource_type, resource_id, principal_type, principal_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_resource_access_grants_principal
  on resource_access_grants(company_id, principal_type, principal_id, resource_type, resource_id);

create index if not exists idx_resource_access_grants_resource
  on resource_access_grants(company_id, resource_type, resource_id);

create table if not exists resource_permissions (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint resource_permissions_resource_type_chk check (resource_type in ('node', 'logic_gate')),
  primary key (company_id, resource_type, resource_id, user_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_resource_permissions_user_resource
  on resource_permissions(company_id, user_id, resource_type, resource_id);

create index if not exists idx_resource_permissions_resource_user
  on resource_permissions(company_id, resource_type, resource_id, user_id);

create or replace function mangorts_access_level_rank(p_access_level text)
returns integer as $$
  select case lower(btrim(coalesce(p_access_level, '')))
    when 'no_access' then 0
    when 'view' then 1
    when 'edit' then 2
    when 'admin' then 3
    else 0
  end;
$$ language sql immutable;
create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean as $$
  with recursive normalized_resource(resource_type) as (
    select lower(btrim(coalesce(p_resource_type, '')))
  ),
  requested(required_rank) as (
    select mangorts_access_level_rank(p_access_level)
  ),
  role_admin_actor(allowed) as (
    select exists (
      select 1
      from company_memberships membership
      where membership.user_id = p_user_id
        and (
          membership.role = 'dev_admin'
          or (membership.company_id = p_company_id and membership.role = 'company_admin')
        )
    )
  ),
  normalized_resource_row(default_access) as (
    select coalesce(node.default_access, 'edit')
    from nodes node, normalized_resource normalized
    where normalized.resource_type='node'
      and node.company_id=p_company_id
      and node.node_id=p_resource_id
    union all
    select coalesce(gate.default_access, 'edit')
    from logic_gates gate, normalized_resource normalized
    where normalized.resource_type='logic_gate'
      and gate.company_id=p_company_id
      and gate.logic_gate_id=p_resource_id
  ),
  direct_override(exists_override) as (
    select exists (
      select 1
      from resource_permissions access
      join normalized_resource normalized
        on normalized.resource_type=access.resource_type
      where access.company_id=p_company_id
        and access.resource_id=p_resource_id
        and access.user_id=p_user_id
    )
  ),
  resource_scope(resource_id, depth, path) as (
    select p_resource_id, 0, array[p_resource_id]
    union all
    select folder.parent_folder_id, resource_scope.depth + 1, resource_scope.path || folder.parent_folder_id
    from resource_scope
    join company_explorer_folders folder
      on folder.company_id = p_company_id
     and folder.folder_kind = 'communications'
     and folder.folder_id = resource_scope.resource_id
    join normalized_resource normalized
      on normalized.resource_type = 'shared_triage_folder'
    where folder.parent_folder_id is not null
      and not folder.parent_folder_id = any(resource_scope.path)
  ),
  permitted_group_scope(resource_id, depth, group_id, access_rank, path) as (
    select permission.resource_id,
           resource_scope.depth,
           permission.principal_id,
           mangorts_access_level_rank(permission.access_level),
           array[permission.principal_id]
    from resource_access_grants permission
    join resource_scope
      on resource_scope.resource_id = permission.resource_id
    join normalized_resource normalized
      on normalized.resource_type = permission.resource_type
    where permission.company_id = p_company_id
      and permission.principal_type = 'group'
    union all
    select parent.resource_id,
           parent.depth,
           child.group_id,
           parent.access_rank,
           parent.path || child.group_id
    from permitted_group_scope parent
    join company_user_groups child
      on child.company_id = p_company_id
     and child.parent_group_id = parent.group_id
    where not child.group_id = any(parent.path)
  ),
  matching_grants(depth, subject_rank, access_rank) as (
    select resource_scope.depth,
           2,
           mangorts_access_level_rank(permission.access_level)
    from resource_access_grants permission
    join resource_scope
      on resource_scope.resource_id = permission.resource_id
    join normalized_resource normalized
      on normalized.resource_type = permission.resource_type
    where permission.company_id = p_company_id
      and permission.principal_type = 'user'
      and permission.principal_id = p_user_id
    union all
    select permitted_group_scope.depth,
           1,
           permitted_group_scope.access_rank
    from company_user_group_members member
    join permitted_group_scope
      on permitted_group_scope.group_id = member.group_id
    where member.company_id = p_company_id
      and member.user_id = p_user_id
  ),
  effective_grant(access_rank) as (
    select matching_grants.access_rank
    from matching_grants
    order by matching_grants.depth asc,
             matching_grants.subject_rank desc,
             matching_grants.access_rank desc
    limit 1
  )
  select case
    when requested.required_rank = 0 then false
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'shared_triage_folder') then false
    when (select allowed from role_admin_actor) then true
    when normalized_resource.resource_type in ('node', 'logic_gate')
      and exists (
        select 1
        from company_memberships membership
        where membership.company_id = p_company_id
          and membership.user_id = p_user_id
      )
      and exists (select 1 from normalized_resource_row)
      and (
        ((select default_access from normalized_resource_row limit 1) = 'edit' and not (select exists_override from direct_override))
        or ((select default_access from normalized_resource_row limit 1) = 'no_access' and (select exists_override from direct_override))
      ) then true
    when exists (select 1 from effective_grant) then (select access_rank from effective_grant) >= requested.required_rank
    else false
  end
  from requested, normalized_resource;
$$ language sql stable;
create or replace function mangorts_user_can_view_entity(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_user_id uuid
)
returns boolean as $$
  select mangorts_user_can_access_resource(p_company_id, p_entity_type, p_entity_id, p_user_id, 'view');
$$ language sql stable;

create table if not exists logic_gate_relationships (
  company_id uuid not null,
  logic_gate_relationship_id uuid not null,
  logic_gate_id_a uuid not null,
  logic_gate_id_b uuid not null,
  a_position logic_gate_relationship_position not null,
  b_position logic_gate_relationship_position not null,
  created_timestamp timestamptz not null,
  constraint logic_gate_relationships_position_pair_chk check (
    (a_position = 'Input' and b_position = 'Output')
    or (a_position = 'Output' and b_position = 'Input')
  ),
  constraint logic_gate_relationships_not_self_chk check (logic_gate_id_a <> logic_gate_id_b),
  primary key (company_id, logic_gate_relationship_id),
  foreign key (company_id, logic_gate_id_a) references logic_gates (company_id, logic_gate_id),
  foreign key (company_id, logic_gate_id_b) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_information (
  company_id uuid not null,
  information_id uuid not null,
  logic_gate_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint logic_gate_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_projection_table (
  company_id uuid not null,
  logic_gate_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint logic_gate_projection_table_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, logic_gate_id, information_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id)
);

create table if not exists logic_gate_map_positions (
  company_id uuid not null,
  logic_gate_id uuid not null,
  x double precision not null,
  y double precision not null,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, logic_gate_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create table if not exists user_logic_gate_shortcuts (
  user_id uuid not null,
  company_id uuid not null,
  logic_gate_id uuid not null,
  position integer not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (user_id, company_id, logic_gate_id),
  foreign key (user_id) references users (user_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_user_logic_gate_shortcuts_user_company_position
  on user_logic_gate_shortcuts(user_id, company_id, position, logic_gate_id);

-- Existing deployments may already have current-value logic_gate_information rows.
-- Seed the projection table once so the new hot read path can serve those rows too.
do $$
begin
  if to_regclass('public.idx_logic_gate_projection_table_one_text_box') is not null then
    execute $sql$
      insert into logic_gate_projection_table (
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      )
      select distinct on (company_id, logic_gate_id, type)
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      from logic_gate_information
      where btrim(information) <> ''
        and type = 'Text box'::information_type
      order by company_id, logic_gate_id, type, updated_timestamp desc, created_timestamp desc, information_id desc
      on conflict (company_id, logic_gate_id, type) where type = 'Text box'::information_type
      do update set
        information = excluded.information,
        updated_timestamp = excluded.updated_timestamp
      where logic_gate_projection_table.updated_timestamp <= excluded.updated_timestamp
    $sql$;

    execute $sql$
      insert into logic_gate_projection_table (
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      )
      select distinct on (company_id, logic_gate_id, information_id)
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      from logic_gate_information
      where btrim(information) <> ''
        and type <> 'Text box'::information_type
      order by company_id, logic_gate_id, information_id, updated_timestamp desc
      on conflict (company_id, logic_gate_id, information_id)
      do update set
        type = excluded.type,
        information = excluded.information,
        updated_timestamp = excluded.updated_timestamp
      where logic_gate_projection_table.updated_timestamp <= excluded.updated_timestamp
    $sql$;
  else
    execute $sql$
      insert into logic_gate_projection_table (
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      )
      select distinct on (company_id, logic_gate_id, information_id)
        company_id,
        logic_gate_id,
        information_id,
        type,
        information,
        created_timestamp,
        updated_timestamp
      from logic_gate_information
      where btrim(information) <> ''
      order by company_id, logic_gate_id, information_id, updated_timestamp desc
      on conflict (company_id, logic_gate_id, information_id)
      do update set
        type = excluded.type,
        information = excluded.information,
        updated_timestamp = excluded.updated_timestamp
      where logic_gate_projection_table.updated_timestamp <= excluded.updated_timestamp
    $sql$;
  end if;
end $$;
create table if not exists kanban_boards (
  company_id uuid not null,
  board_id text not null,
  logic_gate_id uuid,
  title text not null,
  position integer not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint kanban_boards_title_nonblank_chk check (btrim(title) <> ''),
  primary key (company_id, board_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create table if not exists kanban_columns (
  company_id uuid not null,
  board_id text not null,
  column_id uuid not null,
  title text not null,
  position integer not null,
  width_px integer not null default 260,
  height_px integer not null default 240,
  item_color text not null default '#fbb152',
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint kanban_columns_title_nonblank_chk check (btrim(title) <> ''),
  constraint kanban_columns_width_px_chk check (width_px between 180 and 2000),
  constraint kanban_columns_height_px_chk check (height_px between 160 and 10000),
  constraint kanban_columns_item_color_chk check (item_color ~ '^#[0-9A-Fa-f]{6}$'),
  primary key (company_id, board_id, column_id)
);

create table if not exists kanban_cards (
  company_id uuid not null,
  board_id text not null,
  card_id uuid not null,
  column_id uuid not null,
  node_id uuid not null,
  logic_gate_id uuid,
  node_title text not null,
  description_snapshot text not null default '',
  is_issue boolean not null default false,
  position integer not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint kanban_cards_node_title_nonblank_chk check (btrim(node_title) <> ''),
  primary key (company_id, board_id, card_id),
  foreign key (company_id, board_id, column_id) references kanban_columns (company_id, board_id, column_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  constraint kanban_cards_company_id_node_id_fkey foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade
);

with ranked_attached_boards as (
  select
    company_id,
    board_id,
    logic_gate_id,
    row_number() over (
      partition by company_id, logic_gate_id
      order by (board_id = 'logic-gate:' || logic_gate_id::text) desc, created_timestamp asc, board_id asc
    ) as rn
  from kanban_boards
  where logic_gate_id is not null
)
update kanban_boards board
set logic_gate_id = null,
    updated_timestamp = now()
from ranked_attached_boards ranked
where board.company_id = ranked.company_id
  and board.board_id = ranked.board_id
  and ranked.rn > 1;

with attached_boards as (
  select distinct on (company_id, logic_gate_id)
    company_id,
    logic_gate_id,
    board_id
  from kanban_boards
  where logic_gate_id is not null
  order by company_id, logic_gate_id, (board_id = 'logic-gate:' || logic_gate_id::text) desc, created_timestamp asc, board_id asc
),
updated_attached as (
  update kanban_boards board
  set title = coalesce(nullif(btrim(logic_gate.header), ''), 'Logic Gate Kanban'),
      updated_timestamp = now()
  from logic_gates logic_gate
  join attached_boards attached
    on attached.company_id = logic_gate.company_id
   and attached.logic_gate_id = logic_gate.logic_gate_id
  where board.company_id = attached.company_id
    and board.board_id = attached.board_id
  returning board.company_id, board.board_id, board.logic_gate_id
)
insert into kanban_boards (
  company_id,
  board_id,
  logic_gate_id,
  title,
  position,
  created_timestamp,
  updated_timestamp
)
select
  logic_gate.company_id,
  'logic-gate:' || logic_gate.logic_gate_id::text,
  logic_gate.logic_gate_id,
  coalesce(nullif(btrim(logic_gate.header), ''), 'Logic Gate Kanban'),
  coalesce((
    select max(existing.position)
    from kanban_boards existing
    where existing.company_id = logic_gate.company_id
  ), 0) + row_number() over (partition by logic_gate.company_id order by logic_gate.created_timestamp, logic_gate.logic_gate_id) * 1000,
  now(),
  now()
from logic_gates logic_gate
where not exists (
  select 1
  from updated_attached attached
  where attached.company_id = logic_gate.company_id
    and attached.logic_gate_id = logic_gate.logic_gate_id
)
on conflict (company_id, board_id)
do update set
  logic_gate_id = excluded.logic_gate_id,
  title = excluded.title,
  updated_timestamp = now();

with board_targets as (
  select distinct on (logic_gate.company_id, logic_gate.logic_gate_id)
    logic_gate.company_id,
    logic_gate.logic_gate_id,
    board.board_id
  from logic_gates logic_gate
  join kanban_boards board
    on board.company_id = logic_gate.company_id
   and board.logic_gate_id = logic_gate.logic_gate_id
  order by logic_gate.company_id, logic_gate.logic_gate_id, (board.board_id = 'logic-gate:' || logic_gate.logic_gate_id::text) desc, board.created_timestamp asc, board.board_id asc
)
insert into kanban_columns (
  company_id,
  board_id,
  column_id,
  title,
  position,
  width_px,
  height_px,
  item_color,
  created_timestamp,
  updated_timestamp
)
select
  target.company_id,
  target.board_id,
  md5((target.company_id::text || ':' || target.board_id || ':' || defaults.title))::uuid,
  defaults.title,
  defaults.position,
  260,
  240,
  defaults.color,
  now(),
  now()
from board_targets target
cross join (
  values
    ('Pending', 1000, '#808080'),
    ('In Progress', 2000, '#ff9500'),
    ('Verify', 3000, '#00aaff'),
    ('Done', 4000, '#39ff14')
) as defaults(title, position, color)
where not exists (
  select 1
  from kanban_columns column_row
  where column_row.company_id = target.company_id
    and column_row.board_id = target.board_id
    and lower(btrim(column_row.title)) = lower(btrim(defaults.title))
)
on conflict (company_id, board_id, column_id)
do update set
  title = excluded.title,
  updated_timestamp = now();

update kanban_cards card
set logic_gate_id = board.logic_gate_id
from kanban_boards board
where card.company_id = board.company_id
  and card.board_id = board.board_id
  and board.logic_gate_id is not null
  and card.logic_gate_id is distinct from board.logic_gate_id;

with ranked_logic_gate_cards as (
  select
    ctid,
    row_number() over (
      partition by company_id, node_id
      order by updated_timestamp desc, created_timestamp desc, card_id desc
    ) as rn
  from kanban_cards
  where logic_gate_id is not null
)
delete from kanban_cards target
using ranked_logic_gate_cards ranked
where target.ctid = ranked.ctid
  and ranked.rn > 1;

-- Source table for node-to-Logic-Gate work assignment.
-- Kanban cards remain compatibility/projection rows for the existing board UI.
create table if not exists node_logic_gate_assignments (
  assignment_id uuid not null,
  company_id uuid not null,
  node_id uuid not null,
  logic_gate_id uuid not null,
  status_key text not null,
  column_id uuid not null,
  is_issue boolean not null default false,
  position integer not null,
  compatibility_board_id text not null,
  compatibility_card_id uuid not null,
  version bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint node_logic_gate_assignments_status_key_chk check (btrim(status_key) <> ''),
  constraint node_logic_gate_assignments_version_positive_chk check (version > 0),
  primary key (company_id, assignment_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, compatibility_board_id, column_id) references kanban_columns (company_id, board_id, column_id)
);

create unique index if not exists idx_node_logic_gate_assignments_one_active_node
  on node_logic_gate_assignments(company_id, node_id);

create index if not exists idx_node_logic_gate_assignments_logic_gate_position
  on node_logic_gate_assignments(company_id, logic_gate_id, column_id, position, updated_timestamp desc);

create unique index if not exists idx_node_logic_gate_assignments_compat_card
  on node_logic_gate_assignments(company_id, compatibility_board_id, compatibility_card_id);

with ranked_logic_gate_cards as (
  select
    card.company_id,
    card.board_id,
    card.card_id,
    card.column_id,
    card.node_id,
    card.logic_gate_id,
    card.is_issue,
    card.position,
    card.created_timestamp,
    card.updated_timestamp,
    regexp_replace(lower(btrim(translate(column_row.title, '_-', '  '))), '[[:space:]]+', ' ', 'g') as status_key,
    row_number() over (
      partition by card.company_id, card.node_id
      order by card.updated_timestamp desc, card.created_timestamp desc, card.card_id desc
    ) as rn
  from kanban_cards card
  join kanban_columns column_row
    on column_row.company_id = card.company_id
   and column_row.board_id = card.board_id
   and column_row.column_id = card.column_id
  where card.logic_gate_id is not null
)
insert into node_logic_gate_assignments (
  assignment_id,
  company_id,
  node_id,
  logic_gate_id,
  status_key,
  column_id,
  is_issue,
  position,
  compatibility_board_id,
  compatibility_card_id,
  version,
  created_timestamp,
  updated_timestamp
)
select
  md5(card.company_id::text || ':' || card.node_id::text || ':' || card.logic_gate_id::text)::uuid,
  card.company_id,
  card.node_id,
  card.logic_gate_id,
  coalesce(nullif(card.status_key, ''), 'unknown'),
  card.column_id,
  card.is_issue,
  card.position,
  card.board_id,
  card.card_id,
  1,
  card.created_timestamp,
  card.updated_timestamp
from ranked_logic_gate_cards card
where card.rn = 1
on conflict (company_id, node_id)
do update set
  logic_gate_id = excluded.logic_gate_id,
  status_key = excluded.status_key,
  column_id = excluded.column_id,
  is_issue = excluded.is_issue,
  position = excluded.position,
  compatibility_board_id = excluded.compatibility_board_id,
  compatibility_card_id = excluded.compatibility_card_id,
  updated_timestamp = excluded.updated_timestamp;

create or replace function enforce_node_logic_gate_assignment_priority()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from nodes n
    where n.company_id = new.company_id
      and n.node_id = new.node_id
      and n.priority between 1 and 5
  ) then
    raise exception 'node_logic_gate_assignment_priority_required'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_node_logic_gate_assignment_priority on node_logic_gate_assignments;
create trigger trg_node_logic_gate_assignment_priority
before insert or update of company_id, node_id on node_logic_gate_assignments
for each row
execute function enforce_node_logic_gate_assignment_priority();

create or replace function sync_node_logic_gate_assignment_from_kanban_card()
returns trigger as $$
declare
  next_status_key text;
  next_assignment_id uuid;
begin
  if tg_op = 'DELETE' then
    if old.logic_gate_id is not null then
      delete from node_logic_gate_assignments assignment
      where assignment.company_id = old.company_id
        and assignment.node_id = old.node_id
        and assignment.compatibility_board_id = old.board_id
        and assignment.compatibility_card_id = old.card_id;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.logic_gate_id is not null
     and (
       new.logic_gate_id is null
       or old.company_id is distinct from new.company_id
       or old.node_id is distinct from new.node_id
       or old.board_id is distinct from new.board_id
       or old.card_id is distinct from new.card_id
     ) then
    delete from node_logic_gate_assignments assignment
    where assignment.company_id = old.company_id
      and assignment.node_id = old.node_id
      and assignment.compatibility_board_id = old.board_id
      and assignment.compatibility_card_id = old.card_id;
  end if;

  if new.logic_gate_id is not null then
    select regexp_replace(lower(btrim(translate(column_row.title, '_-', '  '))), '[[:space:]]+', ' ', 'g')
    into next_status_key
    from kanban_columns column_row
    where column_row.company_id = new.company_id
      and column_row.board_id = new.board_id
      and column_row.column_id = new.column_id;

    next_status_key := coalesce(nullif(next_status_key, ''), 'unknown');

    select assignment.assignment_id
    into next_assignment_id
    from node_logic_gate_assignments assignment
    where assignment.company_id = new.company_id
      and assignment.node_id = new.node_id;

    next_assignment_id := coalesce(
      next_assignment_id,
      md5(new.company_id::text || ':' || new.node_id::text || ':' || new.logic_gate_id::text)::uuid
    );

    insert into node_logic_gate_assignments (
      assignment_id,
      company_id,
      node_id,
      logic_gate_id,
      status_key,
      column_id,
      is_issue,
      position,
      compatibility_board_id,
      compatibility_card_id,
      version,
      created_timestamp,
      updated_timestamp
    ) values (
      next_assignment_id,
      new.company_id,
      new.node_id,
      new.logic_gate_id,
      next_status_key,
      new.column_id,
      new.is_issue,
      new.position,
      new.board_id,
      new.card_id,
      1,
      new.created_timestamp,
      new.updated_timestamp
    )
    on conflict (company_id, node_id)
    do update set
      logic_gate_id = excluded.logic_gate_id,
      status_key = excluded.status_key,
      column_id = excluded.column_id,
      is_issue = excluded.is_issue,
      position = excluded.position,
      compatibility_board_id = excluded.compatibility_board_id,
      compatibility_card_id = excluded.compatibility_card_id,
      version = case
        when node_logic_gate_assignments.logic_gate_id is distinct from excluded.logic_gate_id
          or node_logic_gate_assignments.status_key is distinct from excluded.status_key
          or node_logic_gate_assignments.column_id is distinct from excluded.column_id
          or node_logic_gate_assignments.is_issue is distinct from excluded.is_issue
          or node_logic_gate_assignments.position is distinct from excluded.position
          or node_logic_gate_assignments.compatibility_board_id is distinct from excluded.compatibility_board_id
          or node_logic_gate_assignments.compatibility_card_id is distinct from excluded.compatibility_card_id
        then node_logic_gate_assignments.version + 1
        else node_logic_gate_assignments.version
      end,
      updated_timestamp = case
        when node_logic_gate_assignments.logic_gate_id is distinct from excluded.logic_gate_id
          or node_logic_gate_assignments.status_key is distinct from excluded.status_key
          or node_logic_gate_assignments.column_id is distinct from excluded.column_id
          or node_logic_gate_assignments.is_issue is distinct from excluded.is_issue
          or node_logic_gate_assignments.position is distinct from excluded.position
          or node_logic_gate_assignments.compatibility_board_id is distinct from excluded.compatibility_board_id
          or node_logic_gate_assignments.compatibility_card_id is distinct from excluded.compatibility_card_id
        then now()
        else node_logic_gate_assignments.updated_timestamp
      end;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_node_logic_gate_assignment_from_kanban_card on kanban_cards;
create trigger trg_sync_node_logic_gate_assignment_from_kanban_card
after insert or update or delete on kanban_cards
for each row execute function sync_node_logic_gate_assignment_from_kanban_card();

-- Targeted read model for RACIO matrix and work-item inbox endpoints.
-- Source of truth remains nodes, node_logic_gate_assignments, logic_gates,
-- logic_gate_raci_assignments, users, and company_memberships. Application writes
-- maintain only affected rows; there are intentionally no whole-table rebuild
-- triggers or database-side rebuild functions for this projection.
create table if not exists racio_matrix_projection_table (
  company_id uuid not null,
  user_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  logic_gate_id uuid,
  display_title text not null default '',
  status text,
  status_color text,
  due_date date,
  priority smallint,
  assignee_user_id uuid,
  assignee_display_name text,
  assignee_email text,
  resource_created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint racio_matrix_projection_resource_type_chk check (resource_type in ('node', 'logic_gate')),
  constraint racio_matrix_projection_shape_chk check (
    (resource_type = 'node')
    or (resource_type = 'logic_gate' and logic_gate_id = resource_id)
  ),
  primary key (company_id, user_id, resource_type, resource_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

create index if not exists idx_racio_projection_node_read
  on racio_matrix_projection_table(company_id, user_id, resource_type, logic_gate_id, resource_created_timestamp, resource_id)
  where resource_type = 'node';

create index if not exists idx_racio_projection_logic_gate_read
  on racio_matrix_projection_table(company_id, user_id, resource_type, lower(display_title), resource_id)
  where resource_type = 'logic_gate';

create index if not exists idx_racio_projection_logic_gate_user
  on racio_matrix_projection_table(company_id, logic_gate_id, user_id);

create index if not exists idx_racio_projection_resource
  on racio_matrix_projection_table(company_id, resource_type, resource_id);
create index if not exists idx_node_information_node on node_information(company_id, node_id);
create index if not exists idx_node_projection_table_node_updated on node_projection_table(company_id, node_id, updated_timestamp desc);
drop index if exists idx_node_projection_table_one_text_box;
create index if not exists idx_node_projection_table_node_type_created
  on node_projection_table(company_id, node_id, type, created_timestamp, information_id);
create index if not exists idx_node_content_changes_node_created
  on node_content_changes(company_id, node_id, created_timestamp, change_id);
create index if not exists idx_node_content_change_seen_user
  on node_content_change_seen(company_id, user_id, change_id);
create index if not exists idx_node_projection_seen_user
  on node_projection_seen_snapshots(company_id, user_id, node_id, information_id);
create index if not exists idx_node_map_positions_company_updated on node_map_positions(company_id, updated_timestamp desc);
create index if not exists idx_node_relationships_a on node_relationships(company_id, node_id_a);
create index if not exists idx_node_relationships_b on node_relationships(company_id, node_id_b);
create index if not exists idx_logic_gate_information_logic_gate on logic_gate_information(company_id, logic_gate_id);
create index if not exists idx_logic_gate_projection_table_logic_gate_updated on logic_gate_projection_table(company_id, logic_gate_id, updated_timestamp desc);
with ranked_logic_gate_text as (
  select ctid,
         row_number() over (
           partition by company_id, logic_gate_id, type
           order by updated_timestamp desc, created_timestamp desc, information_id desc
         ) as rn
  from logic_gate_projection_table
  where type = 'Text box'::information_type
)
delete from logic_gate_projection_table target
using ranked_logic_gate_text ranked
where target.ctid = ranked.ctid
  and ranked.rn > 1;
create unique index if not exists idx_logic_gate_projection_table_one_text_box on logic_gate_projection_table(company_id, logic_gate_id, type) where type = 'Text box'::information_type;
create index if not exists idx_logic_gate_map_positions_company_updated on logic_gate_map_positions(company_id, updated_timestamp desc);
create index if not exists idx_logic_gate_relationships_a on logic_gate_relationships(company_id, logic_gate_id_a);
create index if not exists idx_logic_gate_relationships_b on logic_gate_relationships(company_id, logic_gate_id_b);
create index if not exists idx_kanban_boards_company_position on kanban_boards(company_id, position, board_id);
create unique index if not exists idx_kanban_boards_logic_gate
  on kanban_boards(company_id, logic_gate_id)
  where logic_gate_id is not null;
create index if not exists idx_kanban_columns_board_position on kanban_columns(company_id, board_id, position);
create index if not exists idx_kanban_cards_column_position on kanban_cards(company_id, board_id, column_id, position);
create unique index if not exists idx_kanban_cards_unique_node on kanban_cards(company_id, board_id, node_id);
create unique index if not exists idx_kanban_cards_one_logic_gate_card_per_node
  on kanban_cards(company_id, node_id)
  where logic_gate_id is not null;

create table if not exists communications_email_nodes (
  company_id uuid not null,
  user_id uuid not null,
  message_id text not null,
  node_id uuid not null,
  board_id text not null,
  card_id uuid not null,
  logic_gate_id uuid not null,
  message jsonb not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_email_nodes_message_id_nonblank_chk check (btrim(message_id) <> ''),
  primary key (company_id, node_id),
  unique (company_id, board_id, card_id),
  foreign key (user_id) references users (user_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, board_id, card_id) references kanban_cards (company_id, board_id, card_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create index if not exists idx_communications_email_nodes_user_message
  on communications_email_nodes(user_id, message_id);

create index if not exists idx_communications_email_nodes_logic_gate
  on communications_email_nodes(company_id, logic_gate_id, created_timestamp desc);

create table if not exists company_explorer_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  folder_kind text not null,
  system_key text,
  name text not null,
  account_email text,
  position integer not null default 1000,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint company_explorer_folders_kind_chk check (folder_kind in ('node', 'logic_gate', 'communications')),
  constraint company_explorer_folders_system_key_nonblank_chk check (system_key is null or btrim(system_key) <> ''),
  constraint company_explorer_folders_account_email_chk check (
    account_email is null or (
      folder_kind = 'communications'
      and btrim(account_email) <> ''
      and account_email = lower(btrim(account_email))
    )
  ),
  constraint company_explorer_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint company_explorer_folders_parent_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id),
  primary key (company_id, folder_id),
  foreign key (company_id, parent_folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade
);

create unique index if not exists idx_company_explorer_folders_system_key
  on company_explorer_folders(company_id, system_key)
  where system_key is not null;

create index if not exists idx_company_explorer_folders_parent_kind
  on company_explorer_folders(company_id, folder_kind, parent_folder_id, position, created_timestamp);

create index if not exists idx_company_explorer_folders_account_email
  on company_explorer_folders(company_id, account_email)
  where account_email is not null;

create table if not exists communications_shared_inbox_raci_assignments (
  company_id uuid not null,
  folder_id uuid not null,
  role text not null,
  user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint communications_shared_inbox_raci_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  primary key (company_id, folder_id, role, user_id),
  foreign key (company_id, folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_communications_shared_inbox_raci_user_role_folder
  on communications_shared_inbox_raci_assignments(company_id, user_id, role, folder_id);

create index if not exists idx_communications_shared_inbox_raci_folder_role_user
  on communications_shared_inbox_raci_assignments(company_id, folder_id, role, user_id);

create table if not exists communications_shared_inbox_raci_group_assignments (
  company_id uuid not null,
  folder_id uuid not null,
  role text not null,
  group_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint communications_shared_inbox_raci_group_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  primary key (company_id, folder_id, role, group_id),
  foreign key (company_id, folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade,
  foreign key (company_id, group_id) references company_user_groups (company_id, group_id) on delete cascade
);

create index if not exists idx_communications_shared_inbox_raci_group_role_folder
  on communications_shared_inbox_raci_group_assignments(company_id, group_id, role, folder_id);

create index if not exists idx_communications_shared_inbox_raci_folder_role_group
  on communications_shared_inbox_raci_group_assignments(company_id, folder_id, role, group_id);

create table if not exists company_explorer_default_folder_seeds (
  company_id uuid not null,
  seed_key text not null,
  created_timestamp timestamptz not null default now(),
  constraint company_explorer_default_folder_seeds_key_nonblank_chk check (btrim(seed_key) <> ''),
  primary key (company_id, seed_key)
);

create table if not exists company_explorer_folder_items (
  company_id uuid not null,
  folder_id uuid not null,
  item_type text not null,
  item_id text not null,
  position integer not null default 1000,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint company_explorer_folder_items_type_chk check (item_type in ('node', 'logic_gate')),
  primary key (company_id, item_type, item_id),
  foreign key (company_id, folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade
);

create index if not exists idx_company_explorer_folder_items_folder_type
  on company_explorer_folder_items(company_id, folder_id, item_type, position, created_timestamp);

create table if not exists company_explorer_folder_shares (
  company_id uuid not null,
  folder_id uuid not null,
  email text not null,
  user_id uuid,
  status text not null default 'pending',
  invited_by_user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint company_explorer_folder_shares_email_nonblank_chk check (btrim(email) <> ''),
  constraint company_explorer_folder_shares_email_lowercase_chk check (email = lower(btrim(email))),
  constraint company_explorer_folder_shares_status_chk check (status in ('pending', 'active')),
  constraint company_explorer_folder_shares_status_user_chk check (
    (status = 'pending' and user_id is null) or
    (status = 'active' and user_id is not null)
  ),
  primary key (company_id, folder_id, email),
  foreign key (company_id, folder_id) references company_explorer_folders (company_id, folder_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade,
  foreign key (invited_by_user_id) references users (user_id) on delete cascade
);

create index if not exists idx_company_explorer_folder_shares_user
  on company_explorer_folder_shares(company_id, user_id, folder_id)
  where user_id is not null;

create index if not exists idx_company_explorer_folder_shares_email_status
  on company_explorer_folder_shares(company_id, email, status);

-- Domain event outbox, notification outbox, and recipient feed.
create table if not exists domain_events (
  event_id uuid not null,
  company_id uuid not null,
  stream_type text not null,
  stream_id text not null,
  sequence bigint not null,
  event_type text not null,
  actor_user_id uuid,
  idempotency_key text not null default '',
  payload jsonb not null default '{}'::jsonb,
  published_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  constraint domain_events_stream_type_nonblank_chk check (btrim(stream_type) <> ''),
  constraint domain_events_stream_id_nonblank_chk check (btrim(stream_id) <> ''),
  constraint domain_events_event_type_nonblank_chk check (btrim(event_type) <> ''),
  constraint domain_events_sequence_positive_chk check (sequence > 0),
  primary key (company_id, event_id),
  unique (company_id, stream_type, stream_id, sequence),
  foreign key (actor_user_id) references users (user_id) on delete set null
);

create unique index if not exists idx_domain_events_idempotency_key
  on domain_events(company_id, idempotency_key)
  where btrim(idempotency_key) <> '';

create index if not exists idx_domain_events_stream_sequence
  on domain_events(company_id, stream_type, stream_id, sequence);

create index if not exists idx_domain_events_pending
  on domain_events(created_timestamp, company_id, event_id)
  where published_timestamp is null;

create index if not exists idx_domain_events_company_created
  on domain_events(company_id, created_timestamp desc, event_id desc);
create table if not exists workspace_read_versions (
  company_id uuid not null,
  scope text not null,
  resource_key text not null default '',
  version bigint not null default 0,
  updated_timestamp timestamptz not null default now(),
  constraint workspace_read_versions_scope_nonblank_chk check (btrim(scope) <> ''),
  constraint workspace_read_versions_version_nonnegative_chk check (version >= 0),
  primary key (company_id, scope, resource_key)
);

create index if not exists idx_workspace_read_versions_scope_company
  on workspace_read_versions(scope, company_id, resource_key);

create or replace function workspace_static_read_version_keys()
returns table(scope text, resource_key text) as $$
  select *
  from (values
    ('workspace-snapshot:full', ''),
    ('workspace-snapshot:node_map', ''),
    ('workspace-snapshot:node_map_window', ''),
    ('workspace-snapshot:logic_gate_map', ''),
    ('workspace-snapshot:logic_gate_map_window', ''),
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
    ('logic-gate-relationships', ''),
    ('map-layout:node', ''),
    ('map-layout:node-window', ''),
    ('map-layout:logic_gate', ''),
    ('map-layout:logic_gate-window', ''),
    ('kanban-boards', '')
  ) as keys(scope, resource_key)
$$ language sql immutable;

create or replace function workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb)
returns table(scope text, resource_key text) as $$
declare
  board_id text := btrim(coalesce(p_payload->>'board_id', ''));
  folder_kind text := btrim(coalesce(p_payload->>'folder_kind', ''));
  item_type text := btrim(coalesce(p_payload->>'item_type', ''));
begin
  return query select v.scope, v.resource_key from (values
    ('workspace-snapshot:full', '')
  ) as v(scope, resource_key);

  if p_event_type = any(array[
    'node_created',
    'node_updated',
    'node_deleted',
    'kanban_card_upserted',
    'kanban_card_moved',
    'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved',
    'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed',
    'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted',
    'kanban_board_deleted',
    'node_permissions_updated'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('nodes', ''),
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', ''),
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
    return query select v.scope, v.resource_key from (values
      ('node-relationships', ''),
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'node_map_positions_updated' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:node', ''),
      ('map-layout:node-window', ''),
      ('workspace-snapshot:node_map', ''),
      ('workspace-snapshot:node_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'node_deleted' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:node', ''),
      ('map-layout:node-window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array['logic_gate_created', 'logic_gate_updated', 'logic_gate_deleted', 'logic_gate_raci_updated', 'logic_gate_permissions_updated']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gates', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', ''),
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

  if p_event_type = any(array['logic_gate_relationship_created', 'logic_gate_relationship_deleted', 'logic_gate_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('logic-gate-relationships', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'logic_gate_map_positions_updated' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:logic_gate', ''),
      ('map-layout:logic_gate-window', ''),
      ('workspace-snapshot:logic_gate_map', ''),
      ('workspace-snapshot:logic_gate_map_window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = 'logic_gate_deleted' then
    return query select v.scope, v.resource_key from (values
      ('map-layout:logic_gate', ''),
      ('map-layout:logic_gate-window', '')
    ) as v(scope, resource_key);
  end if;

  if p_event_type = any(array[
    'company_explorer_folder_created',
    'company_explorer_folder_updated',
    'company_explorer_folder_deleted',
    'communications_shared_inbox_raci_updated',
    'shared_triage_access_updated'
  ]::text[]) then
    if folder_kind = 'node' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:node_map', ''),
        ('workspace-snapshot:node_map_window', ''),
        ('map-layout:node-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif folder_kind = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:logic_gate_map', ''),
        ('workspace-snapshot:logic_gate_map_window', ''),
        ('map-layout:logic_gate-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:logic_gate')
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
        ('workspace-snapshot:node_map', ''),
        ('workspace-snapshot:node_map_window', ''),
        ('map-layout:node-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:node'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:node')
      ) as v(scope, resource_key);
    elsif item_type = 'logic_gate' then
      return query select v.scope, v.resource_key from (values
        ('workspace-snapshot:logic_gate_map', ''),
        ('workspace-snapshot:logic_gate_map_window', ''),
        ('map-layout:logic_gate-window', ''),
        ('workspace-snapshot:company_explorer', ''),
        ('workspace-snapshot:company_explorer', 'folder_kind:logic_gate'),
        ('company-explorer-folder-items', ''),
        ('company-explorer-folder-items', 'item_type:logic_gate')
      ) as v(scope, resource_key);
    end if;
  end if;

  if p_event_type = any(array['kanban_board_saved', 'kanban_board_updated', 'kanban_board_deleted', 'logic_gate_deleted']::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-boards', '')
    ) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_column_created',
    'kanban_column_updated',
    'kanban_column_deleted',
    'kanban_board_deleted',
    'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-columns', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;

  if board_id <> '' and p_event_type = any(array[
    'kanban_card_upserted',
    'kanban_card_moved',
    'kanban_card_deleted',
    'work_item.logic_gate_assignment_saved',
    'work_item.logic_gate_assignment_moved',
    'work_item.logic_gate_assignment_removed',
    'work_item.logic_gate_issue_toggled',
    'kanban_column_deleted',
    'kanban_board_deleted',
    'node_deleted',
    'logic_gate_deleted'
  ]::text[]) then
    return query select v.scope, v.resource_key from (values
      ('kanban-cards', 'board_id:' || board_id),
      ('workspace-snapshot:kanban', 'board_id:' || board_id)
    ) as v(scope, resource_key);
  end if;
end;
$$ language plpgsql immutable;

create or replace function trg_update_workspace_read_versions()
returns trigger as $$
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
$$ language plpgsql;

drop trigger if exists trg_update_workspace_read_versions on domain_events;
create trigger trg_update_workspace_read_versions
after insert on domain_events
for each row execute function trg_update_workspace_read_versions();

insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
select company.company_id, key.scope, key.resource_key, 0, now()
from companies company
cross join workspace_static_read_version_keys() key
on conflict (company_id, scope, resource_key) do nothing;

with version_events as (
  select
    event.company_id,
    key.scope,
    key.resource_key,
    max(event.sequence) as version,
    max(event.created_timestamp) as updated_timestamp
  from domain_events event
  cross join lateral (
    select distinct scope, resource_key
    from workspace_read_version_keys_for_domain_event(event.event_type, event.payload)
  ) key
  where event.stream_type = 'workspace'
    and event.stream_id = event.company_id::text
  group by event.company_id, key.scope, key.resource_key
)
insert into workspace_read_versions (company_id, scope, resource_key, version, updated_timestamp)
select company_id, scope, resource_key, version, updated_timestamp
from version_events
on conflict (company_id, scope, resource_key)
do update set
  version = greatest(workspace_read_versions.version, excluded.version),
  updated_timestamp = greatest(workspace_read_versions.updated_timestamp, excluded.updated_timestamp);

create table if not exists notification_domain_event_projection_checkpoints (
  company_id uuid primary key,
  checkpoint_timestamp timestamptz not null,
  checkpoint_event_id uuid not null,
  updated_timestamp timestamptz not null default now()
);

create table if not exists workspace_derived_domain_event_projection_checkpoints (
  company_id uuid primary key,
  checkpoint_timestamp timestamptz not null,
  checkpoint_event_id uuid not null,
  updated_timestamp timestamptz not null default now()
);

create table if not exists notifications (
  notification_id uuid not null,
  company_id uuid,
  recipient_user_id uuid not null,
  actor_user_id uuid,
  notification_type text not null,
  source_event_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  title text not null,
  body_preview text not null default '',
  surface text not null default '',
  role text not null default '',
  logic_gate_id text not null default '',
  node_id text not null default '',
  information_id text not null default '',
  read_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  constraint notifications_type_nonblank_chk check (btrim(notification_type) <> ''),
  constraint notifications_entity_type_nonblank_chk check (btrim(entity_type) <> ''),
  constraint notifications_entity_id_nonblank_chk check (btrim(entity_id) <> ''),
  constraint notifications_title_nonblank_chk check (btrim(title) <> ''),
  constraint notifications_surface_chk check (surface = '' or surface in ('r_inbox', 'aci_inbox', 'my_triage', 'shared_triage')),
  constraint notifications_role_chk check (role = '' or role in ('responsible', 'accountable', 'consulted', 'informed', 'other')),
  primary key (notification_id),
  foreign key (recipient_user_id) references users (user_id) on delete cascade,
  foreign key (actor_user_id) references users (user_id) on delete set null
);

comment on column notifications.source_event_id is
  'Notification source UUID. Notifications V1 writes committed domain_events event_id values for new projected rows, but this column is intentionally not foreign-key constrained so existing historical source UUIDs remain valid.';

create unique index if not exists idx_notifications_dedupe
  on notifications(recipient_user_id, source_event_id, notification_type, entity_type, entity_id);

create index if not exists idx_notifications_source_event_id
  on notifications(source_event_id);

create index if not exists idx_notifications_recipient_created
  on notifications(recipient_user_id, created_timestamp desc, notification_id desc);

create index if not exists idx_notifications_recipient_company_created
  on notifications(recipient_user_id, company_id, created_timestamp desc, notification_id desc);

create index if not exists idx_notifications_recipient_unread
  on notifications(recipient_user_id, created_timestamp desc, notification_id desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_company_unread
  on notifications(recipient_user_id, company_id, created_timestamp desc, notification_id desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_summary_unread
  on notifications(recipient_user_id, company_id, surface, role, created_timestamp desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_type_unread
  on notifications(recipient_user_id, company_id, notification_type, created_timestamp desc, notification_id desc)
  where read_timestamp is null;

create index if not exists idx_notifications_recipient_logic_gate_unread
  on notifications(recipient_user_id, company_id, logic_gate_id, node_id, role, created_timestamp desc)
  where read_timestamp is null and btrim(logic_gate_id) <> '';
