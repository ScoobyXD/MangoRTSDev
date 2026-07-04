# MangoRTS Production Environment V1 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Do not create, apply, or mutate production AWS/GitHub/Nylas resources without Jonat's explicit approval at the relevant gate.

**Goal:** Create the first real MangoRTS production environment, fully separate from dev, covering AWS infrastructure, database, backend/frontend deploys, GitHub repo/deployment controls, Cognito auth, Nylas/email integrations, secrets, monitoring, migration, validation, and rollback.

**Architecture:** Promote the current production-shaped dev stack into an environment-parameterized platform, then instantiate a separate `prod` root with its own Terraform state, secrets, database, Cognito pool, Nylas app, DNS, GitHub Environment, deploy workflow, monitoring, and migration runbook. Do not rename or clone dev blindly; prod should be a fresh environment with schema from the repo and only explicitly selected business data copied from dev.

**Tech Stack:** Go 1.23 backend, Vite/React frontend, Terraform 1.6, GitHub Actions OIDC, AWS Route 53/ACM/CloudFront/WAF/S3/ALB/ECS Fargate/ECR/Aurora PostgreSQL/Secrets Manager/Cognito/SES/CloudWatch/SNS, Nylas Hosted OAuth + webhooks, PostgreSQL SQL migration scripts.

---

## Sources inspected

- `docs/important tasks/version 1 prod creation.md` — existing prod creation analysis and checklist.
- `docs/infra/mangorts-dev-platform.md` — current AWS dev architecture.
- `docs/infra/mangorts-infra-state.md` — what Terraform owns/reuses today.
- `docs/infra/mangorts-deploy-runbook.md` — current dev deploy variables, Nylas setup, smoke tests, rollback.
- `docs/infra/mangorts-auth.md` — Cognito, invitation, SES, Nylas onboarding, auth table model.
- `docs/backend/mangorts-database.md` and `docs/backend/README.md` — database schema/migration and backend runtime behavior.
- `infra/aws-dev/*.tf` — current Terraform root.
- `.github/workflows/deploy-dev.yml` — only committed deploy workflow found.
- `backend/cmd/miraeopus-api/main.go`, `backend/internal/http/server.go`, `backend/db/schema.sql`, `backend/db/migrations/` — backend config, routes, schema, and migrations.
- `backend/Dockerfile` — current runtime image is distroless app-only.
- `frontend/.env.example`, `frontend/src/auth/currentCompany.ts`, `frontend/src/auth/cognitoAuth.ts`, `frontend/src/auth/AuthGate.tsx` — frontend auth/company/Nylas behavior.
- `docs/important tasks/Old Stuff/production-gmail-oauth.md` — Google/Nylas production OAuth readiness notes.

GitHub CLI is present but not authenticated in this shell, so I inspected the committed repo state rather than live GitHub Environment settings.

---

## Current repo reality

1. **There is only a dev Terraform root.** `infra/aws-dev` owns dev-shaped AWS resources. There is no `infra/aws-prod` and no committed prod state/backend example.
2. **The current Terraform root reuses an existing database.** `infra/aws-dev/variables.tf` takes `existing_db_host`, `existing_db_password_secret_arn`, and `existing_db_security_group_id`; no RDS/Aurora resource exists in the current Terraform.
3. **Dev deploy is the only workflow.** `.github/workflows/deploy-dev.yml` hardcodes `TF_DIR=infra/aws-dev`, `environment = "dev"`, dev GitHub secret names, dev Terraform variable names, and dev-oriented smoke tests.
4. **Backend can run safely in prod mode but Terraform currently sets staging.** `backend/cmd/miraeopus-api/main.go` fails fast when `APP_ENV` is not `dev` and Postgres is missing/unreachable. `infra/aws-dev/ecs_alb.tf` currently injects `APP_ENV=staging`; prod should inject `APP_ENV=prod`.
5. **Auth is production-shaped but dev-named.** The backend uses Cognito when `AUTH_MODE=cognito`, maps Cognito `sub` to Mango-owned `users`, enforces `company_memberships`, sends Mango invitation/signup emails through SES when `MANGORTS_EMAIL_FROM` is set, and uses Nylas for mailbox onboarding.
6. **Frontend is mostly environment-driven but still has a dev fallback.** `frontend/src/auth/currentCompany.ts` falls back to `11111111-1111-1111-1111-111111111111` if no active/company env value exists. Prod must always set a real production `VITE_COMPANY_ID`, and the fallback should eventually become impossible in production builds.
7. **Nylas is integrated but environment-bound.** Terraform and backend support `NYLAS_CLIENT_ID`, `NYLAS_API_KEY`, `NYLAS_STATE_SECRET`, webhook secret, callback URL, webhook URL, Google/Microsoft scopes. Prod needs a separate Nylas app and users should reconnect mailboxes unless a safe grant migration is explicitly proven.
8. **Schema and migrations exist.** `backend/db/schema.sql` is the canonical fresh schema; `backend/db/migrations/` has many incremental migrations. The existing docs already warn that dev DB drift must be reconciled before prod.
9. **The current backend image is not a migration runner.** `backend/Dockerfile` builds a distroless image with only `/miraeopus-api`. A production workflow cannot run `psql` from that container unless we add a separate migration image/task or a small Go migration command.

