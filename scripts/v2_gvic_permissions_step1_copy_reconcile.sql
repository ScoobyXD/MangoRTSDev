-- V2 GVIC and permissions Step 1 restartable copy/reconciliation.
-- Run in DBeaver only after the read-only preflight returns READY.
-- This script writes only V2 settings/staging storage and the two V2 sequences.

begin transaction isolation level repeatable read;

select pg_advisory_xact_lock(4855156563379734402);

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 190000 then
    raise exception 'v2_policy_step1_unsupported_postgresql_version:%',current_setting('server_version');
  end if;
  if exists (
    select 1 from mangorts_v2_step1_preflight_report()
    where section='FINAL' and status<>'READY'
  ) then
    raise exception 'v2_policy_step1_preflight_stop';
  end if;
  if exists(select 1 from resource_gvic_settings where assignment_mode<>'customized' or descendant_reset_sequence<>0)
     or exists(select 1 from resource_permission_settings where permission_mode<>'customized' or descendant_reset_sequence<>0) then
    raise exception 'v2_policy_step1_destination_contains_post_baseline_state';
  end if;
end;
$$;

create temporary table v2_step1_all_resources (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  parent_resource_type text,
  parent_resource_id uuid,
  primary key(company_id,resource_type,resource_id)
) on commit drop;

insert into v2_step1_all_resources(company_id,resource_type,resource_id,parent_resource_type,parent_resource_id)
select source.company_id,source.resource_type,source.resource_id,parent.parent_resource_type,parent.parent_resource_id
from (
  select company_id,'node'::text as resource_type,node_id as resource_id from nodes
  union all select company_id,'logic_gate',logic_gate_id from logic_gates
  union all select company_id,'project',project_id from projects
  union all select company_id,'company_explorer_folder',folder_id from company_explorer_folders
  union all select company_id,'shared_inbox_folder',folder_id from shared_inbox_folders
  union all select company_id,'shared_inbox',shared_inbox_id from shared_inboxes
) source
left join lateral mangorts_v2_policy_parent(source.company_id,source.resource_type,source.resource_id) parent on true;

create temporary table v2_step1_resolved_gvic (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  principal_type text not null,
  principal_id uuid not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  primary key(company_id,resource_type,resource_id,role,principal_type,principal_id)
) on commit drop;

insert into v2_step1_resolved_gvic
select resource.company_id,resource.resource_type,resource.resource_id,
       edge.role,edge.principal_type,edge.principal_id,
       coalesce(edge.created_timestamp,now()),coalesce(edge.updated_timestamp,edge.created_timestamp,now())
from v2_step1_all_resources resource
cross join lateral mangorts_v2_step1_resolved_gvic(
  resource.company_id,resource.resource_type,resource.resource_id
) edge;

create temporary table v2_step1_resolved_permissions (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  subject_type text not null,
  subject_id uuid not null,
  access_level text not null,
  created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  primary key(company_id,resource_type,resource_id,subject_type,subject_id)
) on commit drop;

insert into v2_step1_resolved_permissions
select resource.company_id,resource.resource_type,resource.resource_id,
       edge.subject_type,edge.subject_id,edge.access_level,
       coalesce(edge.created_timestamp,now()),coalesce(edge.updated_timestamp,edge.created_timestamp,now())
from v2_step1_all_resources resource
cross join lateral mangorts_v2_step1_resolved_permissions(
  resource.company_id,resource.resource_type,resource.resource_id
) edge;

create temporary table v2_step1_resolved_defaults (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  default_access text not null,
  primary key(company_id,resource_type,resource_id)
) on commit drop;

insert into v2_step1_resolved_defaults
select resource.company_id,resource.resource_type,resource.resource_id,
       mangorts_v2_step1_resolved_permission_default(
         resource.company_id,resource.resource_type,resource.resource_id
       )
from v2_step1_all_resources resource;

create temporary table v2_step1_baseline(baseline_sequence bigint not null) on commit drop;

insert into v2_step1_baseline
select greatest(
  1::bigint,
  coalesce((select max(policy_sequence) from resource_gvic_policy_revisions),0),
  coalesce((select max(policy_sequence) from resource_gvic_subtree_applications),0),
  coalesce((select max(policy_sequence) from resource_permission_policy_revisions),0),
  coalesce((select max(policy_sequence) from resource_permission_subtree_applications),0),
  (select last_value from resource_gvic_change_sequence),
  (select last_value from resource_permission_change_sequence),
  coalesce((select max(customized_sequence) from resource_gvic_settings),0),
  coalesce((select max(customized_sequence) from resource_permission_settings),0)
);

