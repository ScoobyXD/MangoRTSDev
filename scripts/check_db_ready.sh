#!/usr/bin/env bash
set -euo pipefail

: "${DB_HOST:?set DB_HOST}"
: "${DB_PORT:=5432}"
: "${DB_NAME:?set DB_NAME}"
: "${DB_USER:?set DB_USER}"
: "${PGPASSWORD:?set PGPASSWORD}"
DB_HOST="${DB_HOST#host=}"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
select current_database() as db, current_user as role, now() as ts;

select to_regclass('public.nodes') as nodes,
       to_regclass('public.node_information') as node_information,
       to_regclass('public.node_projection_table') as node_projection_table,
       to_regclass('public.logic_gates') as logic_gates,
       to_regclass('public.logic_gate_projection_table') as logic_gate_projection_table,
       to_regclass('public.operations') as operations;

select conname
from pg_constraint
where conname in ('node_relationships_position_pair_chk', 'node_relationships_not_self_chk')
order by conname;

do $$
begin
  if to_regclass('public.nodes') is null
     or to_regclass('public.node_information') is null
     or to_regclass('public.node_projection_table') is null
     or to_regclass('public.logic_gates') is null
     or to_regclass('public.logic_gate_projection_table') is null
     or to_regclass('public.operations') is null then
    raise exception 'canonical schema tables are missing; run apply_canonical_schema first';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'node_relationships_position_pair_chk') then
    raise exception 'missing constraint node_relationships_position_pair_chk; run apply_db_migrations';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'node_relationships_not_self_chk') then
    raise exception 'missing constraint node_relationships_not_self_chk; run apply_db_migrations';
  end if;
end $$;
SQL

echo "✅ DB connectivity, canonical tables, and node relationship guards verified"
