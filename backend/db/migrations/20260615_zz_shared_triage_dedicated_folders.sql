create table if not exists communications_shared_inbox_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  entry_type text not null default 'folder',
  name text not null,
  default_access text not null default 'edit',
  account_email text,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint communications_shared_inbox_folders_entry_type_chk check (entry_type in ('folder', 'shared_inbox')),
  constraint communications_shared_inbox_folders_default_access_chk check (default_access in ('edit', 'no_access')),
  constraint communications_shared_inbox_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint communications_shared_inbox_folders_parent_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id),
  constraint communications_shared_inbox_folders_account_email_chk check (
    account_email is null or (
      entry_type = 'shared_inbox'
      and btrim(account_email) <> ''
      and account_email = lower(btrim(account_email))
    )
  ),
  primary key (company_id, folder_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (company_id, parent_folder_id) references communications_shared_inbox_folders (company_id, folder_id) on delete cascade
);

create index if not exists idx_communications_shared_inbox_folders_parent
  on communications_shared_inbox_folders(company_id, parent_folder_id, position, created_timestamp);

create index if not exists idx_communications_shared_inbox_folders_account_email
  on communications_shared_inbox_folders(company_id, account_email)
  where account_email is not null;

insert into communications_shared_inbox_folders (
  company_id,
  folder_id,
  parent_folder_id,
  entry_type,
  name,
  default_access,
  account_email,
  position,
  created_timestamp,
  updated_timestamp
)
select folder.company_id,
       folder.folder_id,
       case
         when parent.folder_id is not null then folder.parent_folder_id
         else null
       end as parent_folder_id,
       case
         when nullif(lower(btrim(coalesce(folder.account_email, ''))), '') is not null then 'shared_inbox'
         else 'folder'
       end as entry_type,
       folder.name,
       coalesce(folder.default_access, 'edit') as default_access,
       nullif(lower(btrim(coalesce(folder.account_email, ''))), '') as account_email,
       coalesce(folder.position, 0) as position,
       folder.created_timestamp,
       folder.updated_timestamp
from company_explorer_folders folder
left join company_explorer_folders parent
  on parent.company_id=folder.company_id
 and parent.folder_id=folder.parent_folder_id
 and parent.folder_kind='communications'
where folder.folder_kind='communications'
on conflict (company_id, folder_id) do update set
  parent_folder_id=excluded.parent_folder_id,
  entry_type=excluded.entry_type,
  name=excluded.name,
  default_access=excluded.default_access,
  account_email=excluded.account_email,
  position=excluded.position,
  created_timestamp=excluded.created_timestamp,
  updated_timestamp=excluded.updated_timestamp;

alter table communications_shared_inbox_raci_assignments
  drop constraint if exists communications_shared_inbox_raci_assignments_company_id_folder_id_fkey;

alter table communications_shared_inbox_raci_assignments
  add constraint communications_shared_inbox_raci_assignments_company_id_folder_id_fkey
  foreign key (company_id, folder_id) references communications_shared_inbox_folders (company_id, folder_id) on delete cascade;

alter table communications_shared_inbox_raci_group_assignments
  drop constraint if exists communications_shared_inbox_raci_group_assignments_company_id_folder_id_fkey;

alter table communications_shared_inbox_raci_group_assignments
  add constraint communications_shared_inbox_raci_group_assignments_company_id_folder_id_fkey
  foreign key (company_id, folder_id) references communications_shared_inbox_folders (company_id, folder_id) on delete cascade;

alter table resource_permissions
  drop constraint if exists resource_permissions_resource_type_chk;

alter table resource_permissions
  add constraint resource_permissions_resource_type_chk
  check (resource_type in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_triage_folder'));

with recursive group_grants as (
  select grant_row.company_id,
         grant_row.resource_type,
         grant_row.resource_id,
         grant_row.principal_id as group_id,
         grant_row.access_level,
         array[grant_row.principal_id] as path
  from resource_access_grants grant_row
  where grant_row.resource_type='shared_triage_folder'
    and grant_row.principal_type='group'
  union all
  select parent.company_id,
         parent.resource_type,
         parent.resource_id,
         child.group_id,
         parent.access_level,
         parent.path || child.group_id
  from group_grants parent
  join company_user_groups child
    on child.company_id=parent.company_id
   and child.parent_group_id=parent.group_id
  where not child.group_id = any(parent.path)
),
expanded_old_grants as (
  select grant_row.company_id,
         grant_row.resource_type,
         grant_row.resource_id,
         grant_row.principal_id as user_id,
         grant_row.access_level
  from resource_access_grants grant_row
  where grant_row.resource_type='shared_triage_folder'
    and grant_row.principal_type='user'
  union all
  select group_grants.company_id,
         group_grants.resource_type,
         group_grants.resource_id,
         member.user_id,
         group_grants.access_level
  from group_grants
  join company_user_group_members member
    on member.company_id=group_grants.company_id
   and member.group_id=group_grants.group_id
),
normalized_old_grants as (
  select distinct expanded.company_id,
         expanded.resource_type,
         expanded.resource_id,
         expanded.user_id
  from expanded_old_grants expanded
  join communications_shared_inbox_folders folder
    on folder.company_id=expanded.company_id
   and folder.folder_id=expanded.resource_id
  join company_memberships membership
    on membership.company_id=expanded.company_id
   and membership.user_id=expanded.user_id
  where not (membership.role in ('dev_admin', 'company_admin'))
    and (
      (folder.default_access='edit' and expanded.access_level='no_access')
      or (folder.default_access='no_access' and expanded.access_level in ('view', 'edit', 'admin'))
    )
)
insert into resource_permissions (
  company_id,
  resource_type,
  resource_id,
  user_id,
  created_timestamp,
  updated_timestamp
)
select company_id,
       resource_type,
       resource_id,
       user_id,
       now(),
       now()
from normalized_old_grants
on conflict (company_id, resource_type, resource_id, user_id) do nothing;

delete from resource_access_grants
where resource_type='shared_triage_folder';

delete from company_explorer_folders
where folder_kind='communications';

delete from workspace_read_versions
where scope='workspace-snapshot:company_explorer'
  and resource_key='folder_kind:communications';

insert into workspace_read_versions(company_id, scope, resource_key, version, updated_timestamp)
select company_id, 'workspace-snapshot:shared_triage', '', 0, now()
from companies
on conflict (company_id, scope, resource_key) do nothing;

drop index if exists idx_company_explorer_folders_account_email;

alter table company_explorer_folders
  drop constraint if exists company_explorer_folders_account_email_chk;

alter table company_explorer_folders
  drop column if exists account_email;

alter table company_explorer_folders
  drop constraint if exists company_explorer_folders_kind_chk;

alter table company_explorer_folders
  add constraint company_explorer_folders_kind_chk
  check (folder_kind in ('node', 'logic_gate', 'project'));

update recycle_bin_items
set object_folder_kind=null
where object_folder_kind='communications';

alter table recycle_bin_items
  drop constraint if exists recycle_bin_items_folder_kind_chk;

alter table recycle_bin_items
  add constraint recycle_bin_items_folder_kind_chk
  check (
    object_folder_kind is null
    or object_folder_kind in ('node', 'logic_gate', 'project')
  );

create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean as $$
  with normalized_resource(resource_type) as (
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
    union all
    select coalesce(folder.default_access, 'edit')
    from communications_shared_inbox_folders folder, normalized_resource normalized
    where normalized.resource_type='shared_triage_folder'
      and folder.company_id=p_company_id
      and folder.folder_id=p_resource_id
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
    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_triage_folder') then false
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
