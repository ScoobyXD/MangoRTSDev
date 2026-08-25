[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("EmptyAudit", "Bootstrap", "Parity")]
  [string]$Phase,
  [string]$EmptyDatabaseAuditTaskArn = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = "C:\tmp\mangorts-qa-schema-gate-371695f4"
if (-not (Test-Path -LiteralPath $repositoryRoot -PathType Container)) {
  throw "STOP: exact-commit QA schema-gate checkout is missing: $repositoryRoot"
}
Set-Location -LiteralPath $repositoryRoot

$expectedGitCommit = "371695f4a81f59c89881af76d681d9214098601d"
$actualGitCommit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualGitCommit -cne $expectedGitCommit) {
  throw "STOP: schema-gate checkout changed. Expected $expectedGitCommit but found $actualGitCommit."
}
$expectedLauncherSHA256 = "7a06548f71c722ee1c165fdb3959f4d1dbbadd644e8379d76e7b7298e2493733"
$worktreeChanges = @(& git status --porcelain)
if ($worktreeChanges.Count -ne 1 -or $worktreeChanges[0] -cne " M scripts/qa_run_database_task.ps1") {
  throw "STOP: schema-gate checkout has an unexpected working-tree change."
}
$actualLauncherSHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath ".\scripts\qa_run_database_task.ps1").Hash.ToLowerInvariant()
if ($actualLauncherSHA256 -cne $expectedLauncherSHA256) {
  throw "STOP: the reviewed Windows-safe QA launcher patch changed."
}

$commonParameters = @{
  AwsProfile                       = "mangorts-dev"
  AwsRegion                        = "us-west-1"
  ExpectedAwsAccountID             = "686458136219"
  Cluster                          = "mangorts-qa-cluster"
  TaskDefinition                   = "arn:aws:ecs:us-west-1:686458136219:task-definition/mangorts-qa-database-migration:4"
  ContainerName                    = "database-migration"
  DatabaseInstanceIdentifier       = "mangorts-qa-postgres"
  SubnetIDs                        = @(
    "subnet-0c96aa9cdb41d46f7",
    "subnet-0d7cdf9a8970301c1"
  )
  SecurityGroupIDs                 = @("sg-04ebcf8620ffd590e")
  ExpectedRepositorySchemaSHA256   = "ad3e7ca18de0abf48b9a99723071941e6abbce73fbd0e804ead67633c2ed52d5"
  ExpectedGitCommit                = $expectedGitCommit
  Execute                          = $true
  HumanOperatorApproval            = $true
}

$gateScript = Join-Path $repositoryRoot "scripts\qa_run_database_task.ps1"
switch ($Phase) {
  "EmptyAudit" {
    & $gateScript @commonParameters `
      -Action Audit `
      -AuditPurpose EmptyPreflight
  }
  "Bootstrap" {
    if ([string]::IsNullOrWhiteSpace($EmptyDatabaseAuditTaskArn)) {
      throw "Bootstrap requires -EmptyDatabaseAuditTaskArn from the successful EmptyAudit output."
    }
    & $gateScript @commonParameters `
      -Action Bootstrap `
      -EmptyDatabaseAuditTaskArn $EmptyDatabaseAuditTaskArn
  }
  "Parity" {
    & $gateScript @commonParameters `
      -Action Audit `
      -AuditPurpose Parity `
      -ExpectedSchemaInventorySHA256 "d0f0ec9fb855880b2f30abfa09ffbc60a516e5384c05ab490ac8db84bf6ebc8c"
  }
}

if ($LASTEXITCODE -ne 0) {
  throw "QA database gate phase '$Phase' failed."
}
