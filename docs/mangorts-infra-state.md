# MangoRTS Infra State

## Current Live Terraform Root

Use `infra/aws-dev`.

The old `infra/terraform` root is historical reference. Do not apply it for MangoRTS dev.

## Terraform Owns

- ECR backend repository.
- ECS cluster, task definition, service, task roles, and logs.
- ALB, target group, listener, and service security groups.
- S3 frontend bucket.
- CloudFront distribution and Origin Access Control.
- CloudFront temporary basic-auth function.
- WAF Web ACL.
- Cognito User Pool, domain, app clients, and reserved machine client.
- Route 53 records under the root hosted zone.
- ACM certificates for CloudFront and ALB.
- GitHub OIDC deploy role.

The dev GitHub deploy role is intentionally broad enough to run Terraform for this stack. It is scoped by GitHub owner, repository, and branch in the OIDC trust policy. Tighten it before reusing this pattern for production.

## Terraform Reuses

- Existing Route 53 hosted zone for the root domain.
- Existing VPC and subnet IDs.
- Existing dev PostgreSQL/Aurora endpoint.
- Existing DB security group.
- Existing Secrets Manager secret containing the DB password.

## Manual Changes To Avoid

Do not manually edit resources Terraform owns unless recovering from an incident. Manual changes create drift and make future Codex work unreliable.

Allowed manual actions:

- register the domain in Route 53,
- create/invite Cognito dev users,
- seed company membership rows,
- rotate the DB secret using the agreed runbook,
- inspect logs and metrics.

## Naming

Canonical name: MangoRTS.

Canonical slug: `mangorts`.

Anything using MangoOS or `mangoos` is legacy unless explicitly documented as a historical note.
