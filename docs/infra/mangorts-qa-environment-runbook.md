# MangoRTS QA Environment Runbook

QA is the isolated application at `https://qa.mangorts.com`. It reuses the
existing QA CloudFront, ALB, ECS, Cognito, S3, SQS, Valkey, WAF, monitoring, and
private PostgreSQL 17 RDS resources. It does not create another permanent
environment.

The first QA dataset is a one-time cleaned Dev copy. The binding rules are in
`docs/tests/qa-database-copy.md`. The copy omits every attachment and removes the
listed private explorer trees plus their owned content. A non-owning edge is
removed without deleting its unrelated allowed endpoint.

## Verified Starting State On 2026-08-27

- DNS delegation and certificates for `qa.mangorts.com`,
  `api.qa.mangorts.com`, and `origin.qa.mangorts.com` are valid.
- Private RDS `mangorts-qa-postgres` is PostgreSQL 17.7, Single-AZ, encrypted,
  and available.
- The API desired/running count is zero, the frontend bucket is empty, the QA
  Cognito pool has no users, and all three QA email queues are empty.
- The public frontend currently returns 403 and API paths return 503 because no
  application has been published or started.
- The last QA images and schema bootstrap came from commit `371695f4` with 215
  baselined migrations. Current `main` has more migrations.
- `20260825_canonical_schema_reconciliation.sql` is a historical repository
  migration. Do not run its retired one-missing-migration recovery path against
  QA. Build a fresh same-commit next database instead.
- The email worker stays disabled until separate QA Nylas staging credentials
  and controlled mailboxes exist.

## Safety Boundary

1. Agents may inspect only through database-enforced read-only access. Only a
   human may use the QA writer or start a hosted task that receives its secret.
2. Never write Dev or production, reveal a writer password, or make QA RDS
   public.
3. Keep the QA API, email worker, Scheduler, and all one-off ECS tasks stopped
   from the raw copy through cutover.
4. Use PostgreSQL 17 clients from an approved private operator host. Keep
   credentials only in the human operator's libpq password source.
5. Keep dumps on an encrypted, access-restricted temporary volume outside the
   repository. Remove them at the exact cleanup points below.
6. Dev `schema_migrations`, Cognito subjects, provider grants/cursors, jobs,
   queue state, invitation/reset state, and attachment state never enter active
   QA.
7. Stop on every failed native command, account/host mismatch, unexpected row
   count, missing root, schema mismatch, orphan, or storage shortfall.

## Required Human Inputs

- Restored `gh` authentication for `ScoobyXD/MangoRTSDev`.
- AWS SSO access to account `686458136219` in `us-west-1`.
- An approved private route to Dev and QA PostgreSQL.
- A Dev database-enforced read-only credential and a separate human-only QA
  admin credential, both in an approved libpq password file.
- An out-of-repository Terraform backend config for the existing QA state.
- An encrypted, access-restricted temporary directory outside this repository.
- PostgreSQL 17 `psql`, `createdb`, `dropdb`, `pg_dump`, and `pg_restore`.
- Jonat's exact QA email: `jonathankim829@gmail.com`.
- Andy and Rohan's exact emails remain pending. Do not guess them.
- A separate Nylas Staging application and controlled QA mailboxes are a later
  human provider step.

## Phase 0: Start One Fail-Closed Human Session

Use PowerShell 7 for the whole procedure. Do not run isolated later blocks in a
fresh shell without rerunning this phase.

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

function Assert-NativeSuccess([string]$Operation) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed with native exit code $LASTEXITCODE"
  }
}

$repoRoot = (git rev-parse --show-toplevel).Trim()
Assert-NativeSuccess "locate MangoRTS repository"
Set-Location $repoRoot

$pgBin = (Resolve-Path -LiteralPath $env:MANGORTS_PG17_BIN).Path
$psql = Join-Path $pgBin "psql.exe"
$createdb = Join-Path $pgBin "createdb.exe"
$dropdb = Join-Path $pgBin "dropdb.exe"
$pgDump = Join-Path $pgBin "pg_dump.exe"
$pgRestore = Join-Path $pgBin "pg_restore.exe"
foreach ($tool in @($psql, $createdb, $dropdb, $pgDump, $pgRestore)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
    throw "Missing PostgreSQL 17 tool: $tool"
  }
  $version = (& $tool --version).Trim()
  Assert-NativeSuccess "read $tool version"
  if ($version -notmatch 'PostgreSQL\) 17\.') {
    throw "PostgreSQL 17.x is required; got: $version"
  }
}

if (-not (Test-Path -LiteralPath $env:PGPASSFILE -PathType Leaf)) {
  throw "PGPASSFILE must name the human operator's approved credential file"
}
$env:PGSSLMODE = "require"

