-- Keep authenticated profile claims ordered across API servers. Existing users
-- start at migration time so an already-issued stale token cannot rewrite them.
set local lock_timeout = '10s';
set local statement_timeout = '5min';
set local search_path = public, pg_catalog;

alter table public.users
  add column auth_claims_issued_at timestamp with time zone default now() not null;
