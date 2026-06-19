-- Phase 2 cleanup for the GVIC/node-name/review contract.
--
-- This removes active runtime compatibility with the old RACI/RACIO projection
-- and source tables after Phase 1 has copied the data into GVIC tables.

alter table nodes
  drop column if exists status_color,
  drop column if exists assignee_user_id;

alter table if exists kanban_board_projection
  drop column if exists assignee_user_id;

alter table if exists project_relationship_projection
  drop column if exists status_color;

alter table if exists project_management_timeline_projection
  drop column if exists status_color,
  drop column if exists assignee_user_id,
  drop column if exists assignee_display_name,
  drop column if exists assignee_email;

do $$
begin
  if to_regclass('public.racio_matrix_projection_table') is not null
     and to_regclass('public.gvic_matrix_projection_table') is null then
    alter table racio_matrix_projection_table rename to gvic_matrix_projection_table;
  end if;
end
$$;

create table if not exists gvic_matrix_projection_table (
  company_id uuid not null,
  user_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  logic_gate_id uuid,
  display_title text not null default '',
  status text,
  due_date date,
  priority smallint,
  accounts jsonb not null default '[]'::jsonb,
  resource_created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id, user_id, resource_type, resource_id),
  foreign key (company_id) references companies (company_id) on delete cascade,
  foreign key (user_id) references users (user_id) on delete cascade
);

do $$
begin
  if to_regclass('public.racio_matrix_projection_table') is not null then
    insert into gvic_matrix_projection_table (
      company_id,
      user_id,
      resource_type,
      resource_id,
      logic_gate_id,
      display_title,
      status,
      due_date,
      priority,
      accounts,
      resource_created_timestamp,
      updated_timestamp
    )
    select
      company_id,
      user_id,
      resource_type,
      resource_id,
      logic_gate_id,
      display_title,
      status,
      due_date,
      priority,
      accounts,
      resource_created_timestamp,
      updated_timestamp
    from racio_matrix_projection_table
    on conflict (company_id, user_id, resource_type, resource_id)
    do update set
      logic_gate_id = excluded.logic_gate_id,
      display_title = excluded.display_title,
      status = excluded.status,
      due_date = excluded.due_date,
      priority = excluded.priority,
      accounts = excluded.accounts,
      resource_created_timestamp = excluded.resource_created_timestamp,
      updated_timestamp = excluded.updated_timestamp;
  end if;
end
$$;

alter table gvic_matrix_projection_table
  drop column if exists status_color,
  drop column if exists assignee_user_id,
  drop column if exists assignee_display_name,
  drop column if exists assignee_email;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.gvic_matrix_projection_table'::regclass
      and conname = 'racio_matrix_projection_resource_type_chk'
  ) then
    alter table gvic_matrix_projection_table
      rename constraint racio_matrix_projection_resource_type_chk to gvic_matrix_projection_resource_type_chk;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.gvic_matrix_projection_table'::regclass
      and conname = 'racio_matrix_projection_accounts_array_chk'
  ) then
    alter table gvic_matrix_projection_table
      rename constraint racio_matrix_projection_accounts_array_chk to gvic_matrix_projection_accounts_array_chk;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.gvic_matrix_projection_table'::regclass
      and conname = 'racio_matrix_projection_shape_chk'
  ) then
    alter table gvic_matrix_projection_table
      rename constraint racio_matrix_projection_shape_chk to gvic_matrix_projection_shape_chk;
  end if;
end
$$;

alter table gvic_matrix_projection_table
  drop constraint if exists gvic_matrix_projection_resource_type_chk,
  add constraint gvic_matrix_projection_resource_type_chk check (resource_type in ('node', 'logic_gate'));

alter table gvic_matrix_projection_table
  drop constraint if exists gvic_matrix_projection_accounts_array_chk,
  add constraint gvic_matrix_projection_accounts_array_chk check (jsonb_typeof(accounts) = 'array');

alter table gvic_matrix_projection_table
  drop constraint if exists gvic_matrix_projection_shape_chk,
  add constraint gvic_matrix_projection_shape_chk check (
    (resource_type = 'node')
    or (resource_type = 'logic_gate' and logic_gate_id = resource_id)
  );

drop index if exists idx_racio_projection_node_read;
drop index if exists idx_racio_projection_logic_gate_read;
drop index if exists idx_racio_projection_logic_gate_user;
drop index if exists idx_racio_projection_resource;

create index if not exists idx_gvic_matrix_projection_node_read
  on gvic_matrix_projection_table(company_id, user_id, resource_type, logic_gate_id, resource_created_timestamp, resource_id)
  where resource_type = 'node';

create index if not exists idx_gvic_matrix_projection_logic_gate_read
  on gvic_matrix_projection_table(company_id, user_id, resource_type, lower(display_title), resource_id)
  where resource_type = 'logic_gate';

create index if not exists idx_gvic_matrix_projection_logic_gate_user
  on gvic_matrix_projection_table(company_id, logic_gate_id, user_id);

create index if not exists idx_gvic_matrix_projection_resource
  on gvic_matrix_projection_table(company_id, resource_type, resource_id);

drop table if exists racio_matrix_projection_table cascade;
drop table if exists logic_gate_raci_assignments cascade;
drop table if exists resource_raci_assignments cascade;
drop table if exists shared_inbox_raci_assignments cascade;
drop table if exists shared_inbox_raci_group_assignments cascade;

do $$
begin
  if to_regclass('public.projection_versions') is not null then
    update projection_versions
    set projection = 'gvic_matrix'
    where projection = 'racio_matrix';
  end if;
end
$$;

delete from resource_gvic_effective_assignments
where role in ('responsible', 'accountable')
   or source_principal_type = 'assignee';

delete from resource_gvic_assignments
where role in ('responsible', 'accountable');
