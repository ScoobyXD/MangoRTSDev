# MangoRTS Dev Deploy Runbook

## One-Time Setup

1. Register the domain in Route 53.
2. Create a public hosted zone for the domain if Route 53 did not create one automatically.
3. Put the existing dev database password into Secrets Manager.
4. Fill `infra/aws-dev/terraform.tfvars` from `terraform.tfvars.example`.
5. Build and push one bootstrap backend image, or point `backend_image_uri` at a temporary valid image.
6. Run:

```powershell
cd infra/aws-dev
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

7. Save the `github_deploy_role_arn` output as GitHub secret `AWS_DEV_DEPLOY_ROLE_ARN`.
8. Set GitHub variable `AWS_REGION` to the dev region.

## Normal Deploy

The workflow `.github/workflows/deploy-dev.yml` runs on `main` and manually through `workflow_dispatch`.

It performs:

1. Assume AWS role with GitHub OIDC.
2. Run `go test ./...`.
3. Validate Terraform.
4. Read the ECR repository URL from Terraform state.
5. Build and push backend image tagged with the git SHA.
6. Run `terraform plan` and `terraform apply` with that immutable backend image URI.
7. Read frontend/Cognito outputs from Terraform state.
8. Build the frontend with Cognito and API env vars.
9. Sync `frontend/dist` to S3.
10. Invalidate CloudFront.

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
