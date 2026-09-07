param(
  [string]$AwsRegion = "us-west-1",
  [string]$AwsProfile = $env:AWS_PROFILE,
  [string]$AttachmentS3Bucket = "",
  [string]$CognitoUserPoolID = "us-west-1_g4Iavy1aU",
  [string]$CognitoClientID = "2a3i1n88t0jl9crll68tds4fhe",
  [string]$AllowedOrigin = "http://localhost:5173",
  [string]$AppURL = "",
  [string]$EmailFrom = "",
  [string]$NylasRedirectURI = "http://localhost:8080/nylas/oauth/callback",
  [string]$NylasFrontendRedirectURL = "http://localhost:5173/communications",
  [string]$HermesCompanyID = "",
  [string]$HermesEmail = "",
  [switch]$RepairHermesHistory,
  [switch]$SkipCredentialExport,
  [switch]$SkipNylas,
  [switch]$StopExisting,
  [switch]$ResetProcessMap
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$localConfigPath = Join-Path $PSScriptRoot "start_local_cognito_backend.local.ps1"
$tfvarsPath = Join-Path $repoRoot "infra/aws-dev/terraform.tfvars"
if (-not (Test-Path -LiteralPath $tfvarsPath)) {
  throw "Missing infra/aws-dev/terraform.tfvars"
}

$MangoLocalTunnelURL = ""
$MangoLocalAppURL = ""
$MangoLocalEmailFrom = ""
$MangoLocalNylasClientID = ""
$MangoLocalNylasAPIBaseURL = ""
$MangoLocalNylasAPIKeySecretArn = ""
$MangoLocalNylasStateSecretArn = ""
$MangoLocalNylasWebhookSecret = ""
$MangoLocalNylasWebhookSecretArn = ""
$MangoLocalHermesCompanyID = ""
$MangoLocalHermesEmail = ""
if (-not $ResetProcessMap -and (Test-Path -LiteralPath $localConfigPath)) {
  . $localConfigPath
}
if ($MangoLocalNylasWebhookSecret -eq "<local-webhook-secret>") {
  $MangoLocalNylasWebhookSecret = ""
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

function Set-LocalDatabaseEnvironment {
  $dbHost = Get-TfvarString -Name "existing_db_host" -Path $tfvarsPath
  $dbName = Get-TfvarString -Name "existing_db_name" -Path $tfvarsPath
  $dbUser = Get-TfvarString -Name "existing_db_user" -Path $tfvarsPath
  $dbPasswordSecretArn = Get-TfvarString -Name "existing_db_password_secret_arn" -Path $tfvarsPath
  $dbPassword = Get-SecretStringValue -SecretID $dbPasswordSecretArn -PropertyNames @("password", "DB_PASSWORD", "db_password", "PGPASSWORD")

  $env:DB_HOST = $dbHost
  $env:DB_PORT = "5432"
  $env:DB_NAME = $dbName
  $env:DB_USER = $dbUser
  $env:DB_PASSWORD = $dbPassword.Trim()
  $env:DB_SSLMODE = "require"
  $env:PGPASSWORD = $env:DB_PASSWORD
  $env:PGSSLMODE = $env:DB_SSLMODE
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
    throw "Unable to list the deployed DEV backend task definition. Run aws sso login for the selected profile and verify ECS read access."
  }

  $list = $raw | ConvertFrom-Json
  $taskDefinitionArn = @($list.taskDefinitionArns | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)[0]
  if ([string]::IsNullOrWhiteSpace($taskDefinitionArn)) {
    throw "No deployed DEV backend task definition was found for $family."
  }

  $taskRaw = & aws ecs describe-task-definition `
    @awsProfileArgs `
    --region $AwsRegion `
    --task-definition $taskDefinitionArn `
    --output json

  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read the deployed DEV backend task definition. Run aws sso login for the selected profile and verify ECS read access."
  }

  $task = $taskRaw | ConvertFrom-Json
  $container = @($task.taskDefinition.containerDefinitions | Where-Object { $_.name -eq "backend" } | Select-Object -First 1)[0]
  if ($null -eq $container) {
    throw "The deployed DEV backend task definition has no backend container."
  }
  return $container
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

if ($ResetProcessMap) {
  if ($PSBoundParameters.ContainsKey("AwsProfile") -and $AwsProfile.Trim() -ne "mangorts-dev") {
    throw "The Process Map reset uses only the mangorts-dev AWS profile."
  }
  $AwsProfile = "mangorts-dev"
  if ((Get-OptionalTfvarString -Name "environment" -Path $tfvarsPath -Default "dev") -ne "dev") {
    throw "The Process Map reset requires the dev database configuration."
  }
  if ($StopExisting) {
    throw "Run -ResetProcessMap without -StopExisting; the backend can keep running."
  }
}

$awsProfileArgs = @()
if (-not [string]::IsNullOrWhiteSpace($AwsProfile)) {
  $AwsProfile = $AwsProfile.Trim()
  $awsProfileArgs = @("--profile", $AwsProfile)
  if (-not $ResetProcessMap) {
    $env:AWS_PROFILE = $AwsProfile
  }
}

if ($ResetProcessMap) {
  Get-Command aws, go -ErrorAction Stop | Out-Null
  $resetSessionReady = & {
    $ErrorActionPreference = "Continue"
    & aws sts get-caller-identity @awsProfileArgs --region $AwsRegion --output json *> $null
    $LASTEXITCODE -eq 0
  }
  if (-not $resetSessionReady) {
    Write-Host "Sign in to the existing mangorts-dev AWS SSO profile to reset the dev map."
    & aws sso login @awsProfileArgs
    if ($LASTEXITCODE -ne 0) {
      throw "AWS SSO sign-in failed. Run this same reset command again after signing in."
    }
  }

  $resetPreviousEnvironment = @{}
  foreach ($name in @("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSLMODE", "PGPASSWORD", "PGSSLMODE")) {
    $resetPreviousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
  }
  try {
    Set-LocalDatabaseEnvironment
    Write-Host "Preparing the original dev company map reset for jonathankim829@gmail.com."
    Push-Location (Join-Path $repoRoot "backend")
    try {
      & go run ./cmd/mango-process-map-reset --company-id 11111111-1111-1111-1111-111111111111 --actor-email jonathankim829@gmail.com --interactive
      if ($LASTEXITCODE -ne 0) {
        throw "Process Map reset failed. See the command's message above."
      }
    } finally {
      Pop-Location
    }
  } finally {
    foreach ($name in $resetPreviousEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($name, $resetPreviousEnvironment[$name], "Process")
    }
  }
  return
}

$hermesSettings = $null
$hermesServiceCredentials = $null
$hermesDocker = $null
$HermesCompanyID = First-NonBlank @($HermesCompanyID, $MangoLocalHermesCompanyID)
$HermesEmail = First-NonBlank @($HermesEmail, $MangoLocalHermesEmail)
if ($RepairHermesHistory -and -not ($HermesCompanyID -or $HermesEmail)) {
  throw "Configure a Mango Hermes account before using -RepairHermesHistory. See docs/setup/hermes-local.md."
}
if ($HermesCompanyID -or $HermesEmail) {
  if ($AwsProfile -ne 'mangorts-dev' -or $AwsRegion -ne 'us-west-1' -or
      (Get-OptionalTfvarString -Name 'environment' -Path $tfvarsPath -Default 'dev') -ne 'dev') {
    throw "Local Hermes startup uses only mangorts-dev in us-west-1 with the dev database configuration."
  }
  . (Join-Path $PSScriptRoot 'local_hermes.ps1')
  # Check local prerequisites before fetching application credentials or stopping the API.
  $hermesDocker = Get-LocalHermesDocker
  if (-not $HermesEmail) { $HermesEmail = Read-Host 'Email you use to sign into Mango' }
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

Set-LocalDatabaseEnvironment

if ($null -ne $hermesDocker) {
  $hermesScope = Resolve-LocalHermesScope -Email $HermesEmail -CompanyID $HermesCompanyID -RepairHermesHistory:$RepairHermesHistory
  $hermesSettings = Get-LocalHermesSettings -CompanyID $hermesScope.CompanyID -UserID $hermesScope.UserID `
    -Profiles $hermesScope.Profiles -ActiveRunCount $hermesScope.ActiveRunCount -HistoryRepairs $hermesScope.HistoryRepairs -Docker $hermesDocker
  $hermesServiceCredentials = Get-LocalHermesServiceCredentials -Path $hermesSettings.CredentialsPath `
    -RequireExisting:$hermesSettings.RequireExistingCredentials
  Write-Host "Hermes account: $($hermesScope.Email), company: $($hermesScope.CompanyName)"
  if ($RepairHermesHistory) { Write-Host "Hermes history repair: $($hermesScope.HistoryRepairs.Count) admitted terminal runs selected for native transcript recovery." }
  if (-not $MangoLocalHermesCompanyID -and -not $PSBoundParameters.ContainsKey('HermesCompanyID')) {
    # Save only the validated, nonsecret selection; existing local settings stay intact.
    [IO.File]::AppendAllText($localConfigPath, "`r`n`$MangoLocalHermesCompanyID = '$($hermesScope.CompanyID)'`r`n", (New-Object Text.UTF8Encoding($false)))
  }
}

$projectName = Get-OptionalTfvarString -Name "project_name" -Path $tfvarsPath -Default "mangorts"
$environmentName = Get-OptionalTfvarString -Name "environment" -Path $tfvarsPath -Default "dev"
$tfvarsEmailFrom = Get-OptionalTfvarString -Name "email_from_address" -Path $tfvarsPath
$localEmailFromCandidate = First-NonBlank @(
  $EmailFrom,
  $env:MANGORTS_EMAIL_FROM,
  $MangoLocalEmailFrom,
  $tfvarsEmailFrom
)
$backendContainer = Get-LatestBackendContainerDefinition -ProjectName $projectName -EnvironmentName $environmentName

$appURL = First-NonBlank @(
  $AppURL,
  $env:MANGORTS_APP_URL,
  $MangoLocalAppURL,
  $AllowedOrigin
)
$emailFromAddress = First-NonBlank @(
  $EmailFrom,
  $env:MANGORTS_EMAIL_FROM,
  $MangoLocalEmailFrom,
  $tfvarsEmailFrom,
  (Get-ContainerEnvironmentValue -Container $backendContainer -Name "MANGORTS_EMAIL_FROM")
)
$emailWorkQueueURL = Get-ContainerEnvironmentValue -Container $backendContainer -Name "MANGORTS_EMAIL_WORK_QUEUE_URL"
if ([string]::IsNullOrWhiteSpace($emailWorkQueueURL)) {
  throw "The deployed DEV backend task does not provide MANGORTS_EMAIL_WORK_QUEUE_URL. Deploy DEV with email_sqs_enabled=true before starting the cloud-integrated local backend."
}

$nylasClientID = First-NonBlank @(
  $MangoLocalNylasClientID,
  $env:NYLAS_CLIENT_ID,
  (Get-OptionalTfvarString -Name "nylas_client_id" -Path $tfvarsPath),
  (Get-ContainerEnvironmentValue -Container $backendContainer -Name "NYLAS_CLIENT_ID")
)
$nylasAPIBaseURL = First-NonBlank @(
  $MangoLocalNylasAPIBaseURL,
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
  $MangoLocalNylasAPIKeySecretArn,
  $env:NYLAS_API_KEY_SECRET_ARN,
  (Get-OptionalTfvarString -Name "nylas_api_key_secret_arn" -Path $tfvarsPath),
  (Get-ContainerSecretReference -Container $backendContainer -Name "NYLAS_API_KEY")
)
$nylasStateSecretArn = First-NonBlank @(
  $MangoLocalNylasStateSecretArn,
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
$env:MANGORTS_APP_URL = $appURL
$env:MANGORTS_EMAIL_WORK_QUEUE_URL = $emailWorkQueueURL
if ([string]::IsNullOrWhiteSpace($emailFromAddress)) {
  Remove-Item Env:\MANGORTS_EMAIL_FROM -ErrorAction SilentlyContinue
} else {
  $env:MANGORTS_EMAIL_FROM = $emailFromAddress
}

$env:AUTH_MODE = "cognito"
$env:AWS_REGION = $AwsRegion
$attachmentS3BucketName = First-NonBlank @(
  $AttachmentS3Bucket,
  $env:MANGORTS_ATTACHMENT_S3_BUCKET,
  "mangorts-dev-attachments"
)
if ([string]::IsNullOrWhiteSpace($attachmentS3BucketName)) {
  Remove-Item Env:\MANGORTS_ATTACHMENT_S3_BUCKET -ErrorAction SilentlyContinue
  Remove-Item Env:\MANGORTS_ATTACHMENT_AWS_REGION -ErrorAction SilentlyContinue
} else {
  $env:MANGORTS_ATTACHMENT_S3_BUCKET = $attachmentS3BucketName
  $env:MANGORTS_ATTACHMENT_AWS_REGION = $AwsRegion
}
$env:COGNITO_USER_POOL_ID = $CognitoUserPoolID
$env:COGNITO_CLIENT_ID = $CognitoClientID
$env:COGNITO_TOKEN_USE = "access,id"

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
Write-Host "DB host: $env:DB_HOST"
Write-Host "Cognito user pool: $CognitoUserPoolID"
Write-Host "Allowed origin: $AllowedOrigin"
Write-Host "App URL: $appURL"
if ([string]::IsNullOrWhiteSpace($attachmentS3BucketName)) {
  Write-Host "Attachment S3 bucket: not configured."
} else {
  Write-Host "Attachment S3 bucket: $attachmentS3BucketName"
}
if ([string]::IsNullOrWhiteSpace($emailFromAddress)) {
  Write-Host "SES invite email: not configured. Set -EmailFrom, `$env:MANGORTS_EMAIL_FROM, `$MangoLocalEmailFrom, or tfvars email_from_address."
} else {
  Write-Host "SES invite email: enabled from $emailFromAddress"
}
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
Write-Host "Email SQS: using the deployed DEV work queue."

$hermesRuntime = $null
$hermesPreviousEnvironment = @{}
try {
  if ($null -ne $hermesSettings) {
    foreach ($name in @('MANGORTS_HERMES_ROUTES', 'MANGORTS_LOCAL_HERMES_API_KEY', 'MANGORTS_LOCAL_HERMES_CALLBACK_KEY')) {
      $hermesPreviousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $hermesOpenAIKey = Get-SecretStringValue `
      -SecretID 'arn:aws:secretsmanager:us-west-1:686458136219:secret:mangorts/dev/openai-api-key-EaABNe' `
      -PropertyNames @('api_key', 'openai_api_key', 'OPENAI_API_KEY')
    try {
      $hermesRuntime = Start-LocalHermes -Settings $hermesSettings -ServiceCredentials $hermesServiceCredentials `
        -OpenAIKey $hermesOpenAIKey -StopExisting:$StopExisting
    } finally { $hermesOpenAIKey = $null; $hermesServiceCredentials = $null }
    Write-Host 'Ctrl+C stops Go; Hermes stays running.'
    Write-Host ('To restart Go in this PowerShell: cd "{0}"; go run ./cmd/miraeopus-api' -f (Join-Path $repoRoot 'backend'))
  } elseif ([string]::IsNullOrWhiteSpace($env:MANGORTS_HERMES_ROUTES)) {
    Write-Host 'Hermes is not configured. One-time setup: docs/setup/hermes-local.md'
  }
  Push-Location (Join-Path $repoRoot "backend")
  try {
    go run ./cmd/miraeopus-api
  } finally { Pop-Location }
} finally {
  if ($null -eq $hermesRuntime) {
    foreach ($name in $hermesPreviousEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($name, $hermesPreviousEnvironment[$name], 'Process')
    }
  }
}
