-- V2 GVIC and permissions Step 2: atomic graph cutover and runtime contract.
-- Run only after the final Step 1 preflight and delta copy both return READY.
begin;


do $$
declare
  spec record;
  actual_count integer;
  missing_count integer;
  extra_count integer;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'v2_policy_step2_unsupported_postgresql_version:%', current_setting('server_version');
  end if;

  for spec in
    select key as table_name, value as expected_columns
    from jsonb_each($shape$
      {
        "resource_gvic_assignments":["company_id","resource_type","resource_id","role","principal_type","principal_id","created_timestamp","updated_timestamp"],
        "resource_permissions":["company_id","resource_type","resource_id","subject_type","subject_id","user_id","access_level","created_timestamp","updated_timestamp"],
        "resource_gvic_settings":["company_id","resource_type","resource_id","assignment_mode","customized_sequence","parent_link_sequence","descendant_reset_sequence","created_timestamp","updated_timestamp"],
        "resource_permission_settings":["company_id","resource_type","resource_id","permission_mode","default_access","customized_sequence","parent_link_sequence","descendant_reset_sequence","created_timestamp","updated_timestamp"],
        "resource_gvic_assignments_v2_staging":["company_id","resource_type","resource_id","role","principal_type","principal_id","created_timestamp","updated_timestamp"],
        "resource_permissions_v2_staging":["company_id","resource_type","resource_id","subject_type","subject_id","access_level","created_timestamp","updated_timestamp"]
      }
    $shape$::jsonb)
  loop
    if to_regclass('public.' || spec.table_name) is null then
      raise exception 'v2_policy_step2_missing_cutover_table:%', spec.table_name;
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
      raise exception 'v2_policy_step2_schema_drift:%:expected=%:actual=%:missing=%:extra=%',
        spec.table_name, jsonb_array_length(spec.expected_columns), actual_count, missing_count, extra_count;
    end if;
  end loop;

  if exists (
    select 1 from mangorts_v2_step1_preflight_report()
    where section='FINAL' and status<>'READY'
  ) then
    raise exception 'v2_policy_step2_step1_preflight_stop';
  end if;
end;
$$;

lock table resource_gvic_assignments in access exclusive mode;
lock table resource_permissions in access exclusive mode;
lock table resource_gvic_assignments_v2_staging in access exclusive mode;
lock table resource_permissions_v2_staging in access exclusive mode;
lock table resource_gvic_settings in access exclusive mode;
lock table resource_permission_settings in access exclusive mode;

alter table resource_gvic_assignments rename to resource_gvic_assignments_step2_legacy;
alter table resource_permissions rename to resource_permissions_step2_legacy;
alter table resource_gvic_assignments_v2_staging rename to resource_gvic_assignments;
alter table resource_permissions_v2_staging rename to resource_permissions;

alter trigger trg_resource_gvic_assignments_v2_validate on resource_gvic_assignments
  rename to trg_resource_gvic_assignments_validate;
alter trigger trg_resource_permissions_v2_validate on resource_permissions
  rename to trg_resource_permissions_validate;

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
  if tg_table_name='resource_gvic_assignments' then
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

