# AWS Cost Audit - 2026-05-17

## Summary

The May 17 AWS bill is high because the dev environment is built like a small production stack and runs several managed services continuously. The current cost split does not look like two testers generating traffic costs. It looks like mostly fixed monthly infrastructure: Aurora/RDS, NAT/public IPv4, ALB, ECS Fargate, WAF, CloudWatch/monitoring, and an annual Route 53 registrar charge.

Live AWS verification was not available from this shell because no AWS credentials or profiles were configured. The findings below are based on the May 17 billing screenshot, the Terraform stack, and existing infra notes.

## May 17 Snapshot

| AWS billing category | Month-to-date | Likely cause | Traffic sensitive? |
| --- | ---: | --- | --- |
| Relational Database Service | USD 25.29 | Existing Aurora PostgreSQL dev cluster, plus DB storage/I/O/backup and enabled DB observability features. | Mostly fixed at this scale. |
| Registrar | USD 15.00 | Route 53 domain registration or renewal. | No. Annual or one-time, not app traffic. |
| EC2 - Other | USD 13.73 | Most likely NAT gateway hourly charge, NAT data processing, public IPv4 hourly charges, and VPC data transfer. | Mostly fixed, with some data sensitivity. |
| Elastic Container Service | USD 8.02 | One always-on ECS Fargate backend task. Terraform defaults to 512 CPU units and 1024 MiB memory. | Mostly fixed while desired count is 1. |
| Elastic Load Balancing | USD 7.22 | One always-on Application Load Balancer plus LCU usage. | Mostly fixed at low traffic. |
| Others | USD 12.26 | Likely WAF fixed charges, CloudWatch logs/Container Insights, Secrets Manager, S3, CloudFront, Route 53 hosted zone/query charges, and ECR storage. | Mixed, but mostly fixed at low traffic. |

## Evidence From The Repo

- `infra/aws-dev/ecs_alb.tf` creates an always-on Application Load Balancer and an ECS Fargate service when `backend_image_uri` is set by CI.
- `infra/aws-dev/ecs_alb.tf` enables ECS Container Insights with `containerInsights = "enabled"`.
- `infra/aws-dev/variables.tf` defaults the backend task to `backend_cpu = 512`, `backend_memory = 1024`, and `backend_desired_count = 1`.
- `infra/aws-dev/networking.tf` creates NAT gateway resources when `create_private_ecs_subnets = true`.
- Local `infra/aws-dev/terraform.tfvars` has `create_private_ecs_subnets = true`, `ecs_nat_gateway_mode = "single"`, and no existing private subnet IDs.
- `infra/aws-dev/waf.tf` creates one CloudFront-scope WAF web ACL with four rules/rule groups.
- `docs/MangoRTS` records that the database is Aurora PostgreSQL, Database Insights Advanced is enabled, Enhanced Monitoring is enabled at 60 seconds, and PostgreSQL log exports are enabled.
- The frontend opens authenticated SSE streams for communications and workspace freshness. The backend sends each open stream a heartbeat every 5 seconds. That is not the main cost driver, but it is unnecessary traffic for a tiny dev site.

## Interpretation

This does not look like AWS "scamming" the account. The billing categories are confusing, especially `EC2 - Other`, but the shape matches AWS charging for infrastructure that exists even when nobody is using the app.

The application does not appear to be grossly spinning in a way that explains the current bill. The bigger issue is that the dev architecture is cost-insensitive: it includes production-shaped edge, network, compute, database, and observability pieces for a two-person test environment.

Ten light users should not turn this exact setup into USD 1,000/month because much of the current bill is fixed. The risk is different: the base cost is already too high before real usage, and heavier usage can add RDS I/O/storage, CloudWatch logs, WAF requests, ALB LCUs, CloudFront transfer, and third-party API traffic on top.

## High-Impact Cost Reductions

