create or replace function mangorts_grant_resource_access_at_least(
  p_company_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_principal_type text,
  p_principal_id uuid,
  p_access_level text
)
returns void as $$
begin
  if mangorts_access_level_rank(p_access_level) = 0 then
    return;
  end if;

  insert into resource_access_grants (
    company_id,
    resource_type,
    resource_id,
    principal_type,
    principal_id,
    access_level,
    created_timestamp
  )
  values (
    p_company_id,
    p_resource_type,
    p_resource_id,
    p_principal_type,
    p_principal_id,
    p_access_level,
    now()
  )
  on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do update set
    access_level = case
      when mangorts_access_level_rank(resource_access_grants.access_level) >= mangorts_access_level_rank(excluded.access_level)
        then resource_access_grants.access_level
      else excluded.access_level
    end;
end;
$$ language plpgsql;

create or replace function trg_grant_node_assignee_edit_access()
returns trigger as $$
begin
  if new.assignee_user_id is not null then
    perform mangorts_grant_resource_access_at_least(
      new.company_id,
      'node',
      new.node_id,
      'user',
      new.assignee_user_id,
      'edit'
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_grant_node_assignee_edit_access on nodes;
create trigger trg_grant_node_assignee_edit_access
after insert or update of assignee_user_id on nodes
for each row execute function trg_grant_node_assignee_edit_access();

create or replace function trg_grant_logic_gate_raci_edit_access()
returns trigger as $$
begin
  perform mangorts_grant_resource_access_at_least(
    new.company_id,
    'logic_gate',
    new.logic_gate_id,
    'user',
    new.user_id,
    'edit'
  );
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_grant_logic_gate_raci_edit_access on logic_gate_raci_assignments;
create trigger trg_grant_logic_gate_raci_edit_access
after insert or update on logic_gate_raci_assignments
for each row execute function trg_grant_logic_gate_raci_edit_access();

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
  company_id,
  'node',
  node_id,
  'user',
  assignee_user_id,
  'edit',
  now()
from nodes
where assignee_user_id is not null
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do update set
  access_level = case
    when mangorts_access_level_rank(resource_access_grants.access_level) >= mangorts_access_level_rank(excluded.access_level)
      then resource_access_grants.access_level
    else excluded.access_level
  end;

insert into resource_access_grants (
  company_id,
  resource_type,
  resource_id,
  principal_type,
  principal_id,
  access_level,
  created_timestamp
)
select distinct
  company_id,
  'logic_gate',
  logic_gate_id,
  'user',
  user_id,
  'edit',
  now()
from logic_gate_raci_assignments
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do update set
  access_level = case
    when mangorts_access_level_rank(resource_access_grants.access_level) >= mangorts_access_level_rank(excluded.access_level)
      then resource_access_grants.access_level
    else excluded.access_level
  end;
