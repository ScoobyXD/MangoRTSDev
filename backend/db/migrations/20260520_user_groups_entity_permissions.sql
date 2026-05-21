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

create or replace function mangorts_user_can_view_entity(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_user_id uuid
)
returns boolean as $$
  with recursive permitted_group_scope(group_id) as (
    select permission.subject_id
    from entity_access_permissions permission
    where permission.company_id = p_company_id
      and permission.entity_type = p_entity_type
      and permission.entity_id = p_entity_id
      and permission.permission = 'view'
      and permission.subject_type = 'group'
    union all
    select child.group_id
    from company_user_groups child
    join permitted_group_scope parent
      on parent.group_id = child.parent_group_id
    where child.company_id = p_company_id
  )
  select
    not exists (
      select 1
      from entity_access_permissions permission
      where permission.company_id = p_company_id
        and permission.entity_type = p_entity_type
        and permission.entity_id = p_entity_id
        and permission.permission = 'view'
    )
    or exists (
      select 1
      from entity_access_permissions permission
      where permission.company_id = p_company_id
        and permission.entity_type = p_entity_type
        and permission.entity_id = p_entity_id
        and permission.permission = 'view'
        and permission.subject_type = 'user'
        and permission.subject_id = p_user_id
    )
    or exists (
      select 1
      from company_user_group_members member
      join permitted_group_scope scope
        on scope.group_id = member.group_id
      where member.company_id = p_company_id
        and member.user_id = p_user_id
    );
$$ language sql stable;
