param(
  [string]$Repository = "ScoobyXD/MangoRTSDev",
  [string]$Environment = "production",
  [switch]$DryRun,
  [switch]$PromptForSecrets,

  [string]$AWSRegion = "us-west-1",
  [string]$TFStateBucket,
  [string]$TFStateKey = "mangorts/prod/terraform.tfstate",
  [string]$TFStateRegion = "us-west-1",
  [string]$TFRootDomainName = "mangorts.com",
  [string]$TFAppSubdomain = "",
  [string]$TFApiSubdomain = "api",
  [string]$TFOriginSubdomain = "origin",
  [string]$TFVpcId,
  [string]$TFPublicSubnetIds,
  [string]$TFPrivateSubnetIds = "[]",
  [ValidateSet("true", "false")]
  [string]$TFCreatePrivateEcsSubnets = "false",
  [string]$TFEcsPrivateSubnetCidrs = "[]",
  [ValidateSet("single", "per_az", "none")]
  [string]$TFEcsNatGatewayMode = "single",
  [string]$TFExistingDbHost,
  [int]$TFExistingDbPort = 5432,
  [string]$TFExistingDbName = "mangorts",
  [string]$TFExistingDbUser,
  [string]$TFExistingDbPasswordSecretArn,
  [string]$TFExistingDbPasswordSecretJsonKey = "password",
  [string]$TFExistingDbSecurityGroupId,
  [string]$TFDefaultCompanyId,
  [string]$TFEmailFromAddress = "",
  [string]$TFBootstrapAdminEmails = "",
  [string]$TFBootstrapCompanyName = "180 Snacks",
  [string]$TFNylasClientId = "",
  [string]$TFNylasApiBaseUrl = "https://api.us.nylas.com",
  [string]$TFNylasApiKeySecretArn = "",
  [string]$TFNylasStateSecretArn = "",
  [string]$TFNylasWebhookSecretArn = "",
  [string]$TFNylasGoogleScopes = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.labels",
  [string]$TFNylasMicrosoftScopes = "offline_access User.Read Mail.ReadWrite Mail.Send",
  [string]$TFGithubOwner = "ScoobyXD",
  [string]$TFGithubRepository = "MangoRTSDev",
  [string]$TFGithubBranch = "main",

  [string]$AWSProdDeployRoleArn = $env:AWS_PROD_DEPLOY_ROLE_ARN,
  [string]$ProdOriginVerifySecret = $env:PROD_ORIGIN_VERIFY_SECRET
)

$ErrorActionPreference = "Stop"

function Assert-NonBlank {
  param(
    [string]$Name,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Missing required value: -$Name"
  }
}

function Assert-JsonStringArray {
  param(
    [string]$Name,
    [string]$Value
  )

  Assert-NonBlank -Name $Name -Value $Value
  try {
    $parsed = $Value | ConvertFrom-Json
    $items = if ($parsed -is [array]) { $parsed } else { @($parsed) }
  } catch {
    throw "-$Name must be a JSON string array, for example '[`"subnet-1`",`"subnet-2`"]'."
  }

  foreach ($item in $items) {
    if ($item -isnot [string] -or [string]::IsNullOrWhiteSpace($item)) {
      throw "-$Name must contain only non-empty strings."
    }
  }
}

function ConvertFrom-SecureStringToPlainText {
  param([securestring]$Value)

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

function Invoke-Gh {
  param(
    [string[]]$Arguments,
    [string]$Display
  )

  if ($DryRun) {
    Write-Host "DRY_RUN gh $Display"
    return
  }

  & gh @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "gh command failed: gh $Display"
  }
}

function Set-GitHubVariable {
  param(
    [string]$Name,
    [string]$Value,
    [switch]$SkipWhenBlank
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    if ($SkipWhenBlank) {
      Write-Host "Skipping blank variable $Name"
      return
    }
    throw "Variable $Name is blank."
  }

  if ($DryRun) {
    Write-Host "DRY_RUN gh variable set $Name --repo $Repository --env $Environment <stdin-value>"
    return
  }

  $Value | gh variable set $Name --repo $Repository --env $Environment
  if ($LASTEXITCODE -ne 0) {
    throw "gh variable set failed for $Name"
  }
}

