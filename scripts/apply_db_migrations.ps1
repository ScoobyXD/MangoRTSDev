param(
  [switch]$DryRun,
  [string]$AwsRegion = "us-west-1",
  [string]$AwsProfile = $(if ($env:AWS_PROFILE) { $env:AWS_PROFILE } else { "mangorts-dev" }),
  [string]$TfvarsPath = "",
  [switch]$SkipCredentialExport,
  [string]$StartAt = $env:DB_MIGRATION_START_AT,
  [string]$StartAfter = $env:DB_MIGRATION_START_AFTER
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($TfvarsPath)) {
  $TfvarsPath = Join-Path $repoRoot "infra/aws-dev/terraform.tfvars"
}
$migrationsDir = Join-Path $repoRoot "backend/db/migrations"

$awsProfileArgs = @()
if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = $AwsProfile.Trim()
  $awsProfileArgs = @("--profile", $AwsProfile)
  $env:AWS_PROFILE = $AwsProfile
}

function Get-TfvarString {
  param(
    [string]$Name,
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing tfvars file: $Path"
  }
  $match = Select-String -Path $Path -Pattern "^\s*$Name\s*=\s*`"([^`"]+)`"" | Select-Object -First 1
  if (-not $match) {
    throw "Missing $Name in $Path"
  }
  return $match.Matches[0].Groups[1].Value
}

function Get-JsonPropertyValue {
  param(
    [object]$Object,
    [string[]]$Names
  )

  foreach ($name in $Names) {
    if ($null -ne $Object.PSObject.Properties[$name]) {
      return [string]$Object.PSObject.Properties[$name].Value
    }
  }
  return ""
}

function First-NonBlank {
  param(
    [AllowNull()]
    [string[]]$Values
  )

  foreach ($value in $Values) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }
  }
  return ""
}

function Export-AwsCredentialEnvironment {
  param([string]$Profile)

  $args = @("configure", "export-credentials", "--format", "process")
  if (-not [string]::IsNullOrWhiteSpace($Profile)) {
    $args += @("--profile", $Profile.Trim())
  }

  $raw = & aws @args
  if ($LASTEXITCODE -ne 0) {
    $profileHint = if ([string]::IsNullOrWhiteSpace($Profile)) { "the default AWS credential chain" } else { "profile '$($Profile.Trim())'" }
    throw "Failed to export AWS credentials from $profileHint. Run 'aws sso login --profile <profile>' first."
  }

  $credentials = $raw | ConvertFrom-Json
  $accessKeyID = Get-JsonPropertyValue -Object $credentials -Names @("AccessKeyId", "AccessKeyID", "AWS_ACCESS_KEY_ID")
  $secretAccessKey = Get-JsonPropertyValue -Object $credentials -Names @("SecretAccessKey", "AWS_SECRET_ACCESS_KEY")
  $sessionToken = Get-JsonPropertyValue -Object $credentials -Names @("SessionToken", "AWS_SESSION_TOKEN")

  if ([string]::IsNullOrWhiteSpace($accessKeyID) -or [string]::IsNullOrWhiteSpace($secretAccessKey)) {
    throw "AWS credential export did not return an access key and secret key."
  }

  $env:AWS_ACCESS_KEY_ID = $accessKeyID
  $env:AWS_SECRET_ACCESS_KEY = $secretAccessKey
  if ([string]::IsNullOrWhiteSpace($sessionToken)) {
    Remove-Item Env:\AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
  } else {
    $env:AWS_SESSION_TOKEN = $sessionToken
  }
}

function Get-SecretStringValue {
  param(
    [string]$SecretID,
    [string[]]$PropertyNames = @()
  )

  if ([string]::IsNullOrWhiteSpace($SecretID)) {
    return ""
  }

  $secret = & aws secretsmanager get-secret-value `
    @awsProfileArgs `
    --region $AwsRegion `
    --secret-id $SecretID.Trim() `
    --query SecretString `
    --output text

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to read secret from Secrets Manager: $SecretID"
  }

  try {
    $json = $secret | ConvertFrom-Json
    $value = Get-JsonPropertyValue -Object $json -Names $PropertyNames
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }
  } catch {
    # Plaintext secrets are valid.
  }
  return $secret.Trim()
}

function ConvertTo-SqlLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

$dbHost = First-NonBlank @($env:DB_HOST)
$dbPort = First-NonBlank @($env:DB_PORT, "5432")
$dbName = First-NonBlank @($env:DB_NAME)
$dbUser = First-NonBlank @($env:DB_USER)
$dbPassword = First-NonBlank @($env:PGPASSWORD, $env:DB_PASSWORD)

if ([string]::IsNullOrWhiteSpace($dbHost)) {
  $dbHost = Get-TfvarString -Name "existing_db_host" -Path $TfvarsPath
}
if ([string]::IsNullOrWhiteSpace($dbName)) {
  $dbName = Get-TfvarString -Name "existing_db_name" -Path $TfvarsPath
}
if ([string]::IsNullOrWhiteSpace($dbUser)) {
  $dbUser = Get-TfvarString -Name "existing_db_user" -Path $TfvarsPath
}
if ([string]::IsNullOrWhiteSpace($dbPassword)) {
  if (-not $SkipCredentialExport) {
    $hasEnvCredentials = -not [string]::IsNullOrWhiteSpace($env:AWS_ACCESS_KEY_ID) -and -not [string]::IsNullOrWhiteSpace($env:AWS_SECRET_ACCESS_KEY)
    if ($AwsProfile -or -not $hasEnvCredentials) {
      Export-AwsCredentialEnvironment -Profile $AwsProfile
    }
  }

  $dbPasswordSecretArn = Get-TfvarString -Name "existing_db_password_secret_arn" -Path $TfvarsPath
  $dbPassword = Get-SecretStringValue -SecretID $dbPasswordSecretArn -PropertyNames @("password", "DB_PASSWORD", "db_password", "PGPASSWORD")
}

if ([string]::IsNullOrWhiteSpace($dbHost)) { throw "Database host is blank" }
if ([string]::IsNullOrWhiteSpace($dbName)) { throw "Database name is blank" }
if ([string]::IsNullOrWhiteSpace($dbUser)) { throw "Database user is blank" }
if ([string]::IsNullOrWhiteSpace($dbPassword)) { throw "Database password is blank" }

if ($dbHost.StartsWith("host=")) {
  $dbHost = $dbHost.Substring(5)
}
$env:PGPASSWORD = $dbPassword.Trim()
$env:PGSSLMODE = First-NonBlank @($env:PGSSLMODE, $env:DB_SSLMODE, "require")

$startAt = if ($StartAt) { $StartAt.Trim() } else { "" }
$startAfter = if ($StartAfter) { $StartAfter.Trim() } else { "" }

function Invoke-Psql {
  param([string[]]$Arguments)
  & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Target DB host: $dbHost"
Write-Host "Target DB name: $dbName"
Write-Host "Target DB user: $dbUser"
if ($AwsProfile) {
  Write-Host "AWS profile: $AwsProfile"
}

Invoke-Psql -Arguments @(
  "-v", "ON_ERROR_STOP=1",
  "-c", "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now());"
)

$appliedRaw = & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -At -c "select version from schema_migrations;"
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
  $versionLiteral = ConvertTo-SqlLiteral -Value $migration.Name
  Invoke-Psql -Arguments @(
    "-v", "ON_ERROR_STOP=1",
    "-c", "insert into schema_migrations(version) values ($versionLiteral) on conflict (version) do nothing;"
  )
}

Write-Host "Database migrations applied."
