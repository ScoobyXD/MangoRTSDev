$ErrorActionPreference = "Stop"

if (-not $env:DB_HOST) { throw "Set DB_HOST first" }
if (-not $env:DB_PORT) { $env:DB_PORT = "5432" }
if (-not $env:DB_NAME) { throw "Set DB_NAME first" }
if (-not $env:DB_USER) { throw "Set DB_USER first" }
if (-not $env:PGPASSWORD) { throw "Set PGPASSWORD first" }

$query = @"
select current_database() as db, current_user as role, now() as ts;

select to_regclass('public.nodes') as nodes,
       to_regclass('public.node_information') as node_information,
       to_regclass('public.logic_gates') as logic_gates,
       to_regclass('public.operations') as operations;
"@

psql "host=$($env:DB_HOST) port=$($env:DB_PORT) dbname=$($env:DB_NAME) user=$($env:DB_USER) sslmode=require" -v ON_ERROR_STOP=1 -c $query

Write-Host "✅ DB connectivity and canonical tables verified"
