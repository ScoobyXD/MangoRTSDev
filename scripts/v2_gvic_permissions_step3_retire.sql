-- V2 GVIC/permissions Step 3 retirement.
-- Plain PostgreSQL for DBeaver. Run once only after the Step 2 build is deployed
-- and the Step 2 readiness report is READY. This script is one transaction and
-- uses no CASCADE; any unexpected dependency rolls the entire retirement back.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $$
begin
  if current_setting('server_version_num')::integer / 10000 <> 17 then
    raise exception 'STOP: V2 policy retirement requires PostgreSQL 17.x; connected server is %',
      current_setting('server_version');
  end if;

  if to_regclass('public.resource_gvic_settings') is null
     or to_regclass('public.resource_gvic_assignments') is null
     or to_regclass('public.resource_permission_settings') is null
     or to_regclass('public.resource_permissions') is null then
    raise exception 'STOP: one or more of the four final policy tables is missing';
  end if;

  if to_regclass('public.resource_gvic_assignments_step2_legacy') is null
     or to_regclass('public.resource_permissions_step2_legacy') is null then
    raise exception 'STOP: Step 2 legacy evidence is missing; refusing a partial or wrong-database retirement';
  end if;
end
$$;

-- Step 1-only read/report functions reference the retired storage.
drop function if exists mangorts_v2_step1_preflight_report();
drop function if exists mangorts_v2_step1_resolved_permissions(uuid,text,uuid);
drop function if exists mangorts_v2_step1_resolved_permission_default(uuid,text,uuid);
drop function if exists mangorts_v2_step1_resolved_gvic(uuid,text,uuid);

-- Frozen Step 2 rollback/audit copies.
drop table resource_gvic_assignments_step2_legacy;
drop table resource_permissions_step2_legacy;

-- Old derived GVIC, revision, subtree-application, permission, group-closure,
-- and matrix-projection storage. The deployed Step 2 runtime does not use it.
drop table resource_gvic_effective_assignments;
drop table resource_gvic_policy_revisions;
drop table resource_gvic_subtree_applications;
drop table resource_permission_policy_revisions;
drop table resource_permission_subtree_applications;
drop table company_user_group_closure;
drop table gvic_matrix_projection_table;

-- These names normally disappeared during the Step 2 rename. Remove only a
-- stray leftover; the required final and legacy names above prove cutover ran.
drop table if exists resource_gvic_assignments_v2_staging;
drop table if exists resource_permissions_v2_staging;

drop sequence resource_policy_sequence;

-- Trigger helpers used only by the retired subtree-application tables.
drop function if exists mangorts_trg_bump_logic_gate_work_from_permission_application();
drop function if exists mangorts_trg_bump_node_view_from_permission_application();

do $$
declare
  retired_name text;
begin
  foreach retired_name in array array[
    'resource_gvic_assignments_step2_legacy',
    'resource_permissions_step2_legacy',
    'resource_gvic_effective_assignments',
    'resource_gvic_policy_revisions',
    'resource_gvic_subtree_applications',
    'resource_permission_policy_revisions',
    'resource_permission_subtree_applications',
    'company_user_group_closure',
    'gvic_matrix_projection_table',
    'resource_gvic_assignments_v2_staging',
    'resource_permissions_v2_staging'
  ] loop
    if to_regclass('public.' || retired_name) is not null then
      raise exception 'STOP: retirement did not remove %',retired_name;
    end if;
  end loop;

  if to_regclass('public.resource_gvic_settings') is null
     or to_regclass('public.resource_gvic_assignments') is null
     or to_regclass('public.resource_permission_settings') is null
     or to_regclass('public.resource_permissions') is null then
    raise exception 'STOP: retirement damaged the four final policy tables';
  end if;
end
$$;

select 'V2_GVIC_PERMISSIONS_STEP3_RETIRED' as status,
       current_setting('server_version') as server_version;

commit;
