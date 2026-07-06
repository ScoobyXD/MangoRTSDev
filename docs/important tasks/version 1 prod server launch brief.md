# Version 1 Prod Server Launch Brief

## Purpose

This is the active agent handoff for getting the first real MangoRTS production server running.

Progress is tracked in `docs/important tasks/prod launch progress log.md`.

It deliberately narrows the scope to the first milestone: an empty-but-real production environment that runs separately from dev. Data migration, full Nylas production readiness, and broad production hardening come after the server exists and passes smoke tests.

Future agents should start here when the user asks to "set up prod", "create the production server", or "continue V1 prod".

## Current User Decisions

Confirmed by Jonat:

- Prod should use a **separate AWS account** from dev.
- Prod AWS account ID: `828435022930`.
- Prod AWS profile should be kept separate from dev; preferred local profile name: `mangorts-prod`.
- Prod AWS SSO profile `mangorts-prod` is configured and verified with `AdministratorAccess`.
- Prod Terraform state bucket: `mangorts-prod-terraform-state-828435022930`.
- AWS region: `us-west-1`.
- Prod default VPC discovered: `vpc-058fed523b6e847bf`, CIDR `172.31.0.0/16`.
- Prod public subnets discovered: `subnet-09be435bd9a9f6208` in `us-west-1c` and `subnet-0f07a73d47130fc8a` in `us-west-1a`.
- Prod Route 53 hosted zone created for `mangorts.com`: `Z05521211GBNMIH6SBM5Z`; registered domain nameservers now point at the prod hosted zone.
- Prod RDS DB has been created and verified: cluster `mangorts-prod-db`, database `mangorts`, writer endpoint `mangorts-prod-db.cluster-cpcceyaigiit.us-west-1.rds.amazonaws.com`, security group `sg-0ba84e2c327457f1e`.
- RDS created an AWS-managed credential secret: `arn:aws:secretsmanager:us-west-1:828435022930:secret:rds!cluster-d26dab99-99bc-40c2-9465-4a67189b1177-2xZr7k`. This ARN is metadata; do not record the secret value.
- Production domain: `mangorts.com`.
- Production API domain: `api.mangorts.com`.
- Production origin hostname can be `origin.mangorts.com` unless the final Terraform runbook chooses a different hidden origin name.
- Prod should use real production UUIDs for companies. Do not use the dev UUID `11111111-1111-1111-1111-111111111111` unless Jonat explicitly reverses this decision.
- First prod admin email will probably be Jonat's personal email, but the exact email must be confirmed before creating users or seeding membership.
- Jonat wants to personally perform the most sensitive manual setup steps, especially AWS account setup, database/password setup, and any credential-bearing provider setup.
- Agents should collect everything needed up front so Jonat can complete sensitive setup once, then let the agent proceed uninterrupted with repo/deploy work.

## First Milestone Definition

V1 prod server is done when all of this is true:

- A production URL exists at `https://mangorts.com` or another explicitly approved production app hostname under `mangorts.com`.
- API routes work through `https://api.mangorts.com` or the chosen app-origin API routing.
- Prod backend runs separately from dev.
- Prod frontend is deployed separately from dev.
- Prod database is separate from dev.
- Prod Cognito user pool/client are separate from dev.
- Prod Secrets Manager secrets are separate from dev.
- Prod Terraform state is separate from dev.
- First prod admin can log in.
- `/healthz` works.
- Unauthenticated `/v1/me` returns 401.
- Authenticated `/v1/me` returns the prod user and prod membership.
- A basic app page loads after login.
- Dev environment still works.

## What We Need To Do Now

### 1. Add repo scaffolding for prod

Required repo changes:

- Add `infra/aws-prod/` as a conservative production Terraform root.
- Prefer a copy-and-adjust approach from `infra/aws-dev` for the first pass.
- Do not do a large Terraform module refactor before first prod server exists.
- Add `infra/aws-prod/backend.hcl.example`.
- Add `infra/aws-prod/terraform.tfvars.example`.
- Add `.gitignore` entries for:
  - `infra/aws-prod/backend.hcl`
  - `infra/aws-prod/terraform.tfvars`
  - `infra/aws-prod/*.auto.tfvars`
  - `infra/aws-prod/tfplan`
- Add or update a prod deploy workflow, likely `.github/workflows/deploy-prod.yml`.
- Add a minimal prod deploy runbook.

Validation before any cloud mutation:

