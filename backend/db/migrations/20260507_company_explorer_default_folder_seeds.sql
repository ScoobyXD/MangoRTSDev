create table if not exists company_explorer_default_folder_seeds (
  company_id uuid not null,
  seed_key text not null,
  created_timestamp timestamptz not null default now(),
  constraint company_explorer_default_folder_seeds_key_nonblank_chk check (btrim(seed_key) <> ''),
  primary key (company_id, seed_key)
);
