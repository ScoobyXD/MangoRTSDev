$ErrorActionPreference = "Stop"

# Run in a separate PowerShell process. Discard inherited service configuration
# without reading its values; every credential used below is a synthetic fixture.
$databaseVariables = @("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSLMODE", "PGPASSWORD", "PGSSLMODE")
$discardVariables = $databaseVariables + @(
  "DATABASE_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE",
  "AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "NYLAS_CLIENT_ID", "NYLAS_API_KEY", "NYLAS_API_BASE_URL", "NYLAS_API_KEY_SECRET_ARN", "NYLAS_STATE_SECRET",
  "NYLAS_STATE_SECRET_ARN", "NYLAS_WEBHOOK_SECRET", "NYLAS_WEBHOOK_SECRET_ARN", "NYLAS_GOOGLE_SCOPES", "NYLAS_MICROSOFT_SCOPES",
  "MANGORTS_LOCAL_TUNNEL_URL", "MANGORTS_APP_URL", "MANGORTS_EMAIL_FROM", "MANGORTS_ATTACHMENT_S3_BUCKET",
  "MANGORTS_LOCAL_NYLAS_WEBHOOK_SECRET", "MANGORTS_LOCAL_NYLAS_WEBHOOK_SECRET_ARN"
)
foreach ($name in $discardVariables) {
  [Environment]::SetEnvironmentVariable($name, $null, "Process")
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("mangorts-reset-launcher-" + [guid]::NewGuid().ToString("N"))
$fixtureLauncher = Join-Path $fixtureRoot "scripts/start_local_cognito_backend.ps1"
$fixtureTfvars = Join-Path $fixtureRoot "infra/aws-dev/terraform.tfvars"
$fixtureSecretARN = "arn:aws:secretsmanager:us-west-1:000000000000:secret:fixture-reset-db"
$expectedDatabase = @{
  DB_HOST = "fixture-db.invalid"; DB_PORT = "5432"; DB_NAME = "fixture_database"; DB_USER = "fixture_user"
  DB_PASSWORD = "fixture-password"; DB_SSLMODE = "require"; PGPASSWORD = "fixture-password"; PGSSLMODE = "require"
}
$previousDatabase = @{
  DB_HOST = "previous-fixture-host"; DB_PORT = $null; DB_NAME = "previous-fixture-database"; DB_USER = $null
  DB_PASSWORD = "previous-fixture-password"; DB_SSLMODE = $null; PGPASSWORD = $null; PGSSLMODE = "previous-fixture-ssl"
}

function Assert-Equal {
  param($Actual, $Expected, [string]$Because)
  if ($Actual -cne $Expected) { throw "Assertion failed: $Because" }
}

function Assert-Arguments {
  param([object[]]$Actual, [string[]]$Expected, [string]$Because)
  Assert-Equal ($Actual -join "`0") ($Expected -join "`0") $Because
}

function Assert-DatabaseEnvironment {
  param([hashtable]$Expected)
  foreach ($name in $databaseVariables) {
    Assert-Equal ([Environment]::GetEnvironmentVariable($name, "Process")) $Expected[$name] "database environment $name"
  }
}

function aws {
  $arguments = @($args)
  $global:LauncherCalls.Add([pscustomobject]@{ Command = "aws"; Arguments = $arguments })
  $global:LASTEXITCODE = 0
  $operation = $arguments[0..1] -join " "
  switch ($operation) {
    "sts get-caller-identity" {
      Assert-Arguments $arguments @("sts", "get-caller-identity", "--profile", "mangorts-dev", "--region", "us-west-1", "--output", "json") "SSO check must select the dev profile"
      if ($global:LauncherFailure -in @("stale-sso", "login")) { $global:LASTEXITCODE = 1 }
      return '{"Account":"000000000000"}'
    }
    "sso login" {
      Assert-Arguments $arguments @("sso", "login", "--profile", "mangorts-dev") "SSO login must select the dev profile"
      if ($global:LauncherFailure -eq "login") { $global:LASTEXITCODE = 1 }
      return
    }
    "secretsmanager get-secret-value" {
      Assert-Arguments $arguments @("secretsmanager", "get-secret-value", "--profile", "mangorts-dev", "--region", "us-west-1", "--secret-id", $fixtureSecretARN, "--query", "SecretString", "--output", "text") "only the fixture database secret may be requested"
      if ($global:LauncherFailure -eq "secret") { $global:LASTEXITCODE = 1; return }
      return '{"password":"fixture-password"}'
    }
    "configure export-credentials" {
      if ($global:LauncherReset) { throw "Reset must not export AWS credentials" }
      Assert-Arguments $arguments @("configure", "export-credentials", "--format", "process", "--profile", "mangorts-dev") "normal credential export"
      return '{"AccessKeyId":"fixture-access","SecretAccessKey":"fixture-secret","SessionToken":"fixture-session"}'
    }
    "ecs list-task-definitions" {
      if ($global:LauncherReset) { throw "Reset must not inspect ECS" }
      Assert-Arguments $arguments @("ecs", "list-task-definitions", "--profile", "mangorts-dev", "--region", "us-west-1", "--family-prefix", "fixture-dev-backend", "--sort", "DESC", "--max-items", "1", "--output", "json") "normal ECS lookup"
      return '{"taskDefinitionArns":["fixture-task"]}'
    }
    "ecs describe-task-definition" {
      if ($global:LauncherReset) { throw "Reset must not inspect ECS" }
      Assert-Arguments $arguments @("ecs", "describe-task-definition", "--profile", "mangorts-dev", "--region", "us-west-1", "--task-definition", "fixture-task", "--output", "json") "normal ECS configuration"
      return '{"taskDefinition":{"containerDefinitions":[{"name":"backend","environment":[{"name":"MANGORTS_EMAIL_WORK_QUEUE_URL","value":"https://fixture-queue.invalid"}],"secrets":[]}]}}'
    }
    default { throw "Unexpected AWS operation: $operation" }
  }
}

function go {
  $arguments = @($args)
  $global:LauncherCalls.Add([pscustomobject]@{ Command = "go"; Arguments = $arguments })
  Assert-DatabaseEnvironment $expectedDatabase
  Assert-Equal (Get-Location).Path (Join-Path $fixtureRoot "backend") "Go must run from the fixture backend"
  if ($global:LauncherReset) {
    Assert-Arguments $arguments @("run", "./cmd/mango-process-map-reset", "--company-id", "11111111-1111-1111-1111-111111111111", "--actor-email", "jonathankim829@gmail.com", "--interactive") "reset must use the exact company, actor, and interactive command"
  } else {
    Assert-Arguments $arguments @("run", "./cmd/miraeopus-api") "normal launch must start the API"
    Assert-Equal $env:AUTH_MODE "cognito" "normal auth mode"
    Assert-Equal $env:APP_ENV "local" "normal app environment"
    Assert-Equal $env:ALLOW_INMEMORY_FALLBACK "false" "normal database requirement"
    Assert-Equal $env:MANGORTS_APP_URL "http://fixture-local.invalid" "normal launch must load its local configuration"
    Assert-Equal $env:MANGORTS_EMAIL_WORK_QUEUE_URL "https://fixture-queue.invalid" "normal deployed queue configuration"
  }
  $global:LASTEXITCODE = if ($global:LauncherFailure -eq "go") { 1 } else { 0 }
}

function Get-NetTCPConnection { throw "Launcher fixture must not inspect live processes" }
function Stop-Process { throw "Launcher fixture must not stop processes" }
function Start-Process { throw "Launcher fixture must not start external processes" }

function Invoke-LauncherCase {
  param(
    [string]$Name,
    [hashtable]$Parameters = @{ ResetProcessMap = $true },
    [string]$Failure = "",
    [string]$EnvironmentName = "dev",
    [string]$ExpectedError = "",
    [string[]]$ExpectedCalls
  )
  $global:LauncherCalls = [Collections.Generic.List[object]]::new()
  $global:LauncherFailure = $Failure
  $global:LauncherReset = [bool]$Parameters.ResetProcessMap
  $global:LauncherLocalConfigLoaded = $false
  $global:LASTEXITCODE = 0
  foreach ($environmentVariable in $databaseVariables) {
    [Environment]::SetEnvironmentVariable($environmentVariable, $previousDatabase[$environmentVariable], "Process")
  }
  # These inherited defaults must not select the reset target or cause export.
  $env:AWS_PROFILE = "fixture-other-profile"
  $env:AWS_ACCESS_KEY_ID = "fixture-previous-access"
  $env:AWS_SECRET_ACCESS_KEY = "fixture-previous-secret"
  $env:AWS_SESSION_TOKEN = "fixture-previous-session"
  @"
project_name = "fixture"
environment = "$EnvironmentName"
existing_db_host = "fixture-db.invalid"
existing_db_name = "fixture_database"
existing_db_user = "fixture_user"
existing_db_password_secret_arn = "$fixtureSecretARN"
"@ | Set-Content -LiteralPath $fixtureTfvars
  $previousLocation = (Get-Location).Path
  $failureMessage = ""
  try { & $fixtureLauncher @Parameters *> $null } catch { $failureMessage = $_.Exception.Message + " at " + $_.InvocationInfo.PositionMessage }
  if ($ExpectedError) {
    if ($failureMessage -notlike "*$ExpectedError*") { throw "${Name}: expected error '$ExpectedError', got '$failureMessage'" }
  } elseif ($failureMessage) {
    throw "${Name}: $failureMessage"
  }
  Assert-Equal (Get-Location).Path $previousLocation "$Name must restore the working directory"
  $actualCalls = @($global:LauncherCalls | ForEach-Object {
    if ($_.Command -eq "aws") { $_.Arguments[0..1] -join " " } else { $_.Command }
  })
  Assert-Arguments $actualCalls $ExpectedCalls "$Name command sequence"
  Assert-Equal $global:LauncherLocalConfigLoaded (-not $global:LauncherReset) "$Name local configuration isolation"
  if ($global:LauncherReset) {
    Assert-DatabaseEnvironment $previousDatabase
    Assert-Equal $env:AWS_PROFILE "fixture-other-profile" "$Name must preserve the shell profile"
    Assert-Equal $env:AWS_ACCESS_KEY_ID "fixture-previous-access" "$Name must preserve AWS access key"
    Assert-Equal $env:AWS_SECRET_ACCESS_KEY "fixture-previous-secret" "$Name must preserve AWS secret"
    Assert-Equal $env:AWS_SESSION_TOKEN "fixture-previous-session" "$Name must preserve AWS session"
  }
  Write-Host "PASS $Name"
}

try {
  New-Item -ItemType Directory -Path (Join-Path $fixtureRoot "scripts"), (Join-Path $fixtureRoot "infra/aws-dev"), (Join-Path $fixtureRoot "backend") -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot "scripts/start_local_cognito_backend.ps1") -Destination $fixtureLauncher
  @'
$global:LauncherLocalConfigLoaded = $true
$MangoLocalAppURL = "http://fixture-local.invalid"
'@ | Set-Content -LiteralPath (Join-Path $fixtureRoot "scripts/start_local_cognito_backend.local.ps1")

  Invoke-LauncherCase -Name "active SSO reset" -ExpectedCalls @("sts get-caller-identity", "secretsmanager get-secret-value", "go")
  Invoke-LauncherCase -Name "stale SSO reset" -Failure "stale-sso" -ExpectedCalls @("sts get-caller-identity", "sso login", "secretsmanager get-secret-value", "go")
  Invoke-LauncherCase -Name "failed SSO login" -Failure "login" -ExpectedError "AWS SSO sign-in failed" -ExpectedCalls @("sts get-caller-identity", "sso login")
  Invoke-LauncherCase -Name "failed database secret" -Failure "secret" -ExpectedError "Failed to read secret" -ExpectedCalls @("sts get-caller-identity", "secretsmanager get-secret-value")
  Invoke-LauncherCase -Name "failed reset command" -Failure "go" -ExpectedError "Process Map reset failed" -ExpectedCalls @("sts get-caller-identity", "secretsmanager get-secret-value", "go")
  Invoke-LauncherCase -Name "explicit dev profile" -Parameters @{ ResetProcessMap = $true; AwsProfile = "mangorts-dev" } -ExpectedCalls @("sts get-caller-identity", "secretsmanager get-secret-value", "go")
  Invoke-LauncherCase -Name "reject different profile" -Parameters @{ ResetProcessMap = $true; AwsProfile = "mangorts-prod" } -ExpectedError "only the mangorts-dev AWS profile" -ExpectedCalls @()
  Invoke-LauncherCase -Name "reject non-dev configuration" -EnvironmentName "prod" -ExpectedError "requires the dev database configuration" -ExpectedCalls @()
  Invoke-LauncherCase -Name "reject stopping backend" -Parameters @{ ResetProcessMap = $true; StopExisting = $true } -ExpectedError "without -StopExisting" -ExpectedCalls @()
  Invoke-LauncherCase -Name "normal backend launch" -Parameters @{ AwsProfile = "mangorts-dev"; SkipNylas = $true } -ExpectedCalls @("configure export-credentials", "secretsmanager get-secret-value", "ecs list-task-definitions", "ecs describe-task-definition", "go")
  Write-Host "Process Map launcher tests passed. No external commands or services were called."
} finally {
  $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
  $temporaryDirectory = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedFixture.StartsWith($temporaryDirectory, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedFixture) -notlike "mangorts-reset-launcher-*") {
    throw "Refusing to remove a fixture outside the temporary directory"
  }
  if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
