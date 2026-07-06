# MangoRTS Prod Deploy Runbook

This runbook is for the first real MangoRTS production environment.

## Rules

- Use AWS profile `mangorts-prod` only.
- Do not use `mangorts-dev` for prod.
- Do not paste passwords or API keys into chat.
- Do not commit `backend.hcl`, `terraform.tfvars`, `*.auto.tfvars`, or plans.
- Do not run `terraform apply` until Jonat explicitly approves it.
- For browser console access, use IAM Identity Center / AWS access portal, not the regular IAM user sign-in page.
- Do not create a classic IAM user or long-lived access keys for this prod setup.

## Confirmed prod AWS access

- Prod AWS account ID: `828435022930`.
- Local AWS profile: `mangorts-prod`.
- Region: `us-west-1`.
- Permission set / role: `AdministratorAccess`.
- Verified command: `aws sts get-caller-identity --profile mangorts-prod`.
- Terraform state bucket: `mangorts-prod-terraform-state-828435022930`.

## Confirmed prod network discovery

- Default VPC: `vpc-058fed523b6e847bf`, CIDR `172.31.0.0/16`.
- Public subnet 1: `subnet-09be435bd9a9f6208`, AZ `us-west-1c`, CIDR `172.31.0.0/20`.
- Public subnet 2: `subnet-0f07a73d47130fc8a`, AZ `us-west-1a`, CIDR `172.31.16.0/20`.
- Recommended Terraform-managed private ECS subnet CIDRs for this VPC: `172.31.128.0/20`, `172.31.144.0/20`.
- Prod `mangorts.com` Route 53 hosted zone: `Z05521211GBNMIH6SBM5Z`.
- No prod RDS DB or `mangorts/prod` Secrets Manager secrets were found yet.

## Route 53 setup notes

- Public DNS for `mangorts.com` now points at the prod Route 53 nameservers.
- The prod AWS account has hosted zone `Z05521211GBNMIH6SBM5Z` for `mangorts.com`.
- New prod Route 53 nameservers: `ns-419.awsdns-52.com`, `ns-1490.awsdns-58.org`, `ns-890.awsdns-47.net`, `ns-1736.awsdns-25.co.uk`.
- An existing public hosted zone is visible via `mangorts-dev`: `Z07929803JGGMRO04UP2L`.
- Existing non-NS/SOA records in that zone were copied into the prod hosted zone: `dev.mangorts.com`, `api.dev.mangorts.com`, `origin.dev.mangorts.com`, plus ACM validation CNAMEs.

Safe Route 53 cutover status:

1. The domain registration for `mangorts.com` is in AWS Route 53 Domains under the `mangorts-dev`/old account context.
2. Registered domain nameservers were updated through AWS Route 53 Domains after explicit approval.
3. Public NS lookup returns the new prod nameservers.
4. Verify the prod profile can find the hosted zone.

Do not paste registrar passwords, MFA codes, recovery codes, or payment details into chat/docs.

## First repo-only validation

Run from the repo root:

```bash
cd infra/aws-prod
terraform fmt
terraform init -backend=false
terraform validate

cd ../../backend
go test ./...

cd ..
node scripts/run_all_tests.mjs
```

## Manual values Jonat must prepare

- Prod AWS account ID: `828435022930`.
- Working local AWS SSO profile: `mangorts-prod`.
- Prod Terraform state bucket name: `mangorts-prod-terraform-state-828435022930`.
- Prod VPC ID: `vpc-058fed523b6e847bf`.
- At least two public subnet IDs: `subnet-09be435bd9a9f6208`, `subnet-0f07a73d47130fc8a`.
- At least two private subnet IDs, or approval for Terraform-created private ECS subnets. Recommended for current default VPC: create Terraform-managed private ECS subnets with CIDRs `172.31.128.0/20`, `172.31.144.0/20`.
- NAT choice: `single` or `per_az`.
- Prod DB endpoint, port, name, username, password secret ARN, and DB security group ID.
- Prod company name.
- Prod company UUID.
- First prod admin email.

## Secret-handling rules

Okay to record in docs/chat:

