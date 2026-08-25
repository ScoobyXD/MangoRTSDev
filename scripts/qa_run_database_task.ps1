[CmdletBinding()]
param(
  [ValidateSet("Audit", "Bootstrap")]
  [string]$Action = "Audit",
  [string]$AwsProfile = "mangorts-dev",
  [string]$AwsRegion = "us-west-1",
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d{12}$')]
  [string]$ExpectedAwsAccountID,
  [Parameter(Mandatory = $true)]
  [string]$Cluster,
  [Parameter(Mandatory = $true)]
  [string]$TaskDefinition,
  [Parameter(Mandatory = $true)]
  [string]$ContainerName,
  [Parameter(Mandatory = $true)]
  [string]$DatabaseInstanceIdentifier,
  [Parameter(Mandatory = $true)]
  [string[]]$SubnetIDs,
  [Parameter(Mandatory = $true)]
  [string[]]$SecurityGroupIDs,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{64}$')]
  [string]$ExpectedRepositorySchemaSHA256,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ExpectedGitCommit,
  [string]$ExpectedSchemaInventorySHA256 = "",
  [ValidateSet("EmptyPreflight", "Parity")]
  [string]$AuditPurpose = "Parity",
  [string]$EmptyDatabaseAuditTaskArn = "",
  [switch]$Execute,
  [switch]$HumanOperatorApproval
)

$ErrorActionPreference = "Stop"

function Invoke-AwsJson {
  param([string[]]$Arguments)

  $raw = & aws @Arguments --profile $AwsProfile --region $AwsRegion --output json
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI failed: aws $($Arguments -join ' ')"
  }
  return $raw | ConvertFrom-Json
}

function Assert-QaName {
  param(
    [string]$Value,
    [string]$Label
  )

  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '(?i)(^|[-_/.])qa($|[-_/.])') {
    throw "$Label must contain a separate QA environment marker: $Value"
  }
  if ($Value -match '(?i)(^|[-_/.])prod($|[-_/.])') {
    throw "$Label must not contain a production environment marker: $Value"
  }
}

function Get-QaTaskLogMessages {
  param(
    [object]$TaskRecord,
    [object]$ContainerDefinition
  )

  if ([string]$ContainerDefinition.logConfiguration.logDriver -cne "awslogs") {
    throw "Migration task must use awslogs so its database audit can be reviewed."
  }
  $options = $ContainerDefinition.logConfiguration.options
  $logGroup = [string]$options.'awslogs-group'
  $streamPrefix = [string]$options.'awslogs-stream-prefix'
  if ([string]::IsNullOrWhiteSpace($logGroup) -or [string]::IsNullOrWhiteSpace($streamPrefix)) {
    throw "Migration task awslogs configuration is missing its group or stream prefix."
  }
  $taskID = ([string]$TaskRecord.taskArn).Split('/')[-1]
  $streamName = "$streamPrefix/$ContainerName/$taskID"
  $events = Invoke-AwsJson -Arguments @(
    "logs", "get-log-events",
    "--log-group-name", $logGroup,
    "--log-stream-name", $streamName,
    "--start-from-head",
    "--limit", "10000"
  )
  return @($events.events | ForEach-Object { [string]$_.message })
}

