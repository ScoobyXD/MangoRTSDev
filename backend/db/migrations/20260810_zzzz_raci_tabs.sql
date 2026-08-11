begin;

create table if not exists raci_tabs_folders (
  company_id uuid not null,
  folder_id uuid not null,
  user_id uuid not null,
  role text not null,
  parent_folder_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint raci_tabs_folders_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  constraint raci_tabs_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint raci_tabs_folders_not_self_parent_chk check (parent_folder_id is distinct from folder_id),
  primary key (folder_id),
  unique (company_id, user_id, role, folder_id),
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, user_id, role, parent_folder_id)
    references raci_tabs_folders(company_id, user_id, role, folder_id) on delete cascade
);

create index if not exists idx_raci_tabs_folders_owner_role_parent_position
  on raci_tabs_folders(company_id, user_id, role, parent_folder_id, position, created_timestamp, name, folder_id);

create table if not exists raci_tabs_items (
  company_id uuid not null,
  user_id uuid not null,
  role text not null,
  logic_gate_id uuid not null,
  folder_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint raci_tabs_items_role_chk check (role in ('responsible', 'accountable', 'consulted', 'informed')),
  constraint raci_tabs_items_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, user_id, logic_gate_id),
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates(company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, user_id, role, folder_id)
    references raci_tabs_folders(company_id, user_id, role, folder_id) on delete cascade
);

do $$
declare
  spec record;
  actual_count integer;
  missing_count integer;
  extra_count integer;
begin
  for spec in
    select * from (values
      ('raci_tabs_items', array['company_id','user_id','role','logic_gate_id','folder_id','name','position','created_timestamp','updated_timestamp']::text[]),
      ('raci_tabs_folders', array['company_id','folder_id','user_id','role','parent_folder_id','name','position','created_timestamp','updated_timestamp']::text[])
    ) expected(table_name,expected_columns)
  loop
    select count(*) into actual_count
    from information_schema.columns actual
    where actual.table_schema='public' and actual.table_name=spec.table_name;

    select count(*) into missing_count
    from unnest(spec.expected_columns) expected(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public' and actual.table_name=spec.table_name
        and actual.column_name=expected.column_name
    );

    select count(*) into extra_count
    from information_schema.columns actual
    where actual.table_schema='public' and actual.table_name=spec.table_name
      and not (actual.column_name=any(spec.expected_columns));

    if actual_count<>cardinality(spec.expected_columns) or missing_count<>0 or extra_count<>0 then
      raise exception 'raci_tabs_schema_drift:%:expected=%:actual=%:missing=%:extra=%',
        spec.table_name,cardinality(spec.expected_columns),actual_count,missing_count,extra_count;
    end if;
  end loop;
end;
$$;

create index if not exists idx_raci_tabs_items_owner_role_folder_position
  on raci_tabs_items(company_id, user_id, role, folder_id, position, created_timestamp, name, logic_gate_id);

create index if not exists idx_raci_tabs_items_logic_gate
  on raci_tabs_items(company_id, logic_gate_id, user_id);

with expected as (
  select
    gate.company_id,
    effective.user_id,
    effective.role,
    gate.logic_gate_id,
    gate.header as name,
    row_number() over (
      partition by gate.company_id, effective.user_id, effective.role
      order by gate.created_timestamp, lower(gate.header), gate.logic_gate_id
    )::integer * 1000 as position,
    gate.created_timestamp
  from logic_gates gate
  cross join lateral mangorts_v2_effective_gvic_assignments(
    gate.company_id,
    'logic_gate',
    gate.logic_gate_id
  ) effective
)
insert into raci_tabs_items(
  company_id, user_id, role, logic_gate_id, folder_id, name, position,
  created_timestamp, updated_timestamp
)
select
  expected.company_id,
  expected.user_id,
  expected.role,
  expected.logic_gate_id,
  null,
  expected.name,
  expected.position,
  expected.created_timestamp,
  now()