1. Remove or avoid the NAT gateway for dev.
   - Cheapest dev path: run ECS tasks in public subnets with public IP egress, locked down by security groups so only the ALB can reach the task.
   - More production-like path: keep private ECS subnets but replace NAT egress with VPC endpoints for ECR, CloudWatch Logs, Secrets Manager, and S3.

2. Add a dev off switch.
   - Allow `backend_desired_count = 0` outside testing hours.
   - Consider a scheduled GitHub Action or Lambda/EventBridge rule to stop the ECS service at night.
   - This only saves Fargate usage unless the ALB/NAT/RDS are also removed or stopped.

3. Reduce database cost.
   - Verify the live Aurora instance class, storage, I/O, and backup charges.
   - Disable Database Insights Advanced and 60-second Enhanced Monitoring for dev unless actively debugging.
   - Stop the dev DB when not needed, or move dev to a smaller Single-AZ RDS PostgreSQL instance if Aurora is not required.

4. Make WAF optional in dev.
   - The current WAF config is reasonable for production shape, but for a locked-down dev environment it is likely a fixed monthly tax.
   - Add an `enable_waf` variable and skip WAF in dev if the public dev endpoint can tolerate that tradeoff.

5. Disable Container Insights in dev.
   - Standard ECS service metrics and short-retention application logs are enough for normal dev.

6. Lower application chatter.
   - Increase SSE heartbeat interval from 5 seconds to 30-60 seconds.
   - Keep request logging concise and avoid logging high-volume webhook success paths.

7. Move rich editor images out of Postgres before real usage.
   - The editor allows large HTML documents with embedded images. If users paste images into documents, RDS storage, backup, and I/O can grow quickly.
   - Store images in S3 and keep references in Postgres.

## Live AWS Verification Commands

Run these after authenticating with the AWS account. Do not paste secrets into the shell or commit credentials.

```powershell
aws sso login --profile mangorts-dev
$env:AWS_PROFILE = "mangorts-dev"
$env:AWS_REGION = "us-west-1"
aws sts get-caller-identity
```

Cost Explorer by usage type:

```powershell
aws ce get-cost-and-usage `
  --time-period Start=2026-05-01,End=2026-05-18 `
  --granularity MONTHLY `
  --metrics UnblendedCost `
  --group-by Type=DIMENSION,Key=SERVICE Type=DIMENSION,Key=USAGE_TYPE `
  --output json
```

Focused checks:

```powershell
aws ce get-cost-and-usage --time-period Start=2026-05-01,End=2026-05-18 --granularity DAILY --metrics UnblendedCost --filter '{"Dimensions":{"Key":"SERVICE","Values":["EC2 - Other"]}}' --group-by Type=DIMENSION,Key=USAGE_TYPE
aws ec2 describe-nat-gateways --region us-west-1 --filter Name=state,Values=available
aws ec2 describe-addresses --region us-west-1
aws rds describe-db-clusters --region us-west-1
aws rds describe-db-instances --region us-west-1
aws logs describe-log-groups --region us-west-1 --log-group-name-prefix /aws/rds
aws logs describe-log-groups --region us-west-1 --log-group-name-prefix /ecs/mangorts-dev
aws ecs describe-clusters --region us-west-1 --clusters mangorts-dev-cluster --include SETTINGS
aws ecs describe-services --region us-west-1 --cluster mangorts-dev-cluster --services mangorts-dev-backend
```

Expected smoking guns:

- `NatGateway-Hours`, `NatGateway-Bytes`, `PublicIPv4:InUseAddress`, or `PublicIPv4:IdleAddress` under `EC2 - Other`.
- Aurora instance hours, Aurora storage, Aurora I/O, backup storage, Database Insights, or Enhanced Monitoring-related CloudWatch usage.
- `LoadBalancerUsage` and LCU usage under Elastic Load Balancing.
- WAF Web ACL and rule charges under `Others` or WAF-specific service rows.

## Security Note

While auditing cost notes, `docs/MangoRTS` was found to contain plaintext AWS/IAM credential material. Rotate those credentials immediately if they have ever been valid, remove them from the repository, and treat the repository history as exposed until it is cleaned.
