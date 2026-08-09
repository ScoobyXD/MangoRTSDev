# MangoRTS Dev Deploy Runbook V2

## One-Time Setup

1. Register the domain in Route 53.
2. Create a public hosted zone for the domain if Route 53 did not create one automatically.
3. Put the existing dev database password into Secrets Manager.
4. Create the Terraform state S3 bucket manually before Terraform runs. Enable encryption and versioning. Enable S3 native locking if the Terraform backend in use supports it.
5. Copy `infra/aws-dev/backend.hcl.example` to `infra/aws-dev/backend.hcl` and fill in the bucket, key, region, and encryption settings.
6. Fill `infra/aws-dev/terraform.tfvars` from `terraform.tfvars.example`. For phase-1 bootstrap, keep `backend_image_uri = ""`.
7. Run:

```powershell
cd infra/aws-dev
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

This phase creates ECR, Cognito, S3, CloudFront, ALB, Route 53, ACM, WAF, IAM/OIDC, and shared networking/security resources. It intentionally does not create the ECS task definition or service until a backend image URI exists.

8. Save the `github_deploy_role_arn` output as GitHub secret `AWS_DEV_DEPLOY_ROLE_ARN`.
9. Use the existing GitHub environment named `development` only to scope DEV values. The current private-repository plan does not support required environment reviewers or deployment-branch restrictions, so this environment is not an independent approval gate. Before the environment-bound workflow is used, run one separately reviewed DEV IAM bootstrap from the existing branch-trusted path so the deploy role trusts both the current branch subject and the exact `repo:<owner>/<repository>:environment:development` OIDC subject. The module adds that DEV environment subject by default and leaves non-DEV trust unchanged.
10. Leave `TF_PLAN_AGE_IDENTITY` and `TF_PLAN_AGE_RECIPIENT` unconfigured until a human chooses an available GitHub plan/permission change, an external approval gate, or explicitly accepts manual self-review. The workflow keeps both inputs mandatory. After that decision, generate one `age` X25519 identity outside the repository, store the private `AGE-SECRET-KEY-...` value only as the `development` environment secret `TF_PLAN_AGE_IDENTITY`, and store its matching public `age1...` recipient as the environment variable `TF_PLAN_AGE_RECIPIENT`. Never put either private identity or a plaintext Terraform plan in a repository file or artifact.
11. Set the remaining GitHub variables/secrets used by `.github/workflows/deploy-dev.yml`, including state backend values, Terraform inputs, `AWS_REGION`, `ORIGIN_VERIFY_SECRET`, and a nonempty `TF_EMAIL_WORKER_ALARM_ACTION_ARNS` JSON array before any nonzero SQS-enabled API stage.
12. To enable Communications, store the Nylas API key and OAuth state secret in AWS Secrets Manager, then set the GitHub Nylas variables listed below. Provider-side synchronization requires a Nylas webhook destination and webhook secret after the first deploy exposes the webhook URL; browser mail surfaces remain canonical HTTP loads/manual refresh and do not use MangoRTS WebSocket delivery.
13. Apply database schema/migrations from a machine that can reach the DB, then bootstrap the first dev admin. Prefer setting `TF_BOOTSTRAP_DEV_ADMIN_EMAILS` for the first deploy, signing in once, and clearing it after the dev admin can invite users. The older manual fallback is to seed the dev company membership after the first Cognito user exists.

## GitHub Configuration

Required secrets:

- `AWS_DEV_DEPLOY_ROLE_ARN`
- `ORIGIN_VERIFY_SECRET`
- `TF_PLAN_AGE_IDENTITY` in the `development` environment only, intentionally unconfigured pending the human deployment-gate decision

During migration from the old dev Basic Auth setup, the workflow can fall back to the existing `DEV_BASIC_AUTH_PASSWORD` secret as origin-verification secret material. Prefer creating `ORIGIN_VERIFY_SECRET` and removing the old secret after a successful deploy.

Required variables:

- `AWS_REGION`
- `TF_STATE_BUCKET`
- `TF_ROOT_DOMAIN_NAME`
- `TF_VPC_ID`
- `TF_PUBLIC_SUBNET_IDS` as a JSON string array
- `TF_EXISTING_DB_HOST`
- `TF_EXISTING_DB_NAME`
- `TF_EXISTING_DB_USER`
- `TF_EXISTING_DB_PASSWORD_SECRET_ARN`
- `TF_EXISTING_DB_SECURITY_GROUP_ID`
- `TF_DEV_COMPANY_ID`
- `TF_COGNITO_DOMAIN_PREFIX`
- `TF_EMAIL_WORKER_ALARM_ACTION_ARNS` as a nonempty JSON string array before any nonzero SQS-enabled API, worker, or schedule stage
- `TF_PLAN_AGE_RECIPIENT` in the `development` environment, intentionally unconfigured pending the same decision
- `TF_EMAIL_FROM_ADDRESS` once SES sender verification is ready
- `TF_BOOTSTRAP_DEV_ADMIN_EMAILS` for first deploy only, then clear it

For ECS networking, use one of these:

- Existing private subnets: set `TF_PRIVATE_SUBNET_IDS` as a JSON string array and leave `TF_CREATE_PRIVATE_ECS_SUBNETS=false`.
- Terraform-managed private subnets: set `TF_CREATE_PRIVATE_ECS_SUBNETS=true` and `TF_ECS_PRIVATE_SUBNET_CIDRS` as a JSON string array.

Optional variables have workflow defaults: `TF_STATE_KEY`, `TF_STATE_REGION`, `TF_APP_SUBDOMAIN`, `TF_API_SUBDOMAIN`, `TF_ORIGIN_SUBDOMAIN`, `TF_EXISTING_DB_PORT`, `TF_PRIVATE_SUBNET_IDS`, `TF_CREATE_PRIVATE_ECS_SUBNETS`, `TF_ECS_PRIVATE_SUBNET_CIDRS`, `TF_ECS_NAT_GATEWAY_MODE`, `TF_GITHUB_OWNER`, `TF_GITHUB_REPOSITORY`, and `TF_GITHUB_BRANCH`.

Nylas Communications variables:

- `TF_NYLAS_CLIENT_ID`: Nylas application ID/client ID.
- `TF_NYLAS_API_KEY_SECRET_ARN`: AWS Secrets Manager ARN containing the Nylas API key.
- `TF_NYLAS_STATE_SECRET_ARN`: AWS Secrets Manager ARN containing a long random state-signing secret.
- `TF_NYLAS_WEBHOOK_SECRET_ARN`: optional until the webhook exists; AWS Secrets Manager ARN containing the `webhook_secret` returned by the Nylas webhook destination. Required to authenticate provider webhook synchronization, not for browser WebSocket delivery.
- `TF_NYLAS_API_BASE_URL`: optional, defaults to `https://api.us.nylas.com`; use `https://api.eu.nylas.com` only for EU Nylas apps.
- `TF_NYLAS_GOOGLE_SCOPES`: optional, defaults to the fully qualified Gmail scopes required by Mango.
- `TF_NYLAS_MICROSOFT_SCOPES`: optional, defaults to `offline_access User.Read Mail.ReadWrite Mail.Send`.

