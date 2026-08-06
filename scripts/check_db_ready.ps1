$ErrorActionPreference = "Stop"

if (-not $env:DB_HOST) { throw "Set DB_HOST first" }
if (-not $env:DB_PORT) { $env:DB_PORT = "5432" }
if (-not $env:DB_NAME) { throw "Set DB_NAME first" }
if (-not $env:DB_USER) { throw "Set DB_USER first" }
if (-not $env:PGPASSWORD) { throw "Set PGPASSWORD first" }
$dbHost = $env:DB_HOST.Trim()
if ($dbHost.StartsWith("host=")) {
  $dbHost = $dbHost.Substring(5)
}

$query = @'
select current_database() as db, current_user as role, now() as ts;

select to_regclass('public.nodes') as nodes,
       to_regclass('public.node_textboxes') as node_textboxes,
       to_regclass('public.node_textbox_chats') as node_textbox_chats,
       to_regclass('public.logic_gates') as logic_gates,
       to_regclass('public.logic_gate_textboxes') as logic_gate_textboxes,
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
     or to_regclass('public.node_textboxes') is null
     or to_regclass('public.node_textbox_chats') is null
     or to_regclass('public.logic_gates') is null
     or to_regclass('public.logic_gate_textboxes') is null
     or to_regclass('public.logic_gate_textboxes_history') is null then
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
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name = 'cognito_status'
  ) then
    raise exception 'missing column invitations.cognito_status; run apply_db_migrations';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name = 'invite_email_status'
  ) then
    raise exception 'missing column invitations.invite_email_status; run apply_db_migrations';
  end if;
end $$;
'@

psql -h $dbHost -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME --set=sslmode=require -v ON_ERROR_STOP=1 -c $query
if ($LASTEXITCODE -ne 0) {
  throw "psql failed with exit code $LASTEXITCODE"
}

Write-Host "✅ DB connectivity, canonical tables, node relationship guards, and Shared Triage schema verified"
