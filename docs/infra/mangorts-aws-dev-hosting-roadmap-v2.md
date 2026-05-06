# MangoRTS AWS Dev Hosting Roadmap V2

## Purpose
This is the continuation roadmap for preparing MangoRTS for AWS dev hosting. It covers codebase fixes, docs cleanup, infrastructure hardening, deployment setup, database/auth readiness, and the concrete steps to get the app hosted.

Canonical rules:
- Product name: MangoRTS.
- AWS dev Terraform root: `infra/aws-dev`.
- Legacy `infra/terraform` and unqualified MangoOS docs are historical unless explicitly reconciled.
- Keep the simplest production-shaped dev environment: S3 + CloudFront frontend, ECS Fargate backend, Cognito auth, existing AWS PostgreSQL/Aurora, GitHub Actions OIDC.

## Current State
Already present:
- `infra/aws-dev` Terraform stack for ECR, ECS, ALB, S3, CloudFront, Route 53, ACM, WAF, Cognito, IAM.
- `.github/workflows/deploy-dev.yml`.
- Backend Cognito JWT validation and company membership checks.
- Frontend Cognito PKCE login bootstrap.
- Auth tables: `users`, `companies`, `company_memberships`.
- V2 docs under `docs/mangorts-*.md`.

Verified clean before this roadmap:
- `go test ./...`
- `npm run build`
- `node scripts\run_all_tests.mjs`
- `terraform fmt -check`
- `terraform validate`

Known gaps:
- V2 docs are not visually obvious enough.
- Terraform state/backend setup is not fully documented for CI.
- First AWS bootstrap needs a two-phase path because ECR and deploy role are Terraform-owned.
- Frontend `EventSource` cannot send Cognito Bearer headers.
- CloudFront/ALB origin needs stronger origin verification.
- Old docs/scripts still point agents toward legacy infra.

## Roadmap

### Phase 1: Make V2 Docs Obvious
Update titles:
- `docs/README.md`: `# MangoRTS Docs V2`
- `docs/mangorts-dev-platform.md`: `# MangoRTS Dev Platform V2`
- `docs/mangorts-auth.md`: `# MangoRTS Auth V2`
- `docs/mangorts-deploy-runbook.md`: `# MangoRTS Dev Deploy Runbook V2`
- `docs/mangorts-infra-state.md`: `# MangoRTS Infra State V2`
- `docs/mangorts-database.md`: `# MangoRTS Database V2`

Update `docs/README.md` to say V2 means the `infra/aws-dev` platform with Cognito, ECS, S3, CloudFront, Route 53, WAF, existing AWS DB, and GitHub OIDC.

### Phase 2: Clean Legacy Guidance
- Update backend README references from `infra/terraform` to `infra/aws-dev`.
- Mark `scripts/release_staging.ps1` and `scripts/release_staging.sh` as legacy or disable with an explanatory guard.
- Mark current docs that still say MangoOS as historical unless they are active product docs.
- Keep old Go module/binary name `miraeopus` for now as internal legacy naming.

### Phase 3: Harden Terraform For Real AWS Dev
- Add partial S3 backend config in `infra/aws-dev/versions.tf`.
- Add `infra/aws-dev/backend.hcl.example`.
- Document manual prerequisite: create the Terraform state S3 bucket before running Terraform.
- Make `backend_image_uri` optional for phase-1 bootstrap.
- Gate ECS task definition/service creation on `backend_image_uri != ""`.
- Keep ECR, Cognito, CloudFront/S3, ALB, Route 53, ACM, WAF, IAM/OIDC creatable before any backend image exists.

### Phase 4: Harden Edge/API Behavior
- Allow `OPTIONS /v1/*` through CloudFront without basic auth so browser preflight works.
- Keep actual `/v1/*` protected by Cognito in the backend.
- Add CloudFront-to-ALB custom origin header.
- Add ALB listener rule requiring that header before forwarding to ECS.
- Keep temporary CloudFront basic auth for dev static pages and health checks.

### Phase 5: Fix Authenticated Streaming
- Replace raw `EventSource` calls with an authenticated fetch-based SSE helper.
- Use the same Cognito token source as normal `fetch`.
- Apply this to:
  - `frontend/src/modules/node-map/NodeRelationshipGraph.ts`
  - `frontend/src/modules/logic-gate-map/LogicGateRelationshipGraph.ts`
- Add frontend tests for SSE parsing/reconnect behavior where practical.

### Phase 6: Tenant/Auth Safety
- Keep explicit `company_id` in the API for now.
- Keep backend membership enforcement before handlers run.
- Add tests for:
  - missing token returns `401`,
  - non-member company returns `403`,
  - body `company_id` wins over query `company_id`,
  - malformed JSON body fails safely,
  - `OPTIONS` bypasses auth cleanly.