Store Nylas secret values in AWS Secrets Manager, not GitHub secrets or Terraform variables:

```powershell
aws secretsmanager create-secret `
  --region $env:AWS_REGION `
  --name mangorts/dev/nylas-api-key `
  --secret-string "<nylas-api-key>"

$stateBytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($stateBytes)
$stateSecret = [Convert]::ToBase64String($stateBytes)
aws secretsmanager create-secret `
  --region $env:AWS_REGION `
  --name mangorts/dev/nylas-state-secret `
  --secret-string $stateSecret
```

After the workflow runs, register the `nylas_callback_url` Terraform output in the Nylas dashboard for the same Nylas app:

```text
https://api.dev.<domain>/nylas/oauth/callback
```

Then create a Nylas webhook destination using the `nylas_webhook_url` Terraform output:

```text
https://api.dev.<domain>/nylas/webhook
```

Subscribe the webhook to these triggers: `message.created`, `message.updated`, `message.deleted`, `message.opened`, `folder.created`, `folder.updated`, and `folder.deleted`. Nylas sends update suffixes such as `.truncated` or `.transformed` without subscribing to those suffixes separately; the backend accepts them by prefix.

These triggers update backend/provider-backed state only. They do not publish a Communications realtime scope to browsers; mail views load canonical data on open or manual refresh.

If using the Nylas API instead of the dashboard, create the webhook after the first deploy:

```powershell
curl --request POST `
  --url "https://api.us.nylas.com/v3/webhooks/" `
  --header "Content-Type: application/json" `
  --header "Authorization: Bearer <nylas-api-key>" `
  --data '{ "trigger_types": ["message.created", "message.updated", "message.deleted", "message.opened", "folder.created", "folder.updated", "folder.deleted"], "description": "MangoRTS dev communications", "webhook_url": "https://api.dev.<domain>/nylas/webhook", "notification_email_addresses": ["ops@example.com"] }'
```

Store the returned `webhook_secret` in Secrets Manager, set `TF_NYLAS_WEBHOOK_SECRET_ARN`, and redeploy:

```powershell
aws secretsmanager create-secret `
  --region $env:AWS_REGION `
  --name mangorts/dev/nylas-webhook-secret `
  --secret-string "<webhook-secret-from-nylas>"