```bash
cd infra/aws-prod
terraform fmt
terraform init -backend=false
terraform validate

cd ../../backend
go test ./...

cd ..
node scripts/run_all_tests.mjs
```

### 2. Create prod AWS account and access boundary

Sensitive/manual user task unless Jonat asks the agent to do part of it later.

Needed from Jonat:

- Prod AWS account ID.
- Confirmation that the account is separate from dev.
- AWS SSO configured locally with profile name `mangorts-prod`.
- Confirmation that this command works locally:

```bash
aws sts get-caller-identity --profile mangorts-prod
```

Agent must not use `mangorts-dev` for prod work.

### 3. Create prod Terraform state backend

Prod Terraform needs remote state before real applies.

Jonat can create this manually, or explicitly approve the agent to guide/create it later.

Needed values:

- Terraform state S3 bucket name.
- Terraform state region, expected `us-west-1` unless changed.
- Terraform state key, recommended:

```text
mangorts/prod/terraform.tfstate
```

State bucket requirements:

- S3 bucket in prod AWS account.
- Versioning enabled.
- Server-side encryption enabled.
- Public access blocked.
- Access limited to prod admins/deploy role.
- Optional S3 native locking if supported by the Terraform backend version in use.

The resulting local, gitignored file should look like:

```hcl
bucket  = "<prod-terraform-state-bucket>"
key     = "mangorts/prod/terraform.tfstate"
region  = "us-west-1"
encrypt = true
# use_lockfile = true # if supported/enabled
```

Path:

```text
infra/aws-prod/backend.hcl
```

Never commit `backend.hcl`.

### 4. Decide production networking inputs

Current dev Terraform expects an existing VPC and subnets. For V1 prod, the simplest path is to provide existing prod VPC/subnet IDs rather than redesign networking first.

Needed from Jonat or AWS setup:

- Prod VPC ID.
- At least two public subnet IDs for the ALB.
- Either:
  - at least two private subnet IDs for ECS tasks, or
  - approval to let Terraform create ECS private subnets using provided CIDR blocks.
- NAT/egress choice:
  - `single` for cheaper first launch, or
  - `per_az` for stronger production posture.

Important clarification: MangoRTS currently deploys the backend as **ECS Fargate**, not a hand-managed EC2 server. If Jonat says "server", default interpretation is ECS Fargate backend service unless he explicitly asks to switch architecture to EC2.

### 5. Create prod database

Sensitive/manual user task for V1 unless explicitly delegated later.

Required for first prod server:

- Separate prod PostgreSQL/Aurora database. Do not use dev DB.
- Prod DB in the prod AWS account.
- Prod DB reachable from prod ECS networking.
- Prod DB backups enabled.
- Prod DB deletion protection enabled if this is intended to be real prod.
- Prod DB password stored in AWS Secrets Manager, not plaintext files.

Actual first prod DB created:

- Aurora PostgreSQL 17.7 / Aurora Serverless v2.
- Min ACU: 0.5.
- Max ACU: 2.
- Public access: No.
- DB cluster: `mangorts-prod-db`.
- DB name: `mangorts`.
- Master username: `mangorts_app`.
- Security group: `sg-0ba84e2c327457f1e`.
- RDS managed secret ARN: `arn:aws:secretsmanager:us-west-1:828435022930:secret:rds!cluster-d26dab99-99bc-40c2-9465-4a67189b1177-2xZr7k`.

Immediate required Terraform task:

- Update Terraform to reference the password field from the RDS-managed secret safely. Status: complete in repo; prod apply has not been run yet.
- Use `existing_db_password_secret_json_key = "password"` for the RDS-managed credential secret.
- GitHub prod deploy workflow now supports `TF_EXISTING_DB_PASSWORD_SECRET_JSON_KEY`, defaulting to `password`.

Needed values from Jonat after manual DB setup:

- DB writer endpoint hostname: `mangorts-prod-db.cluster-cpcceyaigiit.us-west-1.rds.amazonaws.com`.
- DB port: `5432`.
- DB name: `mangorts`.
- DB app username: `mangorts_app`.
- RDS managed Secrets Manager ARN: `arn:aws:secretsmanager:us-west-1:828435022930:secret:rds!cluster-d26dab99-99bc-40c2-9465-4a67189b1177-2xZr7k`.
- DB security group ID that Terraform may allow ingress from prod ECS tasks into: `sg-0ba84e2c327457f1e`.

Do not paste DB passwords into chat or commit them. Secret ARN is okay.