- Add a dev seed script for `companies`, `users`, and `company_memberships`.

### Phase 7: Database Readiness
- Keep existing AWS PostgreSQL/Aurora.
- Apply `backend/db/schema.sql` for fresh DBs.
- Apply ordered migrations in `backend/db/migrations/` for existing DBs.
- Ensure auth migration `20260505_auth_identity_and_memberships.sql` is applied.
- Seed the dev company row and the first user membership after Cognito user creation.

### Phase 8: CI Deploy Readiness
- Update GitHub Actions to initialize Terraform with backend config.
- Provide all Terraform inputs through GitHub vars/secrets or CI-generated `.auto.tfvars`.
- Normal deploy flow:
  - assume AWS role using OIDC,
  - run backend tests,
  - Terraform validate,
  - read ECR output,
  - build and push backend image tagged with git SHA,
  - Terraform apply with `backend_image_uri`,
  - build frontend with Cognito/API env vars,
  - sync `frontend/dist` to S3,
  - invalidate CloudFront.

## Actual AWS Hosting Steps

1. Prepare AWS account and region.
   - Use the same region as the existing dev DB.
   - Current Terraform default is `us-west-1`.

2. Prepare domain.
   - Register or delegate the root domain in Route 53.
   - Confirm a public hosted zone exists.

3. Prepare network/database inputs.
   - Existing VPC ID.
   - Public subnet IDs for ALB.
   - Private subnet IDs for ECS.
   - Existing PostgreSQL/Aurora host, port, DB name, DB user.
   - Existing DB security group ID.

4. Store DB password.
   - Put the DB password in AWS Secrets Manager.
   - Record only the secret ARN in Terraform/GitHub config.

5. Create Terraform state bucket.
   - Manual prerequisite.
   - Enable encryption and versioning.
   - Use S3 locking if supported by the Terraform backend config.

6. Create `infra/aws-dev/backend.hcl`.
   - Copy from `backend.hcl.example`.
   - Set bucket, key, region, encryption, and lock settings.

7. Run phase-1 Terraform bootstrap.
   - `cd infra/aws-dev`
   - `terraform init -backend-config=backend.hcl`
   - Use `backend_image_uri = ""`.
   - `terraform plan -out=tfplan`
   - `terraform apply tfplan`
   - This creates ECR, Cognito, edge resources, IAM/OIDC, and DNS/certs, but not ECS service yet.

8. Save GitHub deploy role.
   - Copy Terraform output `github_deploy_role_arn`.
   - Add GitHub secret `AWS_DEV_DEPLOY_ROLE_ARN`.

9. Configure GitHub vars/secrets.
   - `AWS_REGION`
   - Terraform input values for domain, VPC/subnets, DB metadata, secret ARN, Cognito domain prefix, dev company ID, basic-auth password, GitHub owner/repo/branch.

10. Apply database schema/migrations.
    - Run from a machine that can reach the DB.
    - Apply `backend/db/schema.sql` for fresh DBs, or ordered migrations for existing DBs.
    - Ensure auth tables exist.

11. Create Cognito dev user.
    - Public signup remains disabled.
    - Create/invite user from AWS Console or CLI.

12. Seed dev company membership.
    - Insert company row.
    - Insert membership row for the Cognito subject and dev company ID.
    - Use role `owner` for first dev user.

13. Run first normal deploy.
    - Trigger `.github/workflows/deploy-dev.yml`.
    - CI builds/pushes backend image and applies Terraform with that image.
    - CI builds frontend and publishes to S3/CloudFront.

14. Smoke test.
    - `https://dev.<domain>/healthz`
    - `https://api.dev.<domain>/healthz`
    - Login through Cognito at `https://dev.<domain>`.
    - Verify authenticated `/v1/workspace/snapshot?company_id=<dev_company_id>`.
    - Verify non-member company requests return `403`.

## Docker Decision
Do not dockerize everything right now.
- Backend is already Dockerized for ECS Fargate. Keep improving that Dockerfile only as needed.
- Frontend should stay a static Vite build deployed to S3/CloudFront.
- AWS DB should not be Dockerized.
- Add Docker Compose later only if local onboarding or parallel-agent development needs a reproducible local stack.

## Verification Checklist
Before handing off:
- `go test ./...`
- `npm run build`
- `node scripts\run_all_tests.mjs`
- `terraform fmt -check`
- `terraform validate`
- Terraform phase-1 plan with empty `backend_image_uri`
- Terraform phase-2 plan with a real image URI
- Docs search confirms V2 docs are obvious and current infra docs do not point to legacy `infra/terraform`
