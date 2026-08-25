[CmdletBinding()]
param(
  [string]$AwsProfile = "mangorts-dev",
  [string]$AwsRegion = "us-west-1",
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d{12}$')]
  [string]$ExpectedAwsAccountID,
  [string]$TerraformDirectory = "",
  [string]$AppDomain = "qa.mangorts.com",
  [string]$ApiDomain = "api.qa.mangorts.com",
  [string]$OriginDomain = "origin.qa.mangorts.com",
  [Parameter(Mandatory = $true)]
  [string]$BootstrapAdminEmail,
  [string]$CompanyName = "Mango QA"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($TerraformDirectory)) {
  $TerraformDirectory = Join-Path $repoRoot "infra/aws-qa"
}

function Assert-CommandExists {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Assert-ExactEmailAddress {
  param(
    [string]$Value,
    [string]$Label
  )

  $candidate = $Value.Trim()
  if ($candidate -eq "" -or $candidate -ne $candidate.ToLowerInvariant()) {
    throw "$Label must be a nonblank lowercase email address."
  }
  if ($candidate.Contains("*") -or $candidate.StartsWith("@")) {
    throw "$Label must be one exact address, not a wildcard or domain."
  }
  try {
    $parsed = [System.Net.Mail.MailAddress]::new($candidate)
  } catch {
    throw "$Label is not a valid email address."
  }
  if ($parsed.Address -cne $candidate) {
    throw "$Label must contain only the exact email address."
  }
}

function Assert-QaDomain {
  param(
    [string]$Value,
    [string]$Label
  )

  $candidate = $Value.Trim().ToLowerInvariant()
  if ($candidate -notmatch '(^|\.)qa\.mangorts\.com$') {
    throw "$Label must be a qa.mangorts.com hostname; got '$Value'."
  }
  if ($candidate -match '(^|\.)(dev|prod)(\.|$)') {
    throw "$Label must not contain a dev or prod environment label."
  }
  return $candidate
}

if ([string]::IsNullOrWhiteSpace($AwsProfile)) {
  throw "AwsProfile is required."
}
if ($AwsProfile -match '(?i)prod') {
  throw "Refusing an AWS profile whose name contains 'prod': $AwsProfile"
}
if ($AwsRegion -notmatch '^[a-z]{2}-[a-z]+-\d$') {
  throw "AwsRegion is invalid: $AwsRegion"
}
if ([string]::IsNullOrWhiteSpace($CompanyName)) {
  throw "CompanyName is required."
}

$normalizedAppDomain = Assert-QaDomain -Value $AppDomain -Label "AppDomain"
$normalizedApiDomain = Assert-QaDomain -Value $ApiDomain -Label "ApiDomain"
$normalizedOriginDomain = Assert-QaDomain -Value $OriginDomain -Label "OriginDomain"
if (@(@($normalizedAppDomain, $normalizedApiDomain, $normalizedOriginDomain) | Sort-Object -Unique).Count -ne 3) {
  throw "AppDomain, ApiDomain, and OriginDomain must be distinct."
}

$BootstrapAdminEmail = $BootstrapAdminEmail.Trim()
Assert-ExactEmailAddress -Value $BootstrapAdminEmail -Label "BootstrapAdminEmail"

$terraformPath = (Resolve-Path -LiteralPath $TerraformDirectory).Path
$repoPrefix = $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $terraformPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "TerraformDirectory must remain inside the MangoRTS repository: $terraformPath"
}
if ((Split-Path -Leaf $terraformPath) -ne "aws-qa") {
  throw "TerraformDirectory must point to infra/aws-qa: $terraformPath"
}

$requiredPaths = @(
  (Join-Path $repoRoot "backend/db/schema.sql"),
  (Join-Path $repoRoot "backend/db/migrations"),
  (Join-Path $repoRoot "backend/Dockerfile.migrations"),
  (Join-Path $repoRoot "backend/cmd/miraeopus-migrate"),
  (Join-Path $repoRoot "scripts/qa_run_database_task.ps1")
)
foreach ($path in $requiredPaths) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing required QA setup path: $path"
  }
}

Assert-CommandExists -Name "aws"
Assert-CommandExists -Name "terraform"
Assert-CommandExists -Name "git"

$identityRaw = & aws sts get-caller-identity `
  --profile $AwsProfile `
  --region $AwsRegion `
  --output json
if ($LASTEXITCODE -ne 0) {
  throw "Unable to read the AWS identity for profile '$AwsProfile'. Run aws sso login --profile $AwsProfile and retry."
}
$identity = $identityRaw | ConvertFrom-Json
if ([string]$identity.Account -cne $ExpectedAwsAccountID) {
  throw "AWS account mismatch. Expected $ExpectedAwsAccountID but profile '$AwsProfile' resolved to $($identity.Account)."
}

Write-Host "QA environment preflight passed."
Write-Host "AWS account: $($identity.Account)"
Write-Host "AWS principal: $($identity.Arn)"
Write-Host "AWS region: $AwsRegion"
Write-Host "Terraform root: $terraformPath"
Write-Host "App/API/origin: $normalizedAppDomain / $normalizedApiDomain / $normalizedOriginDomain"
Write-Host "Bootstrap company: $($CompanyName.Trim())"
Write-Host "Bootstrap admin: $BootstrapAdminEmail"

Write-Host "STOP before terraform apply. Review the saved plan and current monthly cost estimate with Jonat first."
