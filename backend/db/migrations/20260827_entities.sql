begin;

drop table entity_field_assignments;
drop table entity_fields;

create table entity_types (
  company_id uuid not null,
  entity_type_id uuid not null,
  name varchar(200) not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entity_types_name_nonblank_chk check (btrim(name) <> ''),
  primary key (company_id, entity_type_id),
  foreign key (company_id) references companies(company_id) on delete cascade
);

create unique index idx_entity_types_company_name_unique
  on entity_types(company_id, lower(btrim(name)));

create table entity_folders (
  company_id uuid not null,
  entity_folder_id uuid not null,
  entity_type_id uuid not null,
  parent_entity_folder_id uuid,
  name varchar(200) not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entity_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint entity_folders_position_chk check (position >= 0),
  constraint entity_folders_not_self_parent_chk check (parent_entity_folder_id is null or parent_entity_folder_id <> entity_folder_id),
  primary key (company_id, entity_folder_id),
  unique (company_id, entity_type_id, entity_folder_id),
  foreign key (company_id, entity_type_id) references entity_types(company_id, entity_type_id) on delete cascade,
  foreign key (company_id, entity_type_id, parent_entity_folder_id)
    references entity_folders(company_id, entity_type_id, entity_folder_id)
);

create index idx_entity_folders_type_parent_position
  on entity_folders(company_id, entity_type_id, parent_entity_folder_id, position, lower(name), entity_folder_id);

create table entity_field_types (
  company_id uuid not null,
  entity_field_type_id uuid not null,
  entity_type_id uuid not null,
  entity_folder_id uuid,
  name varchar(200) not null,
  field_type text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entity_field_types_name_nonblank_chk check (btrim(name) <> ''),
  constraint entity_field_types_field_type_chk check (field_type in ('text', 'number', 'date', 'boolean')),
  constraint entity_field_types_position_chk check (position >= 0),
  primary key (company_id, entity_field_type_id),
  foreign key (company_id, entity_type_id) references entity_types(company_id, entity_type_id) on delete cascade,
  foreign key (company_id, entity_type_id, entity_folder_id)
    references entity_folders(company_id, entity_type_id, entity_folder_id) on delete cascade
);

create unique index idx_entity_field_types_root_name_unique
  on entity_field_types(company_id, entity_type_id, lower(btrim(name)))
  where entity_folder_id is null;

create unique index idx_entity_field_types_folder_name_unique
  on entity_field_types(company_id, entity_type_id, entity_folder_id, lower(btrim(name)))
  where entity_folder_id is not null;

create index idx_entity_field_types_scope_position
  on entity_field_types(company_id, entity_type_id, entity_folder_id, position, lower(name), entity_field_type_id);

create table entities (
  company_id uuid not null,
  entity_id uuid not null,
  entity_type_id uuid not null,
  entity_folder_id uuid,
  name varchar(200) not null,
  position integer not null default 0,
  body_json jsonb not null default '{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}'::jsonb,
  revision bigint not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entities_name_nonblank_chk check (btrim(name) <> ''),
  constraint entities_position_chk check (position >= 0),
  constraint entities_revision_chk check (revision >= 0),
  constraint entities_body_json_chk check (
    body_json->>'format' = 'mango-tiptap-json'
    and body_json->>'schema_version' = '1'
    and body_json->'document'->>'type' = 'doc'
    and jsonb_typeof(body_json->'annotations') = 'array'
  ),
  primary key (company_id, entity_id),
  foreign key (company_id, entity_type_id) references entity_types(company_id, entity_type_id),
  foreign key (company_id, entity_type_id, entity_folder_id)
    references entity_folders(company_id, entity_type_id, entity_folder_id)
);

create index idx_entities_type_folder_position
  on entities(company_id, entity_type_id, entity_folder_id, position, lower(name), entity_id);

create index idx_entities_name_trgm
  on entities using gin (lower(name) gin_trgm_ops);

create table entity_fields (
  company_id uuid not null,
  entity_field_id uuid not null,
  entity_id uuid not null,
  name varchar(200) not null,
  field_type text not null,
  value_jsonb jsonb,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint entity_fields_name_nonblank_chk check (btrim(name) <> ''),
  constraint entity_fields_field_type_chk check (field_type in ('text', 'number', 'date', 'boolean')),
  constraint entity_fields_position_chk check (position >= 0),
  constraint entity_fields_value_shape_chk check (
    value_jsonb is null
    or (field_type in ('text', 'date') and jsonb_typeof(value_jsonb) = 'string')
    or (field_type = 'number' and jsonb_typeof(value_jsonb) = 'number')
    or (field_type = 'boolean' and jsonb_typeof(value_jsonb) = 'boolean')
  ),
  primary key (company_id, entity_field_id),
  foreign key (company_id, entity_id) references entities(company_id, entity_id) on delete cascade
);

create unique index idx_entity_fields_entity_name_unique
  on entity_fields(company_id, entity_id, lower(btrim(name)));

create index idx_entity_fields_entity_position
  on entity_fields(company_id, entity_id, position, lower(name), entity_field_id);

commit;
