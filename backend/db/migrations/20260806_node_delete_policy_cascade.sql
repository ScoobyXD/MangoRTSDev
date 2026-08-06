begin;

create or replace function mangorts_v2_resource_deleted_cleanup()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  deleted_resource_type text := tg_argv[0];
  deleted_resource_id uuid := (to_jsonb(old)->>tg_argv[1])::uuid;
  deleted_company_id uuid := (to_jsonb(old)->>'company_id')::uuid;
begin
  delete from resource_gvic_settings
  where resource_gvic_settings.company_id=deleted_company_id
    and resource_gvic_settings.resource_type=deleted_resource_type
    and resource_gvic_settings.resource_id=deleted_resource_id;
  delete from resource_permission_settings
  where resource_permission_settings.company_id=deleted_company_id
    and resource_permission_settings.resource_type=deleted_resource_type
    and resource_permission_settings.resource_id=deleted_resource_id;
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
    if exists(
      select 1
      from nodes
      where company_id=old.company_id and node_id=old.node_id
    ) then
      perform mangorts_v2_materialize_detached_policy(old.company_id,'node',old.node_id);
    end if;
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
  if exists(
    select 1
    from nodes
    where company_id=old.company_id and node_id=old.node_id
  ) then
    perform mangorts_v2_advance_parent_link(old.company_id,'node',old.node_id,true);
  end if;
  return old;
end;
$$;

commit;