create or replace function mangorts_v2_resolve_gvic_policy(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  source_resource_type text,
  source_resource_id uuid,
  source_customized_sequence bigint,
  reset_resource_type text,
  reset_resource_id uuid,
  reset_sequence bigint,
  overwritten_resource_type text,
  overwritten_resource_id uuid,
  overwritten_sequence bigint,
  parent_link_fingerprint text
)
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive path as (
    select 0 as depth,
           setting.resource_type,
           setting.resource_id,
           setting.assignment_mode as stored_mode,
           setting.customized_sequence,
           setting.parent_link_sequence,
           setting.descendant_reset_sequence,
           array[setting.resource_type || ':' || setting.resource_id::text]::text[] as visited
    from resource_gvic_settings setting
    where setting.company_id=p_company_id
      and setting.resource_type=p_resource_type
      and setting.resource_id=p_resource_id
    union all
    select child.depth+1,
           parent_setting.resource_type,
           parent_setting.resource_id,
           parent_setting.assignment_mode,
           parent_setting.customized_sequence,
           parent_setting.parent_link_sequence,
           parent_setting.descendant_reset_sequence,
           child.visited || (parent_setting.resource_type || ':' || parent_setting.resource_id::text)
    from path child
    cross join lateral mangorts_v2_policy_parent(p_company_id,child.resource_type,child.resource_id) parent
    join resource_gvic_settings parent_setting
      on parent_setting.company_id=p_company_id
     and parent_setting.resource_type=parent.parent_resource_type
     and parent_setting.resource_id=parent.parent_resource_id
    where not (parent_setting.resource_type || ':' || parent_setting.resource_id::text)=any(child.visited)
  ),
  eligible_resets as (
    select ancestor.*
    from path ancestor
    where ancestor.depth>0
      and ancestor.descendant_reset_sequence>0
      and not exists (
        select 1 from path edge
        where edge.depth<ancestor.depth
          and edge.parent_link_sequence>ancestor.descendant_reset_sequence
      )
  ),
  active_sources as (
    select candidate.*
    from path candidate
    where candidate.stored_mode='customized'
      and not exists (
        select 1 from eligible_resets reset
        where reset.depth>candidate.depth
          and reset.descendant_reset_sequence>=candidate.customized_sequence
      )
  ),
  selected_source as (
    select * from active_sources order by depth limit 1
  ),
  selected_reset as (
    select * from eligible_resets order by descendant_reset_sequence desc,depth limit 1
  ),
  target as (
    select * from path where depth=0
  ),
  target_overwrite as (
    select reset.*
    from eligible_resets reset,target
    where target.stored_mode='customized'
      and reset.descendant_reset_sequence>=target.customized_sequence
    order by reset.descendant_reset_sequence desc,reset.depth
    limit 1
  )
  select source.resource_type,
         source.resource_id,
         source.customized_sequence,
         reset.resource_type,
         reset.resource_id,
         reset.descendant_reset_sequence,
         overwritten.resource_type,
         overwritten.resource_id,
         overwritten.descendant_reset_sequence,
         coalesce((
           select md5(string_agg(
             node.depth::text || ':' || node.resource_type || ':' || node.resource_id::text || ':' || node.parent_link_sequence::text,
             '|' order by node.depth
           ))
           from path node
         ),md5(''))
  from selected_source source
  left join selected_reset reset on true
  left join target_overwrite overwritten on true;
$$;

