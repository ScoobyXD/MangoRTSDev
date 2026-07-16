update resource_permissions
set access_level = 'edit',
    updated_timestamp = now()
where access_level in ('view', 'admin');

alter table resource_permissions
  drop constraint if exists resource_permissions_access_level_chk;

alter table resource_permissions
  add constraint resource_permissions_access_level_chk
  check (access_level in ('no_access', 'edit'));

update resource_permission_subtree_applications
set access_level = 'edit'
where access_level in ('view', 'admin');

alter table resource_permission_subtree_applications
  drop constraint if exists resource_permission_subtree_applications_rule_shape_chk;

alter table resource_permission_subtree_applications
  drop constraint if exists resource_permission_subtree_applications_access_level_chk;

alter table resource_permission_subtree_applications
  add constraint resource_permission_subtree_applications_access_level_chk
  check (access_level is null or access_level in ('no_access', 'edit'));

alter table resource_permission_subtree_applications
  add constraint resource_permission_subtree_applications_rule_shape_chk check (
    (
      rule_key = '__default__'
      and subject_type is null
      and subject_id is null
      and access_level in ('edit', 'no_access')
      and not deleted
    )
    or (
      rule_key <> '__default__'
      and subject_type in ('user', 'group')
      and subject_id is not null
      and (deleted or access_level in ('no_access', 'edit'))
    )
  );

create or replace function mangorts_access_level_rank(p_access_level text)
returns integer as $$
  select case lower(btrim(coalesce(p_access_level, '')))
    when 'no_access' then 0
    when 'edit' then 1
    else 0
  end;
$$ language sql immutable;

drop function if exists mangorts_user_can_view_entity(uuid, text, uuid, uuid);
