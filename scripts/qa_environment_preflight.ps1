[CmdletBinding()]
param(
  [string]$AwsProfile = "mangorts-dev",
  [string]$AwsRegion = "us-west-1",
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d{12}$')]
  [string]$ExpectedAwsAccountID,
  [string]$TerraformDirectory = "",
  [Parameter(Mandatory = $true)]
  [string]$PostgresBin
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($TerraformDirectory)) {
  $TerraformDirectory = Join-Path $repoRoot "infra/aws-qa"
}

function Assert-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Assert-NativeSuccess {
  param([Parameter(Mandatory = $true)][string]$Operation)

  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed with native exit code $LASTEXITCODE"
  }
}

if ([string]::IsNullOrWhiteSpace($AwsProfile) -or $AwsProfile -match '(?i)prod') {
  throw "Refusing a blank or production-named AWS profile: $AwsProfile"
}
if ($AwsRegion -notmatch '^[a-z]{2}-[a-z]+-\d$') {
  throw "AwsRegion is invalid: $AwsRegion"
}

$terraformPath = (Resolve-Path -LiteralPath $TerraformDirectory).Path
$repoPrefix = $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $terraformPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $terraformPath) -ne "aws-qa") {
  throw "TerraformDirectory must be this repository's infra/aws-qa: $terraformPath"
}

$requiredPaths = @(
  (Join-Path $repoRoot "backend/db/schema.sql"),
  (Join-Path $repoRoot "backend/db/migrations"),
  (Join-Path $repoRoot "backend/Dockerfile.migrations"),
  (Join-Path $repoRoot "backend/Dockerfile.qa-copy"),
  (Join-Path $repoRoot "backend/cmd/miraeopus-migrate"),
  (Join-Path $repoRoot "scripts/export_schema_inventory.ps1"),
  (Join-Path $repoRoot "scripts/qa_run_database_task.ps1"),
  (Join-Path $repoRoot "scripts/qa_fargate_copy_entrypoint.sh")
)
foreach ($path in $requiredPaths) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing required QA setup path: $path"
  }
}

foreach ($command in @("aws", "gh", "git", "terraform")) {
  Assert-CommandExists -Name $command
}

$resolvedPostgresBin = (Resolve-Path -LiteralPath $PostgresBin).Path
foreach ($toolName in @("psql.exe", "createdb.exe", "dropdb.exe", "pg_dump.exe", "pg_restore.exe")) {
  $toolPath = Join-Path $resolvedPostgresBin $toolName
  if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) {
    throw "Missing PostgreSQL 17 tool: $toolPath"
  }
  $version = (& $toolPath --version).Trim()
  Assert-NativeSuccess -Operation "read $toolName version"
  if ($version -notmatch 'PostgreSQL\) 17\.') {
    throw "PostgreSQL 17.x is required; got: $version"
  }
}

$identityRaw = & aws sts get-caller-identity `
  --profile $AwsProfile `
  --region $AwsRegion `
  --output json
Assert-NativeSuccess -Operation "read AWS identity"
$identity = $identityRaw | ConvertFrom-Json
if ([string]$identity.Account -cne $ExpectedAwsAccountID) {
  throw "AWS account mismatch. Expected $ExpectedAwsAccountID but got $($identity.Account)."
}

& gh auth status
Assert-NativeSuccess -Operation "verify GitHub authentication"
$repository = (& gh repo view --json nameWithOwner --jq .nameWithOwner).Trim()
Assert-NativeSuccess -Operation "read GitHub repository identity"
if ($repository -cne "ScoobyXD/MangoRTSDev") {
  throw "GitHub repository mismatch: $repository"
}

Write-Host "QA environment preflight passed."
Write-Host "AWS account: $($identity.Account)"
Write-Host "AWS principal: $($identity.Arn)"
Write-Host "AWS region: $AwsRegion"
Write-Host "GitHub repository: $repository"
Write-Host "Terraform root: $terraformPath"
Write-Host "PostgreSQL client root: $resolvedPostgresBin"
