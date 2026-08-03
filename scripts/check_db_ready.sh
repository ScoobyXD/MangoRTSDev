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
       to_regclass('public.company_explorer_folders') as company_explorer_folders,
       to_regclass('public.communications_shared_inbox_folders') as communications_shared_inbox_folders,
       to_regclass('public.communications_shared_inbox_raci_assignments') as communications_shared_inbox_raci_assignments,
       to_regclass('public.user_email_connections') as user_email_connections,
       to_regclass('public.auth_external_identity_deletions') as auth_external_identity_deletions;

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
     or to_regclass('public.logic_gate_projection_table') is null then
    raise exception 'canonical schema tables are missing; run apply_canonical_schema first';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'node_relationships_position_pair_chk') then
    raise exception 'missing constraint node_relationships_position_pair_chk; run apply_db_migrations';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'node_relationships_not_self_chk') then
    raise exception 'missing constraint node_relationships_not_self_chk; run apply_db_migrations';
  end if;
  if to_regclass('public.company_explorer_folders') is null then
    raise exception 'missing table company_explorer_folders; run apply_db_migrations';
  end if;
  if to_regclass('public.communications_shared_inbox_folders') is null then
    raise exception 'missing table communications_shared_inbox_folders; run apply_db_migrations';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.company_explorer_folders'::regclass
      and conname = 'company_explorer_folders_kind_chk'
      and pg_get_constraintdef(oid) not like '%communications%'
  ) then
    raise exception 'company_explorer_folders_kind_chk still allows communications folders; run apply_db_migrations';
  end if;
  if to_regclass('public.communications_shared_inbox_raci_assignments') is null then
    raise exception 'missing table communications_shared_inbox_raci_assignments; run apply_db_migrations';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.resource_permissions'::regclass
      and conname = 'resource_permissions_resource_type_chk'
      and pg_get_constraintdef(oid) like '%shared_triage_folder%'
  ) then
    raise exception 'resource_permissions_resource_type_chk does not allow shared_triage_folder; run apply_db_migrations';
  end if;
  if to_regclass('public.user_email_connections') is null then
    raise exception 'missing table user_email_connections; run apply_db_migrations';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_email_connections'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, account_email)'
  ) then
    raise exception 'user_email_connections primary key is not per account; run apply_db_migrations';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_email_connections'
      and column_name = 'connection_scope'
  ) then
    raise exception 'missing column user_email_connections.connection_scope; run apply_db_migrations';
  end if;
  if to_regclass('public.auth_external_identity_deletions') is null then
    raise exception 'missing table auth_external_identity_deletions; run apply_db_migrations';
  end if;
end $$;
SQL

echo "✅ DB connectivity, canonical tables, node relationship guards, and Shared Triage schema verified"
