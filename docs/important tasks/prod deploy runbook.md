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
