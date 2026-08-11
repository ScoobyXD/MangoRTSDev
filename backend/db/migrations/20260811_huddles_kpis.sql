-- Bare-bones Huddles and KPIs. PostgreSQL 17.x compatible.

create table if not exists huddle_logic_gates (
  company_id uuid not null,
  huddle_logic_gate_id uuid not null,
  header text not null,
  body_json jsonb not null default '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb,
  revision bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id,huddle_logic_gate_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  constraint huddle_logic_gates_header_chk check (btrim(header) <> ''),
  constraint huddle_logic_gates_revision_chk check (revision >= 0),
  constraint huddle_logic_gates_body_chk check (
    body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and jsonb_typeof(body_json->'annotations')='array'
  )
);

create table if not exists huddle_nodes (
  company_id uuid not null,
  huddle_node_id uuid not null,
  huddle_logic_gate_id uuid not null,
  name text not null,
  body_json jsonb not null default '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb,
  revision bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id,huddle_node_id),
  foreign key (company_id,huddle_logic_gate_id)
    references huddle_logic_gates(company_id,huddle_logic_gate_id) on delete restrict,
  constraint huddle_nodes_name_chk check (btrim(name) <> ''),
  constraint huddle_nodes_revision_chk check (revision >= 0),
  constraint huddle_nodes_body_chk check (
    body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and jsonb_typeof(body_json->'annotations')='array'
  )
);

create index if not exists idx_huddle_nodes_owner
  on huddle_nodes(company_id,huddle_logic_gate_id,created_timestamp,huddle_node_id);

create table if not exists kpis (
  company_id uuid not null,
  kpi_id uuid not null,
  logic_gate_id uuid not null,
  name text not null,
  body_json jsonb not null default '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb,
  revision bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  deleted_timestamp timestamptz,
  primary key (company_id,kpi_id),
  foreign key (company_id,logic_gate_id) references logic_gates(company_id,logic_gate_id) on delete cascade,
  constraint kpis_name_chk check (btrim(name) <> ''),
  constraint kpis_revision_chk check (revision >= 0),
  constraint kpis_body_chk check (
    body_json->>'format'='mango-tiptap-json'
    and body_json->>'schema_version'='1'
    and body_json->'document'->>'type'='doc'
    and jsonb_typeof(body_json->'annotations')='array'
  )
);

create index if not exists idx_kpis_logic_gate
  on kpis(company_id,logic_gate_id,created_timestamp,kpi_id);

create table if not exists huddle_explorer_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  primary key (company_id,folder_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id,parent_folder_id)
    references huddle_explorer_folders(company_id,folder_id) on delete restrict,
  constraint huddle_explorer_folders_name_chk check (btrim(name) <> ''),
  constraint huddle_explorer_folders_not_self_chk check (parent_folder_id is null or parent_folder_id <> folder_id)
);

create table if not exists huddle_explorer_items (
  company_id uuid not null,
  huddle_explorer_item_id uuid not null,
  resource_huddle_resource_id uuid not null,
  huddle_type text not null,
  parent_folder_id uuid,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  primary key (company_id,huddle_explorer_item_id),
  unique (company_id,huddle_type,resource_huddle_resource_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id,parent_folder_id)
    references huddle_explorer_folders(company_id,folder_id) on delete restrict,
  constraint huddle_explorer_items_huddle_type_chk check (huddle_type in ('huddle_logic_gate','huddle_node'))
);

create index if not exists idx_huddle_explorer_folders_parent
  on huddle_explorer_folders(company_id,parent_folder_id,created_date,folder_id);
create index if not exists idx_huddle_explorer_items_parent
  on huddle_explorer_items(company_id,parent_folder_id,created_date,huddle_explorer_item_id);

create or replace function mangorts_validate_huddle_explorer_folder()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare current_id uuid := new.parent_folder_id; steps integer := 0;
begin
  while current_id is not null loop
    if current_id=new.folder_id then
      raise exception 'huddle_explorer_folder_cycle' using errcode='23514';
    end if;
    select parent_folder_id into current_id
    from huddle_explorer_folders
    where company_id=new.company_id and folder_id=current_id;
    steps := steps + 1;
    if steps > 1000 then raise exception 'huddle_explorer_folder_cycle' using errcode='23514'; end if;
  end loop;
  return new;
