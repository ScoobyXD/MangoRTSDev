# MangoRTS AWS Dev Terraform

This is the canonical Terraform root for the MangoRTS dev environment.

Use this instead of the historical `infra/terraform` root.

## State Backend

Create the Terraform state S3 bucket manually before the first run. Enable bucket encryption and versioning, then copy `backend.hcl.example` to `backend.hcl` and fill in the bucket/key/region values. Keep `backend.hcl` out of git.

## Phase-1 Bootstrap

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars with the Route 53 domain, existing VPC/subnets, DB endpoint, DB secret ARN, and GitHub repo values
# keep backend_image_uri = "" for the first apply
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

Phase 1 creates ECR, Cognito, S3/CloudFront, ALB, Route 53, ACM, WAF, IAM/OIDC, and security resources. ECS task definition and service resources are created only after `backend_image_uri` is set to a real image.

The stack expects an existing VPC and existing dev database. ECS tasks run in the provided private subnets, so those subnets need outbound access through NAT or VPC endpoints for ECR, CloudWatch Logs, Secrets Manager, and Cognito JWKS fetches.

After first apply, copy the `github_deploy_role_arn` output into the GitHub secret `AWS_DEV_DEPLOY_ROLE_ARN`.
