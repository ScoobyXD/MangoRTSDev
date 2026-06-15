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

create table if not exists account_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint account_folders_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, folder_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_account_folders_parent_position
  on account_folders(company_id, parent_folder_id, position, lower(name), folder_id);

create table if not exists accounts (
  company_id uuid not null,
  account_id uuid not null,
  name text not null,
  folder_id uuid,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint accounts_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, account_id),
  foreign key (company_id) references companies (company_id) on delete cascade
);

create index if not exists idx_accounts_company_name
  on accounts(company_id, lower(name), account_id);

create index if not exists idx_accounts_folder_position
  on accounts(company_id, folder_id, position, lower(name), account_id);

create table if not exists node_account_assignments (
  company_id uuid not null,
  node_id uuid not null,
  account_id uuid not null,
  created_timestamp timestamptz not null default now(),
  primary key (company_id, node_id, account_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, account_id) references accounts (company_id, account_id) on delete cascade
);

create index if not exists idx_node_account_assignments_account
  on node_account_assignments(company_id, account_id, node_id);

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

create table if not exists projects (
  company_id uuid not null,
  project_id uuid not null,
  name text not null,
  status text not null default 'Active',
  account_id uuid,
  team_id uuid,
  default_access text not null default 'edit',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint projects_name_nonblank_chk check (btrim(name) <> ''),
  constraint projects_status_nonblank_chk check (btrim(status) <> ''),
  constraint projects_default_access_chk check (default_access in ('edit', 'no_access')),
  primary key (company_id, project_id),
  foreign key (company_id) references companies(company_id) on delete cascade
);

create index if not exists idx_projects_company_name
  on projects(company_id, lower(name), project_id);

create index if not exists idx_projects_account
  on projects(company_id, account_id, lower(name), project_id)
  where account_id is not null;

create index if not exists idx_projects_team
  on projects(company_id, team_id, lower(name), project_id)
  where team_id is not null;