```

## Normal Deploy

The workflow `.github/workflows/deploy-dev.yml` currently runs manually through `workflow_dispatch` only and refuses every ref except `refs/heads/main` before the deploy job starts. This is intentional while the first AWS dev deploy is being stabilized. Re-enable `push` deploys only after repeated dev deploys are boring and reliable.

The workflow separates `plan` from `apply-reviewed-plan`. The plan remains reviewable in the environment-scoped manual run log. Its exact binary plan, redacted text rendering, checksum, and rollout metadata are packed and encrypted with `age`; only the `.tar.age` ciphertext crosses runs. The apply run derives the recipient from `TF_PLAN_AGE_IDENTITY`, verifies it matches `TF_PLAN_AGE_RECIPIENT`, decrypts only in runner temporary storage, verifies the exact plan checksum and rollout identity, and applies that binary. Plaintext plan, tfvars, identity, and decrypted bundle are never uploaded and are removed from the runner at job completion.

This is manual exact-plan self-review, not independent approval. Under the current private-repository GitHub plan, the `development` environment cannot require reviewers or deployment-branch restrictions, and a repository writer could modify the workflow. Keep the age inputs unconfigured until a human chooses the GitHub plan/permissions change, an external gate, or explicit acceptance of that limitation.

It performs:

1. Assume AWS role with GitHub OIDC.
2. Run `go test ./...`.
3. Initialize Terraform with `backend.hcl` generated from GitHub variables.
4. Validate Terraform.
5. Read the ECR repository URL from Terraform state.
6. Build and push backend image tagged with the git SHA.
7. Run `terraform plan` with that immutable backend image URI, encrypt and retain only the exact ciphertext, and stop for review.
8. On a separate environment-scoped manual dispatch from `main`, download, decrypt, verify, and apply only that exact reviewed plan.
9. Read frontend/Cognito outputs from Terraform state.
10. Build the frontend with Cognito and API env vars.
11. Sync `frontend/dist` to S3.
12. Invalidate CloudFront.
13. Print the app, API, and Nylas callback URLs into the GitHub step summary.

### Editor Projection Revision Rollout

The release containing `20260714_editor_text_projection_revisions.sql` changes Node and Logic Gate full-document writes from last-write-wins to required optimistic revisions. For that first release only:

1. Announce a maintenance/reload boundary so users save current editor work and close or reload old Mango tabs.
2. Have Jonat apply the revision migration through the human-only database administration path before deploying the application. Agents and deploy automation must not use a writer credential.
3. Deploy the matching backend and frontend together, then complete the normal CloudFront invalidation.
4. Verify a fresh client loads positive revisions for existing text boxes and sends `expected_revision: 0` for a new text box. A pre-revision request with no expected revision must remain rejected; do not re-enable last-write-wins compatibility.
5. Smoke-test one Node and one Logic Gate stale-tab conflict, plus image-to-Node creation, before ending the maintenance window.

## Current Dev Shortcuts

- Dev deploys are manual-only for now: `Actions -> Deploy MangoRTS Dev -> Run workflow`.
- The dev site no longer has a CloudFront Basic Auth gate. Public pages load normally; app data remains protected by Cognito and backend company-membership authorization.
- CloudFront still sends a private origin-verification header to the ALB so direct origin requests are rejected.
- The dev company ID is intentionally hardcoded as `11111111-1111-1111-1111-111111111111` until tenant onboarding and company selection exist.
- Before real company onboarding, either use `TF_BOOTSTRAP_DEV_ADMIN_EMAILS` once or seed Cognito user membership against the hardcoded dev company ID so authenticated API calls pass company authorization.
- Replace the hardcoded dev company flow with backend-driven tenant discovery before onboarding external companies.

## Dev Database Drift Note

The current AWS dev database predates the `schema_migrations` table and has also had schema changes made through earlier manual/app-driven work. Because of that, the first migration reconciliation may replay older migrations against a partially current schema. Prefer making migrations idempotent and compatible with the existing dev schema over manually marking migrations as applied. Only baseline `schema_migrations` by hand after validating that the live schema matches the expected application schema.

## Smoke Tests

After deploy:

```powershell
curl -i https://dev.<domain>/healthz
curl -i https://api.dev.<domain>/healthz
```

Both URLs should be reachable without a browser-level Basic Auth challenge. API calls to protected `/v1/*` routes still require Cognito Bearer tokens.

For Communications, confirm the callback route is forwarded to the backend and not served by S3:

```powershell
curl -i https://api.dev.<domain>/nylas/oauth/callback
curl -i "https://api.dev.<domain>/nylas/webhook?challenge=smoke"
```

The expected result without OAuth query parameters is a redirect back to the frontend with a `nylas_error` query parameter, not a CloudFront/S3 404.
The webhook challenge should return HTTP 200 with a plain `smoke` body and no extra JSON or HTML.

## Rollback

For backend rollback, update the ECS service to the previous task definition revision.

For frontend rollback, restore a previous S3 object version or redeploy the previous commit and invalidate CloudFront.