function Assert-EmptyDatabaseAudit {
  param(
    [string]$TaskArn,
    [object]$ExpectedTaskDefinition,
    [object]$ExpectedContainerDefinition,
    [string]$ClusterArn,
    [string]$ExpectedRepositoryDigest
  )

  if ([string]::IsNullOrWhiteSpace($TaskArn)) {
    throw "Bootstrap requires -EmptyDatabaseAuditTaskArn from a completed Audit run."
  }
  $auditResult = Invoke-AwsJson -Arguments @("ecs", "describe-tasks", "--cluster", $ClusterArn, "--tasks", $TaskArn)
  if ($auditResult.failures.Count -gt 0 -or $auditResult.tasks.Count -ne 1) {
    throw "The empty-database audit task was not found in the QA cluster."
  }
  $auditTask = $auditResult.tasks[0]
  if ([string]$auditTask.taskDefinitionArn -cne [string]$ExpectedTaskDefinition.taskDefinitionArn) {
    throw "The empty-database audit used a different task definition."
  }
  if ([string]$auditTask.lastStatus -cne "STOPPED") {
    throw "The empty-database audit task has not stopped."
  }
  $auditContainer = @($auditTask.containers | Where-Object { $_.name -ceq $ContainerName })
  if ($auditContainer.Count -ne 1) {
    throw "The empty-database audit task did not contain the expected migration container."
  }
  if ($null -eq $auditContainer[0].exitCode -or [int]$auditContainer[0].exitCode -ne 0) {
    throw "The empty-database audit task did not complete successfully."
  }
  $auditOverride = @($auditTask.overrides.containerOverrides | Where-Object { $_.name -ceq $ContainerName })
  if ($auditOverride.Count -ne 1 -or (@($auditOverride[0].command) -join ' ') -cne "-mode audit") {
    throw "The supplied task was not a read-only migration audit."
  }
  $messages = Get-QaTaskLogMessages -TaskRecord $auditTask -ContainerDefinition $ExpectedContainerDefinition
  if (-not ($messages | Where-Object { $_ -match 'server_version_num=17\d{4}(?:\s|$)' })) {
    throw "STOP: the connected PostgreSQL audit did not report a supported 17.x server_version_num."
  }
  if (-not ($messages | Where-Object { $_ -match 'public_tables=0(?:\s|$)' })) {
    throw "The audit log did not prove public_tables=0. Do not bootstrap this database."
  }
  Assert-AuditDigest `
    -Messages $messages `
    -FieldName "repository_schema_sha256" `
    -ExpectedDigest $ExpectedRepositoryDigest
  Write-Host "Verified empty-database audit: $TaskArn"
}

function Assert-AuditDigest {
  param(
    [string[]]$Messages,
    [string]$FieldName,
    [string]$ExpectedDigest
  )

  $pattern = "(?:^|\s)$([regex]::Escape($FieldName))=([0-9a-fA-F]{64})(?:\s|$)"
  $values = @(
    $Messages | ForEach-Object {
      if ($_ -match $pattern) {
        $Matches[1].ToLowerInvariant()
      }
    } | Sort-Object -Unique
  )
  if ($values.Count -ne 1) {
    throw "STOP: audit log did not contain exactly one $FieldName digest."
  }
  if ($values[0] -cne $ExpectedDigest.ToLowerInvariant()) {
    throw "STOP: audit $FieldName did not match the approved fresh dev value."
  }
}

if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) {
  throw "Missing required command: aws"
}
if ([string]::IsNullOrWhiteSpace($AwsProfile) -or $AwsProfile -match '(?i)prod') {
  throw "Refusing a blank or production-named AWS profile: $AwsProfile"
}
Assert-QaName -Value $Cluster -Label "Cluster"
Assert-QaName -Value $TaskDefinition -Label "TaskDefinition"
Assert-QaName -Value $DatabaseInstanceIdentifier -Label "DatabaseInstanceIdentifier"
$ExpectedRepositorySchemaSHA256 = $ExpectedRepositorySchemaSHA256.ToLowerInvariant()
$ExpectedGitCommit = $ExpectedGitCommit.ToLowerInvariant()
$ExpectedSchemaInventorySHA256 = $ExpectedSchemaInventorySHA256.ToLowerInvariant()
if (-not [string]::IsNullOrWhiteSpace($ExpectedSchemaInventorySHA256) -and $ExpectedSchemaInventorySHA256 -notmatch '^[0-9a-f]{64}$') {
  throw "-ExpectedSchemaInventorySHA256 must be a 64-character hexadecimal SHA-256."
}
if ($Action -eq "Audit" -and $AuditPurpose -eq "Parity" -and [string]::IsNullOrWhiteSpace($ExpectedSchemaInventorySHA256)) {
  throw "Parity audit requires -ExpectedSchemaInventorySHA256 from a fresh same-commit dev export."
}
if ($Action -eq "Bootstrap" -and $AuditPurpose -ne "Parity") {
  throw "-AuditPurpose applies only to -Action Audit. Omit it for Bootstrap."
}

$identity = Invoke-AwsJson -Arguments @("sts", "get-caller-identity")
if ([string]$identity.Account -cne $ExpectedAwsAccountID) {
  throw "AWS account mismatch. Expected $ExpectedAwsAccountID but profile '$AwsProfile' resolved to $($identity.Account)."
}

$clusterResult = Invoke-AwsJson -Arguments @("ecs", "describe-clusters", "--clusters", $Cluster)
if ($clusterResult.failures.Count -gt 0 -or $clusterResult.clusters.Count -ne 1) {
  throw "QA ECS cluster was not found: $Cluster"
}
$clusterRecord = $clusterResult.clusters[0]
Assert-QaName -Value ([string]$clusterRecord.clusterArn) -Label "Resolved cluster ARN"
if ([string]$clusterRecord.status -ne "ACTIVE") {
  throw "QA ECS cluster is not ACTIVE: $($clusterRecord.status)"
}

$taskResult = Invoke-AwsJson -Arguments @("ecs", "describe-task-definition", "--task-definition", $TaskDefinition)
$task = $taskResult.taskDefinition
Assert-QaName -Value ([string]$task.family) -Label "Resolved task definition family"
if ([string]$task.networkMode -ne "awsvpc") {
  throw "Migration task definition must use awsvpc networking."
}
$container = @($task.containerDefinitions | Where-Object { $_.name -ceq $ContainerName })
if ($container.Count -ne 1) {
  throw "Expected one migration container named '$ContainerName'; found $($container.Count)."
}
$container = $container[0]
if ([string]$container.image -notmatch '(?i)migrat') {
  throw "Migration container image must be visibly migration-specific: $($container.image)"
}
$expectedImageTag = ":$([regex]::Escape($ExpectedGitCommit))-migrations(?:@sha256:[0-9a-fA-F]{64})?$"
if ([string]$container.image -cnotmatch $expectedImageTag) {
  throw "Migration container image must use the immutable tag '$ExpectedGitCommit-migrations'."
}

$environmentByName = @{}
foreach ($entry in @($container.environment)) {
  $environmentByName[[string]$entry.name] = [string]$entry.value
}
$secretNames = @($container.secrets | ForEach-Object { [string]$_.name })
foreach ($name in @("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_SSLMODE")) {
  if (-not $environmentByName.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($environmentByName[$name])) {
    throw "Migration task is missing non-secret environment value $name."
  }
}
if ($secretNames -cnotcontains "DB_PASSWORD") {
  throw "Migration task must receive DB_PASSWORD through ECS secrets."
}
if ($environmentByName["DB_SSLMODE"] -cne "require") {
  throw "Migration task DB_SSLMODE must be 'require'."
}
Assert-QaName -Value $environmentByName["DB_HOST"] -Label "Migration DB_HOST"
Assert-QaName -Value $environmentByName["DB_NAME"] -Label "Migration DB_NAME"

$databaseResult = Invoke-AwsJson -Arguments @("rds", "describe-db-instances", "--db-instance-identifier", $DatabaseInstanceIdentifier)
if ($databaseResult.DBInstances.Count -ne 1) {
  throw "QA RDS instance was not found: $DatabaseInstanceIdentifier"
}
$database = $databaseResult.DBInstances[0]
if ([string]$database.Engine -cne "postgres") {
  throw "QA database engine must be PostgreSQL; got $($database.Engine)."
}
if ([string]$database.EngineVersion -notmatch '^17\.') {
  throw "QA database must run PostgreSQL 17.x; got $($database.EngineVersion)."
}
if ([bool]$database.PubliclyAccessible) {
  throw "QA database must not be publicly accessible."
}
if ([string]$database.Endpoint.Address -cne $environmentByName["DB_HOST"]) {
  throw "Migration DB_HOST does not match the QA RDS endpoint."
}
if (-not [string]::IsNullOrWhiteSpace([string]$database.DBName) -and [string]$database.DBName -cne $environmentByName["DB_NAME"]) {
  throw "Migration DB_NAME does not match the database name reported by RDS."
}

$subnetResult = Invoke-AwsJson -Arguments (@("ec2", "describe-subnets", "--subnet-ids") + $SubnetIDs)
if ($subnetResult.Subnets.Count -ne $SubnetIDs.Count) {
  throw "One or more ECS subnet IDs were not found."
}
foreach ($subnet in $subnetResult.Subnets) {
  if ([string]$subnet.VpcId -cne [string]$database.DBSubnetGroup.VpcId) {
    throw "ECS subnet $($subnet.SubnetId) is not in the QA database VPC."
  }
}

$securityGroupResult = Invoke-AwsJson -Arguments (@("ec2", "describe-security-groups", "--group-ids") + $SecurityGroupIDs)
if ($securityGroupResult.SecurityGroups.Count -ne $SecurityGroupIDs.Count) {
  throw "One or more ECS security group IDs were not found."
}
foreach ($securityGroup in $securityGroupResult.SecurityGroups) {
  if ([string]$securityGroup.VpcId -cne [string]$database.DBSubnetGroup.VpcId) {
    throw "ECS security group $($securityGroup.GroupId) is not in the QA database VPC."
  }
}

$command = if ($Action -eq "Audit") {
  @("-mode", "audit")
} else {
  @("-mode", "schema", "-baseline-migrations", "-require-empty-database")
}
$networkConfiguration = @{
  awsvpcConfiguration = @{
    subnets        = @($SubnetIDs)
    securityGroups = @($SecurityGroupIDs)
    assignPublicIp = "DISABLED"
  }
} | ConvertTo-Json -Depth 5 -Compress
$overrides = @{
  containerOverrides = @(
    @{
      name    = $ContainerName
      command = $command
    }
  )
} | ConvertTo-Json -Depth 5 -Compress

Write-Host "QA database task guard passed."
Write-Host "AWS account: $($identity.Account)"
Write-Host "AWS principal: $($identity.Arn)"
Write-Host "Cluster: $($clusterRecord.clusterArn)"
Write-Host "Task definition: $($task.taskDefinitionArn)"
Write-Host "Migration image: $($container.image)"
Write-Host "Database: $DatabaseInstanceIdentifier / $($environmentByName['DB_NAME']) / PostgreSQL $($database.EngineVersion)"
Write-Host "Command: $($command -join ' ')"

if ($Action -eq "Bootstrap") {
  Assert-EmptyDatabaseAudit `
    -TaskArn $EmptyDatabaseAuditTaskArn `
    -ExpectedTaskDefinition $task `
    -ExpectedContainerDefinition $container `
    -ClusterArn ([string]$clusterRecord.clusterArn) `
    -ExpectedRepositoryDigest $ExpectedRepositorySchemaSHA256
}