create table if not exists project_information (
  company_id uuid not null,
  information_id uuid not null,
  project_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_information_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, information_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_information_project
  on project_information(company_id, project_id, created_timestamp, information_id);

create table if not exists project_projection_table (
  company_id uuid not null,
  project_id uuid not null,
  information_id uuid not null,
  type information_type not null,
  information text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_projection_table_nonblank_chk check (btrim(information) <> ''),
  primary key (company_id, project_id, information_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_projection_table_project_created
  on project_projection_table(company_id, project_id, type, created_timestamp desc, information_id);

create table if not exists project_relationships (
  company_id uuid not null,
  relationship_id uuid not null,
  project_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint project_relationships_resource_type_chk check (resource_type in ('logic_gate', 'node')),
  primary key (company_id, relationship_id),
  unique (company_id, project_id, resource_type, resource_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade
);

create index if not exists idx_project_relationships_project_position
  on project_relationships(company_id, project_id, position, relationship_id);

create index if not exists idx_project_relationships_resource
  on project_relationships(company_id, resource_type, resource_id, project_id);

create table if not exists project_relationship_projection (
  company_id uuid not null,
  project_id uuid not null,
  relationship_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  logic_gate_id uuid,
  node_id uuid,
  assignment_id uuid,
  display_title text not null,
  status text,
  status_color text,
  position integer not null default 0,
  resource_created_timestamp timestamptz not null,
  relationship_created_timestamp timestamptz not null,
  relationship_updated_timestamp timestamptz not null,
  projection_updated_timestamp timestamptz not null default now(),
  constraint project_relationship_projection_resource_type_chk check (resource_type in ('logic_gate', 'node')),
  constraint project_relationship_projection_title_chk check (btrim(display_title) <> ''),
  constraint project_relationship_projection_target_chk check (
    (resource_type='logic_gate' and logic_gate_id is not null and node_id is null and assignment_id is null and resource_id=logic_gate_id)
    or (resource_type='node' and node_id is not null and resource_id=node_id)
  ),
  primary key (company_id, relationship_id),
  foreign key (company_id, project_id) references projects(company_id, project_id) on delete cascade,
  foreign key (company_id, relationship_id) references project_relationships(company_id, relationship_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, node_id) references nodes(company_id, node_id) on delete cascade
);

create index if not exists idx_project_relationship_projection_project
  on project_relationship_projection(company_id, project_id, position, lower(display_title), relationship_id);

create index if not exists idx_project_relationship_projection_relationship
  on project_relationship_projection(company_id, relationship_id);

create index if not exists idx_project_relationship_projection_resource
  on project_relationship_projection(company_id, resource_type, resource_id);

create index if not exists idx_project_relationship_projection_node
  on project_relationship_projection(company_id, node_id);

create index if not exists idx_project_relationship_projection_logic_gate
  on project_relationship_projection(company_id, logic_gate_id);

create index if not exists idx_project_relationship_projection_assignment
  on project_relationship_projection(company_id, assignment_id);

create table if not exists resource_raci_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  subject_type text not null,
  subject_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint resource_raci_assignments_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder')),
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
  constraint entity_access_permissions_entity_type_chk check (entity_type in ('node', 'logic_gate', 'project', 'company_explorer_folder')),
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
  constraint resource_access_grants_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_triage_folder')),
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
  constraint resource_permissions_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project', 'company_explorer_folder')),
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
    union all
    select coalesce(project.default_access, 'edit')
    from projects project, normalized_resource normalized
    where normalized.resource_type='project'
      and project.company_id=p_company_id
      and project.project_id=p_resource_id
    union all
    select coalesce(folder.default_access, 'edit')
    from company_explorer_folders folder, normalized_resource normalized
    where normalized.resource_type='company_explorer_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
      and folder.folder_kind <> 'communications'
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
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_triage_folder') then false
    when (select allowed from role_admin_actor) then true
    when normalized_resource.resource_type in ('node', 'logic_gate', 'project', 'company_explorer_folder')
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
-- Source table for node-to-Logic-Gate work assignment.
-- Kanban board/card API shapes are synthesized from this source and kanban_board_projection.
create table if not exists node_logic_gate_assignments (
  assignment_id uuid not null,
  company_id uuid not null,
  node_id uuid not null,
  logic_gate_id uuid not null,
  status_key text not null,
  column_id text not null,
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
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade
);

create unique index if not exists idx_node_logic_gate_assignments_one_active_node
  on node_logic_gate_assignments(company_id, node_id);

create index if not exists idx_node_logic_gate_assignments_logic_gate_position
  on node_logic_gate_assignments(company_id, logic_gate_id, column_id, position, updated_timestamp desc);

create unique index if not exists idx_node_logic_gate_assignments_compat_card
  on node_logic_gate_assignments(company_id, compatibility_board_id, compatibility_card_id);

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

-- Disposable Logic Gate Kanban read model. Source truth remains nodes,
-- logic_gates, node_logic_gate_assignments, and access/RACI tables.
create table if not exists kanban_board_projection (
  company_id uuid not null,
  logic_gate_id uuid not null,
  node_id uuid not null,
  status text not null,
  column_id text not null,
  position integer not null,
  title text not null,
  assignee_user_id uuid,
  priority smallint,
  is_issue boolean not null default false,
  due_date date,
  node_created_timestamp timestamptz not null,
  node_updated_timestamp timestamptz not null,
  assignment_id uuid not null,
  assignment_created_timestamp timestamptz not null,
  assignment_updated_timestamp timestamptz not null,
  compatibility_board_id text not null,
  compatibility_card_id uuid not null,
  accounts jsonb not null default '[]'::jsonb,
  projection_updated_timestamp timestamptz not null default now(),
  constraint kanban_board_projection_status_nonblank_chk check (btrim(status) <> ''),
  constraint kanban_board_projection_title_nonblank_chk check (btrim(title) <> ''),
  constraint kanban_board_projection_priority_chk check (priority is null or priority between 1 and 5),
  constraint kanban_board_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array'),
  primary key (company_id, logic_gate_id, node_id),
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (assignee_user_id) references users (user_id)
);

insert into kanban_board_projection (
  company_id,
  logic_gate_id,
  node_id,
  status,
  column_id,
  position,
  title,
  assignee_user_id,
  priority,
  is_issue,
  due_date,
  node_created_timestamp,
  node_updated_timestamp,
  assignment_id,
  assignment_created_timestamp,
  assignment_updated_timestamp,
  compatibility_board_id,
  compatibility_card_id,
  accounts,
  projection_updated_timestamp
)
select
  assignment.company_id,
  assignment.logic_gate_id,
  assignment.node_id,
  assignment.status_key,
  assignment.column_id,
  assignment.position,
  node_row.title,
  node_row.assignee_user_id,
  node_row.priority,
  assignment.is_issue,
  node_row.due_date,
  node_row.created_timestamp,
  greatest(node_row.created_timestamp, assignment.updated_timestamp),
  assignment.assignment_id,
  assignment.created_timestamp,
  assignment.updated_timestamp,
  assignment.compatibility_board_id,
  assignment.compatibility_card_id,
  coalesce(account_snapshot.accounts_json, '[]'::jsonb),
  now()
from node_logic_gate_assignments assignment
join nodes node_row
  on node_row.company_id = assignment.company_id
 and node_row.node_id = assignment.node_id
join logic_gates logic_gate
  on logic_gate.company_id = assignment.company_id
 and logic_gate.logic_gate_id = assignment.logic_gate_id
left join lateral (
  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', account.company_id::text,
    'account_id', account.account_id::text,
    'name', account.name,
    'folder_id', account.folder_id::text,
    'position', account.position,
    'created_timestamp', account.created_timestamp,
    'updated_timestamp', account.updated_timestamp
  ) order by account.position asc, lower(account.name) asc, account.account_id::text asc), '[]'::jsonb) as accounts_json
  from node_account_assignments node_account
  join accounts account
    on account.company_id=node_account.company_id
   and account.account_id=node_account.account_id
  where node_account.company_id=assignment.company_id
    and node_account.node_id=assignment.node_id
) account_snapshot on true
on conflict (company_id, logic_gate_id, node_id)
do update set
  status = excluded.status,
  column_id = excluded.column_id,
  position = excluded.position,
  title = excluded.title,
  assignee_user_id = excluded.assignee_user_id,
  priority = excluded.priority,
  is_issue = excluded.is_issue,
  due_date = excluded.due_date,
  node_created_timestamp = excluded.node_created_timestamp,
  node_updated_timestamp = excluded.node_updated_timestamp,
  assignment_id = excluded.assignment_id,
  assignment_created_timestamp = excluded.assignment_created_timestamp,
  assignment_updated_timestamp = excluded.assignment_updated_timestamp,
  compatibility_board_id = excluded.compatibility_board_id,
  compatibility_card_id = excluded.compatibility_card_id,
  accounts = excluded.accounts,
  projection_updated_timestamp = now();

create table if not exists company_projection_sequences (
  company_id uuid not null,
  projection_name text not null,
  projection_scope text not null default '',
  sequence bigint not null default 0,
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, projection_name, projection_scope),
  foreign key (company_id) references companies (company_id) on delete cascade,
  constraint company_projection_sequences_name_nonblank_chk check (btrim(projection_name) <> ''),
  constraint company_projection_sequences_scope_not_null_chk check (projection_scope is not null),
  constraint company_projection_sequences_sequence_nonnegative_chk check (sequence >= 0)
);

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
  accounts jsonb not null default '[]'::jsonb,
  resource_created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint racio_matrix_projection_resource_type_chk check (resource_type in ('node', 'logic_gate')),
  constraint racio_matrix_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array'),
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
create index if not exists idx_kanban_board_projection_hot_read
  on kanban_board_projection(company_id, logic_gate_id, status, position, node_id);
