create table if not exists saved_views (
  company_id uuid not null,
  saved_view_id uuid not null,
  surface text not null,
  principal text not null,
  principal_id uuid not null,
  name text not null,
  groupings jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint saved_views_surface_chk check (surface in ('my_work', 'updates')),
  constraint saved_views_principal_chk check (principal in ('user', 'group')),
  constraint saved_views_name_nonblank_chk check (btrim(name) <> ''),
  constraint saved_views_groupings_array_chk check (jsonb_typeof(groupings) = 'array'),
  primary key (company_id, saved_view_id),
  foreign key (company_id) references companies(company_id) on delete cascade
);

create index if not exists idx_saved_views_surface_principal_position
  on saved_views(company_id, surface, principal, principal_id, position, saved_view_id);

create index if not exists idx_saved_views_group_principal
  on saved_views(company_id, principal_id)
  where principal = 'group';

