[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ExpectedGitCommit,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^arn:aws:secretsmanager:us-west-1:686458136219:secret:mangorts/qa-copy/dev-readonly-temp-[A-Za-z0-9/_+=.@-]+$')]
  [string]$DevReadOnlySecretArn,

  [string]$AwsProfile = "mangorts-dev",
  [string]$AwsRegion = "us-west-1",
  [string]$ExpectedAwsAccountID = "686458136219",
  [switch]$Execute,
  [switch]$HumanOperatorApproval
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

# SECURITY: Only the human operator may pass -HumanOperatorApproval. Agents must
# never use that switch or launch this writer-bearing hosted task on Jonat's behalf.

$qaClusterName = "mangorts-qa-cluster"
$qaServiceName = "mangorts-qa-backend"
$qaDatabaseIdentifier = "mangorts-qa-postgres"
$devClusterIdentifier = "miraerts-northerncalifornia-devcluster"
$qaMigrationFamily = "mangorts-qa-database-migration"
$qaCopyFamily = "mangorts-qa-database-copy-temp"
$qaCopyContainerName = "database-copy"
$qaLogGroup = "/ecs/mangorts-qa/database-migration"
$temporaryExecutionPolicyName = "mangorts-qa-copy-temp-dev-readonly"
$jonatQaEmail = "jonathankim829@gmail.com"
$maxDevDatabaseBytes = [int64]4294967296
$minimumQaFreeStorageBytes = [int64]12884901888

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = & aws @Arguments --profile $AwsProfile --region $AwsRegion --output json
  if ($LASTEXITCODE -ne 0) {
    throw "AWS command failed: aws $($Arguments -join ' ')"
  }
  $raw = (@($output) -join "`n").Trim()
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Invoke-AwsNoOutput {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & aws @Arguments --profile $AwsProfile --region $AwsRegion --output json | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "AWS command failed: aws $($Arguments -join ' ')"
  }
}

function Get-EnvironmentValue {
  param([Parameter(Mandatory = $true)][object]$Container, [Parameter(Mandatory = $true)][string]$Name)

  $matches = @($Container.environment | Where-Object { [string]$_.name -ceq $Name })
  if ($matches.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$matches[0].value)) {
    throw "Expected exactly one non-secret $Name value in the reviewed QA container."
  }
  return [string]$matches[0].value
}

function Assert-QaWritersStopped {
  param([string]$AllowedTaskArn = "")

  $serviceResult = Invoke-AwsJson -Arguments @(
    "ecs", "describe-services", "--cluster", $qaClusterName, "--services", $qaServiceName
  )
  if (@($serviceResult.services).Count -ne 1 -or @($serviceResult.failures).Count -ne 0) {
    throw "The exact QA API service was not found."
  }
  $service = @($serviceResult.services)[0]
  if ([int]$service.desiredCount -ne 0 -or [int]$service.runningCount -ne 0 -or [int]$service.pendingCount -ne 0) {
    throw "STOP: QA API service is not fully stopped."
  }

  foreach ($status in @("RUNNING", "PENDING")) {
    $tasks = Invoke-AwsJson -Arguments @(
      "ecs", "list-tasks", "--cluster", $qaClusterName, "--desired-status", $status
    )
    $unexpectedTasks = @($tasks.taskArns | Where-Object {
      [string]::IsNullOrWhiteSpace($AllowedTaskArn) -or [string]$_ -cne $AllowedTaskArn
    })
    if ($unexpectedTasks.Count -ne 0) {
      throw "STOP: QA cluster contains an unexpected $status task."
    }
  }

  $schedules = Invoke-AwsJson -Arguments @(
    "scheduler", "list-schedules", "--group-name", "mangorts-qa-email-reconciliation"
  )
  if (@($schedules.Schedules | Where-Object { [string]$_.State -ceq "ENABLED" }).Count -ne 0) {
    throw "STOP: QA email reconciliation Scheduler is enabled."
  }

  foreach ($queueName in @(
    "mangorts-qa-email-work.fifo",
    "mangorts-qa-email-work-dlq.fifo",
    "mangorts-qa-email-scheduler-dlq"
  )) {
    $queue = Invoke-AwsJson -Arguments @("sqs", "get-queue-url", "--queue-name", $queueName)
    $attributes = Invoke-AwsJson -Arguments @(
      "sqs", "get-queue-attributes", "--queue-url", [string]$queue.QueueUrl,
      "--attribute-names", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed"
    )
    foreach ($property in $attributes.Attributes.PSObject.Properties) {
      if ([int64]$property.Value -ne 0) {
        throw "STOP: exact QA queue is not empty: $queueName"
      }
    }
  }
}