### 6. Apply schema to prod DB

Required before app works.

First empty DB can be bootstrapped from repo schema using existing scripts or a future migration runner:

```powershell
.\scripts\apply_canonical_schema.ps1
```

This requires a machine/path that can reach the prod DB. If the DB is private-only, options include:

- run from a controlled machine/VPN with network access,
- run an ECS one-off migration task,
- use a future Go migration runner image,
- or use another approved VPC-connected execution path.

For first server, polished migration automation is useful but not strictly required. The actual requirement is: prod DB has the app schema.

### 7. Create prod Cognito/auth

Required for cloud prod because the app uses Cognito auth.

Terraform should create:

- prod Cognito user pool,
- prod SPA client,
- any required machine client/resource server preserved from dev shape.

Needed from Jonat:

- exact first prod admin email,
- initial company name,
- generated/approved prod company UUID.

Bootstrap approach:

- Use a temporary bootstrap admin email allowlist only for first login, or seed membership after Cognito user creation.
- Remove/clear bootstrap allowlist immediately after first prod admin can invite/manage users.

### 8. Deploy backend/frontend

Required infrastructure pieces:

- ECR repository for prod backend image.
- ECS cluster/service/task definition.
- ALB + target group.
- CloudWatch logs.
- S3 frontend bucket.
- CloudFront distribution.
- ACM certificates.
- Route 53 DNS for `mangorts.com`, `api.mangorts.com`, and origin hostname.
- WAF if copying dev shape.
- Origin verification secret between CloudFront and ALB.

For V1, backend target size:

- Minimum to prove prod exists: 1 ECS task.
- Better first prod: 2 ECS tasks, 1 vCPU / 2 GiB each.

Frontend prod build must use:

```text
VITE_AUTH_MODE=cognito
VITE_API_BASE_URL=<prod app or API URL, matching routing choice>
VITE_COGNITO_REGION=us-west-1
VITE_COGNITO_USER_POOL_ID=<prod pool id>
VITE_COGNITO_CLIENT_ID=<prod spa client id>
VITE_COMPANY_ID=<prod company uuid>
```

Add a deploy guard that fails if the prod frontend bundle contains the dev UUID.

### 9. Create repeatable prod deployment path

Minimum acceptable V1:

- `.github/workflows/deploy-prod.yml`
- `workflow_dispatch` only.
- GitHub Environment: `production` if possible.
- GitHub OIDC role for prod deploy.
- Manual approval for prod deploys if available.
- Builds backend image.
- Applies Terraform using prod state.
- Builds and publishes frontend.
- Invalidates CloudFront.
- Runs smoke tests.

Bootstrap reality:

- The first Terraform apply may need to be run locally by Jonat with `mangorts-prod` to create the ECR repository, Cognito, CloudFront/S3/ALB/ECS skeleton, and GitHub OIDC deploy role.
- After that, save the deploy role ARN as a GitHub production environment secret and use GitHub Actions for normal deploys.

Needed GitHub production secrets/vars after initial setup:

Secrets:

- `AWS_PROD_DEPLOY_ROLE_ARN`
- `PROD_ORIGIN_VERIFY_SECRET` or agreed equivalent

Variables:

- `AWS_REGION=us-west-1`
- `TF_STATE_BUCKET`
- `TF_STATE_KEY=mangorts/prod/terraform.tfstate`
- `TF_STATE_REGION=us-west-1`
- `TF_ROOT_DOMAIN_NAME=mangorts.com`
- `TF_APP_SUBDOMAIN` if app is subdomain-based; blank/root support must be explicitly tested if using apex `mangorts.com`.
- `TF_API_SUBDOMAIN=api`
- `TF_ORIGIN_SUBDOMAIN=origin`
- `TF_VPC_ID`
- `TF_PUBLIC_SUBNET_IDS`
- `TF_PRIVATE_SUBNET_IDS` or private subnet creation vars
- DB endpoint/name/user/secret ARN/security group ID
- `TF_DEFAULT_COMPANY_ID=<prod company uuid>`
- optional `TF_EMAIL_FROM_ADDRESS`
- optional temporary `TF_BOOTSTRAP_ADMIN_EMAILS`

## What We Do Not Need For First Server

These are intentionally deferred until after first prod server works:

### Not now: Big Terraform module refactor

Do not refactor `infra/aws-dev` into a shared module before first prod server exists. It creates a large diff and risks breaking dev. Copy `infra/aws-dev` to `infra/aws-prod` first; refactor later after prod is stable.

