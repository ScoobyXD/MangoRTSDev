drop table if exists user_pins;
drop table if exists pins;

create table pins (
  pin_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  name text not null,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  constraint pins_resource_type_chk check (resource_type in ('node', 'logic_gate', 'project')),
  constraint pins_name_nonblank_chk check (btrim(name) <> ''),
  primary key (pin_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade,
  unique (company_id, user_id, resource_type, resource_id)
);

create index idx_pins_user_position
  on pins(company_id, user_id, position, created_timestamp, pin_id);
