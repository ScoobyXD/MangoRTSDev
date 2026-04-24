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
       to_regclass('public.node_information') as node_information,
       to_regclass('public.logic_gates') as logic_gates,
       to_regclass('public.operations') as operations;

select conname
from pg_constraint
where conname in ('node_relationships_position_pair_chk', 'node_relationships_not_self_chk')
order by conname;

do $$
begin
  if to_regclass('public.nodes') is null
     or to_regclass('public.node_information') is null
     or to_regclass('public.logic_gates') is null
     or to_regclass('public.operations') is null then
    raise exception 'canonical schema tables are missing; run apply_canonical_schema first';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'node_relationships_position_pair_chk') then
    raise exception 'missing constraint node_relationships_position_pair_chk; run apply_node_relationship_guards';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'node_relationships_not_self_chk') then
    raise exception 'missing constraint node_relationships_not_self_chk; run apply_node_relationship_guards';
  end if;
end $$;
'@

psql -h $dbHost -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME --set=sslmode=require -v ON_ERROR_STOP=1 -c $query
if ($LASTEXITCODE -ne 0) {
  throw "psql failed with exit code $LASTEXITCODE"
}

Write-Host "✅ DB connectivity, canonical tables, and node relationship guards verified"
