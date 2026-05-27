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
9. Set GitHub variables/secrets used by `.github/workflows/deploy-dev.yml`, including state backend values, Terraform inputs, `AWS_REGION`, and `ORIGIN_VERIFY_SECRET`.
10. To enable Communications, store the Nylas API key and OAuth state secret in AWS Secrets Manager, then set the GitHub Nylas variables listed below. Realtime inbox updates require a Nylas webhook destination and webhook secret after the first deploy exposes the webhook URL.
11. Apply database schema/migrations from a machine that can reach the DB, then bootstrap the first dev admin. Prefer setting `TF_BOOTSTRAP_DEV_ADMIN_EMAILS` for the first deploy, signing in once, and clearing it after the dev admin can invite users. The older manual fallback is to seed the dev company membership after the first Cognito user exists.

## GitHub Configuration

Required secrets:

- `AWS_DEV_DEPLOY_ROLE_ARN`
- `ORIGIN_VERIFY_SECRET`

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
- `TF_NYLAS_WEBHOOK_SECRET_ARN`: optional until the webhook exists; AWS Secrets Manager ARN containing the `webhook_secret` returned by the Nylas webhook destination. Required for realtime Communications updates.
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

Subscribe the webhook to these triggers: `message.created`, `message.updated`, `message.deleted`, `folder.created`, `folder.updated`, and `folder.deleted`. Nylas sends update suffixes such as `.truncated` or `.transformed` without subscribing to those suffixes separately; the backend accepts them by prefix.

If using the Nylas API instead of the dashboard, create the webhook after the first deploy:

```powershell
curl --request POST `
  --url "https://api.us.nylas.com/v3/webhooks/" `
  --header "Content-Type: application/json" `
  --header "Authorization: Bearer <nylas-api-key>" `
  --data '{ "trigger_types": ["message.created", "message.updated", "message.deleted", "folder.created", "folder.updated", "folder.deleted"], "description": "MangoRTS dev communications", "webhook_url": "https://api.dev.<domain>/nylas/webhook", "notification_email_addresses": ["ops@example.com"] }'
```

Store the returned `webhook_secret` in Secrets Manager, set `TF_NYLAS_WEBHOOK_SECRET_ARN`, and redeploy:

```powershell
aws secretsmanager create-secret `
  --region $env:AWS_REGION `
  --name mangorts/dev/nylas-webhook-secret `
  --secret-string "<webhook-secret-from-nylas>"
```

## Normal Deploy

The workflow `.github/workflows/deploy-dev.yml` currently runs manually through `workflow_dispatch` only. This is intentional while the first AWS dev deploy is being stabilized. Re-enable `push` deploys only after repeated dev deploys are boring and reliable.

It performs:

1. Assume AWS role with GitHub OIDC.
2. Run `go test ./...`.
3. Initialize Terraform with `backend.hcl` generated from GitHub variables.
4. Validate Terraform.
5. Read the ECR repository URL from Terraform state.
6. Build and push backend image tagged with the git SHA.
7. Run `terraform plan` and `terraform apply` with that immutable backend image URI.
8. Read frontend/Cognito outputs from Terraform state.
9. Build the frontend with Cognito and API env vars.
10. Sync `frontend/dist` to S3.
11. Invalidate CloudFront.
12. Print the app, API, and Nylas callback URLs into the GitHub step summary.

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