create or replace function mangorts_v2_resolve_permission_policy(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns table(
  source_resource_type text,
  source_resource_id uuid,
  source_customized_sequence bigint,
  reset_resource_type text,
  reset_resource_id uuid,
  reset_sequence bigint,
  overwritten_resource_type text,
  overwritten_resource_id uuid,
  overwritten_sequence bigint,
  parent_link_fingerprint text
)
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive path as (
    select 0 as depth,
           setting.resource_type,
           setting.resource_id,
           setting.permission_mode as stored_mode,
           setting.customized_sequence,
           setting.parent_link_sequence,
           setting.descendant_reset_sequence,
           array[setting.resource_type || ':' || setting.resource_id::text]::text[] as visited
    from resource_permission_settings setting
    where setting.company_id=p_company_id
      and setting.resource_type=p_resource_type
      and setting.resource_id=p_resource_id
    union all
    select child.depth+1,
           parent_setting.resource_type,
           parent_setting.resource_id,
           parent_setting.permission_mode,
           parent_setting.customized_sequence,
           parent_setting.parent_link_sequence,
           parent_setting.descendant_reset_sequence,
           child.visited || (parent_setting.resource_type || ':' || parent_setting.resource_id::text)
    from path child
    cross join lateral mangorts_v2_policy_parent(p_company_id,child.resource_type,child.resource_id) parent
    join resource_permission_settings parent_setting
      on parent_setting.company_id=p_company_id
     and parent_setting.resource_type=parent.parent_resource_type
     and parent_setting.resource_id=parent.parent_resource_id
    where not (parent_setting.resource_type || ':' || parent_setting.resource_id::text)=any(child.visited)
  ),
  eligible_resets as (
    select ancestor.*
    from path ancestor
    where ancestor.depth>0
      and ancestor.descendant_reset_sequence>0
      and not exists (
        select 1 from path edge
        where edge.depth<ancestor.depth
          and edge.parent_link_sequence>ancestor.descendant_reset_sequence
      )
  ),
  active_sources as (
    select candidate.*
    from path candidate
    where candidate.stored_mode='customized'
      and not exists (
        select 1 from eligible_resets reset
        where reset.depth>candidate.depth
          and reset.descendant_reset_sequence>=candidate.customized_sequence
      )
  ),
  selected_source as (
    select * from active_sources order by depth limit 1
  ),
  selected_reset as (
    select * from eligible_resets order by descendant_reset_sequence desc,depth limit 1
  ),
  target as (
    select * from path where depth=0
  ),
  target_overwrite as (
    select reset.*
    from eligible_resets reset,target
    where target.stored_mode='customized'
      and reset.descendant_reset_sequence>=target.customized_sequence
    order by reset.descendant_reset_sequence desc,reset.depth
    limit 1
  )
  select source.resource_type,
         source.resource_id,
         source.customized_sequence,
         reset.resource_type,
         reset.resource_id,
         reset.descendant_reset_sequence,
         overwritten.resource_type,
         overwritten.resource_id,
         overwritten.descendant_reset_sequence,
         coalesce((
           select md5(string_agg(
             node.depth::text || ':' || node.resource_type || ':' || node.resource_id::text || ':' || node.parent_link_sequence::text,
             '|' order by node.depth
           ))
           from path node
         ),md5(''))
  from selected_source source
  left join selected_reset reset on true
  left join target_overwrite overwritten on true;
$$;

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
      case candidate.role when 'generated' then 1 when 'verified' then 2 when 'consulted' then 3 else 4 end,
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

create or replace function mangorts_user_can_access_resource(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid,
  p_access_level text
)
returns boolean
language sql
stable
set search_path=public,pg_temp
as $$
  with recursive resolved as (
    select * from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id)
  ),
  admin_actor as (
    select exists (
      select 1 from company_memberships membership
      where membership.user_id=p_user_id
        and (
          membership.role='dev_admin'
          or (membership.company_id=p_company_id and membership.role='company_admin')
        )
    ) as allowed
  ),
  direct_rule as (
    select access.access_level
    from resolved
    join resource_permissions access
      on access.company_id=p_company_id
     and access.resource_type=resolved.source_resource_type
     and access.resource_id=resolved.source_resource_id
     and access.subject_type='user'
     and access.subject_id=p_user_id
    limit 1
  ),
  member_groups(group_id,depth,path) as (
    select member.group_id,0,array[member.group_id]
    from company_user_group_members member
    where member.company_id=p_company_id and member.user_id=p_user_id
    union all
    select parent.parent_group_id,member.depth+1,member.path || parent.parent_group_id
    from member_groups member
    join company_user_groups parent
      on parent.company_id=p_company_id and parent.group_id=member.group_id
    where parent.parent_group_id is not null
      and member.depth<100
      and not parent.parent_group_id=any(member.path)
  ),
  group_rule as (
    select access.access_level
    from resolved
    join resource_permissions access
      on access.company_id=p_company_id
     and access.resource_type=resolved.source_resource_type
     and access.resource_id=resolved.source_resource_id
     and access.subject_type='group'
    join member_groups membership on membership.group_id=access.subject_id
    order by membership.depth,
             case access.access_level when 'no_access' then 0 else 1 end,
             access.subject_id
    limit 1
  ),
  selected_access as (
    select coalesce(
      (select access_level from direct_rule),
      (select access_level from group_rule),
      (select setting.default_access
       from resolved
       join resource_permission_settings setting
         on setting.company_id=p_company_id
        and setting.resource_type=resolved.source_resource_type
        and setting.resource_id=resolved.source_resource_id)
    ) as access_level
  )
  select case
    when p_access_level<>'edit' then false
    when (select allowed from admin_actor) then true
    else coalesce((select access_level='edit' from selected_access),false)
  end;
$$;

create or replace function mangorts_v2_group_membership_version(p_company_id uuid)
returns bigint
language sql
stable
set search_path=public,pg_temp
as $$
  select coalesce((
    select version from workspace_read_versions
    where company_id=p_company_id and scope='policy-group-membership' and resource_key=''
  ),0);
