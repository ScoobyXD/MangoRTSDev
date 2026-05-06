# Historical: Legacy MangoOS AWS One-Shot Bootstrap

This folder is not the canonical MangoRTS dev infrastructure. Use `infra/aws-dev` and the docs in `docs/mangorts-*.md` for current work.

The notes below are retained only as historical reference.

# MangoOS AWS One-Shot Bootstrap (ECS + Aurora + S3 + SQS)

Need the shortest path? See `docs/deploy-staging-step-by-step.md` for a simplified checklist and
the helper scripts:

- `scripts/release_staging.sh`
- `scripts/release_staging.ps1`

This folder is a **production-lean first pass** to deploy the architecture from `docs/2-week-plan.md` in one shot:

- VPC with public/private subnets
- ECS Fargate cluster
- 2 services (`case-api`, `search-api`)
- ALB routing
- Aurora PostgreSQL cluster
- S3 artifact bucket
- SQS indexing queue + DLQ
- CloudWatch log groups and baseline alarms
- Secrets Manager entry for DB password

---

## 0) Prerequisites

Install locally:

- AWS CLI v2
- Terraform >= 1.6
- Docker (for image build/push)
- Go >= 1.23

Configure credentials/profile:

```bash
aws configure --profile mangoos
export AWS_PROFILE=mangoos
```

Optional but recommended:

```bash
export AWS_REGION=us-east-1
```

---

## 1) Build and push backend images

> Current repo has one Go API binary. You can deploy it as both services first while search-api is being split.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-east-1}

aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
```

Create ECR repos if you want pre-Terraform bootstrap (otherwise Terraform creates them):

```bash
aws ecr create-repository --repository-name mangoos-staging-case-api --region "$REGION" || true
aws ecr create-repository --repository-name mangoos-staging-search-api --region "$REGION" || true
```

Build from backend source:

```bash
cd /workspace/MangoRTSDev/backend

docker build -t mangoos-case-api:latest -f - . <<'DOCKERFILE'
FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/miraeopus-api ./cmd/miraeopus-api

FROM gcr.io/distroless/base-debian12
COPY --from=build /out/miraeopus-api /miraeopus-api
ENTRYPOINT ["/miraeopus-api"]
DOCKERFILE

docker tag mangoos-case-api:latest "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/mangoos-staging-case-api:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/mangoos-staging-case-api:latest"

# temporary: same image for search-api until dedicated implementation lands
docker tag mangoos-case-api:latest "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/mangoos-staging-search-api:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/mangoos-staging-search-api:latest"
```

---

## 2) Choose DB strategy first (important)

Given your screenshot (Aurora already created in **Northern California / us-west-1**), do this:

- **Recommended now:** keep your existing DB and wire infra to it.
- **Do not delete it yet** unless you are certain the networking/parameter setup is wrong and recreation is faster.

Use one of these modes:

### Mode A — Reuse your existing Aurora (recommended for your current situation)

Set:

- `create_aurora = false`
- `existing_db_host`
- `existing_db_port`
- `existing_db_name`
- `existing_db_user`
- `existing_db_password_secret_arn`
- `existing_db_security_group_id`

Terraform will:

- skip creating a new Aurora cluster
- still create ECS + networking + S3 + SQS
- open security group ingress from ECS tasks to your existing DB SG on 5432.

### Mode B — Create a brand new Aurora with Terraform

Keep `create_aurora = true` and set:

- `aurora_database_name`
- `aurora_master_username`
- `aurora_master_password`

---

## 3) Configure Terraform variables

```bash
cd /workspace/MangoRTSDev/infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Update `terraform.tfvars`:

- account-specific ECR URLs
- a strong `aurora_master_password`
- tags (owner/team)

---

## 4) Deploy infrastructure

```bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

Grab outputs:

```bash
terraform output
```

Save:

- `alb_dns_name`
- `aurora_endpoint`
- `artifacts_bucket`
- `search_index_queue_url`

---

## 5) Run database schema

Use your preferred migration strategy. Quick path with psql:

```bash
# you need network reachability from your machine/runner to Aurora
# if needed, run from a temporary EC2 instance in the VPC.

psql "host=<aurora_endpoint> port=5432 dbname=mangoos user=mango_admin sslmode=require" \
  -f /workspace/MangoRTSDev/backend/db/schema.sql
```

---

## 6) Wire runtime environment (if not fully in task defs yet)

Current task defs already pass baseline env vars. If app logic expands, add:

- `DB_PORT=5432`
- `DB_SSLMODE=require`
- `TENANT_MODE=enabled`
- `AUDIT_LOG_MODE=strict`

---

## 7) Smoke test

```bash
ALB_DNS=$(terraform output -raw alb_dns_name)

curl -i "http://$ALB_DNS/healthz"
curl -i -X POST "http://$ALB_DNS/v1/cases" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Launch readiness","owner":"ops"}'
```

---

## 8) Custom DB configuration checklist (what you asked for)

For custom Aurora tuning in your existing cluster, review/update:

1. **Parameter group**:
   - `rds.force_ssl=1`
   - `log_min_duration_statement` (start with 200ms)
   - `shared_preload_libraries` if needed later.
2. **Backup retention window** and preferred maintenance window.
3. **Performance Insights** enabled.
4. **Serverless v2 min/max ACU** sized for your expected burst profile.
5. **DB subnet group** includes at least two AZs for resilience.
6. **Security groups** only allow app SG inbound on 5432.
7. **Deletion protection** enabled for non-ephemeral envs.

---

## 9) What you still must do on your end (important)

1. **Domain + TLS**: Add Route53 record + ACM certificate + HTTPS listener on ALB.
2. **Auth**: Add Cognito or external IdP and enforce authN/authZ middleware in Go API.
3. **Tenant isolation**: Add `tenant_id` to schema and every query path.
4. **Audit controls**: Add immutable audit table and emit sensitive action events.
5. **Backups and DR**: Tune retention, test restore, define RTO/RPO.
6. **CI/CD**: Automate build/push/terraform/app deploy with staging gate.
7. **Security hardening**:
   - WAF in front of ALB
   - least-privilege IAM task role
   - secrets rotation policy
   - vulnerability scans in pipeline
8. **Observability upgrades**:
   - OpenTelemetry traces
   - service-level dashboards (p95 latency/error budget)
   - PagerDuty/SNS alert routing
9. **Search-api split**: Implement dedicated service binary and endpoint contract.
10. **E2E tests** for 5 critical flows from the 2-week plan.

---

## 10) Suggested execution order for your next 48 hours

1. Deploy this Terraform stack in `staging`.
2. Migrate DB + verify create/get case.
3. Add HTTPS + auth middleware.
4. Add tenant_id + audit tables.
5. Turn on CI pipeline gates (lint/test/e2e before prod).
6. Run load test and tune hot queries/indexes.

This gets you from concept to a real cloud substrate rapidly, while leaving clear hardening steps before production.

---

## What to do now (your side)

In `terraform.tfvars`, set `create_aurora = false` and fill:

- `existing_db_host`
- `existing_db_port`
- `existing_db_name`
- `existing_db_user`
- `existing_db_password_secret_arn`
- `existing_db_security_group_id`

Keep your existing Aurora, custom-configure it, and run Terraform for the rest (ECS, VPC, ALB, S3, SQS, etc.).

Apply your schema after connectivity is in place.
