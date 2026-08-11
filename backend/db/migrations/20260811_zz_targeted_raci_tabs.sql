begin;

create or replace function mangorts_sync_raci_tabs_explorer_subtree(
  p_company_id uuid,
  p_folder_id uuid
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
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

create or replace function mangorts_sync_raci_tabs_policy_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if p_resource_type='logic_gate' then
    perform mangorts_sync_raci_tabs_logic_gate(p_company_id,p_resource_id);
  elsif p_resource_type='company_explorer_folder' then
    perform mangorts_sync_raci_tabs_explorer_subtree(p_company_id,p_resource_id);
  end if;
end;
$$;

create or replace function mangorts_sync_raci_tabs_group_ancestors(
  p_company_id uuid,
  p_group_ids uuid[]
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
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

create or replace function mangorts_raci_tabs_policy_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
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

create or replace function mangorts_raci_tabs_explorer_folder_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.parent_folder_id is distinct from new.parent_folder_id then
    perform mangorts_sync_raci_tabs_explorer_subtree(new.company_id,new.folder_id);
  end if;
  return null;
end;
$$;

create or replace function mangorts_raci_tabs_group_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
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

create or replace function mangorts_raci_tabs_group_member_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
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

create or replace function mangorts_raci_tabs_membership_added()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
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

drop trigger if exists trg_zz_raci_tabs_explorer_folder_changed on company_explorer_folders;
create trigger trg_zz_raci_tabs_explorer_folder_changed
after update of parent_folder_id on company_explorer_folders
for each row
when (old.parent_folder_id is distinct from new.parent_folder_id)
execute function mangorts_raci_tabs_explorer_folder_changed();

drop trigger if exists trg_zz_raci_tabs_group_changed on company_user_groups;
create trigger trg_zz_raci_tabs_group_changed
after update of parent_group_id or delete on company_user_groups
for each row execute function mangorts_raci_tabs_group_changed();

drop trigger if exists trg_zz_raci_tabs_group_member_changed on company_user_group_members;
create trigger trg_zz_raci_tabs_group_member_changed
after insert or update or delete on company_user_group_members
for each row execute function mangorts_raci_tabs_group_member_changed();

drop trigger if exists trg_zz_raci_tabs_membership_changed on company_memberships;
create trigger trg_zz_raci_tabs_membership_changed
after insert on company_memberships
for each row execute function mangorts_raci_tabs_membership_added();

drop function if exists mangorts_raci_tabs_company_changed();
drop function if exists mangorts_sync_raci_tabs_company(uuid);

commit;
