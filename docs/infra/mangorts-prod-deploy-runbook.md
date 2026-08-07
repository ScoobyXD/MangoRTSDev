# MangoRTS Production Deploy Runbook

MangoRTS production does not exist yet. This runbook defines the safe deployment path to create and operate it. It must not be used as evidence that prod resources, secrets, DNS, or provider apps already exist.

Do not run `terraform apply` for production, create cloud resources, or mutate AWS/GitHub/Nylas settings without explicit human approval for that action.

## Required Approval Gates

Production deploys must use a GitHub Environment named `production`.

Minimum environment rules:

- Required reviewers for every production deployment.
- Prod-only secrets and variables. Do not reuse dev environment secrets.
- Branch restriction to `main`, or a narrower release branch rule if the team adopts release branches.
- GitHub OIDC role constrained to this repository and the approved production branch/environment.

Required human approvals before first prod deploy:

- Infrastructure owner approves the Terraform plan and confirms the state backend points at prod state.
- Data owner approves the migration inventory and company/user mapping.
- Auth owner approves Cognito prod pool/client settings and bootstrap admin plan.
- Email owner approves Nylas, Google OAuth, SES, DKIM, SPF, and DMARC readiness.
- App owner approves smoke-test scope and rollback plan.

## Before First Production Deploy

1. Confirm CI is passing on `main` through `.github/workflows/ci.yml`.
2. Create or approve the production Terraform state backend outside of Terraform. Enable encryption, versioning, and locking where supported.
3. Prepare prod-specific Terraform inputs from `infra/aws-dev/terraform.tfvars.example` as a starting point, but do not commit prod values or secrets.
4. Store sensitive values in AWS Secrets Manager, including DB password, Nylas API key, Nylas state secret, Nylas webhook secret, and origin verification secret.
5. Create the GitHub Environment `production` with prod-only variables/secrets. Store the production deploy role ARN as a GitHub environment secret, not a repo-wide dev secret.
6. Verify prod DNS plan: app domain, API path routing, origin hostname, ACM certificates, Nylas callback/webhook URLs, SES verification records, and Google OAuth authorized domains/redirects.
7. Build a fresh prod database from repo schema/migrations. Do not clone dev wholesale.
8. Run the data migration rehearsal described in `docs/infra/mangorts-prod-data-migration.md`.
9. Create the prod Cognito pool and first admin flow, then remove any one-time bootstrap setting after the admin can invite users.
10. Create the prod Nylas app and configure production callback/webhook settings as described in `docs/infra/mangorts-prod-nylas-email.md`.

## CI And Build Checks

Production candidates must pass the same checks as CI:

```powershell
cd C:\Users\Jonat\MangoRTSDev
cd frontend
npm ci
cd ..
node scripts\run_all_tests.mjs
```

`scripts/run_all_tests.mjs` runs:

- `npm run test:node-relationships` from `frontend/`
- `npm run build` from `frontend/`
- `go test ./...` from `backend/`

There is no root `package.json`; never run `npm install` from the repo root.

## Production Deploy Flow

The future production workflow should mirror the safe shape of `.github/workflows/deploy-dev.yml`, with production-specific gates:

1. Require GitHub Environment `production` approval.
2. Assume the production AWS deploy role through GitHub OIDC.
3. Run backend tests and frontend build checks, or require the CI workflow result for the same SHA.
4. Generate Terraform backend config for the prod state bucket/key from GitHub environment variables.
5. Generate Terraform input variables from GitHub environment variables and Secrets Manager ARNs. Do not print secret values.
6. Run `terraform init` and `terraform validate`.
7. Build the backend image from `backend/Dockerfile`, tag it with the git SHA, and push it to the production ECR repository.
8. Run `terraform plan -out=tfplan` with the immutable backend image URI.
9. Pause for explicit review of the plan before apply.
10. Run `terraform apply tfplan` only after approval.
11. Read Terraform outputs for app URL, Cognito pool/client IDs, CloudFront distribution, S3 frontend bucket, and Nylas URLs.
12. Build the frontend from `frontend/` using production `VITE_*` values.
13. Write `frontend/dist/deploy-info.json` with the git SHA, app URL, API base URL, auth mode, and build time.
14. Sync `frontend/dist` to the production S3 bucket.
15. Invalidate the production CloudFront distribution.
16. Run smoke tests before declaring the deploy complete.