from expected
on conflict (company_id, user_id, logic_gate_id) do nothing;

create or replace function mangorts_sync_raci_tabs_logic_gate(
  p_company_id uuid,
  p_logic_gate_id uuid
)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_name text;
begin
  select gate.header
  into v_name
  from logic_gates gate
  where gate.company_id=p_company_id
    and gate.logic_gate_id=p_logic_gate_id;

  if not found then
    delete from raci_tabs_items item
    where item.company_id=p_company_id
      and item.logic_gate_id=p_logic_gate_id;
    return;
  end if;

  with effective as materialized (
    select assignment.user_id, assignment.role
    from mangorts_v2_effective_gvic_assignments(
      p_company_id,
      'logic_gate',
      p_logic_gate_id
    ) assignment
  ), prepared as (
    select
      p_company_id as company_id,
      effective.user_id,
      effective.role,
      p_logic_gate_id as logic_gate_id,
      case when current_item.role=effective.role then current_item.folder_id else null end as folder_id,
      v_name as name,
      case
        when current_item.role=effective.role then current_item.position
        else coalesce((
          select max(sibling.position)
          from (
            select folder.position
            from raci_tabs_folders folder
            where folder.company_id=p_company_id
              and folder.user_id=effective.user_id
              and folder.role=effective.role
              and folder.parent_folder_id is null
            union all
            select item.position
            from raci_tabs_items item
            where item.company_id=p_company_id
              and item.user_id=effective.user_id
              and item.role=effective.role
              and item.folder_id is null
              and item.logic_gate_id<>p_logic_gate_id
          ) sibling
        ), 0) + 1000
      end as position,
      coalesce(current_item.created_timestamp, now()) as created_timestamp
    from effective
    left join raci_tabs_items current_item
      on current_item.company_id=p_company_id
     and current_item.user_id=effective.user_id
     and current_item.logic_gate_id=p_logic_gate_id
  )
  insert into raci_tabs_items(
    company_id, user_id, role, logic_gate_id, folder_id, name, position,
    created_timestamp, updated_timestamp
  )
  select
    prepared.company_id,
    prepared.user_id,
    prepared.role,
    prepared.logic_gate_id,
    prepared.folder_id,
    prepared.name,
    prepared.position,
    prepared.created_timestamp,
    now()
  from prepared
  on conflict (company_id, user_id, logic_gate_id) do update
  set role=excluded.role,
      folder_id=excluded.folder_id,
      name=excluded.name,
      position=excluded.position,
      updated_timestamp=now()
  where (raci_tabs_items.role, raci_tabs_items.folder_id, raci_tabs_items.name, raci_tabs_items.position)
        is distinct from
        (excluded.role, excluded.folder_id, excluded.name, excluded.position);

  delete from raci_tabs_items item
  where item.company_id=p_company_id
    and item.logic_gate_id=p_logic_gate_id
    and not exists (
      select 1
      from mangorts_v2_effective_gvic_assignments(
        p_company_id,
        'logic_gate',
        p_logic_gate_id
      ) effective
      where effective.user_id=item.user_id
    );
end;
$$;

create or replace function mangorts_sync_raci_tabs_company(p_company_id uuid)
returns void
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_gate record;
begin
  for v_gate in
    select logic_gate_id
    from logic_gates
    where company_id=p_company_id
    order by created_timestamp, lower(header), logic_gate_id
  loop
    perform mangorts_sync_raci_tabs_logic_gate(p_company_id, v_gate.logic_gate_id);
  end loop;

  delete from raci_tabs_items item
  where item.company_id=p_company_id
    and not exists (
      select 1
      from logic_gates gate
      where gate.company_id=item.company_id
        and gate.logic_gate_id=item.logic_gate_id
    );
end;
$$;

