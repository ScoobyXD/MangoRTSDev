create table companies (
  company_id uuid primary key,
  name text not null
);

create table company_explorer_folders (
  company_id uuid not null,
  folder_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key(company_id,folder_id),
  foreign key(company_id) references companies(company_id) on delete cascade,
  foreign key(company_id,parent_folder_id)
    references company_explorer_folders(company_id,folder_id) on delete cascade
);

create table logic_gates (
  company_id uuid not null,
  logic_gate_id uuid not null,
  header text not null,
  created_timestamp timestamptz not null default now(),
  primary key(company_id,logic_gate_id),
  foreign key(company_id) references companies(company_id) on delete cascade
);

create or replace function mangorts_process_map_route_points_valid(p_route_points jsonb)
returns boolean as $$
declare
  point jsonb;
  point_key_count integer;
  x_text text;
  y_text text;
begin
  if p_route_points is null or jsonb_typeof(p_route_points) <> 'array' then return false; end if;
  if jsonb_array_length(p_route_points) > 256 then return false; end if;
  for point in select value from jsonb_array_elements(p_route_points) loop
    if jsonb_typeof(point) <> 'object' then return false; end if;
    select count(*) into point_key_count from jsonb_object_keys(point);
    if not (point ? 'x' and point ? 'y') or point_key_count <> 2
       or jsonb_typeof(point->'x') <> 'number' or jsonb_typeof(point->'y') <> 'number' then return false; end if;
    x_text := point->>'x';
    y_text := point->>'y';
    if x_text !~ '^-?(0|[1-9][0-9]*)$' or y_text !~ '^-?(0|[1-9][0-9]*)$' then return false; end if;
    if x_text::numeric not between -2147483648 and 2147483647
       or y_text::numeric not between -2147483648 and 2147483647 then return false; end if;
  end loop;
  return true;
end;
$$ language plpgsql immutable;

create table process_map_placements (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  map_parent_folder_id uuid,
  grid_x integer not null,
  grid_y integer not null,
  revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint process_map_placements_resource_type_chk
    check(resource_type in ('company_explorer_folder','logic_gate')),
  constraint process_map_placements_root_folder_chk
    check(map_parent_folder_id is not null or resource_type='company_explorer_folder'),
  constraint process_map_placements_parent_not_self_chk
    check(resource_type<>'company_explorer_folder' or map_parent_folder_id is null or map_parent_folder_id<>resource_id),
  constraint process_map_placements_revision_positive_chk check(revision>0),
  constraint process_map_placements_timestamps_chk check(updated_timestamp>=created_timestamp),
  primary key(company_id,resource_type,resource_id),
  foreign key(company_id) references companies(company_id) on delete cascade,
  constraint process_map_placements_company_id_map_parent_folder_id_fkey
    foreign key(company_id,map_parent_folder_id)
    references company_explorer_folders(company_id,folder_id) on delete cascade
);

create index idx_process_map_placements_layer
  on process_map_placements(company_id,map_parent_folder_id,resource_type,resource_id);

create table resource_operational_relationships (
  company_id uuid not null,
  resource_operational_relationship_id uuid not null,
  source_resource_type text not null,
  source_resource_id uuid not null,
  target_resource_type text not null,
  target_resource_id uuid not null,
  created_timestamp timestamptz not null default now(),
  constraint resource_operational_relationships_source_type_chk
    check(source_resource_type in ('company_explorer_folder','logic_gate')),
  constraint resource_operational_relationships_target_type_chk
    check(target_resource_type in ('company_explorer_folder','logic_gate')),
  constraint resource_operational_relationships_not_self_chk
    check(source_resource_type<>target_resource_type or source_resource_id<>target_resource_id),
  primary key(company_id,resource_operational_relationship_id),
  unique(company_id,source_resource_type,source_resource_id,target_resource_type,target_resource_id),
  foreign key(company_id) references companies(company_id) on delete cascade
);

create table process_map_traces (
  company_id uuid not null,
  resource_operational_relationship_id uuid not null,
  route_points jsonb not null default '[]'::jsonb,
  revision bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint process_map_traces_route_points_chk check(mangorts_process_map_route_points_valid(route_points)),
  constraint process_map_traces_revision_positive_chk check(revision>0),
  constraint process_map_traces_timestamps_chk check(updated_timestamp>=created_timestamp),
  primary key(company_id,resource_operational_relationship_id),
  foreign key(company_id,resource_operational_relationship_id)
    references resource_operational_relationships(company_id,resource_operational_relationship_id) on delete cascade
);

create table workspace_read_versions (
  company_id uuid not null,
  scope text not null,
  resource_key text not null default '',
  version bigint not null default 0,
  updated_timestamp timestamptz not null default now(),
  primary key(company_id,scope,resource_key),
  foreign key(company_id) references companies(company_id) on delete cascade
);