do $$
begin
  if exists (
    select 1 from v2_step1_all_resources resource
    where not mangorts_v2_policy_resource_exists(resource.company_id,resource.resource_type,resource.resource_id)
       or mangorts_v2_policy_resource_has_cycle(resource.company_id,resource.resource_type,resource.resource_id)
  ) then
    raise exception 'v2_policy_step1_invalid_resource_hierarchy';
  end if;
  if exists (
    select 1 from v2_step1_resolved_gvic
    where (role in ('generated','verified') and principal_type<>'user')
       or principal_type not in ('user','group')
  ) or exists (
    select 1 from v2_step1_resolved_gvic
    where role='generated'
    group by company_id,resource_type,resource_id having count(*)>1
  ) or exists (
    select 1 from v2_step1_resolved_gvic
    group by company_id,resource_type,resource_id,principal_type,principal_id
    having count(distinct role)>1
  ) then
    raise exception 'v2_policy_step1_invalid_resolved_gvic_shape';
  end if;
  if exists (
    select 1 from v2_step1_resolved_defaults where default_access not in ('edit','no_access')
  ) then
    raise exception 'v2_policy_step1_invalid_resolved_permission_default';
  end if;
  if exists (
    select 1 from v2_step1_resolved_gvic edge
    where (edge.principal_type='user' and not exists (
             select 1 from company_memberships membership
             where membership.company_id=edge.company_id and membership.user_id=edge.principal_id
           ))
       or (edge.principal_type='group' and not exists (
             select 1 from company_user_groups user_group
             where user_group.company_id=edge.company_id and user_group.group_id=edge.principal_id
           ))
  ) or exists (
    select 1 from v2_step1_resolved_permissions edge
    where (edge.subject_type='user' and not exists (
             select 1 from company_memberships membership
             where membership.company_id=edge.company_id and membership.user_id=edge.subject_id
           ))
       or (edge.subject_type='group' and not exists (
             select 1 from company_user_groups user_group
             where user_group.company_id=edge.company_id and user_group.group_id=edge.subject_id
           ))
  ) then
    raise exception 'v2_policy_step1_invalid_resolved_principal';
  end if;
end;
$$;

insert into resource_gvic_settings(
  company_id,resource_type,resource_id,assignment_mode,customized_sequence,
  parent_link_sequence,descendant_reset_sequence,created_timestamp,updated_timestamp
)
select resource.company_id,resource.resource_type,resource.resource_id,'customized',baseline.baseline_sequence,
       case when resource.parent_resource_id is null then 0 else baseline.baseline_sequence end,
       0,now(),now()
from v2_step1_all_resources resource cross join v2_step1_baseline baseline
on conflict(company_id,resource_type,resource_id) do update set
  assignment_mode='customized',customized_sequence=excluded.customized_sequence,
  parent_link_sequence=excluded.parent_link_sequence,descendant_reset_sequence=0,updated_timestamp=now();

insert into resource_permission_settings(
  company_id,resource_type,resource_id,permission_mode,default_access,customized_sequence,
  parent_link_sequence,descendant_reset_sequence,created_timestamp,updated_timestamp
)
select resource.company_id,resource.resource_type,resource.resource_id,'customized',defaults.default_access,
       baseline.baseline_sequence,
       case when resource.parent_resource_id is null then 0 else baseline.baseline_sequence end,
       0,now(),now()
from v2_step1_all_resources resource
join v2_step1_resolved_defaults defaults using(company_id,resource_type,resource_id)
cross join v2_step1_baseline baseline
on conflict(company_id,resource_type,resource_id) do update set
  permission_mode='customized',default_access=excluded.default_access,
  customized_sequence=excluded.customized_sequence,parent_link_sequence=excluded.parent_link_sequence,
  descendant_reset_sequence=0,updated_timestamp=now();

delete from resource_gvic_settings target
where not exists (
  select 1 from v2_step1_all_resources source
  where source.company_id=target.company_id and source.resource_type=target.resource_type and source.resource_id=target.resource_id
);

delete from resource_permission_settings target
where not exists (
  select 1 from v2_step1_all_resources source
  where source.company_id=target.company_id and source.resource_type=target.resource_type and source.resource_id=target.resource_id
);

delete from resource_gvic_assignments_v2_staging target
where not exists (
  select 1 from v2_step1_resolved_gvic source
  where source.company_id=target.company_id and source.resource_type=target.resource_type
    and source.resource_id=target.resource_id and source.role=target.role
    and source.principal_type=target.principal_type and source.principal_id=target.principal_id
);

insert into resource_gvic_assignments_v2_staging(
  company_id,resource_type,resource_id,role,principal_type,principal_id,created_timestamp,updated_timestamp
)
select company_id,resource_type,resource_id,role,principal_type,principal_id,created_timestamp,updated_timestamp
from v2_step1_resolved_gvic
on conflict(company_id,resource_type,resource_id,role,principal_type,principal_id) do update set
  created_timestamp=excluded.created_timestamp,updated_timestamp=excluded.updated_timestamp;

delete from resource_permissions_v2_staging target
where not exists (
  select 1 from v2_step1_resolved_permissions source
  where source.company_id=target.company_id and source.resource_type=target.resource_type
    and source.resource_id=target.resource_id and source.subject_type=target.subject_type
    and source.subject_id=target.subject_id
);

