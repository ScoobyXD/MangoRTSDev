# MangoRTS QA infrastructure

This root creates an isolated QA application in the existing AWS account and
network. It reuses the current VPC, public subnets, private subnets, NAT egress,
Terraform state bucket, and GitHub OIDC provider. It does not create another VPC
or NAT gateway. It owns a small public hosted zone for `qa.mangorts.com` so QA
DNS stays in the QA account instead of using the authoritative production zone.

QA owns separate CloudFront/ALB/ECS, Cognito, frontend and attachment buckets,
SQS queues, one email worker, Valkey, WAF, Container Insights, CloudWatch alarms,
IAM roles, and a private Single-AZ PostgreSQL 17 RDS instance. The RDS password
is generated and managed by RDS in Secrets Manager; no database password belongs
in tfvars.

Use a unique S3 backend key (`mangorts/qa/terraform.tfstate`). Never reuse the
dev or prod state key. QA requires Terraform 1.10 or newer and native S3 state
locking; the workflow is pinned to Terraform 1.15.7 and can access only that
state object and its `.tflock` file.

The QA identity is fixed in this root: project `mangorts`, environment `qa`, and
the three hostnames `qa.mangorts.com`, `api.qa.mangorts.com`, and
`origin.qa.mangorts.com`. GitHub variables cannot replace those values. The QA
deploy role accepts only OIDC jobs running inside the protected GitHub `qa`
Environment; a plain `main` branch job cannot assume it.

Before certificate validation, an explicitly authorized production DNS operator
must apply one checked-in Terraform `NS` record for `qa.mangorts.com` to the
authoritative `mangorts.com` parent. Its values are the `qa_dns_name_servers`
Terraform output. This root never assumes a production role or manages that
parent record. After delegation, all app, API, origin, and
certificate-validation records live in the QA-owned child zone. The child zone
currently adds `$0.50/month` plus normal query charges; see
[Route 53 pricing](https://aws.amazon.com/route53/pricing/).

The first local-admin apply owns creation of the QA RDS instance and subnet
group. The QA-specific checked-in RDS policy lets the GitHub QA deploy role read
RDS inventory for Terraform refreshes but grants no RDS write action.

The shared account-wide foundation policy is not attached to QA. The QA GitHub
role can read only exact QA resources. Its only account-wide reads are ECR login
and its own AWS identity. It can deploy QA images and ECS tasks, publish the QA
frontend, and invalidate the QA distribution. Its only IAM write is passing the
four exact existing QA task roles to ECS. It has no RDS permission and cannot
create or change IAM, Route 53, or WAF resources. Foundation, IAM, Nylas, and
drift refreshes stay a reviewed local-SSO plan and apply; the GitHub app rollout
plans with `-refresh=false` and fails closed if a foundation read is required.

GitHub may register only `mangorts-qa-*` task-definition families carrying the
fixed Mango QA tags. Terraform keeps old task-definition revisions registered
with `skip_destroy = true` because AWS does not support resource-scoped
deregistration. Any old-revision cleanup is a separate reviewed local-SSO job.

The checked-in defaults describe the final QA state, so the email worker,
Valkey, WAF, Container Insights, and full alarm set are on. The first apply is
the one guarded exception: explicitly set `backend_image_uri = ""`,
`backend_desired_count = 0`, `email_worker_enabled = false`, and
`email_sqs_database_migration_complete = false`. Keep Valkey, WAF, Container
Insights, and alarms on in that plan. This creates the private database and
deployment foundations without starting the API or worker. Agents and GitHub
deployment automation do not receive a database writer password.

The root also defines a one-off Fargate migration task after
`migration_image_uri` points at an immutable image built from
`backend/Dockerfile.migrations`. Terraform never runs it. Its default command is
read-only `-mode audit`; fresh initialization requires a human to start it with the
explicit override `-mode schema -baseline-migrations`. The task uses the same
private subnets, ECS security group, and RDS-managed password as the API.
After the infrastructure-only apply creates ECR, set
`TF_EMAIL_SCHEMA_MIGRATED=false` and run `deploy-qa.yml` with stage
`bootstrap-images`. That explicit stage builds and pushes immutable backend and
migration images, registers both task definitions, and forces API desired count
zero, worker disabled, and schema confirmation false. It stops without publishing
the frontend or running application smoke tests. A human can then run the guarded
database audit/bootstrap/audit sequence with the reported migration task ARN.

After schema verification, set `TF_EMAIL_SCHEMA_MIGRATED=true`, configure the
separate QA Nylas app and secret ARNs, and run `deploy-qa.yml` with stage
`deploy`. The normal deploy defaults all five production-shaped services to on
and rejects a worker deploy unless the schema, image, Nylas core configuration,
and Valkey dependencies are complete. QA uses Mango's normal outbound behavior,
so authorized users can send real messages to any syntactically valid address.

WAF is AWS's request filter in front of CloudFront. This stack uses the same
production-shaped policy: it explicitly allows Mango API and Nylas webhook
paths, then applies AWS common and known-bad-input rules to the remaining paths.
Container Insights records ECS task/service metrics. The alarm set watches the
worker, SQS backlog/DLQs, and Valkey health. Empty alarm-action ARN lists still
create visible alarms but send no notifications; point them at existing SNS or
incident destinations when notifications are wanted.

QA retains ECS logs for seven days, uses one small API task, one smaller worker,
the minimum serverless Valkey limits, and a `db.t4g.micro` Single-AZ database.
That keeps compute and database sizing low while retaining the production-shaped
service behavior requested for testing.
