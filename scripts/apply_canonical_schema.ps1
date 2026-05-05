$ErrorActionPreference = "Stop"

if (-not $env:DB_HOST) { throw "Set DB_HOST first" }
if (-not $env:DB_PORT) { $env:DB_PORT = "5432" }
if (-not $env:DB_NAME) { throw "Set DB_NAME first" }
if (-not $env:DB_USER) { throw "Set DB_USER first" }
if (-not $env:PGPASSWORD) { throw "Set PGPASSWORD first" }
if (-not $env:PGSSLMODE) { $env:PGSSLMODE = "require" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$schemaPath = Join-Path $repoRoot "backend/db/schema.sql"
$dbHost = $env:DB_HOST.Trim()
if ($dbHost.StartsWith("host=")) {
  $dbHost = $dbHost.Substring(5)
}

psql -h $dbHost -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME -v ON_ERROR_STOP=1 --single-transaction -f $schemaPath
if ($LASTEXITCODE -ne 0) {
  throw "psql failed with exit code $LASTEXITCODE"
}

Write-Host "Canonical schema applied from backend/db/schema.sql"