insert into resource_permissions_v2_staging(
  company_id,resource_type,resource_id,subject_type,subject_id,access_level,created_timestamp,updated_timestamp
)
select company_id,resource_type,resource_id,subject_type,subject_id,access_level,created_timestamp,updated_timestamp
from v2_step1_resolved_permissions
on conflict(company_id,resource_type,resource_id,subject_type,subject_id) do update set
  access_level=excluded.access_level,created_timestamp=excluded.created_timestamp,updated_timestamp=excluded.updated_timestamp;

select setval('resource_gvic_change_sequence',baseline_sequence,true) from v2_step1_baseline;
select setval('resource_permission_change_sequence',baseline_sequence,true) from v2_step1_baseline;

do $$
begin
  if (select count(*) from resource_gvic_settings)<>(select count(*) from v2_step1_all_resources)
     or (select count(*) from resource_permission_settings)<>(select count(*) from v2_step1_all_resources)
     or (select count(*) from resource_gvic_assignments_v2_staging)<>(select count(*) from v2_step1_resolved_gvic)
     or (select count(*) from resource_permissions_v2_staging)<>(select count(*) from v2_step1_resolved_permissions) then
    raise exception 'v2_policy_step1_count_reconciliation_failed';
  end if;
  if exists (
    (select company_id,resource_type,resource_id,role,principal_type,principal_id
     from v2_step1_resolved_gvic
     except
     select company_id,resource_type,resource_id,role,principal_type,principal_id
     from resource_gvic_assignments_v2_staging)
    union all
    (select company_id,resource_type,resource_id,role,principal_type,principal_id
     from resource_gvic_assignments_v2_staging
     except
     select company_id,resource_type,resource_id,role,principal_type,principal_id
     from v2_step1_resolved_gvic)
  ) then
    raise exception 'v2_policy_step1_gvic_edge_reconciliation_failed';
  end if;
  if exists (
    (select company_id,resource_type,resource_id,subject_type,subject_id,access_level
     from v2_step1_resolved_permissions
     except
     select company_id,resource_type,resource_id,subject_type,subject_id,access_level
     from resource_permissions_v2_staging)
    union all
    (select company_id,resource_type,resource_id,subject_type,subject_id,access_level
     from resource_permissions_v2_staging
     except
     select company_id,resource_type,resource_id,subject_type,subject_id,access_level
     from v2_step1_resolved_permissions)
  ) then
    raise exception 'v2_policy_step1_permission_edge_reconciliation_failed';
  end if;
  if exists (
    select 1 from resource_permission_settings target
    join v2_step1_resolved_defaults source using(company_id,resource_type,resource_id)
    where target.default_access<>source.default_access
  ) then
    raise exception 'v2_policy_step1_permission_default_reconciliation_failed';
  end if;
end;
$$;

select 'BASELINE'::text as result_type,
       baseline_sequence::text as identity,
       'READY'::text as status,
       jsonb_build_object(
         'next_gvic_sequence',baseline_sequence+1,
         'next_permission_sequence',baseline_sequence+1
       ) as details
from v2_step1_baseline
union all
select 'RECONCILIATION',resource_type,'READY',jsonb_build_object(
  'resource_count',count(*),
  'gvic_edge_count',(select count(*) from v2_step1_resolved_gvic edge where edge.resource_type=resource.resource_type),
  'permission_edge_count',(select count(*) from v2_step1_resolved_permissions edge where edge.resource_type=resource.resource_type),
  'permission_default_count',(select count(*) from v2_step1_resolved_defaults defaults where defaults.resource_type=resource.resource_type),
  'gvic_fingerprint',coalesce((
    select md5(string_agg(edge.company_id || ':' || edge.resource_type || ':' || edge.resource_id || ':' || edge.role || ':' || edge.principal_type || ':' || edge.principal_id,'|' order by edge.company_id,edge.resource_id,edge.role,edge.principal_type,edge.principal_id))
    from v2_step1_resolved_gvic edge where edge.resource_type=resource.resource_type
  ),md5('')),
  'permission_fingerprint',coalesce((
    select md5(string_agg(edge.company_id || ':' || edge.resource_type || ':' || edge.resource_id || ':' || edge.subject_type || ':' || edge.subject_id || ':' || edge.access_level,'|' order by edge.company_id,edge.resource_id,edge.subject_type,edge.subject_id,edge.access_level))
    from v2_step1_resolved_permissions edge where edge.resource_type=resource.resource_type
  ),md5(''))
)
from v2_step1_all_resources resource
group by resource_type
union all
select 'FINAL','v2_gvic_permissions_step1_copy','READY',jsonb_build_object(
  'resource_count',(select count(*) from v2_step1_all_resources),
  'gvic_edge_count',(select count(*) from v2_step1_resolved_gvic),
  'permission_edge_count',(select count(*) from v2_step1_resolved_permissions),
  'mode_conversion','every existing resource is customized; equality never implies inheritance',
  'descendant_reset_sequence',0
);

commit;