$temporaryRoot = (Resolve-Path -LiteralPath $env:MANGORTS_QA_TEMP).Path
if ($temporaryRoot.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "MANGORTS_QA_TEMP must be an encrypted directory outside the repository"
}
$rawDump = Join-Path $temporaryRoot "dev-raw.dump"
$sanitizedDump = Join-Path $temporaryRoot "qa-sanitized-data.dump"
```

## Phase 1: Pin Main, Read Existing QA State, And Park Writers

Merge the reviewed worker commit into `main` first. Do not deploy from a feature
branch.

```powershell
git fetch origin
Assert-NativeSuccess "git fetch origin"
git switch main
Assert-NativeSuccess "git switch main"
git pull --ff-only
Assert-NativeSuccess "fast-forward main"
$releaseCommit = (git rev-parse HEAD).Trim()
Assert-NativeSuccess "read release commit"
if ($releaseCommit -cnotmatch '^[0-9a-f]{40}$') { throw "Invalid release SHA" }

gh auth status
Assert-NativeSuccess "GitHub authentication"
$repository = (gh repo view --json nameWithOwner --jq .nameWithOwner).Trim()
Assert-NativeSuccess "read GitHub repository identity"
if ($repository -cne "ScoobyXD/MangoRTSDev") { throw "Wrong GitHub repository: $repository" }

aws sso login --profile mangorts-dev
Assert-NativeSuccess "AWS SSO login"
$awsAccount = (aws sts get-caller-identity --profile mangorts-dev --region us-west-1 --query Account --output text).Trim()
Assert-NativeSuccess "read AWS account"
if ($awsAccount -cne "686458136219") { throw "Wrong AWS account: $awsAccount" }

.\scripts\qa_environment_preflight.ps1 `
  -ExpectedAwsAccountID 686458136219 `
  -PostgresBin $pgBin `
  -JonatQaEmail jonathankim829@gmail.com
```

The repository preflight now rechecks the authenticated AWS account, GitHub
session, required files, exact email, and PostgreSQL client major version.

Initialize the existing remote QA state with the human-supplied config. Never
invent a bucket or state key:

```powershell
$qaBackendConfig = (Resolve-Path -LiteralPath $env:MANGORTS_QA_BACKEND_CONFIG).Path
terraform -chdir=infra/aws-qa init -reconfigure "-backend-config=$qaBackendConfig"
Assert-NativeSuccess "initialize existing QA Terraform state"
$qaOutputs = terraform -chdir=infra/aws-qa output -json | ConvertFrom-Json
Assert-NativeSuccess "read QA Terraform outputs"

$qaCluster = [string]$qaOutputs.ecs_cluster_name.value
$qaApiService = [string]$qaOutputs.ecs_service_name.value
$qaWorkerService = [string]$qaOutputs.email_worker_service_name.value
$qaRdsIdentifier = [string]$qaOutputs.database_instance_identifier.value
$qaHost = [string]$qaOutputs.database_endpoint.value
$qaPort = 5432
$qaCognitoPool = [string]$qaOutputs.cognito_user_pool_id.value
$qaCognitoRegion = [string]$qaOutputs.cognito_region.value
if ($qaRdsIdentifier -cne "mangorts-qa-postgres" -or
    $qaHost -notmatch '(^|[-.])qa([-.]|$)' -or
    $qaHost -match '(^|[-.])(dev|prod)([-.]|$)' -or
    $qaCognitoRegion -cne "us-west-1") {
  throw "Reviewed QA Terraform outputs do not identify the exact QA targets"
}

$qaRds = aws rds describe-db-instances --profile mangorts-dev --region us-west-1 `
  --db-instance-identifier $qaRdsIdentifier --output json | ConvertFrom-Json
Assert-NativeSuccess "read exact QA RDS identity"
$qaInstances = @($qaRds.DBInstances)
if ($qaInstances.Count -ne 1) { throw "Expected exactly one QA RDS instance" }
$qaDb = $qaInstances[0]
if ($qaDb.Endpoint.Address -cne $qaHost -or $qaDb.DBName -cne "mangorts_qa" -or
    $qaDb.Engine -cne "postgres" -or $qaDb.EngineVersion -notmatch '^17\.') {
  throw "Live RDS identity differs from reviewed QA Terraform state"
}
$qaUser = [string]$qaDb.MasterUsername
```

Dispatch only the exact pinned commit. The workflow independently fails if
`main` moved:

```powershell
gh variable set TF_EMAIL_SCHEMA_MIGRATED --env qa --body false
Assert-NativeSuccess "park QA schema gate"
gh variable set TF_EMAIL_WORKER_ENABLED --env qa --body false
Assert-NativeSuccess "park QA worker"
gh variable set TF_EMAIL_SCHEDULE_ENABLED --env qa --body false
Assert-NativeSuccess "park QA Scheduler"
gh workflow run deploy-qa.yml --ref main `
  -f stage=bootstrap-images `
  -f "expected_git_commit=$releaseCommit"