create or replace function mangorts_raci_tabs_logic_gate_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    perform mangorts_sync_raci_tabs_logic_gate(old.company_id, old.logic_gate_id);
  else
    perform mangorts_sync_raci_tabs_logic_gate(new.company_id, new.logic_gate_id);
  end if;
  return null;
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
    if old.resource_type='logic_gate' then
      perform mangorts_sync_raci_tabs_logic_gate(old.company_id,old.resource_id);
    elsif old.resource_type='company_explorer_folder' then
      perform mangorts_sync_raci_tabs_company(old.company_id);
    end if;
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
  if v_resource_type='logic_gate' then
    perform mangorts_sync_raci_tabs_logic_gate(v_company_id, v_resource_id);
  elsif v_resource_type='company_explorer_folder' then
    perform mangorts_sync_raci_tabs_company(v_company_id);
  end if;
  return null;
end;
$$;

create or replace function mangorts_raci_tabs_company_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    perform mangorts_sync_raci_tabs_company(old.company_id);
  else
    perform mangorts_sync_raci_tabs_company(new.company_id);
  end if;
  return null;
end;
$$;

create or replace function mangorts_raci_tabs_explorer_item_changed()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' and old.target_type='logic_gate' then
    perform mangorts_sync_raci_tabs_logic_gate(old.company_id, old.target_id);
  elsif tg_op<>'DELETE' then
    if tg_op='UPDATE' and old.target_type='logic_gate'
       and (old.company_id,old.target_id,old.target_type)
           is distinct from
           (new.company_id,new.target_id,new.target_type) then
      perform mangorts_sync_raci_tabs_logic_gate(old.company_id,old.target_id);
    end if;
    if new.target_type='logic_gate' then
      perform mangorts_sync_raci_tabs_logic_gate(new.company_id,new.target_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_zz_raci_tabs_logic_gate_changed on logic_gates;
create trigger trg_zz_raci_tabs_logic_gate_changed
after insert or update of header or delete on logic_gates
for each row execute function mangorts_raci_tabs_logic_gate_changed();

drop trigger if exists trg_zz_raci_tabs_assignment_changed on resource_gvic_assignments;
create trigger trg_zz_raci_tabs_assignment_changed
after insert or update or delete on resource_gvic_assignments
for each row execute function mangorts_raci_tabs_policy_changed();

drop trigger if exists trg_zz_raci_tabs_setting_changed on resource_gvic_settings;
create trigger trg_zz_raci_tabs_setting_changed
after insert or update or delete on resource_gvic_settings
for each row execute function mangorts_raci_tabs_policy_changed();

drop trigger if exists trg_zz_raci_tabs_explorer_item_changed on company_explorer_items;
create trigger trg_zz_raci_tabs_explorer_item_changed
after insert or update of parent_folder_id, target_id, target_type or delete on company_explorer_items
for each row execute function mangorts_raci_tabs_explorer_item_changed();

drop trigger if exists trg_zz_raci_tabs_explorer_folder_changed on company_explorer_folders;
create trigger trg_zz_raci_tabs_explorer_folder_changed
after update of parent_folder_id or delete on company_explorer_folders
for each row execute function mangorts_raci_tabs_company_changed();

drop trigger if exists trg_zz_raci_tabs_group_changed on company_user_groups;
create trigger trg_zz_raci_tabs_group_changed
after insert or update of parent_group_id or delete on company_user_groups
for each row execute function mangorts_raci_tabs_company_changed();

drop trigger if exists trg_zz_raci_tabs_group_member_changed on company_user_group_members;
create trigger trg_zz_raci_tabs_group_member_changed
after insert or update or delete on company_user_group_members
for each row execute function mangorts_raci_tabs_company_changed();

drop trigger if exists trg_zz_raci_tabs_membership_changed on company_memberships;
create trigger trg_zz_raci_tabs_membership_changed
after insert or delete on company_memberships
for each row execute function mangorts_raci_tabs_company_changed();

commit;
