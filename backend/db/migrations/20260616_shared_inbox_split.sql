create table if not exists shared_inbox_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  default_access text not null default 'edit',
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint shared_inbox_folders_default_access_chk check (default_access in ('edit', 'no_access')),
  constraint shared_inbox_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint shared_inbox_folders_parent_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id),
  primary key (company_id, folder_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, parent_folder_id) references shared_inbox_folders (company_id, folder_id) on delete cascade
);

create index if not exists idx_shared_inbox_folders_parent
  on shared_inbox_folders(company_id, parent_folder_id, position, created_timestamp);

create table if not exists shared_inboxes (
  company_id uuid not null,
  shared_inbox_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  account_email text not null,
  default_access text not null default 'edit',
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint shared_inboxes_default_access_chk check (default_access in ('edit', 'no_access')),
  constraint shared_inboxes_name_nonblank_chk check (btrim(name) <> ''),
  constraint shared_inboxes_account_email_chk check (btrim(account_email) <> '' and account_email = lower(btrim(account_email))),
  primary key (company_id, shared_inbox_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, parent_folder_id) references shared_inbox_folders (company_id, folder_id)
);

create index if not exists idx_shared_inboxes_parent
  on shared_inboxes(company_id, parent_folder_id, position, created_timestamp);

create index if not exists idx_shared_inboxes_account_email
  on shared_inboxes(company_id, account_email);

insert into shared_inbox_folders (
  company_id,
  folder_id,
  parent_folder_id,
  name,
  default_access,
  position,
  created_timestamp,
  updated_timestamp
)
select
  folder.company_id,
  folder.folder_id,
  parent.folder_id,
  folder.name,
  coalesce(nullif(folder.default_access, ''), 'edit'),
  folder.position,
  folder.created_timestamp,
  folder.updated_timestamp
from communications_shared_inbox_folders folder
left join communications_shared_inbox_folders parent
  on parent.company_id=folder.company_id
 and parent.folder_id=folder.parent_folder_id
 and coalesce(parent.entry_type, 'folder')='folder'
where coalesce(folder.entry_type, 'folder')='folder'
   or folder.account_email is null
on conflict (company_id, folder_id) do update set
  parent_folder_id=excluded.parent_folder_id,
  name=excluded.name,
  default_access=excluded.default_access,
  position=excluded.position,
  updated_timestamp=excluded.updated_timestamp;

insert into shared_inboxes (
  company_id,
  shared_inbox_id,
  parent_folder_id,
  name,
  account_email,
  default_access,
  position,
  created_timestamp,
  updated_timestamp
)
select
  folder.company_id,
  folder.folder_id,
  parent.folder_id,
  folder.name,
  lower(btrim(folder.account_email)),
  coalesce(nullif(folder.default_access, ''), 'edit'),
  folder.position,
  folder.created_timestamp,
  folder.updated_timestamp
from communications_shared_inbox_folders folder
left join shared_inbox_folders parent
  on parent.company_id=folder.company_id
 and parent.folder_id=folder.parent_folder_id
where coalesce(folder.entry_type, 'folder')='shared_inbox'
  and folder.account_email is not null
  and btrim(folder.account_email) <> ''
on conflict (company_id, shared_inbox_id) do update set
  parent_folder_id=excluded.parent_folder_id,
  name=excluded.name,
  account_email=excluded.account_email,
  default_access=excluded.default_access,
  position=excluded.position,
  updated_timestamp=excluded.updated_timestamp;

