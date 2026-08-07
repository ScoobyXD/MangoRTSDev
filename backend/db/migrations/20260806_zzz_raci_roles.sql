-- Rename the active GVIC role contract to RACI and allow groups in every role.
begin;

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'raci_roles_unsupported_postgresql_version:%', current_setting('server_version');
  end if;
end;
$$;

lock table resource_gvic_assignments in access exclusive mode;
lock table notifications in access exclusive mode;
lock table recycle_bin_items in access exclusive mode;

alter table resource_gvic_assignments
  drop constraint if exists resource_gvic_assignments_v2_staging_role_chk,
  drop constraint if exists resource_gvic_assignments_v2_staging_user_only_role_chk,
  drop constraint if exists resource_gvic_assignments_role_chk,
  drop constraint if exists resource_gvic_assignments_rcvi_role_chk,
  drop constraint if exists resource_gvic_assignments_raci_role_chk;
drop index if exists idx_resource_gvic_assignments_v2_one_generated;

update resource_gvic_assignments
set role = case role
  when 'generated' then 'responsible'
  when 'verified' then 'accountable'
  when 'verifier' then 'accountable'
  else role
end
where role in ('generated', 'verified', 'verifier');

alter table resource_gvic_assignments
  add constraint resource_gvic_assignments_raci_role_chk
    check (role in ('responsible', 'accountable', 'consulted', 'informed'));

alter table notifications drop constraint if exists notifications_surface_chk;
update notifications set surface='aci_inbox' where surface='cvi_inbox';
update notifications
set event_type = case event_type
  when 'cvi_inbox.changed' then 'aci_inbox.changed'
  when 'cvi_inbox.RCVI_updated' then 'aci_inbox.RACI_updated'
  else event_type
end
where event_type in ('cvi_inbox.changed', 'cvi_inbox.RCVI_updated');
alter table notifications
  add constraint notifications_surface_chk
    check (surface = '' or surface in ('r_inbox', 'aci_inbox', 'my_triage', 'shared_triage'));

alter table notifications drop constraint if exists notifications_role_chk;
update notifications
set role = case role
  when 'generated' then 'responsible'
  when 'verified' then 'accountable'
  when 'verifier' then 'accountable'
  else role
end
where role in ('generated', 'verified', 'verifier');
alter table notifications
  add constraint notifications_role_chk
    check (role = '' or role in ('responsible', 'accountable', 'consulted', 'informed', 'other'));

update recycle_bin_items item
set restore_payload = jsonb_set(
  item.restore_payload,
  '{resource_gvic_assignments}',
  coalesce((
    select jsonb_agg(
      case assignment->>'role'
        when 'generated' then jsonb_set(assignment, '{role}', '"responsible"'::jsonb)
        when 'verified' then jsonb_set(assignment, '{role}', '"accountable"'::jsonb)
        when 'verifier' then jsonb_set(assignment, '{role}', '"accountable"'::jsonb)
        else assignment
      end
    )
    from jsonb_array_elements(item.restore_payload->'resource_gvic_assignments') assignment
  ), '[]'::jsonb)
)
where jsonb_typeof(item.restore_payload->'resource_gvic_assignments') = 'array';

create or replace function mangorts_v2_effective_gvic_assignments(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  role text,
  user_id uuid,
  source_resource_type text,
  source_resource_id uuid,
  source_principal_type text,
  source_principal_id uuid,
  inheritance_type text,
  updated_timestamp timestamptz
)
language sql
stable
set search_path=public,pg_temp
as $$
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

commit;