Assert-NativeSuccess "dispatch exact QA bootstrap-images run"
```

Wait for that run and inspect its summary. It must report the exact revision,
the matching `<sha>` and `<sha>-migrations` images, API desired zero, worker
disabled, and schema confirmation false. Refresh the outputs after the workflow
applies the new revision:

```powershell
$qaOutputs = terraform -chdir=infra/aws-qa output -json | ConvertFrom-Json
Assert-NativeSuccess "refresh applied QA Terraform outputs"
$qaWorkerService = [string]$qaOutputs.email_worker_service_name.value
```

Define and run the live writer gate after the workflow, immediately before each
database restore, and immediately before cutover:

```powershell
function Assert-QaWritersStopped {
  $serviceNames = @($qaApiService, $qaWorkerService) | Where-Object { $_ }
  if ($serviceNames.Count -gt 0) {
    $services = aws ecs describe-services --profile mangorts-dev --region us-west-1 `
      --cluster $qaCluster --services $serviceNames --output json | ConvertFrom-Json
    Assert-NativeSuccess "read exact QA ECS services"
    $activeService = $services.services | Where-Object {
      $_.desiredCount -ne 0 -or $_.runningCount -ne 0 -or $_.pendingCount -ne 0
    }
    if ($activeService) { throw "QA API or worker service is not fully stopped" }
  }
  foreach ($status in @("RUNNING", "PENDING")) {
    $taskArns = @(aws ecs list-tasks --profile mangorts-dev --region us-west-1 `
      --cluster $qaCluster --desired-status $status --query taskArns --output text)
    Assert-NativeSuccess "list $status QA ECS tasks"
    if (($taskArns -join '').Trim()) { throw "A $status QA ECS task remains" }
  }
  $schedules = aws scheduler list-schedules --profile mangorts-dev --region us-west-1 `
    --group-name mangorts-qa-email-reconciliation --output json | ConvertFrom-Json
  Assert-NativeSuccess "read exact QA Scheduler group"
  if ($schedules.Schedules | Where-Object { $_.State -eq "ENABLED" }) {
    throw "The QA reconciliation Scheduler is enabled"
  }
}
Assert-QaWritersStopped
```

Create and wait for a QA-only manual snapshot:

```powershell
$snapshotID = "mangorts-qa-before-clean-copy-$(Get-Date -Format yyyyMMddHHmmss)"
aws rds create-db-snapshot --profile mangorts-dev --region us-west-1 `
  --db-instance-identifier $qaRdsIdentifier `
  --db-snapshot-identifier $snapshotID
Assert-NativeSuccess "create QA snapshot"
aws rds wait db-snapshot-completed --profile mangorts-dev --region us-west-1 `
  --db-snapshot-identifier $snapshotID