if (-not $Execute) {
  Write-Host "Plan only. No ECS task was started and no database change was made."
  exit 0
}
if (-not $HumanOperatorApproval) {
  throw "-Execute requires -HumanOperatorApproval. Agents must not use this switch."
}
if (-not [Environment]::UserInteractive) {
  throw "Execution requires an interactive human operator."
}

$confirmation = "RUN $($Action.ToUpperInvariant()) ON QA $($environmentByName['DB_NAME'])"
$typed = Read-Host "Type '$confirmation' to start the one-off ECS task"
if ($typed -cne $confirmation) {
  throw "Confirmation did not match. No ECS task was started."
}

$networkConfigurationPath = [IO.Path]::GetTempFileName()
$overridesPath = [IO.Path]::GetTempFileName()
try {
  $utf8WithoutBom = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText($networkConfigurationPath, $networkConfiguration, $utf8WithoutBom)
  [IO.File]::WriteAllText($overridesPath, $overrides, $utf8WithoutBom)
  $runResult = Invoke-AwsJson -Arguments @(
    "ecs", "run-task",
    "--cluster", [string]$clusterRecord.clusterArn,
    "--task-definition", [string]$task.taskDefinitionArn,
    "--launch-type", "FARGATE",
    "--count", "1",
    "--network-configuration", "file://$networkConfigurationPath",
    "--overrides", "file://$overridesPath",
    "--started-by", "mangorts-qa-human-database-$($Action.ToLowerInvariant())"
  )
}
finally {
  Remove-Item -LiteralPath $networkConfigurationPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $overridesPath -Force -ErrorAction SilentlyContinue
}
if ($runResult.failures.Count -gt 0 -or $runResult.tasks.Count -ne 1) {
  throw "ECS did not start exactly one QA database task."
}
$taskArn = [string]$runResult.tasks[0].taskArn
Write-Host "Started QA database task: $taskArn"

