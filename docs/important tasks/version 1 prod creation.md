# Version 1 Prod Creation

## Purpose

Create the first real production environment for MangoRTS.

Current state:

- There is no production environment.
- The current AWS environment is dev, even though it is production-shaped.
- The current dev database contains some data that may need to be copied into prod.
- Prod should be a separate environment, not a renamed dev environment.

Prod means separate:

- AWS resources
- Terraform state
- database
- Cognito/auth
- Nylas app, callbacks, and webhooks
- Secrets Manager secrets
- GitHub deploy environment/secrets
- domain/DNS
- monitoring and rollback process

## Short Answer On Difficulty

This is very doable because prod is empty. There is no live customer traffic to cut over and no existing prod data to merge with.

The hardest part is the data migration, but not because copying database rows is technically impossible. Copying rows is straightforward once the data scope is known.

The hard part is deciding:

- which dev rows are real product data,
- which rows are test/debug/dev junk,
- which rows reference dev-only identities or provider state,
- whether prod should preserve IDs from dev or remap them,
- whether copied provider state will actually work in a separate prod Nylas/Cognito setup.

If prod starts as an empty database and we copy only selected business data, this should be manageable. If we blindly clone the whole dev database, prod may inherit drift, test data, old migrations, broken rows, stale tokens, and dev-only assumptions.

## The Hard Parts

### 1. Data Selection

This is the main hard part.

The dev DB likely contains a mix of:

- real company/workspace data worth keeping,
- test companies,
- test users,
- seed rows,
- debug records,
- old feature rows,
- projection/cache rows,
- webhook/event/job history,
- email/provider connection state.

Before moving data, create a table-by-table decision list:

- copy as-is,
- copy with ID remapping,
- recreate manually,
- rebuild from source tables,
- skip.

### 2. Identity Mapping

Prod Cognito should be separate from dev Cognito. That means Cognito user `sub` values may change.

Tables such as `users`, `company_memberships`, permissions, saved views, pins, notifications, and audit-ish rows may reference user IDs. If prod users get new Cognito subjects, the migration has to map dev user IDs to prod user IDs.

The easiest path is:

- create the small set of real prod users first,
- collect their prod Cognito subjects,
- map dev users to prod users by canonical lowercase email,
- rewrite user references during the import.

Do not assume dev Cognito IDs can be copied into prod Cognito.

### 3. Company ID Decision

Current dev guidance uses the hardcoded dev company ID:

```text
11111111-1111-1111-1111-111111111111
```

For prod, decide whether to:

- preserve the current company ID for the initial company, or
- create a real prod company ID and rewrite every `company_id` reference.

Preserving the ID is easier for data copy. Creating a real prod ID is cleaner long term. If there is only one initial company and no external customers yet, either is workable, but this decision must be explicit before migration scripts are written.

### 4. Provider State

Nylas and email-related data is riskier than ordinary business tables.

Prod should have a separate Nylas application with prod callback and webhook URLs. Dev Nylas grant IDs, webhook rows, state secrets, and provider tokens may not be valid or desirable in prod.

Likely approach:

- create a prod Nylas app,
- configure prod callback and webhook URLs,
- make users reconnect mailboxes in prod when needed,
- copy only business-level email associations that are known to be safe,
- avoid blindly copying provider tokens, webhook logs, archive jobs, and transient sync state.

### 5. Schema Drift

The repo should be the source of truth for schema:

```text
backend/db/schema.sql
backend/db/migrations/
```

The dev database is evidence, not truth. It may contain manual or app-driven changes that are not represented cleanly in the repo.

Before prod launch:

- create a fresh scratch DB,
- apply canonical schema or ordered migrations from the repo,
- compare scratch schema to dev schema,
- turn real drift into new migrations,
- ignore or remove dev-only drift.

Do not create prod by dumping dev schema and calling that the new truth unless the team has deliberately accepted all dev drift.

### 6. Projection And Cache Tables

Some tables are likely derived/projection tables, for example workspace, notification, kanban, GVIC, and read-version projections.

These can be tricky:

- copying them may be fastest,
- rebuilding them may be cleaner,
- mixing stale projection rows with fresh source rows may create confusing bugs.

For each projection table, decide whether it is canonical data or rebuildable derived data. If it is rebuildable, prefer rebuilding after import.

### 7. Production Safety

The AWS resources are not the hardest part, but prod needs stricter boundaries than dev:

- separate Terraform state,
- separate secrets,
- separate database backups,
- separate Cognito pool,
- separate deploy approvals,
- rollback path,
- smoke tests,
- no dev bootstrap shortcuts left enabled.

## What Is Not That Hard

These parts are work, but they are not conceptually hard:

- creating a new Terraform state bucket/key,
- parameterizing the existing `infra/aws-dev` stack into prod values,
- creating an empty prod database,
- applying `backend/db/schema.sql` to a fresh DB,
- creating prod Secrets Manager secrets,
- creating prod GitHub environment variables/secrets,
- building and pushing the backend image,
- deploying frontend static assets to S3/CloudFront,
- creating prod DNS records,
- running smoke tests.

The repo already has a lot of the shape needed for this:

- `infra/aws-dev`
- `.github/workflows/deploy-dev.yml`
- `docs/infra/mangorts-deploy-runbook.md`
- `scripts/apply_canonical_schema.ps1`
- `scripts/apply_db_migrations.ps1`
- `scripts/check_db_ready.ps1`

## Recommended Prod Size For V1

Do not launch prod on the current tiny dev sizing.

Suggested first production size:

- ECS Fargate backend: 2 tasks
- each task: 1 vCPU / 2 GiB memory
- Aurora Serverless v2 minimum: 1-2 ACUs
- Aurora Serverless v2 maximum: 8-16 ACUs
- no DB auto-pause for prod
- automated backups and point-in-time recovery enabled
- query visibility enabled enough to diagnose slow routes

Suggested usable dev/demo size:

- ECS Fargate backend: 1 task
- task: 1 vCPU / 2 GiB memory
- Aurora Serverless v2 minimum: 0.5-1 ACU during dev hours
- Aurora Serverless v2 maximum: 2-4 ACUs
- avoid pause during demos/performance testing

## Prod Creation Steps

### Phase 1: Decide Data Scope

Create a migration inventory with every table grouped as:

- product data to copy,
- auth/user data to map,
- provider state to recreate,
- projection/cache data to rebuild or skip,
- logs/events/jobs to skip unless needed,
- seed/config/reference data to recreate from repo or copy carefully.

Likely product-data families to review:

- `companies`
- `users`
- `company_memberships`
- `company_user_groups`
- `company_user_group_members`
- `nodes`
- `node_information`
- `node_relationships`
- `logic_gates`
- `logic_gate_information`
- `logic_gate_relationships`
- `node_logic_gate_assignments`
- `projects`
- `accounts`
- `account_folders`
- `project_*`
- `resource_*`
- `company_explorer_*`
- `shared_inboxes`
- `shared_inbox_folders`
- `saved_views`
- `pins`
- `recycle_bin_items` if recovery history matters

Likely risky or environment-bound families:

- `user_email_connections`
- `company_email_connections`
- `communications_email_archive_jobs`
- `communications_email_archive_job_items`
- webhook/event/job tables
- auth deletion queues
- password reset/invitation rows
- notification projections and read-status rows
- provider tokens or Nylas grant state

### Phase 2: Make Schema Reproducible

Use the repo as schema source of truth.

For a fresh prod DB, expected path:

```powershell
.\scripts\apply_canonical_schema.ps1
```

Before doing this for prod:

1. Create a scratch DB.
2. Apply canonical schema.
3. Compare scratch schema against dev schema.
4. Identify real drift.
5. Add missing repo migrations or update canonical schema as needed.
6. Repeat until a fresh DB matches the app's expected schema.

This phase prevents prod from depending on hidden manual changes inside dev.

### Phase 3: Create Prod AWS Foundation

Create prod-specific infrastructure inputs:

- prod Terraform state bucket/key,
- prod domain or subdomain,
- prod VPC/subnet decision,
- prod database settings,
- prod Secrets Manager names,
- prod Cognito domain prefix,
- prod Nylas callback/webhook URLs,
- prod deploy role,
- prod GitHub environment.

The existing dev Terraform root can be used as the starting point, but prod should not share dev state or dev secrets.

Expected prod platform:

- CloudFront/S3 frontend,
- CloudFront API routes,
- ALB origin,
- ECS Fargate backend,
- Aurora/RDS PostgreSQL,
- Cognito,
- WAF if desired,
- Secrets Manager,
- Route 53,
- ACM certs,
- ECR,
- GitHub OIDC deploy role.

### Phase 4: Create Prod Auth

Create a separate prod Cognito user pool and clients.