Assert-NativeSuccess "wait for QA snapshot"
```

Check the three exact QA queues. All visible and in-flight counts must be zero.
If any count is nonzero, stop. Purging an exact QA queue is a separate human
decision after reviewing its messages.

```powershell
$qaQueueUrls = @(
  [string]$qaOutputs.email_work_queue_url.value,
  [string]$qaOutputs.email_work_dlq_url.value,
  [string]$qaOutputs.email_scheduler_dlq_url.value
)
foreach ($queueUrl in $qaQueueUrls) {
  if (-not $queueUrl -or $queueUrl -notmatch 'mangorts-qa') { throw "Unexpected QA queue URL" }
  $queueState = aws sqs get-queue-attributes --profile mangorts-dev --region us-west-1 `
    --queue-url $queueUrl --attribute-names `
    ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed `
    --output json | ConvertFrom-Json
  Assert-NativeSuccess "read exact QA queue depth"
  foreach ($value in $queueState.Attributes.PSObject.Properties.Value) {
    if ([int64]$value -ne 0) { throw "QA queue is not empty: $queueUrl" }
  }
}
```

Valkey is already a separate QA cache. Prove the exact cache and Pub/Sub-only
user ACL. Mango cannot create persistent keys under this ACL; do not widen it or
invent a `FLUSHALL` path.

```powershell
$qaValkeyName = [string]$qaOutputs.realtime_valkey_cache_name.value
$qaValkeyUser = [string]$qaOutputs.realtime_valkey_user_id.value
if ($qaValkeyName -notmatch '^mangorts-qa-' -or $qaValkeyUser -notmatch '^mangorts-qa-') {
  throw "Valkey output is not QA-owned"
}
aws elasticache describe-serverless-caches --profile mangorts-dev --region us-west-1 `
  --serverless-cache-name $qaValkeyName --output json | Out-Null
Assert-NativeSuccess "verify exact QA Valkey cache"
$valkeyAcl = (aws elasticache describe-users --profile mangorts-dev --region us-west-1 `
  --user-id $qaValkeyUser --query 'Users[0].AccessString' --output text).Trim()
Assert-NativeSuccess "verify exact QA Valkey user"
foreach ($requiredAclTerm in @('-@all', '+@connection', '+@pubsub')) {
  if ($valkeyAcl -notlike "*$requiredAclTerm*") { throw "Unexpected QA Valkey ACL" }
}
```

## Phase 2: Prove The Exact Dev Source And Storage Headroom

Use the same explicit read-only tuple for inventory and dump. The host must be
Dev-marked and must not be QA/prod-marked.

```powershell
$devHost = [string]$env:DB_HOST
$devPort = [string]$env:DB_PORT
$devDatabase = [string]$env:DB_NAME
$devUser = [string]$env:DB_USER
if (-not $devHost -or $devHost -notmatch '(^|[-.])dev(cluster)?([-.]|$)' -or
    $devHost -match '(^|[-.])(qa|prod)([-.]|$)') {
  throw "DB_HOST is not the reviewed Dev endpoint"
}

.\scripts\export_schema_inventory.ps1 `
  -EnvironmentLabel dev `
  -ExpectedHost $devHost `
  -ExpectedDatabase $devDatabase `
  -ExpectedReadOnlyUser $devUser `
  -OutputPath .\tmp\schema-audit-dev-fresh.json `
  -ConfirmDatabaseEnforcedReadOnlyCredential

$devInventory = Get-Content .\tmp\schema-audit-dev-fresh.json -Raw | ConvertFrom-Json
$sourceSchemaSHA = [string]$devInventory.metadata.schema_inventory_sha256
$repositorySHA = [string]$devInventory.metadata.repository_schema_sha256
$inventoryCommit = [string]$devInventory.metadata.git_commit
if ($inventoryCommit -cne $releaseCommit) { throw "Dev inventory commit mismatch" }
```

Stop if the export is older than 24 hours, is not PostgreSQL 17.x, or its
repository fingerprint/commit differs from the release. The Dev catalog hash is
evidence about the read-only source; it is not the expected QA target hash.
`qa_dev_copy_preflight.sql` permits only the audited exact current Entity and
Huddle Node workspace column sets, rejects obsolete Entity tables, validates
every current Entity relationship endpoint, and requires the corresponding
20260827/20260828 Dev ledger rows to remain absent. Current allowed Entity,
Action Item, relationship, document, and chat rows are source business data;
their aggregate counts are reported without printing their contents. If the
schema or relationship shape changes, stop and reassess. Do not run
`20260825_canonical_schema_reconciliation.sql` on Dev or use it to force a hash;
the fresh next database is built from the release's canonical migrations.

The 2026-08-29 read-only inventory also pinned the exact Company Explorer
folder identities for all ten required private trees. Several Finance, HR, and
Legal labels had changed, so folder names are not deletion authority. The
preflight stops if any pinned identity is missing, the sanitizer follows those
identities through renames and moves, and final verification requires every
pinned identity to be absent. The original ten normalized names remain an
additional any-depth denylist. Re-audit and update the reviewed manifest rather
than guessing if a pinned identity changes before the copy runs.

Measure the source through the same read-only tuple and compare it to current QA
free storage. The raw database is dropped before the next database is built, so
only one extra full copy exists at a time. Require at least 1.5 times the source
size free for copy and restore workspace:

```powershell
$sourceDatabaseBytes = [int64](& $psql --host $devHost --port $devPort `
  --username $devUser --dbname $devDatabase --no-password --no-psqlrc `
  --tuples-only --no-align --command "select pg_database_size(current_database());").Trim()
Assert-NativeSuccess "measure Dev through the exact read-only tuple"

$metricEnd = (Get-Date).ToUniversalTime()
$metricStart = $metricEnd.AddMinutes(-20)
$freeStorageText = (aws cloudwatch get-metric-statistics --profile mangorts-dev `
  --region us-west-1 --namespace AWS/RDS --metric-name FreeStorageSpace `
  --dimensions "Name=DBInstanceIdentifier,Value=$qaRdsIdentifier" `
  --start-time $metricStart.ToString('o') --end-time $metricEnd.ToString('o') `
  --period 300 --statistics Minimum `
  --query 'sort_by(Datapoints,&Timestamp)[-1].Minimum' --output text).Trim()
Assert-NativeSuccess "read QA RDS free storage"
if ($freeStorageText -notmatch '^\d+(\.\d+)?$') { throw "No current QA storage metric" }
$requiredFreeBytes = [int64][Math]::Ceiling($sourceDatabaseBytes * 1.5)
if ([double]$freeStorageText -lt $requiredFreeBytes) {
  throw "QA lacks storage headroom; review a QA-only storage increase and cost"
}
```

## Phase 3: Run The Guarded AWS Copy

The preferred one-time path is the temporary Fargate task built as
`<release-commit>-qa-copy` by the QA `bootstrap-images` workflow. It has no task
role or public IP, receives the QA managed password and temporary Dev read-only
login only through ECS secret injection, keeps both compressed dumps on task
ephemeral storage, and removes the raw scratch database on exit. It builds and
verifies the fresh same-commit target before retaining the old QA database under
a timestamped rollback name and cutting over the stable `mangorts_qa` name.
The launcher refuses a source above 4 GiB, requires at least 12 GiB of recent QA
RDS free storage, and repeats the storage and stopped-writer checks immediately
before launch. During the fresh data restore, only public user triggers are
temporarily disabled; constraint triggers stay active, and the verifier requires
every public user trigger to be enabled again before cutover.

The temporary Dev secret must be less than 24 hours old, contain only JSON keys
`username` and `password`, use the exact prefix
`mangorts/qa-copy/dev-readonly-temp-`, and have tags `Environment=qa`,
`Purpose=dev-readonly-source`, and `Temporary=true`. Never put the QA database
password in that secret; QA continues to use the RDS-managed secret.

An agent may run the launcher's plan-only guard, but QDC2 permits only Jonat to
pass its execution switches and typed confirmation:

```powershell
.\scripts\qa_run_data_copy_task.ps1 `
  -ExpectedGitCommit $releaseCommit `
  -DevReadOnlySecretArn $devReadOnlySecretArn

# Human operator only:
.\scripts\qa_run_data_copy_task.ps1 `
  -ExpectedGitCommit $releaseCommit `
  -DevReadOnlySecretArn $devReadOnlySecretArn `
  -Execute -HumanOperatorApproval
```

The execution path verifies stopped writers and empty QA queues, creates and
waits for a manual QA snapshot, gets or creates only Jonat's approved QA Cognito
user, launches exactly one task, monitors its exact logs and exit code, removes
the temporary IAM permission/task definition, and schedules the temporary Dev
secret for deletion. It does not create Andy or Rohan because their emails are
not approved yet. Keep the API stopped until the final task attestation and the
post-copy checks in Phase 7 pass.

### Manual fallback: create, sanitize, and remove the raw scratch database

Bind every QA client directly to the reviewed Terraform host, port, and user.
Do not use a service-name alias for writes.

```powershell
$qaIdentity = (& $psql --host $qaHost --port $qaPort --username $qaUser `
  --dbname postgres --no-password --no-psqlrc --tuples-only --no-align `
  --command "select concat_ws('|', current_database(), current_user, current_setting('server_version_num'), case when pg_is_in_recovery() then 'recovery' else 'primary' end);").Trim()
Assert-NativeSuccess "verify exact QA writer target"
if ($qaIdentity -notmatch "^postgres\|$([regex]::Escape($qaUser))\|17\d{4}\|primary$") {
  throw "QA writer identity/version mismatch: $qaIdentity"
}

$rawDatabase = "mangorts_qa_raw_$(Get-Date -Format yyyyMMdd_HHmmss)"
$nextDatabase = "mangorts_qa_next_$(Get-Date -Format yyyyMMddHHmmss)"
if ($rawDatabase -cnotmatch '^mangorts_qa_raw_[0-9]{8}_[0-9]{6}$' -or
    $nextDatabase -cnotmatch '^mangorts_qa_next_[0-9]{14}$') {
  throw "Generated database name failed its guard"
}

Assert-QaWritersStopped
& $createdb --host $qaHost --port $qaPort --username $qaUser `
  --maintenance-db postgres --no-password $rawDatabase
Assert-NativeSuccess "create exact QA raw database"

& $pgDump --host $devHost --port $devPort --username $devUser `
  --dbname $devDatabase --no-password --format custom --no-owner --no-privileges `
  --file $rawDump
Assert-NativeSuccess "dump Dev through the exact read-only tuple"

Assert-QaWritersStopped
& $pgRestore --host $qaHost --port $qaPort --username $qaUser `
  --dbname $rawDatabase --no-password --exit-on-error --no-owner --no-privileges `
  $rawDump
Assert-NativeSuccess "restore into exact QA raw database"
```

Run the read-only preflight, one-transaction sanitizer, and read-only verifier
against this exact isolated raw database. Do not rerun the Entity, Action Item,
Entity relationship, Huddle workspace, or canonical reconciliation migrations
in the raw database: the audited source already has that current DDL, and its
ledger is deliberately excluded. The fresh next database owns the complete
repository migration set.

```powershell
foreach ($sqlFile in @(
  ".\scripts\qa_dev_copy_preflight.sql",
  ".\scripts\qa_dev_copy_sanitize.sql",
  ".\scripts\qa_dev_copy_verify.sql"
)) {
  & $psql --host $qaHost --port $qaPort --username $qaUser `
    --dbname $rawDatabase --no-password --no-psqlrc `
    --set ON_ERROR_STOP=on --file $sqlFile
  Assert-NativeSuccess "run $sqlFile against exact QA raw database"
}
```

Stop on any error or unexpected count. Export data only, excluding the Dev
migration ledger. Validate the custom archive and record its SHA-256:

```powershell
& $pgDump --host $qaHost --port $qaPort --username $qaUser `
  --dbname $rawDatabase --no-password --data-only --format custom `
  --no-owner --no-privileges --exclude-table-data public.schema_migrations `
  --file $sanitizedDump
Assert-NativeSuccess "export sanitized QA data"
& $pgRestore --list $sanitizedDump | Out-Null
Assert-NativeSuccess "validate sanitized dump archive"
$sanitizedDumpSHA256 = (Get-FileHash -LiteralPath $sanitizedDump -Algorithm SHA256).Hash
```

The raw dump and raw database are no longer needed. Type the exact generated
database name before deleting either exact raw target:

```powershell
if ((Read-Host "Type the exact raw database name to remove") -cne $rawDatabase) {
  throw "Raw database cleanup not confirmed"
}
& $dropdb --host $qaHost --port $qaPort --username $qaUser `
  --maintenance-db postgres --no-password $rawDatabase
Assert-NativeSuccess "drop exact QA raw database"
Remove-Item -LiteralPath $rawDump -Force
```

## Phase 4: Build And Verify The Same-Commit Next Database

```powershell
& $createdb --host $qaHost --port $qaPort --username $qaUser `
  --maintenance-db postgres --no-password $nextDatabase
Assert-NativeSuccess "create exact QA next database"

$qaDatabaseTask = @{
  ExpectedAwsAccountID       = "686458136219"
  Cluster                    = $qaCluster
  TaskDefinition             = [string]$qaOutputs.database_migration_task_definition_arn.value
  ContainerName              = [string]$qaOutputs.database_migration_container_name.value
  DatabaseInstanceIdentifier = $qaRdsIdentifier
  SubnetIDs                  = @($qaOutputs.ecs_private_subnet_ids.value)
  SecurityGroupIDs           = @([string]$qaOutputs.ecs_security_group_id.value)
  ExpectedRepositorySchemaSHA256 = $repositorySHA
  ExpectedGitCommit          = $releaseCommit
  DatabaseNameOverride       = $nextDatabase
}
```

Only a human may use the following switches. The helper returns each completed
task ARN so the next guarded step uses that exact task without manual copying:

```powershell
$emptyAuditOutput = @(
  .\scripts\qa_run_database_task.ps1 @qaDatabaseTask `
    -Action Audit -AuditPurpose EmptyPreflight `
    -Execute -HumanOperatorApproval
)
$emptyAuditTaskLines = @($emptyAuditOutput | Where-Object {
  [string]$_ -match '^QA_DATABASE_TASK_ARN=arn:aws:ecs:[^:]+:[0-9]{12}:task/.+$'
})
if ($emptyAuditTaskLines.Count -ne 1) {
  throw "Empty audit did not return exactly one ECS task ARN"
}
$emptyAuditTaskArn = ([string]$emptyAuditTaskLines[0]).Split('=',2)[1]

$bootstrapOutput = @(
  .\scripts\qa_run_database_task.ps1 @qaDatabaseTask `
    -Action Bootstrap `
    -EmptyDatabaseAuditTaskArn $emptyAuditTaskArn `
    -Execute -HumanOperatorApproval
)
$bootstrapTaskLines = @($bootstrapOutput | Where-Object {
  [string]$_ -match '^QA_DATABASE_TASK_ARN=arn:aws:ecs:[^:]+:[0-9]{12}:task/.+$'
})
if ($bootstrapTaskLines.Count -ne 1) {
  throw "Bootstrap did not return exactly one ECS task ARN"
}
$bootstrapTaskArn = ([string]$bootstrapTaskLines[0]).Split('=',2)[1]

