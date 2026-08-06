create table pin_folders (
  folder_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
  parent_folder_id uuid,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint pin_folders_name_nonblank_chk check (btrim(name) <> ''),
  constraint pin_folders_not_self_parent_chk check (parent_folder_id is distinct from folder_id),
  primary key (folder_id),
  unique (company_id, user_id, folder_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  foreign key (company_id, user_id, parent_folder_id) references pin_folders(company_id, user_id, folder_id) on delete cascade
);

create index idx_pin_folders_owner_parent_position
  on pin_folders(company_id, user_id, parent_folder_id, position, created_timestamp, folder_id);

alter table pins
  add column parent_folder_id uuid;

alter table pins
  add constraint pins_parent_folder_fk
  foreign key (company_id, user_id, parent_folder_id)
  references pin_folders(company_id, user_id, folder_id)
  on delete cascade;

drop index if exists idx_pins_user_position;

create index idx_pins_owner_parent_position
  on pins(company_id, user_id, parent_folder_id, position, created_timestamp, pin_id);