create table recycle_bin_items (
  company_id uuid not null,
  recycle_bin_item_id uuid not null,
  object_kind text not null,
  object_id text not null,
  object_label text not null,
  object_folder_kind text,
  restore_payload jsonb not null,
  deleted_by_user_id uuid,
  deleted_timestamp timestamptz not null default now(),
  primary key(company_id,recycle_bin_item_id),
  foreign key(company_id) references companies(company_id) on delete cascade
);

create or replace function trg_validate_process_map_placement()
returns trigger as $$
begin
  return new;
end;
$$ language plpgsql;

create trigger trg_validate_process_map_placement
before insert or update of company_id,resource_type,resource_id,map_parent_folder_id
on process_map_placements
for each row execute function trg_validate_process_map_placement();

create or replace function trg_cleanup_process_map_source_delete()
returns trigger as $$
begin
  return old;
end;
$$ language plpgsql;

create trigger trg_cleanup_process_map_folder_delete
before delete on company_explorer_folders
for each row execute function trg_cleanup_process_map_source_delete();

create trigger trg_cleanup_process_map_logic_gate_delete
before delete on logic_gates
for each row execute function trg_cleanup_process_map_source_delete();

insert into companies(company_id,name)
values ('10000000-0000-4000-8000-000000000001','V3 Process Map migration');

insert into company_explorer_folders(company_id,folder_id,parent_folder_id,name) values
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',null,'Root'),
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Child'),
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','Nested');

insert into logic_gates(company_id,logic_gate_id,header) values
  ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Receive'),
  ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','Ship'),
  ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','Archive');

insert into process_map_placements(
  company_id,resource_type,resource_id,map_parent_folder_id,grid_x,grid_y,revision,
  created_timestamp,updated_timestamp
) values
  ('10000000-0000-4000-8000-000000000001','company_explorer_folder','20000000-0000-4000-8000-000000000001',null,100,200,3,'2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000001','company_explorer_folder','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',10,20,4,'2026-08-01T00:00:01Z','2026-08-01T00:00:01Z'),
  ('10000000-0000-4000-8000-000000000001','logic_gate','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',50,60,5,'2026-08-01T00:00:02Z','2026-08-01T00:00:02Z'),
  ('10000000-0000-4000-8000-000000000001','logic_gate','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',55,62,6,'2026-08-01T00:00:03Z','2026-08-01T00:00:03Z'),
  ('10000000-0000-4000-8000-000000000001','company_explorer_folder','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002',70,80,7,'2026-08-01T00:00:04Z','2026-08-01T00:00:04Z'),
  ('10000000-0000-4000-8000-000000000001','logic_gate','30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',-5,10,8,'2026-08-01T00:00:05Z','2026-08-01T00:00:05Z');

insert into resource_operational_relationships(
  company_id,resource_operational_relationship_id,
  source_resource_type,source_resource_id,target_resource_type,target_resource_id,
  created_timestamp
) values (
  '10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  'logic_gate','30000000-0000-4000-8000-000000000001',
  'logic_gate','30000000-0000-4000-8000-000000000002','2026-08-01T00:00:06Z'
);

insert into process_map_traces(
  company_id,resource_operational_relationship_id,route_points,revision,
  created_timestamp,updated_timestamp
) values (
  '10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  '[{"x":51,"y":61},{"x":54,"y":61}]'::jsonb,9,
  '2026-08-01T00:00:07Z','2026-08-01T00:00:07Z'
);

insert into workspace_read_versions(company_id,scope,resource_key,version,updated_timestamp)
values ('10000000-0000-4000-8000-000000000001','process-map','',7,'2026-08-01T00:00:08Z');

insert into recycle_bin_items(
  company_id,recycle_bin_item_id,object_kind,object_id,object_label,restore_payload,deleted_timestamp
)
select '10000000-0000-4000-8000-000000000001',
       '50000000-0000-4000-8000-000000000001','folder',
       '20000000-0000-4000-8000-000000000001','Legacy Process Map snapshot',
       jsonb_build_object(
         'process_map_placements',(
           select jsonb_agg(to_jsonb(placement) order by resource_type,resource_id)
           from process_map_placements placement
         ),
         'resource_operational_relationships',(
           select jsonb_agg(to_jsonb(relationship) order by resource_operational_relationship_id)
           from resource_operational_relationships relationship
         ),
         'process_map_traces',(
           select jsonb_agg(to_jsonb(trace) order by resource_operational_relationship_id)
           from process_map_traces trace
         )
       ),
       '2026-08-01T00:00:09Z'::timestamptz;