---

## Recommended top-level decisions

### Decision 1 — AWS account/profile boundary

**Recommendation:** Use a separate prod AWS account reachable through AWS SSO profile `mangorts-prod`. Keep `mangorts-dev` for dev only.

Minimum acceptable if a separate account is not ready: same AWS account, but separate Terraform state key, IAM deploy role, secrets, Cognito pool, database, ECS/ECR, DNS names, and tags. Do not share prod and dev DB/secrets/Nylas/Cognito.

### Decision 2 — Repo/code strategy

**Recommendation:** Do **not** create a separate production repo. Use the same GitHub repo with:

- protected `main`,
- required CI,
- GitHub Environments `development` and `production`,
- production environment required reviewers/manual approval,
- separate deploy workflows or a parameterized deploy workflow with environment-specific inputs.

A separate prod repo will create drift. A protected deploy environment gives production control without code divergence.

### Decision 3 — Terraform layout

**Recommendation:** Refactor current `infra/aws-dev` into a reusable module plus separate roots:

```text
infra/modules/mangorts-platform/
infra/aws-dev/
infra/aws-prod/
```

This is cleaner than copy-pasting `aws-dev`, but the refactor should be done carefully so dev remains unchanged after migration.

Fast-but-less-clean fallback: copy `infra/aws-dev` to `infra/aws-prod` and rename prod variables/descriptions. If time pressure is high, this is acceptable for V1, but it creates drift risk immediately.

### Decision 4 — Production company ID

**Recommendation:** Create a real production company UUID and map the dev company ID to it during migration, rather than carrying `11111111-1111-1111-1111-111111111111` into prod.

Preserving the dev company ID is faster, but a proper prod environment should not depend on the hardcoded dev ID. If preserving IDs is chosen for V1, document it explicitly and schedule removal.

### Decision 5 — Data migration scope

**Recommendation:** Do not clone dev wholesale. Build prod from repo schema, then selectively import business data. Recreate environment-bound identity/provider state.

Rule:

```text
Schema comes from the repo.
Selected business data comes from dev.
Cognito/Nylas/SES/provider state is recreated or explicitly mapped.
Derived/projection/cache/job/log data is skipped or rebuilt unless proven canonical.
```

### Decision 6 — Prod Nylas/Google path

**Recommendation:** Create a separate prod Nylas app and ask Nylas to enable shared Google OAuth credentials / shared GCP project for production. In parallel, prepare MangoRTS-owned Google OAuth verification because Gmail scopes include sensitive/restricted scopes.

Users should reconnect mailboxes in prod. Do not import dev grant IDs as active prod connections.

---

## Phase 0 — Non-mutating inventory and approvals

**Objective:** Confirm exact target names, accounts, and data scope before creating anything.

### Task 0.1: Confirm production naming

**Files:** Planning docs only.

**Decisions to record:**

- AWS account ID or confirmation to use same account temporarily.
- AWS SSO profile: `mangorts-prod`.
- Region: probably `us-west-1` unless there is a business reason to change.
- Root domain: current Route 53 root domain.
- Prod app domain: recommended `app.<root>` or `<root>`.
- Prod API domain: recommended `api.<root>`.
- Prod ALB origin domain: recommended `origin.<root>`.
- Prod sender emails:
  - `no-reply@<root>` for Mango invitation/signup emails,
  - `alerts@<root>` for CloudWatch/SNS alarms,
  - `ops@<root>` for Nylas webhook notification email.
- Initial prod company name and UUID policy.
- Initial prod admin/user emails.
- Whether Microsoft mailbox support is required at V1 or just Google.

**Verification:** No resources created; decisions documented in a checked-in doc such as `docs/infra/mangorts-prod-plan.md` or this plan plus follow-up issue.

### Task 0.2: Inspect live GitHub/AWS/Nylas only after credentials are available

**Files:** None.

**Commands:**

```bash
gh auth status
aws sts get-caller-identity --profile mangorts-prod
aws sts get-caller-identity --profile mangorts-dev
```

**Expected:** `gh` logged in and both AWS profiles point to the intended accounts. If either fails, stop and ask for login/SSO; do not create static keys.

---

## Phase 1 — Make infrastructure environment-safe

**Objective:** Remove dev-specific naming assumptions before prod exists.

### Task 1.1: Create a reusable Terraform module

**Files:**

- Create: `infra/modules/mangorts-platform/versions.tf`
- Create: `infra/modules/mangorts-platform/variables.tf`
- Create: `infra/modules/mangorts-platform/locals.tf`
- Create: `infra/modules/mangorts-platform/networking.tf`
- Create: `infra/modules/mangorts-platform/security.tf`
- Create: `infra/modules/mangorts-platform/acm.tf`
- Create: `infra/modules/mangorts-platform/route53.tf`
- Create: `infra/modules/mangorts-platform/cloudfront_s3.tf`
- Create: `infra/modules/mangorts-platform/waf.tf`
- Create: `infra/modules/mangorts-platform/cognito.tf`
- Create: `infra/modules/mangorts-platform/ecr.tf`
- Create: `infra/modules/mangorts-platform/ecs_alb.tf`
- Create: `infra/modules/mangorts-platform/iam.tf`
- Create: `infra/modules/mangorts-platform/outputs.tf`
- Modify: `infra/aws-dev/*.tf`