### Not now: Dev data migration

Prod can start empty. Do not migrate dev rows until core prod infra, auth, DB schema, and deploy path work.

### Not now: Nylas production readiness

Nylas can be disabled for first prod server unless Jonat explicitly wants Communications working on day one.

Later work:

- create prod Nylas app,
- configure callback/webhook,
- store Nylas secrets in Secrets Manager,
- confirm Google OAuth production readiness/shared GCP project,
- make users reconnect mailboxes.

### Not now: Full SES/email deliverability

Prod invite/signup email can be temporarily disabled for first server if first admin is created manually and membership is seeded/bootstrap-created.

Later work:

- verify SES domain/sender,
- DKIM/SPF/DMARC,
- SES sandbox removal,
- branded Cognito/password reset emails.

### Not now: Full monitoring program

Minimum for first server:

- CloudWatch logs,
- ECS/ALB health,
- smoke tests.

Later:

- alarms,
- dashboards,
- incident runbook,
- restore drill.

### Not now: Backup restore drill

Enable DB backups from day one, but do not block first server on a full restore drill. Do the restore drill before real customer reliance.

### Not now: Autoscaling

Use fixed ECS desired count first. Add autoscaling after baseline performance is known.

### Not now: Data migration scripts

Do not write selective data migration until the empty prod environment is running and Jonat decides what dev data is worth moving.

## User Setup Checklist Before Agent Can Proceed Mostly Uninterrupted

Jonat should prepare or provide these non-secret values.

### AWS/account

- [ ] Prod AWS account created.
- [ ] AWS SSO access configured.
- [ ] Local AWS CLI profile `mangorts-prod` works.
- [ ] `aws sts get-caller-identity --profile mangorts-prod` returns the prod account.
- [ ] Prod account ID provided to agent.

### Domain/DNS

- [ ] `mangorts.com` owned/registered.
- [ ] Route 53 hosted zone exists in the prod account, or DNS delegation plan is clear.
- [ ] Agent is told whether app should be apex `mangorts.com` or a subdomain such as `app.mangorts.com`.
- [ ] API should be `api.mangorts.com` unless changed.

### Terraform state

- [ ] Prod Terraform state S3 bucket created.
- [ ] Bucket versioning enabled.
- [ ] Bucket encryption enabled.
- [ ] Public access blocked.
- [ ] Bucket name provided.
- [ ] State key approved: `mangorts/prod/terraform.tfstate`.

### Networking

- [ ] Prod VPC ID provided.
- [ ] Prod public subnet IDs provided, at least two.
- [ ] Prod private subnet IDs provided, at least two, or approval given for Terraform-managed private ECS subnets.
- [ ] NAT choice provided: `single` or `per_az`.

### Database

- [ ] Prod DB created in prod account.
- [ ] DB backups enabled.
- [ ] DB deletion protection decided/enabled.
- [ ] DB writer endpoint provided.
- [ ] DB port provided.
- [ ] DB name provided.
- [ ] DB app username provided.
- [ ] DB password stored in Secrets Manager.
- [ ] DB password secret ARN provided.
- [ ] DB security group ID provided.

### App identity/bootstrap

- [ ] Prod company name provided.
- [ ] Prod company UUID generated/approved.
- [ ] Exact first prod admin email provided.

### GitHub

- [ ] `gh auth login` completed locally, or alternate GitHub push/API auth available.
- [ ] Decision made whether agent may push branch/open PR.
- [ ] Production GitHub Environment may be created manually by Jonat or later by explicit approval.

### Optional for first server

- [ ] SES sender/domain if invite emails must work immediately.
- [ ] Prod Nylas app/secrets if Communications must work immediately.
- [ ] Alert email if alarms are part of first launch.

## Agent Operating Rules For This Work

- Do not run `terraform apply` against prod without explicit Jonat approval.
- Do not modify prod Route 53, Cognito, RDS/Aurora, ECS/ECR, Secrets Manager, GitHub environments, or Nylas settings without explicit approval.
- Do not store prod secrets in plaintext local files.
- Do not ask Jonat to paste passwords/API keys into chat.
- Use `mangorts-prod` for prod and `mangorts-dev` for dev; never mix them.
- Keep dev working while adding prod.
- Start with conservative copy-and-adjust `infra/aws-prod`; refactor later.
- Treat first prod as empty unless Jonat explicitly approves a data migration phase.

