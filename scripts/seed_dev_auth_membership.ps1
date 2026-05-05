$ErrorActionPreference = "Stop"

if (-not $env:DB_HOST) { throw "Set DB_HOST first" }
if (-not $env:DB_PORT) { $env:DB_PORT = "5432" }
if (-not $env:DB_NAME) { throw "Set DB_NAME first" }
if (-not $env:DB_USER) { throw "Set DB_USER first" }
if (-not $env:PGPASSWORD) { throw "Set PGPASSWORD first" }
if (-not $env:PGSSLMODE) { $env:PGSSLMODE = "require" }
if (-not $env:COGNITO_SUBJECT) { throw "Set COGNITO_SUBJECT first" }
if (-not $env:DEV_COMPANY_ID) { throw "Set DEV_COMPANY_ID first" }
if (-not $env:DEV_COMPANY_NAME) { $env:DEV_COMPANY_NAME = "MangoRTS Dev Company" }
if (-not $env:DEV_USER_EMAIL) { $env:DEV_USER_EMAIL = "" }
if (-not $env:DEV_ROLE) { $env:DEV_ROLE = "owner" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$seedPath = Join-Path $repoRoot "backend/db/seed_dev_auth_membership.sql"
$dbHost = $env:DB_HOST.Trim()
if ($dbHost.StartsWith("host=")) {
  $dbHost = $dbHost.Substring(5)
}

psql `
  -h $dbHost `
  -p $env:DB_PORT `
  -U $env:DB_USER `
  -d $env:DB_NAME `
  -v ON_ERROR_STOP=1 `
  -v "company_id=$env:DEV_COMPANY_ID" `
  -v "company_name=$env:DEV_COMPANY_NAME" `
  -v "cognito_subject=$env:COGNITO_SUBJECT" `
  -v "user_email=$env:DEV_USER_EMAIL" `
  -v "membership_role=$env:DEV_ROLE" `
  -f $seedPath

if ($LASTEXITCODE -ne 0) {
  throw "psql failed with exit code $LASTEXITCODE"
}

Write-Host "Seeded MangoRTS dev company membership."