**Approach:** Move most current `infra/aws-dev` resource definitions into a module. Keep `infra/aws-dev` as a thin root that calls the module with dev values.

**Important renames/generalizations:**

- `dev_company_id` -> `default_company_id` or `initial_company_id`.
- `bootstrap_dev_admin_emails` -> `bootstrap_admin_emails`.
- `bootstrap_dev_company_name` -> `bootstrap_company_name`.
- `existing_db_*` -> support both existing DB inputs and managed DB outputs; for dev keep existing DB path.
- `stack = "aws-dev"` -> `stack = "mangorts-platform"` or root-provided stack name.
- Resource descriptions/comments should say `${var.environment}`, not `dev`.
- CloudFront function resource name can remain temporarily if replacement ordering risk exists, but its comment should be environment-neutral.

**Verification:**

```bash
cd infra/aws-dev
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

No `terraform apply` in this phase.

### Task 1.2: Make backend runtime environment truly prod-aware

**Files:**

- Modify: `infra/modules/mangorts-platform/ecs_alb.tf`
- Possibly modify: `backend/.env.example`

**Changes:**

- In ECS task env, set `APP_ENV = var.environment` so prod gets `APP_ENV=prod`.
- Keep `ALLOW_INMEMORY_FALLBACK=false`.
- Keep `AUTH_MODE=cognito`.
- Keep `MANGORTS_DEPLOY_ENV=var.environment`.
- Add variables for DB pool sizing if needed:
  - `DB_MAX_OPEN_CONNS`, `DB_MAX_IDLE_CONNS`, `DB_CONN_MAX_LIFETIME`, `DB_CONN_MAX_IDLE_TIME`.

**Verification:** `terraform validate`; backend tests still pass.

### Task 1.3: Harden Cognito for prod while preserving dev behavior

**Files:**

- Modify: `infra/modules/mangorts-platform/cognito.tf`
- Modify: `infra/aws-dev/terraform.tfvars.example`
- Create/modify: `infra/aws-prod/terraform.tfvars.example` later.

**Prod-specific desired settings:**

- `username_configuration { case_sensitive = false }` if compatible with current user-pool creation.
- Stronger password policy for prod than current dev min-length-6 policy.
- Production SES-backed Cognito email configuration for password resets and user messages.
- Keep custom app login pages; do not switch to Cognito Hosted UI unless intentionally redesigned.

**Verification:** `terraform validate`; run auth tests:

```bash
cd backend
go test ./internal/auth ./internal/http
```

### Task 1.4: Make frontend company ID impossible to forget in prod

**Files:**

- Modify: `.github/workflows/deploy-prod.yml` when created.
- Optional hardening: `frontend/src/auth/currentCompany.ts`
- Optional test: `tests/frontend/...` if hardening code is added.

**Approach:** For V1, build prod frontend with `VITE_COMPANY_ID` from prod Terraform output. Later, add a build/deploy guard that fails prod if the bundle contains the hardcoded dev UUID.

**Verification guard in prod workflow:**

```bash
if grep -R -l --fixed-strings "11111111-1111-1111-1111-111111111111" dist/assets dist/index.html; then
  echo "Prod bundle contains the dev company UUID" >&2
  exit 1