## Required Production Variables And Secrets

Use prod-specific names, even if the initial Terraform root still uses dev-oriented variable names internally.

Expected GitHub Environment secrets:

- Production AWS deploy role ARN.
- Any deploy-only secret that cannot be represented as a Secrets Manager ARN.

Expected GitHub Environment variables:

- AWS region.
- Terraform state bucket, key, and region.
- Root domain and app/API/origin subdomains.
- VPC and subnet IDs.
- Production DB host, name, user, port, password secret ARN, and DB security group ID.
- Production company ID after the company ID decision is made.
- Cognito domain prefix or placeholder if the Hosted UI variable remains deprecated.
- SES sender address.
- Nylas client ID, API base URL, scopes, and Secrets Manager ARNs for Nylas secrets.
- GitHub owner/repository/branch allowed to deploy.

Do not store production plaintext secrets in GitHub variables, committed `*.tfvars`, local docs, or workflow logs.

## Smoke Tests

Run smoke tests against production URLs after every deploy:

```powershell
curl -i https://<prod-app-domain>/deploy-info.json
curl -i https://<prod-app-domain>/healthz
curl -i https://<prod-app-domain>/accept-invite
curl -i https://<prod-app-domain>/v1/me
curl -i "https://<prod-app-domain>/nylas/webhook?challenge=prod-smoke"
```

Expected public-route behavior:

- `/deploy-info.json` returns the deployed git SHA.
- `/healthz` returns HTTP 200 and reports `deploy_environment` as prod and `deploy_revision` as the deployed SHA.
- `/accept-invite` returns the frontend app shell.
- `/v1/me` returns HTTP 401 without a Cognito token.
- `/nylas/webhook?challenge=prod-smoke` returns HTTP 200 with the challenge body.

Authenticated smoke tests require a real prod user:

- Cognito login succeeds.
- `/v1/me` returns the expected user and company membership.
- Company Explorer loads.
- Node create/edit/delete works.
- Logic gate create/edit/delete works.
- Kanban board load/mutation works.
- Saved views and pins work.
- Permission/RACI checks match expected roles.
- Notifications load.
- Nylas OAuth connect completes for a test mailbox.
- Shared inbox webhook updates reach the backend if Communications is enabled.
- Invitation email sends from the verified production SES sender.

## Rollback

Backend rollback:

- Prefer redeploying the previous known-good git SHA through the production workflow.
- Emergency fallback is updating the ECS service to the previous task definition revision, then confirming `/healthz` reports the expected prior revision.

Frontend rollback:

- Prefer redeploying the previous known-good git SHA.
- Emergency fallback is restoring prior S3 object versions for the frontend bucket and invalidating CloudFront.

Database rollback:

- Schema migrations must have an explicit rollback or forward-fix plan before apply.
- For destructive migrations, take a manual snapshot or confirm PITR restore position before deploying.
- Do not restore production DB from backup without an incident lead approving data-loss and downtime implications.

Provider rollback:

- Nylas callback/webhook changes should be reversible in the Nylas dashboard.
- SES sender/domain changes should not remove old verified records until the new sender has sent successfully.
- Cognito changes that affect login must include a tested admin recovery path.

## Deployment Stop Conditions

Stop and do not continue the production deploy when:

- Terraform plan includes dev resources, dev state, dev domains, or dev Secrets Manager ARNs.
- Any plaintext production secret appears in a file or workflow log.
- CI failed for the deployed SHA.
- The migration inventory is not approved.
- Smoke tests fail after the deploy.
- `/healthz` reports the wrong environment or git SHA.
- Nylas webhook challenge does not return the raw challenge body.
- Cognito login works but `/v1/me` cannot load the expected company membership.
