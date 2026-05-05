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
9. Set GitHub variables/secrets used by `.github/workflows/deploy-dev.yml`, including state backend values, Terraform inputs, `AWS_REGION`, and `DEV_BASIC_AUTH_PASSWORD`.
10. Apply database schema/migrations from a machine that can reach the DB, then seed the dev company membership after the first Cognito user exists.

## GitHub Configuration

Required secrets:

- `AWS_DEV_DEPLOY_ROLE_ARN`
- `DEV_BASIC_AUTH_PASSWORD`

Required variables:

- `AWS_REGION`
- `TF_STATE_BUCKET`
- `TF_ROOT_DOMAIN_NAME`
- `TF_VPC_ID`
- `TF_PUBLIC_SUBNET_IDS` as a JSON string array
- `TF_PRIVATE_SUBNET_IDS` as a JSON string array
- `TF_EXISTING_DB_HOST`
- `TF_EXISTING_DB_NAME`
- `TF_EXISTING_DB_USER`
- `TF_EXISTING_DB_PASSWORD_SECRET_ARN`
- `TF_EXISTING_DB_SECURITY_GROUP_ID`
- `TF_DEV_COMPANY_ID`
- `TF_COGNITO_DOMAIN_PREFIX`

Optional variables have workflow defaults: `TF_STATE_KEY`, `TF_STATE_REGION`, `TF_APP_SUBDOMAIN`, `TF_API_SUBDOMAIN`, `TF_ORIGIN_SUBDOMAIN`, `TF_EXISTING_DB_PORT`, `TF_DEV_BASIC_AUTH_USERNAME`, `TF_GITHUB_OWNER`, `TF_GITHUB_REPOSITORY`, and `TF_GITHUB_BRANCH`.

## Normal Deploy

The workflow `.github/workflows/deploy-dev.yml` runs on `main` and manually through `workflow_dispatch`.

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

## Smoke Tests

After deploy:

```powershell
curl -i https://dev.<domain>/healthz
curl -i https://api.dev.<domain>/healthz
```

Both URLs are protected by temporary CloudFront basic auth. API calls to `/v1/*` also require Cognito Bearer tokens.

## Rollback

For backend rollback, update the ECS service to the previous task definition revision.

For frontend rollback, restore a previous S3 object version or redeploy the previous commit and invalidate CloudFront.