$$;

create or replace function mangorts_v2_gvic_policy_fingerprint(
  p_company_id uuid,p_resource_type text,p_resource_id uuid
)
returns text
language sql
stable
set search_path=public,pg_temp
as $$
  select md5(concat_ws(':',
    resolved.source_resource_type,resolved.source_resource_id,resolved.source_customized_sequence,
    resolved.reset_resource_type,resolved.reset_resource_id,resolved.reset_sequence,
    resolved.parent_link_fingerprint,mangorts_v2_group_membership_version(p_company_id)
  ))
  from mangorts_v2_resolve_gvic_policy(p_company_id,p_resource_type,p_resource_id) resolved;
$$;

create or replace function mangorts_v2_permission_policy_fingerprint(
  p_company_id uuid,p_resource_type text,p_resource_id uuid,p_user_id uuid
)
returns text
language sql
stable
set search_path=public,pg_temp
as $$
  select md5(concat_ws(':',
    resolved.source_resource_type,resolved.source_resource_id,resolved.source_customized_sequence,
    resolved.reset_resource_type,resolved.reset_resource_id,resolved.reset_sequence,
    resolved.parent_link_fingerprint,mangorts_v2_group_membership_version(p_company_id),p_user_id,
    mangorts_user_can_access_resource(p_company_id,p_resource_type,p_resource_id,p_user_id,'edit')
  ))
  from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id) resolved;
$$;

create or replace function mangorts_v2_initialize_policy_settings()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_resource_type text := tg_argv[0];
  v_resource_id uuid := (to_jsonb(new)->>tg_argv[1])::uuid;
  v_company_id uuid := (to_jsonb(new)->>'company_id')::uuid;
  v_parent_type text;
  v_parent_id uuid;
  v_gvic_sequence bigint;
  v_permission_sequence bigint;
begin
  if exists (
    select 1 from resource_gvic_settings
    where resource_gvic_settings.company_id=v_company_id
      and resource_gvic_settings.resource_type=v_resource_type
      and resource_gvic_settings.resource_id=v_resource_id
  ) and exists (
    select 1 from resource_permission_settings
    where resource_permission_settings.company_id=v_company_id
      and resource_permission_settings.resource_type=v_resource_type
      and resource_permission_settings.resource_id=v_resource_id
  ) then
    return new;
  end if;

  select parent_resource_type,parent_resource_id into v_parent_type,v_parent_id
  from mangorts_v2_policy_parent(v_company_id,v_resource_type,v_resource_id);

  v_gvic_sequence := nextval('resource_gvic_change_sequence');
  v_permission_sequence := nextval('resource_permission_change_sequence');

  insert into resource_gvic_settings(
    company_id,resource_type,resource_id,assignment_mode,customized_sequence,
    parent_link_sequence,descendant_reset_sequence,created_timestamp,updated_timestamp
  ) values(
    v_company_id,v_resource_type,v_resource_id,
    case when v_parent_id is null then 'customized' else 'inherited' end,
    case when v_parent_id is null then v_gvic_sequence else null end,
    case when v_parent_id is null then 0 else v_gvic_sequence end,
    0,now(),now()
  ) on conflict(company_id,resource_type,resource_id) do nothing;

  insert into resource_permission_settings(
    company_id,resource_type,resource_id,permission_mode,default_access,customized_sequence,
    parent_link_sequence,descendant_reset_sequence,created_timestamp,updated_timestamp
  ) values(
    v_company_id,v_resource_type,v_resource_id,
    case when v_parent_id is null then 'customized' else 'inherited' end,
    case when v_parent_id is null then 'edit' else null end,
    case when v_parent_id is null then v_permission_sequence else null end,
    case when v_parent_id is null then 0 else v_permission_sequence end,
    0,now(),now()
  ) on conflict(company_id,resource_type,resource_id) do nothing;
  return new;
end;
$$;