create index if not exists idx_kanban_board_projection_node
  on kanban_board_projection(company_id, node_id);
create index if not exists idx_kanban_board_projection_updated
  on kanban_board_projection(company_id, logic_gate_id, projection_updated_timestamp desc, node_id);

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
  default_access text not null default 'edit',
  account_email text,
  scope_type text not null default 'company',
  scope_id text,
  position integer not null default 1000,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  constraint company_explorer_folders_kind_chk check (folder_kind in ('node', 'logic_gate', 'project', 'communications')),
  constraint company_explorer_folders_default_access_chk check (default_access in ('edit', 'no_access')),
  constraint company_explorer_folders_scope_chk check (
    scope_type in ('company', 'user', 'team')
    and (
      (scope_type = 'company' and scope_id is null)
      or (scope_type in ('user', 'team') and scope_id is not null and btrim(scope_id) <> '')
    )
  ),
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

create index if not exists idx_company_explorer_folders_scope
  on company_explorer_folders(company_id, scope_type, scope_id);

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
  constraint company_explorer_folder_items_type_chk check (item_type in ('node', 'logic_gate', 'project')),
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

create table if not exists recycle_bin_items (
  company_id uuid not null,
  recycle_bin_item_id uuid not null,
  object_kind text not null,
  object_id text not null,
  object_label text not null,
  object_folder_kind text,
  restore_payload jsonb not null,
  deleted_by_user_id uuid,
  deleted_timestamp timestamptz not null default now(),
  constraint recycle_bin_items_kind_chk check (object_kind in ('folder', 'node', 'logic_gate', 'project', 'kanban')),
  constraint recycle_bin_items_object_id_nonblank_chk check (btrim(object_id) <> ''),
  constraint recycle_bin_items_object_label_nonblank_chk check (btrim(object_label) <> ''),
  constraint recycle_bin_items_folder_kind_chk check (
    object_folder_kind is null
    or object_folder_kind in ('node', 'logic_gate', 'project', 'communications')
  ),
  primary key (company_id, recycle_bin_item_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (deleted_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_recycle_bin_items_company_deleted
  on recycle_bin_items(company_id, deleted_timestamp desc, recycle_bin_item_id desc);

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

create table if not exists event_rows (
  event_id uuid not null,
  company_id uuid not null,
  event_type text not null,
  resource_type text not null default '',
  resource_id text not null default '',
  primary_scope text not null default '',
  affected_scopes jsonb not null default '[]'::jsonb,
  actor_user_id uuid,
  idempotency_key text not null default '',
  sequence_scope text not null,
  sequence bigint not null,
  payload jsonb not null default '{}'::jsonb,
  created_timestamp timestamptz not null default now(),
  available_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  attempt_count integer not null default 0,
  last_error text not null default '',
  constraint event_rows_event_type_nonblank_chk check (btrim(event_type) <> ''),
  constraint event_rows_sequence_scope_nonblank_chk check (btrim(sequence_scope) <> ''),
  constraint event_rows_sequence_positive_chk check (sequence > 0),
  constraint event_rows_attempt_count_nonnegative_chk check (attempt_count >= 0),
  constraint event_rows_affected_scopes_array_chk check (jsonb_typeof(affected_scopes) = 'array'),
  constraint event_rows_payload_object_chk check (jsonb_typeof(payload) = 'object'),
  primary key (company_id, event_id),
  unique (company_id, sequence_scope, sequence),
  foreign key (actor_user_id) references users (user_id) on delete set null
);

create unique index if not exists idx_event_rows_idempotency_key
  on event_rows(company_id, idempotency_key)
  where btrim(idempotency_key) <> '';

create index if not exists idx_event_rows_available_unprocessed
  on event_rows(available_at, created_timestamp, company_id, event_id)
  where processed_at is null and processing_started_at is null;

create index if not exists idx_event_rows_processing_started
  on event_rows(processing_started_at)
  where processed_at is null and processing_started_at is not null;

create index if not exists idx_event_rows_scope_sequence
  on event_rows(company_id, sequence_scope, sequence);
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
    ('workspace-snapshot:company_explorer', 'folder_kind:project'),
    ('workspace-snapshot:company_explorer', 'folder_kind:communications'),
    ('company-explorer-folder-items', ''),
    ('company-explorer-folder-items', 'item_type:node'),
    ('company-explorer-folder-items', 'item_type:logic_gate'),
    ('company-explorer-folder-items', 'item_type:project'),
    ('nodes', ''),
    ('projects', ''),
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

  if p_event_type = any(array[
    'project_created',
    'project_updated',
    'project_deleted',
    'project_information_created',
    'project_information_deleted',
    'project_relationship_upserted',
    'project_relationship_deleted',
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
    'company_explorer_folder_permissions_updated',
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
