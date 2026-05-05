param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not $env:DB_HOST) { throw "Set DB_HOST first" }
if (-not $env:DB_PORT) { $env:DB_PORT = "5432" }
if (-not $env:DB_NAME) { throw "Set DB_NAME first" }
if (-not $env:DB_USER) { throw "Set DB_USER first" }
if (-not $env:PGPASSWORD) { throw "Set PGPASSWORD first" }
if (-not $env:PGSSLMODE) { $env:PGSSLMODE = "require" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDir = Join-Path $repoRoot "backend/db/migrations"
$dbHost = $env:DB_HOST.Trim()
if ($dbHost.StartsWith("host=")) {
  $dbHost = $dbHost.Substring(5)
}

$startAt = if ($env:DB_MIGRATION_START_AT) { $env:DB_MIGRATION_START_AT.Trim() } else { "" }
$startAfter = if ($env:DB_MIGRATION_START_AFTER) { $env:DB_MIGRATION_START_AFTER.Trim() } else { "" }

function Invoke-Psql {
  param([string[]]$Arguments)
  & psql -h $dbHost -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed with exit code $LASTEXITCODE"
  }
}

Invoke-Psql -Arguments @(
  "-v", "ON_ERROR_STOP=1",
  "-c", "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now());"
)

$appliedRaw = & psql -h $dbHost -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME -At -c "select version from schema_migrations;"
if ($LASTEXITCODE -ne 0) {
  throw "psql failed with exit code $LASTEXITCODE"
}
$applied = @{}
foreach ($version in $appliedRaw) {
  if ($version) { $applied[$version.Trim()] = $true }
}

$migrations = Get-ChildItem -Path $migrationsDir -Filter "*.sql" | Sort-Object Name
$shouldApply = $startAt -eq "" -and $startAfter -eq ""
$pending = @()

foreach ($migration in $migrations) {
  if ($startAfter -ne "" -and -not $shouldApply) {
    if ($migration.Name -eq $startAfter) { $shouldApply = $true }
    continue
  }
  if ($startAt -ne "" -and -not $shouldApply) {
    if ($migration.Name -eq $startAt) { $shouldApply = $true }
    else { continue }
  }
  if ($applied.ContainsKey($migration.Name)) { continue }
  $pending += $migration
}

if ($pending.Count -eq 0) {
  Write-Host "No pending migrations."
  exit 0
}

Write-Host "Pending migrations:"
foreach ($migration in $pending) {
  Write-Host " - $($migration.Name)"
}

if ($DryRun) {
  Write-Host "Dry run only; no migrations applied."
  exit 0
}

foreach ($migration in $pending) {
  Write-Host "Applying $($migration.Name)..."
  Invoke-Psql -Arguments @("-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", $migration.FullName)
  Invoke-Psql -Arguments @(
    "-v", "ON_ERROR_STOP=1",
    "-v", "version=$($migration.Name)",
    "-c", "insert into schema_migrations(version) values (:'version') on conflict (version) do nothing;"
  )
}

Write-Host "Database migrations applied."