- AWS account IDs.
- VPC IDs, subnet IDs, security group IDs.
- Route 53 hosted zone IDs and nameservers.
- DB endpoint host, DB port, DB name, and DB app username.
- AWS Secrets Manager secret ARNs, but not secret values.
- GitHub owner/repo names.
- Terraform state bucket names.

Never put in chat, docs, screenshots, or committed files:

- AWS root password, MFA codes, recovery codes, access keys, or session tokens.
- DB password.
- Full DB connection strings that include passwords.
- Nylas API key, OAuth client secret, webhook secret, or state-signing secret.
- Raw origin verification secret.
- GitHub tokens or deploy credentials.
- Any provider API key or OAuth secret.

Store secrets only in approved secret stores:

- AWS Secrets Manager.
- GitHub Actions secrets / GitHub Environment secrets.
- Jonat's password manager.
- Short-lived shell environment variables during an approved command.

## Prod DB setup instructions

Recommended first prod DB shape:

```text
Engine: Aurora PostgreSQL
Engine version: 17.7
Region: us-west-1
Cluster scalability type: Aurora serverless / Aurora Serverless v2
Capacity: min 0.5 ACU, max 2 ACU
Writer/readers: one writer, no reader for first prod; add reader later if uptime/load requires it
DB cluster identifier: mangorts-prod-db
Initial database name: mangorts
App/master username for V1 bootstrap: mangorts_app
Public access: No
VPC: vpc-058fed523b6e847bf
Security group name: mangorts-prod-db
Credential management: AWS-managed RDS secret first, then create app-compatible secret or adjust Terraform
```

Manual AWS Console steps:

1. Open RDS in region `us-west-1` using the `MangoRTS Production` account.
2. Create an Aurora PostgreSQL database.
3. Use engine version `17.7` for first launch to match dev.
4. Choose `Aurora serverless` / Aurora Serverless v2, not provisioned and not Limitless Database.
5. Use one writer and no reader for first prod.
6. Set capacity to min `0.5` ACU and max `2` ACU; raise max ACU later as traffic grows.
7. Set DB cluster identifier to `mangorts-prod-db`.
8. Set initial database name to `mangorts`.
9. Set username to `mangorts_app` for V1 bootstrap.
10. Use AWS-managed Secrets Manager credentials for the RDS master password to avoid password exposure.
11. Use VPC `vpc-058fed523b6e847bf`.
12. Set public access to `No`.
13. Create/select security group `mangorts-prod-db`; do not use only the default security group.
14. Keep inbound rules closed for now; Terraform will later add ECS ingress.
15. Enable encryption, backups, and deletion protection if treating this as real prod.
16. Use Aurora Standard storage, not I/O-Optimized, for first prod.
17. Use Database Insights Standard, not Advanced.
18. Leave Enhanced Monitoring off for first prod unless AWS requires it.
19. Enable PostgreSQL CloudWatch logs if available.
20. After DB creation, either create app-compatible secret `mangorts/prod/db-password` without printing the password, or update Terraform to consume the RDS-managed JSON secret safely.

Return only these values to the agent:

- DB writer endpoint hostname.
- DB port, expected `5432`.
- DB name, expected `mangorts`.
- DB username, expected `mangorts_app`.
- RDS managed DB credential secret ARN, and later the app-compatible DB password secret ARN if created.
- Security group ID for `mangorts-prod-db`.

Never return the DB password or a full password-bearing connection string.

## Confirmed prod DB values

Created through the AWS Console and verified with read-only AWS CLI calls:

```text
DB cluster identifier: mangorts-prod-db
DB instance identifier: mangorts-prod-db-instance-1
Writer endpoint: mangorts-prod-db.cluster-cpcceyaigiit.us-west-1.rds.amazonaws.com
Reader endpoint: mangorts-prod-db.cluster-ro-cpcceyaigiit.us-west-1.rds.amazonaws.com
Database name: mangorts
Engine: aurora-postgresql
Engine version: 17.7
Port: 5432
Master username: mangorts_app
DB security group ID: sg-0ba84e2c327457f1e
Publicly accessible: false
RDS managed secret ARN: arn:aws:secretsmanager:us-west-1:828435022930:secret:rds!cluster-d26dab99-99bc-40c2-9465-4a67189b1177-2xZr7k
```

Do not record the DB password.