create or replace function mangorts_v2_advance_parent_link(
  p_company_id uuid,p_resource_type text,p_resource_id uuid,p_is_root boolean
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
begin
  update resource_gvic_settings
  set parent_link_sequence=case when p_is_root then 0 else nextval('resource_gvic_change_sequence') end,
      updated_timestamp=now()
  where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;

  update resource_permission_settings
  set parent_link_sequence=case when p_is_root then 0 else nextval('resource_permission_change_sequence') end,
      updated_timestamp=now()
  where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
end;
$$;

create or replace function mangorts_v2_materialize_detached_policy(
  p_company_id uuid,p_resource_type text,p_resource_id uuid
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
declare
  gvic_source_type text;
  gvic_source_id uuid;
  permission_source_type text;
  permission_source_id uuid;
  permission_default text;
  gvic_sequence bigint;
  permission_sequence bigint;
begin
  select source_resource_type,source_resource_id into gvic_source_type,gvic_source_id
  from mangorts_v2_resolve_gvic_policy(p_company_id,p_resource_type,p_resource_id);
  select source_resource_type,source_resource_id into permission_source_type,permission_source_id
  from mangorts_v2_resolve_permission_policy(p_company_id,p_resource_type,p_resource_id);

  if gvic_source_id is null or permission_source_id is null then
    raise exception 'v2_policy_detach_resolution_failed:%:%',p_resource_type,p_resource_id;
  end if;

  if gvic_source_type<>p_resource_type or gvic_source_id<>p_resource_id then
    gvic_sequence := nextval('resource_gvic_change_sequence');
    delete from resource_gvic_assignments
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    update resource_gvic_settings
    set assignment_mode='customized',customized_sequence=gvic_sequence,updated_timestamp=now()
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    insert into resource_gvic_assignments(
      company_id,resource_type,resource_id,role,principal_type,principal_id,created_timestamp,updated_timestamp
    )
    select p_company_id,p_resource_type,p_resource_id,role,principal_type,principal_id,now(),now()
    from resource_gvic_assignments
    where company_id=p_company_id and resource_type=gvic_source_type and resource_id=gvic_source_id;
  end if;

  if permission_source_type<>p_resource_type or permission_source_id<>p_resource_id then
    select default_access into permission_default
    from resource_permission_settings
    where company_id=p_company_id and resource_type=permission_source_type and resource_id=permission_source_id;
    permission_sequence := nextval('resource_permission_change_sequence');
    delete from resource_permissions
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    update resource_permission_settings
    set permission_mode='customized',default_access=permission_default,
        customized_sequence=permission_sequence,updated_timestamp=now()
    where company_id=p_company_id and resource_type=p_resource_type and resource_id=p_resource_id;
    insert into resource_permissions(
      company_id,resource_type,resource_id,subject_type,subject_id,access_level,created_timestamp,updated_timestamp
    )
    select p_company_id,p_resource_type,p_resource_id,subject_type,subject_id,access_level,now(),now()
    from resource_permissions
    where company_id=p_company_id and resource_type=permission_source_type and resource_id=permission_source_id;
  end if;
end;
$$;

create or replace function mangorts_v2_resource_deleted_cleanup()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  resource_type text := tg_argv[0];
  resource_id uuid := (to_jsonb(old)->>tg_argv[1])::uuid;
  company_id uuid := (to_jsonb(old)->>'company_id')::uuid;
begin
  delete from resource_gvic_settings
  where resource_gvic_settings.company_id=company_id
    and resource_gvic_settings.resource_type=resource_type
    and resource_gvic_settings.resource_id=resource_id;
  delete from resource_permission_settings
  where resource_permission_settings.company_id=company_id
    and resource_permission_settings.resource_type=resource_type
    and resource_permission_settings.resource_id=resource_id;
  return old;
end;
$$;

create or replace function mangorts_v2_node_parent_link_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    perform mangorts_v2_materialize_detached_policy(old.company_id,'node',old.node_id);
    return old;
  end if;
  if tg_op='INSERT' then
    perform mangorts_v2_advance_parent_link(new.company_id,'node',new.node_id,false);
  elsif old.logic_gate_id is distinct from new.logic_gate_id then
    perform mangorts_v2_advance_parent_link(new.company_id,'node',new.node_id,false);
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_node_parent_link_removed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  perform mangorts_v2_advance_parent_link(old.company_id,'node',old.node_id,true);
  return old;
end;
$$;

create or replace function mangorts_v2_company_item_parent_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.target_type in ('logic_gate','project') then
    perform mangorts_v2_materialize_detached_policy(old.company_id,old.target_type,old.target_id);
  end if;
  return old;
end;
$$;

create or replace function mangorts_v2_company_item_parent_saved()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.target_type in ('logic_gate','project') and tg_op='INSERT' then
    perform mangorts_v2_advance_parent_link(new.company_id,new.target_type,new.target_id,false);
  elsif new.target_type in ('logic_gate','project')
     and old.parent_folder_id is distinct from new.parent_folder_id then
    perform mangorts_v2_advance_parent_link(new.company_id,new.target_type,new.target_id,false);
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_folder_parent_changing()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.parent_folder_id is not null and new.parent_folder_id is null then
    perform mangorts_v2_materialize_detached_policy(old.company_id,tg_argv[0],old.folder_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_folder_parent_saved()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='UPDATE' and old.parent_folder_id is not distinct from new.parent_folder_id then
    return new;
  end if;
  perform mangorts_v2_advance_parent_link(new.company_id,tg_argv[0],new.folder_id,new.parent_folder_id is null);
  return new;
end;
$$;

create or replace function mangorts_v2_shared_inbox_parent_changing()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if old.parent_folder_id is not null and new.parent_folder_id is null then
    perform mangorts_v2_materialize_detached_policy(old.company_id,'shared_inbox',old.shared_inbox_id);
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_shared_inbox_parent_saved()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='UPDATE' and old.parent_folder_id is not distinct from new.parent_folder_id then
    return new;
  end if;
  perform mangorts_v2_advance_parent_link(new.company_id,'shared_inbox',new.shared_inbox_id,new.parent_folder_id is null);
  return new;
end;
$$;

create or replace function mangorts_v2_group_policy_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid := coalesce((to_jsonb(new)->>'company_id')::uuid,(to_jsonb(old)->>'company_id')::uuid);
begin
  insert into workspace_read_versions(company_id,scope,resource_key,version,updated_timestamp)
  values(v_company_id,'policy-group-membership','',1,now())
  on conflict(company_id,scope,resource_key) do update
  set version=workspace_read_versions.version+1,updated_timestamp=now();
  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function mangorts_v2_group_deleted_cleanup()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  delete from resource_gvic_assignments
  where company_id=old.company_id and principal_type='group' and principal_id=old.group_id;
  delete from resource_permissions
  where company_id=old.company_id and subject_type='group' and subject_id=old.group_id;
  return old;
end;
$$;

do $$
declare
  item record;
begin
  for item in select * from (values
    ('nodes','node','node_id'),
    ('logic_gates','logic_gate','logic_gate_id'),
    ('projects','project','project_id'),
    ('company_explorer_folders','company_explorer_folder','folder_id'),
    ('shared_inbox_folders','shared_inbox_folder','folder_id'),
    ('shared_inboxes','shared_inbox','shared_inbox_id')
  ) as values_row(table_name,resource_type,id_column)
  loop
    execute format('drop trigger if exists trg_v2_policy_initialize on %I',item.table_name);
    execute format(
      'create constraint trigger trg_v2_policy_initialize after insert on %I deferrable initially deferred for each row execute function mangorts_v2_initialize_policy_settings(%L,%L)',
      item.table_name,item.resource_type,item.id_column
    );
    execute format('drop trigger if exists trg_v2_policy_delete on %I',item.table_name);
    execute format(
      'create trigger trg_v2_policy_delete after delete on %I for each row execute function mangorts_v2_resource_deleted_cleanup(%L,%L)',
      item.table_name,item.resource_type,item.id_column
    );
  end loop;
end;
$$;

drop trigger if exists trg_v2_node_policy_parent_before_delete on node_logic_gate_assignments;
create trigger trg_v2_node_policy_parent_before_delete
before delete on node_logic_gate_assignments
for each row execute function mangorts_v2_node_parent_link_changed();
drop trigger if exists trg_v2_node_policy_parent_after_save on node_logic_gate_assignments;
create trigger trg_v2_node_policy_parent_after_save
after insert or update of logic_gate_id on node_logic_gate_assignments
for each row execute function mangorts_v2_node_parent_link_changed();
drop trigger if exists trg_v2_node_policy_parent_after_delete on node_logic_gate_assignments;
create trigger trg_v2_node_policy_parent_after_delete
after delete on node_logic_gate_assignments
for each row execute function mangorts_v2_node_parent_link_removed();

drop trigger if exists trg_v2_company_item_policy_parent_before_delete on company_explorer_items;
create trigger trg_v2_company_item_policy_parent_before_delete
before delete on company_explorer_items
for each row execute function mangorts_v2_company_item_parent_changed();
drop trigger if exists trg_v2_company_item_policy_parent_after_save on company_explorer_items;
create trigger trg_v2_company_item_policy_parent_after_save
after insert or update of parent_folder_id on company_explorer_items
for each row execute function mangorts_v2_company_item_parent_saved();

drop trigger if exists trg_v2_company_folder_policy_parent_before_update on company_explorer_folders;
create trigger trg_v2_company_folder_policy_parent_before_update
before update of parent_folder_id on company_explorer_folders
for each row execute function mangorts_v2_folder_parent_changing('company_explorer_folder');
drop trigger if exists trg_v2_company_folder_policy_parent_after_save on company_explorer_folders;
create trigger trg_v2_company_folder_policy_parent_after_save
after insert or update of parent_folder_id on company_explorer_folders
for each row execute function mangorts_v2_folder_parent_saved('company_explorer_folder');

drop trigger if exists trg_v2_shared_folder_policy_parent_before_update on shared_inbox_folders;
create trigger trg_v2_shared_folder_policy_parent_before_update
before update of parent_folder_id on shared_inbox_folders
for each row execute function mangorts_v2_folder_parent_changing('shared_inbox_folder');
drop trigger if exists trg_v2_shared_folder_policy_parent_after_save on shared_inbox_folders;
create trigger trg_v2_shared_folder_policy_parent_after_save
after insert or update of parent_folder_id on shared_inbox_folders
for each row execute function mangorts_v2_folder_parent_saved('shared_inbox_folder');

drop trigger if exists trg_v2_shared_inbox_policy_parent_before_update on shared_inboxes;
create trigger trg_v2_shared_inbox_policy_parent_before_update
before update of parent_folder_id on shared_inboxes
for each row execute function mangorts_v2_shared_inbox_parent_changing();
drop trigger if exists trg_v2_shared_inbox_policy_parent_after_save on shared_inboxes;
create trigger trg_v2_shared_inbox_policy_parent_after_save
after insert or update of parent_folder_id on shared_inboxes
for each row execute function mangorts_v2_shared_inbox_parent_saved();

drop trigger if exists trg_v2_group_policy_cleanup on company_user_groups;
create trigger trg_v2_group_policy_cleanup
before delete on company_user_groups
for each row execute function mangorts_v2_group_deleted_cleanup();
drop trigger if exists trg_v2_group_policy_version on company_user_groups;
create trigger trg_v2_group_policy_version
after insert or update or delete on company_user_groups
for each row execute function mangorts_v2_group_policy_changed();
drop trigger if exists trg_v2_group_member_policy_version on company_user_group_members;
create trigger trg_v2_group_member_policy_version
after insert or update or delete on company_user_group_members
for each row execute function mangorts_v2_group_policy_changed();

insert into workspace_read_versions(company_id,scope,resource_key,version,updated_timestamp)
select company_id,'policy-group-membership','',0,now() from companies
on conflict(company_id,scope,resource_key) do nothing;

do $$
begin
  if (select count(*) from resource_gvic_settings) <>
     ((select count(*) from nodes)+(select count(*) from logic_gates)+(select count(*) from projects)+
      (select count(*) from company_explorer_folders)+(select count(*) from shared_inbox_folders)+(select count(*) from shared_inboxes)) then
    raise exception 'v2_policy_step2_gvic_settings_coverage_mismatch';
  end if;
  if (select count(*) from resource_permission_settings) <>
     ((select count(*) from nodes)+(select count(*) from logic_gates)+(select count(*) from projects)+
      (select count(*) from company_explorer_folders)+(select count(*) from shared_inbox_folders)+(select count(*) from shared_inboxes)) then
    raise exception 'v2_policy_step2_permission_settings_coverage_mismatch';
  end if;
end;
$$;

commit;
