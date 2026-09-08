# MangoRTS QA infrastructure

This root creates an isolated QA application in the existing AWS account and
network. It reuses the current VPC, public subnets, private subnets, NAT egress,
Terraform state bucket, and GitHub OIDC provider. It does not create another VPC
or NAT gateway. It owns a small public hosted zone for `qa.mangorts.com` so QA
DNS stays in the QA account instead of using the authoritative production zone.

QA owns separate CloudFront/ALB/ECS, Cognito, frontend and attachment buckets,
SQS queues, one email worker, Valkey, WAF, Container Insights, CloudWatch alarms,
IAM roles, and a private Single-AZ PostgreSQL 17 RDS instance. Established QA
uses one customer-managed Secrets Manager password with automatic rotation off,
matching Dev's stable credential behavior. Only its ARN belongs in tfvars; the
password value never does.

Use a unique S3 backend key (`mangorts/qa/terraform.tfstate`). Never reuse the
dev or prod state key. QA requires Terraform 1.10 or newer and native S3 state
locking; the workflow is pinned to Terraform 1.15.7 and can access only that
state object and its `.tflock` file.

The QA identity is fixed in this root: project `mangorts`, environment `qa`, and
the three hostnames `qa.mangorts.com`, `api.qa.mangorts.com`, and
`origin.qa.mangorts.com`. GitHub variables cannot replace those values. The QA
deploy role accepts only OIDC jobs running inside the GitHub `qa` Environment,
and the workflow itself accepts only `main`. Required reviewers and deployment
branch restrictions are separate GitHub Environment settings; do not describe
them as enabled until they are verified in GitHub.