$baselineOutput = @(
  .\scripts\qa_run_database_task.ps1 @qaDatabaseTask `
    -Action Audit -AuditPurpose CanonicalBaseline `
    -CanonicalBootstrapTaskArn $bootstrapTaskArn `
    -Execute -HumanOperatorApproval
)
$baselineLines = @($baselineOutput | Where-Object {
  [string]$_ -match '^CANONICAL_SCHEMA_INVENTORY_SHA256=[0-9a-f]{64}$'
})
if ($baselineLines.Count -ne 1) {
  throw "Canonical baseline audit did not return exactly one schema hash"
}
$schemaSHA = ([string]$baselineLines[0]).Split('=',2)[1]
```

The canonical baseline audit must report PostgreSQL 17.x, the exact repository
hash, and zero missing or unknown migration filenames. It records the clean
same-commit target schema hash before imported data can affect the database.

Restore with all constraints active, then run real foreign-key and exact typed
reference checks:

```powershell
Assert-QaWritersStopped
& $pgRestore --host $qaHost --port $qaPort --username $qaUser `
  --dbname $nextDatabase --no-password --single-transaction --exit-on-error `
  --no-owner --no-privileges $sanitizedDump
Assert-NativeSuccess "restore sanitized data into exact QA next database"

& $psql --host $qaHost --port $qaPort --username $qaUser `
  --dbname $nextDatabase --no-password --no-psqlrc `
  --set ON_ERROR_STOP=on --file .\scripts\qa_dev_copy_verify.sql
Assert-NativeSuccess "verify exact QA next database"

.\scripts\qa_run_database_task.ps1 @qaDatabaseTask `
  -Action Audit -AuditPurpose Parity `
  -ExpectedSchemaInventorySHA256 $schemaSHA `
  -Execute -HumanOperatorApproval
```

This parity audit is mandatory before identity binding or cutover. It proves the
data restore did not change the clean canonical schema baseline.

## Phase 5: Create Jonat's QA Identity And Select His Company

Use the reviewed Terraform Cognito pool, not a hardcoded pool ID:

```powershell
aws cognito-idp describe-user-pool --profile mangorts-dev --region $qaCognitoRegion `
  --user-pool-id $qaCognitoPool --output json | Out-Null
Assert-NativeSuccess "verify exact QA Cognito pool"
aws cognito-idp admin-create-user --profile mangorts-dev --region $qaCognitoRegion `
  --user-pool-id $qaCognitoPool --username jonathankim829@gmail.com `
  --user-attributes Name=email,Value=jonathankim829@gmail.com Name=email_verified,Value=true
Assert-NativeSuccess "create Jonat QA Cognito user"
$jonatSub = (aws cognito-idp admin-get-user --profile mangorts-dev `
  --region $qaCognitoRegion --user-pool-id $qaCognitoPool `
  --username jonathankim829@gmail.com `
  --query "UserAttributes[?Name=='sub'].Value | [0]" --output text).Trim()