function Assert-QaStorageHeadroom {
  $endTime = [DateTimeOffset]::UtcNow
  $startTime = $endTime.AddMinutes(-30)
  $metrics = Invoke-AwsJson -Arguments @(
    "cloudwatch", "get-metric-statistics",
    "--namespace", "AWS/RDS", "--metric-name", "FreeStorageSpace",
    "--dimensions", "Name=DBInstanceIdentifier,Value=$qaDatabaseIdentifier",
    "--start-time", $startTime.ToString("o"), "--end-time", $endTime.ToString("o"),
    "--period", "300", "--statistics", "Minimum"
  )
  $points = @($metrics.Datapoints | Sort-Object Timestamp -Descending)
  if ($points.Count -lt 1) {
    throw "STOP: no recent QA RDS FreeStorageSpace metric was available."
  }
  $freeBytes = [int64][double]$points[0].Minimum
  if ($freeBytes -lt $minimumQaFreeStorageBytes) {
    throw "STOP: QA RDS has less than the required 12 GiB of free storage."
  }
  return $freeBytes
}

function Get-OrCreateJonatQaCognitoSubject {
  param([Parameter(Mandatory = $true)][string]$UserPoolID)

  $listed = Invoke-AwsJson -Arguments @(
    "cognito-idp", "list-users", "--user-pool-id", $UserPoolID,
    "--filter", "email = `"$jonatQaEmail`"", "--limit", "2"
  )
  $listedUsers = @(if ($listed.PSObject.Properties.Name -contains "Users") { $listed.Users })
  $exactUsers = @($listedUsers | Where-Object {
    $attributes = @(if ($_.PSObject.Properties.Name -contains "Attributes") { $_.Attributes })
    $emails = @($attributes | Where-Object { [string]$_.Name -ceq "email" } | ForEach-Object { [string]$_.Value })
    $emails.Count -eq 1 -and [string]::Equals($emails[0], $jonatQaEmail, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($exactUsers.Count -gt 1) {
    throw "More than one QA Cognito user has Jonat's exact email."
  }
  if ($exactUsers.Count -eq 0) {
    $created = Invoke-AwsJson -Arguments @(
      "cognito-idp", "admin-create-user", "--user-pool-id", $UserPoolID,
      "--username", $jonatQaEmail,
      "--user-attributes", "Name=email,Value=$jonatQaEmail", "Name=email_verified,Value=true"
    )
    if ($null -eq $created -or $created.PSObject.Properties.Name -notcontains "User") {
      throw "Cognito did not return Jonat's created QA user."
    }
    $user = $created.User
  }
  else {
    $user = $exactUsers[0]
  }

  $userAttributes = @(if ($user.PSObject.Properties.Name -contains "Attributes") { $user.Attributes })
  $subjects = @($userAttributes | Where-Object { [string]$_.Name -ceq "sub" } | ForEach-Object { [string]$_.Value })
  if ($subjects.Count -ne 1 -or $subjects[0] -notmatch '^[0-9a-fA-F-]{36}$') {
    throw "Jonat's exact QA Cognito user did not contain one UUID subject."
  }
  return $subjects[0]
}

if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) {
  throw "Missing required command: aws"
}
if (-not (Get-Command "git" -ErrorAction SilentlyContinue)) {
  throw "Missing required command: git"
}
if ([string]::IsNullOrWhiteSpace($AwsProfile) -or $AwsProfile -match '(?i)prod') {
  throw "Refusing a blank or production-named AWS profile."
}
if ($AwsRegion -cne "us-west-1") {
  throw "QA copy is pinned to us-west-1."
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not locate the MangoRTS repository." }
$headCommit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $headCommit -cne $ExpectedGitCommit) {
  throw "Checked-out commit does not match -ExpectedGitCommit."
}
$branch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -cne "main") {
  throw "Run the human QA copy launcher only from main."
}
$originMain = (& git rev-parse origin/main).Trim()
if ($LASTEXITCODE -ne 0 -or $originMain -cne $ExpectedGitCommit) {
  throw "origin/main does not match the approved exact commit. Fetch and review before continuing."
}
$worktreeStatus = @(& git status --porcelain)
if ($LASTEXITCODE -ne 0) {
  throw "Could not inspect the main worktree status."
}
if ($worktreeStatus -join "`n") {
  throw "The main worktree must be clean before the QA copy."
}

$identity = Invoke-AwsJson -Arguments @("sts", "get-caller-identity")
if ([string]$identity.Account -cne $ExpectedAwsAccountID) {
  throw "Wrong AWS account: $($identity.Account)"
}

$qaDatabaseResult = Invoke-AwsJson -Arguments @(
  "rds", "describe-db-instances", "--db-instance-identifier", $qaDatabaseIdentifier
)
$qaDatabases = @($qaDatabaseResult.DBInstances)
if ($qaDatabases.Count -ne 1) { throw "Exact QA RDS instance was not found." }
$qaDatabase = $qaDatabases[0]
if ([string]$qaDatabase.Engine -cne "postgres" -or [string]$qaDatabase.EngineVersion -notmatch '^17\.' -or
    [bool]$qaDatabase.PubliclyAccessible -or [string]$qaDatabase.DBName -cne "mangorts_qa" -or
    [string]$qaDatabase.DBInstanceStatus -cne "available") {
  throw "Exact QA RDS identity, version, privacy, name, or state failed."
}
$qaSecretArn = [string]$qaDatabase.MasterUserSecret.SecretArn
if ($qaSecretArn -notmatch '^arn:aws:secretsmanager:us-west-1:686458136219:secret:rds!db-' -or
    [string]::IsNullOrWhiteSpace($qaSecretArn)) {
  throw "QA RDS did not report its managed master-user secret ARN."
}

$devClusterResult = Invoke-AwsJson -Arguments @(
  "rds", "describe-db-clusters", "--db-cluster-identifier", $devClusterIdentifier
)
$devClusters = @($devClusterResult.DBClusters)
if ($devClusters.Count -ne 1) { throw "Exact Dev Aurora cluster was not found." }
$devCluster = $devClusters[0]
if ([string]$devCluster.Engine -cne "aurora-postgresql" -or [string]$devCluster.EngineVersion -notmatch '^17\.' -or
    [string]$devCluster.DatabaseName -cne "MiraeRTSDevDatabase" -or [string]$devCluster.Status -cne "available") {
  throw "Exact Dev source identity, version, database name, or state failed."
}
$devHost = [string]$devCluster.Endpoint
if ($devHost -notmatch '(?i)(^|[-.])devcluster([-.]|$)' -or $devHost -match '(?i)(^|[-.])(qa|prod)([-.]|$)') {
  throw "Resolved Dev endpoint failed its environment marker guard."
}

$devSecret = Invoke-AwsJson -Arguments @(
  "secretsmanager", "describe-secret", "--secret-id", $DevReadOnlySecretArn
)
$deletedDate = if ($devSecret.PSObject.Properties.Name -contains "DeletedDate") { [string]$devSecret.DeletedDate } else { "" }
$owningService = if ($devSecret.PSObject.Properties.Name -contains "OwningService") { [string]$devSecret.OwningService } else { "" }
$devSecretKmsKeyID = if ($devSecret.PSObject.Properties.Name -contains "KmsKeyId") { [string]$devSecret.KmsKeyId } else { "" }
if ([string]$devSecret.ARN -cne $DevReadOnlySecretArn -or [string]$devSecret.Name -notmatch '^mangorts/qa-copy/dev-readonly-temp-' -or
    -not [string]::IsNullOrWhiteSpace($deletedDate) -or
    -not [string]::IsNullOrWhiteSpace($owningService) -or
    -not [string]::IsNullOrWhiteSpace($devSecretKmsKeyID)) {
  throw "Temporary Dev read-only secret metadata failed its exact guard."
}
$secretTags = @{}
$devSecretTags = @(if ($devSecret.PSObject.Properties.Name -contains "Tags") { $devSecret.Tags })
foreach ($tag in $devSecretTags) { $secretTags[[string]$tag.Key] = [string]$tag.Value }
if ($secretTags["Environment"] -cne "qa" -or $secretTags["Purpose"] -cne "dev-readonly-source" -or
    $secretTags["Temporary"] -cne "true") {
  throw "Temporary Dev read-only secret requires Environment=qa, Purpose=dev-readonly-source, Temporary=true tags."
}
$devSecretCreated = [DateTimeOffset]::Parse([string]$devSecret.CreatedDate).ToUniversalTime()
if ($devSecretCreated -lt [DateTimeOffset]::UtcNow.AddHours(-24) -or $devSecretCreated -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
  throw "Temporary Dev read-only secret must have been created within the last 24 hours."
}

$migrationDefinitions = Invoke-AwsJson -Arguments @(
  "ecs", "list-task-definitions", "--family-prefix", $qaMigrationFamily, "--status", "ACTIVE", "--sort", "DESC"
)
$migrationDefinitionArns = @($migrationDefinitions.taskDefinitionArns)
if ($migrationDefinitionArns.Count -lt 1) { throw "QA migration task definition is missing." }
$migrationResult = Invoke-AwsJson -Arguments @(
  "ecs", "describe-task-definition", "--task-definition", [string]$migrationDefinitionArns[0]
)
$migrationTask = $migrationResult.taskDefinition
if ([string]$migrationTask.family -cne $qaMigrationFamily) {
  throw "Newest QA migration task definition did not belong to the exact reviewed family."
}
$migrationContainers = @($migrationTask.containerDefinitions | Where-Object { [string]$_.name -ceq "database-migration" })
if ($migrationContainers.Count -ne 1) { throw "QA migration container is missing." }
$migrationContainer = $migrationContainers[0]
if ([string]$migrationContainer.image -notmatch ":$([regex]::Escape($ExpectedGitCommit))-migrations(?:@sha256:[0-9a-f]{64})?$") {
  throw "QA bootstrap images were not refreshed for the approved commit."
}
$executionRoleArn = [string]$migrationTask.executionRoleArn
if ($executionRoleArn -notmatch '^arn:aws:iam::686458136219:role/mangorts-qa-') {
  throw "Unexpected QA ECS execution role."
}
$executionRoleName = ($executionRoleArn -split '/')[-1]
$qaSecretEntries = @($migrationContainer.secrets | Where-Object { [string]$_.name -ceq "DB_PASSWORD" })
if ($qaSecretEntries.Count -ne 1 -or [string]$qaSecretEntries[0].valueFrom -cne "${qaSecretArn}:password::") {
  throw "QA migration task does not inject the exact RDS-managed password."
}

$serviceResult = Invoke-AwsJson -Arguments @(
  "ecs", "describe-services", "--cluster", $qaClusterName, "--services", $qaServiceName
)
$services = @($serviceResult.services)
if ($services.Count -ne 1) { throw "Exact QA service was not found." }
$qaService = $services[0]
$network = $qaService.networkConfiguration.awsvpcConfiguration
$privateSubnets = @($network.subnets | ForEach-Object { [string]$_ })
$qaSecurityGroups = @($network.securityGroups | ForEach-Object { [string]$_ })
if ($privateSubnets.Count -lt 2 -or $qaSecurityGroups.Count -ne 1 -or [string]$network.assignPublicIp -cne "DISABLED") {
  throw "QA ECS private-network configuration failed its exact guard."
}
$qaSecurityGroup = $qaSecurityGroups[0]

$devEcsGroups = Invoke-AwsJson -Arguments @(
  "ec2", "describe-security-groups", "--filters", "Name=vpc-id,Values=$($qaDatabase.DBSubnetGroup.VpcId)", "Name=group-name,Values=mangorts-dev-ecs"
)
$devEcsSecurityGroups = @($devEcsGroups.SecurityGroups)
if ($devEcsSecurityGroups.Count -ne 1) { throw "Exact Dev ECS source security group was not found." }
$devEcsSecurityGroup = [string]$devEcsSecurityGroups[0].GroupId
$devDatabaseSecurityGroupIDs = @($devCluster.VpcSecurityGroups | ForEach-Object { [string]$_.VpcSecurityGroupId })
if ($devDatabaseSecurityGroupIDs.Count -lt 1) { throw "Dev RDS did not report an attached security group." }
$devDatabaseGroups = Invoke-AwsJson -Arguments (@(
  "ec2", "describe-security-groups", "--group-ids"
) + $devDatabaseSecurityGroupIDs)
$resolvedDevDatabaseGroups = @($devDatabaseGroups.SecurityGroups)
if ($resolvedDevDatabaseGroups.Count -ne $devDatabaseSecurityGroupIDs.Count) {
  throw "Could not resolve every Dev RDS security group."
}
$devIngressMatches = @(
  foreach ($databaseGroup in $resolvedDevDatabaseGroups) {
    $permissions = @(if ($databaseGroup.PSObject.Properties.Name -contains "IpPermissions") { $databaseGroup.IpPermissions })
    foreach ($permission in $permissions) {
      if ([string]$permission.IpProtocol -ceq "tcp" -and [int]$permission.FromPort -eq 5432 -and [int]$permission.ToPort -eq 5432) {
        $sourceGroups = @(if ($permission.PSObject.Properties.Name -contains "UserIdGroupPairs") { $permission.UserIdGroupPairs })
        $sourceGroups | Where-Object { [string]$_.GroupId -ceq $devEcsSecurityGroup }
      }
    }
  }
)
if ($devIngressMatches.Count -lt 1) {
  throw "Dev RDS does not allow PostgreSQL from the existing Dev ECS security group."
}

$backendResult = Invoke-AwsJson -Arguments @(
  "ecs", "describe-task-definition", "--task-definition", [string]$qaService.taskDefinition
)
$backendContainers = @($backendResult.taskDefinition.containerDefinitions | Where-Object { [string]$_.name -ceq "backend" })
if ($backendContainers.Count -ne 1) { throw "QA backend task definition is malformed." }
$cognitoUserPoolID = Get-EnvironmentValue -Container $backendContainers[0] -Name "COGNITO_USER_POOL_ID"
if ($cognitoUserPoolID -notmatch '^us-west-1_[A-Za-z0-9]+$') { throw "Unexpected QA Cognito pool ID." }
Invoke-AwsJson -Arguments @("cognito-idp", "describe-user-pool", "--user-pool-id", $cognitoUserPoolID) | Out-Null

$repository = Invoke-AwsJson -Arguments @(
  "ecr", "describe-repositories", "--repository-names", "mangorts-qa-backend"
)
$repositories = @($repository.repositories)
if ($repositories.Count -ne 1 -or [string]$repositories[0].imageTagMutability -cne "IMMUTABLE") {
  throw "Exact immutable QA ECR repository was not found."
}
$copyImageTag = "$ExpectedGitCommit-qa-copy"
$copyImageResult = Invoke-AwsJson -Arguments @(
  "ecr", "describe-images", "--repository-name", "mangorts-qa-backend", "--image-ids", "imageTag=$copyImageTag"
)
$copyImages = @($copyImageResult.imageDetails)
if ($copyImages.Count -ne 1 -or [string]$copyImages[0].imageDigest -notmatch '^sha256:[0-9a-f]{64}$') {
  throw "Exact-commit QA copy image is missing or ambiguous."
}
$copyImage = "$([string]$repositories[0].repositoryUri)@$([string]$copyImages[0].imageDigest)"

$existingInlinePolicies = Invoke-AwsJson -Arguments @(
  "iam", "list-role-policies", "--role-name", $executionRoleName
)
if (@($existingInlinePolicies.PolicyNames | Where-Object { [string]$_ -ceq $temporaryExecutionPolicyName }).Count -ne 0) {
  throw "Temporary QA copy execution policy already exists; inspect and remove stale state before continuing."
}

Assert-QaWritersStopped
$qaFreeStorageBytes = Assert-QaStorageHeadroom

Write-Host "QA Fargate copy guard passed."
Write-Host "AWS account: $($identity.Account)"
Write-Host "Release: $ExpectedGitCommit"
Write-Host "Image: $copyImage"
Write-Host "Dev source: $devHost / $($devCluster.DatabaseName) / PostgreSQL $($devCluster.EngineVersion)"
Write-Host "QA target: $($qaDatabase.Endpoint.Address) / $($qaDatabase.DBName) / PostgreSQL $($qaDatabase.EngineVersion)"
Write-Host "Network: private subnets; QA and Dev ECS source security groups; no public IP"
Write-Host "Secrets: ECS injection from the exact QA managed secret and temporary Dev read-only secret"
Write-Host "Task role: none"
Write-Host "QA free storage: $qaFreeStorageBytes bytes (minimum: $minimumQaFreeStorageBytes)"

if (-not $Execute) {
  Write-Host "Plan only. No snapshot, Cognito user, IAM policy, task definition, or ECS task was created."
  exit 0
}
if (-not $HumanOperatorApproval) {
  throw "-Execute requires -HumanOperatorApproval. Agents must not use this switch."
}
if (-not [Environment]::UserInteractive) {
  throw "Execution requires an interactive human operator."
}

$confirmation = "COPY DEV READ ONLY TO QA AND CUT OVER $ExpectedGitCommit"
if ((Read-Host "Type '$confirmation' to create the snapshot and start the one-off task") -cne $confirmation) {
  throw "Confirmation did not match. No cloud resource was changed."
}

$policyPath = ""
$taskDefinitionPath = ""
$networkPath = ""
$policyAttached = $false
$registeredTaskDefinitionArn = ""
$taskArn = ""
$taskSucceeded = $false
$secretDeletionScheduled = $false
$snapshotID = ""
try {
  Assert-QaWritersStopped
  $qaFreeStorageBytes = Assert-QaStorageHeadroom
  $jonatCognitoSubject = Get-OrCreateJonatQaCognitoSubject -UserPoolID $cognitoUserPoolID

  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
  $rawTimestamp = "{0}_{1}" -f $timestamp.Substring(0, 8), $timestamp.Substring(8, 6)
  $rawDatabase = "mangorts_qa_raw_$rawTimestamp"
  $nextDatabase = "mangorts_qa_next_$timestamp"
  $rollbackDatabase = "mangorts_qa_rollback_$timestamp"
  $failedDatabase = "mangorts_qa_failed_$timestamp"
  $snapshotID = "mangorts-qa-before-clean-copy-$timestamp"

  Invoke-AwsNoOutput -Arguments @(
    "rds", "create-db-snapshot", "--db-instance-identifier", $qaDatabaseIdentifier,
    "--db-snapshot-identifier", $snapshotID,
    "--tags", "Key=project,Value=mangorts", "Key=environment,Value=qa", "Key=purpose,Value=pre-clean-copy-rollback"
  )
  & aws rds wait db-snapshot-completed `
    --db-snapshot-identifier $snapshotID `
    --profile $AwsProfile --region $AwsRegion
  if ($LASTEXITCODE -ne 0) { throw "QA pre-copy snapshot did not complete." }

  Assert-QaWritersStopped
  $qaFreeStorageBytes = Assert-QaStorageHeadroom

  $policyPath = [IO.Path]::GetTempFileName()
  $taskDefinitionPath = [IO.Path]::GetTempFileName()
  $networkPath = [IO.Path]::GetTempFileName()
  $utf8 = [Text.UTF8Encoding]::new($false)
  $policy = @{
    Version = "2012-10-17"
    Statement = @(
      @{
        Sid      = "ReadExactTemporaryDevReadOnlySecret"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = $DevReadOnlySecretArn
      }
    )
  } | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($policyPath, $policy, $utf8)
  Invoke-AwsNoOutput -Arguments @(
    "iam", "put-role-policy", "--role-name", $executionRoleName,
    "--policy-name", $temporaryExecutionPolicyName, "--policy-document", "file://$policyPath"
  )
  $policyAttached = $true
  $policyVisible = $false
  for ($attempt = 0; $attempt -lt 6; $attempt++) {
    $visiblePolicies = Invoke-AwsJson -Arguments @(
      "iam", "list-role-policies", "--role-name", $executionRoleName
    )
    $visiblePolicyNames = @(if ($visiblePolicies.PSObject.Properties.Name -contains "PolicyNames") { $visiblePolicies.PolicyNames })
    if (@($visiblePolicyNames | Where-Object { [string]$_ -ceq $temporaryExecutionPolicyName }).Count -eq 1) {
      $policyVisible = $true
      break
    }
    Start-Sleep -Seconds 5
  }
  if (-not $policyVisible) {
    throw "Temporary Dev-secret permission did not become visible before task registration."
  }

  $environment = @(
    @{ name = "EXPECTED_GIT_COMMIT"; value = $ExpectedGitCommit },
    @{ name = "DEV_DB_HOST"; value = $devHost },
    @{ name = "DEV_DB_PORT"; value = [string]$devCluster.Port },
    @{ name = "DEV_DB_NAME"; value = [string]$devCluster.DatabaseName },
    @{ name = "DEV_DB_MASTER_USER"; value = [string]$devCluster.MasterUsername },
    @{ name = "MAX_DEV_DATABASE_BYTES"; value = [string]$maxDevDatabaseBytes },
    @{ name = "QA_DB_HOST"; value = [string]$qaDatabase.Endpoint.Address },
    @{ name = "QA_DB_PORT"; value = [string]$qaDatabase.Endpoint.Port },
    @{ name = "QA_DB_USER"; value = [string]$qaDatabase.MasterUsername },
    @{ name = "QA_STABLE_DATABASE"; value = "mangorts_qa" },
    @{ name = "QA_RAW_DATABASE"; value = $rawDatabase },
    @{ name = "QA_NEXT_DATABASE"; value = $nextDatabase },
    @{ name = "QA_ROLLBACK_DATABASE"; value = $rollbackDatabase },
    @{ name = "QA_FAILED_DATABASE"; value = $failedDatabase },
    @{ name = "JONAT_QA_EMAIL"; value = $jonatQaEmail },
    @{ name = "JONAT_QA_COGNITO_SUB"; value = $jonatCognitoSubject }
  )
  $secrets = @(
    @{ name = "DEV_DB_USER"; valueFrom = "${DevReadOnlySecretArn}:username::" },
    @{ name = "DEV_DB_PASSWORD"; valueFrom = "${DevReadOnlySecretArn}:password::" },
    @{ name = "QA_DB_PASSWORD"; valueFrom = "${qaSecretArn}:password::" }
  )
  $taskDefinition = @{
    family                  = $qaCopyFamily
    executionRoleArn        = $executionRoleArn
    networkMode             = "awsvpc"
    requiresCompatibilities = @("FARGATE")
    cpu                     = "1024"
    memory                  = "2048"
    # Fargate's default encrypted 20-GiB ephemeral storage has ample headroom
    # for both compressed dumps of the audited approximately 1.2-GiB source.
    runtimePlatform         = @{ cpuArchitecture = "X86_64"; operatingSystemFamily = "LINUX" }
    containerDefinitions    = @(
      @{
        name                   = $qaCopyContainerName
        image                  = $copyImage
        essential              = $true
        environment            = $environment
        secrets                = $secrets
        # Keep the non-root image's mode-0700 /work directory writable. An empty
        # Fargate bind mount is root-owned 0755 and would reject this container.
        readonlyRootFilesystem = $false
        stopTimeout            = 120
        linuxParameters        = @{ initProcessEnabled = $true; capabilities = @{ drop = @("ALL") } }
        logConfiguration       = @{
          logDriver = "awslogs"
          options   = @{
            "awslogs-group"         = $qaLogGroup
            "awslogs-region"        = $AwsRegion
            "awslogs-stream-prefix" = "ecs"
          }
        }
      }
    )
    tags = @(
      @{ key = "project"; value = "mangorts" },
      @{ key = "environment"; value = "qa" },
      @{ key = "purpose"; value = "one-time-dev-copy" },
      @{ key = "git_commit"; value = $ExpectedGitCommit }
    )
  } | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($taskDefinitionPath, $taskDefinition, $utf8)
  $registered = Invoke-AwsJson -Arguments @(
    "ecs", "register-task-definition", "--cli-input-json", "file://$taskDefinitionPath"
  )
  if ($null -eq $registered -or $registered.PSObject.Properties.Name -notcontains "taskDefinition") {
    throw "ECS did not return the registered QA copy task definition."
  }
  $registeredTask = $registered.taskDefinition
  $registeredTaskDefinitionArn = [string]$registeredTask.taskDefinitionArn
  $registeredTaskRoleArn = if ($registeredTask.PSObject.Properties.Name -contains "taskRoleArn") { [string]$registeredTask.taskRoleArn } else { "" }
  if ($registeredTaskDefinitionArn -notmatch '^arn:aws:ecs:us-west-1:686458136219:task-definition/mangorts-qa-database-copy-temp:[0-9]+$' -or
      -not [string]::IsNullOrWhiteSpace($registeredTaskRoleArn)) {
    throw "Registered QA copy task identity or no-task-role guard failed."
  }

  $networkConfiguration = @{
    awsvpcConfiguration = @{
      subnets        = $privateSubnets
      securityGroups = @($qaSecurityGroup, $devEcsSecurityGroup)
      assignPublicIp = "DISABLED"
    }
  } | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($networkPath, $networkConfiguration, $utf8)

  Assert-QaWritersStopped
  $qaFreeStorageBytes = Assert-QaStorageHeadroom

  $run = Invoke-AwsJson -Arguments @(
    "ecs", "run-task", "--cluster", $qaClusterName,
    "--task-definition", $registeredTaskDefinitionArn,
    "--launch-type", "FARGATE", "--count", "1",
    "--network-configuration", "file://$networkPath",
    "--started-by", "mangorts-qa-human-database-copy",
    "--enable-ecs-managed-tags",
    "--tags", "key=project,value=mangorts", "key=environment,value=qa", "key=purpose,value=one-time-dev-copy"
  )
  $runFailures = @(if ($run.PSObject.Properties.Name -contains "failures") { $run.failures })
  $runTasks = @(if ($run.PSObject.Properties.Name -contains "tasks") { $run.tasks })
  if ($runFailures.Count -ne 0 -or $runTasks.Count -ne 1) {
    throw "ECS did not start exactly one QA copy task."
  }
  $runTask = $runTasks[0]
  $taskArn = if ($runTask.PSObject.Properties.Name -contains "taskArn") { [string]$runTask.taskArn } else { "" }
  if ($taskArn -notmatch '^arn:aws:ecs:us-west-1:686458136219:task/mangorts-qa-cluster/[0-9a-f]+$') {
    throw "ECS returned an unexpected QA copy task identity."
  }
  Write-Host "Started guarded QA copy task: $taskArn"

  $deadline = (Get-Date).AddHours(3)
  $taskRecord = $null
  $lastStatus = ""
  while ((Get-Date) -lt $deadline) {
    Assert-QaWritersStopped -AllowedTaskArn $taskArn
    $description = Invoke-AwsJson -Arguments @(
      "ecs", "describe-tasks", "--cluster", $qaClusterName, "--tasks", $taskArn
    )
    $descriptionFailures = @(if ($description.PSObject.Properties.Name -contains "failures") { $description.failures })
    $descriptionTasks = @(if ($description.PSObject.Properties.Name -contains "tasks") { $description.tasks })
    if ($descriptionFailures.Count -ne 0 -or $descriptionTasks.Count -ne 1) {
      throw "Could not read the exact QA copy task."
    }
    $taskRecord = $descriptionTasks[0]
    $lastStatus = if ($taskRecord.PSObject.Properties.Name -contains "lastStatus") { [string]$taskRecord.lastStatus } else { "" }
    if ([string]::IsNullOrWhiteSpace($lastStatus)) { throw "Exact QA copy task did not report a status." }
    if ($lastStatus -ceq "RUNNING" -and $policyAttached) {
      Invoke-AwsNoOutput -Arguments @(
        "iam", "delete-role-policy", "--role-name", $executionRoleName,
        "--policy-name", $temporaryExecutionPolicyName
      )
      $policyAttached = $false
      Write-Host "Removed temporary Dev-secret permission after ECS injected task secrets."
    }
    if ($lastStatus -ceq "STOPPED") { break }
    Start-Sleep -Seconds 10
  }
  if ($null -eq $taskRecord -or $lastStatus -cne "STOPPED") {
    throw "Timed out waiting for the QA copy task to stop."
  }
  Assert-QaWritersStopped

  $taskContainers = @(if ($taskRecord.PSObject.Properties.Name -contains "containers") { $taskRecord.containers })
  $containers = @($taskContainers | Where-Object { $_.PSObject.Properties.Name -contains "name" -and [string]$_.name -ceq $qaCopyContainerName })
  if ($containers.Count -ne 1) {
    throw "QA copy task stopped without exactly one reviewed container."
  }
  $container = $containers[0]
  $containerExitCode = if ($container.PSObject.Properties.Name -contains "exitCode" -and $null -ne $container.exitCode) {
    [int]$container.exitCode
  }
  else {
    $null
  }
  if ($null -eq $containerExitCode) {
    $taskStopReason = if ($taskRecord.PSObject.Properties.Name -contains "stoppedReason") { [string]$taskRecord.stoppedReason } else { "not reported" }
    $containerReason = if ($container.PSObject.Properties.Name -contains "reason") { [string]$container.reason } else { "not reported" }
    throw "QA copy task stopped before reporting an exit code. Task reason: $taskStopReason Container reason: $containerReason"
  }

  $taskID = ($taskArn -split '/')[-1]
  $logStream = "ecs/$qaCopyContainerName/$taskID"
  $logDeadline = (Get-Date).AddMinutes(5)
  $failureLogDeadline = (Get-Date).AddSeconds(30)
  $messages = @()
  do {
    try {
      $logs = Invoke-AwsJson -Arguments @(
        "logs", "filter-log-events", "--log-group-name", $qaLogGroup,
        "--log-stream-names", $logStream
      )
      $messages = @($logs.events | ForEach-Object { [string]$_.message })
    }
    catch {
      $messages = @()
    }
    $successAttestations = @($messages | Where-Object { $_ -ceq "QA_COPY_STATUS=success" })
    if ($successAttestations.Count -eq 1) { break }
    if ([int]$containerExitCode -ne 0 -and (Get-Date) -ge $failureLogDeadline) { break }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $logDeadline)

  foreach ($message in $messages) { Write-Host $message }

  if ([int]$containerExitCode -ne 0) {
    throw "QA copy task failed with exit code $containerExitCode. The API remains stopped; snapshot $snapshotID is retained."
  }
  if ($successAttestations.Count -ne 1) {
    throw "QA copy task exited zero without one exact success attestation."
  }
  Assert-QaWritersStopped
  $taskSucceeded = $true
}
finally {
  if (-not [string]::IsNullOrWhiteSpace($taskArn) -and -not $taskSucceeded) {
    try {
      Invoke-AwsNoOutput -Arguments @(
        "ecs", "stop-task", "--cluster", $qaClusterName, "--task", $taskArn,
        "--reason", "QA copy launcher exited before a verified success"
      )
      & aws ecs wait tasks-stopped --cluster $qaClusterName --tasks $taskArn `
        --profile $AwsProfile --region $AwsRegion | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "ECS did not confirm the exact QA copy task stopped." }
    }
    catch {
      Write-Warning "Could not confirm the exact QA copy task stopped: $taskArn"
    }
  }
  if ($policyAttached) {
    try {
      Invoke-AwsNoOutput -Arguments @(
        "iam", "delete-role-policy", "--role-name", $executionRoleName,
        "--policy-name", $temporaryExecutionPolicyName
      )
    }
    catch {
      Write-Warning "Could not remove temporary execution-role policy; remove exact policy $temporaryExecutionPolicyName from $executionRoleName immediately."
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($registeredTaskDefinitionArn)) {
    try {
      Invoke-AwsNoOutput -Arguments @(
        "ecs", "deregister-task-definition", "--task-definition", $registeredTaskDefinitionArn
      )
    }
    catch {
      Write-Warning "Could not deregister exact temporary task definition $registeredTaskDefinitionArn."
    }
  }
  if (-not $secretDeletionScheduled) {
    try {
      Invoke-AwsNoOutput -Arguments @(
        "secretsmanager", "delete-secret", "--secret-id", $DevReadOnlySecretArn,
        "--recovery-window-in-days", "7"
      )
      $secretDeletionScheduled = $true
    }
    catch {
      Write-Warning "Could not schedule exact temporary Dev read-only secret for deletion: $DevReadOnlySecretArn"
    }
  }
  foreach ($path in @($policyPath, $taskDefinitionPath, $networkPath)) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path -PathType Leaf)) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}

if (-not $taskSucceeded) {
  throw "QA copy did not complete successfully."
}

Write-Host "QA one-time cleaned copy and database cutover completed."
Write-Host "Task: $taskArn"
Write-Host "Snapshot retained: $snapshotID"
Write-Host "Old QA database retained: $rollbackDatabase"
Write-Host "Temporary Dev read-only secret scheduled for deletion with a 7-day recovery window."
