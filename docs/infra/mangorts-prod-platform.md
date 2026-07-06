# MangoRTS Production Platform Target

MangoRTS does not currently have a production environment. The current AWS environment is dev, even though it is production-shaped. Production must be created as a separate environment, not by renaming or reusing dev resources.

This document describes the target production shape for V1. It is a readiness document, not proof that the resources already exist.

## Target Architecture

```text
Browser
  -> Route 53: <prod app domain>
  -> CloudFront + WAF
  -> S3 private frontend bucket

Browser/API client
  -> Route 53: <prod app domain>/v1/*, /v2/*, /nylas/*, /healthz
  -> CloudFront + WAF
  -> ALB HTTPS origin
  -> ECS Fargate backend tasks
  -> prod PostgreSQL/Aurora database

Backend task
  -> Cognito prod user pool
  -> SES prod verified sender/domain
  -> Nylas prod application
  -> Secrets Manager prod secrets
```

The dev Terraform root is `infra/aws-dev`. Production may start from that module shape, but it must use prod-specific state, variables, secrets, resource names, and deployment approval controls.

## Required Separation From Dev

Production must be separate from dev in these areas:

- AWS account or clearly separated AWS resource namespace, including `project_name`/`environment` tags and names.
- Terraform state bucket/key and backend config. Do not point prod at the dev state object.
- PostgreSQL/Aurora database, DB subnet/security-group access, backups, and restore process.
- Cognito user pool and app clients. Do not reuse dev Cognito user subjects as prod identity truth.
- Nylas application, API key, Hosted OAuth callback URL, frontend redirect URL, and webhook destination.
- Secrets Manager secrets for DB password, Nylas API key, Nylas state secret, Nylas webhook secret, and origin verification.
- GitHub Environment named `production`, with required reviewers and prod-only variables/secrets.
- Route 53 records, ACM certificates, CloudFront distributions, S3 frontend bucket, ALB, ECS service, ECR image usage, WAF, and monitoring alarms.
- SES sender/domain verification and DNS records.

No production secret value belongs in plaintext repo files, local notes, Terraform variables committed to git, or GitHub variables. Use AWS Secrets Manager for provider and DB secrets, and use GitHub environment secrets only for deploy-time credentials such as the production deploy role ARN.

## Runtime Services

- **Route 53** owns production DNS records for the app, API path routing, origin hostname, SES verification records, Nylas callback/webhook hostnames, and any required provider verification records.
- **CloudFront** is the public edge for frontend and API routes. API path patterns must forward `/v1/*`, `/v2/*`, `/nylas/oauth/*`, `/nylas/webhook`, and `/healthz` to the backend origin as in `infra/aws-dev/cloudfront_s3.tf`.
- **S3** stores the Vite build output from `frontend/dist` in a private bucket.
- **WAF** protects CloudFront with managed rules and must allow Nylas webhook traffic to reach `/nylas/webhook`.
- **ALB** is the regional HTTPS origin for backend traffic. Direct origin access should be limited by the CloudFront origin verification header, not a browser-visible Basic Auth gate.
- **ECS Fargate** runs the Go API from `backend/Dockerfile`. V1 prod should use at least two backend tasks so one task can be replaced without full downtime.
- **PostgreSQL/Aurora** is the production source of truth. Create prod from repo schema/migrations, then import selected business data only after the migration is rehearsed.
- **Cognito** owns authentication. Mango-owned PostgreSQL tables own authorization: `users`, `companies`, and `company_memberships`.
- **Secrets Manager** provides sensitive values to ECS. Terraform and GitHub variables should pass ARNs, not plaintext secrets.
- **SES** sends Mango invitation and signup confirmation email when `MANGORTS_EMAIL_FROM` is configured.
- **Nylas** owns mailbox OAuth grants and email APIs for Communications.

## Production Backend Configuration

The backend executable is `backend/cmd/miraeopus-api`. Production ECS task environment should use the same application env names already wired in `infra/aws-dev/ecs_alb.tf`, with prod values:

- `APP_ENV=prod`
- `AUTH_MODE=cognito`
- `AWS_REGION`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and DB password from Secrets Manager
- `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, and `COGNITO_TOKEN_USE`
- `MANGORTS_ALLOWED_ORIGIN`
- `MANGORTS_APP_URL`
- `MANGORTS_API_URL`
- `MANGORTS_DEPLOY_ENV=prod`
- `MANGORTS_DEPLOY_REVISION`
- `MANGORTS_EMAIL_FROM` after SES verification is complete
- Nylas env vars only after the prod Nylas app and secrets exist: `NYLAS_CLIENT_ID`, `NYLAS_API_BASE_URL`, `NYLAS_REDIRECT_URI`, `NYLAS_FRONTEND_REDIRECT_URL`, `NYLAS_GOOGLE_SCOPES`, `NYLAS_MICROSOFT_SCOPES`, with `NYLAS_API_KEY`, `NYLAS_STATE_SECRET`, and `NYLAS_WEBHOOK_SECRET` sourced from Secrets Manager.

Do not leave `MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS` enabled in production after the first controlled bootstrap, and prefer renaming/removing that dev-oriented bootstrap path before a customer launch.

## Production Frontend Configuration

The frontend must be built from `frontend/` with prod values:

- `VITE_API_BASE_URL` set to the production app origin if CloudFront routes API paths on the same distribution.
- `VITE_AUTH_MODE=cognito`
- `VITE_COGNITO_REGION`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_COMPANY_ID` set only after the production company ID decision is made. The current hardcoded dev fallback in `frontend/src/auth/currentCompany.ts` is the dev UUID and must not silently define prod tenancy.

## Database Baseline

The repo is the schema source of truth:

- `backend/db/schema.sql`
- `backend/db/migrations/`
- `scripts/apply_canonical_schema.ps1`
- `scripts/apply_db_migrations.ps1`

Do not create prod by cloning the dev database schema and accepting all dev drift. Use a scratch database to prove that repo schema/migrations create the structure the app expects, then migrate selected data into prod.

## Monitoring And Backups

Production readiness requires, at minimum:

- RDS automated backups and point-in-time recovery.
- A documented DB restore drill before launch.
- CloudWatch logs for ECS backend tasks.
- Alarms for backend task health, ALB target health, 5xx rates, CloudFront 5xx rates, RDS CPU/storage/connections, and failed deploy smoke tests.
- A way to identify the deployed git SHA through `/healthz` and `frontend/dist/deploy-info.json`.
- Rollback notes for ECS task definitions, frontend S3/CloudFront, and database migrations.

## V1 Sizing Guidance

Do not launch production on the smallest dev/demo sizing. A practical V1 target is:

- ECS Fargate backend desired count: 2
- Backend task size: 1 vCPU and 2 GiB memory
- Aurora Serverless v2 minimum: 1-2 ACUs
- Aurora Serverless v2 maximum: 8-16 ACUs
- No DB auto-pause for production
- Automated backups and PITR enabled

Tune these after real load tests and cost review.