fi
```

---

## Phase 2 — Create production Terraform root and state

**Objective:** Add `infra/aws-prod` with isolated state and prod inputs, but do not apply until reviewed.

### Task 2.1: Add prod Terraform root

**Files:**

- Create: `infra/aws-prod/versions.tf`
- Create: `infra/aws-prod/main.tf`
- Create: `infra/aws-prod/variables.tf` if root-level wrappers are needed.
- Create: `infra/aws-prod/outputs.tf`
- Create: `infra/aws-prod/backend.hcl.example`
- Create: `infra/aws-prod/terraform.tfvars.example`
- Modify: `.gitignore` to ignore:
  - `infra/aws-prod/backend.hcl`
  - `infra/aws-prod/terraform.tfvars`
  - `infra/aws-prod/*.auto.tfvars`
  - `infra/aws-prod/tfplan`

**Prod backend example:**

```hcl
bucket  = "replace-with-mangorts-prod-terraform-state-bucket"
key     = "mangorts/prod/terraform.tfstate"
region  = "us-west-1"
encrypt = true
# use_lockfile = true, if supported by the Terraform S3 backend version in use.
```

**Verification:**

```bash
cd infra/aws-prod
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

### Task 2.2: Create/provision Terraform state bucket manually after approval

**Files:** None committed.

**Action gate:** Requires explicit approval because it creates prod AWS resources.

**Requirements:**

- Dedicated prod state S3 bucket.
- Versioning enabled.
- Server-side encryption enabled.
- Public access blocked.
- S3 native locking if available, or DynamoDB lock table if you decide to use that backend pattern.
- Access only for prod admins/deploy role.

**Verification:** `terraform init -backend-config=backend.hcl` succeeds in `infra/aws-prod`.

---

## Phase 3 — Production database foundation

**Objective:** Make prod database a first-class, isolated managed resource, not an imported dev endpoint.

### Task 3.1: Add Aurora PostgreSQL resources

**Files:**

- Create: `infra/modules/mangorts-platform/rds.tf`
- Modify: `infra/modules/mangorts-platform/variables.tf`
- Modify: `infra/modules/mangorts-platform/outputs.tf`
- Modify: `infra/modules/mangorts-platform/security.tf`
- Modify: `infra/modules/mangorts-platform/iam.tf`
- Modify: `infra/modules/mangorts-platform/ecs_alb.tf`

**Recommended prod DB settings:**

- Aurora PostgreSQL Serverless v2.
- Private subnets only.
- Storage encrypted.
- Deletion protection enabled.
- Backup retention at least 7 days, preferably 14+ for first prod.
- Point-in-time recovery enabled via automated backups.
- No auto-pause in prod.
- ACU min 1-2, max 8-16 for V1.
- Performance Insights / enhanced monitoring / PostgreSQL logs enough to debug slow routes.
- Separate app user secret in Secrets Manager; ECS should not use a master password.
- Security group allows ingress only from ECS and controlled migration/bastion path.

**Note:** The existing dev root can continue using `existing_db_*`. Prod should use managed DB outputs.

### Task 3.2: Add a safe database bootstrap/migration path

**Files:**

Option A — dedicated migration image/task:

- Create: `backend/Dockerfile.migrations`
- Create: `scripts/run_prod_migrations_task.ps1` or GitHub workflow step.
- Modify: `.github/workflows/deploy-prod.yml`

Option B — Go migration command:

- Create: `backend/cmd/miraeopus-migrate/main.go`
- Modify: `backend/Dockerfile` or create a second migration image.
- Add tests for migration ordering/recording.

**Recommendation:** Add a small Go migration command that can apply `backend/db/schema.sql` for empty DBs and `backend/db/migrations/*.sql` with `schema_migrations` tracking. It avoids requiring `psql` in a distroless app image and can run as an ECS one-off task inside the VPC.

**Verification:**

- Run migration command against a local/scratch Postgres, not prod.
- Confirm it creates `schema_migrations` and is idempotent.
- Confirm a second run reports no pending migrations.

### Task 3.3: Reconcile schema drift before prod import

**Files:**

- Create: `scripts/compare_db_schema.ps1` or document exact `pg_dump --schema-only` commands.
- Create: `docs/infra/mangorts-prod-db-migration.md`.

**Steps:**

1. Create a scratch DB from repo schema.
2. Dump scratch schema.
3. Dump dev schema from a read-only/snapshot source.
4. Compare.
5. Convert real application drift into repo migrations.
6. Ignore dev-only/manual junk.
7. Repeat until fresh schema supports the app.

**Verification:** Fresh schema + migrations can pass backend tests where tests do not require live prod resources.

---

## Phase 4 — Production backend/frontend infrastructure

**Objective:** Deploy prod compute and edge separately from dev.

### Task 4.1: ECS backend prod settings

**Files:**

- Modify: `infra/modules/mangorts-platform/ecs_alb.tf`
- Modify: `infra/modules/mangorts-platform/variables.tf`

**Recommended prod settings:**

- Desired count: 2 tasks.
- CPU/memory: start at 1 vCPU / 2 GiB per task.
- Deployment circuit breaker with rollback enabled.
- Health check grace period if needed.
- CloudWatch log retention: 30-90 days for prod, not the current 14-day dev default.
- Optional Application Auto Scaling target tracking on CPU/memory/ALB request count.
- `APP_ENV=prod`, `AUTH_MODE=cognito`, `ALLOW_INMEMORY_FALLBACK=false`.
- `MANGORTS_ALLOWED_ORIGIN=https://<prod-app-domain>`.

### Task 4.2: CloudFront/S3/ALB/WAF prod settings

**Files:**

- Modify: `infra/modules/mangorts-platform/cloudfront_s3.tf`
- Modify: `infra/modules/mangorts-platform/waf.tf`
- Modify: `infra/modules/mangorts-platform/security.tf`
- Modify: `infra/modules/mangorts-platform/acm.tf`
- Modify: `infra/modules/mangorts-platform/route53.tf`

**Prod requirements:**

- Separate S3 frontend bucket with versioning/encryption/public access block.
- Separate CloudFront distribution with app/API aliases.
- WAF enabled in prod.
- ALB ingress only from CloudFront origin-facing prefix list.
- CloudFront-to-ALB origin verification header with a prod-only secret.
- ACM certs for app/API in us-east-1 and origin cert in region.
- Route 53 records for app/API/origin.

### Task 4.3: Prod observability and alarms

**Files:**

- Create: `infra/modules/mangorts-platform/alarms.tf`
- Create: `infra/modules/mangorts-platform/sns.tf`
- Modify: `infra/modules/mangorts-platform/variables.tf`
- Modify: `infra/modules/mangorts-platform/outputs.tf`

**Alarms:**

- ECS service desired vs running tasks.
- ALB target 5xx and unhealthy host count.
- CloudFront 5xx rate.
- RDS/Aurora CPU, ACU, connections, deadlocks, freeable memory, storage/backup events as supported.
- WAF blocked request anomaly if useful.
- Backend log metric filters for panic/fatal/error bursts if logs are structured enough.

**Notifications:** SNS topic to `alerts@<root>` or a confirmed email. Confirm subscription before relying on it.

---

## Phase 5 — Production auth and application email

**Objective:** Make login, invites, password resets, and Mango emails production-ready.

### Task 5.1: Production Cognito user pool/client

**Files:**

- Modify: `infra/modules/mangorts-platform/cognito.tf`
- Modify: `docs/infra/mangorts-auth.md` or create `docs/infra/mangorts-prod-auth.md`.

**Requirements:**

- Separate prod user pool.
- Separate prod SPA client.
- Lowercase/case-insensitive email handling.
- Stronger prod password policy.
- Token validity reviewed.
- Recovery via verified email.
- SES-backed email configuration for Cognito password reset messages if possible.
- Initial admin bootstrap path documented and removed after first successful admin invite/login.

**Do not:** Reuse dev Cognito subjects in prod.

### Task 5.2: SES production email setup

**Files:**

- Create: `infra/modules/mangorts-platform/ses.tf` or document manual SES if Terraform cannot verify all DNS/domain steps cleanly.
- Modify: `infra/modules/mangorts-platform/iam.tf` to scope `ses:SendEmail` to the verified identity where possible.
- Modify: `docs/infra/mangorts-prod-email.md`.

**Requirements:**

- Verify sending domain or sender, preferably domain identity for `<root>`.
- DKIM DNS records in Route 53.
- SPF and DMARC records for deliverability.
- SES production access out of sandbox before customer emails.
- `MANGORTS_EMAIL_FROM=no-reply@<root>`.
- Confirm invitation email and signup confirmation email from backend.
- Confirm Cognito password reset email branding/sender.

**Smoke tests:**

- Invite a test prod user to a test/prod company.
- Confirm email received, link opens prod app, user accepts, Cognito user completes password flow.
- Run Cognito ForgotPassword and ConfirmForgotPassword.

---

## Phase 6 — Production Nylas and mailbox integrations

**Objective:** Use a separate production Nylas app, callbacks, webhooks, and OAuth provider readiness.

### Task 6.1: Create prod Nylas app and secrets

**Files:**

- Modify: `infra/aws-prod/terraform.tfvars.example`.
- Modify/create: `docs/infra/mangorts-prod-nylas.md`.

**Manual/provider steps after approval:**

1. Create Nylas prod app/client.
2. Choose US/EU Nylas API base URL.
3. Store prod Nylas API key in Secrets Manager, e.g. `mangorts/prod/nylas-api-key`.
4. Generate/store prod Nylas state secret, e.g. `mangorts/prod/nylas-state-secret`.
5. Set prod Terraform/GitHub variables to the client ID and secret ARNs only.
6. After first deploy, register callback URL:
   - `https://api.<root>/nylas/oauth/callback`
7. Create webhook destination:
   - `https://api.<root>/nylas/webhook`
8. Subscribe to current triggers:
   - `message.created`
   - `message.updated`
   - `message.deleted`
   - `message.opened`
   - `folder.created`
   - `folder.updated`
   - `folder.deleted`
9. Store returned webhook secret in Secrets Manager, e.g. `mangorts/prod/nylas-webhook-secret`.
10. Redeploy so ECS gets `NYLAS_WEBHOOK_SECRET`.

### Task 6.2: Production Google OAuth readiness

**Files:**

- Update: `docs/important tasks/Old Stuff/production-gmail-oauth.md` or move it to a current prod doc.

**Preferred path:** Ask Nylas for shared GCP/shared Google OAuth credentials for production.

**Parallel backup path:** Prepare MangoRTS-owned Google OAuth verification:

- Verify domain in Google Cloud/Search Console.
- Publish privacy policy and terms.
- Complete OAuth consent branding.
- Explain each Gmail scope.
- Record demo video.
- Prepare restricted-scope security assessment materials if Google requires it.

**Do not claim production Gmail onboarding is ready** until Nylas shared GCP or Mango-owned Google verification is confirmed for the prod app.

### Task 6.3: Mailbox data migration rule

**Files:**

- Create: `docs/infra/mangorts-prod-data-migration.md`.
- Data migration scripts from Phase 8.

**Rule:** Do not import dev Nylas grant IDs as connected prod mailbox connections.

Recommended migration behavior:

- `user_email_connections`: skip or import as `reauth_required` only if needed for UI continuity.
- `company_email_connections`: skip or import as `reauth_required`; do not include active dev grant IDs unless separately proven safe.
- `shared_inboxes`: may be copied with `company_email_connection_id = null` if the product can show configuration pending; otherwise recreate after reconnect.
- `communications_email_archive_jobs` and job items: skip.
- Webhook receipts/logs/transient sync state: skip.

---

## Phase 7 — GitHub repository and deployment path

**Objective:** Make prod deploy controlled, auditable, and rollback-capable.

### Task 7.1: Add production GitHub Environment

**Files:** None committed for environment settings.

**GitHub settings after `gh` auth and approval:**

- Environment: `production`.
- Required reviewers: Jonat / designated operators.
- Restrict deployments to `main` and/or release tags.
- Environment secrets:
  - `AWS_PROD_DEPLOY_ROLE_ARN`
  - `ORIGIN_VERIFY_SECRET` or `PROD_ORIGIN_VERIFY_SECRET` (choose one naming convention and keep dev/prod distinct)
- Environment variables:
  - `AWS_REGION`
  - `TF_STATE_BUCKET`
  - `TF_STATE_KEY=mangorts/prod/terraform.tfstate`
  - `TF_STATE_REGION`
  - `TF_ROOT_DOMAIN_NAME`
  - prod subdomain values
  - prod sizing values
  - prod Nylas client ID and secret ARNs
  - prod email sender
  - initial bootstrap admin emails only for first deploy, then clear

**Note:** Nylas API key, state secret, webhook secret, DB password, and app DB password belong in AWS Secrets Manager, not GitHub secrets.

### Task 7.2: Add prod deploy workflow

**Files:**

- Create: `.github/workflows/deploy-prod.yml`
- Optionally refactor shared workflow pieces later.

**Workflow shape:**

1. `workflow_dispatch` only for V1.
2. `environment: production` so GitHub requires approval.
3. `concurrency: mangorts-prod-deploy`.
4. Checkout.
5. Set up Terraform.
6. Assume `AWS_PROD_DEPLOY_ROLE_ARN` through GitHub OIDC.
7. Run backend tests: `go test ./...` in `backend`.
8. Run frontend install/build or full repo verification: `node scripts/run_all_tests.mjs` if acceptable for CI time.
9. Write prod `backend.hcl` from GitHub environment variables.
10. Write prod `ci.auto.tfvars` without secret values.
11. `terraform init`, `terraform validate`, `terraform plan`.
12. Build/push backend image to prod ECR tagged by git SHA.
13. `terraform apply` after environment approval.
14. Run prod DB migration one-off task inside prod VPC.
15. Read Terraform outputs.
16. Build frontend with prod Cognito/API/company values.
17. Fail build if prod bundle contains dev company UUID.
18. Sync frontend to prod S3.
19. Invalidate prod CloudFront.
20. Run unauthenticated smoke tests.
21. Print deploy summary with app/API/Nylas callback/webhook URLs.

**Prod smoke tests:**

- `GET https://<prod-app>/deploy-info.json` returns current revision.
- `GET https://<prod-app>/accept-invite` returns frontend app.
- `GET https://<prod-app>/healthz` returns `ok=true`, `app_env=prod`, `auth_mode=cognito`, and current revision.
- `GET https://<prod-app>/v1/me` returns 401 unauthenticated.
- `GET https://<prod-app>/nylas/webhook?challenge=deploy-smoke-...` returns exact challenge.
- Optional: authenticated smoke after test admin exists.

### Task 7.3: Branch protection and CI

**Files:**

- Maybe create: `.github/workflows/ci.yml` if none exists.

**Rules:**

- Require PR before merge to `main`.
- Require CI: backend `go test ./...`, frontend build, frontend relationship tests.
- Require no direct pushes except explicitly allowed admins.
- Keep prod deploy manual until repeated deploys are boring.

---

## Phase 8 — Selective data migration

**Objective:** Move only selected real business data from dev into prod with explicit identity/provider mapping.

### Task 8.1: Inventory dev DB tables and row counts

**Files:**

- Create: `scripts/prod_data_inventory.ps1`
- Create: `scripts/prod_data_inventory.sql`
- Create: `docs/infra/mangorts-prod-data-migration.md`

**Output:** Table-by-table row counts and classification:

- copy as-is,
- copy with company/user mapping,
- recreate manually,
- rebuild from source tables,
- skip.

**Likely copy/map families:**

- `companies` — map dev company to prod company.
- `users` — preserve internal `user_id` where safe, but replace `cognito_subject` with prod Cognito subject by canonical lowercase email.
- `company_memberships` — map company ID and user IDs.
- `company_user_groups`, `company_user_group_members`, `company_user_group_closure`.
- `nodes`, `node_information`, `node_relationships`, `node_map_positions`.
- `logic_gates`, `logic_gate_information`, `logic_gate_relationships`, `logic_gate_map_positions`, `node_logic_gate_assignments`.
- `projects`, `project_*` tables.
- `accounts`, `account_folders`, `node_account_assignments`.
- `resource_*` permission/policy tables after confirming they are canonical.
- `company_explorer_*` source-of-truth rows after confirming V2/final state.
- `shared_inbox_folders` and maybe `shared_inboxes` without active provider connection.
- `saved_views`, `pins` if users are mapped.

**Likely skip/rebuild families:**

- `user_email_connections`, `company_email_connections` active grant state.
- `communications_email_archive_jobs`, `communications_email_archive_job_items`.
- webhook receipts/transient Nylas sync state if any.
- invitations/password reset/deletion queues.
- `notifications` and read-status rows unless product explicitly needs history.
- projection/read-version/cache tables where source rows can rebuild them.
- `domain_events`, `event_rows`, worker checkpoints unless needed to rebuild projections.

### Task 8.2: Create prod Cognito users and user map

**Files:**

- Create: `scripts/prod_user_mapping_template.csv.example`
- Create: `scripts/seed_prod_auth_membership.ps1` or generalize `scripts/seed_dev_auth_membership.ps1`.

**Steps:**

1. Create prod Cognito users for initial real users.
2. Fetch prod Cognito `sub` for each canonical lowercase email.
3. Build mapping table:

```text
dev_email,prod_email,dev_user_id,prod_user_id,prod_cognito_subject,role
```

**Recommendation:** Preserve `dev_user_id` as `prod_user_id` for selected users if there is no collision; update `cognito_subject` to prod subject. This avoids rewriting every user FK while keeping Cognito separate.

### Task 8.3: Build repeatable export/import scripts

**Files:**

- Create: `scripts/export_selected_dev_data.ps1`
- Create: `scripts/import_selected_prod_data.ps1`
- Create: `scripts/prod_data_migration_checks.sql`

**Requirements:**

- No plaintext secrets committed.
- Read dev through SSO/Secrets Manager or a snapshot/temporary migration DB.
- Write prod only after rehearsal passes.
- Use a transaction where feasible.
- Insert source-of-truth tables before dependents.
- Remap company IDs and Cognito subjects explicitly.
- Skip or null out environment-bound provider state.
- Run `ANALYZE` after import.

### Task 8.4: Rehearse migration on disposable prod-like DB

**Files:** Migration docs/scripts only.

**Steps:**

1. Restore/create disposable DB.
2. Apply repo schema/migrations.
3. Import selected data.
4. Run checks.
5. Point a temporary backend task at it or run local backend through SSM/VPC path if available.
6. Validate real UI workflows.
7. Reset and repeat until boring.

**Checks:**

- Expected company/user/node/logic gate/project/account/company-explorer counts.
- No orphaned foreign keys.
- No `11111111-1111-1111-1111-111111111111` if prod company ID remapping is chosen.
- No dev Cognito pool IDs/subjects except mapped prod subjects.
- No active dev Nylas grant IDs.
- No bootstrap admin allowlist left in prod after bootstrap.

---

## Phase 9 — Production launch validation

**Objective:** Prove prod works before calling it prod.

### Task 9.1: Unauthenticated smoke tests

**Commands:**

```bash
curl -i https://<prod-app-domain>/deploy-info.json
curl -i https://<prod-app-domain>/healthz
curl -i https://<prod-app-domain>/accept-invite
curl -i https://<prod-app-domain>/v1/me
curl -i "https://<prod-app-domain>/nylas/webhook?challenge=smoke"
```

**Expected:** Deploy metadata current, health ok, frontend routes load, protected routes 401, Nylas challenge returns exact body.

### Task 9.2: Authenticated application smoke tests

**Manual/browser + API checks:**

- First prod admin signs in.
- `/v1/me` returns prod user and prod memberships.
- Company scope is prod company UUID.
- Company Explorer loads.
- Node create/edit/delete works.
- Logic gate create/edit/delete works.
- Kanban load/mutation works.
- Saved views and pins work for mapped users.
- Permissions/GVIC behavior is sane.
- Notifications summary/load works.
- Realtime/websocket ticket and connection work if supported by current app.

### Task 9.3: Email/Nylas validation

**Checks:**

- Mango invite email is delivered from prod sender.
- Cognito password reset email is delivered and branded acceptably.
- Signup confirmation email is delivered if configured.
- Nylas Connect Google starts from prod app, returns through prod callback, and lands on prod frontend redirect.
- `user_email_connections` gets a prod grant after reconnect.
- Nylas webhook challenge works.
- A real mailbox event reaches prod webhook and updates Communications.
- Outbound email/send/archive behavior works if enabled for V1.

### Task 9.4: Monitoring/rollback validation

**Checks:**

- CloudWatch logs show prod deploy revision.
- ECS has two healthy tasks.
- ALB target group healthy.
- CloudFront invalidation completed.
- RDS metrics visible.
- SNS alarm email subscription confirmed.
- Backend rollback command documented: update ECS service to previous task definition revision or redeploy previous SHA.
- Frontend rollback documented: restore previous S3 object version or redeploy previous SHA and invalidate CloudFront.
- DB restore runbook documented: point-in-time restore to new cluster, not destructive restore over prod.

---

## Phase 10 — Lockdown after first successful prod

**Objective:** Remove bootstrap shortcuts and make prod boring.

### Task 10.1: Remove bootstrap admin allowlist

**Files:** GitHub Environment variables / Terraform vars only.

**Action:** Clear prod `bootstrap_admin_emails` / any equivalent `TF_BOOTSTRAP_*` variable after the first admin can invite/manage users in-app.

**Verification:** Redeploy or update ECS env; `/healthz` should not expose any bootstrap-specific state, and backend task definition should not include bootstrap emails.

### Task 10.2: Freeze prod data migration scripts/output

**Files:**

- Keep scripts if reusable, but store migration results/checks in a safe operational location, not secrets.
- Update `docs/infra/mangorts-prod-data-migration.md` with final decision table.

**Action:** Mark one-time migration complete. Do not keep rerunning import scripts against prod.

### Task 10.3: Document final runbooks

**Files:**

- Create: `docs/infra/mangorts-prod-platform.md`
- Create: `docs/infra/mangorts-prod-deploy-runbook.md`
- Create: `docs/infra/mangorts-prod-db-restore-runbook.md`
- Create: `docs/infra/mangorts-prod-secrets-rotation.md`
- Update: `docs/infra/README.md`

**Must include:**

- Exact AWS profile/account boundary.
- Exact GitHub Environment settings.
- Prod URLs.
- How to deploy.
- How to rollback frontend/backend.
- How to restore DB to a new cluster.
- How to rotate DB/Nylas/origin secrets.
- How to add/invite a new prod admin/user.
- How to reconnect mailbox and debug Nylas callbacks/webhooks.

---

## Files likely to change

```text
.github/workflows/ci.yml                         # optional but recommended
.github/workflows/deploy-dev.yml                 # maybe refactor after module extraction
.github/workflows/deploy-prod.yml                # new prod deploy
.gitignore                                       # ignore infra/aws-prod local files
backend/.env.example                             # document APP_ENV=prod and prod-safe envs
backend/Dockerfile.migrations                    # if choosing migration image
backend/cmd/miraeopus-migrate/main.go            # if choosing Go migration command
backend/db/schema.sql                            # only if drift reconciliation finds missing canonical schema
backend/db/migrations/*.sql                      # any drift fixes
backend/internal/...                             # only if prod hardening requires code changes
frontend/src/auth/currentCompany.ts              # optional prod hardening against dev UUID fallback
infra/modules/mangorts-platform/*                # new reusable Terraform module
infra/aws-dev/*                                  # thin dev root after module extraction
infra/aws-prod/*                                 # new prod root
scripts/*prod*migration*.ps1/.sql                # migration inventory/export/import/checks
scripts/seed_prod_auth_membership.ps1            # or generalized seed script
docs/infra/README.md                             # canonical docs update
docs/infra/mangorts-prod-platform.md             # new prod architecture doc
docs/infra/mangorts-prod-deploy-runbook.md       # new deploy runbook
docs/infra/mangorts-prod-db-migration.md         # new migration doc
docs/infra/mangorts-prod-db-restore-runbook.md   # new restore doc
docs/infra/mangorts-prod-email.md                # new email/SES doc
docs/infra/mangorts-prod-nylas.md                # new Nylas doc
```

---

## Validation commands before any prod apply

Run locally/CI after implementation work, before applying prod:

```bash
# Backend
cd backend
go test ./...

# Frontend/full repo from repo root
node scripts/run_all_tests.mjs

# Terraform dev root must still validate
cd infra/aws-dev
terraform fmt -recursive
terraform init -backend=false
terraform validate

# Terraform prod root must validate without a real backend
cd ../aws-prod
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Before production apply, run a reviewed plan:

```bash
cd infra/aws-prod
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
```

Do not run `terraform apply` against prod without explicit approval.

---

## Main risks and mitigations

1. **Dev DB drift becomes prod truth accidentally.**
   - Mitigation: schema from repo, scratch DB comparison, migrations for real drift.
2. **Provider state copied incorrectly.**
   - Mitigation: recreate Cognito/Nylas; map users by email; users reconnect mailboxes.
3. **Prod deploy path too powerful.**
   - Mitigation: GitHub Environment required reviewers, separate OIDC role, branch restrictions, least-privilege IAM follow-up.
4. **Prod email not deliverable.**
   - Mitigation: SES domain verification, DKIM/SPF/DMARC, sandbox removal, smoke tests.
5. **Google/Nylas OAuth not production-approved.**
   - Mitigation: Nylas shared GCP request plus Mango-owned verification backup; do not onboard broad Gmail users until approved.
6. **Private prod DB unreachable for migrations.**
   - Mitigation: run migrations as ECS one-off task or VPC-attached CodeBuild, not from GitHub-hosted runner directly.
7. **Hardcoded dev company ID leaks into prod.**
   - Mitigation: prod company ID output, frontend build guard, migration checks.
8. **Cost surprise.**
   - Mitigation: choose explicit prod sizing; CloudWatch budgets/alarms; keep dev cheap separately.

---

## Suggested execution order

1. Get explicit approvals/decisions for AWS account, domain, prod company ID, prod emails, initial users, and Nylas/Google path.
2. Refactor Terraform into module while keeping dev behavior unchanged.
3. Add `infra/aws-prod` root and validate only.
4. Add prod GitHub Environment/workflow and required CI gates.
5. Add managed prod Aurora, Secrets Manager, SES, Cognito hardening, alarms.
6. Add migration runner/task.
7. Create prod state bucket and run reviewed `terraform plan`.
8. Apply prod foundation only after approval.
9. Configure Nylas prod app callback/webhook and secrets.
10. Rehearse schema + data migration on disposable DB.
11. Deploy prod backend/frontend to empty prod DB.
12. Bootstrap first prod admin, clear bootstrap variable.
13. Import selected data if approved.
14. Run full validation checklist.
15. Lock runbooks, alarms, rollback, and secret rotation docs.

---

## Immediate next step

Before implementation, ask Jonat to choose/confirm:

1. Prod AWS account/profile: separate `mangorts-prod` account vs temporary same-account isolation.
2. Prod app/API domains.
3. Real prod company ID vs preserving the dev UUID for V1.
4. Initial prod admin/user emails.
5. Prod sender addresses (`no-reply`, `alerts`, `ops`).
6. Whether V1 must include live Gmail/Nylas production onboarding or whether controlled reconnect/pilot is acceptable while Google verification is pending.