Assert-NativeSuccess "read Jonat QA Cognito subject"
if ($jonatSub -notmatch '^[0-9a-f-]{36}$') { throw "Unexpected Cognito subject" }
```

In DBeaver or `psql`, connect to the exact next database and bind exactly one
normalized copied user. Replace only the subject placeholder:

```sql
BEGIN;
DO $qa_identity$
DECLARE
  qa_email constant text := 'jonathankim829@gmail.com';
  qa_subject constant text := 'REPLACE_WITH_JONATS_QA_COGNITO_SUB';
  matched integer;
BEGIN
  IF qa_subject = 'REPLACE_WITH_JONATS_QA_COGNITO_SUB' OR btrim(qa_subject) = '' THEN
    RAISE EXCEPTION 'STOP: set Jonat''s exact QA Cognito subject';
  END IF;
  SELECT count(*) INTO matched FROM users
  WHERE lower(btrim(email)) = qa_email;
  IF matched <> 1 THEN
    RAISE EXCEPTION 'STOP: expected exactly one copied Jonat user, found %', matched;
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE cognito_subject = qa_subject) THEN
    RAISE EXCEPTION 'STOP: QA Cognito subject is already bound';
  END IF;
  UPDATE users
  SET cognito_subject = qa_subject, updated_timestamp = now()
  WHERE lower(btrim(email)) = qa_email
    AND cognito_subject = 'qa-disabled:' || user_id::text;
  GET DIAGNOSTICS matched = ROW_COUNT;
  IF matched <> 1 THEN
    RAISE EXCEPTION 'STOP: Jonat row was not in the expected inert state';
  END IF;