end; $$;

drop trigger if exists trg_huddle_explorer_folder_cycle on huddle_explorer_folders;
create trigger trg_huddle_explorer_folder_cycle
before insert or update of parent_folder_id on huddle_explorer_folders
for each row execute function mangorts_validate_huddle_explorer_folder();

create or replace function mangorts_validate_huddle_explorer_item()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.huddle_type='huddle_logic_gate' and not exists(
    select 1 from huddle_logic_gates where company_id=new.company_id and huddle_logic_gate_id=new.resource_huddle_resource_id
  ) then raise exception 'huddle_logic_gate_missing' using errcode='23503'; end if;
  if new.huddle_type='huddle_node' and not exists(
    select 1 from huddle_nodes where company_id=new.company_id and huddle_node_id=new.resource_huddle_resource_id
  ) then raise exception 'huddle_node_missing' using errcode='23503'; end if;
  return new;
end; $$;

drop trigger if exists trg_huddle_explorer_item_validate on huddle_explorer_items;
create trigger trg_huddle_explorer_item_validate
before insert or update of company_id,huddle_type,resource_huddle_resource_id on huddle_explorer_items
for each row execute function mangorts_validate_huddle_explorer_item();

alter table pins drop constraint if exists pins_resource_type_chk;
alter table pins add constraint pins_resource_type_chk
  check (resource_type in ('node','logic_gate','project','huddle_logic_gate','huddle_node'));

alter table recycle_bin_items drop constraint if exists recycle_bin_items_kind_chk;
alter table recycle_bin_items add constraint recycle_bin_items_kind_chk check (object_kind in (
  'folder','node','logic_gate','project','kanban','kpi','huddle_logic_gate','huddle_node','huddle_explorer_folder','huddle_explorer_item'
));

alter table resource_gvic_assignments drop constraint if exists resource_gvic_assignments_resource_type_chk;
alter table resource_gvic_assignments add constraint resource_gvic_assignments_resource_type_chk check (resource_type in (
  'node','logic_gate','project','shared_triage_folder','shared_inbox','huddle_logic_gate','huddle_node'
));
alter table resource_permissions drop constraint if exists resource_permissions_resource_type_chk;
alter table resource_permissions add constraint resource_permissions_resource_type_chk check (resource_type in (
  'node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox','huddle_logic_gate','huddle_node'
));

alter table resource_gvic_settings drop constraint if exists resource_gvic_settings_resource_type_chk;
alter table resource_gvic_settings add constraint resource_gvic_settings_resource_type_chk
  check (resource_type in ('node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox','huddle_logic_gate','huddle_node'));
alter table resource_permission_settings drop constraint if exists resource_permission_settings_resource_type_chk;
alter table resource_permission_settings add constraint resource_permission_settings_resource_type_chk
  check (resource_type in ('node','logic_gate','project','company_explorer_folder','shared_inbox_folder','shared_inbox','huddle_logic_gate','huddle_node'));
create or replace function mangorts_v2_policy_resource_exists(p_company_id uuid,p_resource_type text,p_resource_id uuid)
returns boolean language sql stable set search_path=public,pg_temp as $$
  select case p_resource_type
    when 'node' then exists(select 1 from nodes where company_id=p_company_id and node_id=p_resource_id)
    when 'logic_gate' then exists(select 1 from logic_gates where company_id=p_company_id and logic_gate_id=p_resource_id)
    when 'project' then exists(select 1 from projects where company_id=p_company_id and project_id=p_resource_id)
    when 'company_explorer_folder' then exists(select 1 from company_explorer_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox_folder' then exists(select 1 from shared_inbox_folders where company_id=p_company_id and folder_id=p_resource_id)
    when 'shared_inbox' then exists(select 1 from shared_inboxes where company_id=p_company_id and shared_inbox_id=p_resource_id)
    when 'huddle_logic_gate' then exists(select 1 from huddle_logic_gates where company_id=p_company_id and huddle_logic_gate_id=p_resource_id)
    when 'huddle_node' then exists(select 1 from huddle_nodes where company_id=p_company_id and huddle_node_id=p_resource_id)
    else false end;
$$;