## Current Repo-Only Scaffolding Status

Initial repo-only scaffolding now exists on branch `prod-scaffolding-v1`:

- `infra/aws-prod/` copied conservatively from `infra/aws-dev` and adjusted for prod defaults.
- `.github/workflows/deploy-prod.yml` added as a manual `workflow_dispatch` deploy using GitHub Environment `production`.
- `docs/important tasks/prod deploy runbook.md` added.
- `.gitignore` updated for prod Terraform local files.

Validation completed:

- `terraform fmt -recursive infra/aws-prod`
- `terraform init -backend=false`
- `terraform validate`
- `go test ./...` from `backend/`
- `node scripts/run_all_tests.mjs`

No prod cloud resources were created or modified.

## Recommended Next Agent Task

Review the repo-only diff with Jonat:

1. Confirm the `infra/aws-prod` defaults are acceptable.
2. Confirm the manual setup checklist.
3. Do not run `terraform apply` or any prod cloud action yet.
4. After Jonat approves the repo-only changes, move to manual AWS/prod setup.

Do not merge large Codex-generated Terraform module refactors for this first milestone.

### Current local Terraform input/plan status

- Local gitignored `infra/aws-prod/terraform.tfvars` has been created.
- It contains generated `origin_verify_secret`; do not print or commit this file.
- Generated default prod company UUID: `face60cd-27e2-4e5a-92b0-b2cdb78545c8`.
- First local plan succeeded with `Plan: 55 to add, 0 to change, 0 to destroy`.
- No prod Terraform apply has been run yet.
- Planned first apply creates the prod skeleton but not the backend ECS service, because `backend_image_uri = ""` until ECR has an image.
- GitHub deploy role in the plan is scoped to branch `prod-scaffolding-v1`.

### First prod Terraform apply result

Status: complete.

- First prod Terraform apply succeeded with `55 added, 0 changed, 0 destroyed`.
- App URL output: `https://mangorts.com`.
- API URL output: `https://api.mangorts.com`.
- Backend ECR repository: `828435022930.dkr.ecr.us-west-1.amazonaws.com/mangorts-prod-backend`.
- CloudFront distribution: `E163LYR5A8EQMJ` / `d3pnjorzs8umb3.cloudfront.net`.
- Cognito user pool: `us-west-1_tddWJsjUA`.
- Cognito SPA client: `5dds4k34vnt2n1ub8deg6m617h`.
- ECS cluster: `mangorts-prod-cluster`.
- ECS service output is empty because the backend image has not been built/pushed yet.
- Frontend bucket: `mangorts-prod-frontend-828435022930`.
- GitHub deploy role: `arn:aws:iam::828435022930:role/mangorts-prod-github-deploy`.
- Managed NAT gateway: `nat-078f52f1357ee5442`.
- Next required step is building/pushing the backend image and then applying a second Terraform plan with `backend_image_uri` set.

### Current deployed prod status

Status: backend, frontend, and empty prod DB schema are deployed.

- Backend image deployed: `828435022930.dkr.ecr.us-west-1.amazonaws.com/mangorts-prod-backend@sha256:6dc68dc0a05072345a43b132982bff413485626883955a015cd3e3a34aaa4941`.
- Deploy revision: `manual-71a55e34-20260706T053946Z`.
- ECS service: `mangorts-prod-backend`.
- ECS desired/running tasks: `2` / `2`.
- Prod frontend has been built and published to `mangorts-prod-frontend-828435022930`.
- Prod frontend now uses app-origin API routing with `VITE_API_BASE_URL=https://mangorts.com`.
- Prod frontend build guard passes without the dev company UUID in the production bundle.
- Prod DB schema bootstrap completed through one-off ECS/Fargate because the DB is private.
- Successful DB bootstrap marker: `MANGORTS_PROD_DB_BOOTSTRAP_OK schema_applied=true supplemental_migrations_applied=1 migrations_marked=140`.
- Current smoke tests pass for deploy info, frontend route rewrite, app/API health, unauthenticated 401 routes, invalid invitation token 404, and Nylas webhook challenge.

Immediate next milestone work:

1. Decide and configure first prod admin/bootstrap email.
2. Verify first prod admin login.
3. Verify authenticated `/v1/me` returns the prod user and prod membership.
4. Configure GitHub production secrets/vars so GitHub Actions can repeat the deploy path.

No recursive deletion was run during the backend/ECS/schema bootstrap continuation. No DB password or origin verification secret was printed or recorded.