END
$qa_identity$;
COMMIT;
```

List Jonat's surviving company memberships using the same normalized email:

```sql
SELECT membership.company_id, company.name, membership.role
FROM users actor
JOIN company_memberships membership ON membership.user_id = actor.user_id
JOIN companies company ON company.company_id = membership.company_id
WHERE lower(btrim(actor.email)) = 'jonathankim829@gmail.com'
ORDER BY membership.company_id;
```

If there is exactly one row, run
`$jonatCompanyID = '<that-exact-company-uuid>'`. If there are multiple, Jonat
must explicitly choose the QA default from this exact list. Zero rows is a hard
stop. Run `qa_dev_copy_verify.sql` again after binding.

Andy and Rohan remain inert until their exact emails and separate QA Cognito
subjects are supplied.

## Phase 6: Controlled Database Cutover

This two-rename operation is not transactionally atomic. Connect to the
`postgres` maintenance database, rerun `Assert-QaWritersStopped`, replace the two
timestamp placeholders with the exact generated names, and execute one
statement at a time. Do not use patterns or wildcards.

```sql
ALTER DATABASE mangorts_qa WITH ALLOW_CONNECTIONS false;
ALTER DATABASE mangorts_qa_next_YYYYMMDDHHMMSS WITH ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname IN ('mangorts_qa', 'mangorts_qa_next_YYYYMMDDHHMMSS')
  AND pid <> pg_backend_pid();
ALTER DATABASE mangorts_qa RENAME TO mangorts_qa_rollback_YYYYMMDDHHMMSS;
ALTER DATABASE mangorts_qa_next_YYYYMMDDHHMMSS RENAME TO mangorts_qa;
ALTER DATABASE mangorts_qa WITH ALLOW_CONNECTIONS true;
```

If the second rename fails after the old database was renamed, immediately run
this exact recovery before doing anything else:

```sql
ALTER DATABASE mangorts_qa_rollback_YYYYMMDDHHMMSS RENAME TO mangorts_qa;
ALTER DATABASE mangorts_qa WITH ALLOW_CONNECTIONS true;
```

If the first rename fails, both original names still exist but connections are
parked. Recover them with these exact names:

```sql
ALTER DATABASE mangorts_qa WITH ALLOW_CONNECTIONS true;
ALTER DATABASE mangorts_qa_next_YYYYMMDDHHMMSS WITH ALLOW_CONNECTIONS true;
```

After successful cutover, remove the stale next-name override before auditing
the stable database:

```powershell
if (-not $qaDatabaseTask.Remove("DatabaseNameOverride")) {
  throw "DatabaseNameOverride was unexpectedly absent"
}
.\scripts\qa_run_database_task.ps1 @qaDatabaseTask `
  -Action Audit -AuditPurpose Parity `
  -ExpectedSchemaInventorySHA256 $schemaSHA `
  -Execute -HumanOperatorApproval
& $psql --host $qaHost --port $qaPort --username $qaUser `
  --dbname mangorts_qa --no-password --no-psqlrc `
  --set ON_ERROR_STOP=on --file .\scripts\qa_dev_copy_verify.sql
Assert-NativeSuccess "verify cut-over QA database"
```

If either post-cutover check fails, park writers and connect to `postgres`. Use
the exact retained names to restore rollback before investigating:

