import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const sqs = read("infra/modules/mangorts-platform/email_sqs.tf");
const task = read("infra/modules/mangorts-platform/ecs_alb.tf");
const iam = read("infra/modules/mangorts-platform/iam.tf");
const moduleVariables = read("infra/modules/mangorts-platform/variables.tf");
const moduleLocals = read("infra/modules/mangorts-platform/locals.tf");
const devMain = read("infra/aws-dev/main.tf");
const devVariables = read("infra/aws-dev/variables.tf");
const devWorkflow = read(".github/workflows/deploy-dev.yml");

test("DEV email work queue and work DLQ are encrypted FIFO with fixed SQS delivery", () => {
  for (const queue of ["email_work", "email_work_dlq"]) {
    assert.match(sqs, new RegExp(`resource "aws_sqs_queue" "${queue}"[\\s\\S]*?fifo_queue\\s*=\\s*true`));
    assert.match(sqs, new RegExp(`resource "aws_sqs_queue" "${queue}"[\\s\\S]*?content_based_deduplication\\s*=\\s*true`));
    assert.match(sqs, new RegExp(`resource "aws_sqs_queue" "${queue}"[\\s\\S]*?sqs_managed_sse_enabled\\s*=\\s*true`));
  }
  assert.match(sqs, /visibility_timeout_seconds\s*=\s*600/);
  assert.match(sqs, /receive_wait_time_seconds\s*=\s*20/);
  assert.match(sqs, /maxReceiveCount\s*=\s*3/);
  assert.doesNotMatch(sqs + task, /ChangeMessageVisibility/);
});

