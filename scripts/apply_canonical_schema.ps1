$ErrorActionPreference = "Stop"

if (-not $env:DB_HOST) { throw "Set DB_HOST first" }
if (-not $env:DB_PORT) { $env:DB_PORT = "5432" }
if (-not $env:DB_NAME) { throw "Set DB_NAME first" }
if (-not $env:DB_USER) { throw "Set DB_USER first" }
if (-not $env:PGPASSWORD) { throw "Set PGPASSWORD first" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$schemaPath = Join-Path $repoRoot "backend/db/schema.sql"

psql "host=$($env:DB_HOST) port=$($env:DB_PORT) dbname=$($env:DB_NAME) user=$($env:DB_USER) sslmode=require" -v ON_ERROR_STOP=1 -f $schemaPath

Write-Host "✅ canonical schema applied from backend/db/schema.sql"