```sql
ALTER DATABASE mangorts_qa WITH ALLOW_CONNECTIONS false;
ALTER DATABASE mangorts_qa_rollback_YYYYMMDDHHMMSS WITH ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname IN ('mangorts_qa', 'mangorts_qa_rollback_YYYYMMDDHHMMSS')
  AND pid <> pg_backend_pid();
ALTER DATABASE mangorts_qa RENAME TO mangorts_qa_failed_YYYYMMDDHHMMSS;
ALTER DATABASE mangorts_qa_rollback_YYYYMMDDHHMMSS RENAME TO mangorts_qa;
ALTER DATABASE mangorts_qa WITH ALLOW_CONNECTIONS true;
```

## Phase 7: Deploy And Smoke-Test The Base Site

Set the exact company selected in Phase 5, make every mail switch explicitly
false, clear the bootstrap allowlist idempotently, and enable the schema gate:

```powershell
gh variable set TF_QA_COMPANY_ID --env qa --body $jonatCompanyID
Assert-NativeSuccess "set exact QA company"
gh variable set TF_BOOTSTRAP_ADMIN_EMAILS --env qa --body ""
Assert-NativeSuccess "clear QA bootstrap allowlist"
gh variable set TF_EMAIL_WORKER_ENABLED --env qa --body false
Assert-NativeSuccess "keep QA email worker off"
gh variable set TF_EMAIL_SCHEDULE_ENABLED --env qa --body false
Assert-NativeSuccess "keep QA email Scheduler off"
gh variable set TF_EMAIL_SCHEMA_MIGRATED --env qa --body true
Assert-NativeSuccess "enable QA schema deployment gate"

gh workflow run deploy-qa.yml --ref main `
  -f stage=deploy `
  -f "expected_git_commit=$releaseCommit"
Assert-NativeSuccess "dispatch exact QA deploy"
```

The workflow starts one API task, keeps mail processing disabled, publishes the
frontend, invalidates CloudFront, and performs revision and HTTP checks. Then
confirm:

1. `https://qa.mangorts.com/deploy-info.json` reports `$releaseCommit`.
2. `https://qa.mangorts.com/healthz` returns 200 and the same revision.
3. Unauthenticated `https://qa.mangorts.com/v1/me` returns 401.
4. The Nylas challenge route returns 200 without enabling mailbox processing.
5. ECS shows exactly one API task, zero worker tasks, and no enabled
   reconciliation Scheduler.
6. Jonat completes the QA Cognito password flow and sees the selected company,
   allowed users, assignments, chats, permissions, and business data.

## Cleanup And Rollback Ownership

Jonat owns the acceptance decision. Until he accepts the site, retain only the
exact `mangorts_qa_rollback_<timestamp>` database, exact manual snapshot, and
sanitized dump plus its SHA-256. The raw database and raw Dev dump were removed
in Phase 3.

After acceptance, type each exact retained name and remove it separately:

```powershell
if ((Read-Host "Type the exact rollback database name") -cne $rollbackDatabase) {
  throw "Rollback database cleanup not confirmed"
}
& $dropdb --host $qaHost --port $qaPort --username $qaUser `
  --maintenance-db postgres --no-password $rollbackDatabase
Assert-NativeSuccess "drop exact accepted QA rollback database"
if ((Read-Host "Type the exact snapshot ID") -cne $snapshotID) {
  throw "Snapshot cleanup not confirmed"
}
aws rds delete-db-snapshot --profile mangorts-dev --region us-west-1 `
  --db-snapshot-identifier $snapshotID
Assert-NativeSuccess "delete exact accepted QA snapshot"
Remove-Item -LiteralPath $sanitizedDump -Force
```

Before cleanup, set `$rollbackDatabase` to the exact name used in Phase 6. If
acceptance fails, park the API and mail writers, rename the failed database
aside, restore that exact rollback database to `mangorts_qa`, and rerun parity
and data verification.

## Remaining Provider And Account Handoffs

- Jonat supplies Andy and Rohan's exact emails. Create separate QA Cognito users
  and bind exactly one normalized copied row per subject.
- Jonat configures a separate Nylas Staging app and controlled QA mailboxes.
  Store those values only in QA Secrets Manager/GitHub Environment settings.
  Run a fresh schema/provider audit before deliberately enabling the worker.
- Arch's existing GitHub contributor access is sufficient. Do not give Arch AWS
  or database admin credentials. If direct inspection is later required, create
  a database-enforced QA read-only role with no Dev/prod access.

## Hard Stops

Stop immediately if:

- AWS account, repository, release SHA, RDS host, database name, Cognito pool,
  image, or Terraform state differs from the reviewed QA value;
- any API, worker, Scheduler, or one-off task is active during copy or cutover;
- a PostgreSQL client/server is not 17.x;
- source size lacks the required QA free-storage margin;
- an audited excluded folder identity is missing or any audited identity or
  denied folder name remains after sanitize;
- an attachment, provider state, active imported identity, job, orphan, or
  unknown typed reference survives;
- schema inventory or migration filenames differ from the exact release;
- a queue is nonempty or the Valkey cache/user is not QA-owned and Pub/Sub-only;
- the next database cannot pass data verification and a second parity audit;
- a native command fails; or
- the email worker would start without separate QA Nylas staging configuration.