test("worker is one private task with independent health and bounded concurrency", () => {
  assert.match(sqs, /resource "aws_ecs_service" "email_worker"[\s\S]*?desired_count\s*=\s*1/);
  assert.match(sqs, /assign_public_ip\s*=\s*false/);
  assert.doesNotMatch(sqs, /load_balancer\s*\{/);
  assert.match(sqs, /MANGORTS_RUNTIME_ROLE", value = "email-worker"/);
	assert.match(sqs, /MANGORTS_EMAIL_WORKER_CONCURRENCY/);
	assert.match(sqs, /AUTH_MODE", value = "disabled"/);
	assert.doesNotMatch(sqs, /NYLAS_STATE_SECRET|NYLAS_WEBHOOK_SECRET/);
	assert.match(sqs, /execution_role_arn\s*=\s*aws_iam_role\.email_worker_execution\[0\]\.arn/);
	assert.match(iam, /data "aws_iam_policy_document" "email_worker_execution_secrets"[\s\S]*?local\.db_password_secret_arn,[\s\S]*?var\.nylas_api_key_secret_arn/);
	assert.doesNotMatch(iam.match(/data "aws_iam_policy_document" "email_worker_execution_secrets"[\s\S]*?\n\}/)?.[0] ?? "", /nylas_state|nylas_webhook/i);
	const workerRuntimePolicy = sqs.match(/data "aws_iam_policy_document" "email_worker_sqs"[\s\S]*?\n\}/)?.[0] ?? "";
	assert.doesNotMatch(workerRuntimePolicy, /GetQueueAttributes/);
  assert.match(sqs, /metric_name\s*=\s*"RunningTaskCount"/);
  assert.doesNotMatch(sqs, /healthCheck|health_check/);
});

test("scheduler uses stable control group, bounded retries, and its own encrypted Standard DLQ", () => {
  assert.match(sqs, /schedule_expression\s*=\s*"rate\(10 minutes\)"/);
  assert.match(sqs, /message_group_id\s*=\s*local\.email_reconciliation_group/);
  assert.match(sqs, /email_reconciliation_group\s*=\s*"reconciliation-control"/);
  assert.match(sqs, /<aws\.scheduler\.scheduled-time>/);
  assert.match(sqs, /maximum_retry_attempts\s*=\s*2/);
  assert.match(sqs, /maximum_event_age_in_seconds\s*=\s*300/);
  assert.match(sqs, /variable\s*=\s*"aws:SourceAccount"/);
  assert.match(sqs, /variable\s*=\s*"aws:SourceArn"/);
	assert.match(sqs, /resource "aws_scheduler_schedule_group" "email_reconciliation"/);
	assert.match(sqs, /email_schedule_group_arn\s*=\s*"arn:[^"]+:schedule-group\/\$\{local\.email_schedule_group_name\}"/);
	assert.match(sqs, /variable\s*=\s*"aws:SourceArn"[\s\S]*?local\.email_schedule_group_arn/);
	assert.doesNotMatch(sqs, /schedule\/default\//);
	assert.match(sqs, /group_name\s*=\s*aws_scheduler_schedule_group\.email_reconciliation\[0\]\.name/);
	assert.match(sqs, /resource "aws_scheduler_schedule" "email_reconciliation"[\s\S]*?depends_on = \[aws_iam_role_policy_attachment\.email_reconciliation_scheduler\]/);
  assert.match(sqs, /resource "aws_sqs_queue" "email_scheduler_dlq"[\s\S]*?sqs_managed_sse_enabled\s*=\s*true/);
  assert.doesNotMatch(sqs.match(/resource "aws_sqs_queue" "email_scheduler_dlq"[\s\S]*?\n\}/)?.[0] ?? "", /fifo_queue/);
});

test("normal DEV deploy creates queues while worker and schedule remain separately disabled", () => {
  assert.match(devVariables, /variable "email_sqs_enabled"[\s\S]*?default\s*=\s*true/);
  assert.match(devVariables, /variable "email_worker_enabled"[\s\S]*?default\s*=\s*false/);
  assert.match(devVariables, /variable "email_reconciliation_schedule_enabled"[\s\S]*?default\s*=\s*false/);
  assert.match(moduleVariables, /variable "email_sqs_enabled"[\s\S]*?default\s*=\s*false/);
  assert.match(devMain, /email_worker_enabled\s*=\s*var\.email_worker_enabled/);
	assert.match(devMain, /email_sqs_database_migration_complete\s*=\s*var\.email_sqs_database_migration_complete/);
  assert.match(task, /MANGORTS_RUNTIME_ROLE", value = "api"/);
  assert.match(task, /MANGORTS_EMAIL_WORK_QUEUE_URL/);
  assert.match(sqs, /data "aws_iam_policy_document" "github_deploy_email_sqs"[\s\S]*?var\.environment == "dev" && var\.email_sqs_enabled/);
	assert.doesNotMatch(sqs + iam, /"scheduler:\*"|"sqs:\*"/);
	const deployPolicy = sqs.match(/data "aws_iam_policy_document" "github_deploy_email_sqs"[\s\S]*?\n\}/)?.[0] ?? "";
	assert.match(deployPolicy, /ManageExactDevEmailQueues[\s\S]*?local\.email_work_queue_arn[\s\S]*?local\.email_work_dlq_arn[\s\S]*?local\.email_scheduler_dlq_arn/);
	assert.match(deployPolicy, /ManageExactDevEmailSchedule[\s\S]*?resources = \[local\.email_schedule_arn\]/);
	assert.match(deployPolicy, /ManageExactDevEmailScheduleGroup[\s\S]*?resources = \[local\.email_schedule_group_arn\]/);
	assert.equal([...deployPolicy.matchAll(/resources = \["\*"\]/g)].length, 2, "only read-only collection actions may use wildcard resources");
	assert.match(deployPolicy, /ReadQueueNames[\s\S]*?sqs:ListQueues/);
	assert.match(deployPolicy, /ReadSchedulerCollections[\s\S]*?scheduler:ListScheduleGroups[\s\S]*?scheduler:ListSchedules/);
  assert.match(sqs, /resource "aws_sqs_queue" "email_work_dlq"[\s\S]*?depends_on = \[aws_iam_role_policy_attachment\.github_deploy_email_sqs\]/);
});

test("worker and schedule cannot enable before final schema, external dependencies, and alarm actions", () => {
	assert.match(moduleVariables, /variable "email_sqs_database_migration_complete"[\s\S]*?default\s*=\s*false/);
	assert.match(sqs, /local\.email_worker_dependencies_configured/);
	assert.match(sqs, /at least one alarm action ARN/);
	assert.match(sqs, /var\.email_worker_enabled && local\.email_worker_dependencies_configured/);
	assert.match(task, /!var\.email_worker_enabled[\s\S]*?var\.email_sqs_enabled[\s\S]*?local\.backend_service_enabled[\s\S]*?local\.email_worker_dependencies_configured/);
	assert.match(task, /!var\.email_reconciliation_schedule_enabled[\s\S]*?var\.email_worker_enabled[\s\S]*?local\.backend_service_enabled/);
});

test("Terraform blocks every nonzero SQS-enabled API until migration and actionable alarms exist", () => {
	assert.match(task, /var\.email_sqs_enabled[\s\S]*?var\.backend_desired_count > 0[\s\S]*?var\.email_sqs_database_migration_complete/);
	assert.match(task, /A nonzero SQS-enabled API desired count requires email_sqs_database_migration_complete=true/);
	assert.match(task, /var\.email_sqs_enabled[\s\S]*?var\.backend_desired_count > 0[\s\S]*?length\(var\.email_worker_alarm_action_arns\) > 0/);
	assert.match(task, /A nonzero SQS-enabled API desired count requires at least one email alarm action ARN/);
});

test("DEV workflow separates reviewable infrastructure, worker, and schedule plans from exact apply", () => {
	assert.match(devWorkflow, /options: \[infrastructure-api, worker-only, schedule-only\]/);
	assert.match(devWorkflow, /api_desired_count/);
	assert.match(devWorkflow, /The new API is not legacy-schema compatible/);
	assert.match(devWorkflow, /EMAIL_WORKER_ENABLED=false[\s\S]*?EMAIL_SCHEDULE_ENABLED=false/);
	assert.match(devWorkflow, /worker-only\)[\s\S]*?EMAIL_WORKER_ENABLED=true[\s\S]*?EMAIL_SCHEDULE_ENABLED=false/);
	assert.match(devWorkflow, /schedule-only\)[\s\S]*?EMAIL_WORKER_ENABLED=true[\s\S]*?EMAIL_SCHEDULE_ENABLED=true/);
	assert.match(devWorkflow, /environment: development/);
	assert.match(devWorkflow, /TF_PLAN_AGE_RECIPIENT/);
	assert.match(devWorkflow, /secrets\.TF_PLAN_AGE_IDENTITY/);
	assert.match(devWorkflow, /age --encrypt[\s\S]*?mangorts-dev-tfplan\.tar\.age/);
	assert.match(devWorkflow, /age --decrypt[\s\S]*?sha256sum --check tfplan\.sha256/);
	assert.ok([...devWorkflow.matchAll(/umask 077/g)].length >= 4, "secret-bearing Terraform inputs and plan plaintext must be runner-private");
	assert.match(devWorkflow, /actions\/download-artifact@v4[\s\S]*?name: mangorts-dev-tfplan-ciphertext[\s\S]*?run-id: \$\{\{ inputs\.reviewed_plan_run_id \}\}/);
	assert.match(devWorkflow, /terraform apply "\$RUNNER_TEMP\/mangorts-dev-tfplan-plain\/tfplan"/);
	assert.doesNotMatch(devWorkflow, /terraform apply -auto-approve/);
	assert.match(devWorkflow, /TF_EMAIL_WORKER_ALARM_ACTION_ARNS/);
	assert.match(devWorkflow, /API_DESIRED_COUNT" != "0" \|\| "\$EMAIL_WORKER_ENABLED" == "true"[\s\S]*?TF_EMAIL_WORKER_ALARM_ACTION_ARNS_NORMALIZED/);

	const upload = devWorkflow.match(/- name: Upload encrypted exact Terraform plan[\s\S]*?if-no-files-found: error/)?.[0] ?? "";
	assert.match(upload, /actions\/upload-artifact@v4/);
	assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/mangorts-dev-tfplan\.tar\.age/);
	assert.doesNotMatch(upload, /TF_DIR|tfplan\.txt|tfplan-metadata\.json|tfplan\.sha256|path:\s*[^\n]*\/tfplan\s*$/m);
	assert.doesNotMatch(devWorkflow, /path:\s*\|[\s\S]{0,300}(?:tfplan\.txt|tfplan-metadata\.json|\/tfplan\s*$)/m);
	assert.match(moduleLocals, /var\.environment == "dev" \? \["repo:\$\{var\.github_owner\}\/\$\{var\.github_repository\}:environment:development"\] : \[\]/);
});

test("alarms cover queue age, backlog, both DLQs, and running task count", () => {
  for (const alarm of [
    "email_worker_not_running",
    "email_work_oldest_message",
    "email_work_backlog",
    "email_work_dlq",
    "email_scheduler_dlq",
  ]) {
    assert.match(sqs, new RegExp(`resource "aws_cloudwatch_metric_alarm" "${alarm}"`));
  }
});
