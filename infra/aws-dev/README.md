# MangoRTS AWS Dev Terraform

This is the canonical Terraform root for the MangoRTS dev environment.

Use this instead of the historical `infra/terraform` root.

## Bootstrap

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars with the Route 53 domain, existing VPC/subnets, DB endpoint, DB secret ARN, and GitHub repo values
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

The stack expects an existing VPC and existing dev database. ECS tasks run in the provided private subnets, so those subnets need outbound access through NAT or VPC endpoints for ECR, CloudWatch Logs, Secrets Manager, and Cognito JWKS fetches.

After first apply, copy the `github_deploy_role_arn` output into the GitHub secret `AWS_DEV_DEPLOY_ROLE_ARN`.