Before certificate validation, an explicitly authorized production DNS operator
must apply one checked-in Terraform `NS` record for `qa.mangorts.com` to the
authoritative `mangorts.com` parent. Its values are the `qa_dns_name_servers`
Terraform output. This root never assumes a production role or manages that
parent record. After delegation, all app, API, origin, and
certificate-validation records live in the QA-owned child zone. The child zone
currently adds `$0.50/month` plus normal query charges; see
[Route 53 pricing](https://aws.amazon.com/route53/pricing/).

The first local-admin apply owns creation of the QA RDS instance and subnet
group. Initial creation requires the explicit
`database_managed_password_bootstrap=true` override and an empty
`database_password_secret_arn`. Before starting the API, a human operator must
create `mangorts/qa/db-password`, set that hidden value as the RDS master
password while disabling RDS credential management, remove the bootstrap
override, and then set the exact ARN. Omitting the ARN in established QA stops
Terraform instead of silently re-enabling rotation.
Terraform intentionally ignores later password-mode updates because it never
receives the hidden password used for the human transition. A reviewed local-SSO
refresh stops if RDS exposes a managed master-user secret again. Application
tasks receive that secret only inside ECS; deployment automation never receives
its value.

The shared account-wide foundation policy is not attached to QA. The QA GitHub
role reads exact QA resources, with account metadata/list reads only where AWS
does not support resource-scoped permissions. It deploys QA images/tasks and
frontend files, controls the QA maintenance gates, and manages private release
archives under `mangorts/qa/releases/` in the existing state bucket. The release
policy permits RDS backup metadata and tagged private QA point-in-time recovery
instances; it grants no database deletion, arbitrary instance creation, snapshot,
password retrieval, or production access. The existing exact attachment-events
role permission also fences delayed invocations during maintenance. Foundation,
IAM, Nylas, and drift refreshes remain reviewed local-SSO operations. Application
plans use `-refresh=false`, target `qa_release.release_terraform_targets`, and
reject every other managed-resource change before applying.

GitHub may register only `mangorts-qa-*` task-definition families carrying the
fixed Mango QA tags. Terraform keeps old task-definition revisions registered
with `skip_destroy = true` because AWS does not support resource-scoped
deregistration. Any old-revision cleanup is a separate reviewed local-SSO job.

The checked-in defaults keep the email worker off until a separate QA Nylas app
and controlled mailboxes exist. Valkey, WAF, Container Insights, and the full
alarm set stay on. For database preparation, also set `backend_image_uri = ""`,
`backend_desired_count = 0`, and
`email_sqs_database_migration_complete = false`. This keeps the API and worker
stopped. Agents and GitHub deployment automation do not receive a database
writer password.

The root also defines a one-off Fargate migration task after
`migration_image_uri` points at an immutable image built from
`backend/Dockerfile.migrations`. Terraform never runs it. Its default command is
read-only `-mode audit`; fresh initialization requires a human to start it with
the explicit override `-mode schema -baseline-migrations`. The guarded helper may
target only the stable QA database or a timestamped `mangorts_qa_next_*` database
on this same RDS instance. The task uses the same private subnets, ECS security
group, and fixed customer-managed password secret as the API.
After the infrastructure-only apply creates ECR, set
`TF_EMAIL_SCHEMA_MIGRATED=false` and run `deploy-qa.yml` with stage
`bootstrap-images`. That explicit stage builds and pushes immutable backend and
migration images, registers both task definitions, and forces API desired count
zero, worker disabled, and schema confirmation false. It stops without publishing
the frontend or running application smoke tests. A human can then run the guarded
database audit/bootstrap/audit sequence with the reported migration task ARN.
The current one-time copy foundation restores the full Dev schema objects and
data into one fresh timestamped, inactive database on the QA RDS instance,
omitting only ownership and grants through the required restore flags. It does not
sanitize data, rewrite identities, bootstrap a different schema, verify parity,
or replace the stable `mangorts_qa` database; see
`docs/infra/mangorts-qa-environment-runbook.md`.

For an established QA site, run `deploy-qa.yml` with stage `deploy` and the exact
approved main commit. This one action includes that revision's pending SQL;
the old schema flag is not proof that those migrations have run. See the
[release and recovery runbook](../../docs/infra/qa-release-recovery.md) for the
maintenance order and the same action's `recover` stage. Configure the separate
QA Nylas app and secret ARNs before enabling the worker. The workflow rejects a
worker deploy unless the image, Nylas core configuration, and Valkey dependencies
are complete. QA uses Mango's normal
outbound behavior once the worker is deliberately enabled, so authorized users
can send real messages to any syntactically valid address.

WAF is AWS's request filter in front of CloudFront. This stack uses the same
production-shaped policy: it explicitly allows Mango API and Nylas webhook
paths, then applies AWS common and known-bad-input rules to the remaining paths.
Container Insights records ECS task/service metrics. The alarm set watches the
worker, SQS backlog/DLQs, and Valkey health. Empty alarm-action ARN lists still
create visible alarms but send no notifications; point them at existing SNS or
incident destinations when notifications are wanted.

QA retains ECS logs for seven days, uses one small API task, the minimum
serverless Valkey limits, and a `db.t4g.micro` Single-AZ database. The smaller
email worker adds cost only after it is deliberately enabled. This keeps the
base site low-cost while retaining the production-shaped services needed later.

Automated database backups remain enabled for one day by default, bounded to
1–7 days. Attachment versions and private release artifacts retain the backup
period plus one day. Initial S3 versioning requires its 15-minute propagation
window; Terraform records the earliest ready time in a nonsecret SSM parameter.
Normal releases create no snapshots or second running database. Only actual
recovery creates a separately tagged, deletion-protected instance. Terraform
continues to own the original database and reads the active instance from
`/mangorts/qa/active-database-identifier` on every plan. It never overwrites that
selector, deletes the original, or imports a restored instance over it. Retiring
retained databases requires a separate approved human operation.

`qa_maintenance_mode` defaults to true: API/worker counts stay zero, writer
schedules stay disabled, and the QA ALB rule returns 503. The coordinator starts
only the new API behind that gate, verifies it with a temporary probe, then
reopens services and schedules after checks pass. Other environments retain
their existing defaults.

The current recovery record's images use `qa-recovery-` tags in the existing QA
ECR repository. A higher-priority tagged lifecycle rule protects those images
from ordinary count-50 expiry; the coordinator removes obsolete recovery tags
when a newer release becomes current. The tagged rule's count-100 ceiling
bounds accidental accumulation while the coordinator holds only the current
release's small image set. This creates neither another repository nor an image
copy. The deployment role may update lifecycle rules and remove image tags only
in the exact QA repository. [AWS lifecycle rule priority](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html).