function Set-GitHubSecret {
  param(
    [string]$Name,
    [string]$Value
  )

  Assert-NonBlank -Name $Name -Value $Value

  if ($DryRun) {
    Write-Host "DRY_RUN gh secret set $Name --repo $Repository --env $Environment <redacted-stdin>"
    return
  }

  $Value | gh secret set $Name --repo $Repository --env $Environment
  if ($LASTEXITCODE -ne 0) {
    throw "gh secret set failed for $Name"
  }
}

Assert-NonBlank -Name Repository -Value $Repository
Assert-NonBlank -Name Environment -Value $Environment
Assert-NonBlank -Name TFStateBucket -Value $TFStateBucket
Assert-NonBlank -Name TFRootDomainName -Value $TFRootDomainName
Assert-NonBlank -Name TFVpcId -Value $TFVpcId
Assert-JsonStringArray -Name TFPublicSubnetIds -Value $TFPublicSubnetIds
Assert-JsonStringArray -Name TFPrivateSubnetIds -Value $TFPrivateSubnetIds
Assert-JsonStringArray -Name TFEcsPrivateSubnetCidrs -Value $TFEcsPrivateSubnetCidrs
Assert-NonBlank -Name TFExistingDbHost -Value $TFExistingDbHost
Assert-NonBlank -Name TFExistingDbName -Value $TFExistingDbName
Assert-NonBlank -Name TFExistingDbUser -Value $TFExistingDbUser
Assert-NonBlank -Name TFExistingDbPasswordSecretArn -Value $TFExistingDbPasswordSecretArn
Assert-NonBlank -Name TFExistingDbSecurityGroupId -Value $TFExistingDbSecurityGroupId
Assert-NonBlank -Name TFDefaultCompanyId -Value $TFDefaultCompanyId
Assert-NonBlank -Name AWSProdDeployRoleArn -Value $AWSProdDeployRoleArn

if ($PromptForSecrets -and [string]::IsNullOrWhiteSpace($ProdOriginVerifySecret)) {
  $secure = Read-Host "Paste PROD_ORIGIN_VERIFY_SECRET" -AsSecureString
  $ProdOriginVerifySecret = ConvertFrom-SecureStringToPlainText -Value $secure
}
Assert-NonBlank -Name ProdOriginVerifySecret -Value $ProdOriginVerifySecret

$nylasCoreCount = 0
foreach ($value in @($TFNylasClientId, $TFNylasApiKeySecretArn, $TFNylasStateSecretArn)) {
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    $nylasCoreCount += 1
  }
}
if ($nylasCoreCount -ne 0 -and $nylasCoreCount -ne 3) {
  throw "Set all or none of -TFNylasClientId, -TFNylasApiKeySecretArn, and -TFNylasStateSecretArn."
}
if (-not [string]::IsNullOrWhiteSpace($TFNylasWebhookSecretArn) -and $nylasCoreCount -ne 3) {
  throw "-TFNylasWebhookSecretArn requires the core Nylas values."
}
if ($TFNylasApiBaseUrl -ne "https://api.us.nylas.com" -and $TFNylasApiBaseUrl -ne "https://api.eu.nylas.com") {
  throw "-TFNylasApiBaseUrl must be https://api.us.nylas.com or https://api.eu.nylas.com."
}

if (-not $DryRun) {
  & gh auth status
  if ($LASTEXITCODE -ne 0) {
    throw "gh is not logged in. Run gh auth login, then rerun this script."
  }
}

Invoke-Gh `
  -Arguments @("api", "--method", "PUT", "repos/$Repository/environments/$Environment") `
  -Display "api --method PUT repos/$Repository/environments/$Environment"