create table if not exists shared_inbox_raci_assignments (
  company_id uuid not null,
  shared_inbox_id uuid not null,
  role text not null,
  user_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint shared_inbox_raci_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  primary key (company_id, shared_inbox_id, role, user_id),
  foreign key (company_id, shared_inbox_id) references shared_inboxes (company_id, shared_inbox_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships (company_id, user_id) on delete cascade
);

create index if not exists idx_shared_inbox_raci_user_role_inbox
  on shared_inbox_raci_assignments(company_id, user_id, role, shared_inbox_id);

create index if not exists idx_shared_inbox_raci_inbox_role_user
  on shared_inbox_raci_assignments(company_id, shared_inbox_id, role, user_id);

create table if not exists shared_inbox_raci_group_assignments (
  company_id uuid not null,
  shared_inbox_id uuid not null,
  role text not null,
  group_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint shared_inbox_raci_group_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  primary key (company_id, shared_inbox_id, role, group_id),
  foreign key (company_id, shared_inbox_id) references shared_inboxes (company_id, shared_inbox_id) on delete cascade,
  foreign key (company_id, group_id) references company_user_groups (company_id, group_id) on delete cascade
);

create index if not exists idx_shared_inbox_raci_group_role_inbox
  on shared_inbox_raci_group_assignments(company_id, group_id, role, shared_inbox_id);

create index if not exists idx_shared_inbox_raci_inbox_role_group
  on shared_inbox_raci_group_assignments(company_id, shared_inbox_id, role, group_id);

insert into shared_inbox_raci_assignments (
  company_id,
  shared_inbox_id,
  role,
  user_id,
  created_timestamp
)
select
  assignment.company_id,
  assignment.folder_id,
  assignment.role,
  assignment.user_id,
  assignment.created_timestamp
from communications_shared_inbox_raci_assignments assignment
join shared_inboxes inbox
  on inbox.company_id=assignment.company_id
 and inbox.shared_inbox_id=assignment.folder_id
on conflict (company_id, shared_inbox_id, role, user_id) do nothing;

insert into shared_inbox_raci_group_assignments (
  company_id,
  shared_inbox_id,
  role,
  group_id,
  created_timestamp
)
select
  assignment.company_id,
  assignment.folder_id,
  assignment.role,
  assignment.group_id,
  assignment.created_timestamp
from communications_shared_inbox_raci_group_assignments assignment
join shared_inboxes inbox
  on inbox.company_id=assignment.company_id
 and inbox.shared_inbox_id=assignment.folder_id
on conflict (company_id, shared_inbox_id, role, group_id) do nothing;

insert into resource_permissions (
  company_id,
  resource_type,
  resource_id,
  user_id,
  created_timestamp,
  updated_timestamp
)
select
  permission.company_id,
  'shared_inbox_folder',
  permission.resource_id,
  permission.user_id,
  permission.created_timestamp,
  permission.updated_timestamp
from resource_permissions permission
join shared_inbox_folders folder
  on folder.company_id=permission.company_id
 and folder.folder_id=permission.resource_id
where permission.resource_type='shared_triage_folder'
on conflict (company_id, resource_type, resource_id, user_id) do nothing;

insert into resource_permissions (
  company_id,
  resource_type,
  resource_id,
  user_id,
  created_timestamp,
  updated_timestamp
)
select
  permission.company_id,
  'shared_inbox',
  permission.resource_id,
  permission.user_id,
  permission.created_timestamp,
  permission.updated_timestamp
from resource_permissions permission
join shared_inboxes inbox
  on inbox.company_id=permission.company_id
 and inbox.shared_inbox_id=permission.resource_id
where permission.resource_type='shared_triage_folder'
on conflict (company_id, resource_type, resource_id, user_id) do nothing;

insert into resource_access_grants (
  company_id,
  resource_type,
  resource_id,
  principal_type,
  principal_id,
  access_level,
  created_timestamp
)
select
  grant_row.company_id,
  'shared_inbox_folder',
  grant_row.resource_id,
  grant_row.principal_type,
  grant_row.principal_id,
  grant_row.access_level,
  grant_row.created_timestamp
from resource_access_grants grant_row
join shared_inbox_folders folder
  on folder.company_id=grant_row.company_id
 and folder.folder_id=grant_row.resource_id
where grant_row.resource_type='shared_triage_folder'
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do nothing;

insert into resource_access_grants (
  company_id,
  resource_type,
  resource_id,
  principal_type,
  principal_id,
  access_level,
  created_timestamp
)
select
  grant_row.company_id,
  'shared_inbox',
  grant_row.resource_id,
  grant_row.principal_type,
  grant_row.principal_id,
  grant_row.access_level,
  grant_row.created_timestamp
from resource_access_grants grant_row
join shared_inboxes inbox
  on inbox.company_id=grant_row.company_id
 and inbox.shared_inbox_id=grant_row.resource_id
where grant_row.resource_type='shared_triage_folder'
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do nothing;

insert into resource_raci_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  subject_type,
  subject_id,
  created_timestamp
)
select
  assignment.company_id,
  'shared_inbox',
  assignment.resource_id,
  assignment.role,
  assignment.subject_type,
  assignment.subject_id,
  assignment.created_timestamp
from resource_raci_assignments assignment
join shared_inboxes inbox
  on inbox.company_id=assignment.company_id
 and inbox.shared_inbox_id=assignment.resource_id
where assignment.resource_type='shared_triage_folder'
on conflict (company_id, resource_type, resource_id, role, subject_type, subject_id) do nothing;

delete from resource_permissions
where resource_type='shared_triage_folder';

delete from resource_access_grants
where resource_type='shared_triage_folder';

delete from resource_raci_assignments
where resource_type='shared_triage_folder';

alter table resource_raci_assignments
  drop constraint if exists resource_raci_assignments_resource_type_chk;

alter table resource_raci_assignments
  add constraint resource_raci_assignments_resource_type_chk
  check (resource_type in ('node', 'logic_gate', 'project', 'shared_inbox'));

alter table resource_access_grants
  drop constraint if exists resource_access_grants_resource_type_chk;

alter table resource_access_grants
  add constraint resource_access_grants_resource_type_chk
  check (resource_type in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox'));

alter table resource_permissions
  drop constraint if exists resource_permissions_resource_type_chk;

alter table resource_permissions
  add constraint resource_permissions_resource_type_chk
  check (resource_type in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox'));

create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean as $$
  with normalized_resource(resource_type) as (
    select case lower(btrim(coalesce(p_resource_type, '')))
      when 'shared_triage_folder' then 'shared_inbox_folder'
      when 'communications_folder' then 'shared_inbox_folder'
      else lower(btrim(coalesce(p_resource_type, '')))
    end
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
    union all
    select coalesce(folder.default_access, 'edit')
    from shared_inbox_folders folder, normalized_resource normalized
    where normalized.resource_type='shared_inbox_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
    union all
    select coalesce(inbox.default_access, 'edit')
    from shared_inboxes inbox, normalized_resource normalized
    where normalized.resource_type='shared_inbox'
      and inbox.company_id=p_company_id
      and inbox.shared_inbox_id=p_resource_id
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
  )
  select case
    when requested.required_rank = 0 then false
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false
    when (select allowed from role_admin_actor) then true
    when exists (
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
    else false
  end
  from requested, normalized_resource;
$$ language sql stable;

drop table if exists communications_shared_inbox_raci_group_assignments;
drop table if exists communications_shared_inbox_raci_assignments;
drop table if exists communications_shared_inbox_folders;
