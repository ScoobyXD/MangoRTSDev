param(
  [string]$AwsRegion = "us-west-1",
  [string]$AwsProfile = $env:AWS_PROFILE,
  [string]$CognitoUserPoolID = "us-west-1_g4Iavy1aU",
  [string]$CognitoClientID = "2a3i1n88t0jl9crll68tds4fhe",
  [string]$AllowedOrigin = "http://localhost:5173",
  [switch]$SkipCredentialExport,
  [switch]$StopExisting
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$tfvarsPath = Join-Path $repoRoot "infra/aws-dev/terraform.tfvars"
if (-not (Test-Path -LiteralPath $tfvarsPath)) {
  throw "Missing infra/aws-dev/terraform.tfvars"
}

function Get-TfvarString {
  param(
    [string]$Name,
    [string]$Path
  )

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

function Export-AwsCredentialEnvironment {
  param(
    [string]$Profile
  )

  $args = @("configure", "export-credentials", "--format", "process")
  if (-not [string]::IsNullOrWhiteSpace($Profile)) {
    $args += @("--profile", $Profile.Trim())
  }

  $raw = & aws @args
  if ($LASTEXITCODE -ne 0) {
    $profileHint = if ([string]::IsNullOrWhiteSpace($Profile)) { "the default AWS credential chain" } else { "profile '$($Profile.Trim())'" }
    throw "Failed to export AWS credentials from $profileHint. Run 'aws sso login --profile <profile>' or set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY."
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

$awsProfileArgs = @()
if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = $AwsProfile.Trim()
  $awsProfileArgs = @("--profile", $AwsProfile)
  $env:AWS_PROFILE = $AwsProfile
}

if (-not $SkipCredentialExport) {
  $hasEnvCredentials = -not [string]::IsNullOrWhiteSpace($env:AWS_ACCESS_KEY_ID) -and -not [string]::IsNullOrWhiteSpace($env:AWS_SECRET_ACCESS_KEY)
  if ($AwsProfile -or -not $hasEnvCredentials) {
    Export-AwsCredentialEnvironment -Profile $AwsProfile
  } else {
    Write-Host "Using existing AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY from this shell."
  }
}

$dbHost = Get-TfvarString -Name "existing_db_host" -Path $tfvarsPath
$dbName = Get-TfvarString -Name "existing_db_name" -Path $tfvarsPath
$dbUser = Get-TfvarString -Name "existing_db_user" -Path $tfvarsPath
$dbPasswordSecretArn = Get-TfvarString -Name "existing_db_password_secret_arn" -Path $tfvarsPath

$secret = aws secretsmanager get-secret-value `
  @awsProfileArgs `
  --region $AwsRegion `
  --secret-id $dbPasswordSecretArn `
  --query SecretString `
  --output text

$dbPassword = $secret
try {
  $json = $secret | ConvertFrom-Json
  if ($json.password) { $dbPassword = $json.password }
  elseif ($json.DB_PASSWORD) { $dbPassword = $json.DB_PASSWORD }
  elseif ($json.db_password) { $dbPassword = $json.db_password }
  elseif ($json.PGPASSWORD) { $dbPassword = $json.PGPASSWORD }
} catch {
  $dbPassword = $secret
}

$env:APP_ENV = "local"
$env:ALLOW_INMEMORY_FALLBACK = "false"
$env:MANGORTS_ADDR = ":8080"
$env:MANGORTS_ALLOWED_ORIGIN = $AllowedOrigin

$env:AUTH_MODE = "cognito"
$env:AWS_REGION = $AwsRegion
$env:COGNITO_USER_POOL_ID = $CognitoUserPoolID
$env:COGNITO_CLIENT_ID = $CognitoClientID
$env:COGNITO_TOKEN_USE = "access,id"

$env:DB_HOST = $dbHost
$env:DB_PORT = "5432"
$env:DB_NAME = $dbName
$env:DB_USER = $dbUser
$env:DB_PASSWORD = $dbPassword.Trim()
$env:DB_SSLMODE = "require"

if ($StopExisting) {
  $connections = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    if ($connection.OwningProcess -and $connection.OwningProcess -ne $PID) {
      Stop-Process -Id $connection.OwningProcess -Force
    }
  }
}

Write-Host "Starting local MangoRTS API with Cognito auth and Postgres."
Write-Host "DB host: $dbHost"
Write-Host "Cognito user pool: $CognitoUserPoolID"
Write-Host "Allowed origin: $AllowedOrigin"
if ($AwsProfile) {
  Write-Host "AWS profile: $AwsProfile"
}

Push-Location (Join-Path $repoRoot "backend")
try {
  go run ./cmd/miraeopus-api
} finally {
  Pop-Location
}