Then:

1. Create first prod admin user.
2. Capture prod Cognito `sub`.
3. Decide user mapping from dev email to prod user ID.
4. Seed prod `users`, `companies`, and `company_memberships`.
5. Clear any one-time bootstrap env vars after first successful admin login.

Do not leave dev bootstrap settings enabled in prod.

### Phase 5: Create Prod Nylas

Create a separate prod Nylas app.

Configure:

- prod OAuth callback URL,
- prod frontend redirect URL,
- prod webhook URL,
- prod webhook triggers,
- prod Nylas API key in Secrets Manager,
- prod Nylas state secret in Secrets Manager,
- prod Nylas webhook secret in Secrets Manager.

Plan for mailbox reconnection unless we prove the dev grants can safely be reused, which should not be assumed.

### Phase 6: Build Data Migration

Recommended approach:

1. Take a snapshot/backup of dev DB.
2. Restore it into a temporary migration-analysis DB, or export selected data from dev.
3. Build an explicit import script or SQL set.
4. Apply it to a disposable prod-like DB first.
5. Validate row counts, foreign keys, and app behavior.
6. Reset the disposable DB and rerun until repeatable.
7. Apply to real prod once.

The migration should be repeatable enough to rehearse. It does not have to be a forever framework, but it should not be a one-off manual paste into the console.

Key migration decisions:

- preserve or remap `company_id`,
- map users by email to prod Cognito subjects,
- skip or recreate provider tokens,
- copy source-of-truth tables before derived tables,
- rebuild projection tables where safer,
- run `ANALYZE` after bulk import,
- verify foreign keys before launch.

### Phase 7: Validate Prod

Minimum validation:

- backend `/healthz`,
- frontend route load,
- Cognito login,
- current user `/v1/me`,
- company membership authorization,
- Company Explorer load,
- node create/edit/delete,
- logic gate create/edit/delete,
- Kanban load and mutation,
- saved views,
- permissions/GVIC behavior,
- notifications,
- Nylas OAuth callback,
- Nylas webhook challenge,
- outbound email if enabled,
- slow-query/performance check on main workflows.

For data migration validation:

- expected company count,
- expected user count,
- expected node count,
- expected logic gate count,
- expected project/account count,
- expected Company Explorer item count,
- no orphaned foreign keys,
- no dev-only users unintentionally present,
- no dev Nylas secrets/tokens present,
- no bootstrap admin setting left enabled.

### Phase 8: Lock The Prod Deployment Path

Before calling it prod:

- protect the production GitHub environment,
- require manual approval for prod deploys,
- keep prod secrets separate from dev secrets,
- document rollback,
- document DB restore,
- document how migrations are applied,
- document how to rotate secrets,
- document how to create the next prod admin/user.

## Data Migration Recommendation

Do not blindly clone dev into prod.

Use this rule:

```text
Schema comes from the repo.
Selected business data comes from dev.
Environment-bound auth/provider state gets recreated or explicitly mapped.
```

This makes the migration safer and still lets us keep important work from dev.

The data migration is not "super hard" if the important data set is small and mostly normal product data. It becomes hard if the goal changes to "copy every table exactly, including users, Cognito identity state, Nylas grants, email sync state, jobs, projections, logs, and historical dev junk."

## Practical Effort

Assuming empty prod and selected data copy:

- Prod infra clone: 1-3 focused days.
- Prod infra plus real deploy path and secrets: about 1 week.
- Prod plus rehearsed selective data migration and validation: 1-2 weeks.
- Customer-safe production with backup/restore drills, rollback, monitoring, and all provider edges verified: 2-4 weeks.

The shortest path is possible because prod is empty. The responsible path is longer because the first prod environment sets the standard for every later deploy and migration.

## Immediate Next Checklist

1. Inventory dev DB tables and row counts.
2. Mark each table copy, map, rebuild, recreate, or skip.
3. Decide whether to preserve or remap the initial company ID.
4. Decide which real dev users should exist in prod.
5. Create prod Cognito users and map by email.
6. Decide whether Nylas connections must be reconnected.
7. Build a scratch prod DB from repo schema.
8. Compare scratch schema to dev schema.
9. Fix repo schema/migration drift.
10. Write and rehearse selective data migration.
11. Create prod AWS/Terraform/GitHub/Nylas resources.
12. Import data into prod.
13. Run smoke tests and workflow tests.
14. Lock down prod deploy approvals and secrets.
