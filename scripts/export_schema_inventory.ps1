[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("dev", "qa")]
  [string]$EnvironmentLabel,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedHost,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedDatabase,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedReadOnlyUser,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$ConfirmDatabaseEnforcedReadOnlyCredential,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Invoke-ReadOnlyPsql {
  param([string[]]$Arguments)

  $output = & psql @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed. The password was not printed or retrieved by this helper."
  }
  return @($output)
}

if (-not (Get-Command "psql" -ErrorAction SilentlyContinue)) {
  throw "Missing required command: psql"
}
if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
  throw "Missing required command: python"
}
if (-not $ConfirmDatabaseEnforcedReadOnlyCredential) {
  throw "STOP: pass -ConfirmDatabaseEnforcedReadOnlyCredential only after DB_USER and the configured libpq credential source identify the designated database-enforced read-only login."
}

$requiredEnvironment = @("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_SSLMODE", "PGSSLMODE")
foreach ($name in $requiredEnvironment) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "Missing required environment variable: $name"
  }
}
$hasPasswordEnvironment = -not [string]::IsNullOrWhiteSpace($env:PGPASSWORD)
$hasPasswordFileEnvironment = -not [string]::IsNullOrWhiteSpace($env:PGPASSFILE)
if (-not $hasPasswordEnvironment -and -not $hasPasswordFileEnvironment) {
  throw "Missing read-only credential source: set PGPASSWORD privately or point PGPASSFILE at an existing approved file."
}
if (-not $hasPasswordEnvironment -and -not (Test-Path -LiteralPath $env:PGPASSFILE -PathType Leaf)) {
  throw "PGPASSFILE does not identify an existing file."
}
if ($env:DB_HOST -cne $ExpectedHost) {
  throw "DB_HOST does not match -ExpectedHost."
}
if ($env:DB_NAME -cne $ExpectedDatabase) {
  throw "DB_NAME does not match -ExpectedDatabase."
}
if ($env:DB_USER -cne $ExpectedReadOnlyUser) {
  throw "DB_USER does not match -ExpectedReadOnlyUser."
}
if ($env:DB_SSLMODE -cne "require") {
  throw "DB_SSLMODE must be 'require' for a hosted schema export."
}
if ($env:PGSSLMODE -cne "require") {
  throw "PGSSLMODE must be 'require' so psql enforces TLS for a hosted schema export."
}
if ($ExpectedHost -match '(?i)(^|[-_/.])prod(?:cluster)?($|[-_/.])') {
  throw "This dev/QA helper refuses a production-marked host."
}
$environmentHostMarker = if ($EnvironmentLabel -ieq "dev") { "dev(?:cluster)?" } else { [regex]::Escape($EnvironmentLabel) }
if ($ExpectedHost -notmatch "(?i)(^|[-_/.])$environmentHostMarker($|[-_/.])") {
  throw "Expected host must contain a separate '$EnvironmentLabel' environment marker."
}

$repo = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$inventoryQuery = Join-Path $repo "backend/db/schema_inventory.sql"
$packager = Join-Path $repo "scripts/package_schema_inventory_export.py"
foreach ($path in @($inventoryQuery, $packager)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required repository file is missing: $path"
  }
}
if ((Test-Path -LiteralPath $OutputPath) -and -not $Force) {
  throw "Output already exists. Choose a new path or pass -Force: $OutputPath"
}

