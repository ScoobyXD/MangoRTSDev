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
       to_regclass('public.logic_gates') as logic_gates,
       to_regclass('public.operations') as operations;
SQL

echo "✅ DB connectivity and canonical tables verified"
