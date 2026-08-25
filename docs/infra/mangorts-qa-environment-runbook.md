# MangoRTS QA Environment Runbook

## Outcome

QA is an isolated, production-shaped environment at `qa.mangorts.com`. It starts with a fresh PostgreSQL database, a separate Cognito pool, and no copied dev or production data. Jonat's first authenticated request creates one company and the normal protected `Unfiled`, `Projects`, and `Logic Gates` folders. It creates no Nodes, Logic Gates, Projects, chats, permissions, GVIC assignments, or email connections. Its final steady state includes the API, one email worker, Valkey, WAF, Container Insights, and the full existing email/Valkey alarm set.

The QA stack reuses the current development AWS account, VPC, private subnets, NAT path, and deployment patterns. It owns a delegated public Route 53 hosted zone for `qa.mangorts.com`. It must not reuse a dev or production database, Cognito pool, attachment bucket, secret, Nylas application, provider grant, or Terraform state key.

## Inputs Still Needed

Collect these values before an apply or account creation:

1. Jonat's lowercase QA login email.
2. The final company display name. The current default is `Mango QA`.
3. The approved 12-digit AWS account ID and region. The expected local SSO profile defaults to `mangorts-dev` and remains overrideable.
4. The reviewed monthly QA cost estimate.
5. Andy's and Rohan's lowercase login emails and Mango roles. These are not needed for infrastructure creation.
6. Access to create a separate application in the Nylas **Staging** environment and complete any provider OAuth or MFA prompts.
7. A verified SES sender for QA invitations, or an explicit decision to leave Mango invitation email disabled until one exists.
8. Optional existing SNS or incident-response action ARNs if CloudWatch alarms should notify someone. The alarms still exist without action ARNs.
9. A GitHub `qa` Environment restricted to `main`, with Jonat as the required deployment reviewer when the repository plan supports it. Andy and Rohan need only read access to clone the repository; do not grant them QA Environment secrets or an AWS deploy role.
10. A reachable, designated database-enforced read-only dev connection for a fresh PostgreSQL 17.x schema export from the same commit as the QA migration image. Do not use the dev writer secret.
11. Explicit approval for one production Route 53 change: an `NS` delegation for `qa.mangorts.com` in the authoritative `mangorts.com` parent zone. QA automation never receives production credentials.

Do not put passwords, provider keys, OAuth state secrets, webhook secrets, AWS session credentials, or invitation tokens in this file, Terraform variables, GitHub variables, command history, or task output.

## Fixed Names

- Terraform root: `infra/aws-qa`
- App: `https://qa.mangorts.com`
- API: `https://api.qa.mangorts.com`
- Origin: `https://origin.qa.mangorts.com`
- Nylas callback: `https://api.qa.mangorts.com/nylas/oauth/callback`
- Nylas webhook: `https://api.qa.mangorts.com/nylas/webhook`
- QA DNS zone: `qa.mangorts.com`

Use QA-marked names for the database instance, database, ECS cluster, migration task definition, buckets, queues, logs, Cognito pool, Secrets Manager entries, and Terraform state key. The operator guards reject production-marked resources.

## Cost And Apply Boundary

Keep the first rollout small:

- reuse the existing VPC, private subnets, and NAT gateway;
- create only one QA-owned child hosted zone and no new root domain;
- use one small Single-AZ PostgreSQL 17.x instance;
- run only the minimum API and worker task counts needed for testing;
- do not create another VPC, NAT gateway, bastion, database replica, or Multi-AZ database;
- keep the worker temporarily disabled only while its image, schema, and Nylas dependencies do not yet exist;
- keep Valkey, WAF, Container Insights, and the alarm set enabled throughout the rollout.