## Immediate Terraform task

Update Terraform to reference the password field from the RDS-managed secret safely.

Status: complete in repo; no prod apply has been run for this change.

Reason:

- The RDS-managed DB credential secret is JSON-shaped.
- The ECS container needs `DB_PASSWORD` to be only the password value.
- Prod Terraform now supports `existing_db_password_secret_json_key`.
- `.github/workflows/deploy-prod.yml` now supports GitHub variable `TF_EXISTING_DB_PASSWORD_SECRET_JSON_KEY`, defaulting to `password`.
- For the current RDS-managed secret, set:

```hcl
existing_db_password_secret_json_key = "password"
```

- ECS will use the `:password::` JSON-key suffix in `DB_PASSWORD` secret `valueFrom`.
- Plain password-only Secrets Manager secrets can leave `existing_db_password_secret_json_key` empty.

Validation run:

```text
terraform -chdir=infra/aws-prod fmt
terraform -chdir=infra/aws-prod validate
```

Result: valid. The prod workflow was also checked for the new JSON-key input wiring.

## Local Terraform files

Create this file locally. Do not commit it:

```text
infra/aws-prod/backend.hcl
```

Start from:

```text
infra/aws-prod/backend.hcl.example
```

Current prod backend values:

```hcl
bucket       = "mangorts-prod-terraform-state-828435022930"
key          = "mangorts/prod/terraform.tfstate"
region       = "us-west-1"
profile      = "mangorts-prod"
encrypt      = true
use_lockfile = true
```

Initialization status:

- `terraform -chdir=infra/aws-prod init -reconfigure -backend-config=backend.hcl -input=false` passed.
- `terraform -chdir=infra/aws-prod validate` passed after S3 backend initialization.
- No prod `terraform plan` or `terraform apply` has been run.

Create this file locally. Do not commit it:

```text
infra/aws-prod/terraform.tfvars
```

Start from:

```text
infra/aws-prod/terraform.tfvars.example
```

## First apply shape

The first apply may be local.

It should create the prod skeleton first.

After that, save the deploy role ARN in GitHub as:

```text
AWS_PROD_DEPLOY_ROLE_ARN
```

Then normal deploys can use `.github/workflows/deploy-prod.yml`.

## Smoke tests

After deploy:

- `https://mangorts.com/deploy-info.json` returns 200.
- `https://mangorts.com/healthz` returns 200.
- `https://mangorts.com/v1/me` without auth returns 401.
- First prod admin can log in.
- Authenticated `/v1/me` returns prod membership.
- Dev still works.

## Current local Terraform plan

Local-only files:

- `infra/aws-prod/terraform.tfvars` exists locally and is gitignored.
- `infra/aws-prod/tfplan` exists locally and is gitignored.
- `terraform.tfvars` contains generated `origin_verify_secret`; do not print, commit, or screenshot it.
- Default prod company UUID generated for first plan: `face60cd-27e2-4e5a-92b0-b2cdb78545c8`.

Command:

```bash
export AWS_PROFILE=mangorts-prod
export AWS_SDK_LOAD_CONFIG=1
terraform -chdir=infra/aws-prod plan -out=tfplan -input=false
```

Result:

```text
Plan: 55 to add, 0 to change, 0 to destroy.
```

Important details:

- No apply has been run.
- ECS cluster is planned, but ECS service/task are not planned yet because `backend_image_uri = ""`.
- First apply would create the prod skeleton: frontend bucket/CloudFront, ALB, Cognito, ECR, IAM/GitHub deploy role, private ECS networking, Route 53 records, ACM certs, and WAF.
- GitHub deploy role is currently scoped to branch `prod-scaffolding-v1`.

## First prod Terraform apply result

Status: complete.

Command:

```bash
export AWS_PROFILE=mangorts-prod
export AWS_SDK_LOAD_CONFIG=1
terraform -chdir=infra/aws-prod apply -input=false tfplan
```

Result:

```text
Apply complete! Resources: 55 added, 0 changed, 0 destroyed.
```

Important outputs:

```text
app_url = https://mangorts.com
api_url = https://api.mangorts.com
backend_ecr_repository_url = 828435022930.dkr.ecr.us-west-1.amazonaws.com/mangorts-prod-backend
cloudfront_distribution_id = E163LYR5A8EQMJ
cognito_user_pool_id = us-west-1_tddWJsjUA
cognito_spa_client_id = 5dds4k34vnt2n1ub8deg6m617h
default_company_id = face60cd-27e2-4e5a-92b0-b2cdb78545c8
ecs_cluster_name = mangorts-prod-cluster
ecs_service_name = ""
frontend_bucket = mangorts-prod-frontend-828435022930
github_deploy_role_arn = arn:aws:iam::828435022930:role/mangorts-prod-github-deploy
managed_nat_gateway_ids = nat-078f52f1357ee5442
```

Verification:

- CloudFront `E163LYR5A8EQMJ` is deployed and enabled.
- ECR repo `mangorts-prod-backend` exists.
- ECS cluster `mangorts-prod-cluster` is active.
- ECS service is intentionally absent until a backend image exists.
- Route 53 aliases exist for `mangorts.com`, `api.mangorts.com`, and `origin.mangorts.com`.

Next steps:

1. Build and push the first backend image to ECR.
2. Run a second Terraform plan/apply with `backend_image_uri` set.
3. Configure GitHub production secret `AWS_PROD_DEPLOY_ROLE_ARN` with the deploy role ARN.
4. Configure GitHub production secret `PROD_ORIGIN_VERIFY_SECRET` from local `terraform.tfvars` without printing it.

## Current prod deployed state

Status: backend, frontend, and empty prod DB schema are deployed.

Backend image currently deployed:

```text
828435022930.dkr.ecr.us-west-1.amazonaws.com/mangorts-prod-backend@sha256:6dc68dc0a05072345a43b132982bff413485626883955a015cd3e3a34aaa4941
```

Deploy revision:

```text
manual-71a55e34-20260706T053946Z
```

Current ECS state:

```text
ECS service: mangorts-prod-backend
Desired tasks: 2
Running tasks: 2
Target health: 2 healthy targets
```

Prod frontend state:

- Built with `VITE_API_BASE_URL=https://mangorts.com` so browser API calls stay on the app origin.
- Built with `VITE_COMPANY_ID=face60cd-27e2-4e5a-92b0-b2cdb78545c8`.
- Published to `s3://mangorts-prod-frontend-828435022930`.
- CloudFront distribution `E163LYR5A8EQMJ` was invalidated after publish.
- `frontend/src/auth/currentCompany.ts` now keeps the dev UUID fallback out of production bundles.

Prod DB schema bootstrap:

- The prod DB is private, so schema bootstrap was run by a one-off ECS/Fargate task in the prod ECS private subnets.
- The task used ECS Secrets Manager injection for the RDS-managed secret JSON key `password`; no DB password was printed or recorded.
- The successful bootstrap applied `backend/db/schema.sql`, applied supplemental migration `20260629_communications_archive_jobs.sql`, and marked all 140 historical migration files as applied for the empty prod bootstrap.

Successful bootstrap marker:

```text
MANGORTS_PROD_DB_BOOTSTRAP_OK schema_applied=true supplemental_migrations_applied=1 migrations_marked=140
```

Current smoke result:

```text
https://mangorts.com/deploy-info.json -> 200
https://mangorts.com/accept-invite -> 200
https://mangorts.com/healthz -> 200
https://api.mangorts.com/healthz -> 200
POST https://mangorts.com/v1/invitations/validate with bad token -> 404 invitation_bad_token
https://mangorts.com/v1/me without auth -> 401 unauthorized
https://api.mangorts.com/v1/me without auth -> 401 unauthorized
https://mangorts.com/v2/nodes/... without auth -> 401 unauthorized
https://mangorts.com/v2/logic-gates/... without auth -> 401 unauthorized
https://mangorts.com/nylas/webhook?challenge=deploy-smoke-nylas-webhook -> 200 deploy-smoke-nylas-webhook
```

Next steps now:

1. Decide and configure the first prod admin email/bootstrap path.
2. Verify first prod admin login and authenticated `/v1/me` membership.
3. Configure GitHub production secrets/vars for repeatable deploys.
4. Later, replace this manual `ko`/local deploy path with the normal GitHub Actions production workflow.