& aws ecs wait tasks-stopped `
  --cluster ([string]$clusterRecord.clusterArn) `
  --tasks $taskArn `
  --profile $AwsProfile `
  --region $AwsRegion
if ($LASTEXITCODE -ne 0) {
  throw "Timed out or failed while waiting for QA database task $taskArn."
}

$stoppedResult = Invoke-AwsJson -Arguments @("ecs", "describe-tasks", "--cluster", [string]$clusterRecord.clusterArn, "--tasks", $taskArn)
$stoppedTask = $stoppedResult.tasks[0]
$stoppedContainer = @($stoppedResult.tasks[0].containers | Where-Object { $_.name -ceq $ContainerName })
if ($stoppedContainer.Count -ne 1) {
  throw "Could not find the stopped migration container for $taskArn."
}
if ($null -eq $stoppedContainer[0].exitCode) {
  throw "QA database task stopped without a container exit code. Review its ECS stop reason and CloudWatch logs."
}
if ([int]$stoppedContainer[0].exitCode -ne 0) {
  throw "QA database task failed with exit code $($stoppedContainer[0].exitCode). Review its CloudWatch logs."
}

Write-Host "QA database task completed successfully."
if ($Action -eq "Audit") {
  $messages = Get-QaTaskLogMessages -TaskRecord $stoppedTask -ContainerDefinition $container
  foreach ($message in $messages) {
    Write-Host $message
  }
  if (-not ($messages | Where-Object { $_ -match 'server_version_num=17\d{4}(?:\s|$)' })) {
    throw "STOP: the connected PostgreSQL audit did not report a supported 17.x server_version_num."
  }
  Assert-AuditDigest `
    -Messages $messages `
    -FieldName "repository_schema_sha256" `
    -ExpectedDigest $ExpectedRepositorySchemaSHA256
  if ($AuditPurpose -eq "EmptyPreflight") {
    if (-not ($messages | Where-Object { $_ -match 'public_tables=0(?:\s|$)' })) {
      throw "STOP: empty-database audit did not report public_tables=0."
    }
    Write-Host "Empty database and repository fingerprint verified."
  } else {
    Assert-AuditDigest `
      -Messages $messages `
      -FieldName "schema_inventory_sha256" `
      -ExpectedDigest $ExpectedSchemaInventorySHA256
    if (-not ($messages | Where-Object { $_ -match 'missing_from_ledger=0(?:\s|$)' })) {
      throw "STOP: final audit reported migrations missing from the ledger."
    }
    if (-not ($messages | Where-Object { $_ -match 'unknown_to_repository=0(?:\s|$)' })) {
      throw "STOP: final audit reported migration ledger rows unknown to this repository."
    }
    Write-Host "Final QA schema hash, repository fingerprint, and migration ledger verified."
  }
  Write-Host "Audit task ARN: $taskArn"
} else {
  Write-Host "Run a new Parity Audit with the fresh same-commit dev schema hash before deploying the API."
}