The new database, load balancer, two running Fargate tasks, Valkey, WAF, Container Insights, CloudFront traffic, logs, storage, and alarms are the main added costs. Compared with the earlier stripped QA plan, the small worker plus minimum Valkey and three Nylas secrets add about `$18.35/month`; this four-rule WAF adds about `$9/month` before request charges; eleven standard metric alarms add up to about `$1.10/month` before any account free tier; and Container Insights adds usage-based metric/log charges. The delegated public QA hosted zone adds `$0.50/month` at the current first-25-zone rate, plus normal DNS query charges. See [Route 53 pricing](https://aws.amazon.com/route53/pricing/). Terraform does not produce a reliable bill by itself, so re-price the complete saved plan with current AWS pricing before applying it.

WAF means AWS Web Application Firewall. It sits at CloudFront and filters common malicious or malformed public requests before they reach Mango. The current policy deliberately allows the application API and Nylas webhook paths to reach Mango's own authentication and validation, then applies AWS common and known-bad-input managed rules to the other paths.

**STOP:** `terraform apply`, a database bootstrap task, and a database replacement/reset each require Jonat's separate approval. Approval of this runbook is not approval of an unknown plan or monthly cost.

Stop the plan if it creates a VPC, NAT gateway, public database, Multi-AZ database, replica, always-on tunnel host, or any resource outside the QA stack.

## Phase 1: Local And AWS Preflight

First obtain the AWS account ID with a read-only call and have Jonat confirm that it is the intended account:

```powershell
aws sso login --profile mangorts-dev
aws sts get-caller-identity --profile mangorts-dev --query Account --output text
```

Then run the repository preflight.

```powershell
.\scripts\qa_environment_preflight.ps1 `
  -ExpectedAwsAccountID "<approved-12-digit-account-id>" `
  -BootstrapAdminEmail "<jonat-qa-login>" `
  -CompanyName "Mango QA"
```

The preflight is read-only. It checks the AWS identity, QA domains, repository paths, bootstrap email, and required local tools.

## Phase 2: Plan The Base Stack

Use a QA-only Terraform backend key. Do not copy a dev or production state file.

First create only the QA child hosted zone from a separately reviewed saved plan:

```powershell
Set-Location infra/aws-qa
terraform init -backend-config=backend.hcl
terraform plan -target=aws_route53_zone.qa -out=qa-dns-zone.tfplan
terraform show qa-dns-zone.tfplan
```

The targeted plan itself requires explicit approval and must contain exactly one new `aws_route53_zone.qa` resource with no changes or destroys. Discard every older saved plan after changing this DNS design. After approval:

```powershell
terraform apply qa-dns-zone.tfplan
terraform output qa_dns_name_servers
```

An explicitly authorized production DNS operator must then produce a targeted saved plan for the checked-in `aws_route53_record.qa_delegation`, which manages one `NS` record named `qa.mangorts.com` in the authoritative `mangorts.com` parent using exactly the four output name servers:

```powershell
Set-Location ..\aws-prod
terraform init -backend-config=backend.hcl
terraform plan -target=aws_route53_record.qa_delegation -out=tfplan-qa-delegation -input=false
terraform show tfplan-qa-delegation
```

The saved production plan must contain exactly one addition and no changes or destroys. Do not use a full production plan or apply. After separate explicit approval for this exact production DNS change, apply only the saved targeted plan:

```powershell
terraform apply tfplan-qa-delegation
```

Do not leave a manually created delegation as the final state or give the QA GitHub role production access. Verify public delegation before continuing:

```powershell
Resolve-DnsName qa.mangorts.com -Type NS
```

The returned name servers must be the same exact set as `qa_dns_name_servers`. Stop if they differ or the public lookup returns no record.

When recovering from records previously written to the wrong parent zone, the next full QA plan must relocate exactly the two CloudFront certificate-validation records, one ALB certificate-validation record, and the `origin.qa.mangorts.com` alias. It must not replace either ACM certificate or any non-DNS QA resource. Do not remove those old records from Terraform state or delete them manually; the reviewed replacement plan owns their cleanup.

Then create and review the complete base plan:

```powershell
terraform fmt -check
terraform validate
terraform plan -out=tfplan `
  -var='backend_image_uri=' `
  -var='migration_image_uri=' `
  -var='backend_desired_count=0' `
  -var='email_worker_enabled=false' `
  -var='email_sqs_database_migration_complete=false'
terraform show tfplan
```

The final QA defaults enable the worker, Valkey, WAF, Container Insights, and alarms. The explicit first-plan overrides above are the one exception: they prevent an API or worker from starting against the empty database while leaving Valkey, WAF, Container Insights, and alarms enabled. Use a new random placeholder frontend company UUID for this first build; do not reuse the known dev UUID.

```powershell
$qaPlaceholderCompanyID = [guid]::NewGuid().ToString()
Write-Host $qaPlaceholderCompanyID
```

Record the following from the reviewed plan:

- added monthly cost estimate;
- QA RDS identifier, database name, engine version, Single-AZ setting, and `PubliclyAccessible=false`;
- QA Cognito pool and SPA client;
- QA attachment bucket;
- QA ECR repository, ECS cluster, private subnets, security group, Valkey, WAF, Container Insights setting, and alarm set;
- QA app/API/origin DNS names;
- exact count and type of every new resource.

**STOP:** send the saved-plan summary and monthly estimate to Jonat. Do not apply until he approves both. If the approved plan changes, produce a new plan and repeat the approval.

After Jonat explicitly approves the exact saved plan and cost, an authorized operator or Codex may apply that plan:

```powershell
terraform apply tfplan
```

The foundation intentionally has no application or migration image yet. Put the
same reviewed non-secret QA inputs in the GitHub `qa` Environment, keep
`TF_EMAIL_SCHEMA_MIGRATED=false`, and run the image-registration stage from the
exact commit whose schema will be bootstrapped:

```powershell
Set-Location ../..
gh workflow run deploy-qa.yml --ref main -f stage=bootstrap-images
```

This stage builds and pushes immutable `<commit>` and `<commit>-migrations`
images, then applies Terraform with API desired count `0`, the email worker
disabled, and schema confirmation `false`. It registers the backend and one-off
migration task definitions, but it does not publish the frontend, start an API
or worker task, run the migration task, or execute application smoke tests.

Review the workflow summary and record the migration task ARN. **STOP** if the
summary does not say API desired count `0`, worker disabled, and schema
confirmation false. Do not change `main` between this stage, the fresh dev
inventory, database bootstrap/parity, and the first application deploy. If the
commit changes, repeat preparation and the applicable schema checks for that
new commit.

## Phase 3: Fresh Database Bootstrap

The database remains private. Do not expose it publicly and do not fetch its writer password to a laptop or agent session.

The completed `bootstrap-images` stage already built and pushed both immutable images and registered the dedicated QA migration task while the API desired count stayed `0` and the worker/schema confirmation stayed false. Its migration image tag must be exactly `<validated-git-commit>-migrations`; mutable or different-commit tags are rejected. The task definition must use the QA database environment, receive `DB_PASSWORD` from its QA Secrets Manager ARN, use `DB_SSLMODE=require`, and run in the QA database VPC path. The repository-native migration command is `backend/cmd/miraeopus-migrate`.

Only a human operator may use `-Execute` below. Agents must not launch a task that receives the hosted database writer secret.

First create a fresh stamped dev inventory using the designated database-enforced read-only credential and `scripts/export_schema_inventory.ps1`, following `docs/infra/mangorts-schema-audit.md`. The export must be from PostgreSQL 17.x, the current commit/files, and no more than 24 hours old. Historical `tmp/schema-audit-*.json` files are invalid for this gate.

Mechanically validate the stamped environment/version/freshness/current files, then read the two safe hashes and Git commit from the envelope:

```powershell
python scripts\compare_schema_inventory.py `
  --expected .\tmp\schema-audit-dev-fresh.json `
  --actual .\tmp\schema-audit-dev-fresh.json `
  --expected-label fresh-dev `
  --actual-label fresh-dev `
  --require-postgres-major 17 `
  --require-same-commit `
  --require-current-repository `
  --require-expected-environment dev `
  --require-actual-environment dev `
  --max-export-age-hours 24 `
  --max-details 0
if ($LASTEXITCODE -ne 0) {
  throw "Fresh dev schema export failed its metadata and repository gate."
}

$freshDevInventory = Get-Content .\tmp\schema-audit-dev-fresh.json -Raw | ConvertFrom-Json
$devSchemaInventorySHA256 = [string]$freshDevInventory.metadata.schema_inventory_sha256
$devRepositorySchemaSHA256 = [string]$freshDevInventory.metadata.repository_schema_sha256
$devGitCommit = [string]$freshDevInventory.metadata.git_commit
if ($devSchemaInventorySHA256 -notmatch '^[0-9a-f]{64}$' -or $devRepositorySchemaSHA256 -notmatch '^[0-9a-f]{64}$' -or $devGitCommit -notmatch '^[0-9a-f]{40}$') {
  throw "Fresh dev schema audit hashes or Git commit are missing."
}
```

If the designated dev read-only network path is unavailable, stop and have a human create or expose only the approved database-enforced read-only path. Do not fall back to a writer-backed task, create a QA bastion, or expose either database for this step.

Prepare the common parameters from reviewed Terraform outputs while still in `infra/aws-qa`:

```powershell
$qaDatabaseTask = @{
  ExpectedAwsAccountID       = "<approved-12-digit-account-id>"
  Cluster                    = terraform output -raw ecs_cluster_name
  TaskDefinition             = terraform output -raw database_migration_task_definition_arn
  ContainerName              = "database-migration"
  DatabaseInstanceIdentifier = "mangorts-qa-postgres"
  SubnetIDs                  = @(terraform output -json ecs_private_subnet_ids | ConvertFrom-Json)
  SecurityGroupIDs           = @(terraform output -raw ecs_security_group_id)
  ExpectedRepositorySchemaSHA256 = $devRepositorySchemaSHA256
  ExpectedGitCommit          = $devGitCommit
}
Set-Location ../..
```

Run the read-only migration audit first:

```powershell
.\scripts\qa_run_database_task.ps1 @qaDatabaseTask `
  -Action Audit `
  -AuditPurpose EmptyPreflight `
  -Execute `
  -HumanOperatorApproval
```

Before launch, the guard checks the RDS engine version, private flag, task, database, network, and AWS identity. The read-only audit then reports the connected PostgreSQL version and repository fingerprint; the helper stops unless `server_version_num` is 17.x and the fingerprint matches fresh dev. Save the printed audit task ARN.

**STOP:** the audit log must contain `public_tables=0`. Any existing public table means this is not the approved fresh database.

After reviewing that result, bootstrap the canonical schema and baseline the current migration filenames:

```powershell
.\scripts\qa_run_database_task.ps1 @qaDatabaseTask `
  -Action Bootstrap `
  -EmptyDatabaseAuditTaskArn "<completed-empty-audit-task-arn>" `
  -Execute `
  -HumanOperatorApproval
```

The helper verifies the earlier audit task and its `public_tables=0` log before it permits the schema command. It also binds every audit/bootstrap task to the immutable `<validated-git-commit>-migrations` image tag. Its exact write command is:

```text
-mode schema -baseline-migrations -require-empty-database
```

`-require-empty-database` reruns the material-object inventory inside the same transaction that executes `schema.sql` and records the baseline. It permits only the default `public` schema, `plpgsql` extension, and grants. Any existing table—including `schema_migrations`—or other application schema object aborts and rolls back before `schema.sql` executes. The earlier audit remains defense-in-depth; it is not the atomic write guard.

Run another audit afterward:

```powershell
.\scripts\qa_run_database_task.ps1 @qaDatabaseTask `
  -Action Audit `
  -AuditPurpose Parity `
  -ExpectedSchemaInventorySHA256 $devSchemaInventorySHA256 `
  -Execute `
  -HumanOperatorApproval
```

The helper requires `schema_inventory_sha256` to equal the fresh dev hash, the repository fingerprint to match, and both `missing_from_ledger=0` and `unknown_to_repository=0`. This is the physical catalog parity gate. It covers exact unordered column names/counts and the other material objects defined in `schema_inventory.sql`; it deliberately ignores physical column order, grants, row data, and the `schema_migrations` table itself. Stop on any nonzero task exit code, hash mismatch, or migration-ledger mismatch. Do not deploy the API, create Jonat, or add synthetic data before it passes.

## Phase 4: Deploy The Base App

Deploy the QA backend and frontend using the same reviewed image/build patterns as dev, but with only QA variables, roles, buckets, secrets, domains, Cognito IDs, and Terraform state. The API must use `AUTH_MODE=cognito`. Keep `TF_REALTIME_VALKEY_ENABLED=true`, `TF_ECS_CONTAINER_INSIGHTS_ENABLED=true`, `TF_CLOUDWATCH_ALARMS_ENABLED=true`, and `TF_WAF_ENABLED=true`.

Because Nylas is configured after the base app is reachable, set `TF_EMAIL_WORKER_ENABLED=false` only for this first healthy base deployment. Keep these features temporarily off:

- Nylas client, API key, state secret, and webhook secret;
- mailbox connections and ingestion;
- Nylas sending;
- any copied company or business seed data.

After the Phase 3 parity gate passes, set
`TF_EMAIL_SCHEMA_MIGRATED=true` in the GitHub `qa` Environment and run the
normal stage from the same prepared commit:

```powershell
gh workflow run deploy-qa.yml --ref main -f stage=deploy
```

Only `deploy` accepts schema confirmation true, raises API desired count to
one, publishes the frontend, and runs the application smoke tests. The later
Nylas stage removes the temporary worker override; normal QA defaults keep the
worker and all other production-shaped services enabled.

Smoke-test:

1. `https://qa.mangorts.com/deploy-info.json` reports the deployed QA revision and app origin.
2. `https://qa.mangorts.com/healthz` returns HTTP 200.
3. An unauthenticated `/v1/me` request returns HTTP 401.
4. The invite-accept frontend route loads.
5. The frontend bundle contains QA URLs and no dev/production URLs or known dev/production company UUIDs.

## Phase 5: Bootstrap Jonat And The Empty Company

1. Create Jonat's lowercase email as the first user in the QA Cognito pool. This is an AWS/Cognito account only; do not insert a Mango user or membership directly.
2. Temporarily set `MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS` to that one exact email and `MANGORTS_BOOTSTRAP_DEV_COMPANY_NAME` to the approved company name.
3. Deploy the backend configuration.
4. Jonat signs in and completes Cognito's password flow.
5. Jonat's first authenticated backend request creates the Mango user, one company, one `dev_admin` membership, and the three protected folders.
6. Capture the generated company UUID from the authenticated app/API response. Do not query it with a database writer credential.
7. Replace the first-build placeholder company UUID in QA configuration with the generated UUID and redeploy the frontend.
8. Clear `MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS` and redeploy the backend. Never leave the bootstrap allowlist enabled.

Verify in the app:

- exactly one company exists with the approved name;
- Jonat is its only Mango member and is `dev_admin`;
- Explorer contains only protected `Unfiled`, with protected `Projects` and `Logic Gates` beneath it;
- there are no Nodes, Logic Gates, Projects, chats, invitations, GVIC assignments, permission assignments, email connections, or imported messages.

The company UUID is generated by Mango. Do not manually insert a company row or create custom seed SQL.

## Phase 6: Separate Nylas Staging Setup

Do this only after the base app and company work.

### Stage A: OAuth And Public Routes

1. Create a separate Nylas application in the **Staging** environment. Do not reuse the dev or production application.
2. Store its API key directly in a QA Secrets Manager secret.
3. Generate a new QA OAuth state secret and store it directly in a separate QA Secrets Manager secret.
4. Configure the callback URL as `https://api.qa.mangorts.com/nylas/oauth/callback`.
5. Set `TF_EMAIL_WORKER_ENABLED=true` and keep `TF_REALTIME_VALKEY_ENABLED=true`. Deploy the Nylas client ID, API base URL, API-key secret ARN, state-secret ARN, callback, and frontend redirect through the QA-only `TF_QA_NYLAS_*` GitHub Environment variables. Leave the webhook secret unset. The QA workflow deliberately ignores repository-level `TF_NYLAS_*` values so dev credentials cannot enter QA. The workflow rejects this worker stage unless the immutable image, reviewed schema, complete Nylas core, and Valkey are all present.
6. Verify that this challenge returns HTTP 200 with the exact raw body `qa-smoke`:

```powershell
curl.exe -sS "https://api.qa.mangorts.com/nylas/webhook?challenge=qa-smoke"
```

QA deliberately uses Mango's normal outbound behavior: an authorized user can send a real message to any syntactically valid address. Treat every QA send as externally delivered mail.

### Stage B: Webhook Secret

1. In the same Nylas Staging application, create the webhook destination `https://api.qa.mangorts.com/nylas/webhook`.
2. Subscribe only to the events Mango currently handles: `message.created`, `message.updated`, `message.deleted`, `message.opened`, `folder.created`, `folder.updated`, `folder.deleted`, `grant.updated`, and `grant.expired`.
3. Store the returned webhook secret directly in a QA Secrets Manager secret.
4. Configure only that secret's ARN for QA and redeploy.
5. Connect only controlled QA mailboxes through the QA Hosted OAuth flow. Never copy a dev or production `grant_id`, provider token, archive cursor, connection row, or webhook secret.
6. Test ingestion first. Then send one outbound message to an external mailbox you can verify and confirm delivery.

## Phase 7: Invite Testers And Build Synthetic Data

After the bootstrap allowlist is removed and base QA is healthy:

1. Jonat invites Andy and Rohan through Mango's normal invitation UI using their real QA login emails and approved roles.
2. They accept through the normal Cognito/Mango flow.
3. Mailbox OAuth remains separate and optional.
4. Jonat manually creates the synthetic folders, Nodes, Logic Gates, Projects, chats, permissions, GVIC assignments, and email examples.

Do not copy any dev or production user, company, folder, attachment, chat, email, relationship, permission, GVIC assignment, Nylas grant, or business record into QA.

After the synthetic dataset is approved, create a QA-only recovery snapshot. That snapshot can become the later reset baseline; it must never contain copied dev or production data.

## Reset

Reset means replacing only the QA database or restoring the approved QA-only synthetic baseline. Do not rebuild the shared VPC/NAT/hosted-zone resources.

1. Announce QA downtime and stop the QA API and email worker so no write can race the reset.
2. Decide whether to keep a recovery snapshot. Record explicit approval if the current synthetic data is disposable.
3. Produce a Terraform plan that replaces only the QA RDS resource or restores the approved QA-only snapshot.
4. Verify the plan names only QA resources, keeps PostgreSQL 17.x, remains Single-AZ/private, and does not change shared, dev, or production infrastructure.
5. **STOP:** obtain separate approval for the destructive reset plan and any snapshot storage cost.
6. A human applies the exact saved reset plan.
7. Run the Phase 3 Audit, Bootstrap, and final Audit steps against the new empty database. A snapshot restore uses its reviewed baseline procedure instead of schema bootstrap.
8. Temporarily re-enable Jonat's one-address bootstrap allowlist, sign in, capture the newly generated company UUID, update QA configuration, and clear the bootstrap allowlist again.
9. Revoke orphaned QA Nylas grants if their database connection rows were discarded. Reconnect only controlled mailboxes.
10. Clear unreferenced objects only from the exact QA attachment bucket after a separate reviewed deletion confirmation.
11. Reinvite testers normally and reopen QA.

The database task helper does not reset or delete a database. That destructive boundary stays in a reviewed Terraform replacement plan.

## Hard Stop Conditions

Stop immediately when any of these is true:

- the Terraform plan or AWS identity does not match the approved QA account and names;
- the plan creates a new VPC/NAT, a public database, Multi-AZ, a replica, or an always-on tunnel;
- the PostgreSQL server version is not 17.x;
- the pre-bootstrap audit does not report `public_tables=0`;
- the fresh dev audit is stale, not from the same commit/files, lacks PostgreSQL 17.x, or uses an unverified writer credential in an agent session;
- the final QA inventory or repository SHA-256 does not match the fresh dev values;
- a hosted database write is being launched by an agent instead of a human;
- any writer password or provider secret would be retrieved, printed, copied, or stored outside Secrets Manager/ECS task secrets;
- the app references a dev/production Cognito pool, database, bucket, secret, URL, Terraform state, Nylas application, or grant;
- the bootstrap admin allowlist contains anyone except Jonat or remains enabled after bootstrap;
- a mailbox is connected without its owner's consent;
- the email worker is enabled without the immutable backend image, verified final schema, complete QA Nylas core, and Valkey;
- full alarms are enabled while Container Insights is disabled;
- the cost or saved apply/reset plan has not been explicitly approved.
