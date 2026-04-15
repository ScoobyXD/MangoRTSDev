# MangoOS AWS One-Shot Bootstrap (ECS + Aurora + S3 + SQS)

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
cd /workspace/MangoOSDev/backend

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

## 2) Configure Terraform variables

```bash
cd /workspace/MangoOSDev/infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Update `terraform.tfvars`:

- account-specific ECR URLs
- a strong `aurora_master_password`
- tags (owner/team)

---

## 3) Deploy infrastructure

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

## 4) Run database schema

Use your preferred migration strategy. Quick path with psql:

```bash
# you need network reachability from your machine/runner to Aurora
# if needed, run from a temporary EC2 instance in the VPC.

psql "host=<aurora_endpoint> port=5432 dbname=mangoos user=mango_admin sslmode=require" \
  -f /workspace/MangoOSDev/backend/db/schema.sql
```

---

## 5) Wire runtime environment (if not fully in task defs yet)

Current task defs already pass baseline env vars. If app logic expands, add:

- `DB_PORT=5432`
- `DB_SSLMODE=require`
- `TENANT_MODE=enabled`
- `AUDIT_LOG_MODE=strict`

---

## 6) Smoke test

```bash
ALB_DNS=$(terraform output -raw alb_dns_name)

curl -i "http://$ALB_DNS/healthz"
curl -i -X POST "http://$ALB_DNS/v1/cases" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Launch readiness","owner":"ops"}'
```

---

## 7) What you still must do on your end (important)

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

## 8) Suggested execution order for your next 48 hours

1. Deploy this Terraform stack in `staging`.
2. Migrate DB + verify create/get case.
3. Add HTTPS + auth middleware.
4. Add tenant_id + audit tables.
5. Turn on CI pipeline gates (lint/test/e2e before prod).
6. Run load test and tune hot queries/indexes.

This gets you from concept to a real cloud substrate rapidly, while leaving clear hardening steps before production.
