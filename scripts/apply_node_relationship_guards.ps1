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

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationPath = Join-Path $repoRoot "backend/db/migrations/20260424_node_relationship_guards.sql"

psql -h $dbHost -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME --set=sslmode=require -v ON_ERROR_STOP=1 -f $migrationPath
if ($LASTEXITCODE -ne 0) {
  throw "psql failed with exit code $LASTEXITCODE"
}

Write-Host "✅ node relationship guard constraints applied from backend/db/migrations/20260424_node_relationship_guards.sql"