$variables = [ordered]@{
  AWS_REGION                                = $AWSRegion
  TF_STATE_BUCKET                           = $TFStateBucket
  TF_STATE_KEY                              = $TFStateKey
  TF_STATE_REGION                           = $TFStateRegion
  TF_ROOT_DOMAIN_NAME                       = $TFRootDomainName
  TF_APP_SUBDOMAIN                          = $TFAppSubdomain
  TF_API_SUBDOMAIN                          = $TFApiSubdomain
  TF_ORIGIN_SUBDOMAIN                       = $TFOriginSubdomain
  TF_VPC_ID                                 = $TFVpcId
  TF_PUBLIC_SUBNET_IDS                      = $TFPublicSubnetIds
  TF_PRIVATE_SUBNET_IDS                     = $TFPrivateSubnetIds
  TF_CREATE_PRIVATE_ECS_SUBNETS             = $TFCreatePrivateEcsSubnets
  TF_ECS_PRIVATE_SUBNET_CIDRS               = $TFEcsPrivateSubnetCidrs
  TF_ECS_NAT_GATEWAY_MODE                   = $TFEcsNatGatewayMode
  TF_EXISTING_DB_HOST                       = $TFExistingDbHost
  TF_EXISTING_DB_PORT                       = [string]$TFExistingDbPort
  TF_EXISTING_DB_NAME                       = $TFExistingDbName
  TF_EXISTING_DB_USER                       = $TFExistingDbUser
  TF_EXISTING_DB_PASSWORD_SECRET_ARN        = $TFExistingDbPasswordSecretArn
  TF_EXISTING_DB_PASSWORD_SECRET_JSON_KEY   = $TFExistingDbPasswordSecretJsonKey
  TF_EXISTING_DB_SECURITY_GROUP_ID          = $TFExistingDbSecurityGroupId
  TF_DEFAULT_COMPANY_ID                     = $TFDefaultCompanyId
  TF_BOOTSTRAP_ADMIN_EMAILS                 = $TFBootstrapAdminEmails
  TF_BOOTSTRAP_COMPANY_NAME                 = $TFBootstrapCompanyName
  TF_GITHUB_OWNER                           = $TFGithubOwner
  TF_GITHUB_REPOSITORY                      = $TFGithubRepository
  TF_GITHUB_BRANCH                          = $TFGithubBranch
}

if (-not [string]::IsNullOrWhiteSpace($TFEmailFromAddress)) {
  $variables.TF_EMAIL_FROM_ADDRESS = $TFEmailFromAddress
}

if ($nylasCoreCount -eq 3) {
  $variables.TF_NYLAS_CLIENT_ID = $TFNylasClientId
  $variables.TF_NYLAS_API_BASE_URL = $TFNylasApiBaseUrl
  $variables.TF_NYLAS_API_KEY_SECRET_ARN = $TFNylasApiKeySecretArn
  $variables.TF_NYLAS_STATE_SECRET_ARN = $TFNylasStateSecretArn
  $variables.TF_NYLAS_GOOGLE_SCOPES = $TFNylasGoogleScopes
  $variables.TF_NYLAS_MICROSOFT_SCOPES = $TFNylasMicrosoftScopes
}
if (-not [string]::IsNullOrWhiteSpace($TFNylasWebhookSecretArn)) {
  $variables.TF_NYLAS_WEBHOOK_SECRET_ARN = $TFNylasWebhookSecretArn
}

foreach ($entry in $variables.GetEnumerator()) {
  Set-GitHubVariable -Name $entry.Key -Value $entry.Value -SkipWhenBlank
}

Set-GitHubSecret -Name "AWS_PROD_DEPLOY_ROLE_ARN" -Value $AWSProdDeployRoleArn
Set-GitHubSecret -Name "PROD_ORIGIN_VERIFY_SECRET" -Value $ProdOriginVerifySecret

Write-Host "GitHub production environment configuration complete for $Repository/$Environment."