$preflightSQL = @'
with me as (
  select oid, rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
  from pg_catalog.pg_roles
  where rolname = current_user
), checks as (
  select
    current_user as connected_user,
    current_database() as connected_database,
    current_setting('server_version') as server_version,
    current_setting('server_version_num')::integer as server_version_num,
    current_setting('transaction_read_only')::boolean as transaction_read_only,
    me.rolsuper or me.rolcreatedb or me.rolcreaterole or me.rolreplication or me.rolbypassrls as unsafe_role_attributes,
    has_database_privilege(current_user, current_database(), 'CREATE') as database_create,
    has_database_privilege(current_user, current_database(), 'TEMP') as database_temp,
    exists (select 1 from pg_catalog.pg_database d where d.datdba = me.oid) as owns_database,
    exists (
      select 1 from pg_catalog.pg_namespace n
      where n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
        and has_schema_privilege(current_user, n.oid, 'CREATE')
    ) as schema_create,
    exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
        and c.relkind in ('r', 'p', 'f', 'v', 'm')
        and has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    ) as table_write,
    exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname <> 'information_schema' and n.nspname !~ '^pg_' and c.relkind = 'S'
        and has_sequence_privilege(current_user, c.oid, 'USAGE,UPDATE')
    ) as sequence_write,
    exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname <> 'information_schema' and n.nspname !~ '^pg_' and c.relowner = me.oid
    ) as owns_relation,
    exists (
      select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname <> 'information_schema' and n.nspname !~ '^pg_' and p.proowner = me.oid
    ) as owns_function,
    exists (
      select 1 from pg_catalog.pg_type t
      join pg_catalog.pg_namespace n on n.oid = t.typnamespace
      where n.nspname <> 'information_schema' and n.nspname !~ '^pg_' and t.typowner = me.oid
    ) as owns_type,
    exists (select 1 from pg_catalog.pg_extension e where e.extowner = me.oid) as owns_extension,
    exists (
      select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname <> 'information_schema' and n.nspname !~ '^pg_' and p.prosecdef
        and has_function_privilege(current_user, p.oid, 'EXECUTE')
    ) as executable_security_definer
  from me
)
select json_build_object(
  'connected_user', connected_user,
  'connected_database', connected_database,
  'server_version', server_version,
  'server_version_num', server_version_num,
  'transaction_read_only', transaction_read_only,
  'unsafe_role_attributes', unsafe_role_attributes,
  'database_create', database_create,
  'database_temp', database_temp,
  'owns_database', owns_database,
  'schema_create', schema_create,
  'table_write', table_write,
  'sequence_write', sequence_write,
  'owns_relation', owns_relation,
  'owns_function', owns_function,
  'owns_type', owns_type,
  'owns_extension', owns_extension,
  'executable_security_definer', executable_security_definer
)::text
from checks;
'@

$commonPsqlArguments = @(
  "--no-psqlrc",
  "--no-password",
  "--quiet",
  "--tuples-only",
  "--no-align",
  "--set=ON_ERROR_STOP=1",
  "--host", $env:DB_HOST,
  "--port", $env:DB_PORT,
  "--username", $env:DB_USER,
  "--dbname", $env:DB_NAME
)
$previousPGOptions = $env:PGOPTIONS
$temporaryInventory = [IO.Path]::GetTempFileName()
try {
  $env:PGOPTIONS = "-c default_transaction_read_only=on"
  $preflightRaw = (Invoke-ReadOnlyPsql -Arguments ($commonPsqlArguments + @("--command", $preflightSQL))) -join "`n"
  $preflight = $preflightRaw | ConvertFrom-Json
  if ([string]$preflight.connected_user -cne $ExpectedReadOnlyUser -or [string]$preflight.connected_database -cne $ExpectedDatabase) {
    throw "Connected database identity did not match the approved read-only target."
  }
  if (-not [bool]$preflight.transaction_read_only) {
    throw "STOP: PostgreSQL did not report a read-only transaction."
  }
  if ([int]$preflight.server_version_num -lt 170000 -or [int]$preflight.server_version_num -ge 180000) {
    throw "STOP: hosted schema parity requires PostgreSQL 17.x; connected server reported $($preflight.server_version)."
  }
  foreach ($unsafeCheck in @(
    "unsafe_role_attributes",
    "database_create",
    "database_temp",
    "owns_database",
    "schema_create",
    "table_write",
    "sequence_write",
    "owns_relation",
    "owns_function",
    "owns_type",
    "owns_extension",
    "executable_security_definer"
  )) {
    if ([bool]$preflight.$unsafeCheck) {
      throw "STOP: database login failed the read-only capability check: $unsafeCheck"
    }
  }

  $inventoryOutput = Invoke-ReadOnlyPsql -Arguments ($commonPsqlArguments + @(
    "--file", $inventoryQuery
  ))
  [IO.File]::WriteAllText($temporaryInventory, (($inventoryOutput -join "`n").Trim() + "`n"))

  & python $packager `
    --inventory $temporaryInventory `
    --output $OutputPath `
    --environment $EnvironmentLabel `
    --database ([string]$preflight.connected_database) `
    --user ([string]$preflight.connected_user) `
    --server-version ([string]$preflight.server_version) `
    --server-version-num ([int]$preflight.server_version_num) `
    --repo-root $repo
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to stamp the schema inventory export."
  }
}
finally {
  $env:PGOPTIONS = $previousPGOptions
  if (Test-Path -LiteralPath $temporaryInventory) {
    Remove-Item -LiteralPath $temporaryInventory -Force
  }
}

Write-Host "Read-only schema export complete for $EnvironmentLabel."
Write-Host "Connected PostgreSQL: $($preflight.server_version)"
Write-Host "Output: $OutputPath"
