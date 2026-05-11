param(
  [string]$AwsRegion = "us-west-1",
  [string]$AwsProfile = $env:AWS_PROFILE,
  [string]$CognitoUserPoolID = "us-west-1_g4Iavy1aU",
  [string]$CognitoClientID = "2a3i1n88t0jl9crll68tds4fhe",
  [string]$AllowedOrigin = "http://localhost:5173",
  [string]$NylasRedirectURI = "http://localhost:8080/nylas/oauth/callback",
  [string]$NylasFrontendRedirectURL = "http://localhost:5173/communications",
  [switch]$SkipCredentialExport,
  [switch]$SkipNylas,
  [switch]$StopExisting
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$localConfigPath = Join-Path $PSScriptRoot "start_local_cognito_backend.local.ps1"
$tfvarsPath = Join-Path $repoRoot "infra/aws-dev/terraform.tfvars"
if (-not (Test-Path -LiteralPath $tfvarsPath)) {
  throw "Missing infra/aws-dev/terraform.tfvars"
}

$MangoLocalTunnelURL = ""
$MangoLocalNylasWebhookSecret = ""
$MangoLocalNylasWebhookSecretArn = ""
if (Test-Path -LiteralPath $localConfigPath) {
  . $localConfigPath
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

function Get-OptionalTfvarString {
  param(
    [string]$Name,
    [string]$Path,
    [string]$Default = ""
  )

  $match = Select-String -Path $Path -Pattern "^\s*$Name\s*=\s*`"([^`"]*)`"" | Select-Object -First 1
  if (-not $match) {
    return $Default
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

function Join-URLPath {
  param(
    [string]$BaseURL,
    [string]$Path
  )

  $base = $BaseURL.Trim().TrimEnd("/")
  $pathValue = $Path.Trim()
  if (-not $pathValue.StartsWith("/")) {
    $pathValue = "/" + $pathValue
  }
  return $base + $pathValue
}

function Get-LatestBackendContainerDefinition {
  param(
    [string]$ProjectName,
    [string]$EnvironmentName
  )

  $family = "$ProjectName-$EnvironmentName-backend"
  $raw = & aws ecs list-task-definitions `
    @awsProfileArgs `
    --region $AwsRegion `
    --family-prefix $family `
    --sort DESC `
    --max-items 1 `
    --output json

  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  $list = $raw | ConvertFrom-Json
  $taskDefinitionArn = @($list.taskDefinitionArns | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)[0]
  if ([string]::IsNullOrWhiteSpace($taskDefinitionArn)) {
    return $null
  }

  $taskRaw = & aws ecs describe-task-definition `
    @awsProfileArgs `
    --region $AwsRegion `
    --task-definition $taskDefinitionArn `
    --output json

  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  $task = $taskRaw | ConvertFrom-Json
  return @($task.taskDefinition.containerDefinitions | Where-Object { $_.name -eq "backend" } | Select-Object -First 1)[0]
}

function Get-ContainerEnvironmentValue {
  param(
    [AllowNull()]
    [object]$Container,
    [string]$Name
  )

  if ($null -eq $Container) {
    return ""
  }
  $item = @($Container.environment | Where-Object { $_.name -eq $Name } | Select-Object -First 1)[0]
  if ($null -eq $item) {
    return ""
  }
  return [string]$item.value
}

function Get-ContainerSecretReference {
  param(
    [AllowNull()]
    [object]$Container,
    [string]$Name
  )

  if ($null -eq $Container) {
    return ""
  }
  $item = @($Container.secrets | Where-Object { $_.name -eq $Name } | Select-Object -First 1)[0]
  if ($null -eq $item) {
    return ""
  }
  return [string]$item.valueFrom
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

$localTunnelURL = First-NonBlank @($env:MANGORTS_LOCAL_TUNNEL_URL, $MangoLocalTunnelURL)
if (-not [string]::IsNullOrWhiteSpace($localTunnelURL) -and -not $PSBoundParameters.ContainsKey("NylasRedirectURI")) {
  $NylasRedirectURI = Join-URLPath -BaseURL $localTunnelURL -Path "/nylas/oauth/callback"
}

$dbHost = Get-TfvarString -Name "existing_db_host" -Path $tfvarsPath
$dbName = Get-TfvarString -Name "existing_db_name" -Path $tfvarsPath
$dbUser = Get-TfvarString -Name "existing_db_user" -Path $tfvarsPath
$dbPasswordSecretArn = Get-TfvarString -Name "existing_db_password_secret_arn" -Path $tfvarsPath

$dbPassword = Get-SecretStringValue -SecretID $dbPasswordSecretArn -PropertyNames @("password", "DB_PASSWORD", "db_password", "PGPASSWORD")

$projectName = Get-OptionalTfvarString -Name "project_name" -Path $tfvarsPath -Default "mangorts"
$environmentName = Get-OptionalTfvarString -Name "environment" -Path $tfvarsPath -Default "dev"
$backendContainer = $null
if (-not $SkipNylas) {
  $backendContainer = Get-LatestBackendContainerDefinition -ProjectName $projectName -EnvironmentName $environmentName
}

$nylasClientID = First-NonBlank @(
  $env:NYLAS_CLIENT_ID,
  (Get-OptionalTfvarString -Name "nylas_client_id" -Path $tfvarsPath),
  (Get-ContainerEnvironmentValue -Container $backendContainer -Name "NYLAS_CLIENT_ID")
)
$nylasAPIBaseURL = First-NonBlank @(
  $env:NYLAS_API_BASE_URL,
  (Get-OptionalTfvarString -Name "nylas_api_base_url" -Path $tfvarsPath -Default "https://api.us.nylas.com"),
  (Get-ContainerEnvironmentValue -Container $backendContainer -Name "NYLAS_API_BASE_URL"),
  "https://api.us.nylas.com"
)
$nylasGoogleScopes = First-NonBlank @(
  $env:NYLAS_GOOGLE_SCOPES,
  (Get-OptionalTfvarString -Name "nylas_google_scopes" -Path $tfvarsPath),
  (Get-ContainerEnvironmentValue -Container $backendContainer -Name "NYLAS_GOOGLE_SCOPES")
)
$nylasMicrosoftScopes = First-NonBlank @(
  $env:NYLAS_MICROSOFT_SCOPES,
  (Get-OptionalTfvarString -Name "nylas_microsoft_scopes" -Path $tfvarsPath),
  (Get-ContainerEnvironmentValue -Container $backendContainer -Name "NYLAS_MICROSOFT_SCOPES")
)
$nylasAPIKeySecretArn = First-NonBlank @(
  $env:NYLAS_API_KEY_SECRET_ARN,
  (Get-OptionalTfvarString -Name "nylas_api_key_secret_arn" -Path $tfvarsPath),
  (Get-ContainerSecretReference -Container $backendContainer -Name "NYLAS_API_KEY")
)
$nylasStateSecretArn = First-NonBlank @(
  $env:NYLAS_STATE_SECRET_ARN,
  (Get-OptionalTfvarString -Name "nylas_state_secret_arn" -Path $tfvarsPath),
  (Get-ContainerSecretReference -Container $backendContainer -Name "NYLAS_STATE_SECRET")
)
$nylasWebhookSecretArn = First-NonBlank @(
  $env:NYLAS_WEBHOOK_SECRET_ARN,
  (Get-OptionalTfvarString -Name "nylas_webhook_secret_arn" -Path $tfvarsPath),
  (Get-ContainerSecretReference -Container $backendContainer -Name "NYLAS_WEBHOOK_SECRET")
)

$nylasAPIKey = First-NonBlank @($env:NYLAS_API_KEY)
if ([string]::IsNullOrWhiteSpace($nylasAPIKey) -and -not [string]::IsNullOrWhiteSpace($nylasAPIKeySecretArn)) {
  $nylasAPIKey = Get-SecretStringValue -SecretID $nylasAPIKeySecretArn -PropertyNames @("api_key", "NYLAS_API_KEY", "nylas_api_key")
}
$nylasStateSecret = First-NonBlank @($env:NYLAS_STATE_SECRET)
if ([string]::IsNullOrWhiteSpace($nylasStateSecret) -and -not [string]::IsNullOrWhiteSpace($nylasStateSecretArn)) {
  $nylasStateSecret = Get-SecretStringValue -SecretID $nylasStateSecretArn -PropertyNames @("state_secret", "NYLAS_STATE_SECRET", "nylas_state_secret")
}
$nylasWebhookSecret = First-NonBlank @($env:NYLAS_WEBHOOK_SECRET, $env:MANGORTS_LOCAL_NYLAS_WEBHOOK_SECRET, $MangoLocalNylasWebhookSecret)
$localNylasWebhookSecretArn = First-NonBlank @($env:MANGORTS_LOCAL_NYLAS_WEBHOOK_SECRET_ARN, $MangoLocalNylasWebhookSecretArn)
if ([string]::IsNullOrWhiteSpace($nylasWebhookSecret) -and -not [string]::IsNullOrWhiteSpace($localNylasWebhookSecretArn)) {
  $nylasWebhookSecret = Get-SecretStringValue -SecretID $localNylasWebhookSecretArn -PropertyNames @("webhook_secret", "NYLAS_WEBHOOK_SECRET", "nylas_webhook_secret")
}
if ([string]::IsNullOrWhiteSpace($nylasWebhookSecret) -and [string]::IsNullOrWhiteSpace($localTunnelURL) -and -not [string]::IsNullOrWhiteSpace($nylasWebhookSecretArn)) {
  $nylasWebhookSecret = Get-SecretStringValue -SecretID $nylasWebhookSecretArn -PropertyNames @("webhook_secret", "NYLAS_WEBHOOK_SECRET", "nylas_webhook_secret")
}

$nylasConfigured = -not $SkipNylas `
  -and -not [string]::IsNullOrWhiteSpace($nylasClientID) `
  -and -not [string]::IsNullOrWhiteSpace($nylasAPIKey) `
  -and -not [string]::IsNullOrWhiteSpace($nylasAPIBaseURL) `
  -and -not [string]::IsNullOrWhiteSpace($NylasRedirectURI) `
  -and -not [string]::IsNullOrWhiteSpace($NylasFrontendRedirectURL) `
  -and -not [string]::IsNullOrWhiteSpace($nylasStateSecret)

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

Remove-Item Env:\NYLAS_CLIENT_ID -ErrorAction SilentlyContinue
Remove-Item Env:\NYLAS_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\NYLAS_API_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\NYLAS_REDIRECT_URI -ErrorAction SilentlyContinue
Remove-Item Env:\NYLAS_FRONTEND_REDIRECT_URL -ErrorAction SilentlyContinue
Remove-Item Env:\NYLAS_STATE_SECRET -ErrorAction SilentlyContinue
Remove-Item Env:\NYLAS_WEBHOOK_SECRET -ErrorAction SilentlyContinue
Remove-Item Env:\NYLAS_GOOGLE_SCOPES -ErrorAction SilentlyContinue
Remove-Item Env:\NYLAS_MICROSOFT_SCOPES -ErrorAction SilentlyContinue

if ($nylasConfigured) {
  $env:NYLAS_CLIENT_ID = $nylasClientID
  $env:NYLAS_API_KEY = $nylasAPIKey
  $env:NYLAS_API_BASE_URL = $nylasAPIBaseURL
  $env:NYLAS_REDIRECT_URI = $NylasRedirectURI
  $env:NYLAS_FRONTEND_REDIRECT_URL = $NylasFrontendRedirectURL
  $env:NYLAS_STATE_SECRET = $nylasStateSecret
  if (-not [string]::IsNullOrWhiteSpace($nylasWebhookSecret)) {
    $env:NYLAS_WEBHOOK_SECRET = $nylasWebhookSecret
  }
  if (-not [string]::IsNullOrWhiteSpace($nylasGoogleScopes)) {
    $env:NYLAS_GOOGLE_SCOPES = $nylasGoogleScopes
  }
  if (-not [string]::IsNullOrWhiteSpace($nylasMicrosoftScopes)) {
    $env:NYLAS_MICROSOFT_SCOPES = $nylasMicrosoftScopes
  }
}

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
if ($nylasConfigured) {
  Write-Host "Nylas: configured from local env, tfvars, or deployed ECS secret references."
  Write-Host "Nylas redirect URI: $NylasRedirectURI"
  if (-not [string]::IsNullOrWhiteSpace($localTunnelURL)) {
    Write-Host "Nylas local tunnel: $($localTunnelURL.Trim().TrimEnd('/'))"
    if ([string]::IsNullOrWhiteSpace($nylasWebhookSecret)) {
      Write-Host "Nylas local webhook secret: missing. OAuth works, but local webhook POSTs will be rejected until this is set."
    }
  }
} elseif ($SkipNylas) {
  Write-Host "Nylas: skipped by -SkipNylas."
} else {
  Write-Host "Nylas: not configured. Set tfvars Nylas values, exported NYLAS_* vars, or deploy ECS with Nylas secret references."
}
if ($AwsProfile) {
  Write-Host "AWS profile: $AwsProfile"
}

Push-Location (Join-Path $repoRoot "backend")
try {
  go run ./cmd/miraeopus-api
} finally {
  Pop-Location
}
